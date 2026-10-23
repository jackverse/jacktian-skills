---
name: browser-interaction-verify
description: 在 ZCode 内嵌浏览器（IAB，Playwright 表面）/被遮挡 webview 里验证前端"行为类"交互（滚动监听、scroll-spy 高亮、平滑滚动锚点、节流回调）出现环境失真时的判别与替代验证法。触发场景：内嵌浏览器验证、滚动高亮不更新、scroll-spy 验证、rAF 挂起、scroll 事件不触发/计数为 0、scrollTo 不派发 scroll、setTimeout 变慢/定时器钳制、locator click 永远超时、Vue 改状态后读 DOM 是旧值、被遮挡 webview。凡"代码看着正确、逻辑单测也对，但在内嵌浏览器里行为验证就是不动"的排查都应参考；截图发白/冻结在入场动画帧的视觉失真请用 browser-anim-screenshot-verify。
---

# 内嵌浏览器行为验证失真：滚动/交互类（browser-interaction-verify）

## 何时怀疑是环境问题

在 ZCode 内嵌浏览器（IAB）或被遮挡的 webview 里验证滚动类交互（scroll-spy 高亮、锚点平滑滚动、滚动监听组件）时，组件表现为"坏了"：

- 高亮迟迟不更新、锚点落位看起来不对；
- 但代码审查正确、把判定逻辑拿到 Node 里单测也正确。

**判别特征**：页面 `document.visibilityState === 'visible'` 但 `document.hasFocus() === false`（webview 被遮挡/失焦）——仅这一个条件即可复现下述全部失真。先跑判别探针确认，确认后**不要改业务代码**，改用替代验证法。

## 环境失真清单

| # | 失真 | 实测表现 | 对组件的影响 |
|---|------|---------|-------------|
| 1 | rAF 整体挂起 | `requestAnimationFrame` 回调不执行 | 任何 rAF 驱动的动画/驱动循环卡死；Playwright 元素稳定性检查（依赖连续两帧 rAF）永远不满足 → `locator.click` 永远超时（失真 5 的根因） |
| 2 | 程序化滚动不派发 scroll 事件 | `window.scrollTo` / `scrollBy` 后 scroll 事件计数为 0 | 依赖 scroll 事件的组件（scroll-spy、吸顶、阅读进度条）收不到通知，看起来"坏了"其实是事件根本没发 |
| 3 | setTimeout 被钳制（约 2.5 倍） | 300ms 实测 766ms | 组件里的节流定时器（如 60ms）实际要数百 ms 甚至更久才触发，造成"读完状态还是旧的"假象 |
| 4 | Vue 调度器（微任务 flush）延迟 | 改响应式状态后同步读 DOM 读到旧值 | 看似"赋值没生效"，要等下一次独立调用才收敛 |
| 5 | `locator.click` 永远超时 | 元素明明可见可点 | 是稳定性检查等不到两帧 rAF（失真 1 的连带），**不是元素不可点** |

## 判别探针

可脚本化探针见 `scripts/probe_env.js`（一个闭包无关的 async 函数，可直接 `page.evaluate`），一次返回 rAF 存活、scroll 事件计数、定时器钳制倍率与诊断结论。人工快速判别用以下三段。

### 0. 环境（遮挡）确认

```js
await page.evaluate(() => ({
  visibility: document.visibilityState,   // visible
  hasFocus: document.hasFocus(),          // false ← 关键
}));
```

visible 且 hasFocus=false → 高度怀疑本环境，继续下列探针确认。

### 1. rAF 是否挂起（Promise.race 探测）

```js
await page.evaluate(() => Promise.race([
  new Promise(res => requestAnimationFrame(() => res('raf-alive'))),
  new Promise(res => setTimeout(() => res('raf-suspended'), 800)),
]));
```

返回 `raf-suspended` 即挂起。挂起环境下所有 rAF 等待（含 Playwright actionability 检查）都不会通过。

### 2. scroll 事件是否派发（事件计数器）

```js
await page.evaluate(() => new Promise(res => {
  let n = 0;
  const on = () => n++;
  window.addEventListener('scroll', on, { passive: true });
  const y = window.scrollY;
  window.scrollTo(0, y + 300);
  setTimeout(() => {
    window.removeEventListener('scroll', on);
    window.scrollTo(0, y);
    res({ events: n, scrollYAfter: window.scrollY });
  }, 400);   // 注意此等待本身也被钳制，实际约 2.5 倍
}));
```

`events: 0` 即不派发；`scrollYAfter` 可区分"滚了但没事件"与"根本没滚"。

### 3. 定时器钳制倍率

```js
await page.evaluate(() => new Promise(res => {
  const t0 = performance.now();
  setTimeout(() => res({ requested: 300, actual: Math.round(performance.now() - t0) }), 300);
}));
```

`actual / requested` 即钳制倍率（实测约 2.5）。后续所有 setTimeout 等待一律按该倍率放大。

## 规避验证法

1. **页面内驱动一律用 setTimeout，不用 rAF**。需要"下一帧/下一拍"语义时用 `setTimeout(fn, 0)`，并预留钳制倍率。
2. **事件链与判定逻辑分开验证**：不纠结"scroll 事件为什么没发"，改用 Vue3 内部钩子 `el.__vueParentComponent.proxy` 直读/直调组件实例方法（如手动调 `syncActive`、`onScroll` 并传入构造的滚动位置），把"事件触发"与"判定逻辑"拆开各自验证。该内部属性由 dev 构建注入（prod 构建通常没有），验证环境一般为 dev 构建可用。
3. **手动直调的两个坑**：
   - 同步读 DOM 可能读到未 flush 的旧值（失真 4）——改完状态后不要在同一个 evaluate 里立即断言，拆成两次独立调用，或中间 `await new Promise(r => setTimeout(r, 50 * 倍率))`；
   - 设置 proxy 上的 data 属性再立即读回可能不生效——**用方法调用而非属性赋值**驱动状态。
4. **几何断言只信大位移**：只断言几百 px 量级的落位/高亮切换；±十几 px 的边界小位移在该环境读数不可靠，交给第 6 条的 Node 矩阵回归覆盖。
5. **click 超时的替代**：`locator.click({ force: true })` 跳过稳定性检查；或 `page.evaluate` 里 `el.dispatchEvent(new MouseEvent('click', { bubbles: true }))`；或按第 2 条直调组件的点击处理方法。
6. **纯判定逻辑抽到 Node 跑全矩阵回归**（最可靠）：把迟滞带、阈值矩阵等判定逻辑复制成等价 JS，在 Node 里枚举"栏目偏移 × 滚动位置"全矩阵断言，模板见 `scripts/logic_matrix_template.js`。**注意**：从源码复制逻辑时 offset/容差的加减口径必须逐字符一致，否则矩阵出现假失败，浪费排查时间。
7. **rAF 挂起环境下，"兜底定时器落位"路径反而可被真实验证**：若组件在平滑滚动后有 setTimeout 兜底落位（duration + 余量），该路径不依赖 rAF，可端到端真跑——等待时间按 `duration + 200ms` 再乘钳制倍率估算。
8. **scroll 事件不派发的兜底断言**：需要确认"滚动位置本身正确"时，直接断言 `window.scrollY` / `getBoundingClientRect().top`（几何读数仍然可用），绕过事件层。

## 与既有技能的边界

- `browser-anim-screenshot-verify`：**视觉/截图失真**——截图发白、冻结在入场动画起始帧（WAAPI/reveal 类），DOM 样式正确；处置是截图前 `getAnimations` 快进。
- 本技能：**行为/交互验证失真**——rAF 挂起、scroll 事件不派发、定时器钳制、Vue flush 延迟、click 稳定性超时；处置是探针判别 + 实例直调/Node 矩阵回归等替代验证。

两者常见于同一个被遮挡 webview 环境，互不重叠，可先后排查：先确认"截图对不对"（视觉），再确认"行为对不对"（本技能）。
