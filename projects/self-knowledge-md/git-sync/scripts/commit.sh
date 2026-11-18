#!/usr/bin/env bash
# commit.sh —— self-knowledge-md 提交并推送（一个改动一个 commit）
# 用法: commit.sh -m "feat(hub): xxx" [路径...]   只提交指定路径（推荐）
#       commit.sh -m "docs(notes): xxx"           不给路径 = git add -A（会扫全仓，慎用）
#       commit.sh -m "msg" --no-push              只提交不推送
# 环境变量: REPO_ROOT（默认 /d/jack/self-knowledge-md）、GIT_BIN（默认 /d/workplace/Git/bin/git.exe）
# 退出码: 0 成功 / 1 commit 失败 / 2 参数错误 / 3 已提交但推送失败
set -uo pipefail

REPO="${REPO_ROOT:-/d/jack/self-knowledge-md}"
GIT="${GIT_BIN:-/d/workplace/Git/bin/git.exe}"
cd "$REPO" 2>/dev/null || { echo "!! 仓库不存在: $REPO"; exit 1; }

msg=""; push=1; paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) msg="${2:-}"; shift 2 ;;
    --no-push)    push=0; shift ;;
    -h|--help)    sed -n '2,8p' "$0"; exit 0 ;;
    *)            paths+=("$1"); shift ;;
  esac
done
[ -z "$msg" ] && { echo "!! 缺少提交信息：commit.sh -m \"...\" [路径...]"; exit 2; }

if [ ${#paths[@]} -gt 0 ]; then
  "$GIT" add -- "${paths[@]}" || { echo "!! git add 失败"; exit 1; }
else
  echo "== 未指定路径 → git add -A（全仓）"
  "$GIT" add -A
fi

if "$GIT" diff --cached --quiet; then
  echo "== 没有可提交的改动"
  "$GIT" status --short --branch
  exit 0
fi

echo "== 待提交:"
"$GIT" -c core.quotepath=false diff --cached --stat

if ! "$GIT" commit -q -m "$msg"; then
  echo "!! commit 失败"
  exit 1
fi
echo "== 已提交 $("$GIT" log -1 --format='%h %s')"

if [ $push -eq 1 ]; then
  if "$GIT" push origin "$("$GIT" rev-parse --abbrev-ref HEAD)" 2>&1; then
    echo "== 已推送"
  else
    echo "!! 推送失败（本地提交已保留，下次补推）"
    exit 3
  fi
fi
"$GIT" status --short --branch
