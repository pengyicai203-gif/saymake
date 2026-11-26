#!/usr/bin/env node
// SayMake 安装器：认出本机有哪些 AI 工具，把 skill 和"每次加载的那一段"放到位。可重复运行，可撤销。
//   node core/install.mjs                          安装 / 更新
//   node core/install.mjs --dry-run                只看会做什么，不动任何文件
//   node core/install.mjs --tools claude,doubao    只装到指定工具
//   node core/install.mjs --link                   skill 用链接而不是复制（改仓库立刻生效；个别工具可能不认链接）
//   node core/install.mjs --uninstall              撤销：删掉放进去的 skill，把动过的文件恢复成安装前的样子
//   同名 skill 不是安装器放的，默认不碰；确认可以覆盖就加 --force（会先备份）
// 只需要 Node.js 18+。不联网，不改任何工具自己的设置，只往它们的 skill 目录和加载文件里放东西。
// 测试：SAYMAKE_HOME=/tmp/x HOME=/tmp/fakehome node core/install.mjs --dry-run

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync, symlinkSync, lstatSync, readFileSync, writeFileSync, readdirSync, realpathSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const DRY = flag('--dry-run'), LINK = flag('--link'), UNINSTALL = flag('--uninstall'), FORCE = flag('--force');
const only = (val('--tools', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const HOME = resolve(val('--home', process.env.SAYMAKE_HOME || join(homedir(), '.saymake')));
const repo = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const SKILLS = ['saymake', 'make-game'];
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const stateFile = join(HOME, 'install.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { tools: {} };
const alwaysAbs = () => join(HOME, 'current', 'core', 'ALWAYS.md');

const notes = [];
const say = (s) => notes.push(s);
const fs = (desc, fn) => { say((DRY ? '[只看不做] ' : '') + desc); if (!DRY) fn(); };

// ---------- 这台电脑上有哪些 AI 工具 ----------
const u = homedir();
const doubaoBase = join(u, 'Library', 'Application Support', 'DoubaoWork');
const candidates = [
  { name: 'claude', label: 'Claude Code', present: existsSync(join(u, '.claude')), skillsDirs: [join(u, '.claude', 'skills')], always: [{ file: join(u, '.claude', 'CLAUDE.md'), mode: 'import' }], verified: '未验证（本会话打不开 Claude Code；装完开一次新对话问"你记得我哪些规矩"）' },
  { name: 'codex', label: 'Codex', present: existsSync(join(u, '.codex')), skillsDirs: [join(u, '.codex', 'skills')], always: [{ file: join(u, '.codex', 'AGENTS.md'), mode: 'copy' }], verified: '未验证' },
];
const doubaoProfiles = [];
if (existsSync(doubaoBase)) {
  for (const d of readdirSync(doubaoBase)) {
    const ws = join(doubaoBase, d, '.doubaowork', 'agent_mode', 'workspace');
    if (existsSync(join(ws, '.user_skills'))) doubaoProfiles.push({ label: `豆包（${d}）`, ws });
  }
}
if (doubaoProfiles.length) candidates.push({
  name: 'doubao', label: '豆包', present: true,
  skillsDirs: doubaoProfiles.map((p) => join(p.ws, '.user_skills')),
  always: doubaoProfiles.map((p) => ({ file: join(p.ws, 'ALWAYS.md'), mode: 'import' })),
  verified: 'skill 目录已验证（v0.5 就装在这里）；每次自动加载的文件未验证——开新对话看它是否先查记忆',
});
const tools = candidates.filter((t) => t.present && (!only.length || only.includes(t.name)));

console.log(`SayMake 安装器\n  仓库：${repo}\n  记忆库：${HOME}${DRY ? '\n  （只看不做）' : ''}`);
if (!tools.length) { console.log('\n没认出本机的 AI 工具（支持 Claude Code、Codex、豆包）。可用 --tools 指定。'); process.exit(1); }

// ---------- 小工具 ----------
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { tools: {} });
const saveState = (s) => { if (DRY) return; mkdirSync(HOME, { recursive: true }); writeFileSync(stateFile, JSON.stringify(s, null, 2) + '\n'); };
function runNode(scriptArgs) {
  const r = spawnSync(process.execPath, scriptArgs, { encoding: 'utf8', env: { ...process.env, SAYMAKE_HOME: HOME } });
  if (r.status !== 0) throw new Error('生成"每次加载的那一段"失败：' + (r.stderr || r.stdout));
  return r.stdout.replace(/\s+$/, '');
}
const alwaysText = () => runNode([join(repo, 'skills', 'saymake', 'scripts', 'log.mjs'), 'inject']);
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const backup = (src, name) => { const bak = join(HOME, 'backup', ts, name); mkdirSync(dirname(bak), { recursive: true }); cpSync(src, bak, { recursive: true }); return bak; };
const importBlock = () => `<!-- saymake:start -->\n@${alwaysAbs()}\n<!-- saymake:end -->`;
const appended = (old, block) => (old ? old + (old.endsWith('\n') ? '' : '\n') + '\n' + block + '\n' : block + '\n');

// ---------- 放一个 skill ----------
const MARK = '.saymake-skill';   // 我们放的 skill 目录里都有这个记号，凭它区分"是不是安装器放的"
function putSkill(label, skillsDir, name) {
  const src = join(repo, 'skills', name), dst = join(skillsDir, name);
  const place = () => { mkdirSync(skillsDir, { recursive: true }); if (LINK) symlinkSync(src, dst); else cpSync(src, dst, { recursive: true }); };
  if (!existsSync(dst)) { fs(`${label}：放 skill「${name}」到 ${skillsDir}（${LINK ? '链接' : '复制'}）`, place); return; }
  if (isLink(dst) && resolve(dirname(dst), readlinkSync(dst)) === repo) {
    if (LINK) { say(`${label}：「${name}」已经是指向仓库的链接，不用动`); return; }
    fs(`${label}：「${name}」从链接改成复制`, () => { rmSync(dst); place(); }); return;
  }
  if (realpathSync(dst) === realpathSync(src)) { say(`${label}：「${name}」就是仓库本身，不用动`); return; }
  if (!existsSync(join(dst, MARK))) {
    if (!FORCE) { say(`${label}：${skillsDir} 里已有一个「${name}」，不是安装器放的（可能是你手动放的旧版），没动它。确认可以覆盖就加 --force`); return; }
    const bak = join(HOME, 'backup', ts, `${basename(skillsDir)}-${name}`);
    fs(`${label}：「${name}」不是安装器放的，按 --force 先备份到 ${relative(bak)} 再覆盖`, () => { backup(dst, `${basename(skillsDir)}-${name}`); rmSync(dst, { recursive: true, force: true }); place(); });
    return;
  }
  if (sameDir(dst, src)) { say(`${label}：「${name}」已是最新，不用动`); return; }
  fs(`${label}：「${name}」旧的一份先备份到 ~/.saymake/backup/${ts}/，再换成新的`, () => { const bak = backup(dst, `${basename(skillsDir)}-${name}`); rmSync(dst, { recursive: true, force: true }); place(); say(`  备份：${bak}`); });
}
// 两个目录内容是否完全一样（skill 很小，逐个文件比）
function sameDir(a, b, rel = '') {
  const ea = readdirSync(join(a, rel), { withFileTypes: true }).filter((d) => d.name !== '.DS_Store').map((d) => d.name + (d.isDirectory() ? '/' : '')).sort();
  const eb = readdirSync(join(b, rel), { withFileTypes: true }).filter((d) => d.name !== '.DS_Store').map((d) => d.name + (d.isDirectory() ? '/' : '')).sort();
  if (ea.join('|') !== eb.join('|')) return false;
  for (const n of ea) {
    if (n.endsWith('/')) { if (!sameDir(a, b, join(rel, n))) return false; }
    else if (!readFileSync(join(a, rel, n)).equals(readFileSync(join(b, rel, n)))) return false;
  }
  return true;
}

// ---------- 接上"每次加载" ----------
function putAlways(entry, a) {
  const f = a.file, old = existsSync(f) ? readFileSync(f, 'utf8') : '';
  const has = old.includes('saymake:start');
  // 上次安装时的备份记录要接着用：撤销时恢复的是"第一次装之前"的样子，不是"这一次装之前"的样子
  const prev = readState().tools?.[entry.name]?.always?.find((x) => x.file === f);
  const keep = prev?.backup && existsSync(join(HOME, prev.backup)) ? prev.backup : null;
  const text = a.mode === 'copy' ? alwaysText() : '';
  if (has) {
    if (keep) a.backup = keep;
    if (a.mode === 'import') { say(`${entry.label}：每次加载已经接好（${f}）`); return; }
    fs(`${entry.label}：更新 ${f} 里的那一段`, () => writeFileSync(f, old.replace(/<!-- saymake:start -->[\s\S]*?<!-- saymake:end -->/, () => text)));
    return;
  }
  // 要动用户自己的文件才备份；本来就是我们建的空文件不用
  if (old && keep) a.backup = keep;
  else if (old && !DRY) a.backup = relative(backup(f, `${entry.name}-${basename(f)}`));
  const what = a.mode === 'import' ? '一行引用（每次对话开头自动读你的规矩）' : '那一段规矩';
  fs(`${entry.label}：在 ${f} 里${old ? `追加${what}` : `写入${what}`}${old ? `（原文件先备份到 ~/.saymake/${a.backup ?? 'backup/…'}）` : ''}`, () => {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, appended(old, a.mode === 'import' ? importBlock() : text));
  });
}
const relative = (p) => p.replace(HOME + '/', '');

// ---------- 撤销 ----------
if (UNINSTALL) {
  for (const [name, e] of Object.entries(readState().tools ?? {})) {
    for (const sd of e.skillsDirs ?? []) for (const s of e.skills ?? []) {
      const p = join(sd, s);
      if (!existsSync(p)) continue;
      if (!existsSync(join(p, MARK))) { say(`${e.label}：「${s}」不是安装器放的，没动`); continue; }
      fs(`${e.label}：删掉 skill「${s}」（${p}）`, () => rmSync(p, { recursive: true, force: true }));
    }
    for (const a of e.always ?? []) {
      if (!existsSync(a.file)) continue;
      const bak = a.backup ? join(HOME, a.backup) : null;
      const t = readFileSync(a.file, 'utf8');
      if (bak && existsSync(bak)) fs(`${e.label}：把 ${a.file} 恢复成安装前的样子`, () => cpSync(bak, a.file));
      else if (t.includes('saymake:start')) {
        // 没有备份记录（比如记录丢了）：只摘掉我们那一段，不动用户自己写的内容
        const rest = t.replace(/\n*<!-- saymake:start -->[\s\S]*?<!-- saymake:end -->\n?/g, '\n');
        if (rest.trim()) fs(`${e.label}：从 ${a.file} 里摘掉那一段（没有备份记录，其余内容不动）`, () => writeFileSync(a.file, rest));
        else fs(`${e.label}：删掉 ${a.file}（安装时新建的）`, () => rmSync(a.file));
      }
    }
  }
  fs('删掉安装记录（install.json）', () => rmSync(stateFile, { force: true }));
  console.log('\n' + notes.join('\n'));
  console.log('\n你的记忆（记忆库目录）和备份没有动。想彻底清掉就手动删掉它们。');
  process.exit(0);
}

// ---------- 安装 ----------
try {
  fs('把 ~/.saymake/current 指向这个仓库（升级 = 在仓库里 git pull，再运行一次）', () => {
    mkdirSync(HOME, { recursive: true });
    const cur = join(HOME, 'current');
    if (existsSync(cur) && !isLink(cur)) throw new Error(`~/.saymake/current 已存在而且不是链接，不敢覆盖：${cur}`);
    if (isLink(cur)) rmSync(cur);
    symlinkSync(repo, cur);
  });
  const text = alwaysText();
  fs(`生成每次加载的那一段 core/ALWAYS.md（${text.length} 字符${text.length > 1500 ? '，超过 1500 的目标，规矩该精简了' : ''}）`, () => writeFileSync(join(repo, 'core', 'ALWAYS.md'), text + '\n'));

  const newState = { time: new Date().toISOString(), repo, link: LINK, tools: { ...readState().tools } };   // 只装部分工具时，别的工具的记录留着（撤销要用）
  for (const t of tools) {
    const entry = { label: t.label, skills: SKILLS, skillsDirs: t.skillsDirs, always: t.always.map((a) => ({ ...a })), verified: t.verified };
    for (const sd of t.skillsDirs) for (const s of SKILLS) putSkill(t.label, sd, s);
    for (const a of entry.always) putAlways({ ...entry, name: t.name }, a);
    newState.tools[t.name] = entry;
  }
  saveState(newState);
} catch (e) {
  console.error('\n✗ ' + e.message + '\n\n做到这里为止：');
  console.error(notes.join('\n'));
  process.exit(1);
}
console.log('\n' + notes.join('\n'));
console.log('\n各工具的验证情况：');
for (const t of tools) console.log(`  ${t.label}：${t.verified}`);
console.log('\n接下来：开一个新对话，第一句问它"你记得我立的哪些规矩？"');
console.log('  答得出来 = 每次加载生效；答不出来就告诉我，这是要继续攻克的点。');
