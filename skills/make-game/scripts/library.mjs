#!/usr/bin/env node
// 按需读库：不必把几个库文件整个读完。
//   node scripts/library.mjs list                 清单：每个方向/玩法/机制一句话
//   node scripts/library.mjs show <类别> <id>     读一条完整的。类别：a 审美 / g 玩法 / m 机制 / t 字体 / aud 受众 / case 案例
//   node scripts/library.mjs cases                出厂案例：用户的话 + 结果 + 教训
//   node scripts/library.mjs bygametype <玩法id>  这个玩法的起步机制组合
// 没有 --data 时读脚本旁边的 data/。输出末尾的 size 是给模型看的：读了多少字符。

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const di = args.indexOf('--data');
const dataDir = di >= 0 ? resolve(args[di + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const rest = di >= 0 ? [...args.slice(0, di), ...args.slice(di + 2)] : args;
const [cmd = 'list', a1 = '', a2 = ''] = rest;

const read = (f) => existsSync(join(dataDir, f)) ? JSON.parse(readFileSync(join(dataDir, f), 'utf8')) : null;
const conv = read('conventions.json');
const lib = {};
for (const [k, v] of Object.entries(conv?.libraries ?? {})) lib[k] = read(v.file ?? v);

const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const out = [];
const emit = (s = '') => out.push(s);
const done = () => { const text = out.join('\n'); process.stdout.write(text + `\n[size ${text.length} 字符]\n`); };

function pick(list, id) {
  if (!id) return null;
  return list.find((x) => x.id === id) ?? list.find((x) => x.id.startsWith(id)) ?? null;
}
function printObj(title, o) {
  emit(`# ${title}`);
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('$') || k === 'source') continue;   // 出处网址做游戏用不上，要看出处直接读库文件
    emit(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
}
function byType(id) {
  const type = id?.split('-')[0];
  if (type === 'a') return ['审美', lib.aesthetics?.directions];
  if (type === 'g') return ['玩法', lib.genres?.genres];
  if (type === 'm') return ['机制', lib.mechanics?.patterns];
  if (type === 't') return ['字体', lib.typography?.directions];
  if (type === 'aud') return ['受众', lib.audiences?.audiences];
  if (type === 'case') return ['案例', lib.cases?.cases];
  return [null, null];
}

if (cmd === 'list') {
  emit('【审美方向】');
  for (const d of lib.aesthetics?.directions ?? []) emit(`${d.id}｜${cut(d.feelsLike, 40)}`);
  emit('【玩法】');
  for (const g of lib.genres?.genres ?? []) emit(`${g.id}｜${cut(g.like, 36)}`);
  emit('【机制】');
  emit((lib.mechanics?.patterns ?? []).map((m) => `${m.id}=${m.name}`).join('；'));
  emit('【字体】');
  emit((lib.typography?.directions ?? []).map((t) => `${t.id}=${t.name}`).join('；'));
  emit('【受众】');
  emit((lib.audiences?.audiences ?? []).map((a) => `${a.id}=${a.name}`).join('；'));
  emit(`【出厂案例】${(lib.cases?.cases ?? []).length} 条，用 cases 查看`);
  emit('用法：show a|g|m|t|aud|case <id> 读完整条目');
} else if (cmd === 'show' && a1 && a2) {
  const [label, list] = byType(a1);
  const e = list ? pick(list, a2) : null;
  if (!e) { console.error(`找不到：${a1} ${a2}。先运行 list 看有哪些 id。`); process.exit(1); }
  printObj(`${label} ${e.id}`, e);
} else if (cmd === 'cases') {
  for (const c of lib.cases?.cases ?? []) {
    emit(`■ ${c.id}｜${c.outcome === 'hit' ? '命中' : '偏了'}`);
    emit(`  用户的话：${cut(c.brief, 90)}`);
    emit(`  选的方向：${[c.chose?.aesthetic, ...(c.chose?.genres ?? [])].filter(Boolean).join(' + ')}`);
    emit(`  教训：${cut(c.lesson, 150)}`);
  }
  emit('用 show case <id> 看完整的一条');
} else if (cmd === 'bygametype' && a1) {
  const t = lib.mechanics?.byGameType?.[a1];
  if (!t) { console.error(`没有这个玩法类型：${a1}。有：${Object.keys(lib.mechanics?.byGameType ?? {}).filter((k) => !k.startsWith('$')).join(' ')}`); process.exit(1); }
  emit(`${a1}: ${t.join(', ')}`);
} else {
  console.error('用法：library.mjs list | show <a|g|m|t|aud|case> <id> | cases | bygametype <类型>');
  process.exit(1);
}
done();
