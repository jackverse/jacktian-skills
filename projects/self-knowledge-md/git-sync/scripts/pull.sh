#!/usr/bin/env bash
# pull.sh —— self-knowledge-md 一键拉取最新代码
# 用法: pull.sh            等价 git pull --ff-only
#       pull.sh --rebase   改用 --rebase
# 环境变量: REPO_ROOT（默认 /d/jack/self-knowledge-md）、GIT_BIN（默认 /d/workplace/Git/bin/git.exe）
set -uo pipefail

REPO="${REPO_ROOT:-/d/jack/self-knowledge-md}"
GIT="${GIT_BIN:-/d/workplace/Git/bin/git.exe}"
cd "$REPO" 2>/dev/null || { echo "!! 仓库不存在: $REPO"; exit 1; }

branch=$("$GIT" rev-parse --abbrev-ref HEAD)
before=$("$GIT" rev-parse --short HEAD)
echo "== 仓库: $REPO"
echo "== 分支: $branch  HEAD: $before"
[ -n "$("$GIT" status --porcelain)" ] && echo "== 注意: 本地有未提交改动"

if [ "${1:-}" = "--rebase" ]; then
  out=$("$GIT" pull --rebase 2>&1); rc=$?
else
  out=$("$GIT" pull --ff-only 2>&1); rc=$?
fi
echo "$out"

if [ $rc -ne 0 ]; then
  echo "!! 拉取失败（rc=$rc）"
  echo "   - 报 0xC0000022 / NtCreateDirectoryObject: DSH 沙箱拦了 msys 命名对象，改用 danger-full-access 跑"
  echo "   - 连不上远端: ssh -T git@ssh.github.com 自检"
  exit 1
fi

after=$("$GIT" rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
  echo "== 已是最新（$after）"
else
  echo "== 更新 $before -> $after，新提交:"
  "$GIT" -c core.quotepath=false log --oneline "$before..$after"
fi
"$GIT" status --short --branch
