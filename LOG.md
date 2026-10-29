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
| 2026-10-26 | vue-hash-to-history | 增 | Vue 3 + vue-router 4 hash 切 history 模式通用 checklist：createWebHistory(BASE_URL) 显式传 base、hash 依赖 grep 清单与 router.resolve 标准替换、SSO 回调地址四处去 #（区分后端→前端跳转目标与 IdP redirect_uri）、nginx try_files SPA fallback、入口一次性 location.replace 旧 hash 链接兜底（天然带 query/锚点）、登录失效整页跳 BASE_URL、四类不受影响项防过度改造、vue-tsc+vite build+grep 验证（源自门户项目实战） |
| 2026-10-26 | admin-web-install | 增 | startup admin-web 依赖安装专用脚本：.npmrc 私库(@wonders→内网 Nexus 自签)自动注入 NO_PROXY 直连、公网源保留用户代理、双源 TCP 预检快速失败、网络类失败自动重试、EBUSY 提示停 dev server、--clean/--fresh/--ci 与参数透传 |
| 2026-10-26 | maven-build | 增 | startup 后端 Maven 双源构建专用脚本：私库 TCP 预检（无 settings.xml、JVM 不吃系统代理故无需 NO_PROXY）、PKIX 证书失败自动 aether securityMode=insecure 重试一次、模块简称映射与 "--" 全透传、失败按特征归因 |
| 2026-10-26 | acceptance-docs | 迁 | 项目级 skill 从 startup 仓 .zcode/skills 迁入 projects/startup 专用区（补 frontmatter name/project/description） |
| 2026-10-26 | （结构） | 改 | 仓库区分通用/专用：skills/（链用户级 ~/.zcode/skills 全项目可见）+ projects/<项目键>/（frontmatter project: 指项目根，链到该项目 .zcode/skills 仅该项目可见）；sync.ps1 增第二阶段；项目绑定脚本一律放 skill 的 scripts/ 不落项目仓库 |
| 2026-10-26 | quest-poi-tl-word-export | 改 | 新增宿主页面带参发起导出联动任务记录套路（QuestRunnerService.export(code,param,userId) 带参重载进程内调用 + 前端跳 /quest/record；反编译 2.4.2 核实三参/四参 run 各对一条发起路径，须双 run 覆盖防基类 no-op 踩空标 fail） |
| 2026-10-26 | quest-poi-tl-word-export | 改 | 踩坑+1：quest.file-path 不解析宿主 `$` 前缀相对路径约定（RelativePathParser 仅宿主 oss 链认识，starter 自带 resolve 是拼 user.dir 的另一套语义；裸值落盘 FileNotFoundException），须配绝对路径+渲染前 createDirectories 兜底；同步内存渲染直下下载不落盘会掩盖配置错误直至首次 quest 落盘才炸 |
| 2026-10-26 | word-toolkit | 改 | 新增老模板四大坑（NULL 悬空关系/标题直接 numPr/目录前空 toc 段/分节符随旧目录被删）+ build_pipeline.py |
| 2026-10-26 | quest-poi-tl-word-export | 改 | 踩坑+1：download(recordId,自拟名) 经 setFile 只更新 FILE_PATH 不更新 FILE_NAME，记录展示名/下载 Content-Disposition 停留预置 {config.name}_随机时间戳_6位随机串.xlsx（用户下载到「xlsx 文件名、Word 内容」，二跑实锤+反编译定案）；正解=发起时 4 参 export 传最终名（含 . 原样采用）+ run 用 QuestExecutionContext.current().getFileName() 取同名渲染登记，物理文件/FILE_PATH/FILE_NAME 三端统一，工作台无 override 发起回落自拟名（starter 无更新 FILE_NAME 的 API） |
| 2026-10-27 | word-toolkit | 改 | 新增 Word 总体结构图专题与 Chrome/Playwright 截图溢出检测脚本：正文事实驱动单文件 HTML、2 倍 PNG 与视觉/PDF 验收；图片回填按版心自动定宽，Word 占用时备份并输出附图版，补固定高度裁切坑 |
| 2026-10-27 | word-toolkit | 改 | 新增 SQL 基线+增量+migration 生成数据库设计说明书经验：按执行顺序合并有效 CREATE/ALTER、排除已 DROP 旧表、解析命名及复合主键；最终模型到 docx 逐单元格双向对账；Word 渲染检查续页表头、表用途跨页与索引孤行 |
| 2026-10-27 | projects/wic-sh/quest-host-bean-gating | 增 | quest.enabled=false 宿主 Quest Bean 条件装配与整包回归测试 |
| 2026-10-27 | word-toolkit | 改 | 验收文档批量生成经验补强：SQL 说明书解析兼容性（schema 前缀/反引号/行内 COMMENT 与 COMMENT ON/唯一与普通索引/按库表去重与前缀语义归组）与对账套路（比对前 strip、md 表行空行不清表指针、表数字段数唯一表名断言）；新增正式参考版式重建要点（修订表逐 cell 设宽、正文节页码重启、表题无编号样式）；新专题验收周报阶段日历校准（git log 取材、日期避节假日含调休、未完成不宣称、成套 QA 断言）；pitfalls+25（~$ 锁文件探测占用、占用改新目录输出、构建前备份旧输出目录） |
| 2026-10-28 | word-toolkit | 改 | pitfalls 新增 26-27：旧底稿覆盖对账（patch 前全文扫描核对已确认口径，丢失先说明再定点手术补回）、docx 表格整表重排（表头定位+排列断言+tr 移除重插+set_cell 保格式+save 前异常安全） |
| 2026-10-28 | word-toolkit | 改 | 新增无 Python 环境 Node.js+JSZip 直改现有 docx 专题（references/node-editing.md + scripts/docx_xml_edit.js）：run 拆分探测、稳定锚点、段/表/行范围替换与行重写防 tr 嵌套、按次数替换断言、XML 标签配对校验+history 备份+产物复读对账，pitfalls+28-32（源自中期验收报告编辑实战） |
| 2026-10-29 | （结构） | 改 | 通用技能按类目归档：skills/ 下分 word/（word-toolkit、quest-poi-tl-word-export）与 frontend/（vue3/vue-hash-to-history、vite/vite-dep-worker-import、browser-tuning/browser-anim-screenshot-verify+browser-interaction-verify），版本互斥经验再建版本子目录；sync.ps1 第一阶段改递归发现 SKILL.md+挪位自动重定向 junction；生效目录仍平铺、skill 目录名不变 |
| 2026-10-29 | docx-table-borders-and-split | 增 | docx 表格全框线批量修复（python-docx+lxml 重建六边 tblBorders、排除 1×1 截图容器表、清 tcBorders 防覆盖）+ 按章节拆分多份读者手册（复制+H1 边界删章、保首 run 改封面/引言、UNO 刷 TOC、soffice.com 转 PDF + fitz 目检）+ Windows 坑（python 被 WindowsApps 劫持、UNO 独立 profile、~$ 锁文件不杀 Word）+ 读者视角裁剪原则 |
