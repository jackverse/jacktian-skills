# 技能沉淀台账

> 维护规则见 `~/.zcode/AGENTS.md` →「可复用技能沉淀（0X-SKILLS）」。
> 每次创建/更新 skill 后由后台子 agent 在表末追加一行。

| 日期 | skill | 增/改 | 说明 |
|------|-------|-------|------|
| 2026-10-16 | word-template-docs | 增 | 按既有 Word 模板批量生成格式一致的新文档：analyze_docx 模板版式体检 → build_docx 注入 Markdown 正文 → word2pdf 更新目录域转 PDF → pdf2png 渲染+页码单调性校验；含 10 条实战踩坑清单（源自科创在线验收四件套项目） |
| 2026-10-16 | word-template-docs | 改 | 新增"从用户修订版反向对齐同套文档"工作流（基线重建+逐段逐表diff+改动模式探针+目录域烘焙） |
| 2026-10-16 | word-template-docs | 改 | build 新增格式原型收割（正文首行缩进2字符+run级字体复刻），修复注入段无缩进/标题字体漂移 |
| 2026-10-19 | vue-detail-seamless-scroll | 增 | 看板明细限高自动慢滚+手动快滚+无缝循环的原生滚动指令模式与取整/误判坑 |
| 2026-10-19 | gsap-to-waapi-scroll-reveal | 增 | GSAP 滚动入场/交错/hover 回弹到 WAAPI+IO+CSS 的无依赖迁移，含防闪现、播完释放与 reduced-motion |
| 2026-10-19 | quest-collect-task | 增 | quest starter 采集任务（collect_task）接入：CollectServiceImpl 双签名、rawStream 原始流透传、TB_QUEST_CONFIG 登记规则、upload-max-size 字节数与 multipart 双上限坑 |
| 2026-10-20 | vue-page-section-extract-dual-mode | 增 | Vue 长页板块抽组件+嵌入/独立双形态复用（number/limit/moreTo props、组件自持依赖、竞态 token 隔离、hash 路由新标签、pageStatMap 登记） |
