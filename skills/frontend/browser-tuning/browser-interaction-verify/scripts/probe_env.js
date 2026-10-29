'use strict';
/**
 * IAB / 被遮挡 webview 环境失真探针（在页面上下文执行，一次出全套诊断）。
 *
 * 本文件就是一个闭包无关的 async 函数声明（只依赖 document/window/performance），
 * 便于整体序列化后交给 page.evaluate。
 *
 * 用法一（Playwright / browser-use node_repl，推荐）：
 *   import { readFileSync } from 'node:fs';
 *   const src = readFileSync('scripts/probe_env.js', 'utf8');
 *   const probeEnv = new Function(src + '\nreturn probeEnv;')();
 *   const report = await page.evaluate(probeEnv);   // 函数无闭包引用，可序列化
 *
 * 用法二：直接把函数体粘贴进 page.evaluate(async (…) => { … })。
 *
 * 返回：
 * {
 *   visibility, hasFocus,          // 环境遮挡状态（visible + hasFocus=false 即可复现全部失真）
 *   raf,                           // 'alive' | 'suspended'
 *   scroll: { events, scrollYAfter },  // 程序化滚动是否派发 scroll 事件
 *   timer: { requested, actual, ratio }, // setTimeout 钳制倍率（实测约 2.5）
 *   diagnosis: string[],           // 逐条结论
 * }
 *
 * 注意：探针自身的 setTimeout 等待同样被钳制，全流程名义 ~1.5s，实际可能 ~4s。
 * 等待时长均为“名义值”，用于探测足够，不用于精确计时。
 */
async function probeEnv(rafWaitMs = 800, scrollWaitMs = 400, timerProbeMs = 300) {
  const diagnosis = [];

  // 0) 环境遮挡状态
  const visibility = document.visibilityState;
  const hasFocus = document.hasFocus();
  if (visibility === 'visible' && !hasFocus) {
    diagnosis.push('visible 但 hasFocus=false：被遮挡 webview，以下失真大概率全部存在，勿改业务代码，改用替代验证法');
  }

  // 1) rAF 是否挂起：race 探测
  const raf = await Promise.race([
    new Promise(res => requestAnimationFrame(() => res('alive'))),
    new Promise(res => setTimeout(() => res('suspended'), rafWaitMs)),
  ]);
  if (raf === 'suspended') {
    diagnosis.push('rAF 挂起：rAF 驱动的动画/循环卡死；locator.click 的稳定性检查（两帧 rAF）永远超时，用 force:true 或 evaluate 里 dispatchEvent 替代');
  }

  // 2) 程序化滚动是否派发 scroll 事件：事件计数器
  const scroll = await new Promise(res => {
    let n = 0;
    const on = () => n++;
    window.addEventListener('scroll', on, { passive: true });
    const y = window.scrollY;
    window.scrollTo(0, y + 300);
    setTimeout(() => {
      window.removeEventListener('scroll', on);
      window.scrollTo(0, y);
      res({ events: n, scrollYAfter: window.scrollY });
    }, scrollWaitMs);
  });
  if (scroll.events === 0) {
    diagnosis.push('程序化滚动不派发 scroll 事件：scroll-spy 等依赖 scroll 事件的组件在此环境“看起来坏了”属环境失真，行为验证改走组件实例直调（el.__vueParentComponent.proxy）');
  }

  // 3) setTimeout 钳制倍率
  const timer = await new Promise(res => {
    const t0 = performance.now();
    setTimeout(() => {
      const actual = Math.round(performance.now() - t0);
      res({ requested: timerProbeMs, actual, ratio: +(actual / timerProbeMs).toFixed(2) });
    }, timerProbeMs);
  });
  if (timer.ratio > 1.5) {
    diagnosis.push(`setTimeout 被钳制约 ${timer.ratio} 倍：节流定时器（如 60ms）实际数百 ms 才触发；后续所有等待按倍率放大，断言前先等 flush`);
  }

  if (!diagnosis.length) {
    diagnosis.push('未检出典型失真：行为异常请回到代码/样式排查');
  }

  return { visibility, hasFocus, raf, scroll, timer, diagnosis };
}
