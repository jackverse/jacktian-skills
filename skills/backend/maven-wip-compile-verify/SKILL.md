---
name: maven-wip-compile-verify
description: 工作区里他人/前次会话的 WIP(未完成)文件把 Maven 模块编译挡住时,只验证自己改动的只读验证技能:git stash push -u 按 pathspec 临时排除半成品及其引用文件 → 重编译 → pop 完整还原。触发场景:mvn compile 报"别人的错"、javac 报错清单全是无关 WIP 文件、半成品 Service 引用 DTO 尚不存在的 Lombok setter、编译验证被无关报错挡住、多模块 reactor 中途失败导致下游没编译到、想验证自己的改动但整个模块编译不过。凡 Maven/多模块后端改动被工作区未完成文件挡住编译验证的场景都应参考。
---

# 工作区 WIP 文件挡 Maven 编译:stash 临时排除、只验证自己的改动(maven-wip-compile-verify)

## 场景

多模块 Maven 项目,工作区里混着他人/前次会话的未完成文件(未跟踪的半成品,或已修改未提交),例如:

```
xxx/src/main/java/.../SomeWipService.java   ← 半成品,引用了 DTO 上尚不存在的 Lombok setter
```

`mvn compile` 在该模块失败,报错全是 WIP 文件的——**你本次改的文件的编译验证被挡住**。

## 为什么报错清单能定性(先看清楚再动手)

Maven reactor 按依赖序逐模块构建,maven-compiler-plugin 每轮把**该模块全部源码一次性交给 javac**,报错清单是本轮全量类型检查的结果:

- **报错清单里只有 WIP 文件的错误** → 同模块其余文件(含你的改动)已通过类型检查,本模块内不用再验证;
- **但该模块编译失败使 reactor 中止** → 依赖它的下游模块没轮到编译,你的跨模块改动**尚未被完整验证**——要补的是这个,而不是盯着 WIP 的报错修。

(反向提醒:若清单里混着你改的文件的错误,那是真错误,先修自己的,再谈本流程。)

## 操作流程(五步,全程不改任何文件内容)

### 1. 确认 WIP 类的引用面

仓库根执行:

```bash
grep -rln "SomeWipService" */src
```

列出所有引用它的文件。引用面 = 必须与 WIP 文件**一起暂存**的候选集合——只 stash WIP 本体、留下引用它的文件,模块照样编译不过。

### 2. 区分引用归属(哪些引用是 WIP 会话引入的)

对引用面中被修改的文件(对照 `git status --short` 清单),核对 HEAD 版本是否本就引用:

```bash
git show HEAD:path/to/File.java | grep -c "SomeWipService"
```

- 计数 `0` → 当前版本里的引用随 WIP 而来,把该文件恢复到 HEAD 形态(stash 对已跟踪文件的效果)即可摘干净;
- 计数 `>0` → 引用来自历史提交,说明 WIP 类曾存在,慎重——通常不动该文件,只 stash WIP 本体后重试。

注意:`git show HEAD:<path>` 的 path 用**仓库根相对路径 + 正斜杠**(Git Bash 下亦然)。

### 3. git stash push -u 临时排除(-u 连未跟踪一起收)

```bash
git stash push -u -m "temp-verify-maven" -- \
  path/to/SomeWipService.java \
  path/to/FileThatReferences.java
```

- `-u`:WIP 半成品常是**未跟踪**文件,必须带 `-u`,否则 git 根本不收、工作区里照样挡编译;
- pathspec 限定只动这几个文件,你的其余改动原样留在工作区;
- stash 前先 `git stash list` 看一眼存量:若本来就有 stash,记下数量——你这次推的是最新一条 `stash@{0}`。

### 4. 重跑编译,完成本来的验证

```bash
mvn compile
```

全绿 = 你的改动(含此前没轮到的下游模块)通过编译验证;模块多时可 `-pl <module> -am` 缩小范围。Windows 下经 node 包装脚本拉起 mvn(如 startup 项目的 maven-build 的 `mvn-install.mjs`)同样适用。

### 5. 恢复现场(成对收尾)

```bash
git stash pop         # 后进先出,刚推的就是 stash@{0}
git status --short    # 核对:WIP 文件回来了、引用文件的改动回来了、你的改动还在
```

多个 stash 时先 `git stash list` 看清索引,再 `git stash pop stash@{N}` 指定恢复;pop 会把其后的索引依次前移,逐条恢复时每条都重新看 list。

## 纪律

- **只 stash 不改内容**:绝不修改/删除/注释 WIP 文件来"绕过"编译错误——那是他人/前次会话的工作现场,验证必须是只读的。
- **push/pop 必须成对**:当次会话内完成。中途被打断也无损失——stash 列表永远能找回(`git stash list` / `git stash show -p stash@{N}`),这正是选 stash 而非移动/删除文件的根本原因。
- **pop 前别再动同批文件**:验证期间若改了 stash 涉及的文件,pop 会冲突;保持验证窗口内对这批文件零写入。
- **还原完整才算收尾**:`git status --short` 核对通过之前,不要开始下一件事。

## 别的办法为什么不行

| 方案 | 为什么不行 |
|------|-----------|
| `mvn -pl` 跳过失败模块 | 你的改动往往就在失败模块里;即使不在,下游也编译不到 |
| `mvn --fail-never` 带病继续 | 下游依赖失败模块的产物,必然连锁失败,且报错失真更有误导性 |
| 手动移动/删除 WIP 文件 | 未跟踪文件删了就没了;移动容易忘、收尾容易漏 |
| 注释掉 WIP 的引用行 | 直接篡改他人/前次会话的工作现场,违反只读纪律 |

## 边界

- 适用 Maven/多模块后端的编译验证场景;stash 手法本身与构建工具无关,Gradle 同理(reactor 中止语义不同,定性逻辑按其构建序套用)。
- Windows 下经 node 包装脚本拉起 mvn 同样适用——stash 是 git 层操作,与 mvn 如何拉起无关。
- 只解决"编译验证被挡";WIP 文件自身的问题(半成品设计、缺失成员)不在本 skill 范围。
