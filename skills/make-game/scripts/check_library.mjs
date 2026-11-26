#!/usr/bin/env node
// 惯例库校验：JSON 合法、id 唯一、必填字段齐、跨库引用有效、source 带出处。
// 用法：node scripts/check_library.mjs [--data <目录>]
// 退出码 0 = 通过；1 = 有错误。改库之后、提 PR 之前跑一遍。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dataArgIdx = args.indexOf('--data');
const dataDir = dataArgIdx >= 0
  ? resolve(args[dataArgIdx + 1])
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

function load(name) {
  const p = join(dataDir, name);
  if (!existsSync(p)) { err(name, '文件不存在'); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { err(name, `JSON 解析失败：${e.message}`); return null; }
}

const SOURCE_TYPES = new Set(['article', 'paper', 'book', 'doc', 'internal', 'dogfood']);

function checkSource(file, entry, where) {
  const s = entry.source;
  if (!s || typeof s !== 'object') return err(file, `${where} 缺 source`);
  if (!SOURCE_TYPES.has(s.type)) err(file, `${where} source.type 必须是 ${[...SOURCE_TYPES].join('/')}`);
  if (!s.ref || typeof s.ref !== 'string' || !s.ref.trim()) err(file, `${where} source.ref 不能为空`);
  else if ((s.type === 'article' || s.type === 'paper' || s.type === 'book' || s.type === 'doc') && !/^https?:\/\//.test(s.ref)) {
    err(file, `${where} source.type=${s.type} 时 ref 应为公开 URL`);
  }
}

function checkList(file, list, required, label, ids) {
  if (!Array.isArray(list)) return err(file, `${label} 必须是数组`);
  list.forEach((e, i) => {
    const where = `${label}[${i}]${e && e.id ? `(${e.id})` : ''}`;
    if (!e || typeof e !== 'object') return err(file, `${where} 不是对象`);
    for (const k of required) {
      if (e[k] === undefined || e[k] === null || e[k] === '') err(file, `${where} 缺字段 ${k}`);
    }
    if (e.id) {
      if (!/^[a-z0-9-]+$/.test(e.id)) err(file, `${where} id 只能是小写字母、数字、连字符`);
      if (ids.has(e.id)) err(file, `${where} id 重复`);
      ids.add(e.id);
    }
    checkSource(file, e, where);
  });
}

// ---- 加载 ----
const conv = load('conventions.json');
const aes = load('aesthetics.json');
const mec = load('mechanics.json');
const typ = load('typography.json');
if (errors.length) { done(); }

// ---- conventions ----
if (conv) {
  if (!conv.libraries || typeof conv.libraries !== 'object') err('conventions.json', '缺 libraries 索引');
  else {
    for (const [k, v] of Object.entries(conv.libraries)) {
      if (k.startsWith('$')) continue;
      if (!existsSync(join(dataDir, v))) err('conventions.json', `libraries.${k} 指向的文件不存在：${v}`);
    }
  }
  if (!Array.isArray(conv.acceptance?.static) || !Array.isArray(conv.acceptance?.browser)) err('conventions.json', 'acceptance.static / browser 必须是数组');
  for (const k of ['start', 'score', 'restart']) if (!conv.contract?.markers?.[k]) err('conventions.json', `contract.markers 缺 ${k}`);
  for (const k of ['start', 'restart', 'getScore', 'isRunning']) if (!conv.contract?.api?.methods?.[k]) err('conventions.json', `contract.api.methods 缺 ${k}`);
}

// ---- aesthetics ----
const aesIds = new Set();
if (aes) {
  checkList('aesthetics.json', aes.directions, ['id', 'name', 'feelsLike', 'fits', 'avoid', 'palette', 'typography', 'shapes', 'motion', 'assets', 'pitfalls'], 'directions', aesIds);
  aes.directions?.forEach((d) => {
    if (d.palette && (typeof d.palette.bg !== 'string' || typeof d.palette.ink !== 'string' || typeof d.palette.accent !== 'string' || typeof d.palette.rule !== 'string')) {
      err('aesthetics.json', `directions(${d.id}) palette 需要 bg/ink/accent/rule 四项`);
    }
  });
}

// ---- mechanics ----
const mecIds = new Set();
if (mec) {
  checkList('mechanics.json', mec.patterns, ['id', 'name', 'fits', 'skip', 'how', 'source'], 'patterns', mecIds);
  checkList('mechanics.json', mec.antiPatterns ?? mec['anti-patterns'], ['id', 'name', 'why', 'source'], 'anti-patterns', new Set());
  if (!mec.byGameType || typeof mec.byGameType !== 'object') err('mechanics.json', '缺 byGameType');
  else {
    for (const [type, refs] of Object.entries(mec.byGameType)) {
      if (type.startsWith('$')) continue;
      if (!Array.isArray(refs)) { err('mechanics.json', `byGameType.${type} 必须是数组`); continue; }
      for (const r of refs) if (!mecIds.has(r)) err('mechanics.json', `byGameType.${type} 引用了不存在的机制 ${r}`);
    }
  }
}

// ---- typography ----
if (typ) {
  checkList('typography.json', typ.directions, ['id', 'name', 'stack', 'feel', 'use', 'source'], 'directions', new Set());
  typ.directions?.forEach((d) => {
    if (!d.use) return;
    d.use.split(',').map((s) => s.trim()).filter(Boolean).forEach((tok) => {
      const known = [...aesIds].some((id) => tok === id || tok.startsWith(id + ' '));
      if (aesIds.size && !known) err('typography.json', `directions(${d.id}).use 里的 "${tok}" 不是 aesthetics 里的方向 id`);
    });
  });
  for (const d of typ.directions ?? []) {
    if (d.stack && /url\(|@font-face|https?:\/\//.test(d.stack)) err('typography.json', `directions(${d.id}) 字体栈不能引用外部字体文件`);
  }
}

done();

function done() {
  if (errors.length) {
    console.error(`✗ 惯例库校验失败（${errors.length} 个问题）`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  const n = (x) => (x?.directions ?? x?.patterns ?? []).length;
  console.log(`✓ 惯例库校验通过：审美 ${n(aes)} 个方向，机制 ${n(mec)} 条 + 反模式 ${(mec.antiPatterns ?? mec['anti-patterns'] ?? []).length} 条，字体 ${n(typ)} 种，入口 ${conv?.version ?? '?'}`);
}
