# SayMake

> 用人话说一句，拿到一个能直接玩的东西。
>
> Say it plainly. Get something that works.

SayMake 是一个开源的 AI Skill：不会写代码、不懂提示词工程的人，用一句自然语言描述想要的小游戏，它负责把这句话变成**明确的需求规格**、**能跑的单文件 HTML 游戏**、**自动验收**，并且支持"指哪改哪"的局部修改。

它不是一个提示词合集。仓库里真正干活的是脚本：验收器和补丁器。

## 它解决什么问题

现在的 AI 工具很强，但想让它们做出"你心里的那个东西"，你得会写精确的提示词、懂模型、懂行业惯例、看得懂术语。这些门槛对普通人来说太高了。

SayMake 的做法是把提示词工程从用户侧搬到系统侧：

- 用户只负责**说人话**
- 系统负责**补全规格**（把没说出口的假设显式化，让用户确认）
- 系统负责**填行业惯例**（八成决策不该问用户，直接给默认值）
- 系统负责**验收**（能跑、不报错、手机上不乱，这些由脚本检查，不由模型口头保证）
- 系统负责**精确修改**（"这块大一点"只改那一块）

## 五分钟试用

```bash
git clone https://github.com/pengyicai203-gif/saymake
cd saymake

# 1. （可选，推荐）装真实浏览器验收环境，装到 ~/.saymake/，不碰仓库
bash skills/make-game/scripts/setup_browser.sh

# 2. 跑验收器
node skills/make-game/scripts/validate_game.mjs examples/fruit-catch/index.html --browser
```

你会看到一份通过/不通过清单，以及 `examples/fruit-catch/.saymake/` 下两张截图：开始页和运行中的画面。把 `examples/fruit-catch/index.html` 在浏览器里打开，就是一个能玩的接水果小游戏——它和 `examples/tap-the-dot/` 一样，也是验收器的测试样本。

## 装到你的 AI 工具里

把 `skills/make-game` 整个目录复制到你 AI 工具的 skills 目录（不同工具位置不同，常见的是用户目录或工作区下的 `.skills/`）。**装完重开一个对话**，skill 列表是在会话启动时加载的。然后对它说：

> 我想做一个接水果的小游戏，手机上玩。

它会先复述一遍它理解的需求（最多追问两轮），然后生成游戏、自动验收、给你看截图、告诉你在哪、还能怎么改。

## 它怎么工作

四个部件，判断交给模型，确定性交给脚本。

| 部件 | 位置 | 形态 | 职责 |
|---|---|---|---|
| 规格补全协议 | `skills/make-game/SKILL.md` | 指令 | 最多两轮追问，每轮给选项；输出"我理解你要的是…"和三条验收标准 |
| 惯例库 | `skills/make-game/data/conventions.json` | 数据 | H5 小游戏这一品类的默认值：竖屏、30 秒到 2 分钟、点按操作、无外部依赖…… |
| 验收器 | `skills/make-game/scripts/validate_game.mjs` | 脚本 | 单文件、语法、契约标记、禁止弹窗；`--browser` 模式下真实打开页面检查报错、溢出、开始/计分/重开，并留两张截图 |
| 浏览器环境 | `skills/make-game/scripts/setup_browser.sh` | 脚本 | 一键把 playwright + Chromium 装到 `~/.saymake/`，不污染 skill 目录 |
| 补丁器 | `skills/make-game/scripts/patch_css.mjs` | 脚本 | 把"这块大一点"写成可追溯、可清除的样式覆盖，不碰其余部分 |

生成器和验收器之间有一份**契约**（见 `conventions.json` 的 `contract` 字段）：游戏必须带 `data-sm="start|score|restart"` 标记，并暴露 `window.__sm.start()/getScore()/restart()/isRunning()`。有了契约，验收才是确定性的，修改才能落到具体位置。

## 核心原则

1. **判断交给模型，确定性交给脚本。** 绝不相信模型说"我做完了、能跑"，一律跑验收器。
2. **用"过不过"替代"像不像"。** 验收标准必须是可执行、可回归的检查。
3. **用"选"替代"说"。** 人辨认想要的，比描述想要的容易得多。
4. **八十成的决策不该问用户。** 行业惯例由系统填，用户只说那两成。
5. **对用户不说术语。** 不说"响应式布局"，说"手机上不会乱"。

## 路线图

- [x] v0.1 — H5 小游戏单一品类：规格协议 + 惯例库 + 静态验收器 + 样式补丁器
- [x] 真实浏览器验收（Playwright），一键安装，两张截图作为验收证据
- [ ] v0.2 — 逻辑修改的补丁协议；用户偏好记忆；第一个外部用户试玩
- [ ] v0.3 — 第二个品类（落地页 / 小工具）
- [ ] 之后 — 把验收器、补丁器抽成可选的 MCP server，适配更多宿主

## Dogfood 日志

每次用 SayMake 从一句话做出一个东西，卡在哪里、改了什么，都记在 [`docs/dogfood-log.md`](docs/dogfood-log.md)。第一轮（接水果）的记录在那里。

## 非目标

- 不做通用提示词模板库
- 不做聊天壳、不做模型路由
- 不追求"一次就完美"，追求**可预期、可纠正、越用越准**

## 参与贡献

最欢迎的是这两类：

- 在 `data/conventions.json` 里补充某个品类真正的好默认值（这是最值钱的数据）
- 在 `examples/` 里放一个你用 SayMake 从一句话做出来的小游戏，连同你当时说的那句话

## License

MIT

---

**English (short):** SayMake is an open-source AI Skill that turns a one-sentence idea from a non-coder into a spec'd, self-validated, single-file HTML mini-game with precise natural-language edits. Prompts do the judgment; scripts do the verification.
