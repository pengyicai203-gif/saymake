# SayMake

> 用人话说一句，拿到一个能直接玩的东西。
>
> Say it plainly. Get something that works.

SayMake 是一个开源的 AI Skill：不会写代码、不懂提示词工程的人，用一句自然语言描述想要的小游戏，它负责把这句话变成**明确的需求规格**、**能跑的单文件 HTML 游戏**、**自动验收**，支持"指哪改哪"的局部修改，并且**越用越懂这个人**。

它由三样东西组成：

- **记忆内核**（`skills/saymake`）：替用户攒规矩、偏好、踩过的坑，跨项目、跨 AI 工具，存在用户自己电脑上。
- **干活 skill**（`skills/make-game`，第一个）：照着协议和惯例库，把一句话做成游戏。
- **一条命令安装**（`install.sh`）：认出本机有哪些 AI 工具，把上面两样放到位。

它不是一个提示词合集。仓库里真正干活的是脚本：安装器、记忆、读库、验收器、补丁器。只需要 Node.js 18+，不联网，不上传任何东西。

## 一分钟装好

```bash
git clone https://github.com/pengyicai203-gif/saymake
cd saymake
bash install.sh
```

或者不克隆直接装：

```bash
curl -fsSL https://raw.githubusercontent.com/pengyicai203-gif/saymake/main/install.sh | bash
```

装完**开一个新对话**，对它说：

> 我想做一个接水果的小游戏，手机上玩。

它会先看你以前留下的偏好和坑，复述一遍理解的需求（拿不准的地方用带画面的选项问你，不多问），然后生成游戏、自动验收、看截图自检、给你看截图、告诉你在哪、还能怎么改。做完把这次学到的东西记下来。

`bash install.sh --dry-run` 只看它会做什么；`--uninstall` 撤销，动过的文件会恢复成安装前的样子。

### 各 AI 工具支持情况

| 工具 | skill 装在哪 | 每次对话自动读你的规矩 | 验证情况 |
|---|---|---|---|
| 豆包 | 每个配置档的 `.user_skills/` | 工作区根目录的 `ALWAYS.md` 里一行引用 | skill 目录已验证（v0.5 起就在用）；自动加载**未验证**，要开新对话看它会不会先查记忆 |
| Claude Code | `~/.claude/skills/` | `~/.claude/CLAUDE.md` 里一行 `@` 引用 | 机制有官方文档；本机已装，**未在新对话里验证** |
| Codex | `~/.codex/skills/` | 把规矩那一段写进 `~/.codex/AGENTS.md`（原文件先备份） | 安装器支持，**未验证** |
| Windows | — | — | **未验证**（安装器用的是 Node，理论上能跑） |

没列出的工具：把 `skills/saymake` 和 `skills/make-game` 两个目录复制到它的 skills 目录，再把 `node ~/.saymake/current/skills/saymake/scripts/log.mjs inject` 的输出放进它每次都会读的文件里。

## 它会记住你

这是 SayMake 和"一段提示词"最不一样的地方。用户的模型不会变聪明，但会少犯同一个错。

| 记什么 | 例子 | 谁决定 |
|---|---|---|
| **规矩**（最多 12 条，每条一句话） | "先给方案，我点头再动手" | 用户。模型只能提候选，用户点头才生效 |
| **偏好** | "字要大""画面要真实干净，不要幼稚卡通" | 模型自动记，但必须告诉用户记了什么 |
| **踩过的坑** | "点了开始主角立刻下坠，手指没到位就丢命 → 第一次点按才开始下落" | 模型自动记 |
| **判断案例** | 你说过什么、它选了什么方向、对没对上、教训 | 自动 |
| **惯例**（你自己加进库里的做法） | "用户说'上班摸鱼'：无音效、切走自动暂停、画面像小工具" | 用户点头才生效 |

这些都在你自己电脑上的 `~/.saymake/memory/`，是纯文本，不上传，不随 skill 升级丢失，同一台电脑上的不同 AI 工具读同一份。每次开工，它先把和这句话相关的拿出来看；收尾，把新学到的写回去。

规矩那 12 条会被写进 AI 工具"每次对话开头都读"的文件里，所以哪怕还没调用任何 skill，它也知道你的规矩——这一步在各工具里是否真的生效，见上面的表。

```bash
node ~/.saymake/current/skills/saymake/scripts/log.mjs show            # 看它记了你什么
node ~/.saymake/current/skills/saymake/scripts/log.mjs candidates     # 有哪些等你点头
node ~/.saymake/current/skills/saymake/scripts/log.mjs forget <id>    # 说"这条不对"就删掉
node ~/.saymake/current/skills/saymake/scripts/log.mjs doctor         # 各工具装好了没
```

对 AI 直接说"看看你记了什么""忘掉那条""以后都先给方案"也行，它通过 `saymake` skill 来做这些。

## 它怎么工作

判断交给模型，确定性交给脚本。

| 部件 | 位置 | 职责 |
|---|---|---|
| 安装器 | `install.sh` + `core/install.mjs` | 认出 Claude Code / Codex / 豆包，放 skill、接上"每次加载"；可重复运行、可撤销、动过的文件先备份；不碰不是它放的同类 skill |
| 记忆内核 | `skills/saymake/` | 规矩、偏好、坑、案例、惯例、候选；开工 `recall`，收尾 `remember` / `propose`；`doctor` 自检 |
| 协议 | `skills/make-game/SKILL.md` | 查记忆 → 判断五个问题（审美、玩法、机制、字体、受众）→ 拿不准就用带画面的选项问 → 做 → 看图自检并留痕 → 交付 → 记下这一轮学到的 |
| 惯例库 | `skills/make-game/data/` | **选项库 + 判断指南**，每条带出处：16 种视觉方向、11 个玩法、21 种机制 + 3 条反模式、5 种字体方向、4 种受众、5 条出厂案例 |
| 按需读库 | `scripts/library.mjs`、`scripts/m.mjs` | 先读 1500 字的清单，选中哪条再读哪条；并统计"从一句话到写代码读了多少" |
| 验收器 | `scripts/validate_game.mjs` | 单文件、语法、契约标记、禁止弹窗；`--browser` 下真实打开页面检查报错、溢出、开始/计分/重开，留两张截图 |
| 库校验器 | `scripts/check_library.mjs` | id 唯一、字段齐全、跨库引用有效、出处格式正确 |
| 浏览器环境 | `scripts/setup_browser.sh` | 把 playwright + Chromium 装到 `~/.saymake/`，不污染 skill 目录 |
| 补丁器 | `scripts/patch_css.mjs` | 把"这块大一点"写成可追溯、可清除的样式覆盖 |

生成器和验收器之间有一份**契约**（`data/conventions.json` 的 `contract`）：游戏必须带 `data-sm="start|score|restart"` 标记，并暴露 `window.__sm.start()/getScore()/restart()/isRunning()`。有了契约，验收才是确定性的。

### 读多少

token 是用户的钱。每次做游戏，模型从开工到写代码读到的字符数（脚本量的，真实 token 数没法在这里量）：

| | v0.5 | v0.6 |
|---|---|---|
| 每次必读（协议 + 入口 + 清单） | 约 14100 | 约 6170 |
| 加上记忆、判断信号、两条选中的条目 | 约 2.1 万 | **8151**（第六轮实测）/ 8768（自动测试） |
| 需要提问的路径（多读问题库和问法） | — | 11450，**超出 9000 的预算，没做到** |
| 每次对话开头加载的规矩 | 无 | 420（没规矩时）/ 563（12 条规矩时） |

做法：协议里只有每次都要用的；问题库、诊断清单、修改流程拆成按需读的文件；读单条时不输出出处网址；记忆最多带 8 条偏好、3 条案例、3 条坑。

## 核心原则

1. **判断交给模型，确定性交给脚本。** 验收一律跑脚本，然后看截图。绝不相信"我做完了、能跑"。
2. **脚本验"能不能用"，截图验"对不对"。** 没在截图里看见的机制，不算过。
3. **惯例是选项库，不是规则。** 用户要复古，emoji 就是对的。库不够用就合成一个，用户认可后加回库里。
4. **判断不准就问，问的是画面不是技术。** "像现在的休闲游戏还是像小时候的像素游戏"比"你想要什么风格"有效十倍。
5. **对用户不说术语。** 不说"响应式布局"，说"手机上不会乱"。
6. **记忆跟着用户走，不跟着项目走。** 项目日志只用来算指标；规矩、偏好、坑、案例放进用户自己的记忆库，换项目、换工具都带得走。
7. **能自动记的和要点头的分开。** 偏好和坑自动记但告知；规矩和惯例先提候选，用户点头才生效。记错了说一句"忘掉"就删。
8. **每次都读的东西按字符算账。** 协议 ≤3000 字符，入口 ≤2000，规矩 ≤12 条；新增内容前先想能不能改成按需读。
9. **看图自检要留痕。** 看了什么、哪里不对，写下来才能交付。
10. **惯例库公开、可贡献、带出处。** 没公开依据的如实标 `internal`。

## 路线图

- [x] v0.1 — 规格协议 + 惯例库 + 静态验收器 + 样式补丁器
- [x] 真实浏览器验收，一键安装浏览器环境
- [x] v0.3 — 惯例库改为**选项库 + 判断指南**，"太丑/不好玩"先诊断再回来问
- [x] v0.4 — 库拆分、每条带出处、库校验器、贡献指南
- [x] v0.5 — **经验库**（偏好 / 坑 / 案例）；玩法库、受众库；按需读库；自检不留痕不能交付
- [x] v0.6 — **记忆内核**（规矩 / 偏好 / 坑 / 惯例 / 候选，跨项目跨工具）；协议瘦身，读取量减半并可量；一条命令安装 + 自检 + 撤销
- [ ] v0.7 — 在新对话里验证"每次加载"在各工具里真的生效；把需要提问的路径也压到 9000 以内；第二个干活 skill，验证记忆内核不是只为游戏服务
- [ ] 之后 — 自动试玩出难度曲线；分享链接；接入用户自己的题目和图片；Windows 验证；把验收器抽成可选的 MCP server

## Dogfood 日志

每次用 SayMake 从一句话做出一个东西，卡在哪里、改了什么，都记在 [`docs/dogfood-log.md`](docs/dogfood-log.md)。设计说明在 [`docs/design.md`](docs/design.md)。

## 它做不到什么

- skill 只在被叫到时生效。用户得说"做个游戏"，或者工具自己判断该用它。
- 模型不会变聪明。记忆让同一个错少犯，不让判断力变强。
- 记错会一直错，直到用户说"忘掉"。所以规矩要用户点头，偏好记了要告知。
- 不做聊天壳、不做模型路由、不做提示词模板库。
- 不追求"一次就完美"，追求**可预期、可纠正、越用越懂你**。

## 参与贡献

惯例库是公开的，欢迎往里加。作者不是专业游戏开发者——做过很多游戏、很多产品的人知道的"这种东西一般怎么做、为什么"，正是这个库最缺的。

- **加一条惯例**：新的视觉方向、玩法、机制、受众做法、判断案例、反模式。要带出处，具体到能照着做
- **补出处**：库里标 `internal` 的条目是摸索出来的；知道它来自哪里就提 PR 补上
- **放一个例子**：在 `examples/` 里放一个你用 SayMake 做出来的小游戏，连同你当时说的那句话
- **报"没装上"**：装到列表以外的 AI 工具、或者 Windows 上，不管成没成都开个 issue

格式、出处怎么写、提 PR 前跑什么，见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## License

MIT

---

**English (short):** SayMake is an open-source AI Skill that turns a one-sentence idea from a non-coder into a self-validated, single-file HTML mini-game with precise natural-language edits — and remembers the user across projects and AI tools. Prompts do the judgment; scripts do the verification. One command installs it into Claude Code, Codex or Doubao; rules go in only with the user's approval.
