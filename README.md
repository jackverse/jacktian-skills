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
| vue-detail-seamless-scroll | 看板明细限高自动慢滚+滚轮手动快滚+无缝循环的原生滚动指令模式与取整/误判坑 |
| gsap-to-waapi-scroll-reveal | GSAP 滚动入场/交错/hover 回弹到 WAAPI+IO+CSS 的无依赖迁移，含防闪现、播完释放与 reduced-motion |
| quest-collect-task | quest starter 采集任务（collect_task）接入：CollectServiceImpl 双签名、rawStream 原始流透传、TB_QUEST_CONFIG 登记规则、上传体积双上限坑 |
| vue-page-section-extract-dual-mode | Vue 长页板块抽组件+嵌入/独立双形态复用（number/limit/moreTo props、组件自持依赖、竞态 token 隔离、hash 路由新标签、pageStatMap 登记） |

<!-- 新增 skill 后在此登记一行 -->

沉淀历史见 [LOG.md](LOG.md)。

