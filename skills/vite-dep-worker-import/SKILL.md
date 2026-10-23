---
name: vite-dep-worker-import
description: Vite dev 启动报 "Error during dependency optimization: Cannot read file: xxx.js?worker" 的排查与修复技能：npm 私服/第三方组件包预打包 dist 产物内含 `?worker` 导入（如 monaco-editor 的 editor.worker?worker）导致依赖预构建 esbuild 把 query 当文件名找不到文件而崩溃。触发场景：Vite dev server 启动即崩、optimizeDeps 报 Cannot read file、dist 里 import worker、`?worker` 导入、optimizeDeps exclude 修复、"new dependencies optimized" 整页重载、组件包升级后 dev 起不来。凡 npm 包 dist 兼容性 / Vite 依赖预构建报错 / worker 导入崩启动的排查都应参考。
---

# Vite 依赖预构建不认 `?worker`：npm 包 dist 内 worker 导入导致 dev 启动崩（vite-dep-worker-import）

## 现象

Vite dev server 启动即崩（还没打开页面），报错形如：

```
Error during dependency optimization:
X [ERROR] Cannot read file: <绝对路径>/node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker
```

出错位置指向某个 node_modules 包的**预打包 dist 产物**，例如 `node_modules/@wonders/quest-web/dist/index.es.js` 里有：

```js
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
```

关键特征：报错文件名以 `?worker` 结尾——这是 Vite 的源码模块请求约定被当成了磁盘文件路径。

## 根因

- `?worker` 后缀是 Vite **源码模块**的请求约定，由 `vite:worker` 插件在 dev transform / build rollup 管线里处理，把对应模块编译成 worker chunk。
- 但**依赖预构建**（optimizeDeps，esbuild 打包 node_modules 里的预打包 dist）不认识 query 后缀：esbuild 会把 `editor.worker.js?worker` 整串当作磁盘文件名去找，文件不存在直接报错崩掉整个 dev server。
- **只有当 npm 包的预打包 dist 里出现 `?worker` 导入时才触发**；宿主自己源码里写 `xxx?worker` 完全没问题（走的是源码模块管线）。
- 这类问题通常由组件包升级引入（例如新版本内嵌了 monaco/代码编辑器及其 worker），同一 monorepo/私服里的其他同族包可能没有。生产 build 不走 dep optimizer，rollup 管线的 `vite:worker` 插件能处理 `?worker`，一般不受影响。

## 诊断三步

1. **定位雷在哪个/哪几个包**：看报错里 import 语句所在的包，grep 其 dist 确认所有 `?worker` 导入点：

   ```bash
   grep -o 'from "[^"]*?worker"' node_modules/<pkg>/dist/*.js | sort -u
   ```

2. **列出该包 dist 对外部的裸依赖（bare imports）并核对宿主是否已在用**：

   ```bash
   grep -oE 'from "[a-z@][^"]*"' <dist文件> | sort -u
   ```

   这一步决定 exclude 之后会不会触发二次预构建整页重载（见下文安全性论证）：被 exclude 包的裸依赖必须已被宿主源码使用并预构建，否则首次访问该包时会触发 "new dependencies optimized" 整页 reload。

3. **顺带排查同族私服包**是否也含 `?worker` 导入（一起处理，或确认无隐患）：

   ```bash
   grep -l '?worker' node_modules/@<scope>/*/dist/*.js
   ```

## 修复

把该包加入 `vite.config.ts` 的 `optimizeDeps.exclude`，让它在 dev 下绕过 esbuild 预构建、运行时走源码模块管线（由 `vite:worker` 插件正常编译 `?worker` 导入）：

```ts
export default defineConfig({
  optimizeDeps: {
    exclude: ["@wonders/quest-web"],
  },
});
```

`?worker` 后缀保留不动，无需任何 alias/改写。

**安全性论证（exclude 的两个前提）**：

- 被 exclude 包的裸依赖（如 vue、element-plus、axios、公共包）必须已被宿主使用并预构建。若某裸依赖只有该包在用，首访会触发 "new dependencies optimized" 整页重载——把这些依赖显式加进 `optimizeDeps.include` 兜底即可。
- dist 体积不大的话，首访时 vite 现场 transform 该包的开销可忽略（比预构建多一次性毫秒级开销）。

## 不可行方案（别踩）

| 方案 | 为什么不行 |
|------|-----------|
| `optimizeDeps.esbuildOptions.plugins` 把 `?worker` 请求 external 化 | external 后运行时的模块重写链条不可控，worker 路径易 404 |
| `resolve.alias` 映射去掉 `?worker` 后缀 | worker 会被当普通 JS 模块加载（主线程执行、无 Worker 语义），行为错误 |
| patch-package 直接改包 dist | 组件包一升级即失效，且污染依赖树 |

## 根治建议（组件包源仓侧）

组件包打包 dist 时不要产出 `?worker` 裸导入，改用浏览器原生写法：

```js
new Worker(new URL("./editor.worker.js", import.meta.url), { type: "module" })
```

或把 worker 外置为独立入口由宿主注入——让产物内不出现 `?worker`，才是对所有宿主构建工具都安全的形态。

## 真实案例

2026-10-22 startup-admin-web（Vite 7.3.7）：`@wonders/quest-web` 1.4.13 升级后 dist 新增 2 个 monaco worker `?worker` 导入（`editor.worker?worker`、`editorWorkerService` 相关），dev server 启动即崩。修复 = `optimizeDeps.exclude: ["@wonders/quest-web"]`；其 dist 裸依赖 vue / element-plus / axios / @wonders/common-web / @wonders/monaco-editor 宿主 main.ts 均已在用，无需补 include；同族 console-web / sys-web / vital-web 均无 `?worker` 导入，无隐患。
