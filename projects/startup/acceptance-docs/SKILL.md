---
name: acceptance-docs
project: D:\code\startup
description: 科创在线（startup 项目）验收文档生成管线——用模板 Word 复刻生成正式验收文档（详细设计说明书/自测报告/用户操作手册/试运行方案），build_docx.py 按 Markdown 注入正文并自动处理目录域/修订记录/页码/列宽。仅适用于科创在线换内容不换版式的正式 docx 生成任务。
---

# Skill: 科创在线验收文档生成（模板复刻管线）

> 沉淀自 2026-10-14 验收文档批量生成任务。用模板 Word 复刻生成正式验收文档（详细设计说明书/自测报告/用户操作手册/试运行方案），保持与"数字底座"模板格式完全一致。

## 何时使用

需要基于既有 Word 模板生成同格式的新项目验收文档、投标文档、 Silberra 任何"换内容不换版式"的正式 docx 时。

## 产物位置

- 输出目录：`D:\record\20260702-科创在线\验收工作\输出-科创在线\`（10-1 详设 / 13-4 自测 / 14 手册 / 17-1 试运行）
- 生成管线：`D:\record\20260702-科创在线\验收工作\.work\build\build_docx.py`
- 内容源（Markdown）：`.work\content_*.md`
- 素材摘要：`.work\proposal_digest.md`（投标方案）、`.work\codebase_digest.md`(代码库事实）、`.work\tpl_prose_*.md`（模板写作范式）、`.work\tpl_layout.md`（版式事实）
- 渲染校验：`.work\build\word2pdf.py`（Word COM 转 PDF，自动更新目录域）+ pypdfium2 转 PNG

## 管线用法

```bash
PY="C:/Users/33380/AppData/Local/Python/bin/python.exe"
"$PY" .work/build/build_docx.py <模板.docx> <content.md> <输出.docx> --mode auto|manual
```

- `--mode auto`：标题编号全部由模板样式自动生成（详设/自测/试运行）。
- `--mode manual`：1/2 级标题样式自动编号，3 级及以下由管线按上下文补字面编号"7.4.1 标题"（手册模板即此风格）。
- 管线自动完成：复制模板→替换封面项目名/日期→清空修订记录旧记录写入新记录→删除旧 TOC 条目并插入 TOC 域→删除旧正文→按 Markdown 注入新正文（Heading 1-6/段落/管道表格/**加粗**/`::IMG::截图占位`/`!PAGEBREAK`）→按内容长度加权设置列宽（表头跨页重复+cantSplit）→补正文节页脚 PAGE 域→settings 设 updateFields→清除未引用媒体（55MB 模板瘦身到 <1MB）。

## Markdown 方言（写内容必须遵守）

- `#`~`######` 标题不带编号；普通段落一行一段；不用 markdown 列表（用（1）（2）写进正文）。
- 表格用管道表；首行可以是"功能描述"单格行（自动跨列合并成模板样式的合并表头）；单元格内禁竖线与换行。
- `::IMG::说明` 生成截图占位框（灰字【截图占位：…】+居中题注），后续人工贴真实截图。

## 踩过的坑（重要经验）

1. **模板 styleId 是数字**（"2"=Heading 1、"16"=toc 1），判定段落样式必须先建 styleId→name 映射，不能直接看 pStyle 字符串。
2. **"目录"标题本身是 toc 样式**，删除旧 TOC 条目时要保留 text=="目录" 的标题段。
3. **模板里可能有隐藏 TOC 域**（fldSimple、样式不是 toc*）：试运行/手册模板正文里各藏一个，Word 打开更新域后会自动长出带页码目录——别删。
4. **删除旧正文会把分节符一起删掉**：模板正文页脚（PAGE 域）的 footerReference 常挂在正文里的分节段落上，删完后最后节的页脚会断链变成无页码。对策：`ensure_footer_page_number()` 给最后节显式补居中 PAGE 域。
5. **修订记录表结构**：前两行是 项目名称/编制单位 信息行，第 3 行是版本表头，其后是记录行+空白备用行；要清空模板历史记录行、复用第一个空白行写入新记录（日期格式跟模板 2026.10.14）。
6. **手册模板没有 Table Grid 样式**（只有 Normal Table），表格样式要从样式表按优先级选，不能硬编码。
7. **表格列宽**：python-docx 默认均分+fixed 会让"子系统名称"这类长列名换行难看；按各列内容长度（cap 20 字，指数 0.7，最小 1000 twips）加权分配并写 gridCol+tcW。
8. **Windows Installer 在此环境会卡死**（msiexec /i、/a 全部挂起且无日志，非管理员 shell 连 UAC 都弹不出）。装 LibreOffice 的可行路径：① lessmsi 解包 MSI（注意参数是 `lessmsi x <msi>`，输出到当前目录同名文件夹）；② 最终用 MS Word COM（`word2pdf.py`，DispatchEx 独立实例、ReadOnly 打开、先 toc.Update() 再导 PDF）——不干扰用户已开的 Word。
9. **页脚数字校验不要靠肉眼看 1.6x 渲染图**（"40"会看成"4"），用 pypdfium2 的 `get_text_bounded(bottom 8%)` 提取文字判断单调递增。
10. **视觉验收代理模型不可用时**按协议降级为自行逐页检查；验收基准：封面/修订记录/目录/编号连续/表格不断行/无模板残留字样（张江/数字底座/2025/旧人名）。

## 内容事实来源纪律

- **项目覆盖关系（重要教训）**：科创在线建设项目覆盖已建成的子系统——创赛系统（wic-sh，`D:\code\wic-sh`，独立 Spring Boot 多模块 + 三前端，配套 `D:\record\20260305-wic-sh` 操作手册）与科创在线平台本体（startup）。写创业大赛章节必须以 wic-sh 实际实现为底子（真实表 wic_*、动态表单引擎、Flowable 流程、初赛/复赛/半决赛/决赛赛程、专家回避、晋级推选、批量导入、PII 加密），再融合投标方案的目标口径，不能当作"全新待建模块"仅按投标文本写。事实清单见 `.work\wic_digest.md`。
- 投标方案摘要（proposal_digest.md）提供：七方向背景、大赛/积分模块设计、指标体系全表、接口参数、信创密评、里程碑（M1-M7）、质量指标（并发200/TPS100、页面≤3s、P0 8h/P1 24h/P2 3工作日、通过率≥98%、积分 5 个工作日）。
- 代码库摘要（codebase_digest.md）提供：三端架构（门户/后台/SSO，admin 8080/task 8089/pub 8090/idp 8088/app 8091）、真实菜单树（手册第 7 章按它组织）、85 张表清单、16 种资源类型统一 ES 索引、5+ 定时任务、安全能力与审计遗留项。
- 禁止编造：具体 URL、人名、领导职务、素材之外的数字。地址一律"以实际部署环境为准"。
