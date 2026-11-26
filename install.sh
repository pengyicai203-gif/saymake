#!/usr/bin/env bash
# SayMake 一键安装（需要 Node.js 18+ 和 git）
#   从克隆下来的仓库运行：  bash install.sh
#   不克隆直接装：          curl -fsSL https://raw.githubusercontent.com/pengyicai203-gif/saymake/main/install.sh | bash
#   只看会做什么：          加 --dry-run        只装到某个工具：加 --tools claude,doubao
#   撤销：                  加 --uninstall
set -euo pipefail

command -v node >/dev/null 2>&1 || { echo "需要 Node.js 18 以上：https://nodejs.org"; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
if [ -f "$here/core/install.mjs" ]; then
  DIR="$here"                                   # 在克隆的仓库里运行
else
  command -v git >/dev/null 2>&1 || { echo "需要 git：https://git-scm.com"; exit 1; }
  DIR="$HOME/.saymake/repo"
  if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only >/dev/null 2>&1 || echo "（仓库拉取失败，用本地已有的那份继续）"
  else mkdir -p "$HOME/.saymake" && git clone --depth 1 https://github.com/pengyicai203-gif/saymake.git "$DIR"; fi
fi

exec node "$DIR/core/install.mjs" "$@"
