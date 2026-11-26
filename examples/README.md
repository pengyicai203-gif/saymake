# 示例

每个子目录是一个用 SayMake 从一句话做出来的小游戏，必须始终通过验收器。

| 目录 | 用户当时说的那句话 |
|---|---|
| `tap-the-dot/` | "我想做一个点泡泡的小游戏，手机上玩，泡泡出现就点。" |

## 验收

```bash
node ../../skills/make-game/scripts/validate_game.mjs tap-the-dot/index.html
```

## 提交你的示例

新建一个目录，放 `index.html`，在上表加一行你当时说的原话。那句话比代码更有价值——它记录了一个不懂代码的人是怎么描述需求的。
