---
name: save-confirm-diff-dialog
description: Vue3 + Element Plus 后台「保存前变更核对确认」通用模式——提交前弹核对弹窗，用表格列出「变更项 / 原始值 / 修改值」，用户确认后才真正调保存接口。核心套路：原始值快照 reactive（init 装载后封存不随表单改动）+ 深度 diff 构建器（字段键/数组元素/枚举值三层中文标签映射、对象递归、对象数组按索引对比+整块新增删除哨兵 Symbol、原始值数组整体对比防顺序错位、空值/布尔/枚举格式化、__ 前缀瞬态剔除与落库口径一致）+ 核对弹窗组件（el-alert 影响提示 + el-table 明细 tag + on_confirm 异步回调失败保持打开可重试、append-to-body 嵌套）+ 行内 el-switch 轻量确认（「由「原状态」修改为「新状态」」+ 取消/失败回拨开关）。触发场景：保存前确认、保存确认弹窗、变更核对、变更明细、原始值修改值对比、先核对后落库、提交前 diff、修改留痕预览、深度对比 JSON 配置变更、el-switch 启停确认回拨、无变更跳过保存、表单快照对比、误改拦截。凡后台管理端要在保存/提交/启停前弹出「原始值 → 修改值」核对确认的任务都应参考。
---

# Vue3 + Element Plus 保存前变更核对确认弹窗（save-confirm-diff-dialog）

## 适用场景

后台编辑弹窗「保存即生效 / 影响面大」（门户配置、运营内容、审批单据），误改一处就全量提交，管理员需要**先看清改了什么再落库**。两种形态：

- **完整版**：编辑弹窗提交前弹核对弹窗，逐条列出「变更项 / 原始值 / 修改值」，确认才真正调保存接口；
- **轻量版**：列表行内 `el-switch` 启停这类单字段开关，用 `ElMessageBox.confirm` 一句话核对（「由「启用」修改为「停用」」+ 生效影响），取消/失败回拨开关。

基于 Vue 3.4 + Element Plus 2.x + TypeScript + vue-tsc 验证（源自后台前台配置页实战：结构化模型递归 diff + JSON 配置体兜底对比 + 列表行内启停）。核心思想一条：**核对弹窗展示的必须是「打开表单那一刻的原始值」与「点保存那一刻的表单值」的差**——原始值用独立快照封存，diff 前剔除瞬态字段与提交落库口径保持一致。

```
init 装载 ──▶ original_snapshot 封存原始值（此后不随表单改动）
提交 validate ──▶ build_confirm_rows(快照, 表单值)
                    │ rows.length === 0 → ElMessage.info 跳过保存（防「打开就保存」）
                    ▼
              核对弹窗 open({ rows, on_confirm })
                    │ 用户点确认
                    ▼
              await on_confirm() 真正调保存接口（失败弹窗保持打开可重试）
```

---

## 1. 原始值快照：diff 的 before 侧

```ts
/** 打开弹窗时装载的原始值快照（核对「原始值」列的取数来源，装载后绝不随表单改动） */
const original_snapshot = reactive({ name: "", sort_order: 0, status: 1, config_value: "" });

const init = (id?: number) => {
  if (!id) { Object.assign(original_snapshot, { name: "", sort_order: 0, status: 1, config_value: "" }); return; }
  baseService.get("/xxx/info", { id }).then((res: any) => {
    Object.assign(dataForm, res.data ?? {});                       // 表单可改
    Object.assign(original_snapshot, {                             // 快照只在此处封存一次
      name: dataForm.name, sort_order: dataForm.sort_order,
      status: dataForm.status, config_value: dataForm.config_value
    });
  });
};
```

**踩坑点**
- 快照必须**逐字段拷值**（`Object.assign` 展开），不能把表单对象/其深层模型直接引用进去——引用共享则 diff 恒为空，核对弹窗永远「无变更」。
- 快照封存时机 = 装载接口返回后**一次**；装载前（新增场景）重置为空值。
- 新增场景无原始值：不硬凑 diff，整组行 `kind: "added"`（before 列统一「—（新增）」占位），配置内容给一行**内容摘要**（如「结构化内容（1234 字符）」）而非整串 JSON。

---

## 2. 深度 diff 构建器：产出中文路径 + before/after 展示串

### 2.1 三层中文标签映射（换页面只改这三张表，diff 算法不动）

```ts
/** 字段键 → 中文标签（未命中回退原键名——新键零登记成本，想要中文再补登记） */
const key_labels: Record<string, string> = { title: "标题", link: "跳转链接", hidden: "隐藏" /* 按页面登记 */ };
/** 数组字段 → 元素业务叫法（生成「服务项 1」「卡片 2」这类路径段） */
const item_labels: Record<string, string> = { services: "服务项", cards: "卡片", metrics: "指标" };
/** 枚举字段取值 → 展示文案（未命中回退原值） */
const value_enums: Record<string, Record<string, string>> = {
  align: { left: "靠左", center: "居中", right: "靠右" }
};
```

路径段拼接：`join_path = (parent, child) => (parent ? `${parent} › ${child}` : child)`，产出如「分组 1 › 卡片 2 › 跳转链接」。

### 2.2 递归对比规则（哨兵 Symbol 处理整块新增/删除）

```ts
export interface diff_row {
  label: string;   // 变更项路径（中文段拼接）
  before: string;  // 原始值展示串
  after: string;   // 修改值展示串
  kind: "changed" | "added" | "removed";
}

/** 另一侧不存在的哨兵（整块新增/删除） */
const diff_missing = Symbol("diff_missing");
const is_plain_object = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
const equal_values = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

const collect_diff = (label: string, before: any, after: any, key: string, rows: diff_row[]) => {
  const before_absent = before === diff_missing, after_absent = after === diff_missing;
  if (before_absent !== after_absent) {
    // 整块（对象/数组）新增/删除给占位摘要单行，不逐字段铺开；叶子字段缺省显示「（未设置）」
    const present = before_absent ? after : before;
    const block = is_plain_object(present) || Array.isArray(present);
    rows.push({
      label: label || "配置内容",
      before: before_absent ? (block ? "—（新增）" : "（未设置）") : format_value(key, before),
      after: after_absent ? (block ? "—（已删除）" : "（未设置）") : format_value(key, after),
      kind: before_absent ? "added" : "removed"
    });
    return;
  }
  if (is_plain_object(before) && is_plain_object(after)) {
    // 对象：并集键递归（缺侧补哨兵）
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => !k.startsWith("__"));                       // 瞬态字段不入对比
    for (const k of keys) {
      collect_diff(join_path(label, key_labels[k] ?? k), before[k] ?? diff_missing, after[k] ?? diff_missing, k, rows);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // 原始值数组（元素全非对象）：整体对比——顺序调整时逐项对比会全部错位误报
    if (before.every((i) => !is_plain_object(i)) && after.every((i) => !is_plain_object(i))) {
      if (!equal_values(before, after)) rows.push({ label: label || "配置内容", before: format_value(key, before), after: format_value(key, after), kind: "changed" });
      return;
    }
    // 对象数组：按索引逐项递归，短侧补哨兵（「服务项 1」「服务项 2」…）
    const child_label = item_labels[key] ?? "项";
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      collect_diff(join_path(label, `${child_label} ${i + 1}`), before[i] ?? diff_missing, after[i] ?? diff_missing, child_label, rows);
    }
    return;
  }
  if (!equal_values(before, after)) {
    rows.push({ label: label || "配置内容", before: format_value(key, before), after: format_value(key, after), kind: "changed" });
  }
};

/** 入口：对比前两侧统一剔除 __ 前缀瞬态字段（与保存 replacer 同一口径） */
export const build_diff = (before_model: any, after_model: any, root_key = ""): diff_row[] => {
  const rows: diff_row[] = [];
  collect_diff("", strip_transient(before_model), strip_transient(after_model), root_key, rows);
  return rows;
};
```

### 2.3 值格式化：人读得懂的 before/after 列

```ts
const format_value = (key: string, value: any): string => {
  if (value === undefined || value === null || value === "") return "（空）";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (typeof value !== "object") return value_enums[key]?.[String(value)] ?? String(value);
  // 原始值数组顿号拼接展示（空数组归「（空）」）
  if (Array.isArray(value) && value.every((i) => !is_plain_object(i))) {
    return value.map((i) => format_value(key, i)).join("、") || "（空）";
  }
  return JSON.stringify(value);   // 对象兜底
};
```

### 2.4 瞬态字段剔除：与提交落库同一口径

```ts
/** 深拷贝并剔除 __ 前缀瞬态字段（自定义态/折叠态/自动 key 标记等；约定见 json-config-editor skill） */
const strip_transient = (model: any): any => {
  if (Array.isArray(model)) return model.map(strip_transient);
  if (is_plain_object(model)) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(model)) {
      if (k.startsWith("__")) continue;
      result[k] = strip_transient(v);
    }
    return result;
  }
  return model;
};
```

**踩坑点（diff 正确性四件套）**
- **两侧都剔除 `__` 瞬态**：不剔除会误报一堆「自定义态 false→true」「折叠态 true→false」这类 UI 噪音变更，核对弹窗失去信任。
- **before 侧要走与 after 侧同一套「默认合并/normalize」重建**：结构化表单的 before 模型用 `build_form(原始库值)` 重建（补齐新字段缺省）再对比，否则存量数据缺新字段会被整批误报成「（已删除）」。
- **原始值数组禁止逐项对比**：排序优先级键数组顺序一调，逐项对比会每项都报修改；`JSON.stringify` 整体对比一行搞定。
- **对象数组按索引对比是已知取舍**：中间插入一项会把后续全部报成「修改」而非「新增」。选索引而非按业务 key 匹配，取的是「服务项 1」路径段业务语义直观、实现简单；若条目有稳定业务键且插入频繁，再升级按 key 匹配。
- **非对象类型比较用 `JSON.stringify` 统一判等**，避免 `NaN`/引用相等性坑。

---

## 3. 核对弹窗组件：一个页面写一个，跨弹窗复用

组件不接 props，暴露 `open(payload)` 命令式入口，保存动作以**异步回调**注入：

```ts
interface confirm_payload {
  title: string;                          // 「保存确认：编辑「常用服务」」
  rows: diff_row[];                       // 变更明细行
  on_confirm: () => Promise<any>;         // 确认后执行的实际保存（失败抛错，弹窗保持打开）
  success_message?: string;               // 保存成功提示文案
}
```

```html
<el-dialog v-model="visible" :title="title" width="900px" append-to-body
           :close-on-click-modal="false" :close-on-press-escape="false">
  <!-- ① 润色提示：变更处数 + 影响范围 + 留痕 + 退路 -->
  <el-alert type="warning" :closable="false" show-icon>
    <template #title>本次保存共 <b>{{ rows.length }}</b> 处变更，请逐项核对「原始值 → 修改值」后再执行保存。</template>
    <div>
      <p>· 保存成功后<b>立即生效</b>，所有访问用户马上可见，请核对影响范围；</p>
      <p>· 本次变更会记入「修改记录」留痕备查；如需调整，请点击「取消」返回编辑。</p>
    </div>
  </el-alert>

  <!-- ② 变更明细表：类型 tag + 长值截断 -->
  <el-table :data="rows" border size="small" max-height="420">
    <el-table-column label="类型" width="76" align="center">
      <template v-slot="{ row }">
        <el-tag size="small" effect="plain" :type="kind_tag_type(row.kind)">{{ kind_label(row.kind) }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="变更项" prop="label" min-width="200" show-overflow-tooltip></el-table-column>
    <el-table-column label="原始值" min-width="230" show-overflow-tooltip>
      <template v-slot="{ row }"><span class="diff-value old" :class="{ 'is-placeholder': row.kind === 'added' }">{{ row.before }}</span></template>
    </el-table-column>
    <el-table-column label="修改值" min-width="230" show-overflow-tooltip>
      <template v-slot="{ row }"><span class="diff-value new" :class="{ 'is-placeholder': row.kind === 'removed' }">{{ row.after }}</span></template>
    </el-table-column>
  </el-table>

  <template #footer>
    <el-button :disabled="saving" @click="visible = false">取消，返回编辑</el-button>
    <el-button type="primary" :loading="saving" @click="on_confirm">确认保存</el-button>
  </template>
</el-dialog>
```

```ts
const on_confirm = async () => {
  if (!confirm_handler) return;
  saving.value = true;
  try {
    await confirm_handler();
    visible.value = false;
    ElMessage.success({ message: success_message, duration: 1200 });
  } catch {
    // 保存失败：请求层已统一弹错误提示，这里保持弹窗打开便于修正后重试
  } finally {
    saving.value = false;
  }
};
defineExpose({ open });
```

**样式语义**（原始值删除线灰底 / 修改值绿底；新增行的原始值、删除行的修改值是占位串不画删除线）：

```css
.diff-value.old { color: var(--el-text-color-secondary); background: var(--el-fill-color-light);
  text-decoration: line-through; text-decoration-color: var(--el-text-color-placeholder); }
.diff-value.new { color: var(--el-text-color-primary); background: var(--el-color-success-light-9); }
.diff-value.is-placeholder { text-decoration: none; }
```

**踩坑点**
- **类型语义三色统一**：`added=success「新增」`、`removed=danger「删除」`、`changed=warning「修改」`，全站保持一致，用户零学习成本。
- **`append-to-body` 必加**：核对弹窗叠在编辑弹窗之上，不加会被父弹窗 z-index/裁剪吞掉。
- **`close-on-click-modal` / `close-on-press-escape` 双禁**：核对是严肃动作，误触遮罩/ESC 静默关掉等于没核对。
- **失败不关弹窗**：`on_confirm` 抛错时 catch 里什么都不做（错误提示由请求层统一弹），用户改完直接重试；成功才 `visible=false` + success 提示。
- `saving` 态同时驱动确认按钮 loading 与取消按钮 disabled，防双击重复提交。

---

## 4. 提交接入：编辑弹窗侧的 glue 代码

```ts
const data_form_submit = () => {
  data_form_ref.value.validate((valid: boolean) => {
    if (!valid) return false;
    const config_value = is_known_code.value
      ? JSON.stringify(form.model, (key, value) => (key.startsWith("__") ? undefined : value))  // 落库口径：剔除瞬态
      : json_text.value;
    const rows = build_confirm_rows(config_value);   // 基础字段逐项 + 深度 diff，见下
    if (!rows.length) {                              // 无变更：跳过保存，不发无意义请求、不留空痕
      ElMessage.info("本次未修改任何内容，无需保存");
      return false;
    }
    save_confirm_ref.value.open({
      title: `保存确认：${data_form.id ? "编辑" : "新增"}「${data_form.name}」`,
      rows,
      success_message: "保存成功，已即时生效",
      on_confirm: async () => {                      // 真正的保存只在确认后发生
        await baseService.post("/xxx/save", { id: data_form.id ?? undefined, /* ... */ config_value });
        visible.value = false;
        emit("refreshDataList");
      }
    });
  });
};
```

`build_confirm_rows` 的分派结构：

1. **基础标量字段**逐项手写对比（名称/排序/状态/说明……），空串与 `null` 归一后比较，展示串走各自的文案翻译（如状态 1→「启用」）；
2. **结构化模型**：`rows.push(...build_diff(build_form(code, original_snapshot.config_value), form.model, code))`——before 侧用同一套 build_form 重建（见 §2 踩坑点）；
3. **JSON 文本兜底编码**：两侧都能 `JSON.parse` 才递归 diff，任一侧非法/为空则**整串文本一行对比**（label「配置体 JSON」）——非法 JSON 不炸、不丢核对能力；
4. **新增场景**（无 id）：整组 `kind: "added"`，配置内容给摘要行（字符数），不硬凑逐字段。

---

## 5. 轻量版：列表行内 el-switch 启停确认

单字段开关不值得上完整弹窗，用 `ElMessageBox.confirm` 一句话核对。`v-model` 会先把开关翻到目标值，确认/失败都要**回拨**：

```ts
const status_handle = (row: any) => {
  const target = row.status;
  const source = target === 1 ? 0 : 1;
  const source_text = source === 1 ? "启用" : "停用";
  const target_text = target === 1 ? "启用" : "停用";
  const effect_text = target === 1 ? "门户该板块即时恢复展示" : "门户该板块立即停用";
  ElMessageBox.confirm(
    `启用状态将由「${source_text}」修改为「${target_text}」。确认后立即生效，${effect_text}；该操作会记入「修改记录」留痕备查。请核对无误后再执行。`,
    "变更确认",
    { confirmButtonText: "确认修改", cancelButtonText: "取消", type: "warning" }
  )
    .then(() => baseService.post("/xxx/status", { id: row.id, status: target }))
    .then(() => ElMessage.success({ message: target === 1 ? "已启用" : "已停用", duration: 1500 }))
    .catch(() => { row.status = source; });   // 取消与请求失败都走 reject：统一回拨开关
};
```

**踩坑点**
- **`.catch` 回拨一箭双雕**：`ElMessageBox` 点取消是 reject、请求失败也是 reject——一个 catch 同时覆盖两种，漏写任何一种界面与库就不一致。
- 文案必须含「由「原状态」修改为「新状态」」与**生效影响说明**（这边是核对模式的核心价值，不是套话）。
- 无权限渲染成 tag 只读（`v-if` 权限判断包住 switch），避免只读用户翻开关触发确认。

---

## 落地 checklist（给一个编辑弹窗接入）

1. `original_snapshot` reactive 快照，init 装载后 `Object.assign` 封存一次（新增场景重置空值）；
2. 建 `diff_row` 三件套：`key_labels` / `item_labels` / `value_enums` 映射表（未命中的键自动回退，零登记可用，想要中文再补）；
3. 抄 §2 的 `collect_diff` / `format_value` / `strip_transient` / `build_diff`（通用算法无需改）；
4. 页面放一个 §3 的核对弹窗组件（可整页复用），`append-to-body` + 双禁误关；
5. 提交函数按 §4 接入：validate → build rows → 空则 info 跳过 → open 弹窗，真实保存移入 `on_confirm`；
6. 结构化模型 before 侧走同一套 `build_form`/normalize 重建；JSON 兜底两侧可解析才递归；
7. 行内 el-switch 启停按 §5 轻量版接入（记得 catch 回拨）；
8. diff 正确性自测四连：改一个值 / 增删一个整块 / 调一次原始值数组顺序 / 动一下瞬态字段（自定义态、折叠）——前三条各出正确行数，第四条零行。

## 参考实现

startup 项目后台前台配置页（结构最全：结构化模型递归 diff + JSON 兜底 + 行内启停）：
- `startup-admin-web/src/views/front/config/config-diff.ts`（diff 构建器全文，即 §2 原型）
- `startup-admin-web/src/views/front/config/save-confirm-dialog.vue`（核对弹窗组件，即 §3 原型）
- `startup-admin-web/src/views/front/config/add-or-update.vue`（`original_snapshot` ≈888 行、`build_confirm_rows` ≈1108 行、提交接入 ≈1149 行）
- `startup-admin-web/src/views/front/config/index.vue`（行内启停轻量版 `statusHandle` ≈114 行）

配套约定：`__` 前缀瞬态字段、结构化表单 normalize 见技能 `json-config-editor`。
