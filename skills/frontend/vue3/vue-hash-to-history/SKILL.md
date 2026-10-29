---
name: vue-hash-to-history
description: Vue 3 + vue-router 4 前端从 hash 模式切 history 模式的完整改造 checklist。触发场景：hash 改 history、去掉 URL # 号、createWebHashHistory 切 createWebHistory、URL 里不想看到 #、history 模式刷新 404、SSO 回调地址带 # 要去掉、旧 hash 链接兜底重定向、SPA 部署 nginx try_files 回退。凡涉及 vue-router 路由模式切换、前端路由 URL 形态变更、SPA history 模式部署与旧链接兼容的任务都应参考。
---

# Vue 3 hash 路由切 history 模式改造 checklist（vue-hash-to-history）

## 适用场景

Vue 3 + vue-router 4 项目（任意构建工具，vite 尤佳）要把 URL 从 `https://host/base/#/path?query` 切成 `https://host/base/path?query`。典型动机：URL 干净、SEO/埋点友好、对接只认真实路径的外部系统。

**前置认知（为什么远不止改一行）**：hash 从不发给服务器，所以 hash 模式下"路由跳转"全部发生在浏览器本地；切 history 后路径变成真实 URL，于是 **SSO 回调地址、nginx 部署配置、手工拼 URL 的代码**这三类"hash 模式下碰巧能用"的地方全部暴露出来。本 checklist 按"必改 → 部署 → 兜底 → 别多改"组织，逐项勾选即可，换任何项目可复用。

## Checklist

### 1. 核心切换：router 创建

```ts
// before
const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// after —— base 必须显式传
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
```

- **base 必须显式传 `import.meta.env.BASE_URL`**：多环境部署（如 vite base 由环境变量 `VITE_APP_CONTEXT` 决定）时，`BASE_URL` = vite config 的 `base`。省略参数虽然默认也是 `import.meta.env.BASE_URL`，但显式写出才能在 code review 时一眼确认部署前缀语义；且若项目在 vite.config 里用 `define` 或环境差异化处理过 base，显式传是唯一稳妥解。
- vite.config 里 `base` 保持由环境变量注入的写法不动，history 切换不影响静态资源前缀。

### 2. 全局排查 hash 依赖（grep 清单）

路由器自身 API（`$router.resolve(location).href`、`router.push`、`<router-link>`）两种模式自动兼容，**不用改**；要抓的是绕过 router 手工操作 URL 的代码：

```bash
grep -rn "location.hash" src/
grep -rn "'#/" src/        # 含 "#/" 的字符串拼接，双引号变体也查
grep -rn '"#/' src/
grep -rn "replace(/#.*\$/" src/   # 手工剥 hash 拼 URL
```

典型命中与标准替换品：

| 命中模式 | 场景 | 替换为 |
|---|---|---|
| `location.hash = '#/xxx'` | 登录失效跳首页等 | 见 checklist 第 6 条 |
| `window.open('#/xxx')` / 拼接 `'...#/xxx?a=1'` | 分享链接、新窗口、iframe src | `router.resolve({ name/path, query }).href`（相对）或拼 `BASE_URL + resolve().href`（绝对），两种模式均产出正确 URL |
| `window.location.href.replace(/#.*$/, ...)` | 手工去掉 hash 部分再拼路径 | `location.origin + import.meta.env.BASE_URL + 'xxx'`，或 `router.resolve(...).href` |

原则：**凡是"我知道 URL 长什么样所以手拼"的代码都是雷**，统一换成 router API 让框架按当前模式生成。

### 3. SSO/OAuth2 回调地址（后端 → 前端的 302 目标）

后端"登录成功后 302 回前端"的配置项（如 `frontend-callback-url`，值形如 `https://host/base/#/sso-callback`）在 hash 模式下只能这么写；切 history 后 **`#` 及其后内容根本不会出现在 302 Location 的目标页 URL 解析里**，前端回调路由会 404 或落首页。四处同步去 `#`：

1. `@Value("${xxx.frontend-callback-url:https://host/base/#/sso-callback}")` 的**默认值**；
2. `application-*.yml` 各环境配置；
3. **部署环境的实际环境变量/启动参数**（经常覆盖 yml，最容易漏）；
4. 后端**测试断言**里写死的期望值。

**关键区分，避免误伤**：这个地址是"后端 → 前端"的跳转目标，**不是**向 IdP 注册的 OAuth2 `redirect_uri`。改它**不需要动 IdP 侧白名单**；而 IdP 注册的 `redirect_uri`（指向后端 callback 端点）与路由模式无关，**不要改**。若项目里两者名字相近（都叫 callback/redirect），先画清跳转方向再动手。

### 4. 部署侧 SPA fallback（nginx）

history 模式下 `/base/sub/route` 是真实路径，服务器上没有这个文件，必须回退到入口 HTML：

```nginx
location /base/ {
  try_files $uri $uri/ /base/index.html;
}
```

- **没配 = 刷新 / 直链 / SSO 302 回来全部 404**，这是切完 history 后最高频的线上事故。
- vite dev 默认 `appType: 'spa'` 自带 history 回退，本地不用管。
- **部署配置经常不在前端仓库里**（运维仓 / 服务器上手改的 nginx.conf / 网关层）：收尾时明确提醒用户核对线上 nginx（或网关路由规则）已加 fallback，别默认"前端改完就完了"。

### 5. 旧链接兜底 shim（收藏 / 分享的 hash 地址）

hash 不发给服务器，用户收藏夹、聊天记录里的 `https://host/base/#/detail?id=1` 切完后请求的是 `/base/`，**全部落到首页**且无报错——必须在应用入口做一次性迁移重定向。放 `main.ts` 顶部、路由初始化之前：

```ts
// one-time shim: legacy hash URL -> history URL
const hash = window.location.hash;
if (hash.startsWith('#/')) {
  window.location.replace(
    import.meta.env.BASE_URL.replace(/\/+$/, '') + hash.slice(1),
  );
}
```

- `hash.slice(1)` 把 `#/detail?id=1` 变 `/detail?id=1`，**天然携带旧 query 与二级锚点**，无需手工解析；
- 用 `location.replace` 而非赋值 `href`：不留旧 hash 记录，用户回退键不会退回 hash 页面再被重定向一次造成循环；
- 该 shim 可在数月后旧链接消化殆尽时移除，标注注释日期即可。

### 6. 登录失效等整页跳转

原写法 `location.hash = '#/'` 只在 hash 模式下有效；history 模式下它只是把 URL 追加个 `#`，路由不变。改为**整页跳转到应用根**：

```ts
if (window.location.pathname !== import.meta.env.BASE_URL.replace(/\/+$/, '') + '/') {
  window.location.href = import.meta.env.BASE_URL;
}
```

- 为什么不引 `router.push('/')`：这个逻辑通常在 http 拦截器里，拦截器模块与 router 模块互相引用易成循环依赖，整页 `location.href` 干净解耦；
- **先比较 pathname**：已在首页时（如首页接口 401）不再重复跳转，避免刷新循环。

### 7. 不受影响项（写明，避免过度改造）

以下写法与路由模式无关，**不要顺手改**：

- 埋点/页面统计按 **route name**（而非 path）上报的——name 与模式无关；
- 后台菜单/数据库录入的站内路径经 `router.push(path)` 跳转的——router 自动按当前模式解析；
- `<a href="#">` 占位 + `@click.prevent` 的——`#` 只是占位符，不参与路由；
- vite.config 的 `base`、静态资源路径、`import.meta.env.BASE_URL` 的所有既有用法。

### 8. 验证方式

```bash
# 1. 类型检查（只读，不加 --fix）
npx vue-tsc --noEmit    # 或项目等价 tsc 脚本

# 2. 完整构建
npx vite build          # .vue 文件内注释级改动只有 build 能兜住，dev/tsc 不编译模板内注释

# 3. grep 残留
grep -rn "'#/\|\"#/" src/   # 期望零命中（shim 那处 startsWith('#/') 除外）

# 4. 手工冒烟：首页直达、二级页刷新、浏览器回退、带 query 的旧 hash 链接打开、SSO 登录全程跳转
```

## 真实案例

2026-10 Spring Boot + Vue 3 门户项目（vite 构建、base 由 `VITE_APP_CONTEXT` 决定、SSO 登录、nginx 部署）：

- `createWebHashHistory()` → `createWebHistory(import.meta.env.BASE_URL)`；
- grep 命中 3 处手工 hash 操作（登录失效 `location.hash = '#/'`、分享链接 `'#/'` 拼接、`href.replace(/#.*$/,...)`），全部换 `router.resolve(...).href` / `location.href = BASE_URL`；
- 后端 `frontend-callback-url` 在 `@Value` 默认值、yml、测试断言三处同步去 `#`（IdP 侧 redirect_uri 未动）；
- nginx 加 `try_files $uri $uri/ /ctx/index.html`（该配置不在前端仓库，口头提醒运维核对）；
- main.ts 加旧 hash 链接一次性 `location.replace` shim；
- 验证：vue-tsc 只读检查 + vite build 通过，grep `#/` 仅剩 shim 一处。
