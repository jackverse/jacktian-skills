# 全局规范

> **本文件是源头**（`D:\code\0X-SKILLS\AGENTS.md`，随本仓库 git 管理与多机同步）。
> 用户级 `~/.zcode/AGENTS.md` 由 `tools/sync.ps1` 从本文件拷贝生成（Windows 文件符号链接需管理员权限，故用拷贝）。
> **修改全局规范：改本文件 → 跑一次 sync.ps1 → 提交推送**，不要直接改用户级副本（会被下次同步覆盖）。

- **不要重启/停起任何本地服务来做测试**（后端 spring-boot:run、前端 dev server 等，含杀掉用户已在运行的实例）：前端后端服务的重启一律由用户自己完成。需要联调验证时，改完代码后告知用户需要重启哪个服务，或仅针对用户当前已在运行的服务做只读验证（curl / 浏览器访问）。

## 可复用技能沉淀（0X-SKILLS）

- **触发**：完成大型或中小型任务后，若过程中沉淀出可复用的技能（脚本、生成管线、调试流程、踩坑经验等；判断标准：换个项目/代码库仍然适用），就要整理成 skill。
- **存放**：统一维护到个人技能仓库 `D:\code\0X-SKILLS`，目录约定 `skills/<skill-name>/SKILL.md`（YAML frontmatter：name、description）+ 可选 `scripts/`、`references/`。
- **执行方式**：由**后台子 agent** 维护（Agent 工具，`run_in_background: true`），不要在主对话里同步整理，避免影响开发。整理前先浏览 `D:\code\0X-SKILLS\skills\` 查重，已有同类 skill 则更新而非新建。主对话收尾时向用户转述一句沉淀安排即可。
- **记录**：子 agent 完成 skill 创建/更新后，最后一步在 `D:\code\0X-SKILLS\LOG.md` 追加一行台账（格式：`| 日期 | skill | 增/改 | 一句话说明 |`），记录沉淀时间。
- **生效**：新 skill 需运行 `powershell -ExecutionPolicy Bypass -File D:\code\0X-SKILLS\tools\sync.ps1` 建立 junction（幂等；已链接的 skill 编辑即生效，无需重跑）。
- **边界**：不要擅自 git commit/push 到该仓库，是否提交由用户决定；技能内容不得包含密钥或项目敏感数据。
