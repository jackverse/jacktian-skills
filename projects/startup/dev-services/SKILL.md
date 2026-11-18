---
name: dev-services
project: D:\code\startup
description: startup 项目本地五个服务（admin/task/pub 后端 + admin-web/pub-web 前端）的启动/停止/重启/状态/等待就绪专用脚本 dev-services.sh。当用户要求启动/运行/重启/关闭/停掉 admin、task、pub、admin-web、pub-web（单独或全部）、问服务起没起、要等后端就绪、或 spring-boot:run 报 ip2region/Searcher/xdb 与 `$` 前缀路径解析失败时使用。一律走本脚本，不要手工拼 mvn/npm 后台命令。
---

# Skill: startup 本地服务一键管理（dev-services.sh）

> 专用 skill（绑定 startup 项目，脚本在 `scripts/` 内，不落项目仓库；`startup/.zcode/` 已 gitignore）。
> 脚本经 `D:\code\0X-SKILLS\tools\sync.ps1` junction 到 `D:\code\startup\.zcode\skills\dev-services\scripts\dev-services.sh`。

## 何时使用

- 用户要求启动/重启/关闭 admin、task、pub、admin-web、pub-web（含"帮我跑起来""停掉 pub"这类口语）。
- 需要确认服务状态、阻塞等待后端就绪、翻启动日志。
- 后端 spring-boot:run 启动失败：报缺 `org.lionsoul.ip2region.xdb.Searcher` bean / `$\doc\xdb\ip_merge_20240226_final.xdb` 找不到路径——本脚本已用系统属性覆盖解决，直接用脚本。

## 用法（任意目录可执行）

```bash
bash D:/code/startup/.zcode/skills/dev-services/scripts/dev-services.sh status   # 先看状态
bash .../dev-services.sh start all            # 五个全启动
bash .../dev-services.sh restart admin        # 重启单服务
bash .../dev-services.sh stop pub-web         # 停单服务
bash .../dev-services.sh wait admin 600       # 阻塞等端口就绪（秒）
bash .../dev-services.sh log admin 100        # 看日志末 100 行
bash .../dev-services.sh build admin task pub # 后端 install（走 maven-build 的 mvn-install.mjs）
```

服务与端口：admin→8080(`/startup-admin`)、task→8089(`/startup-task`)、pub→8090(`/startup-pub`)、admin-web→8001、pub-web→18090。

## 关键约定与坑

1. **后端启动命令**：`mvn -pl startup-<x> spring-boot:run`，脚本自动带
   `-Dspring-boot.run.jvmArguments="-Dregion.file.path=D:/code/startup/doc/xdb/ip_merge_20240226_final.xdb -Dlocal.file.path=D:/code/startup/upload"`。
   原因：dev 配置 `local.file.path`/`region.file.path` 用 `$` 前缀约定，starter `RelativePathParser` 靠锚点类文件系统位置找 `*-common` 模块段推工作区根；IDE 下锚点类来自 `target\classes` 能解析，命令行 spring-boot:run 下 startup-common 从本地仓库 **jar** 加载 → `$` 原样返回 → pub 硬依赖 Searcher bean 直接启动失败（admin 只降级警告）。系统属性优先级高于 yml，效果同 IDE。**用户在 IDE 重启不需要此参数。**
2. **前置条件**：本地仓库需有 `startup-common`/`startup-database` 产物（脚本启动前自检并提示 `build`）；改了 common/database 后也要重新 build。本模块自身无需预装——spring-boot:run 会现场编译。
3. **stop 语义**：杀端口占用进程 + mvn launcher（PowerShell 按 `-pl startup-<x> spring-boot:run` 命令行匹配，/T 杀树），**会误杀 IDE 里手工启动的同端口实例**——确认用户意图后再 stop。
4. **就绪耗时**：后端 3~5 分钟（git-commit-id 慢 + 190MB xdb 载入内存，pub 首启约 200s）；vite 冷启动 2~4 分钟（本机杀软扫描慢）。判断就绪一律用 `wait`/`status`（端口监听），不要用"Started xxx"日志文本判断。
5. **pub-web**：vite 配置 `open:true`，启动会自动弹浏览器；代理 `/startup-pub` → 8090。
6. **日志**：`D:/code/startup/.zcode/dev-services-logs/<服务名>.log` 追加写，`log` 子命令翻看。
7. **clean 卡死教训**：构建时 Maven 偶发卡死在删 `startup-pub\target`（零 CPU 零网络 10 分钟+），处理：停任务 → `taskkill` maven JVM → 手动 `rm -rf target` → 重建，即可恢复。
8. **ZCode 沙箱 netstat 不可信**：本沙箱内 `netstat -ano` / `Get-NetTCPConnection` 看不到 LISTENING 条目（只剩 PID 0 假行，ESTABLISHED 反而可见真实 PID）——**端口探测一律 curl TCP**，**杀进程一律 PS `Get-CimInstance` 按 `Name`+`CommandLine` 匹配**（必须带 Name 过滤，否则 powershell 自身命令行含模式串会自杀）。脚本已内置这两条，不要再绕回 netstat。
9. **PS 杀进程两个坑**：① `Win32_Process` 的属性是 `ProcessId`，没有 `.Id`（取到 null，taskkill 报"缺 /PID 值"）；② PS 5.1 内联 `taskkill /PID $_.xxx` 展开不稳，必须先落中间变量 `$id`。WMI 进程枚举偶发漏进程，杀完以端口不再应 HTTP 为准。
10. **端口探测必须严格 curl 退出码 0**：杀进程后的过渡态 TCP 能连上但立刻断（退出码 56），非 0 判定会把假监听当"已在运行"导致 start 跳过/restart 空转；stop 后要轮询等端口停止应答再报成功。
