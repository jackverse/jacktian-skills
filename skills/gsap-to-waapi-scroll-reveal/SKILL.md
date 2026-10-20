---
name: gsap-to-waapi-scroll-reveal
description: 将静态 HTML/CSS/GSAP 原型或设计稿中的滚动入场、交错分组和 hover 回弹动效，迁移为不引入 GSAP 的 Vue 3、React 或原生 Web 实现（WAAPI + IntersectionObserver + CSS transition）。当用户提到去 GSAP 依赖复刻动效、WAAPI 实现 stagger、滚动 reveal、防入场闪现或入场动画结束后 hover 失效时使用。
---

# GSAP 滚动动效迁移为 WAAPI

把一次性滚动入场交给 WAAPI，把滚动命中交给 IntersectionObserver，把 hover 交还给 CSS transition。不要为了让原型“看起来一样”而引入整套动画库，也不要用 JS 逐帧模拟 hover。

## 迁移顺序

1. 从原型提取参数：初始/末态、`duration`、各层开始时间、easing、触发位置、是否只播一次。
2. 保留原有 DOM 与静态样式；先保证无 JS 时内容完整可见。
3. 用 WAAPI 复刻入场 keyframes 和 delay，用 IntersectionObserver 决定何时播放。
4. 用纯 CSS transition 复刻 hover、回弹和奇偶反向。
5. 补上 reduced-motion、降级、卸载清理，并用 `getAnimations()` 核对真实参数。

## GSAP 到 CSS/WAAPI 的常用对照

| 原型写法 | 无依赖实现 |
|---|---|
| `gsap.to/fromTo` 的位移、透明度 | `el.animate(keyframes, options)` |
| `duration: 0.6` | WAAPI `duration: 600`（统一换成毫秒） |
| `stagger` / 时间轴相对位置 | 为各元素计算绝对 `delay` |
| 滚动触发 | IntersectionObserver；命中后只播一次并停止观察 |
| hover 回弹 | CSS `transition` + `cubic-bezier` |
| 初始 `autoAlpha: 0` | JS 挂载时先加 `duration: 0, fill: 'both'` 的透明 hold 动画 |

### 缓动近似值

| GSAP 缓动 | CSS/WAAPI `easing` |
|---|---|
| `power2.out` | `cubic-bezier(0.215, 0.61, 0.355, 1)` |
| `power3.out` | `cubic-bezier(0.165, 0.84, 0.44, 1)` |
| `back.out(1.7)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

`back.out(1.8)` 做视觉近似时也可复用 `back.out(1.7)` 的曲线。这些是常用视觉等价值，不要为数学上逐点一致额外引入运行时依赖。

### 把时间轴位置换算成 delay

GSAP 位置参数 `'<.08'`、`'<.1'` 表示“相对上一段动画的**开始时间**分别偏移 0.08 秒、0.1 秒”，不是相对上一段结束时间，也不是 duration。

先把所有段落的开始时间换算为同一时间轴上的毫秒，再直接写入各层 WAAPI `delay`。例如每组卡片步长 90ms：

```js
const card_delay = index => index * 90;
const icon_delay = index => 80 + index * 90;
const copy_delay = index => 180 + index * 90;
```

这里图标比本组卡片晚 80ms，文案比图标晚 100ms、比卡片晚 180ms。不要把 80、100、180 错当成互相累加的 duration。

## 核心实现骨架

下面观察一个分组，命中后统一启动组内卡片、图标、文案的交错动画。选择器和数值按原型替换，不要把它们封装成新的业务配置体系。

```js
function installScrollReveal(group) {
  const reduced_motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 默认 CSS 始终可见；能力不满足或用户减少动态效果时，不制造任何隐藏状态。
  if (
    reduced_motion ||
    !('IntersectionObserver' in window) ||
    typeof group.animate !== 'function'
  ) {
    return () => {};
  }

  const cards = Array.from(group.querySelectorAll('[data-card]'));
  const tasks = cards.flatMap((card, index) => [
    { el: card, delay: index * 90, from: 'translateY(24px)' },
    { el: card.querySelector('[data-icon]'), delay: 80 + index * 90, from: 'translateY(12px)' },
    { el: card.querySelector('[data-copy]'), delay: 180 + index * 90, from: 'translateY(12px)' },
  ]).filter(task => task.el);

  const holds = new Map();
  const active = new Set();

  // 先同步压住首帧，防止 JS 已执行但 IO 尚未命中时闪现或提前剧透。
  for (const { el, from } of tasks) {
    const hold = el.animate(
      { opacity: 0, transform: from },
      { duration: 0, fill: 'both' }
    );
    holds.set(el, hold);
  }

  const play = () => {
    for (const { el, delay, from } of tasks) {
      holds.get(el)?.cancel();
      holds.delete(el);

      const animation = el.animate(
        [
          { opacity: 0, transform: from },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: 600,
          delay,
          easing: 'cubic-bezier(0.165, 0.84, 0.44, 1)',
          fill: 'both',
        }
      );
      active.add(animation);

      // 播完释放动画，避免 fill 效果长期覆盖 CSS hover transform。
      animation.finished
        .then(() => {
          animation.cancel();
          active.delete(animation);
        })
        .catch(() => {});
    }
  };

  const observer = new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      play();
    },
    { threshold: 0.15 }
  );
  observer.observe(group);

  return () => {
    observer.disconnect();
    for (const hold of holds.values()) hold.cancel();
    for (const animation of active) animation.cancel();
    holds.clear();
    active.clear();
  };
}
```

Vue 3 在 `onMounted` 中安装、在 `onBeforeUnmount` 中执行返回的清理函数；React 在 `useEffect` 中安装并直接返回清理函数。动态列表重建后先清理旧实例，再基于新 DOM 安装。

## 四个关键约束

### 1. 用 hold 防闪现，但不用 CSS 默认隐藏

- 默认 HTML/CSS 必须是可见、可读的；只有 JS 能力检查通过后才添加透明 hold。
- hold 使用 `duration: 0, fill: 'both'`，其视觉效果等价于入场前的 `autoAlpha: 0` 初始遮挡。
- IO 命中后先取消 hold，再立即创建正式动画。正式动画有正 delay 时，`fill: 'both'` 会在等待期应用首帧，因此两段动画之间不会闪回可见状态。
- reduced-motion、无 IntersectionObserver 或无 WAAPI 时整段跳过，内容常显。不要依赖 `.js .reveal { opacity: 0 }` 这类需要 JS 再移除的 CSS 隐藏类，否则 JS 失败会永久隐藏内容。

### 2. 播完后取消 fill 动画

WAAPI 的 `fill: 'both'` 会让动画效果在结束后继续参与样式合成，优先级高于普通 CSS 规则，常见症状是“入场很漂亮，之后 hover transform 完全不动”。

在 `animation.finished.then(() => animation.cancel()).catch(() => {})` 中释放。`catch` 必须保留，因为主动取消动画也会让 `finished` 拒绝。取消前要确认末帧与元素自然态一致，例如末帧 `translateY(0)` 与自然态无位移视觉一致；若自然态含 rotate/scale，应把它同步写入 keyframes，避免释放瞬间跳变。

不要为了保留末态而用 `commitStyles()` 或长期写入 inline transform，这同样可能压住后续 hover。

### 3. hover 交给 CSS

入场结束并释放 WAAPI 后，hover 无需 JS 监听或逐帧插值：

```css
.card {
  transform: translateY(0);
  transition:
    transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 240ms cubic-bezier(0.215, 0.61, 0.355, 1);
}

.card:hover {
  transform: translateY(-6px) rotate(-1deg);
}

.card:nth-child(even):hover {
  transform: translateY(-6px) rotate(1deg);
}
```

`:nth-child(even)` 可直接实现奇偶反向；不要在 JS 中维护 hover 的 rAF 状态机。

### 4. JS 与 CSS 都处理 reduced-motion

JS 在创建 hold 之前检查 `prefers-reduced-motion` 并跳过入场。CSS 还要单独处理无限循环和 hover，因为这两类效果不经过入场 JS：

```css
@media (prefers-reduced-motion: reduce) {
  .ambient-float,
  .marquee-track {
    animation: none;
  }

  /* 重复类名提高优先级，确保覆盖上面更具体的 hover 规则。 */
  .card.card:hover,
  .card.card:nth-child(even):hover {
    transition: none;
    transform: none;
  }
}
```

如保留颜色、阴影等反馈，应只简化和运动相关的位移/旋转，不必删掉所有 hover 状态。

## 调试：直接读动画参数

不要先靠截图逐帧猜时间轴。在页面控制台或临时调试代码里读取浏览器实际运行的动画：

```js
console.table(
  el.getAnimations().map(animation => {
    const timing = animation.effect?.getTiming() ?? {};
    return {
      playState: animation.playState,
      delay: timing.delay,
      duration: timing.duration,
      easing: timing.easing,
      fill: timing.fill,
    };
  })
);
```

重点核对：

- IO 命中前是否有 hold，内容是否没有先闪一下。
- 各层 `delay` 是否处于同一时间轴，90/80/180 之类的偏移有没有被误累加。
- `duration`、`easing` 是否与换算表一致，`playState` 是否符合预期。
- 入场完成后相关 fill 动画是否已被取消，随后 hover 是否恢复。

## 验收清单

1. 禁用 JS、模拟无 IO/WAAPI、开启 reduced-motion 时，内容都完整可见。
2. 入场前无闪现；每组只播放一次，不因 IO 重复回调叠加动画。
3. 卡片、图标、文案的相对开始时间与原型一致。
4. 入场完成后无末帧跳变，hover transform 与回弹立即可用。
5. 无限循环动画在 reduced-motion 下停止，hover 位移被简化。
6. 组件卸载时 observer、hold、active 动画全部清理，`finished` 无未处理拒绝。
