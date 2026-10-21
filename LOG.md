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
| 2026-10-20 | third-party-token-proxy | 增 | 第三方平台 client_credentials 后端换票接入：yml 持凭证、JDK HttpClient 登录、按 token 剩余有效期缓存 Redis（exp 解析失败兜底+Redis 故障降级直登）、端点返回拼好 URL、旧静态 token 幂等 REPLACE 清理（源自 SPAI 检索改造） |
| 2026-10-21 | third-party-token-proxy | 改 | 踩坑+1：目标平台可能仅「嵌入模式」下读 URL token（spaiEmbedded=1；iframe 参数 embed=1 前端不识别），新标签页打开缺此参数 token 被静默忽略→已鉴权失败但后端 token 正常，需抓目标前端 JS 包定位 token 消费条件 |
| 2026-10-21 | third-party-token-proxy | 改 | 新增「嵌入/新开第三方平台显示未登录」排查章节：iab 存储按文档隔离（跨导航即清空）、CDP 看不见 window.open 子窗口（tab.goto 复现）、SPAI 前端 JS 包反混淆还原鉴权三处（token 唯一消费点/401 处理器/跨窗口预写存储）+ __spai_console_ring__ 日志环诊断、五步排查方法论、browser-use node_repl API 现状 |
| 2026-10-21 | （清理） | 删 | 用户盘点后精简：删除 vue-detail-seamless-scroll、gsap-to-waapi-scroll-reveal、quest-collect-task、vue-page-section-extract-dual-mode、third-party-token-proxy（git 历史可找回），仅保留 word-template-docs |
| 2026-10-21 | word-toolkit | 改 | word-template-docs 升级为通用 Word 技能集并更名：SKILL.md 瘦身为路由表+通用纪律+沉淀规范，原内容拆分到 references/（template-generate / reverse-align / pitfalls）按需加载；description 放宽为一切 docx 任务触发 |
