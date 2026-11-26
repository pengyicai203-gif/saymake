// 安装器的自动测试：在假的用户目录里装、重复装、加规矩、同步、自检、撤销。不碰真实的环境。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';

const REPO = process.argv[2];
const [, , , TMP = '/tmp/smtest'] = process.argv;
const fake = TMP + '/fakehome', sm = TMP + '/smhome';
const ws = (p) => `${fake}/Library/Application Support/DoubaoWork/${p}/.doubaowork/agent_mode/workspace`;
rmSync(TMP, { recursive: true, force: true });
for (const d of ['.claude/skills', '.codex/skills', ws('Default') + '/.user_skills', ws('Profile 2') + '/.user_skills']) mkdirSync(d.startsWith('/') ? d : `${fake}/${d}`, { recursive: true });
writeFileSync(`${fake}/.codex/AGENTS.md`, '我的 Codex 个人设置\n回答简短。\n');
// 模拟"以前装过的旧版 make-game"：内容不同
mkdirSync(`${ws('Profile 2')}/.user_skills/make-game`, { recursive: true });
writeFileSync(`${ws('Profile 2')}/.user_skills/make-game/SKILL.md`, '---\nname: make-game\n---\n旧版\n');
// 模拟别人的同名 skill：不能动
mkdirSync(`${fake}/.claude/skills/make-game`, { recursive: true });
writeFileSync(`${fake}/.claude/skills/make-game/SKILL.md`, '---\nname: make-game\n---\n别人的\n');

let fail = 0;
const t = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };
const run = (a, env = {}) => { const r = spawnSync(process.execPath, a, { encoding: 'utf8', env: { ...process.env, HOME: fake, SAYMAKE_HOME: sm, ...env } }); return { out: r.stdout + r.stderr, code: r.status }; };
const log = (...a) => run([`${sm}/current/skills/saymake/scripts/log.mjs`, ...a]);
const inst = (...a) => run([`${REPO}/core/install.mjs`, '--home', sm, ...a]);

// ---- 安装 ----
let r = inst();
t('第 1 次安装成功', r.code === 0 && r.out.includes('生成每次加载'));
t('Claude：CLAUDE.md 里有引用', readFileSync(`${fake}/.claude/CLAUDE.md`, 'utf8').includes(`@${sm}/current/core/ALWAYS.md`));
t('Claude：CLAUDE.md 开头没有空行', !readFileSync(`${fake}/.claude/CLAUDE.md`, 'utf8').startsWith('\n'));
t('Claude：别人的同名 skill 没被动', readFileSync(`${fake}/.claude/skills/make-game/SKILL.md`, 'utf8').includes('别人的') && r.out.includes('不是安装器放的') && r.out.includes('--force'));
const ag = readFileSync(`${fake}/.codex/AGENTS.md`, 'utf8');
t('Codex：AGENTS.md 原内容保留在开头', ag.startsWith('我的 Codex 个人设置\n回答简短。\n') && ag.includes('saymake:start') && ag.includes('这个用户'));
const listBackups = () => run(['-e', `const fs=require('fs');const d='${sm}/backup';const walk=(p)=>fs.existsSync(p)?fs.readdirSync(p,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(p+'/'+x.name):[p+'/'+x.name]):[];console.log(walk(d).join('\\n'))`]).out;
let bak = listBackups();
t('Codex：原 AGENTS.md 有备份', bak.includes('codex-AGENTS.md') && readFileSync(bak.split('\n').find((f) => f.includes('codex-AGENTS.md')), 'utf8') === '我的 Codex 个人设置\n回答简短。\n');
t('豆包：两个配置档都有 saymake', existsSync(`${ws('Default')}/.user_skills/saymake/SKILL.md`) && existsSync(`${ws('Profile 2')}/.user_skills/saymake/SKILL.md`));
t('豆包：手动放的旧版 make-game 默认不碰', readFileSync(`${ws('Profile 2')}/.user_skills/make-game/SKILL.md`, 'utf8').includes('旧版'));
r = inst('--force', '--tools', 'doubao');
bak = listBackups();
t('豆包：加 --force 后旧版被换成新的并备份', r.code === 0 && existsSync(`${ws('Profile 2')}/.user_skills/make-game/.saymake-skill`) && bak.includes('make-game/SKILL.md'));
t('豆包：两个配置档都有 ALWAYS.md', existsSync(`${ws('Default')}/ALWAYS.md`) && existsSync(`${ws('Profile 2')}/ALWAYS.md`));
r = run([`${ws('Default')}/.user_skills/make-game/scripts/m.mjs`, 'status']);
t('make-game 能找到记忆内核', r.out.includes('规矩 0/12'), r.out.split('\n')[0]);
r = inst('--force', '--tools', 'claude');
t('Claude：--force 后别人的被覆盖且有备份', existsSync(`${fake}/.claude/skills/make-game/.saymake-skill`) && listBackups().includes('skills-make-game/SKILL.md'));

// ---- 重复安装 ----
r = inst();
const n = (r.out.match(/不用动|接好|已是最新/g) ?? []).length;
t('第 2 次安装：幂等（6 个 skill + 3 处加载都不用动）', r.code === 0 && n >= 9, `不动 ${n} 处`);
t('第 2 次安装：CLAUDE.md 只有一段', (readFileSync(`${fake}/.claude/CLAUDE.md`, 'utf8').match(/saymake:start/g) ?? []).length === 1);
const st1 = JSON.parse(readFileSync(`${sm}/install.json`, 'utf8'));
t('重复安装：备份记录仍指向第一次装之前', st1.tools.codex.always[0].backup?.endsWith('codex-AGENTS.md') && !st1.tools.claude.always[0].backup, '自己建的文件不留备份');

// ---- 规矩与同步 ----
r = log('rule', 'add', '--text', '先给方案，我点头再动手', '--why', '用户说过别直接改');
t('加规矩', r.out.includes('规矩已记'));
r = log('inject');
t('每次加载的那一段里有这条规矩', r.out.includes('先给方案，我点头再动手'));
t('每次加载的那一段 ≤ 1500 字符（无规矩时）', r.out.length < 1500, `${r.out.length} 字符（1 条规矩）`);
r = log('propose', '--kind', 'rule', '--text', '回答控制在三段以内', '--why', '嫌长');
t('提候选', r.out.includes('已提候选'));
const cid = (log('candidates').out.match(/\[(c[a-z0-9]+)\]/) ?? [])[1];
r = log('accept', cid);
t('候选点头后生效', r.out.includes('已生效') && log('inject').out.includes('回答控制在三段以内'));
t('规矩没点头前不进每次加载的那一段', !log('propose', '--kind', 'rule', '--text', '还没点头的一条', '--why', 'x').out.includes('已生效') && !log('inject').out.includes('还没点头的一条'));
r = log('propose', '--kind', 'rule', '--text', '回答控制在三段以内');
t('重复提同一条候选不新增', !r.out.includes('已提候选'));
r = log('refresh');
t('refresh 把规矩同步到 Codex 的 AGENTS.md', readFileSync(`${fake}/.codex/AGENTS.md`, 'utf8').includes('回答控制在三段以内'));
r = log('doctor');
t('doctor 全部通过', !r.out.includes('✗'), r.out.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
t('Codex 的 AGENTS.md 原内容仍在', readFileSync(`${fake}/.codex/AGENTS.md`, 'utf8').startsWith('我的 Codex 个人设置'));
for (let i = 0; i < 12; i++) log('rule', 'add', '--text', `测试规矩 ${i} 号，占位用`, '--why', 'x');
r = log('rule', 'add', '--text', '第 13 条', '--why', 'x');
t('规矩上限 12 条', r.out.includes('最多 12 条'));
r = log('inject');
t('12 条规矩时每次加载的那一段 ≤ 1500 字符', r.out.length <= 1500, `${r.out.length} 字符`);

// ---- 撤销 ----
r = inst('--uninstall');
t('撤销成功', r.code === 0);
t('撤销：skill 都删了', !existsSync(`${fake}/.claude/skills/saymake`) && !existsSync(`${fake}/.codex/skills/saymake`) && !existsSync(`${ws('Default')}/.user_skills/make-game`));
t('撤销：AGENTS.md 恢复成原样（逐字节）', readFileSync(`${fake}/.codex/AGENTS.md`, 'utf8') === '我的 Codex 个人设置\n回答简短。\n', JSON.stringify(readFileSync(`${fake}/.codex/AGENTS.md`, 'utf8')));
t('撤销：自己建的空文件删掉', !existsSync(`${fake}/.claude/CLAUDE.md`) && !existsSync(`${ws('Default')}/ALWAYS.md`));
t('撤销：记忆库保留', existsSync(`${sm}/memory/rules.json`));

// ---- 没有安装记录时的撤销不能乱删 ----
mkdirSync(`${fake}/.claude/skills/make-game`, { recursive: true });
writeFileSync(`${fake}/.claude/skills/make-game/SKILL.md`, '别人的');
r = inst('--uninstall');
t('撤销：不是安装器放的 skill 不删', r.code === 0 && existsSync(`${fake}/.claude/skills/make-game/SKILL.md`));

console.log(fail ? `\n✗ ${fail} 项没过` : '\n安装器测试全过');
process.exit(fail ? 1 : 0);
