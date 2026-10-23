# jacktian-skills

个人 Skill 中心:集中管理我的 ZCode / Agent skills,Git 版本管理,GitHub 多机同步。

## 目录结构

```
AGENTS.md           # 全局规范源头(~/.zcode/AGENTS.md 由 sync.ps1 从此拷贝)
skills/
  <skill-name>/
    SKILL.md          # 必需:YAML frontmatter (name, description) + 正文
    references/       # 可选:按需加载的详细文档
    scripts/          # 可选:辅助脚本
    assets/           # 可选:模板、示例等
tools/
  sync.ps1            # Windows 同步脚本(推荐):skill 建 junction + AGENTS.md 拷贝
  sync.sh             # Git Bash 同步脚本
```

> 注:本仓库不保存任何密钥/API key,密钥只放本机环境变量。

## 使用方式

**本机已生效**:`skills/` 下每个 skill 通过 junction 链接到 `~/.zcode/skills/`,在仓库里直接编辑即生效,无需拷贝。

**新机器初始化**:

```powershell
git clone git@github.com:jackverse/jacktian-skills.git
cd jacktian-skills
powershell -ExecutionPolicy Bypass -File tools/sync.ps1
```

**新增 skill**:在 `skills/` 下新建目录并编写 `SKILL.md`(可用 ZCode 的 skill-creator 辅助),然后跑一次同步脚本建立链接,提交推送即可。

**修改全局规范**(AGENTS.md):改仓库里的 `AGENTS.md` → 跑一次同步脚本拷贝到 `~/.zcode/AGENTS.md` → 提交推送。用户级副本不要手改,会被覆盖。

## 功能索引(当前有哪些能力)

> 模型调度不依赖本表:ZCode 启动时自动注入每个 skill 的 name+description 作为索引,触发后由该 skill 的 SKILL.md 内部路由。本表供人浏览现状、也供模型/人跨 skill 检索。

### word-toolkit — 通用 Word/docx 技能集

| 功能 | 说明 | 入口 |
|------|------|------|
| 模板批量生成 | 按既有模板产出格式一致的验收/方案/报告/手册,含目录域重建、修订记录填写 | [references/template-generate.md](skills/word-toolkit/references/template-generate.md) |
| 修订版反向对齐 | 参考用户手工修订的 done- 版,反向优化同套其他文档 | [references/reverse-align.md](skills/word-toolkit/references/reverse-align.md) |
| 格式异常排查 | 页码断链、目录疯长、字体缩进漂移、表格变丑等 11+ 条实战坑 | [references/pitfalls.md](skills/word-toolkit/references/pitfalls.md) |
| 渲染校验 | docx→PDF→PNG,页码单调性脚本判定,残留检查 | [scripts/](skills/word-toolkit/scripts/) |

<!-- 沉淀新能力后在此按 skill 分组补行,与各 SKILL.md 路由表保持一致 -->

沉淀历史(何时建/改、为什么)见 [LOG.md](LOG.md)。

