#!/usr/bin/env node
// make-game 的统一入口。协议里写的 <m> 就是它：  node <skill目录>/scripts/m.mjs <子命令>
//   list | show <类别> <id> | cases | bygametype <玩法>   读库（转发给 library.mjs，并记下读了多少）
//   read <skill里的相对路径>                              按需读协议里的某个文件，并记下读了多少
//   其余全部转发给记忆内核 saymake：start judge ask generate selfcheck deliver feedback resolve summary cost
//                                 recall remember forget show propose candidates accept reject rule
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skill = join(here, '..');
const args = process.argv.slice(2);
const log = [join(skill, '..', 'saymake', 'scripts', 'log.mjs'), join(process.env.SAYMAKE_HOME || join(homedir(), '.saymake'), 'current', 'skills', 'saymake', 'scripts', 'log.mjs')].find((p) => existsSync(p));
if (!log) { console.error('✗ 没找到 SayMake 记忆内核（skills/saymake）。两个 skill 要一起装：在仓库根目录运行 bash install.sh'); process.exit(1); }
const env = { ...process.env, SAYMAKE_SKILL_DIR: skill };

if (['list', 'show', 'cases', 'bygametype'].includes(args[0])) {
  const r = spawnSync(process.execPath, [join(here, 'library.mjs'), ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 0) spawnSync(process.execPath, [log, 'mark', '--what', `library ${args.join(' ')}`, '--n', String(r.stdout.length)], { env });
  process.exit(r.status ?? 1);
}
const r = spawnSync(process.execPath, [log, ...args], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
