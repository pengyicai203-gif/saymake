#!/usr/bin/env node
// SayMake 记忆内核。跨项目、跨 skill，跟着用户走，存在 AI 工具里。纯文本，本机，不联网。
//
// 存在哪：
//   项目日志  <项目>/.saymake/session.jsonl   这一次发生了什么（算指标、算读取量）
//   记忆库    ~/.saymake/memory/              规则、偏好、案例、踩过的坑、候选   （环境变量 SAYMAKE_HOME 可改位置）
//   每次加载  ~/.saymake/current/core/ALWAYS.md 规则层，每次对话开头被 AI 工具自动读（由 install 写进加载位置）
//
// 读写规则只有三条：
//   偏好、坑  模型判断后自动记，但必须告诉用户记了什么，用户说"忘掉"就删
//   规则、惯例 先提候选，用户点头才生效（最多 12 条规则，每条一句话）
//   这次的话和记忆冲突时，以这次的话为准，并更新记忆
//
// 命令：
//   【开工，任何 skill、任何项目】
//   recall --brief "用户的话"              给模型看：规则、偏好、相似案例、相关的坑（输出末尾有字符数）
//   【项目内按顺序】
//   start --brief "…"                      开工
//   judge --aesthetic <id> --genre <id,id> --mechanics <id,id> --audience <id> --why "依据"
//   ask --question "…" --answer "…"        generate --file <路径>
//   selfcheck --ok true|false --notes "看到了什么"      deliver（没有通过的自检会被拒绝）
//   feedback --kind overall|local --text "…"           resolve --text "…" --lesson "…"
//   summary                                四个指标          cost    从开工到现在读了多少字符
//   【记忆】
//   remember --kind preference --text "…" [--replaces <id 或原句>]
//   remember --kind lesson --problem "…" --cause "…" --fix "…" [--tags a,b]
//   forget <id>                            show
//   【自进化】
//   propose --kind preference|rule|convention --text "…" --why "依据"   提一条候选（同一条会累加次数）
//   candidates                             列出待定的          accept <id>   reject <id>
//   rule list | rule add --text "…" --why "…" | rule remove <id>
//   【安装与自检】
//   inject                                 打印每次加载的那一段    refresh   把它同步到各 AI 工具
//   doctor                                 检查各工具是否装好、是否同步      status    一行看全貌

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = process.env.SAYMAKE_HOME || join(homedir(), '.saymake');
const MEM = join(HOME, 'memory');
const projDir = process.cwd();
const PROJ = join(projDir, '.saymake', 'session.jsonl');
const F = {
  profile: join(MEM, 'profile.json'), cases: join(MEM, 'cases.jsonl'), lessons: join(MEM, 'lessons.jsonl'),
  projects: join(MEM, 'projects.json'), rules: join(MEM, 'rules.json'), conventions: join(MEM, 'conventions.json'),
  candidates: join(MEM, 'candidates.jsonl'), install: join(HOME, 'install.json'),
};
const CORE = join(HOME, 'current', 'core');
const MAX_RULES = 12, RULE_LEN = 60;
const SKILL_DIR = process.env.SAYMAKE_SKILL_DIR || '';
const BUDGET = Number(process.env.SAYMAKE_READ_BUDGET || 9000);

const [cmd, ...raw] = process.argv.slice(2);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };
const opts = {};
for (let i = 0; i < raw.length; i++) {
  if (raw[i].startsWith('--')) { const k = raw[i].slice(2); const v = raw[i + 1]; opts[k] = (v === undefined || v.startsWith('--')) ? 'true' : v; }
}
const need = (k) => { if (!opts[k] || opts[k] === 'true') die(`${cmd} 需要 --${k}`); return opts[k]; };
const list = (s) => String(s ?? '').split(/[，,\s]+/).map((x) => x.trim()).filter(Boolean);
const now = () => new Date().toISOString();
const sid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const out = (text, sized = true) => process.stdout.write(text + (sized ? `\n[size ${text.length} 字符]\n` : '\n'));

// ---------- 小工具 ----------
const readJson = (f, d) => { if (!existsSync(f)) return d; try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const writeJsonl = (f, rows) => writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const ensureMem = () => mkdirSync(MEM, { recursive: true });
function logEvent(e) {
  mkdirSync(join(projDir, '.saymake'), { recursive: true });
  const row = { t: now(), ...e };
  appendFileSync(PROJ, JSON.stringify(row) + '\n');
  return row;
}
const projName = () => basename(projDir) || projDir;

// 当前这一轮会话（最近一次 start）
function session() {
  const rows = readJsonl(PROJ);
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].e === 'start') return rows[i];
  return null;
}
function requireSession() { const s = session(); if (!s) die('还没有开工。先运行：log.mjs start --brief "用户的话"'); return s; }
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s，。！？、,.!?：:；;「」“”"'（）()]+/g, '');

// 中文按两字一组切，英文按单词切。词面相似度用，不做向量。
// "一个""想要""游戏"这类词谁的话里都有，算相似等于没算，直接扔掉
const STOP = new Set(['做一', '一个', '想要', '一点', '有点', '一下', '不了', '这个', '那个', '可以', '应该', '然后', '就是', '东西', '手机', '游戏', '网页', '简单', '好玩', '帮我', '给我', '小的', '小的']);
function tokens(s) {
  const t = new Set();
  const ascii = String(s ?? '').toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  ascii.forEach((w) => t.add(w));
  const cjk = String(s ?? '').replace(/[^一-鿿]+/g, '');
  for (let i = 0; i < cjk.length - 1; i++) { const b = cjk.slice(i, i + 2); if (!STOP.has(b)) t.add(b); }
  return t;
}
const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

// ---------- 经验库读写 ----------
function updateCase(id, patch) {
  const rows = readJsonl(F.cases);
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  rows[i] = { ...rows[i], ...patch, updated: now() };
  writeJsonl(F.cases, rows);
  return rows[i];
}
const rules = () => (readJson(F.rules, { rules: [] }).rules ?? []).filter((r) => r.active !== false);
const writeRules = (rs) => writeFileSync(F.rules, JSON.stringify({ rules: rs }, null, 2) + '\n');
const prefs = () => (readJson(F.profile, { preferences: [] }).preferences ?? []).filter((p) => p.active);
const convs = () => (readJson(F.conventions, { conventions: [] }).conventions ?? []).filter((c) => c.active !== false);

// ---------- 每次加载的那一段 ----------
function alwaysText() {
  const L = [
    '<!-- saymake:start -->',
    '# 这个用户',
    '',
    '你的记忆存在本机 `~/.saymake/memory/`，纯文本，用户可以看、可以删。',
    '',
    '## 开工前（任何任务，不只做游戏）',
    '- 先运行 `node ' + join(HOME, 'current', 'skills', 'saymake', 'scripts', 'log.mjs') + ' recall --brief "<用户这次的话>"`，按它带出的规则、偏好、以前的坑来做。',
    '- 它的输出和用户这次的话冲突时，以这次的话为准，并更新那条记忆。',
    '',
    '## 用户立的规矩（最多 12 条，每条一句话）',
  ];
  const rs = rules();
  if (rs.length) rs.forEach((r, i) => L.push(`${i + 1}. ${r.text}`));
  else L.push('（还没有。用户纠正你时，用 propose --kind rule 提一条候选，他点头才生效）');
  L.push('', '## 收尾时', '- 这次学到的、下次还用得上的：偏好和坑用 remember 自动记（告诉用户记了什么）；规矩和惯例用 propose 提候选，等用户点头。', '<!-- saymake:end -->');
  return L.join('\n');
}
function writeAlways() {
  // 只有装过（~/.saymake/current 存在）才写，免得凭空造出一个没人读的文件
  if (!existsSync(join(HOME, 'current'))) return false;
  mkdirSync(CORE, { recursive: true });
  writeFileSync(join(CORE, 'ALWAYS.md'), alwaysText() + '\n');
  return true;
}

// ---------- 项目内的命令 ----------
if (cmd === 'start') {
  const brief = need('brief');
  ensureMem();
  const s = logEvent({ e: 'start', sid: sid(), brief, project: projName() });
  const cid = s.sid;
  const rows = readJsonl(F.cases);
  if (!rows.some((r) => r.id === cid)) {
    rows.push({ id: cid, time: now(), project: projName(), brief, aesthetic: null, genres: [], mechanics: [], audience: null, why: '', asked: [], outcome: 'open', feedback: [], lesson: '' });
    writeJsonl(F.cases, rows);
  }
  const pj = readJson(F.projects, {});
  pj[cid] = { time: now(), dir: projDir, project: projName(), brief };
  writeFileSync(F.projects, JSON.stringify(pj, null, 2) + '\n');
  console.log(`✓ 开工已记录。记忆库：${MEM}`);

} else if (cmd === 'judge') {
  const s = requireSession();
  const j = { aesthetic: opts.aesthetic ?? null, genres: list(opts.genre), mechanics: list(opts.mechanics), audience: opts.audience ?? 'self', why: opts.why ?? '' };
  logEvent({ e: 'judge', sid: s.sid, ...j });
  updateCase(s.sid, j);
  const pj = readJson(F.projects, {});
  if (pj[s.sid]) { Object.assign(pj[s.sid], { aesthetic: j.aesthetic, genres: j.genres }); writeFileSync(F.projects, JSON.stringify(pj, null, 2) + '\n'); }
  console.log(`✓ 判断已记录：${j.aesthetic} + ${j.genres.join(',') || '—'}，给 ${j.audience}`);

} else if (cmd === 'ask') {
  const s = requireSession();
  const q = { q: need('question'), a: opts.answer ?? '' };
  logEvent({ e: 'ask', sid: s.sid, ...q });
  const c = readJsonl(F.cases).find((r) => r.id === s.sid);
  if (c) updateCase(s.sid, { asked: [...(c.asked ?? []), q] });
  console.log(`✓ 提问已记录${q.a ? '（用户已答）' : '（用户还没答）'}`);

} else if (cmd === 'generate') {
  const s = requireSession();
  logEvent({ e: 'generate', sid: s.sid, file: resolve(need('file')) });
  console.log('✓ 已记录写出了游戏文件。看截图自检后运行 selfcheck');

} else if (cmd === 'selfcheck') {
  const s = requireSession();
  const ok = String(opts.ok) === 'true';
  if (!opts.notes || opts.notes === 'true') die('selfcheck 需要 --notes：每一条看到了什么。写不出来就是还没看');
  logEvent({ e: 'selfcheck', sid: s.sid, ok, notes: opts.notes });
  console.log(ok ? '✓ 自检已记录：通过' : '✓ 自检已记录：没过，改完要重新 generate 和 selfcheck');

} else if (cmd === 'deliver') {
  const s = requireSession();
  const rows = readJsonl(PROJ).filter((r) => r.sid === s.sid);
  const li = (e) => rows.map((r) => r.e).lastIndexOf(e);
  const g = li('generate'), c = li('selfcheck');
  if (g < 0) die('还没有 generate，没有东西可交付');
  if (c < g) die('上一次 generate 之后没有自检记录。先看截图，再运行 selfcheck --ok --notes "…"');
  if (rows[c].ok !== true) die('最近一次自检没过。改完重新 generate，再 selfcheck');
  logEvent({ e: 'deliver', sid: s.sid, file: rows[g].file });
  console.log('✓ 已交付');

} else if (cmd === 'feedback') {
  const s = requireSession();
  const kind = opts.kind === 'local' ? 'local' : opts.kind === 'overall' ? 'overall' : null;
  if (!kind) die('feedback 需要 --kind overall 或 local');
  const text = need('text');
  logEvent({ e: 'feedback', sid: s.sid, kind, text });
  const c0 = readJsonl(F.cases).find((r) => r.id === s.sid);
  const patch = { feedback: [...(c0?.feedback ?? []), { kind, text, t: now() }] };
  if (kind === 'overall') patch.outcome = 'miss';
  updateCase(s.sid, patch);
  console.log(kind === 'overall' ? '✓ 整体反馈已记录，这个案例标为"偏了"。解决后用 resolve 写明最后是什么方向' : '✓ 局部修改已记录');

} else if (cmd === 'resolve') {
  const s = requireSession();
  const text = need('text'), lesson = need('lesson');
  logEvent({ e: 'resolve', sid: s.sid, text, lesson });
  updateCase(s.sid, { outcome: 'hit', resolved: text, lesson });
  console.log('✓ 已记录：最后是什么方向、教训是什么');

} else if (cmd === 'summary') {
  const s = requireSession();
  const rows = readJsonl(PROJ).filter((r) => r.sid === s.sid);
  const asks = rows.filter((r) => r.e === 'ask').length;
  const asked = rows.filter((r) => r.e === 'ask');
  const answered = asked.filter((r) => r.a).length;
  const fb = rows.filter((r) => r.e === 'feedback');
  const overall = fb.filter((r) => r.kind === 'overall').length;
  const local = fb.filter((r) => r.kind === 'local').length;
  const d = rows.findIndex((r) => r.e === 'deliver');
  const firstAfter = d >= 0 ? rows.slice(d).find((r) => r.e === 'feedback') : null;
  const hit = !d || d < 0 ? '还没交付' : !firstAfter ? '未知（用户还没反馈）' : firstAfter.kind === 'overall' ? '否' : '是';
  const lines = [
    `项目：${projName()}`,
    `用户的话：${cut(s.brief, 80)}`,
    `提问次数：${asks}（用户答了 ${answered}）`,
    `首稿方向命中：${hit}`,
    `整体反馈次数：${overall}`,
    `局部修改占比：${fb.length ? Math.round((local / fb.length) * 100) + '%' : '—'}`,
    `交付次数：${rows.filter((r) => r.e === 'deliver').length}，自检次数：${rows.filter((r) => r.e === 'selfcheck').length}`,
  ];
  console.log(lines.join('\n'));

} else if (cmd === 'mark') {
  // 内部用：记一条"模型读了多少字符"。--what 名字 --n 字符数
  const s = session();
  logEvent({ e: 'read', sid: s?.sid ?? null, what: need('what'), n: Number(need('n')) });
  process.exit(0);

} else if (cmd === 'read') {
  // 按需读 skill 里的一个文件，顺便记下读了多少。路径相对 skill 目录
  if (!SKILL_DIR) die('read 要通过干活 skill 的入口脚本调用');
  const rel = opts.file ?? raw[0];
  if (!rel) die('read 需要一个 skill 里的相对路径，例如 read data/conventions.json');
  const f = resolve(SKILL_DIR, rel);
  if (!f.startsWith(resolve(SKILL_DIR) + '/')) die('只能读 skill 目录里的文件');
  if (!existsSync(f)) die(`没有这个文件：${rel}`);
  const text = readFileSync(f, 'utf8');
  logEvent({ e: 'read', sid: session()?.sid ?? null, what: `read ${rel}`, n: text.length });
  out(text);

} else if (cmd === 'cost') {
  const s = session();
  // 协议是宿主加载的，脚本看不到，按文件大小算；其余都是通过 <m> 读的，有记录
  const fixed = [['SKILL.md（协议）', 'SKILL.md']];
  const L = ['【从开工到写代码，模型读了多少】'];
  let total = 0;
  for (const [label, rel] of fixed) {
    const f = SKILL_DIR ? join(SKILL_DIR, rel) : null;
    const n = f && existsSync(f) ? readFileSync(f, 'utf8').length : 0;
    total += n; L.push(`  ${label}：${n}`);
  }
  const reads = s ? readJsonl(PROJ).filter((r) => r.sid === s.sid && r.e === 'read') : [];
  const agg = {};
  for (const r of reads) agg[r.what] = (agg[r.what] ?? 0) + r.n;
  for (const [k, v] of Object.entries(agg)) { total += v; L.push(`  ${k}：${v}`); }
  const budgetNote = `（预算 ${BUDGET}，按中文一个字约一个 token 粗估；真实 token 数没法在这里量，未验证）`;
  L.push(`合计：${total} ${total > BUDGET ? `✗ 超了 ${total - BUDGET}` : `✓ 还剩 ${BUDGET - total}`}${budgetNote}`);
  console.log(L.join('\n'));

// ---------- 记忆 ----------
} else if (cmd === 'recall') {
  ensureMem();
  const brief = need('brief');
  const q = tokens(brief);
  const rs = rules(), ps = prefs(), cs0 = convs();
  const nProj = Object.keys(readJson(F.projects, {})).length;
  const L = [];
  L.push(`【记忆库】${nProj ? `这是你的第 ${nProj} 个项目` : '第一次用，还没有记录'}`);
  if (rs.length) { L.push('用户立的规矩：'); rs.forEach((r, i) => L.push(`  ${i + 1}. ${r.text}`)); }
  if (ps.length) {
    // 用久了偏好会很多：先列说得最多的，最多 8 条，其余让模型按需 show
    const top = [...ps].sort((a, b) => (b.count ?? 1) - (a.count ?? 1));
    L.push('这个用户的偏好：');
    for (const p of top.slice(0, 8)) L.push(`  - [${p.id}] ${p.text}（${p.count > 1 ? `说过 ${p.count} 次` : '说过 1 次'}）`);
    if (top.length > 8) L.push(`  （还有 ${top.length - 8} 条没列出，用 show 看全部）`);
  }
  if (cs0.length) { L.push('他自己加的惯例：'); for (const c of cs0.slice(0, 6)) L.push(`  - [${c.id}] ${c.text}`); if (cs0.length > 6) L.push(`  （还有 ${cs0.length - 6} 条）`); }
  const cs = readJsonl(F.cases).filter((c) => c.brief !== brief);
  const scored = cs.map((c) => ({ c, s: overlap(q, tokens([c.brief, ...(c.signals ?? []), c.resolved, c.lesson].join(' '))) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3);
  if (scored.length) {
    L.push('相似的做法（先看结果，再看教训）：');
    for (const { c } of scored) L.push(`  - 「${cut(c.brief, 50)}」→ ${[c.aesthetic, ...(c.genres ?? [])].filter(Boolean).join(' + ') || '没定方向'}；结果：${c.outcome === 'hit' ? '命中' : c.outcome === 'miss' ? '偏了' : '还没结论'}${c.lesson ? `；教训：${cut(c.lesson, 110)}` : ''}`);
  }
  const ls = readJsonl(F.lessons).map((l) => ({ l, s: overlap(q, tokens([l.problem, l.cause, l.fix, ...(l.tags ?? [])].join(' '))) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3);
  if (ls.length) { L.push('相关的坑：'); for (const { l } of ls) L.push(`  - [${l.id}] ${cut(l.problem, 60)} → ${cut(l.fix, 90)}`); }
  if (rs.length + ps.length + scored.length + ls.length === 0) L.push('没有相关记录。照常做；做完后用 remember 把偏好和坑写回来');
  L.push('（记忆和这次的话冲突时，以这次的话为准，并更新那条记忆。用户说"看看你记了什么"就运行 show）');
  const text = L.join('\n');
  const s = session();
  if (s) logEvent({ e: 'read', sid: s.sid, what: 'recall（记忆库）', n: text.length + 30 });
  out(text);

} else if (cmd === 'remember') {
  ensureMem();
  const kind = need('kind');
  if (kind === 'preference') {
    const text = need('text').trim();
    const prof = readJson(F.profile, { preferences: [] });
    prof.preferences ??= [];
    const key = norm(text);
    let p = prof.preferences.find((x) => norm(x.text) === key);
    if (!p) { p = { id: 'p' + sid(), text, active: true, firstSeen: now(), lastSeen: now(), count: 0, projects: [] }; prof.preferences.push(p); }
    p.active = true; p.lastSeen = now(); p.count = (p.count ?? 0) + 1;
    if (!p.projects.includes(projName())) p.projects.push(projName());
    if (opts.replaces) {
      const old = prof.preferences.find((x) => x.id === opts.replaces || (x.id !== p.id && norm(x.text).includes(norm(opts.replaces))));
      if (old) { old.active = false; old.replacedBy = p.id; }
      else console.error(`（没找到要替换的偏好：${opts.replaces}）`);
    }
    writeFileSync(F.profile, JSON.stringify(prof, null, 2) + '\n');
    console.log(`✓ 记住了偏好 [${p.id}]：${text}。记得告诉用户`);
  } else if (kind === 'lesson') {
    const row = { id: 'l' + sid(), time: now(), project: projName(), problem: need('problem'), cause: need('cause'), fix: need('fix'), tags: list(opts.tags) };
    appendFileSync(F.lessons, JSON.stringify(row) + '\n');
    console.log(`✓ 记住了这个坑 [${row.id}]`);
  } else die('remember 需要 --kind preference 或 lesson');

} else if (cmd === 'forget') {
  ensureMem();
  const id = process.argv[3];
  if (!id) die('forget 需要一个 id，例如 forget pabc123');
  let hit = '';
  const prof = readJson(F.profile, { preferences: [] });
  const p = (prof.preferences ?? []).find((x) => x.id === id);
  if (p) { p.active = false; writeFileSync(F.profile, JSON.stringify(prof, null, 2) + '\n'); hit = '偏好'; }
  const rs = readJson(F.rules, { rules: [] }).rules ?? [];
  if (rs.some((r) => r.id === id)) { writeRules(rs.filter((r) => r.id !== id)); writeAlways(); hit = '规矩'; }
  const cv = readJson(F.conventions, { conventions: [] }).conventions ?? [];
  if (cv.some((c) => c.id === id)) { writeFileSync(F.conventions, JSON.stringify({ conventions: cv.filter((c) => c.id !== id) }, null, 2) + '\n'); hit = '惯例'; }
  const cands = readJsonl(F.candidates);
  if (cands.some((c) => c.id === id)) { writeJsonl(F.candidates, cands.filter((c) => c.id !== id)); hit = '候选'; }
  const ls = readJsonl(F.lessons); if (ls.some((l) => l.id === id)) { writeJsonl(F.lessons, ls.filter((l) => l.id !== id)); hit = '坑'; }
  const cs = readJsonl(F.cases); if (cs.some((c) => c.id === id)) { writeJsonl(F.cases, cs.filter((c) => c.id === id)); hit = '案例'; }
  if (!hit) die(`没有这一条：${id}。用 show 看有哪些`);
  console.log(`✓ 已删掉这条${hit}：${id}`);

} else if (cmd === 'show') {
  ensureMem();
  const L = [`记忆库在 ${MEM}`, '', '用户立的规矩：'];
  const rs = rules();
  if (rs.length) rs.forEach((r, i) => L.push(`  ${i + 1}. [${r.id}] ${r.text}`)); else L.push('  （还没有）');
  L.push('', '偏好：');
  for (const p of readJson(F.profile, { preferences: [] }).preferences ?? []) L.push(`  ${p.active ? ' ' : '×'} [${p.id}] ${p.text}（${p.count} 次，${(p.projects ?? []).join('、')}）`);
  const cv = readJson(F.conventions, { conventions: [] }).conventions ?? [];
  L.push('', `你自己加的惯例（${cv.filter((c) => c.active !== false).length}）：`);
  for (const c of cv) L.push(`  ${c.active !== false ? ' ' : '×'} [${c.id}] ${c.text}`);
  const ls = readJsonl(F.lessons), cs = readJsonl(F.cases), pj = readJson(F.projects, {});
  L.push('', `踩过的坑（${ls.length}）：`);
  for (const l of ls) L.push(`  [${l.id}] ${l.problem} → ${l.fix}`);
  const open = readJsonl(F.candidates).filter((c) => c.status === 'open');
  L.push('', `待你点头的候选（${open.length}）：`);
  for (const c of open) L.push(`  [${c.id}] (${c.kind}) ${c.text}${c.count > 1 ? `（出现 ${c.count} 次）` : ''}`);
  L.push('', `做过的项目（${Object.keys(pj).length}）：`);
  for (const [k, p] of Object.entries(pj)) L.push(`  [${k}] ${p.project}：${cut(p.brief, 50)} → ${p.aesthetic ?? '—'}`);
  L.push('', `判断案例（${cs.length}）：`);
  for (const c of cs) L.push(`  [${c.id}] ${cut(c.brief, 40)} → ${c.outcome === 'hit' ? '命中' : c.outcome === 'miss' ? '偏了' : '进行中'}`);
  L.push('', '说"忘掉 [id]"可以删掉任何一条。这些都是本机的纯文本文件，可以直接打开改。');
  console.log(L.join('\n'));

// ---------- 自进化 ----------
} else if (cmd === 'propose') {
  ensureMem();
  const kind = opts.kind;
  if (!['preference', 'rule', 'convention'].includes(kind)) die('propose 需要 --kind preference / rule / convention');
  const text = cut(need('text').replace(/\s+/g, ' '), kind === 'rule' ? RULE_LEN : 120).replace(/…$/, '').trim();
  if (!text) die('候选内容不能为空');
  const why = opts.why ?? '';
  const key = norm(text);
  const alike = (a, b) => { const x = norm(a), y = norm(b); return x === y || (y.length >= 6 && x.includes(y)) || (x.length >= 6 && y.includes(x)); };
  const dup =
    (kind === 'preference' && prefs().some((p) => alike(p.text, text))) ||
    (kind === 'rule' && rules().some((r) => alike(r.text, text))) ||
    (kind === 'convention' && convs().some((c) => alike(c.text, text)));
  if (dup) { console.log(`✓ 记忆里已经有这条${{ preference: '偏好', rule: '规矩', convention: '惯例' }[kind]}，不用再提`); process.exit(0); }
  const rows = readJsonl(F.candidates);
  const same = rows.find((c) => c.kind === kind && c.status === 'open' && norm(c.text) === key);
  if (same) { same.count = (same.count ?? 1) + 1; same.last = now(); writeJsonl(F.candidates, rows); console.log(`✓ 这条候选上次提过，已累加到 ${same.count} 次 [${same.id}]：${text}`); process.exit(0); }
  const row = { id: 'c' + sid(), kind, text, why, project: projName(), time: now(), last: now(), count: 1, status: 'open' };
  rows.push(row); writeJsonl(F.candidates, rows);
  console.log(`✓ 已提候选 [${row.id}]（${{ preference: '偏好', rule: '规矩', convention: '惯例' }[kind]}）：${text}。收尾时问用户要不要记住`);

} else if (cmd === 'candidates') {
  ensureMem();
  const open = readJsonl(F.candidates).filter((c) => c.status === 'open');
  const L = [`待用户点头的候选（${open.length}）——用大白话问一遍，他同意就 accept，不要就 reject：`];
  open.slice(0, 9).forEach((c) => L.push(`  [${c.id}] ${c.kind}｜${c.text}${c.count > 1 ? `（出现 ${c.count} 次）` : ''}`));
  console.log(L.join('\n'));

} else if (cmd === 'accept') {
  ensureMem();
  const id = process.argv[3];
  if (!id) die('accept 需要候选 id，先用 candidates 看');
  const rows = readJsonl(F.candidates);
  const c = rows.find((x) => x.id === id && x.status === 'open');
  if (!c) die(`没有这条待定的候选：${id}`);
  if (c.kind === 'preference') {
    const prof = readJson(F.profile, { preferences: [] });
    prof.preferences ??= [];
    let p = prof.preferences.find((x) => norm(x.text) === norm(c.text));
    if (!p) { p = { id: 'p' + sid(), text: c.text, active: true, firstSeen: now(), lastSeen: now(), count: 1, projects: [c.project] }; prof.preferences.push(p); }
    p.active = true; p.lastSeen = now();
    writeFileSync(F.profile, JSON.stringify(prof, null, 2) + '\n');
    c.to = p.id;
  } else if (c.kind === 'rule') {
    const rs = readJson(F.rules, { rules: [] }).rules ?? [];
    if (rs.filter((r) => r.active !== false).length >= MAX_RULES) die(`规矩最多 ${MAX_RULES} 条，先忘掉一条再记`);
    const r = { id: 'r' + sid(), text: c.text, why: c.why, time: now(), project: c.project, active: true };
    rs.push(r); writeRules(rs); writeAlways();
    c.to = r.id;
  } else if (c.kind === 'convention') {
    const cv = readJson(F.conventions, { conventions: [] }).conventions ?? [];
    const v = { id: 'v' + sid(), text: c.text, why: c.why, time: now(), project: c.project, active: true };
    cv.push(v); writeFileSync(F.conventions, JSON.stringify({ conventions: cv }, null, 2) + '\n');
    c.to = v.id;
  }
  c.status = 'accepted'; c.decided = now();
  writeJsonl(F.candidates, rows);
  const msg = `✓ 已生效 [${c.to}]：${c.text}`;
  console.log(c.kind === 'rule' ? msg + '（已写进每次加载的那一段）' : msg);

} else if (cmd === 'reject') {
  ensureMem();
  const id = process.argv[3];
  if (!id) die('reject 需要候选 id，先用 candidates 看');
  const rows = readJsonl(F.candidates);
  const c = rows.find((x) => x.id === id && x.status === 'open');
  if (!c) die(`没有这条待定的候选：${id}`);
  c.status = 'rejected'; c.decided = now();
  writeJsonl(F.candidates, rows);
  console.log(`✓ 已放弃这条候选：${c.text}`);

} else if (cmd === 'rule') {
  ensureMem();
  const sub = raw[0];
  const rs = readJson(F.rules, { rules: [] }).rules ?? [];
  if (sub === 'list') {
    if (!rs.length) console.log('还没有规矩');
    else rs.forEach((r, i) => console.log(`${r.active === false ? '×' : ' '} ${i + 1}. [${r.id}] ${r.text}`));
  } else if (sub === 'add') {
    const text = cut(need('text').replace(/\s+/g, ' '), RULE_LEN).replace(/…$/, '').trim();
    if (!text) die('规矩不能为空');
    if (rs.filter((r) => r.active !== false).length >= MAX_RULES) die(`规矩最多 ${MAX_RULES} 条，先 rule remove 一条`);
    const r = { id: 'r' + sid(), text, why: opts.why ?? '', time: now(), project: projName(), active: true };
    rs.push(r); writeRules(rs); const on = writeAlways();
    console.log(`✓ 规矩已记 [${r.id}]：${text}${on ? '。运行 refresh 同步到各 AI 工具' : '（还没安装到 AI 工具，运行 install.sh 后才会每次加载）'}`);
  } else if (sub === 'remove') {
    const id = process.argv[3];
    if (!id) die('rule remove 需要 id');
    if (!rs.some((r) => r.id === id)) die(`没有这条：${id}`);
    writeRules(rs.filter((r) => r.id !== id)); writeAlways();
    console.log(`✓ 已删掉这条规矩：${id}`);
  } else die('用法：rule list | rule add --text "…" [--why "…"] | rule remove <id>');

} else if (cmd === 'refresh') {
  // 把每次加载的那一段同步到各 AI 工具
  ensureMem();
  writeAlways();
  const inst = readJson(F.install, {});
  const L = [`✓ 已重写 ${join(CORE, 'ALWAYS.md')}（${alwaysText().length} 字符）`];
  for (const [tool, st] of Object.entries(inst.tools ?? {})) {
    for (const a of st.always ?? []) {
      if (a.mode === 'copy' && existsSync(a.file)) { writeBlock(a.file, alwaysText()); L.push(`✓ ${st.label ?? tool}：已更新 ${a.file}`); }
      else if (a.mode === 'import') L.push(`✓ ${st.label ?? tool}：引用的是同一个文件，不用改`);
    }
  }
  L.push('（豆包、Claude Code 这些要开新对话才会读到新的那一段）');
  console.log(L.join('\n'));

} else if (cmd === 'inject') {
  ensureMem();
  process.stdout.write(alwaysText() + '\n');

} else if (cmd === 'doctor') {
  ensureMem();
  const inst = readJson(F.install, {});
  const L = [`SayMake 自检  记忆库：${MEM}`];
  const cur = join(HOME, 'current');
  L.push(`${existsSync(cur) ? '✓' : '✗'} 安装目录：${cur}${existsSync(cur) ? '' : '（先运行 install.sh）'}`);
  if (existsSync(cur)) L.push(`${existsSync(join(cur, 'core', 'ALWAYS.md')) ? '✓' : '✗'} 每次加载的文件：core/ALWAYS.md`);
  for (const [tool, st] of Object.entries(inst.tools ?? {})) {
    let skills = 0;
    for (const sd of st.skillsDirs ?? []) for (const s of st.skills ?? []) {
      const p = join(sd, s);
      skills++;
      L.push(`${existsSync(join(p, 'SKILL.md')) ? '✓' : '✗'} ${st.label ?? tool}：skill「${s}」${existsSync(p) && !existsSync(join(p, 'SKILL.md')) ? '目录在但缺 SKILL.md' : ''}`);
    }
    if (!skills) L.push(`✗ ${st.label ?? tool}：安装记录在，但没有 skill`);
    for (const a of st.always ?? []) {
      if (!existsSync(a.file)) { L.push(`✗ ${st.label ?? tool}：每次加载的文件不见了（${a.file}），运行 install.sh`); continue; }
      const t = readFileSync(a.file, 'utf8');
      if (a.mode === 'import') {
        const ok = t.includes('@' + join(CORE, 'ALWAYS.md'));
        L.push(`${ok ? '✓' : '✗'} ${st.label ?? tool}：每次加载（${a.file} 引用 ALWAYS.md）${ok ? '——文件已到位，是否真被读到' + (st.verified ? '：' + st.verified : '未验证') : '，引用丢了，运行 install.sh'}`);
      } else {
        const ok = extractBlock(t, 'saymake') === alwaysText();
        L.push(`${ok ? '✓' : '✗'} ${st.label ?? tool}：每次加载（${a.file} 里的段落${t.includes('saymake:start') && !ok ? '过期了，运行 refresh' : ''}）`);
      }
    }
  }
  if (!Object.keys(inst.tools ?? {}).length) L.push('✗ 还没安装到任何 AI 工具：在仓库根目录运行 bash install.sh');
  const pj = readJson(F.projects, {});
  L.push(`记忆：规矩 ${rules().length}/${MAX_RULES}，偏好 ${prefs().length}，坑 ${readJsonl(F.lessons).length}，项目 ${Object.keys(pj).length}，候选 ${readJsonl(F.candidates).filter((c) => c.status === 'open').length} 条待定`);
  console.log(L.join('\n'));

} else if (cmd === 'status') {
  ensureMem();
  const pj = readJson(F.projects, {});
  console.log(`规矩 ${rules().length}/${MAX_RULES}｜偏好 ${prefs().length}｜惯例 ${convs().length}｜坑 ${readJsonl(F.lessons).length}｜项目 ${Object.keys(pj).length}｜候选 ${readJsonl(F.candidates).filter((c) => c.status === 'open').length} 条待定`);

} else {
  console.error(`用法见文件开头。常用：
  recall --brief "…"                      开工时：带出规矩、偏好、相似案例、相关的坑
  start --brief "…" | judge … | ask … | generate --file … | selfcheck --ok true --notes "…" | deliver
  feedback --kind overall|local --text "…" | resolve --text "…" --lesson "…" | summary | cost
  remember --kind preference|lesson … | propose --kind preference|rule|convention --text "…" | candidates | accept <id> | reject <id>
  rule list|add|remove | forget <id> | show | inject | refresh | doctor | status`);
  process.exit(1);
}

// ---------- 内部小函数（函数声明会提升，上面各分支可以先用） ----------
function readFileSyncSafe(f) { return existsSync(f) ? readFileSync(f, 'utf8') : ''; }
function extractBlock(text, name) {
  // 连首尾标记一起取，和 alwaysText() 的输出逐字可比
  const m = text.match(new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`));
  return m ? m[0] : '';
}
function writeBlock(file, block, backup) {
  const old = readFileSyncSafe(file);
  if (old.includes('<!-- saymake:start -->')) {
    const next = old.replace(/<!-- saymake:start -->[\s\S]*?<!-- saymake:end -->/, () => block);
    writeFileSync(file, next);
  } else {
    if (backup) { mkdirSync(dirname(backup), { recursive: true }); writeFileSync(backup, old); }
    writeFileSync(file, old + (old.endsWith('\n') || !old ? '' : '\n') + '\n' + block + '\n');
  }
}
