#!/usr/bin/env bash
# 一键安装 SayMake 验收器的真实浏览器运行环境。
# 装到 ~/.saymake/（用户级），不装进 skill 目录，避免把几百 MB 的 node_modules 复制进宿主。
# 需要 Node 18+ 和 npm。重复执行是安全的。
set -euo pipefail

SM_DIR="${SM_HOME:-$HOME/.saymake}"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 18+：https://nodejs.org" >&2
  exit 1
fi

mkdir -p "$SM_DIR"
if [ ! -f "$SM_DIR/package.json" ]; then
  printf '{\n  "name": "saymake-runtime",\n  "private": true,\n  "description": "SayMake 验收器的运行环境（playwright + chromium）"\n}\n' > "$SM_DIR/package.json"
fi

echo "→ 安装 playwright 到 $SM_DIR"
( cd "$SM_DIR" && npm i playwright --no-audit --no-fund )

echo "→ 下载 chromium"
( cd "$SM_DIR" && npx playwright install chromium )

echo "✓ 完成。验收器会自动从这里找到 playwright："
echo "  node scripts/validate_game.mjs <game.html> --browser"
