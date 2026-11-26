#!/usr/bin/env node
// SayMake 验收器：判断一个小游戏"过不过"，而不是"像不像"。
//
// 用法:
//   node validate_game.mjs <game.html>            静态检查（无依赖）
//   node validate_game.mjs <game.html> --browser  额外用真实浏览器检查（需要 playwright）
//   node validate_game.mjs <game.html> --json     机器可读输出
//
// 原则：不要相信模型说"我做完了"。一律跑这里。

import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONVENTIONS = JSON.parse(readFileSync(resolve(SKILL_DIR, 'data/conventions.json'), 'utf8'));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const fileArg = args.find((a) => !a.startsWith('--'));
const asJson = flags.has('--json');
const useBrowser = flags.has('--browser');

if (!fileArg || flags.has('--help')) {
  console.error('用法: node validate_game.mjs <game.html> [--browser] [--json]');
  process.exit(2);
}

const gamePath = resolve(fileArg);
const results = [];
const add = (id, ok, msg = '') => results.push({ id, ok: !!ok, msg });

let html;
try {
  html = readFileSync(gamePath, 'utf8');
} catch {
  console.error(`读不到文件: ${gamePath}`);
  process.exit(2);
}

// ---------- 静态检查 ----------

const external = [
  ...[...html.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
].filter((u) => !u.startsWith('data:'));
const network = [/\bfetch\s*\(/, /XMLHttpRequest/, /new\s+WebSocket/, /import\s*\(/].filter((r) => r.test(html)).length;
add('single-file', external.length === 0 && network === 0,
  [external.length ? `引用了外部资源: ${external.join(', ')}` : '', network ? '存在网络请求' : ''].filter(Boolean).join('；'));

add('viewport', /<meta[^>]+name\s*=\s*["']viewport["'][^>]+width=device-width/i.test(html), '缺少 viewport meta');

for (const m of ['start', 'score', 'restart']) {
  add(`marker:${m}`, new RegExp(`data-sm\\s*=\\s*["']${m}["']`).test(html), `缺少 data-sm="${m}"`);
}

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1]).filter((s) => s.trim());
let syntaxOk = scripts.length > 0;
let syntaxMsg = scripts.length ? '' : '没有内联脚本';
scripts.forEach((code, i) => {
  try {
    new vm.Script(code, { filename: `inline-script-${i + 1}.js` });
  } catch (e) {
    syntaxOk = false;
    syntaxMsg = `第 ${i + 1} 段脚本语法错误: ${e.message}`;
  }
});
add('script-syntax', syntaxOk, syntaxMsg);

const hasSm = /window\.__sm\s*=/.test(html);
const missingApi = Object.keys(CONVENTIONS.contract.api.methods).filter((fn) => !new RegExp(`\\b${fn}\\b`).test(html));
add('api', hasSm && missingApi.length === 0,
  [!hasSm ? '没有 window.__sm' : '', missingApi.length ? `缺少方法: ${missingApi.join(', ')}` : ''].filter(Boolean).join('；'));

const blocking = [/\balert\s*\(/, /\bconfirm\s*\(/, /\bprompt\s*\(/, /document\.write\s*\(/].filter((r) => r.test(html));
add('no-blocking-dialogs', blocking.length === 0, blocking.length ? '使用了阻塞式弹窗' : '');

const kb = statSync(gamePath).size / 1024;
add('size', kb < 300, `${kb.toFixed(1)} KB`);

// ---------- 浏览器检查（可选） ----------

if (useBrowser) {
  let pw = null;
  try {
    pw = await import('playwright');
  } catch {
    add('browser:available', false, '未安装 playwright，跳过真实浏览器检查。安装: npm i -D playwright && npx playwright install chromium');
  }
  if (pw) {
    const outDir = resolve(dirname(gamePath), '.saymake');
    mkdirSync(outDir, { recursive: true });
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + gamePath);
    await page.waitForTimeout(300);

    add('browser:no-errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    add('browser:no-overflow', !overflow, '手机宽度下出现横向溢出');

    const started = await page.evaluate(() => { try { window.__sm.start(); return window.__sm.isRunning(); } catch (e) { return 'ERR: ' + e.message; } });
    add('browser:start', started === true, started === true ? '' : `start() 后状态: ${started}`);

    await page.waitForTimeout(250);
    const score = await page.evaluate(() => { try { return window.__sm.getScore(); } catch (e) { return 'ERR: ' + e.message; } });
    add('browser:score-number', typeof score === 'number', `getScore() 返回 ${typeof score}: ${score}`);

    // 真实点几下游戏区域，确认页面没有因为交互而报错
    const box = await page.evaluate(() => { const el = document.querySelector('[data-sm="score"]'); return el ? el.getBoundingClientRect().width : 0; });
    for (let i = 0; i < 4; i++) { await page.mouse.click(195, 420); await page.waitForTimeout(80); }
    add('browser:interaction', errors.length === 0, errors.length ? '点击后出现报错' : `分数区域宽度 ${Math.round(box)}px`);

    const restarted = await page.evaluate(() => { try { window.__sm.restart(); return window.__sm.isRunning(); } catch (e) { return 'ERR: ' + e.message; } });
    add('browser:restart', restarted === true, restarted === true ? '' : `restart() 后状态: ${restarted}`);

    const shot = resolve(outDir, `${basename(gamePath).replace(/\.html?$/i, '')}.png`);
    await page.screenshot({ path: shot });
    await browser.close();
    results.push({ id: 'browser:screenshot', ok: true, msg: shot, info: true });
  }
}

// ---------- 输出 ----------

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const summary = { file: gamePath, passed, total: results.filter((r) => !r.info).length, ok: failed.length === 0 };

if (asJson) {
  console.log(JSON.stringify({ ...summary, results }, null, 2));
} else {
  const pad = (s, n) => (s + ' '.repeat(Math.max(0, n - s.length)));
  for (const r of results) {
    if (r.info) { console.log(`  ·  ${pad(r.id, 22)} ${r.msg}`); continue; }
    console.log(`${r.ok ? '✓' : '✗'}  ${pad(r.id, 22)} ${r.ok ? '' : r.msg}`);
  }
  console.log('');
  console.log(failed.length === 0 ? `全部通过 (${passed}/${summary.total})` : `未通过 ${failed.length} 项 (${passed}/${summary.total})`);
}

process.exit(failed.length === 0 ? 0 : 1);
