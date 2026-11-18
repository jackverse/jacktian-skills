---
name: public-asset-baseurl
description: Vue 3 + Vite 项目里 public/ 目录静态资源（图片/logo/占位图/二维码）的正确引用方式——一律用 import.meta.env.BASE_URL 拼绝对路径（只写在 script 里，模板禁止内联 import.meta），禁用 ./ 相对路径与裸 / 绝对路径。触发场景：public 图片 404、二级路由图片裂图、history 模式图片加载不到、相对路径引用 public 资源、部署子路径（非根 base）图片 404、本地正常线上图片裂图、模板内联 import.meta 报 sourceType 编译错、SFC 编译失败整页白屏/打开极慢。凡涉及组件模板 img src、script 兜底图常量、数据数组 image 字段、index.html 外静态资源引用的改动都应参考。
---

# public 静态资源引用必须走 BASE_URL（public-asset-baseurl）

基于 Vue 3.5 + vue-router 4 + Vite 6 + @vitejs/plugin-vue 5 验证（相对路径 404 为 history 模式必踩，hash 模式侥幸不触发；模板内联 import.meta 编译雷与路由模式无关，任何模式都踩）。

## 现象

组件里写 `<img src="./login-logo.png">` 引用 public/ 下资源：

- **一级路由页**（`/`、`/policy`）图片正常；
- **二级路由页**（`/policy/hot`、`/financing/products`）图片 404 裂图；
- 本地 dev（base 为根）大多侥幸正常，**部署到子路径**（vite base 非 `/`，如 `/kczx/app/`）后全站裂图。

**第二种触发形态——修复姿势不对，直接白屏**：修 404 时把 `import.meta.env.BASE_URL` 直接内联进模板表达式（如 `` :src="`${import.meta.env.BASE_URL}x.png`" ``），SFC 编译即报
`Error parsing JavaScript expression: import.meta may appear only with 'sourceType: "module"'`，vite dev 下**用到该组件的页面整页白屏、打开极慢**（编译失败反复重试），比原 404 更严重。

## 根因

**`./` 相对路径由浏览器按"当前 URL 所在目录"解析，与组件文件在磁盘上的位置无关。** history 模式下 URL 就是真实路径，浏览器把 `/policy/hot` 当成 `/policy/` 目录下的 `hot` 文件：

| 当前路由 URL | `./logo.png` 解析结果 | 结果 |
|---|---|---|
| `/`（基准目录 `/`） | `/logo.png` | 命中（侥幸） |
| `/policy`（基准目录 `/`） | `/logo.png` | 命中（侥幸） |
| `/policy/hot`（基准目录 `/policy/`） | `/policy/logo.png` | **404** |
| `/financing/products`（基准目录 `/financing/`） | `/financing/logo.png` | **404** |

hash 模式不触发：URL 恒为 `/#/xxx`，基准目录永远是 `/`，相对路径碰巧全对——这也是"从 hash 切 history 后突然裂图"的原因。

**第二层坑**：改成正斜杠绝对路径 `/logo.png` 只修了路由层级，没修部署前缀——vite base 为 `/kczx/app/` 时，真实资源在 `/kczx/app/logo.png`，裸 `/logo.png` 照样 404。dev 环境两者都正常，**只有构建产物部署后才暴露**。

**第三层坑（修复时的编译雷，与路由模式无关）**：Vue SFC 的模板内联表达式（`{{ }}`、`v-bind` 值等）由编译器按**非 module 的 script 模式**经 babel 解析，`import.meta` 属于模块语法，在这里不合法——编译期直接拦截，与浏览器路径解析、hash/history 都无关。所以 BASE_URL 只能写在 `<script>` 里，模板经变量引用。

## 修复口径

一律用 `import.meta.env.BASE_URL` 拼接，一处口径覆盖路由层级 + 部署前缀两个变量。**铁律：`import.meta` 只准出现在 `<script>` 里，模板永远只引用 script 暴露出来的变量**：

```html
<!-- ❌ 模板内联 import.meta：sourceType 编译报错 → 白屏 -->
<img :src="`${import.meta.env.BASE_URL}login-logo.png`" />

<!-- ✅ <script setup>：顶层常量模板可直接引用 -->
<script setup>
const LOGIN_LOGO = `${import.meta.env.BASE_URL}login-logo.png`;
</script>
<template>
  <img :src="LOGIN_LOGO" />
</template>

<!-- ✅ Options API：模块顶层 const 在模板里不可见（模板作用域只认组件实例绑定），
     必须经 data()/computed 暴露，模板拿到变量后再拼 -->
<script>
export default {
  data() {
    return {
      base_url: import.meta.env.BASE_URL,
    };
  },
};
</script>
<template>
  <img :src="`${base_url}login-logo.png`" />
</template>
```

```ts
// ✅ script 内的对象常量/数据数组里拼 BASE_URL 完全合法——编译只卡模板内联
const FALLBACK_COVER = `${import.meta.env.BASE_URL}brand-assets/default-cover.svg`;
```

- **Vite 保证 `BASE_URL` 以 `/` 结尾**，拼接时右侧直接写 `xxx.png`，不要再补 `/`；
- vite.config 里 base 建议做归一化，杜绝环境变量带出 `./` 或丢尾斜杠：

```ts
const base = (env.VITE_APP_CONTEXT || env.VITE_ROUTER_BASE || './').replace(/\/*$/, '') || '/';
base: base === '/' ? '/' : base + '/',
```

## 排查残留

```bash
grep -rnE "['\"]\./[a-zA-Z0-9_/-]+\.(png|jpe?g|svg|gif|webp|ico)" src/
grep -rnE 'src="/[a-zA-Z0-9_/-]+\.(png|jpe?g|svg|gif|webp|ico)"' src/   # 裸绝对路径（部署子路径时 404）
grep -rn "import\.meta" src/ --include=*.vue   # 命中后逐条确认行是否落在 <template> 段内（script 段内命中合法）
```

期望前两条零命中；命中即改 BASE_URL 拼接（并确认落在 script）。

## 编译失败定位（curl dev server，只读）

白屏且控制台刷编译错时，直接 curl 该 SFC 的模块 URL，vite 按需编译单文件即可定位是哪个文件挂了，不用碰浏览器：

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:<port>/src/pages/XxxPage.vue"
# 500 + 响应体带 sourceType/import.meta 报错 = 该 SFC 编译失败
# 200 + JS 产物 = 编译正常，换下一个文件排查
```

去掉 `-o /dev/null` 可看响应体里的完整报错栈与行号。

## 易漏点（比模板里的 `<img>` 更常踩）

模板里肉眼可见的 `<img src="./...">` 一搜就到，真正反复复发的是这些"看不见 img 标签"的位置：

1. **script 里的兜底图常量**：`DEFAULT_COVER`、`FALLBACK_COVER`、默认头像、占位图——只在数据为空/加载失败时才渲染，平时根本不裂，一上线某页没图才暴露；
2. **数据数组/配置对象里的 image 字段**：轮播图列表、快捷入口 icon 数组，字段值是字符串路径，渲染散落在 `v-for` 里；
3. **内嵌 footer/长文案副本里的 `<img>`**：整段 HTML 存在字符串常量或富文本里，grep 图片扩展名能捞到，但容易被当成"文案"放过；
4. **导出的服务层/API 层常量**：路径字符串从 `constants.ts`、接口默认值里来，组件里只见到变量名，不看源头根本想不到是相对路径。

统一原则：**凡是最终进 `src` 属性的路径字符串，无论经过几层中转，源头必须写在 `<script>` 里拼 `${import.meta.env.BASE_URL}...`，模板只绑变量。**

## 不用改的（避免过度改造）

- **index.html 里的 `/favicon.png`、`/logo.png`**：Vite 构建时会自动给 index.html 中 `img[src]`/`link[href]` 加 base 前缀，写 `/` 开头即可；
- **`import xxx from '@/assets/xxx.png'` 的打包资源**：走构建管线，import 时已被 Vite 改写成带 base 的产物 URL，天然免疫；
- **后端返回的完整 http(s) URL**：与 base 无关。

## 真实案例

2026-11 Vue 3 门户项目（vue-router 4 history 模式 + Vite 6，base 由 `VITE_APP_CONTEXT` 环境变量决定、部署子路径）：登录 logo 相对写法在 `/policy/hot` 等二级路由裂图，排查后全站共改 10 余处——header 登录图标（SiteHeader，script 三元常量）、footer 兜底常量与二维码默认值（`default_footer_center_logo`、`official_account` 回退）、占位图（政策日历/指南 `kwImgUrl`）、订阅封面（`MySubscriptions.kwImg`）、页面级兜底封面（`FinancingPage`/`ActivitiesPage`/`FindServiceDetailPage` 等），全部统一 `${import.meta.env.BASE_URL}...`；vite.config base 归一化补尾斜杠；grep `['\"]\./...\.png` 清零。

后续修复中在页脚组件（FooterSection，Options API）把 BASE_URL 内联进模板 `:src`，踩中第三层坑：`sourceType: "module"` 编译错、用到页脚的页面 dev 白屏且反复重编译。改为 data 暴露 `baseUrl: import.meta.env.BASE_URL`、模板 `` :src="`${baseUrl}...`" `` 后恢复；定位手段即上文 curl dev server——请求该 SFC 模块 URL 返回 500 + sourceType 报错，200 的文件逐一排除。
