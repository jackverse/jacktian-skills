# 专题：为 Word 设计说明书生成系统总体结构图

适用于详细设计说明书、建设方案等文档中的分层架构图。目标不是“画一张看起来差不多的图”，而是让图中组件与正文事实一致，并经过 DOM 溢出检查、PNG 视觉验收和 Word 渲染验收。

## 标准流程

### 1. 先读正文事实，再设计图层

- 先阅读文档正文及已有的事实材料，提取真实存在的层级、模块、技术组件和调用关系，再确定图层与卡片。
- 图名、组件名沿用正文术语；正文没有的模块、产品或指标不要补造。通用结构可参考“访问层 / 应用层 / 服务层 / 数据层”，但应按实际材料增删，不能套模板替代事实。
- 图只表达正文已经支撑的结构；复杂流程、部署拓扑不要混进一张总体结构图。

### 2. 制作无外部依赖的单文件 HTML

- HTML 内联全部 CSS，不引用 CDN、在线字体、远程图片或 JavaScript 库；断网打开也应完整呈现。
- 使用固定像素画布和 CSS 分层卡片：根节点统一为 `#diagram`，层级容器使用 `.layer`，组件卡片使用 `.card`。例如画布可定宽 1400px，各层用 flex/grid 排列。
- 不写入场动画、过渡或定时绘制，避免截图停在中间状态；配色、边框、间距直接由静态 CSS 决定。
- 画布宽度之外的高度先按内容估算，**不要依赖固定高度强行收住内容**。固定高度容易裁切 chips、标签或末行文字。

最小结构示例（组件名仅作结构示意）：

```html
<div id="diagram">
  <section class="layer">
    <h2>访问层</h2>
    <div class="cards">
      <div class="card">浏览器</div>
      <div class="card">移动端</div>
    </div>
  </section>
  <section class="layer">
    <h2>服务层</h2>
    <div class="cards">
      <div class="card">接口服务</div>
      <div class="card">任务服务</div>
    </div>
  </section>
</div>
```

### 3. 本机 Chrome 截图，先做 DOM 溢出检查

使用 `scripts/render_html_diagram.py`（Python Playwright + 本机 Chrome）：

```bash
python scripts/render_html_diagram.py diagram.html architecture.png \
  --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

- 默认以 `device_scale_factor=2` 截取 `#diagram`，输出设备像素 PNG；`--chrome` 可省略，此时由 Playwright 的 `channel="chrome"` 查找本机 Chrome。
- 截图前必须逐个检查 `#diagram`、每个 `.layer` 和每个 `.card`：`scrollHeight <= clientHeight` 且 `scrollWidth <= clientWidth`。也可重复传 `--check` 增加自定义容器选择器。
- 任一元素溢出时脚本退出码为 2，不生成“看似成功”的截图。根据报告中的选择器、元素文本和四值定位问题，**增加层高/行高或调整布局后重新检测**；不要用 `overflow:hidden` 掩盖，也不要只扩大整张画布就跳过复检。
- 若确需其他缩放，可显式传 `--scale`；正式交付优先保留 2 倍清晰度。

### 4. Read PNG 做视觉验收

DOM 数值通过不等于视觉通过。用图像读取工具打开生成的 PNG，逐项检查：

1. 根画布完整，四周无裁切；每张卡片的 chips、标签和末行文字均完整可见。
2. 层级顺序、对齐、间距、连线和分组符合设计，文字没有重叠或意外换行。
3. 术语与正文一致，颜色对比和字号适合缩进 Word 后阅读。
4. 发现裁切或拥挤时回到 HTML 调整并重新执行溢出检查、截图和视觉验收，不能只看 DOM 报告交付。

### 5. 精确回填 Word 占位单元格

优先用既有脚本，先 dry-run 对账再回填：

```bash
python scripts/fill_img_placeholders.py 设计说明书.docx \
  --img "系统总体结构图=architecture.png" --dry-run
python scripts/fill_img_placeholders.py 设计说明书.docx \
  --img "系统总体结构图=architecture.png"
```

- 从 `【截图占位：xxx】` 提取**完整标题 `xxx`**，与图片映射键做全等匹配；禁止用模糊子串或 `title in cell.text`，避免相近题名互相误填。
- 只替换匹配占位所在的单元格内容，保留单元格属性、表格结构和占位框下方题注。
- 不传 `--width` 时，脚本按各节 `page_width - left_margin - right_margin` 的最小可用正文宽度插图；确需更窄图片时再显式传厘米值。
- 详细规则见 [img-backfill.md](img-backfill.md)。

### 6. 渲染 PDF 验收最终 Word

按 [template-generate.md](template-generate.md) 的流程将最终 docx 渲染成 PDF/PNG，检查图片落点、分页、题注、清晰度和是否超出版心。只验收独立 PNG 不能发现 Word 中的缩放、跨页和表格变形。

### 7. Word 占用文件时不要强制关闭

若保存报 `PermissionError`，先判断是否是用户正在 Word 中打开目标 docx：

- 不要杀 `WINWORD.EXE`，不要强制关闭用户 Word，也不要以覆盖原文件为唯一成功路径。
- 保留原文件并生成备份，将当前结果另存为带时间戳的“附图版”临时 docx，明确告知用户实际产物路径；需要合并回原文件时由用户关闭后自行处理。
- 回填脚本在原路径保存遇 `PermissionError` 时会自动备份原文件并尝试输出 `<原名>-附图版-<时间戳>.docx`；日志中出现 fallback 路径时，后续 PDF 验收应针对该临时产物。
