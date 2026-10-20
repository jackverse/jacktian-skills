---
name: vue-detail-seamless-scroll
description: Vue3 页面内明细列表限高自动慢滚 + 滚轮手动快滚 + 无缝循环的原生滚动指令模式。适用于看板/卡片里"明细最多可见 N 行，超出自动缓慢滚动、鼠标滚轮可手动快滚、滚到底无缝接回开头"类需求；也适用于列表循环跑马灯、自动轮播滚动等场景。当用户要求"明细超出行数自动滚动"、"列表无缝滚动/循环滚动"、"滚动可被滚轮打断、悬停暂停"时使用。
---

# Vue 明细列表限高无缝滚动（原生滚动方案）

需求原型：管理后台看板卡片里的明细列表，视口限高最多可见约 5 行；项数超限时自动慢速
滚动浏览，用户拨滚轮时切换为手动快滚，停止操作片刻后从当前位置继续自动慢滚，全程无缝
循环、无可见接缝。最终采用 **原生滚动（overflow + scrollTop）** 方案。

## 为何选原生滚动

- CSS animation `translateY(-50%)` 方案无法与手动滚轮共存（动画接管 transform，滚轮
  改不了位置，二者互相打架）。
- transform 模拟滚动（自算位移）在某些环境滚轮事件根本不作用于"假滚动"，手动体验失效。
- 原生滚动容器（`overflow-y: auto`）滚轮/触控板天然可用，是最不容易失效的手动方案。
  **不要 `preventDefault` 接管 wheel**，只旁听。

## 核心实现要点

整体形态：滚动容器 + 克隆列表 + rAF 自持浮点位置驱动 + wheel 临时切手动。

### 1. 启用判定：项数阈值优先，高度判断兜底

- 用 **"item 数量 > 阈值"** 作为首要判定，内容实际高度超出视口仅作兜底。
- 纯高度判断会被 grid/flex 末行的 margin 干扰：例如 5 项实际内容高 145px > 视口
  140px，于是"正好 N 项也原地空滚"——内容并没有可滚的余量，却在慢滚循环里打转。
- 判定放在 `mounted` 里按 `binding.value` 拿配置（阈值、速度等），不必监听子元素
  动态增删（看板明细基本静态；确有需要再上 ResizeObserver）。

### 2. 无缝循环：克隆一份列表

- 把同一份列表 **clone 一份 append 到滚动容器内部**，内容变成两份。
- 滚过一份的距离（`content_h = el.scrollHeight / 2`）就立即 `el.scrollTop -= content_h`
  回绕，视觉上无缝接回开头。
- 克隆节点加 `aria-hidden="true"`，屏幕阅读器不重复朗读。

### 3. 隐藏滚动条但不破坏滚动

```css
.scroller {
  overflow-y: auto;
  scrollbar-width: none;            /* Firefox */
}
.scroller::-webkit-scrollbar {
  display: none;                    /* Chrome/Edge/Safari */
}
```

滚轮与触控板照常工作，只是不显示滚动条。

### 4. 自动慢滚：rAF + 自持浮点位置（关键坑）

- **不要** `el.scrollTop += 0.3` 这类写法：`scrollTop` 读取时会取整，逐帧回读
  `scrollTop` 再累加小数，小数部分每帧被"吃掉"，慢速滚动实际原地不动。
- 正确做法：rAF 循环里维护 **自持的浮点位置 `pos`**，`pos += speed * dt`，然后
  `el.scrollTop = pos` 整体写入。
- `dt` 要 clamp（如上限 100ms）：切后台/标签页休眠回来时 rAF 停摆，不 clamp 会
  一帧跳过一大段。

```js
const loop = (t) => {
  const dt = Math.min(t - last, 100); // clamp，防切后台跳变
  last = t;
  if (t >= manual_until && !hovering) {
    pos += speed * dt;
    if (pos >= content_h) pos -= content_h;   // 回绕
    el.scrollTop = pos;
  }
  raf = requestAnimationFrame(loop);
};
```

### 5. 手动/自动切换与暂停

- `wheel` 监听（`{ passive: true }`，**不 preventDefault**）只做一件事：更新
  `manual_until = now + N秒` 时间戳。原生滚动自己完成快滚。
- 手动期内 rAF **不写 scrollTop**；用 `scroll` 事件把用户滚到的位置同步回
  `pos`，滚过一份就地回绕 `pos -= content_h`，避免退出手动态时跳变。
- 手动空闲超时后，从当前 `pos` 无缝续滚。
- `mouseenter` / `mouseleave` 悬停暂停/恢复。
- `prefers-reduced-motion` 时停用自动滚动，保留手动滚轮。

### 6. 清理

组件卸载必须：`cancelAnimationFrame` + `removeEventListener`（wheel/scroll/
mouseenter/mouseleave）。多个实例并存时用 `WeakMap<HTMLElement, state>` 存
每容器状态，指令式复用不会串。

## 推荐实现形态：局部自定义指令

Vue3 `<script setup>` 里定义 `const vXxx = { mounted(el, binding) {...}, unmounted(el)
{...} }`，模板直接 `v-xxx="{ max: 5, speed: 0.03 }"` 使用——模板零配置复用，
明细卡片加一行指令即可，不用额外组件包裹、不用改列表结构。

## 踩坑速查

| 现象 | 原因 | 处理 |
|------|------|------|
| 正好 N 项也原地空滚 | 容器内容高度含末行 margin，"实际高 145px > 视口 140px" 误判可滚 | 判定改为 item 数量 > 阈值，高度只兜底 |
| 慢速自动滚完全不动 | `scrollTop +=` 小数，回读取整逐帧吃掉增量 | rAF 自持浮点 `pos`，整写 `el.scrollTop = pos` |
| 滚轮手动失效 | CSS animation transform 接管 / preventDefault 接管 wheel | 换原生滚动，wheel 只旁听不拦截 |
| 切后台回来猛跳一段 | rAF 停摆后 dt 巨大 | dt clamp（如 ≤100ms） |
| 手动→自动切换时跳变 | 手动期 pos 未同步 | scroll 事件同步 pos，滚过一份就地回绕 |

## 接入清单

1. 容器：固定高度（或 max-height）+ `overflow-y: auto` + 隐藏滚动条 CSS。
2. 判定：`items.length > max` 才启动；克隆列表 append，`content_h = scrollHeight / 2`。
3. rAF：浮点 `pos` 驱动，dt clamp，过半回绕。
4. wheel（passive）切手动、scroll 同步 pos、悬停暂停、reduced-motion 停自动。
5. 卸载清理：cancel rAF + 移除全部监听，状态进 WeakMap。
