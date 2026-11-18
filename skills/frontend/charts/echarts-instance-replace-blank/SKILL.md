---
name: echarts-instance-replace-blank
description: ECharts 图表"首屏正常、切换筛选条件后画布一片空白"的实例生命周期排查与修法：对已挂实例的 DOM 重复 init 被静默复用 + dispose 晚于 render 的求值顺序反序。触发场景：echarts 图表切换后空白、切换筛选图表空白、重新查询后图表空白无报错、首屏正常切换空白、echarts init 复用旧实例、dispose 顺序、setOption 后 dispose、图表替换封装函数、getInstanceByDom 检测、There is a chart instance already initialized on the dom。凡"首屏能画、二次渲染空白"先查实例替换时序，不要去查数据接口。
---

# ECharts 切换后空白：init 复用旧实例与 dispose 顺序（echarts-instance-replace-blank）

基于 ECharts 5 + Vue 3 验证。这是纯 echarts **实例生命周期**问题，与数据口径无关（口径类"展示不对"见 `chart-anomaly-rootcause-repro`；截图环境失真见 `browser-anim-screenshot-verify`）。

## 症状与签名

图表**首屏渲染正常**，切换筛选条件（重新拉数后重画同一图表）后画布一片空白——无报错、无弹错，控制台至多一条 DEV warning：`There is a chart instance already initialized on the dom`。

**"首屏好、切换空白"就是本病的签名**：首屏容器上没有旧实例可 dispose，时序 bug 不触发；一旦有旧实例，第二次起必空白。

## 根因时序

坏味道——"替换图表"帮助函数把 render 写成了传参：

```ts
// 反例
function set_chart(key: string, chart: echarts.ECharts) {
  chart_map.get(key)?.dispose();          // 后执行
  chart_map.set(key, chart);
}
set_chart("trend", render_trend(data));   // 函数实参先求值，render_trend 先执行！
```

函数实参**先求值**：`render_trend` 内部 `echarts.init(el)` 执行时，DOM 上还挂着旧实例。echarts 对已有实例的 DOM **不抛错、静默返回已存在的旧实例**（仅 DEV 一条 warning）。于是：

1. `render_trend` 拿到的是**旧实例**，其内部 `setOption` 把新数据画了上去；
2. `set_chart` 体内才执行 `dispose()`——把刚画好的实例销毁清屏；
3. 结果：空白。求值顺序把设计意图 dispose→render 反转成了 render→dispose。

## 修法：工厂回调 + 先 dispose 后 render

`set_chart` 改收工厂回调，体内先释放旧实例再创建新实例；调用点用箭头函数**延迟求值**：

```ts
// 正例
function set_chart(key: string, render: () => echarts.ECharts | null) {
  chart_map.get(key)?.dispose();   // 先释放旧实例
  const chart = render();          // 再创建新实例（此时容器上已无实例，init 是真 init）
  if (chart) chart_map.set(key, chart);
  return chart;
}
set_chart("trend", () => render_trend(data));  // 箭头函数把求值推迟到 dispose 之后
```

若不想整实例重建，也可复用单实例：init 前先 `echarts.getInstanceByDom(el)` 判存在，存在则直接 `setOption(newOption, true)`，不存在才 `init`。两种方案任选其一，关键是**杜绝"对可能挂有旧实例的 DOM 再次 init"**。

## 排查思路

遇到"切换后图表空白"，按序检查——**不要先查数据接口**（首屏能画，说明数据与 option 本身没问题）：

1. 看图表实例的替换路径：是否有"封装函数收实例参数"的写法（传参即先求值）；
2. 控制台搜 `already initialized on the dom` warning——有它基本坐实重复 init；
3. 用 `echarts.getInstanceByDom(el)` 在 init 前显式检测，返回非空即容器上已有实例；
4. 核对 dispose 与下一次 init/render 的先后：dispose 必须发生在下一次 init **之前**；
5. 修复后回归：连续切换多次筛选，每次都应正常重画。

## 坑速查

- `echarts.init` 对已挂实例的 DOM 静默复用旧实例，生产环境无任何报错，仅 DEV 一条 warning——靠报错发现不了。
- 把 `render()` 写成实参（`set_chart(key, render(x))`）= 立即求值，封装函数体内的 dispose 必然晚于 render，时序反序。
- `setOption` 在旧实例上"生效"是假象：随后的 dispose 立刻清屏，肉眼只看到空白。
- 不能用 `init` 返回值判新实例——它返回的就是旧实例，非空。
