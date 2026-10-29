# 全局规范

> **本文件是源头**（`D:\code\0X-SKILLS\AGENTS.md`，随本仓库 git 管理与多机同步）。
> 用户级 `~/.zcode/AGENTS.md` 由 `tools/sync.ps1` 从本文件拷贝生成（Windows 文件符号链接需管理员权限，故用拷贝）。
> **修改全局规范：改本文件 → 跑一次 sync.ps1 → 提交推送**，不要直接改用户级副本（会被下次同步覆盖）。

- **不要重启/停起任何本地服务来做测试**（后端 spring-boot:run、前端 dev server 等，含杀掉用户已在运行的实例）：前端后端服务的重启一律由用户自己完成。需要联调验证时，改完代码后告知用户需要重启哪个服务，或仅针对用户当前已在运行的服务做只读验证（curl / 浏览器访问）。

## 可复用技能沉淀（0X-SKILLS）

- **触发**：完成大型或中小型任务后，若过程中沉淀出可复用的技能（脚本、生成管线、调试流程、踩坑经验等；判断标准：换个项目/代码库仍然适用），就要整理成 skill。
- **存放**：统一维护到个人技能仓库 `D:\code\0X-SKILLS`，**区分通用与专用两类目录**：
  - **通用**（换个项目仍然适用）：`skills/<分类>/<skill-name>/SKILL.md`（YAML frontmatter：name、description）+ 可选 `scripts/`、`references/`；sync.ps1 递归发现后链接到用户级 `~/.zcode/skills`（平铺，skill 目录名=name 不变），所有项目可见。**分类目录**现用：`word/`、`frontend/{vue3,vite,browser-tuning}`，跨版本互斥经验再建版本子目录（如 `vite/vite4/`）；新类目建目录并在该目录 README.md 登记范围，规则见 `skills/frontend/README.md`。
  - **专用**（绑定单个项目，如该项目的构建/安装脚本、专属管线）：`projects/<项目键>/<skill-name>/SKILL.md`，frontmatter 额外声明 `project: <项目根绝对路径>`（如 `project: D:\code\startup`）+ 可选 `scripts/`、`references/`；sync.ps1 据此链接到**该项目**的 `.zcode\skills`，仅该项目可见、不污染其他项目。**项目专用脚本一律放 skill 的 `scripts/` 内，不要落进项目仓库**（如装依赖/构建包装脚本）。
- **执行方式**：由**后台子 agent** 维护（Agent 工具，`run_in_background: true`），不要在主对话里同步整理，避免影响开发。整理前先浏览 `D:\code\0X-SKILLS\skills\` 与 `projects\` 查重，已有同类 skill 则更新而非新建。主对话收尾时向用户转述一句沉淀安排即可。
- **记录**：子 agent 完成 skill 创建/更新后，最后一步在 `D:\code\0X-SKILLS\LOG.md` 追加一行台账（格式：`| 日期 | skill | 增/改 | 一句话说明 |`），记录沉淀时间。
- **生效**：新 skill 需运行 `powershell -ExecutionPolicy Bypass -File D:\code\0X-SKILLS\tools\sync.ps1` 建立 junction（幂等；已链接的 skill 编辑即生效，无需重跑）。
- **边界**：不要擅自 git commit/push 到该仓库，是否提交由用户决定；技能内容不得包含密钥或项目敏感数据。
