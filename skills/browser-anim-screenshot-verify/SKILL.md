---
name: browser-anim-screenshot-verify
description: 浏览器自动化截图视觉验证的失真排查与规避技能：页面截图发白/半透明/像冻结在入场动画起始帧，但 DOM computedStyle 全部正确时使用。触发场景：browser-use/ZCode 内置浏览器（IAB，Playwright 表面）截图验证、视觉验证失真、截图发白、入场动画起始帧、data-xxx-reveal 类动画、WAAPI（element.animate）动画、getAnimations 快进。凡"截图看起来不对但代码样式正确"的排查都应参考。
---

# 浏览器截图验证：入场动画导致截图发白（browser-anim-screenshot-verify）

## 现象特征

用 ZCode 内置浏览器（browser-use / IAB，Playwright 表面）对带入场动画的网页截图做视觉验证时，截图呈现：

- 整卡/整块**半透明发白**、文字颜色偏浅，像蒙了一层白纱；
- 但 DOM 层面 `getComputedStyle` 查出来**全部正确**（`opacity: 1`、渐变色、字色都在）；
- 换个时机重截、或人工肉眼看页面又正常。

典型元凶：`data-xxx-reveal` 类入场动画，用 Web Animations API（`element.animate(...)`，duration 数百 ms）实现。

## 根因判断步骤（先查 DOM，再怀疑截屏链路）

1. **先用 `getComputedStyle` 确认 DOM 样式正确**：目标元素 `opacity`、`color`、`background` 等是否符合预期。
2. DOM 正确而截图不对 → 是**截屏侧合成帧滞后**（截图把页面冻结在动画起始帧），**与前端代码无关，不要改代码**。
3. 只有 DOM 样式本身也错，才回到代码/样式排查。

## 规避：截图前快进所有有限动画

截图前在页面里执行（Playwright 的 `page.evaluate` / node_repl 均可）：

```js
document.getAnimations({ subtree: true }).forEach(a => {
  try {
    const t = a.effect ? a.effect.getTiming() : null;
    if (t && t.iterations !== Infinity) a.finish();
  } catch {}
});
```

`a.finish()` 把有限动画直接推到终态，截图即为动画播完后的稳定画面。

## 循环动画的坑

- **必须跳过 `iterations === Infinity` 的循环动画**：对无限动画直接 `a.finish()` 会抛
  `InvalidStateError: Cannot finish Animation with an infinite target effect end`。
- 所以上面片段先读 `getTiming()` 判断再 finish，且外层套 try/catch 兜底（动画被 cancel 后 finish 同样会抛）。

## 适用边界

- 同样适用于其他基于 Playwright/CDP 的截图链路（合成帧滞后是共性机制，不限于 ZCode 内置浏览器）。
- 对 CSS transition/animation 同样有效（`getAnimations` 会一并返回）。
