// 记忆内核的自动测试：项目内流程、跨项目带出经验、候选要点头、读取量统计。只用临时目录，不碰真实的记忆库。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const REPO = process.argv[2];
const TMP = '/tmp/smmem';
rmSync(TMP, { recursive: true, force: true });
const ENV = { ...process.env, SAYMAKE_HOME: TMP + '/home' };
const LOG = `${REPO}/skills/saymake/scripts/log.mjs`;
const M = `${REPO}/skills/make-game/scripts/m.mjs`;
let fail = 0;
const t = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
const inDir = (dir, script, ...a) => { const r = spawnSync(process.execPath, [script, ...a], { encoding: 'utf8', cwd: dir, env: ENV }); return { out: r.stdout + r.stderr, code: r.status }; };
const proj = (n) => { const d = `${TMP}/${n}`; mkdirSync(d, { recursive: true }); return d; };
const A = proj('fruit-game-v1'), B = proj('fruit-catch-v2'), C = proj('new-fruit'), D = proj('cost-check');

// ---- 项目 A：完整走一遍，旧命令的结果不能变 ----
t('start', inDir(A, LOG, 'start', '--brief', '做一个手机上玩的接水果小游戏，治愈一点').out.includes('开工已记录'));
t('judge', inDir(A, LOG, 'judge', '--aesthetic', 'a-clean', '--genre', 'g-catch', '--mechanics', 'm1,m2', '--audience', 'self', '--why', '他说治愈').out.includes('判断已记录'));
t('ask', inDir(A, LOG, 'ask', '--question', '想玩哪一种', '--answer', '接水果那种').out.includes('用户已答'));
inDir(A, LOG, 'generate', '--file', 'index.html');
let r = inDir(A, LOG, 'deliver');
t('没有自检 → deliver 被拒绝', r.code === 1 && r.out.includes('没有自检记录'));
inDir(A, LOG, 'selfcheck', '--ok', 'false', '--notes', '水果太小');
r = inDir(A, LOG, 'deliver');
t('自检没过 → deliver 被拒绝', r.code === 1 && r.out.includes('没过'));
t('selfcheck 不写看到了什么 → 被拒绝', inDir(A, LOG, 'selfcheck', '--ok', 'true').code === 1);
t('selfcheck 通过', inDir(A, LOG, 'selfcheck', '--ok', 'true', '--notes', '方向：暖米色背景；主角：水果有高光；字：分数最大；问题：无').out.includes('通过'));
t('deliver', inDir(A, LOG, 'deliver').out.includes('已交付'));
inDir(A, LOG, 'feedback', '--kind', 'overall', '--text', '太幼稚了');
t('resolve', inDir(A, LOG, 'resolve', '--text', '改成写实清爽', '--lesson', '他说治愈时容易选成卡通，其实要的是干净真实').out.includes('已记录'));
t('remember 偏好', inDir(A, LOG, 'remember', '--kind', 'preference', '--text', '画面要真实干净，不要幼稚卡通').out.includes('记住了偏好'));
t('remember 坑', inDir(A, LOG, 'remember', '--kind', 'lesson', '--problem', '接水果游戏里用 emoji 当水果，看起来廉价', '--cause', '系统 emoji 自带光影', '--fix', '自己画水果，加高光', '--tags', '水果,图标').out.includes('记住了这个坑'));
r = inDir(A, LOG, 'summary');
t('summary 四个指标对得上', r.out.includes('提问次数：1（用户答了 1）') && r.out.includes('首稿方向命中：否') && r.out.includes('整体反馈次数：1') && r.out.includes('交付次数：1'), r.out.replace(/\n/g, ' ｜ '));

// ---- 项目 B：不同目录，同类任务 ----
inDir(B, LOG, 'start', '--brief', '接水果，想要真实一点的画面');
inDir(B, LOG, 'remember', '--kind', 'lesson', '--problem', '手机游戏竖屏下水果太小，看不清', '--cause', '按桌面尺寸画的', '--fix', '主角不小于 64px', '--tags', '手机,尺寸');
inDir(B, LOG, 'remember', '--kind', 'preference', '--text', '字要大');
r = inDir(B, LOG, 'recall', '--brief', '随便一个游戏');
t('偏好从别的项目带得出来', r.out.includes('[p') && r.out.includes('字要大') && r.out.includes('说过 1 次'));
inDir(B, LOG, 'remember', '--kind', 'preference', '--text', '字要大');
r = inDir(B, LOG, 'recall', '--brief', '随便');
t('同一偏好再说一次 → 次数累加，不重复记', r.out.includes('说过 2 次') && (r.out.match(/\[p[a-z0-9]+\]/g) ?? []).length === 2, `${(r.out.match(/\[p[a-z0-9]+\]/g) ?? []).length} 条偏好`);
inDir(B, LOG, 'remember', '--kind', 'preference', '--text', '字要大一点，正文不小于 18px', '--replaces', '字要大');
r = inDir(B, LOG, 'recall', '--brief', '随便');
t('--replaces 用新的换掉旧的', r.out.includes('正文不小于 18px') && !r.out.includes('] 字要大（'), r.out.split('\n').filter((l) => l.includes('[p')).join(' | '));
inDir(B, LOG, 'remember', '--kind', 'preference', '--text', '这条是错的，待会删');
const pid = (inDir(B, LOG, 'show').out.match(/\[?(p[a-z0-9]+)\]? 这条是错的/) ?? [])[1];
t('forget 删掉偏好', !!pid && inDir(B, LOG, 'forget', pid).out.includes('已删掉') && !inDir(B, LOG, 'recall', '--brief', '随便').out.includes('这条是错的'), pid ?? '没找到 id');

// ---- 项目 C：第三个项目，开工就要带出前两个的经验 ----
inDir(C, LOG, 'start', '--brief', '接水果游戏');
r = inDir(C, LOG, 'recall', '--brief', '接水果游戏');
const cases = (r.out.match(/^  - 「/gm) ?? []).length, lessons = (r.out.match(/^  - \[l/gm) ?? []).length;
t('第 3 个项目带出前两个项目的经验 ≥ 2 条', cases + lessons >= 2, `相似做法 ${cases} 条，相关的坑 ${lessons} 条`);
t('带出的案例标明了结果和教训', r.out.includes('结果：命中') && r.out.includes('教训：他说治愈时容易选成卡通'));
t('recall 不带出正在做的这一个', !r.out.includes('「接水果游戏」'));
t('recall 输出带字符数', /\[size \d+ 字符\]/.test(r.out) && Number((r.out.match(/\[size (\d+)/) ?? [])[1]) < 1500, (r.out.match(/\[size \d+ 字符\]/) ?? [])[0]);
r = inDir(C, LOG, 'recall', '--brief', '做一个贪吃蛇');
t('不相关的话不会硬带出记录', !/^  - 「/m.test(r.out) && !/^  - \[l/m.test(r.out));

// ---- 候选：规矩和惯例要用户点头 ----
inDir(C, LOG, 'propose', '--kind', 'rule', '--text', '先给方案，我点头再动手', '--why', '这次他纠正了');
const cid = (inDir(C, LOG, 'candidates').out.match(/\[(c[a-z0-9]+)\]/) ?? [])[1];
t('候选没点头前不进每次加载的那一段', !!cid && !inDir(C, LOG, 'inject').out.includes('先给方案'));
t('accept 后生效', inDir(C, LOG, 'accept', cid).out.includes('已生效') && inDir(C, LOG, 'inject').out.includes('先给方案，我点头再动手'));
inDir(C, LOG, 'propose', '--kind', 'rule', '--text', '这条他不要', '--why', 'x');
const cid2 = (inDir(C, LOG, 'candidates').out.match(/\[(c[a-z0-9]+)\].*这条他不要/) ?? [])[1];
t('reject 后不生效', inDir(C, LOG, 'reject', cid2).out.includes('已放弃') && !inDir(C, LOG, 'inject').out.includes('这条他不要'));
t('已经生效的规矩再提 → 提示已有，不新增', inDir(C, LOG, 'propose', '--kind', 'rule', '--text', '先给方案，我点头再动手').out.includes('已经有这条'));
inDir(C, LOG, 'propose', '--kind', 'convention', '--text', '他说治愈时先确认是不是要真实干净', '--why', '项目 A 偏过');
const cid3 = (inDir(C, LOG, 'candidates').out.match(/\[(c[a-z0-9]+)\].*先确认/) ?? [])[1];
inDir(C, LOG, 'accept', cid3);
t('惯例生效后 recall 会带出来', inDir(C, LOG, 'recall', '--brief', '随便').out.includes('他自己加的惯例') && inDir(C, LOG, 'recall', '--brief', '随便').out.includes('先确认是不是要真实干净'));
t('propose 偏好与已有偏好重复 → 提示已有', inDir(C, LOG, 'propose', '--kind', 'preference', '--text', '正文不小于 18px').out.includes('已经有这条偏好'));
r = inDir(C, LOG, 'status');
t('status 一行看全貌', /规矩 1\/12/.test(r.out) && /项目 3/.test(r.out), r.out.trim());
r = inDir(C, LOG, 'show');
t('show 能看到全部类型', ['规矩', '偏好', '惯例', '踩过的坑', '做过的项目', '判断案例'].every((k) => r.out.includes(k)));
t('没有安装时 rule add 不乱建目录', !existsSync(`${TMP}/home/current`));

// ---- 通过 make-game 的入口走一遍，量读取量 ----
const S = `${REPO}/skills/make-game`;
t('m.mjs 能找到记忆内核', inDir(D, M, 'start', '--brief', '做一个接水果游戏').out.includes('开工已记录'));
const listOut = inDir(D, M, 'list').out;
t('m.mjs list 转发给读库脚本并带字符数', listOut.includes('【审美方向】') && /\[size \d+ 字符\]/.test(listOut));
const conv = inDir(D, M, 'read', 'data/conventions.json');
t('m.mjs read 读入口文件并记下字符数', conv.out.includes('"contract"') && conv.out.includes('[size'));
inDir(D, M, 'read', 'data/guide/signals.json');
inDir(D, M, 'recall', '--brief', '做一个接水果游戏');
inDir(D, M, 'bygametype', 'relax');
const sid = (re) => (listOut.match(re) ?? [])[1];
const aid = sid(/【审美方向】\n([a-z0-9-]+)｜/), gid = sid(/【玩法】\n([a-z0-9-]+)｜/);
inDir(D, M, 'show', 'g', gid);
inDir(D, M, 'show', 'a', aid);
inDir(D, M, 'judge', '--aesthetic', aid, '--genre', gid, '--mechanics', 'm1', '--audience', 'self', '--why', 'x');
inDir(D, M, 'generate', '--file', 'index.html');
r = inDir(D, M, 'cost');
const total = Number((r.out.match(/合计：(\d+)/) ?? [])[1]);
t('典型路径（话说得清）：一句话到写代码 ≤ 9000 字符', total > 0 && total <= 9000, `${total} 字符（${r.out.split('\n').filter((l) => l.includes('：')).map((l) => l.trim()).join('，')}）`);
inDir(D, M, 'read', 'references/asking.md');
inDir(D, M, 'read', 'data/guide/questions.json');
const asking = Number((inDir(D, M, 'cost').out.match(/合计：(\d+)/) ?? [])[1]);
console.log(`  （参考：话说不清、需要提问的路径是 ${asking} 字符，超出预算 ${asking - 9000}，这部分是按需读的）`);
t('m.mjs read 不让读 skill 目录外的文件', inDir(D, M, 'read', '../../../README.md').code === 1);
t('cost 如实说明 token 数未验证', r.out.includes('未验证'));

console.log(fail ? `\n✗ ${fail} 项没过` : '\n记忆内核测试全过');
process.exit(fail ? 1 : 0);
