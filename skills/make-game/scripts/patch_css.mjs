#!/usr/bin/env node
// SayMake 样式补丁器：把"这块大一点"落到具体元素上，不重写整个文件。
//
// 用法:
//   node patch_css.mjs <game.html> --css "#score { font-size: 48px; color: #ff0 }"
//   node patch_css.mjs <game.html> --css ".btn { padding: 20px }" --css ".dot { width: 80px }"
//   node patch_css.mjs <game.html> --list      查看当前所有覆盖样式
//   node patch_css.mjs <game.html> --clear     清除全部覆盖样式
//   node patch_css.mjs <game.html> --css ".dot { width: 80px }" --dry-run   只看不写
//
// 规则:
//   - 覆盖样式统一写在 <style id="sm-overrides"> 里，可追溯、可一键清除
//   - 同一选择器再次写入会替换旧值，不会越叠越多
//   - 写完必须重新跑 validate_game.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TAG_OPEN = '<style id="sm-overrides">';
const TAG_RE = /<style id="sm-overrides">([\s\S]*?)<\/style>/;
const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const usage = () => console.error('用法: node patch_css.mjs <game.html> (--css "sel { prop: val }")+ [--list|--clear] [--dry-run]');
if (!fileArg) { usage(); process.exit(2); }

const path = resolve(fileArg);
let html;
try { html = readFileSync(path, 'utf8'); } catch { console.error(`读不到文件: ${path}`); process.exit(2); }

const parseRules = (text) => (text || '')
  .split('}')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const i = s.indexOf('{');
    if (i < 0) return null;
    return { sel: s.slice(0, i).trim(), body: s.slice(i + 1).trim().replace(/;?\s*$/, '') };
  })
  .filter(Boolean);

const render = (rules) => rules.map((r) => `${r.sel} { ${r.body}; }`).join('\n');

const getBlock = () => { const m = html.match(TAG_RE); return m ? m[1] : null; };
const setBlock = (css) => {
  const tag = `${TAG_OPEN}\n${css}\n</style>`;
  if (TAG_RE.test(html)) html = html.replace(TAG_RE, () => tag);
  else if (html.includes('</head>')) html = html.replace('</head>', `${tag}\n</head>`);
  else { console.error('找不到 </head>，无法写入'); process.exit(2); }
};

if (args.includes('--list')) { console.log(getBlock() || '（没有覆盖样式）'); process.exit(0); }
if (args.includes('--clear')) {
  html = html.replace(/\s*<style id="sm-overrides">[\s\S]*?<\/style>/, '');
  if (!args.includes('--dry-run')) writeFileSync(path, html);
  console.log('已清除全部覆盖样式'); process.exit(0);
}

const incoming = [];
args.forEach((a, i) => { if (a === '--css' && args[i + 1]) incoming.push(...parseRules(args[i + 1])); });
if (!incoming.length) { usage(); process.exit(2); }

const current = parseRules(getBlock());
for (const r of incoming) {
  const i = current.findIndex((x) => x.sel === r.sel);
  if (i >= 0) current[i] = r; else current.push(r);
}
const css = render(current);
setBlock(css);
if (!args.includes('--dry-run')) writeFileSync(path, html);

console.log(`已写入 ${incoming.length} 条覆盖样式 → <style id="sm-overrides">`);
console.log(css);
console.log('\n下一步: node scripts/validate_game.mjs ' + fileArg);
