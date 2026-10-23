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
| 2026-10-21 | browser-anim-screenshot-verify | 增 | 浏览器截图视觉验证发白排查：入场动画（WAAPI/reveal 类）被截图冻结在起始帧而 DOM computedStyle 正确，规避=截图前 getAnimations 快进有限动画、跳过 iterations===Infinity（finish 抛 InvalidStateError） |
| 2026-10-21 | browser-interaction-verify | 增 | 内嵌浏览器(IAB)/被遮挡 webview 行为验证失真清单与替代验证法：visible+hasFocus=false 即复现的 rAF 挂起/scrollTo 不派发 scroll 事件/setTimeout 钳制 2.5 倍/Vue flush 延迟/locator click 稳定性超时五类失真，Promise.race 与 scroll 计数探针 + __vueParentComponent 实例直调/Node 全矩阵回归等规避法（与 browser-anim-screenshot-verify 视觉失真互补） |
| 2026-10-22 | vite-dep-worker-import | 增 | Vite dev 启动崩于 "Cannot read file: xxx.js?worker"：npm 包预打包 dist 内 `?worker` 导入被 optimizeDeps esbuild 当磁盘文件名（query 后缀只有源码管线 vite:worker 插件认）；修复=optimizeDeps.exclude 该包（裸依赖须已被宿主预构建否则补 include 兜底），不可行方案 external 化/alias 去 query/patch-package，根治=源仓用 new Worker(new URL(...), {type:"module"})（源自 @wonders/quest-web 1.4.13 升级崩 dev） |
| 2026-10-23 | word-toolkit | 改 | 沉淀模板重建验收文档六条经验：标题编号 auto 模式原理与 H4+ 独立 numId 挂回主列表；修订表改"清空全部数据行后写第一个数据行"（修 build 脚本的"找空行写入"缺陷）；新增 ::IMG:: 占位框回填专题+fill_img_placeholders.py（题注正则全等匹配防子串误命中，冒烟测试通过）；重建优于打补丁+rels 引用分析剥旧媒体；渲染前产物 vs md 源对账+LibreOffice 不刷 TOC 域坑；"内容不对先查证据链"排障法（bak 大纲 diff/全文 diff/源大纲 diff）；pitfalls 追加 12-15 |
| 2026-10-23 | quest-poi-tl-word-export | 增 | quest 导出任务 + poi-tl 出 Word 报告两环节套路：①docx 样例按 (表,行,列) 坐标挖 {{占位符}}（文本匹配必败于 w:r/w:t 切分；set_cell_text 抄 pPr/rPr、保 vMerge/gridSpan、register_namespace 防前缀污染，附 docx_cell_templater.py dump/apply 通用脚本）；②starter ExportServiceImpl<Void> 三参 run、template JSON 传参、产物带时间戳写 QuestProperties.getFilePath + download 登记防同名覆盖；③mvn build-classpath + javac（git-bash 保分号）+ python 解析产物的离线验证管线；11 条坑速查（脚本已冒烟测试通过） |
