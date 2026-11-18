---
name: git-sync
project: D:\jack\self-knowledge-md
description: 该笔记仓库的拉取/提交推送一键脚本（scripts/pull.sh、scripts/commit.sh）。当用户说"拉下代码""拉取""提交""推上去""commit 一下""这个项目改动完就提交"时使用。
---

# Skill: git 拉取 / 提交推送

**一句话**：拉代码跑 `pull.sh`，改完跑 `commit.sh -m "..."`，一个改动一个 commit，能推就推。

## 何时用

- 用户说"拉下代码""同步一下远端""看看有没有更新" → `pull.sh`
- 用户说"提交""commit 一下""推上去""这个项目改动完就提交" → `commit.sh`
- 任何**在本仓库产生文件改动**之后（笔记、hub 代码、脚本）→ 收尾必跑 `commit.sh`

## 命令速查

脚本位置（skill 内，不落项目仓库）：

```
D:\code\0X-SKILLS\projects\self-knowledge-md\git-sync\scripts\pull.sh
D:\code\0X-SKILLS\projects\self-knowledge-md\git-sync\scripts\commit.sh
```

用本机 git 自带的 bash 跑（PowerShell 里）：

```powershell
& 'D:\workplace\Git\bin\bash.exe' 'D:\code\0X-SKILLS\projects\self-knowledge-md\git-sync\scripts\pull.sh'
& 'D:\workplace\Git\bin\bash.exe' 'D:\code\0X-SKILLS\projects\self-knowledge-md\git-sync\scripts\commit.sh' -m "feat(hub): xxx" tools/hub/hub.py
& 'D:\workplace\Git\bin\bash.exe' 'D:\code\0X-SKILLS\projects\self-knowledge-md\git-sync\scripts\commit.sh' -m "docs(notes): xxx" --no-push
```

- `pull.sh [--rebase]`：先打当前分支/HEAD，`pull --ff-only`，再打印「已是最新 / 更新了哪些提交」，最后给 `status`。
- `commit.sh -m "msg" [路径...]`：只 add 指定路径 → 打印待提交 stat → commit → push 当前分支 → 给 `status`。
- 不给路径 = `git add -A` 全仓扫，**有别人在途改动时别这么用**。
- 退出码：`0` 成功 / `1` commit 失败 / `2` 参数错误 / `3` 已提交但推送失败（本地已留，下次补推）。

## 提交规范（沿用 AGENTS.md）

1. **一个改动一个 commit**，别攒着批量提交
2. 消息写清做了什么，前缀 `feat(hub):` / `fix(bill):` / `docs(notes):` / `chore:`
3. 提交前先看 `git status` 全量，别漏掉重建的 exe、截图、打包产物
4. 推送失败不阻塞本地提交，下次补推
5. **不替别人提交**：仓库里若有其他会话正在写的文件（如 hub 的未完成页），只提交自己动过的路径

## 环境与踩坑

- git 一律用 `D:\workplace\Git\bin\git.exe`（脚本内已固定，可用 `GIT_BIN` 覆盖），仓库根可用 `REPO_ROOT` 覆盖
- **DSH 沙箱**：`workspace-write` 模式下 msys 建不了命名对象，`pull`/`push` 会报 `NtCreateDirectoryObject ... 0xC0000022` + `Could not read from remote repository`；`git status`/`log` 这类纯本地命令不受影响 → 需要网络操作时在 `danger-full-access` 下跑（或本会话已是该模式）
- 远端是 `git@ssh.github.com:jackverse/self-knowledge-md.git`（443 口），不是 github.com 默认 22
- 中文路径/文件名显示乱码时加 `-c core.quotepath=false`（脚本已加）
- push 的进度输出走 stderr，PowerShell 会当 NativeCommandError 报红并给 exit 1 —— **看输出里的 `-> main` 才是真结果**，别被退出码误导
