# jacktian-skills

个人 Skill 中心:集中管理我的 ZCode / Agent skills,Git 版本管理,GitHub 多机同步。

## 目录结构

```
AGENTS.md           # 全局规范源头(~/.zcode/AGENTS.md 由 sync.ps1 从此拷贝)
skills/             # 通用技能,按分类归档(分类规则见各分类目录 README)
  word/                       # Word 文档类
  frontend/                   # 前端类
    vue3/ vite/ browser-tuning/   # 按框架/工具/主题细分,版本互斥再建版本子目录
  <分类>/<skill-name>/
    SKILL.md          # 必需:YAML frontmatter (name, description) + 正文
    references/       # 可选:按需加载的详细文档
    scripts/          # 可选:辅助脚本
projects/            # 项目专用技能(按项目键归档,链接到对应项目的 .zcode/skills 生效)
tools/
  sync.ps1            # Windows 同步脚本(推荐):递归发现+建 junction+AGENTS.md 拷贝
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

### word — Word 文档类

| Skill | 功能 | 入口 |
|-------|------|------|
| word-toolkit | 通用 docx 处理:模板批量生成 / 修订版反向对齐 / ::IMG:: 图片回填 / 格式异常排查(15+ 踩坑) / docx→PDF→PNG 渲染校验 | [SKILL.md](skills/word/word-toolkit/SKILL.md) |
| quest-poi-tl-word-export | quest 导出任务 + poi-tl 从 docx 样例生成 Word 报告(按表/行/列挖占位符、11 条坑) | [SKILL.md](skills/word/quest-poi-tl-word-export/SKILL.md) |

### frontend — 前端类

**vue3/**

| Skill | 功能 | 入口 |
|-------|------|------|
| vue-hash-to-history | vue-router 4 hash 模式切 history 模式改造 checklist(SSO 回调、刷新 404、旧链接兜底、nginx 回退) | [SKILL.md](skills/frontend/vue3/vue-hash-to-history/SKILL.md) |

**vite/**

| Skill | 功能 | 入口 |
|-------|------|------|
| vite-dep-worker-import | Vite dev 依赖预构建遇 `?worker` 导入崩溃的排查与修复(optimizeDeps.exclude 等) | [SKILL.md](skills/frontend/vite/vite-dep-worker-import/SKILL.md) |

**browser-tuning/（浏览器调优）**

| Skill | 功能 | 入口 |
|-------|------|------|
| browser-anim-screenshot-verify | 截图视觉验证失真排查:入场动画冻结帧、截图发白、getAnimations 快进 | [SKILL.md](skills/frontend/browser-tuning/browser-anim-screenshot-verify/SKILL.md) |
| browser-interaction-verify | 内嵌浏览器行为验证失真:滚动/rAF/定时器/点击超时的判别与替代验证法 | [SKILL.md](skills/frontend/browser-tuning/browser-interaction-verify/SKILL.md) |

> 项目专用技能在 `projects/` 下按项目归档,不在此列。

<!-- 沉淀新能力后按分类在此登记,与各分类 README 保持一致 -->

沉淀历史(何时建/改、为什么)见 [LOG.md](LOG.md)。

