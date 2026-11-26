#!/usr/bin/env node
// 惯例库校验：JSON 合法、索引指向的文件存在、id 唯一、必填字段齐、跨库引用有效、source 带出处。
// 用法：node scripts/check_library.mjs [--data <目录>]
// 退出码 0 = 通过；1 = 有错误。改库之后、提 PR 之前跑一遍。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dataArgIdx = args.indexOf('--data');
const dataDir = dataArgIdx >= 0 ? resolve(args[dataArgIdx + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const ID = /^[a-z0-9-]+$/;

function load(name) {
  const p = join(dataDir, name);
  if (!existsSync(p)) { err(name, '文件不存在'); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { err(name, `JSON 解析失败：${e.message}`); return null; }
}

const SOURCE_TYPES = new Set(['article', 'paper', 'book', 'doc', 'internal', 'dogfood']);
const NEEDS_URL = new Set(['article', 'paper', 'book', 'doc']);

function checkSource(file, entry, where, optional = false) {
  const s = entry.source;
  if (!s) { if (!optional) err(file, `${where} 缺 source`); return; }
  if (typeof s !== 'object') return err(file, `${where} source 必须是对象`);
  if (!SOURCE_TYPES.has(s.type)) err(file, `${where} source.type 必须是 ${[...SOURCE_TYPES].join('/')}`);
  if (!s.ref || typeof s.ref !== 'string' || !s.ref.trim()) err(file, `${where} source.ref 不能为空`);
  else if (NEEDS_URL.has(s.type) && !/^https?:\/\//.test(s.ref)) err(file, `${where} source.type=${s.type} 时 ref 应为公开 URL`);
}

// 逐条检查：必填字段、id 格式与唯一、source
function checkList(file, list, required, label, ids, opts = {}) {
  if (!Array.isArray(list)) { err(file, `${label} 必须是数组`); return []; }
  list.forEach((e, i) => {
    const where = `${label}[${i}]${e && e.id ? `(${e.id})` : ''}`;
    if (!e || typeof e !== 'object') return err(file, `${where} 不是对象`);
    for (const k of required) if (e[k] === undefined || e[k] === null || e[k] === '') err(file, `${where} 缺字段 ${k}`);
    if (e.id) {
      if (!ID.test(e.id)) err(file, `${where} id 只能是小写字母、数字、连字符`);
      if (ids.has(e.id)) err(file, `${where} id 重复`);
      ids.add(e.id);
    }
    checkSource(file, e, where, opts.sourceOptional);
  });
  return Array.isArray(list) ? list : [];
}

// 值可能是 id、id 数组或一段自由文字（早期案例）。只有长得像 id 的才校验引用
function refCheck(file, val, ids, where) {
  const vals = Array.isArray(val) ? val : (typeof val === 'string' ? val.split(/[，,\s]+/) : []);
  for (const v of vals) if (ID.test(v) && !ids.has(v)) err(file, `${where} 引用了不存在的条目 ${v}`);
}

const conv = load('conventions.json');

// ---- 入口与索引 ----
const files = {};
if (conv) {
  if (!/^\d+\.\d+\.\d+$/.test(conv.version ?? '')) err('conventions.json', 'version 应为 x.y.z');
  if (!conv.libraries || typeof conv.libraries !== 'object') err('conventions.json', '缺 libraries 索引');
  else {
    for (const [k, v] of Object.entries(conv.libraries)) {
      if (k.startsWith('$')) continue;
      const f = typeof v === 'string' ? v : v?.file;
      if (!f) { err('conventions.json', `libraries.${k} 需要 { file, note }`); continue; }
      if (!existsSync(join(dataDir, f))) err('conventions.json', `libraries.${k} 指向的文件不存在：${f}`);
      else files[k] = f;
    }
  }
  for (const k of ['start', 'score', 'restart']) if (!conv.contract?.markers?.[k]) err('conventions.json', `contract.markers 缺 ${k}`);
  for (const k of ['start', 'restart', 'getScore', 'isRunning']) if (!conv.contract?.api?.methods?.[k]) err('conventions.json', `contract.api.methods 缺 ${k}`);
  if (!Array.isArray(conv.acceptance?.static) || !Array.isArray(conv.acceptance?.browser)) err('conventions.json', 'acceptance.static / browser 必须是数组');
}
if (errors.length) done();

const aes = load(files.aesthetics), mec = load(files.mechanics), typ = load(files.typography);
const gen = load(files.genres ?? 'genres.json'), aud = load(files.audiences ?? 'audiences.json'), cases = load(files.cases ?? 'cases.json');

// ---- 审美 ----
const aesIds = new Set();
const aesList = checkList(files.aesthetics, aes?.directions, ['id', 'name', 'feelsLike', 'fits', 'avoid', 'palette', 'typography', 'shapes', 'motion', 'assets', 'pitfalls'], 'directions', aesIds);
for (const d of aesList) {
  const p = d.palette;
  if (p && (typeof p !== 'object' || !['bg', 'ink', 'accent', 'rule'].every((k) => typeof p[k] === 'string'))) err(files.aesthetics, `directions(${d.id}) palette 需要 bg/ink/accent/rule 四项`);
}

// ---- 机制 ----
const mecIds = new Set();
checkList(files.mechanics, mec?.patterns, ['id', 'name', 'fits', 'skip', 'how', 'source'], 'patterns', mecIds);
checkList(files.mechanics, mec?.antiPatterns ?? mec?.['anti-patterns'], ['id', 'name', 'why', 'source'], 'anti-patterns', new Set());
if (mec) {
  if (!mec.byGameType || typeof mec.byGameType !== 'object') err(files.mechanics, '缺 byGameType');
  else for (const [type, refs] of Object.entries(mec.byGameType)) {
    if (type.startsWith('$')) continue;
    if (!Array.isArray(refs)) { err(files.mechanics, `byGameType.${type} 必须是数组`); continue; }
    for (const r of refs) if (!mecIds.has(r)) err(files.mechanics, `byGameType.${type} 引用了不存在的机制 ${r}`);
  }
}

// ---- 字体 ----
checkList(files.typography, typ?.directions, ['id', 'name', 'stack', 'feel', 'use', 'source'], 'directions', new Set());
for (const d of typ?.directions ?? []) {
  d.use?.split(',').map((s) => s.trim()).filter(Boolean).forEach((tok) => {
    if (aesIds.size && ![...aesIds].some((id) => tok === id || tok.startsWith(id + ' '))) err(files.typography, `directions(${d.id}).use 里的 "${tok}" 不是 aesthetics 里的方向 id`);
  });
  if (d.stack && /url\(|@font-face|https?:\/\//.test(d.stack)) err(files.typography, `directions(${d.id}) 字体栈不能引用外部字体文件`);
}

// ---- 玩法 ----
const genIds = new Set();
for (const g of checkList(files.genres, gen?.genres, ['id', 'name', 'like', 'oneLine', 'build', 'defaults', 'dials', 'mechanics', 'audiences', 'pitfalls'], 'genres', genIds)) {
  refCheck(files.genres, g.mechanics, mecIds, `genres(${g.id}).mechanics`);
  if (!Array.isArray(g.pitfalls) || !g.pitfalls.length) err(files.genres, `genres(${g.id}) pitfalls 至少一条`);
}

// ---- 受众 ----
const audIds = new Set();
for (const a of checkList(files.audiences, aud?.audiences, ['id', 'name', 'changes', 'note'], 'audiences', audIds)) {
  if (a.changes && typeof a.changes !== 'object') err(files.audiences, `audiences(${a.id}) changes 必须是对象`);
}
for (const g of gen?.genres ?? []) refCheck(files.genres, g.audiences, audIds, `genres(${g.id}).audiences`);

// ---- 案例 ----
const caseIds = new Set();
// 案例本身就是出处（真实对话），不强制 source
for (const c of checkList(files.cases, cases?.cases, ['id', 'brief', 'signals', 'chose', 'why', 'asked', 'outcome', 'feedback', 'lesson'], 'cases', caseIds, { sourceOptional: true })) {
  if (!['hit', 'miss'].includes(c.outcome)) err(files.cases, `cases(${c.id}) outcome 必须是 hit 或 miss`);
  if (!c.lesson || c.lesson.length < 10) err(files.cases, `cases(${c.id}) lesson 太短，至少写清为什么`);
  const ch = c.chose ?? {};
  refCheck(files.cases, ch.aesthetic, aesIds, `cases(${c.id}).chose.aesthetic`);
  refCheck(files.cases, ch.genres, genIds, `cases(${c.id}).chose.genres`);
  refCheck(files.cases, ch.mechanics, mecIds, `cases(${c.id}).chose.mechanics`);
  refCheck(files.cases, ch.audience, audIds, `cases(${c.id}).chose.audience`);
}

done();

function done() {
  if (errors.length) {
    console.error(`✗ 惯例库校验失败（${errors.length} 个问题）`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  const n = (x) => (x ?? []).length;
  console.log(`✓ 惯例库校验通过 v${conv?.version}：审美 ${n(aes?.directions)}，玩法 ${n(gen?.genres)}，机制 ${n(mec?.patterns)} + 反模式 ${n(mec?.antiPatterns ?? mec?.['anti-patterns'])}，字体 ${n(typ?.directions)}，受众 ${n(aud?.audiences)}，案例 ${n(cases?.cases)}`);
}
