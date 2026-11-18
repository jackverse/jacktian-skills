# backend — 后端类

Java 后端通用技能:构建工具链、编译/调试流程、后端排障方法。当前平铺,子目录多了再按工具/主题分层(参照 frontend/ 的约定)。

| Skill | 定位 |
|-------|------|
| maven-wip-compile-verify | 工作区他人/前次会话的 WIP(未完成)文件挡住 Maven 模块编译时,用 git stash 临时排除、只验证自己改动、pop 完整还原的只读验证流程 |
| config-table-redis-write-through | 业务配置表+Redis 写穿透+fanout 广播同步+启动预热+结构化配置管理页的完整套路 |
| aop-field-change-record | 后台业务数据「字段级修改记录」切面化方案:审计表一行=一个字段变更+方法级/字段级双注解+@Around 切面旧快照↔新值 diff 落库,含新增漏记/逻辑删/JSON 拍平等七条设计决策 |

新沉淀的后端相关 skill 放本目录;绑定单个项目的构建/安装脚本不放这里,放 `projects/<项目键>/`(如 startup 的 maven-build)。
