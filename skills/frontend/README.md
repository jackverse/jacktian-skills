# frontend — 前端类

按框架/工具/主题细分子目录,子目录可按版本再分层:

| 子目录 | 范围 | 现有 skill |
|--------|------|-----------|
| vue3/ | Vue 3 通用(Composition API、vue-router、Pinia 等) | vue-hash-to-history |
| vite/ | Vite 构建工具链 | vite-dep-worker-import |
| browser-tuning/ | 浏览器调优:截图/交互验证失真排查、渲染性能、调试 | browser-anim-screenshot-verify、browser-interaction-verify |

## 约定

- **版本细分**:同一工具的跨版本经验不冲突时平铺在子目录下,在 SKILL.md 开头注明验证时的版本(如"基于 Vite 5 验证");出现**版本互斥**的经验时再建版本子目录(如 `vite/vite4/`、`vite/vite5/`)。
- **生效方式不变**:sync.ps1 递归发现所有 SKILL.md,在 `~/.zcode/skills/` 平铺 junction,skill 目录名(=name)必须与技能名一致,勿改。
- 新框架(如 React)沉淀时在 frontend/ 下新建平级子目录并更新本表。
