#!/usr/bin/env bash
# 将仓库 skills/ 下的所有 skill 链接到 ZCode 用户级 skill 目录 (Git Bash 版)
# 用法: bash tools/sync.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"
TARGETS=("$USERPROFILE/.zcode/skills")

for target_dir in "${TARGETS[@]}"; do
  mkdir -p "$target_dir"
  for skill in "$SKILLS_SRC"/*/; do
    name="$(basename "$skill")"
    link="$target_dir/$name"
    if [ -e "$link" ]; then
      echo "[skip ] $name 已存在: $link"
      continue
    fi
    win_link=$(cygpath -w "$link")
    win_target=$(cygpath -w "$skill")
    powershell -NoProfile -Command \
      "New-Item -ItemType Junction -Path '$win_link' -Target '$win_target' | Out-Null"
    echo "[link ] $name -> $link"
  done
done
echo "完成。"
