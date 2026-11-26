#!/usr/bin/env node
// 记录与经验库。两处存储：
//   项目日志  <项目>/.saymake/session.jsonl      这一次发生了什么，用来算指标
//   经验库    ~/.saymake/memory/                 这个用户的偏好、案例、踩过的坑，跨项目、不随 skill 升级丢失
//            （环境变量 SAYMAKE_HOME 可改位置）
//
// 一个项目里按顺序用：
//   start --brief "用户的话"                      开工
//   judge --aesthetic <id> --genre <id,id> --mechanics <id,id> --audience <id> --why "依据"
//   ask --question "…" --answer "…"                问了什么、用户怎么答
//   generate --file <路径>                        写出了游戏文件
//   selfcheck --ok true|false --notes "看到了什么" 看截图后的自检
//   deliver                                       交付。上一次 generate 之后没有 ok 的 selfcheck 会被拒绝
//   feedback --kind overall|local --text "…"      用户反馈：整体不对 / 指哪改哪
//   resolve --text "最后是什么方向" --lesson "教训"  整体反馈解决后写明
//   summary                                       四个指标
//
// 经验库（任何项目都能用）：
//   recall --brief "用户的话"        给模型看：偏好、相似案例、相关的坑、做过几个项目
//   remember --kind preference --text "…"  [--replaces <id 或原句>]
//   remember --kind lesson --problem "…" --cause "…" --fix "…" [--tags a,b]
//   forget <id>                      删一条
//   show                             给人看全部

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const HOME = process.env.SAYMAKE_HOME || join(homedir(), '.saymake');
const MEM = join(HOME, 'memory');
const projDir = process.cwd();
const PROJ = join(projDir, '.saymake', 'session.jsonl');
const F = { profile: join(MEM, 'profile.json'), cases: join(MEM, 'cases.jsonl'), lessons: join(MEM, 'lessons.jsonl'), projects: join(MEM, 'projects.json') };

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

// 中文按两字一组切，英文按单词切。词面相似度用，不做向量
function tokens(s) {
  const t = new Set();
  const ascii = String(s ?? '').toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  ascii.forEach((w) => t.add(w));
  const cjk = String(s ?? '').replace(/[^一-鿿]+/g, '');
  for (let i = 0; i < cjk.length - 1; i++) t.add(cjk.slice(i, i + 2));
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

// ---------- 项目内的命令 ----------
if (cmd === 'start') {
  const brief = need('brief');
  ensureMem();
  const s = logEvent({ e: 'start', sid: sid(), brief, project: projName() });
  const cid = s.sid;
  updateCase(cid, {}); // 不存在时追加
  const rows = readJsonl(F.cases);
  if (!rows.some((r) => r.id === cid)) {
    rows.push({ id: cid, time: now(), project: projName(), brief, aesthetic: null, genres: [], mechanics: [], audience: null, why: '', asked: [], outcome: 'open', feedback: [], lesson: '' });
    writeJsonl(F.cases, rows);
  }
  const pj = readJson(F.projects, {});
  pj[cid] = { time: now(), dir: projDir, project: projName(), brief };
  writeFileSync(F.projects, JSON.stringify(pj, null, 2) + '\n');
  console.log(`✓ 开工已记录。经验库：${MEM}`);

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
  const out = [
    `项目：${projName()}`,
    `用户的话：${cut(s.brief, 80)}`,
    `提问次数：${asks}（用户答了 ${answered}）`,
    `首稿方向命中：${hit}`,
    `整体反馈次数：${overall}`,
    `局部修改占比：${fb.length ? Math.round((local / fb.length) * 100) + '%' : '—'}`,
    `交付次数：${rows.filter((r) => r.e === 'deliver').length}，自检次数：${rows.filter((r) => r.e === 'selfcheck').length}`,
  ];
  console.log(out.join('\n'));

// ---------- 经验库 ----------
} else if (cmd === 'recall') {
  ensureMem();
  const brief = need('brief');
  const q = tokens(brief);
  const prefs = (readJson(F.profile, { preferences: [] }).preferences ?? []).filter((p) => p.active);
  const nProj = Object.keys(readJson(F.projects, {})).length;
  const L = [];
  L.push(`【经验库】${nProj ? `这是你的第 ${nProj} 个项目` : '第一次用，还没有记录'}`);
  if (prefs.length) {
    L.push('这个用户的偏好：');
    for (const p of prefs) L.push(`  - [${p.id}] ${p.text}（${p.count > 1 ? `说过 ${p.count} 次` : '说过 1 次'}）`);
  }
  const cs = readJsonl(F.cases).filter((c) => c.brief !== brief);
  const scored = cs.map((c) => ({ c, s: overlap(q, tokens([c.brief, ...(c.signals ?? []), c.resolved, c.lesson].join(' '))) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3);
  if (scored.length) {
    L.push('相似的做法（先看结果，再看教训）：');
    for (const { c } of scored) L.push(`  - 「${cut(c.brief, 50)}」→ ${[c.aesthetic, ...(c.genres ?? [])].filter(Boolean).join(' + ') || '没定方向'}；结果：${c.outcome === 'hit' ? '命中' : c.outcome === 'miss' ? '偏了' : '还没结论'}${c.lesson ? `；教训：${cut(c.lesson, 110)}` : ''}`);
  }
  const ls = readJsonl(F.lessons).map((l) => ({ l, s: overlap(q, tokens([l.problem, l.cause, l.fix, ...(l.tags ?? [])].join(' '))) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3);
  if (ls.length) {
    L.push('相关的坑：');
    for (const { l } of ls) L.push(`  - [${l.id}] ${cut(l.problem, 60)} → ${cut(l.fix, 90)}`);
  }
  if (prefs.length + scored.length + ls.length === 0) L.push('没有相关记录。照常判断；做完后用 remember 把偏好和坑写回来');
  L.push(`（偏好和这次的话冲突时，以这次的话为准，并更新偏好。位置：${MEM}）`);
  const text = L.join('\n');
  console.log(text + `\n[size ${text.length} 字符]`);

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
    console.log(`✓ 记住了偏好 [${p.id}]：${text}`);
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
  const ls = readJsonl(F.lessons); if (ls.some((l) => l.id === id)) { writeJsonl(F.lessons, ls.filter((l) => l.id !== id)); hit = '坑'; }
  const cs = readJsonl(F.cases); if (cs.some((c) => c.id === id)) { writeJsonl(F.cases, cs.filter((c) => c.id !== id)); hit = '案例'; }
  if (!hit) die(`没有这一条：${id}。用 show 看有哪些`);
  console.log(`✓ 已删掉这条${hit}：${id}`);

} else if (cmd === 'show') {
  ensureMem();
  const L = [`经验库在 ${MEM}`, '', '偏好：'];
  for (const p of readJson(F.profile, { preferences: [] }).preferences ?? []) L.push(`  ${p.active ? ' ' : '×'} [${p.id}] ${p.text}（${p.count} 次，${(p.projects ?? []).join('、')}）`);
  const ls = readJsonl(F.lessons), cs = readJsonl(F.cases), pj = readJson(F.projects, {});
  L.push('', `踩过的坑（${ls.length}）：`);
  for (const l of ls) L.push(`  [${l.id}] ${l.problem} → ${l.fix}`);
  L.push('', `做过的项目（${Object.keys(pj).length}）：`);
  for (const p of Object.values(pj)) L.push(`  [${Object.keys(pj).find((k) => pj[k] === p)}] ${p.project}：${cut(p.brief, 50)} → ${p.aesthetic ?? '—'}`);
  L.push('', `判断案例（${cs.length}）：`);
  for (const c of cs) L.push(`  [${c.id}] ${cut(c.brief, 40)} → ${c.outcome === 'hit' ? '命中' : c.outcome === 'miss' ? '偏了' : '进行中'}`);
  L.push('', '说"忘掉 [id]"可以删掉任何一条。这些都是本机的纯文本文件，可以直接打开改。');
  console.log(L.join('\n'));

} else {
  console.error(`用法见文件开头。常用：
  start --brief "…" | judge --aesthetic … --genre … --mechanics … --audience … --why "…"
  ask --question "…" --answer "…" | generate --file … | selfcheck --ok true --notes "…" | deliver
  feedback --kind overall|local --text "…" | resolve --text "…" --lesson "…" | summary
  recall --brief "…" | remember --kind preference|lesson … | forget <id> | show`);
  process.exit(1);
}
