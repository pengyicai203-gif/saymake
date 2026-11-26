# 参与贡献

SayMake 的代码不多，真正值钱的是**惯例库**：做过很多游戏、很多产品的人才知道的"这种东西一般怎么做、为什么"。
作者不是专业游戏开发者，所以这个库必须靠社区长起来。

## 最欢迎的三类贡献

1. **加一条惯例**（最值钱）：一个新的视觉方向、一个机制、一种字体搭配、一条反模式。要求：带出处，写得具体到能照着做。
2. **补出处**：库里标 `source.type = "internal"` 的条目是作者自己摸索的，没有公开依据。你如果知道它来自哪篇文章、哪本书、哪个游戏的访谈，提 PR 把出处补上。
3. **放一个例子**：在 `examples/` 里放一个你用 SayMake 从一句话做出来的小游戏，README 里写上你当时说的那句话。

不接受的：没出处的"我觉得好看"、和已有条目重复的、只写一句"要高级"这种没法执行的。

## 库的结构

都在 `skills/make-game/data/`：

| 文件 | 放什么 | 一条长什么样 |
|---|---|---|
| `aesthetics.json` | 视觉方向 | `feelsLike`（像什么）、`fits` / `avoid`（适合 / 不适合）、`palette`（bg / ink / accent / rule）、`typography`、`shapes`、`motion`、`assets`（主角怎么画）、`pitfalls`、`source` |
| `mechanics.json` | 机制 + 反模式 + 各玩法类型的起步组合 | `fits` / `skip`（什么时候用、什么时候别用）、`how`（具体怎么做）、`say`（对用户的一句话描述）、`source` |
| `typography.json` | 字体方向 | `stack`（只能用系统字体）、`feel`、`use`（对应哪些审美方向）、`source` |
| `genres.json` | 玩法：被验证过的核心循环 | `like`（像什么游戏）、`oneLine`（动词 + 失败条件 + 计分）、`build`（怎么做）、`defaults`（默认数值）、`dials`（难度调哪几个旋钮）、`mechanics`、`audiences`、`pitfalls`、`source` |
| `audiences.json` | 受众：给谁玩，具体改什么 | `changes`（文字 / 点按目标大小 / 失败处理 / 节奏 / 字号 / 一局时长）、`note`、`source` |
| `cases.json` | 出厂判断案例 | `brief`（用户原话）、`signals`、`chose`、`why`、`asked`、`outcome`（`hit` / `miss`）、`feedback`、`lesson`。必须是真实对话；用户没确认的结果不要写成 `hit` |
| `conventions.json` | 入口：默认值、验收项与契约、库的索引。每次做游戏必读，**总量控制在 2000 字符以内** | — |
| `guide/signals.json` | 判断指南：从用户的话里提哪些信号、冲突时谁优先、拿不准怎么办 | — |
| `guide/questions.json` | 问题库与提问预算。只在要提问时读 | — |
| `guide/diagnosis.json` | 用户说"太丑 / 不好玩"时的原因清单和问法。只在那时读 | — |

入口文件和协议（`SKILL.md`）是每次都要读的，加内容前先想清楚能不能放到按需读的文件里。判断指南在协议里对应两份说明：`references/asking.md`（要提问时）和 `references/revising.md`（要修改时）。

**玩法库最需要有实战经验的人。** 现在 11 个玩法里只有 4 个在 SayMake 里实测过（接住掉落物、打砖块、点目标、翻牌记忆），其余的"怎么做"和默认数值是摸索出来的，标了 `internal`。你做过其中任何一种，欢迎按真实数值修正。

**库是选项，不是规则。** 每条都要写清楚"什么时候不用"。用户要复古，像素和 emoji 就是对的；写一条"禁止 emoji"进来会被拒。

## 一条惯例怎么写

写之前先问自己三个问题：

1. **它解决什么问题？** 一句话说清"没有它会发生什么"。
2. **它什么时候是错的？** 写进 `avoid` / `skip`。没有反例的惯例通常是死规则。
3. **凭什么？** 见下一节。

```json
{
  "id": "fast-restart",
  "name": "一键重开",
  "fits": "一切短局游戏——行业里被称作本品类最重要的留存功能",
  "skip": "长局、剧情向",
  "how": "结束后 30 秒内能开始下一局：一个大按钮直达，没有菜单、没有过渡页、没有二次确认",
  "say": "结束就能马上再来",
  "source": { "type": "article", "ref": "https://pixelfork.ai/blog/posts/make-a-hypercasual-game-with-ai" }
}
```

- `id`：小写字母、数字、连字符，全库唯一。
- `how`：写成"照着做就能做出来"的程度。颜色给色值，时长给秒数，比例给分数。
- `say`：对不懂术语的用户怎么说这一条。协议在向用户解释和复述时会用它。
- 用户用的语言是中文，条目用中文写；英文条目也收，但 `name` 和 `say` 请给中文。

## 出处怎么写

`source` 是必填的，四种：

| type | 用在 | ref 写什么 |
|---|---|---|
| `article` / `paper` / `book` / `doc` | 公开来源 | URL（`book` 可以写书名 + 章节，但最好附链接） |
| `internal` | 项目自己摸索的，暂时没找到公开依据 | 写清楚是哪一轮、为什么这么定 |
| `dogfood` | 用户在实测里提出来、并被验证认可的 | 指向 `docs/dogfood-log.md` 的哪一轮 |

"被验证过"的含义：有公开来源，或者经过至少一次真实用户测试并且用户明确认可。两者都没有，先标 `internal`，别伪装成有出处。

## 提 PR 之前

```bash
node skills/make-game/scripts/check_library.mjs
```

它会检查：JSON 合法、id 唯一、必填字段齐、跨库引用有效（`byGameType` 引用的机制存在、字体的 `use` 对应的审美方向存在）、`source` 格式正确。改了示例或模板的话，再跑一遍验收器：

```bash
node skills/make-game/scripts/validate_game.mjs examples/<名字>/index.html --browser
```

改了记忆内核（`skills/saymake/`）、安装器（`core/`）或协议的话，再跑两套自动测试。它们只用临时目录，不碰你真实的记忆库和 AI 工具配置：

```bash
node tests/memory.test.mjs "$PWD"    # 项目流程、跨项目带出经验、候选要点头、读取量
node tests/install.test.mjs "$PWD"   # 装、重复装、同步、自检、撤销
```

## 仓库结构

```
install.sh                 一条命令安装：认出本机的 AI 工具，把下面两样放到位
core/install.mjs           安装器本体（可 --dry-run、--uninstall）
skills/saymake/            记忆内核：规矩、偏好、案例、踩过的坑，跨项目、跟着用户走
skills/make-game/          第一个干活 skill：H5 小游戏
examples/                  用 SayMake 做出来的例子
docs/                      设计说明、实测记录、测试记录
tests/                     自动测试
```

## 加一个新的干活 skill

在 `skills/<名字>/` 里放 `SKILL.md`（协议，**每次都读，控制在 3000 字符以内**）、`data/`（按需读的库）、`scripts/`。规矩：开工先 `recall`，收尾把偏好和坑 `remember`、规矩和惯例 `propose`；要记读取量就像 make-game 那样提供一个入口脚本，调用 `skills/saymake/scripts/log.mjs`。先开一个 issue 讨论要不要加。

PR 描述里写三件事：这条惯例解决什么问题、什么时候它是错的、出处是什么。

## 加一个新的品类

小游戏库里现在只有 `h5-mini-game` 一个品类。要加第二个品类（落地页、小工具……），按上一节加一个新的干活 skill，写它自己的惯例和验收项，而不是往小游戏库里塞。先开一个 issue 讨论品类边界。

## 行为准则

友善、具体、对事不对人。说"这条在 X 情况下是错的，因为 Y"，不说"这不好看"。
