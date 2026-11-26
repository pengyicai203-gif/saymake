---
name: saymake
description: 让 AI 越来越懂这个用户的记忆内核。三类时候用：(1) 任何任务开工前，先查他立过的规矩、偏好、以前踩过的坑；(2) 用户说"记住""忘掉""你记得我什么""看看你记了什么""以后都……"；(3) 任何任务收尾时，把这次学到的、下次还用得上的记下来。记的都是本机纯文本，用户可以看和删。规矩和惯例要先问他点头。
---

# saymake：记住这个用户

记忆存在本机 `~/.saymake/memory/`，跨项目、跨 skill，纯文本。你的模型不会变聪明，但你会少犯同一个错。`<m>` = `node <本文件所在目录>/scripts/log.mjs`。

没有命令行的宿主：直接读 `~/.saymake/memory/` 下的 `rules.json`、`profile.json`、`lessons.jsonl`，要记的直接追加写。

## 开工（任何任务）

```bash
<m> recall --brief "用户这次的话"
```

带出：规矩、偏好、他自己加的惯例、相似的做法及其结果、相关的坑。**先读它再动手。** 和这次的话冲突时，以这次的话为准，并更新那条记忆（偏好用 `remember --replaces`）。

## 收尾（任何任务，不是可选项）

1. 想三件事，各最多一条：他这次流露的口味、他被什么绊了一下、他纠正了我什么。
2. 分类记：

| 是什么 | 例子 | 怎么记 | 要不要先问 |
|---|---|---|---|
| 偏好 | "字要大""直接做，少问" | `remember --kind preference --text "…"` | 不用，但告诉他记了什么 |
| 坑 | "emoji 在像素风里跳出来 → 自己用方格拼" | `remember --kind lesson --problem "…" --cause "…" --fix "…" --tags …` | 不用 |
| 规矩 | "先给方案，我点头再做" | `propose --kind rule --text "…" --why "…"` | **要**，他点头才 `accept <id>` |
| 惯例 | 某个 skill 里可复用的做法 | `propose --kind convention --text "…" --why "…"` | **要** |

3. 有候选就用大白话问一次：`<m> candidates` → "我想记住一条：……可以吗？" 同意 `accept <id>`，不要 `reject <id>`。规则最多 12 条、每条一句话，因为每次对话都要读它。
4. 收尾一句话：**"我记住了：……想看或删掉，说'看看你记了什么'。"**

判断是不是偏好：这次项目特有的要求不算，反复出现或他主动说的口味才算。拿不准就 `propose`，不直接 `remember`。记错了他说一次"忘掉"就删。

## 他说"看看你记了什么" / "忘掉那条"

```bash
<m> show              # 全部，带 id
<m> forget <id>       # 删任何一条：偏好、坑、规矩、惯例、候选
<m> rule list | rule add --text "…" | rule remove <id>
```

## 做游戏等具体任务

干活 skill（如 make-game）会通过自己的入口调用这里：`start / judge / ask / generate / selfcheck / deliver / feedback / resolve / summary / cost`。**没有通过的自检就不能 `deliver`**，这是设计如此。

## 你所在的工具自带偏好记忆时

规矩被 `accept` 后，除了写进文件，再用那个工具的偏好记忆接口存同一句话（豆包是 `manage_preference`）。文件保证换工具也带得走，接口保证这次对话就生效。删规矩时两边一起删。

## 安装与自检

```bash
bash install.sh          # 认出本机 AI 工具并装好；--dry-run 只看不做；--uninstall 撤销
<m> doctor               # 各工具是否装好、每次加载是否同步
<m> refresh              # 规矩变了之后同步（Codex 这类复制粘贴的文件需要）
<m> inject               # 打印每次对话开头加载的那一段
```

能做到的：记住用户、规矩越用越合身、经验跨项目累积。做不到的：只在被叫到时生效；模型不会变聪明；记错会一直错，直到他说"忘掉"。
