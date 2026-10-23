'use strict';
/**
 * scroll-spy 纯判定逻辑 · 全矩阵回归模板（Node 直接跑，脱离坏环境）。
 *
 * 用法：
 *   1. 把组件里的判定逻辑（迟滞带/阈值矩阵等）复制进下方 decideActive——
 *      只搬纯函数，不搬 DOM/Vue/定时器依赖；
 *   2. 在 expectations 表里手工写死期望值（不要由被测函数推导，否则等于自己测自己）；
 *   3. node logic_matrix_template.js；退出码非 0 即有失败。
 *
 * ⚠ 从源码复制时，offset/容差的加减口径必须逐字符一致（+header、-hysteresis、
 *   距底部判定用 viewportH 还是 bottomGap 等），口径不一致会造成矩阵假失败，
 *   把人引回坏环境里白排查——先核对口径，再怀疑逻辑。
 *
 * 优点：偏移 × 滚动位置全矩阵（含 ±十几 px 边界小位移）在此可可靠覆盖，
 *       这正是在内嵌浏览器里读数不可靠、必须外包出去的部分。
 */

// ↓↓↓ 示例判定逻辑（“激活线 + 迟滞带 + 触底直达”scroll-spy，按真实组件源码改写）↓↓↓
/**
 * @param {Array<{id: string, top: number}>} sections 各栏目 offsetTop（升序）
 * @param {number} scrollY 当前滚动位置
 * @param {number} viewportH 视口高度
 * @param {{headerH?: number, hysteresis?: number, bottomGap?: number}} opt
 * @returns {string} 应激活的栏目 id
 */
function decideActive(sections, scrollY, viewportH, opt = {}) {
  const headerH = opt.headerH ?? 64;      // 吸顶导航高度：激活线 = scrollY + headerH
  const hysteresis = opt.hysteresis ?? 24; // 迟滞带：防止边界抖动
  const bottomGap = opt.bottomGap ?? 80;   // 距底部不足 bottomGap 时强制激活最后一项
  const line = scrollY + headerH + hysteresis;
  let active = sections[0].id;
  for (const s of sections) if (line >= s.top) active = s.id;
  const last = sections[sections.length - 1];
  if (scrollY + viewportH >= last.top + bottomGap) return last.id;
  return active;
}
// ↑↑↑ 复制到这里为止 ↑↑↑

// 被测对象：固定一组栏目偏移（按真实页面的 offsetTop 采样，含贴近真实边界的值）
const sections = [
  { id: 'a', top: 0 },
  { id: 'b', top: 800 },
  { id: 'c', top: 1700 },
  { id: 'd', top: 2600 },
];
const viewportH = 900;
const opt = { headerH: 64, hysteresis: 24, bottomGap: 80 };

// 期望值表：[scrollY, 期望激活栏目]，人工按需求写死（含边界 ±小位移样本）
// ⚠ 期望表必须与实现口径一致：本例触底直达在 scrollY >= 2600 + 80 - 900 = 1780 即生效，
//   若把 1780 以后仍写成 c 就是"期望表口径不一致→假失败"（正文的警告点）。
const expectations = [
  [0, 'a'],
  [700, 'a'],
  [710, 'a'],
  [712, 'b'],   // 激活线跨过 b.top：712 + 64 + 24 = 800
  [1600, 'b'],
  [1612, 'c'],  // 激活线跨过 c.top：1612 + 64 + 24 = 1700
  [1779, 'c'],
  [1780, 'd'],  // 触底直达：1780 + 900 >= 2600 + 80
  [99999, 'd'], // 触底直达
];

let failed = 0;
for (const [scrollY, expected] of expectations) {
  const got = decideActive(sections, scrollY, viewportH, opt);
  if (got !== expected) {
    failed++;
    console.log(`FAIL scrollY=${scrollY} 期望=${expected} 实际=${got}`);
  }
}

// 可选：全扫描一致性——相邻期望值之间不允许出现第三个激活项（防漏分支）
for (let i = 1; i < expectations.length; i++) {
  const [y0, e0] = expectations[i - 1];
  const [y1, e1] = expectations[i];
  if (e0 === e1) continue;
  const allowed = new Set([e0, e1]);
  for (let y = y0 + 1; y < y1; y += 7) {
    const got = decideActive(sections, y, viewportH, opt);
    if (!allowed.has(got)) {
      failed++;
      console.log(`FAIL 扫描 scrollY=${y}（${e0}→${e1} 过渡段）出现意外激活=${got}`);
      break;
    }
  }
}

console.log(failed ? `\n${failed} 例失败` : '全部通过');
process.exit(failed ? 1 : 0);
