---
name: json-config-editor
description: Vue3 + Element Plus 后台「结构化 JSON 配置编辑器」通用扩展套路——把存在库表 text 列里的 JSON 配置体做成结构化表单（下拉选图标/图片、分组折叠、隐藏沉底、拼音 key 自动生成、跨工程静态资源预览），以及配置体的排序优先级链形态与键改造演进（多因子排序配置化）。触发场景：JSON 配置可视化编辑、预设下拉+自定义路径、el-select 自定义态哨兵值、瞬态字段不落库、__ 前缀剔除、hidden 隐藏沉底置灰、分组折叠 v-show 保持焦点、pinyin-pro 自动生成 key 撞车补日期、vite proxy 代理另一前端工程 public 资源预览、el-select change 内联箭头函数 vue-tsc TS7006、排序优先级链、配置化排序因子、逐级开关、第一优先级/第二优先级表单呈现、申报期命中优先、置顶优先级、排序开关改优先级链、配置体废弃键处理、改配置种子 SQL 后缓存不生效。凡给后台管理端新增/扩展「JSON 配置体结构化编辑」页面、或把排序类开关组合改造成显式优先级链的任务都应参考。
---

# Vue3 + Element Plus 结构化 JSON 配置编辑器通用套路（json-config-editor）

## 适用场景

配置体存库表 text 列（如 `config_value` 一坨 JSON），后台要把它做成**结构化表单**而非裸 JSON textarea：列表项可增删、图标/图片用预设下拉选、分组可折叠、条目可隐藏、标识 key 自动生成、图片能缩略预览。典型载体：门户首页板块配置（宫格服务、重点入口分组卡片、四角徽标、数据面板）。

基于 Vue 3.4 + Element Plus 2.x + Vite 5 + vue-tsc 验证（源自 startup 项目首页前台配置实战，§1-§7 是编辑器端套路；§8-§9 源自同一配置体「政策与活动日历」排序因子化改造，覆盖配置形态设计与存量演进）。核心思想只有一条：**编辑态是「库内字段 + `__` 前缀瞬态字段」的并集，保存时统一剔除瞬态**——其余模式全部围绕它展开。

## 总览：七个模式一张图

```
存量 JSON ──merge 默认──▶ normalize 补缺省/瞬态 ──▶ 结构化表单（下拉/折叠/隐藏/key）
                                                                      │
保存 ◀── JSON.stringify replacer 剔除所有 __ 键 ◀────────────────────┘
消费端（门户）：filter hidden → 全空 v-if 兜底
```

---

## 1. 预设下拉 + 自定义态（哨兵值 `__custom`）

**为什么不能用 v-model**：下拉的当前值有两种来源——真值（预设路径/空）与「自定义态标记」（正在手输路径，真值仍在 `image` 字段里）。v-model 会把哨兵写进数据，必须拆成 `:model-value`（getter 函数）+ `@change`（setter 函数）。

```ts
// 预设清单最后放哨兵项；预设值数组用于识别存量自定义值
const icon_options = [
  { value: "", label: "无图标" },
  { value: "brand-assets/icon-a.webp", label: "图标A" },
  { value: "__custom", label: "自定义路径…" }
];
const icon_preset_values = icon_options.map(i => i.value).filter(v => v && v !== "__custom");

// getter：自定义态显示哨兵，否则真值（空串回落"无"）
const icon_model = (item: any) => (item.__icon_custom ? "__custom" : item.image || "");
// setter：选哨兵只切态、保留原值作编辑起点；选预设则落值退态
const on_icon_change = (item: any, value: string | number) => {
  const v = String(value);
  if (v === "__custom") { item.__icon_custom = true; return; }
  item.__icon_custom = false;
  item.image = v;
};
```

```html
<el-select :model-value="icon_model(item)" @change="(value: string) => on_icon_change(item, value)">
  <el-option-group v-for="g in image_groups" :key="g.label" :label="g.label">
    <el-option v-for="o in g.options" :key="o.value" :label="o.label" :value="o.value" />
  </el-option-group>
  <el-option label="自定义路径…" value="__custom" />
</el-select>
<el-input v-if="item.__icon_custom" v-model="item.image" placeholder="相对路径基于站点根" />
```

**踩坑点**
- **存量自定义值要露出输入框**：老配置里存的路径不在预设清单时，加载阶段须标自定义态，否则下拉显示成空白且找不到路径输入框。加载后逐项补：`item.__icon_custom = Boolean(item.image) && !preset_values.includes(item.image)`。
- 选哨兵**不要清空原值**——保留它，用户切换到自定义态时输入框里是原值，可在此基础上改，而不是从零输入。
- 哨兵值用 `__custom` 这类不可能与真实路径撞的字符串；预设清单本身不要把哨兵算进 `preset_values`。
- 分组展示用 `el-option-group`，常看的资源单独成组置顶，减少运营翻找。

---

## 2. 瞬态字段约定（`__` 前缀 + 保存剔除 + normalize 补缺省）

编辑态标记（自定义态 `__icon_custom`/`__image_custom`、折叠态 `__collapsed`、key 自动态 `__key_auto`）统一 `__` 前缀，与库内字段一眼区分。

**保存：replacer 一行剔除所有瞬态键**（含深层嵌套，JSON.stringify 递归遍历时逐键回调）：

```ts
configValue = JSON.stringify(form.model, (key, value) => (key.startsWith("__") ? undefined : value));
```

**加载/新增：normalize 函数补齐缺省**（存量 JSON 没有新字段、更没有瞬态字段；数组也要兜底空数组）：

```ts
const normalize_groups = (model: any) => {
  if (!Array.isArray(model)) return;
  for (const group of model) {
    group.hidden = Boolean(group.hidden);        // 存量无该字段 → 兜底为显示
    group.__collapsed = false;
    group.__key_auto = !group.key;               // 已有 key 的存量组默认不自动覆盖
    group.cards = Array.isArray(group.cards) ? group.cards : [];  // 数组兜底，头行计数不炸
    for (const card of group.cards) {
      card.hidden = Boolean(card.hidden);
      card.__collapsed = false;
      card.__image_custom = Boolean(card.image) && !preset_values.includes(card.image);
    }
  }
};
```

**踩坑点**
- normalize 必须**幂等且在两处调用**：编辑加载后、切换编码给默认模型后，缺一处就会出现 `undefined` 折叠态/计数崩。
- 头行要显示「N 张卡片」这类计数时，`cards` 缺省兜底空数组是硬前提——存量数据缺 `cards` 字段直接 `.length` 会白屏。
- 逐字段缺省合并可再套一层 `mergeForm(默认对象, JSON.parse(存量))`（对象递归、数组逐项按 index 合并），让「配置 schema 新增字段」对存量数据透明。
- 模型工厂函数（`default_group()` 等）里瞬态字段直接给初值，新增项无需再走 normalize。

---

## 3. 隐藏（hidden）语义：配置保留、展示层沉底

后台「隐藏」≠ 删除：数据留在库里（可随时恢复），编辑器里**置灰沉底**仍可编辑，门户消费端**不渲染**。

**编辑器端：stable sort 包装数组，index 始终指原数组**——这是排序展示不乱位的唯一正确姿势：

```ts
// map 出 {item, index} 再 sort，比较函数只按 hidden 归一值排（stable sort 保持原相对顺序）
const sorted_items = computed(() =>
  (form.model?.items ?? []).map((item: any, index: number) => ({ item, index }))
    .sort((a, b) => Number(a.item.hidden === true) - Number(b.item.hidden === true))
);
```

```html
<div v-for="entry in sorted_items" :key="'item-' + entry.index" :class="{ 'is-hidden-item': entry.item.hidden }">
  <!-- 删除操作 splice(entry.index, 1)：指向原数组，隐藏项沉底后删除也不删错行 -->
  <el-button link type="danger" @click="form.model.items.splice(entry.index, 1)">删除</el-button>
```

```css
.is-hidden-item { opacity: 0.6; }  /* 隐藏只置灰不消失，头行配「已隐藏」tag */
```

**消费端（门户）**：filter 掉 hidden 项，全隐藏时整板块 `v-if` 兜底：

```ts
const groups = list
  .filter(g => !g.hidden)
  .map(g => ({ ...g, cards: (g.cards ?? []).filter(c => !c.hidden) }))
  .filter(g => Boolean(g.tab && g.cards.length));  // 空 tab/空卡片组也不展示
```

```html
<section v-if="featureGroups.length"> … </section>  <!-- 全隐藏/空配置 → 整板块消失，不再回退内置默认 -->
```

**踩坑点**
- **绝不能直接对原数组 sort**：v-for 遍历排序后的引用、删除/新增却 splice 原数组，两边索引必然错位；`{item, index}` 包装是标准解。
- `Number(x === true)` 是为了把 `undefined`/`"0"` 等脏值统一当「未隐藏」。
- 消费端记得**逐字段 String()/Boolean() 规整**再渲染（存量 JSON 字段类型不可信），并处理「配置里已无门户记住的 key」时回落第一组。

---

## 4. 折叠：`__collapsed` 瞬态 + v-show 保焦点

```html
<div class="block-head is-toggle" @click="item.__collapsed = !item.__collapsed">
  <el-icon class="fold-icon" :class="{ 'is-folded': item.__collapsed }"><ArrowDown /></el-icon>
  <span>分组 {{ entry.index + 1 }}：{{ item.tab || "未命名" }}</span>
  <span class="block-ops" @click.stop>  <!-- 操作区阻断冒泡，点开关/删除不触发折叠 -->
    <el-switch v-model="item.hidden" active-text="隐藏" />
    <el-button link type="danger" @click="splice(entry.index, 1)">删除</el-button>
  </span>
</div>
<div v-show="!item.__collapsed" class="block-body">…表单字段…</div>
```

```css
.is-toggle { cursor: pointer; user-select: none; }
.fold-icon { transition: transform 0.18s; }
.fold-icon.is-folded { transform: rotate(-90deg); }
```

**踩坑点**
- 用 **`v-show` 不用 `v-if`**：v-if 会销毁重建输入组件，折叠再展开，正在输入的焦点/未失焦内容全丢；v-show 仅隐藏 DOM，输入态原样保留。
- 头行操作区（switch/删除按钮）必须 `@click.stop`，否则点「隐藏」顺带把整块折叠了。
- 折叠态是瞬态字段，天然不落库、重开对话框全部展开——这正是期望行为。

---

## 5. 标识 key 自动生成（pinyin-pro + 撞车补日期）

key 供门户「记住选中 tab」，需唯一且稳定。

```ts
import { pinyin } from "pinyin-pro";

// tab 中文 → 拼音 key：去声调、只留字母数字；纯符号输入得空串（调用方要兜底）
const pinyin_key = (tab: string) =>
  pinyin(String(tab ?? ""), { toneType: "none" }).toLowerCase().replace(/[^a-z0-9]/g, "");

const date_stamp = () => {
  const n = new Date(), pad = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}`;
};

// 撞车检测：与兄弟项撞 → 追加当天 yyyymmdd；同日再撞 → -2、-3 序号
const unique_key = (base: string, self_index: number) => {
  const used = new Set<string>((form.model ?? []).flatMap((g: any, i: number) => (i === self_index || !g.key ? [] : [String(g.key)])));
  if (!used.has(base)) return base;
  const stamp = date_stamp();
  let candidate = `${base}${stamp}`, serial = 2;
  while (used.has(candidate)) candidate = `${base}${stamp}-${serial++}`;
  return candidate;
};

// 随输随生成，但只在「自动态」生效；手改过 key 后永不覆盖
const on_tab_input = (item: any, self_index: number) => {
  if (!item.__key_auto) return;
  const base = pinyin_key(item.tab);
  item.key = base ? unique_key(base, self_index) : "";   // 纯符号 → 空 key，别生成垃圾
};
```

```html
<el-input v-model="item.tab" @input="on_tab_input(item, entry.index)" placeholder="如：重点入口" />
<el-input v-model="item.key" placeholder="留空则随 tab 自动生成" @input="item.__key_auto = false" />
```

**踩坑点**
- **`__key_auto` 的初始化分两种来源**：新增项恒 `true`（随输随生成）；存量项 `!item.key`（normalize 里判断）——存量配置已有 key 时**默认不自动覆盖**，否则门户记住的选中态（按 key 匹配）会静默失效。这是「方便」与「稳定性」的权衡点，必须默认保守。
- 纯符号/纯空格的 tab 生成空串：`base ? unique_key(base) : ""` 兜底，别把空串送去撞车检测。
- 重复 key **只警示不阻断**：computed 收集出现 >1 次的 key 集合，头行下方红字提示，不挡保存（运营有兜底判断力，硬阻断反而烦）。
- 撞车检测排除自己（`i === self_index`）与空 key 项，否则自己和自己撞。

---

## 6. 跨工程静态资源预览（vite proxy + el-image）

配置里引用的资源属于**另一个前端工程**的 `public/` 目录（如门户工程的 `portal-assets/images/...`），后台工程本地根本没有这些文件，直接预览 404。

**后台工程 vite.config.ts：dev proxy 把资源前缀转发到对方 dev 端口**：

```ts
server: {
  port: 8001,
  // 卡片图片预览：portal-assets 打包资源只随门户工程（dev 固定 18090）发布，admin 本地无此目录；
  // 代理转发缩略图/大图预览，门户 dev 未启动时预览位显示"无法预览"占位
  proxy: {
    "/portal-assets": { target: "http://localhost:18090", changeOrigin: true }
  }
}
```

**预览地址规范 + el-image 兜底**：

```ts
// http(s) 原样；相对路径规范成站点根绝对路径（剥多余前导斜杠），dev 经代理、生产按门户域名解析
const preview_url = (path: string) => {
  const p = String(path ?? "").trim();
  if (!p) return "";
  return /^https?:\/\//i.test(p) ? p : "/" + p.replace(/^\/+/, "");
};
```

```html
<el-image v-if="item.image" :src="preview_url(item.image)"
  :preview-src-list="[preview_url(item.image)]" preview-teleported fit="cover" class="image-preview">
  <template #error><div class="image-preview-error">无法预览</div></template>
</el-image>
```

**踩坑点**
- 下拉选值入库的是**原样相对路径**（`portal-assets/images/x.png`），proxy 前缀恰好等于路径首段——约定「配置值以资源前缀开头」比存完整 URL 可移植（换域名不用改数据）。
- `preview-teleported` 必加，否则大图预览层被 el-dialog 的 z-index/裁剪吞掉。
- `#error` 插槽兜底「无法预览」：对方 dev server 没启动、路径写错都不至于白块。生产环境若后台与门户不同域，需把代理前缀换成网关层同款转发或完整 URL。
- 相对路径统一 `preview_url` 规范成根绝对路径再请求——避免相对路径被解析到当前路由子路径下。

---

## 7. 类型坑：el-select 内联 @change 箭头函数 TS7006

element-plus 的 emits 是**无类型字符串数组**，模板里内联 `@change="(value) => ..."` 的 `value` 会被 vue-tsc 推成 implicit any，报 `TS7006`。显式标注参数类型即可：

```html
<!-- ✗ @change="(value) => on_change(item, value)"  → TS7006 -->
<el-select :model-value="icon_model(item)" @change="(value: string) => on_icon_change(item, value)">
```

setter 端收 `value: string | number` 再 `String(value)`（el-select 可能给出 number 类型 value，如纯数字路径），模板侧标 `string` 不冲突。

---

## 8. 排序优先级链：多因子排序配置化（逐级开关）

配置体里「一堆布尔开关组合出隐晦排序语义」的形态（如 `status_first` + `top_first` 两个开关、外加一排数据来源开关）在因子超过两个后就不可维护：组合数翻倍、没人能预测排序结果。升级方向是**显式排序优先级链**：排序因子按固定顺序组装成链式 Comparator，每个因子一个独立布尔开关逐级可关；后台表单按「第一优先级 / 第二优先级 / …」命名呈现，管理员看到的是链序而不是无序开关堆。

**配置形态**（配置键 = 各因子开关 + 兜底时间列；开关缺省全开）：

```json
{
  "period_first": true,        // 第一优先级：申报期命中当月的排最前
  "top_first": true,           // 第二优先级：置顶的排最前
  "status_first": true,        // 第三优先级：状态成组（如上架中在前）
  "sort_field": "release_time" // 末端兜底排序时间列（不设开关）
}
```

**消费端组装**（语言无关，Java 侧 `Comparator.thenComparing` 同构）：

```ts
// 链序固定：按优先级逐级 push，开关关闭的因子不进链；`!== false` 表达「读不到新键缺省全开」
const chain: Array<(a: Row, b: Row) => number> = [];
if (cfg.period_first !== false) chain.push(byBoolDesc(r => r.in_period));
if (cfg.top_first    !== false) chain.push(byBoolDesc(r => r.top_flag));
if (cfg.status_first !== false) chain.push(byBoolDesc(r => r.online));
chain.push(byFieldDesc(cfg.sort_field || "release_time"));   // 时间列倒序兜底
chain.push(byBoolDesc(r => r.id));                           // id 倒序稳定决胜
rows.sort((a, b) => { for (const cmp of chain) { const r = cmp(a, b); if (r !== 0) return r; } return 0; });
```

**要点**
- **链序固定、逐级可关**：关掉某级 = 该级 Comparator 不进链，数据顺延到下一级因子，语义是"降级"而不是"乱序"；缺省全开保证存量 JSON / 种子 SQL 未同步新键的窗口期行为可预期（即改造前行为）。
- **时间列 + id 倒序永远作末端兜底、不参与调序**：兜底段不设开关——它定义的是同级内的确定序，关掉只会得到不稳定排序，管理员没有理由需要它可关。

### 第一优先级命中判定的必要条件（防长期内容霸榜）

第一梯队的命中键必须是**必要条件式**的：条件不满足就不命中本级、顺延后续因子，否则无边界数据（如未下架的长期有效内容）永远霸占第一梯队。

```ts
// 行模型命中键 in_period：构造行 DTO 时按同一 now 算死存进行模型
const in_period = (row: Row, now: Date): boolean => {
  if (!row.begin_time || !row.end_time) return false;   // 开区间（缺任一侧边界）→ 不命中本级
  return now >= row.begin_time && now <= row.end_time;  // 全年受理类窗口覆盖全年 → 天然恒命中（符合预期）
};
```

- **角标与排序键共用同一时刻计算、构造时定死**：展示层「申报中」角标与排序键 `in_period` 必须由同一函数、同一 `now` 算出并写进行模型（构造时定死），不能排序用一份计算、角标渲染时再算一次——时钟跨秒或口径不一致时会出现「排进了第一梯队却没角标」的分组与角标不一致。

**踩坑点**
- 旧形态的「数据来源开关」（如 include_policy / include_guide / include_activity）若被优先级链取代，按 §9 的废弃键套路处理，不要读、也不要删。
- 两个因子的开关组合（status_first×top_first）还能靠人脑枚举；第三个因子加进来之前就该换成优先级链，别等组合爆炸。

---

## 9. 配置体键改造的同步套路（存量 JSON 演进）

给既有配置体换键 / 加键 / 废键（配置 schema 演进）时，按本节逐项同步，避免漏改任何一端：

1. **消费端读配置加缺省兜底**：新键全部走「缺省 = 改造前行为」（排序链缺省全开），消费端读不到键不报错——存量 JSON 与种子 SQL 未同步的窗口期行为不变。
2. **废弃键不读、不删**：新代码不再读旧键（`include_*` 之类），但**不要写迁移代码去删存量 JSON 里的旧键**，也不要在表单 normalize / 保存 replacer 里剔除——留着无害，表单 mergeForm 合并存量时会原样保留，用户下次保存自然带出；专门的删键代码反而制造一次性数据迁移风险。
3. **SQL 四件套**（配置种子落在库表里的项目）：
   - 日期增量 SQL 追加幂等 UPDATE（按主键/编码定位，重复执行结果一致）；
   - init 基线的种子行同步改成终态（保证只跑 init 基线也能建出全新终态库）；
   - 配置项 remark / 说明字段文档化优先级链（管理员在后台能看到链序口径）；
   - **直连库改完必须刷新缓存**：配置走 Redis 写穿透快照的（机制见 config-table-redis-write-through），直接 UPDATE 数据库不会失效缓存——要么重启服务（触发启动预热），要么在后台管理页把该配置重存一次（走写穿透），否则改库不生效，排查时极易误判成「代码没生效」。
4. **语义变化的键名要逐字核对单测断言**：键名沿用但语义改变（如 `status_first` 从「状态优先开关」变成「优先级链第三级」）时，既有单测断言的期望结果集要逐条重推并同步改写——键名没变恰恰最容易漏改测试。

---

## 落地 checklist（新接入一个结构化配置编码）

1. `default_forms[code]` 登记内置默认模型（与种子 SQL / 消费端兜底三处一致）；
2. 新编码模板区写结构化表单（下拉/折叠/隐藏按上文模式）；
3. 消费端 computed filter hidden + 逐字段规整 + 空则整块 v-if；
4. normalize / default 工厂补齐 hidden 与全部瞬态缺省，数组兜底空数组；
5. 保存 replacer 剔除 `__` 键（一行，勿手写白名单）；
6. 引用了他工程 public 资源 → vite proxy + preview_url + #error 兜底；
7. vue-tsc 过一遍内联箭头函数参数类型；
8. 含排序语义的配置优先用「排序优先级链」形态（§8）：命中键按必要条件设计、角标与排序键同源同时刻算死进行模型、兜底段不设开关；
9. 改既有配置键时走 §9 同步套路：消费端缺省兜底 → 废弃键不读不删 → SQL 四件套（含改库后刷 Redis 快照）→ 键名语义变化的单测断言逐字核对。

## 参考实现

startup 项目（样例最全，含分组+卡片两级嵌套）：`startup-admin-web/src/views/front/config/add-or-update.vue`（serviceIconModel/onServiceIconChange、feature_image_model/on_feature_image_change、normalize_feature_groups、sorted_groups/sorted_cards、unique_group_key/pinyin_key/on_group_tab_input、`__` replacer）、消费端 `startup-pub-web/src/pages/HomePage.vue`（featureGroups computed）、跨工程代理 `startup-admin-web/vite.config.ts`（server.proxy /portal-assets）。

排序优先级链与配置体键改造：startup 项目「政策与活动日历」配置（同一 `tb_front_config` 配置体：period_first / top_first / status_first / sort_field 优先级链开关 + 行模型命中键 in_period，废弃 include_policy / include_guide / include_activity 三键，消费端 Service 缺省全开兜底）——后台表单在该 front/config 页面，排序消费逻辑在门户日历查询 Service。
