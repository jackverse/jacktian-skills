---
name: vue-page-section-extract-dual-mode
description: 把 Vue 3 长页（Options API / Composition API 均适用）中的编号板块抽取为可复用公共组件，并新建独立页复用同一组件展示完整内容，原页保留嵌入式预览（编号徽章 + 「更多」链接）。覆盖嵌入/独立双形态 props 设计（number/limit/moreTo）、组件自持依赖数据、请求竞态 token 隔离、hash 路由新标签打开详情、页内锚点导航不受影响的要点，以及门户类项目新增页面必须同步登记路由与页面统计映射的清单。当用户要求"把页面某板块抽成组件"、"做一个独立页展示完整板块内容"、"同一组件既嵌入预览又整页展示"、"长页拆板块复用"时使用。
---

# Vue 长页板块抽取与嵌入/独立双形态复用

适用场景：一个长页由多个编号板块（section）组成，需要把其中若干板块抽成公共组件，让它们在「原页嵌入式预览」和「独立页完整展示」两种形态下复用。

## 抽取步骤

1. **整体迁移**：板块的 template 片段 + 对应 data / computed / methods + scoped 样式整段搬进组件文件。连同内部用到的小工具函数一并复制（见「细节坑」）。
2. **组件根节点保留原 `section id`**：如果原页有页内锚点导航（如 PageSectionNav 靠 `#id` 滚动定位），组件根元素沿用原 `<section id="xxx">`，嵌入形态下导航零改动继续生效。
3. **原页替换为薄壳**：原位置只留 `<PolicyXxxSection number="02" :limit="5" moreTo="/xxx" />` 一行。

## 双形态 props 设计（核心模式）

| prop | 嵌入预览形态 | 独立页形态 |
|------|-------------|-----------|
| `number` | `"02"`（编号徽章） | `""`（空串不渲染） |
| `limit` / `pageSize` | 预览条数（如 5） | 完整条数或分页大小 |
| `moreTo` | 右上角「更多」链接目标 | `""`（空串不渲染） |

要点：

- 三个 prop 都以**空串/空值表示「独立页形态下不启用」**，组件内用 `v-if="number"`、`v-if="moreTo"` 控制渲染，不要为独立页写第二套模板。
- 若编号徽章渲染在原项目通用的标题组件里（如 SectionTitle 的 `number` 原本是 required prop），需要把它改成可选并加 `v-if`——这是抽取时容易漏的连锁改动，先全局搜该标题组件的所有用法确认无破坏性。
- 「更多」链接优先用 `<router-link :to="moreTo">`，保持 SPA 内跳转。

## 依赖解耦

- 板块若原本复用页面级数据（例如月历板块用页面统一加载的目录数据做联动筛选），抽组件后**让组件自持加载**：组件内独立发一次轻量列表请求（如 `/policy/directory`），换取组件脱离宿主页面独立成页的能力。多一次请求是可接受的代价。
- 反向做法（继续由父级注入数据）会让独立页也要复制加载逻辑，违背复用初衷。

## 请求竞态 token 模式

列表类 loader 自带独立递增 token 防竞态：

```js
data() { return { loadToken: 0, list: [] } },
methods: {
  async loadList() {
    const token = ++this.loadToken;
    const res = await fetchList(/* ... */);
    if (token !== this.loadToken) return; // 过期响应丢弃
    this.list = res;
  },
}
```

抽取时**每个组件自带独立 token**，不要与原页面共享同一个 token 字段，否则嵌入形态下父组件与子组件互相作废请求。

## hash 路由下详情新标签打开

hash 模式（`createWebHashHistory`）下不能用 `<a href="/detail/1">` 直接跳（缺 `#` 前缀）。统一 helper 随组件复制：

```js
openDetail(item) {
  const { href } = this.$router.resolve({ name: 'PolicyDetail', params: { id: item.id } });
  window.open(href, '_blank', 'noopener');
}
```

`router.resolve().href` 会自动带上 hash 前缀；`noopener` 防新标签拿到 `window.opener`。

## 门户类项目新增页面的登记清单

独立页新建后，除路由外还有隐性登记点，漏掉会静默失效（以 startup-pub-web 类门户为例）：

1. **路由**：`router/index.ts` 静态 import 组件 + 加 route 记录（保持与既有页面相同的懒/静态导入风格）。
2. **页面访问统计映射**：`src/utils/track.ts` 的 `pageStatMap` 加一行（route name → 板块 + 页面名）。**未登记的 route 静默不上报，无任何报错**——这是最容易漏的一步。
3. 若有站点导航/面包屑/页内导航清单类配置，一并检查。

## 验证方式（无 lint 配置的前端项目）

- 若项目未配 ESLint，用 vue-tsc 做类型级验证并过滤本次改动文件：

```bash
npx vue-tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "本次编辑的文件名"
```

- 存量代码本身可能有类型错误，只关注本次编辑文件相关的报错行。
- dev server / 后端服务的重启一律由用户完成；改完只通过浏览器对已在运行的服务做只读验证（访问页面、看控制台报错、核对嵌入形态与独立页形态两种渲染），不要重启或杀进程。

## 常见坑清单

1. 标题组件 `number` 从 required 改可选后，忘记给徽章加 `v-if` → 独立页渲染出空徽章。
2. 组件根节点改了 section id → 原页锚点导航静默失效。
3. 竞态 token 与原页面共享 → 嵌入形态下父子互相丢弃响应，列表偶发为空。
4. 新增独立页忘了登记 `pageStatMap` → 页面访问统计永远缺这一页，且无报错提示。
5. hash 路由用裸 `/detail/1` 拼 href → 新标签打开 404。
6. scoped 样式迁移时漏了板块内部用到的父页局部类（如 `.section-container` 的布局约束）→ 独立页形态下样式塌陷；抽完两种形态都要过一遍目。
