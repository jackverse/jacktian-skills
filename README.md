# jacktian-skills

个人 Skill 中心:集中管理我的 ZCode / Agent skills,Git 版本管理,GitHub 多机同步。

## 目录结构

```
skills/
  <skill-name>/
    SKILL.md          # 必需:YAML frontmatter (name, description) + 正文
    references/       # 可选:按需加载的详细文档
    scripts/          # 可选:辅助脚本
    assets/           # 可选:模板、示例等
tools/
  sync.ps1            # Windows 同步脚本(推荐)
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

## Skills 列表

| Skill | 说明 |
|-------|------|
| word-template-docs | 按既有 Word 模板批量生成格式一致的新文档（验收四件套/方案/报告）：analyze_docx 模板版式体检 → build_docx 注入 Markdown 正文 → word2pdf 更新目录域转 PDF → pdf2png 渲染+页码单调性校验，附 10 条实战踩坑清单 |

<!-- 新增 skill 后在此登记一行 -->

沉淀历史见 [LOG.md](LOG.md)。

