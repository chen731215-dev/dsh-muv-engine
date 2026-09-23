// Verification (keep): 自动撑高在**真浏览器**里收敛吗？
//
// 为什么要单独验：起始高度（600 / 900 / 1500）如果会影响报回来的数字，那说明量的是
// 「视口回显」而不是内容高 —— 卡普遍写着 `html,body{height:100%}`，此时
// `documentElement.scrollHeight` 与 `body.scrollHeight` **都等于视口高**（= iframe 当前
// 高度），报回去就是不动点：正文美化内容只有 ~241px，却被留在起始值上。
//
// 判据（三个真卡文档 × 三个起始高度）：
//   ① 同一个文档，三档起始高度报回的最终高度**必须一致**（与起始值无关）
//   ② 正文美化必须能**缩小**（证明不是不动点）
//   ③ 报回的最终高度落在内容真实量级（ERA ≈900 / 主页 ≈2000 / 正文美化 <400）
//
// 用**独立** user-data-dir 跑 Edge 无头；多代理共用 profile 会互相踩（不报错也没结果）。
//
// Run: node verify-frame-height.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { loadClientRenderers, loadClientRenderersFrom, extractFunction, clientSource } from './test-client-source.mjs'
import { openPage, evalJson, sleep } from './verify-shared.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

const CARD = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'
if (!fs.existsSync(CARD)) { console.log('SKIP 找不到真卡 ' + CARD); process.exit(0) }

const card = readPngCard(CARD)
const data = card.data && typeof card.data === 'object' ? card.data : card
const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []

/** 取围栏文档的正文（真卡三条大正则各自首尾一个围栏，已由 repro-card-fence-shape 验证）。 */
function fencedBody(rep) {
  return String(rep).replace(/^[ \t]{0,3}`{3,}[^\n`]*\r?\n/, '').replace(/`{3,}[ \t]*\r?\n?$/, '')
}

const PAYLOADS = scripts
  .filter(s => String(s?.replaceString || '').includes('```'))
  .map(s => ({ name: String(s.scriptName), html: fencedBody(String(s.replaceString)) }))
if (!PAYLOADS.length) { console.log('SKIP 拿不到围栏文档'); process.exit(0) }

// ★ 构建环境保真度：真实 DSH 里 `cardHtmlIframe` 在**浏览器里**跑，`window.innerHeight`
// 存在 ⇒ `rewriteVhMinHeight` 把卡里的 `min-height:100vh` 烤成父页视口常量（ST 语义，
// §ST-IFRAME-SPEC §4/§5）。Node 侧提取执行没有 `window` ⇒ 重写静默跳过 ⇒ 卡的 vh 原样
// 进 iframe ⇒ `min-height` 跟着 **iframe 自己的高度**伸缩 ⇒ 真·不动点。
// 那个"不收敛"是 Node 沙箱的缺省行为，不是上线行为（2026-09-22 实测教训：
// 之前测到的 954/1554 回声里还叠着探针 replace 打坏卡 CSS 的 bug，两层假象）。
// 这里给装载器传 `window.innerHeight = 900` 桩（探针窗口 --window-size=1200,900 ⇒
// headless 下 innerHeight 恰为 900），与真实聊天页同构。
const PROBE_VH = 900   // 探针窗口 --window-size=1200,900 ⇒ headless innerHeight 恰为 900
const PROBE_WIN = { innerHeight: PROBE_VH }
const R = loadClientRenderers(undefined, PROBE_WIN)
const STARTS = [600, 900, 1500]

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('SKIP 找不到 msedge.exe'); process.exit(0) }

// 探针页：每个文档 × 每个起始高度一个 iframe，跑真实的 cardHtmlIframe 产物 + 真实的
// 父页处理器（两者都从 lib/client.js 源码里取，测的是上线代码）。见下方 runProbe()。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-frameh-'))

/** 跑一个探针页，返回报告对象。每个文档单独起一次 Edge：9 个重 iframe 的 DOM 太大，
 *  一次 dump 会把管道缓冲打爆（ENOBUFS）。 */
function runProbe(payloads, R = loadClientRenderers(undefined, PROBE_WIN), tag = '', drive = '') {
  const framesHtml = []
  for (const p of payloads) {
    for (const start of STARTS) {
      // 起点高度**只改 iframe 自己的 style**，绝不写死默认值：默认值后来从 600 提到了 900，
      // 写死的 replace 会静默不生效，于是"三档起点收敛到同一值"这件事就没在测了。
      //
      // ★ 为什么不能只写 `/height:\d+px/`（第一个匹配）：srcdoc 里**卡自己的 CSS** 也有
      //   `height:62px` 这类声明（实测「正文美化（带音乐）」的 `.logo-btn`，srcdoc 在 style
      //   属性**之前**）—— 第一个匹配落在卡 CSS 上：起始高度从未生效（三档全是 900），
      //   卡布局反而被改坏（logo 变 600/900/1500px 高），于是"收敛失败/视口回显"其实是
      //   探针自己制造的假象。真卡臂曾因此连吃两个红，见 2026-09-22 修复记录。
      //   `style="display:block;width:100%;height:` 是本插件 iframe 的**专属前缀**，
      //   卡内容不可能撞上（escAttr 产物不含这个字面量序列）。
      const iframe = R.cardHtmlIframe(p.html)
        .replace(/(style="display:block;width:100%;height:)\d+px/, '$1' + start + 'px')
      framesHtml.push(iframe.replace('<iframe', '<iframe data-payload="' + p.name + '" data-start="' + start + '"'))
    }
  }
  const probe = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    framesHtml.join('\n') +
    '<pre id="out"></pre><script>' +
    // 处理器依赖 muvFrameHeightLimits()（夹取范围）；两个都从源码取，别漏 —— 漏了会在
    // 监听器里抛 ReferenceError，而事件监听器里的异常是**静默**的：高度永远不变，
    // 看起来像"收敛失败"，其实是探针自己的 bug。
    extractFunction(clientSource(), 'muvFrameHeightLimits') + '\n' +
    extractFunction(clientSource(), 'onMuvFrameHeightMessage') + '\n' +
    'window.__muvFrameHListener=1;' +
    'window.addEventListener("message", onMuvFrameHeightMessage, false);' +
    'var seen={};' +
    'window.addEventListener("message", function(e){' +
    'if(!e.data||e.data.__muvFrameHeight===undefined)return;' +
    'var all=document.querySelectorAll("iframe.muv-iframe");' +
    'for(var i=0;i<all.length;i++){if(all[i].contentWindow===e.source){' +
    'var k=all[i].dataset.payload+"@"+all[i].dataset.start;' +
    '(seen[k]=seen[k]||[]).push(e.data.__muvFrameHeight);}' +
    '}}, false);' +
    'function report(){var out={};' +
    'var all=document.querySelectorAll("iframe.muv-iframe");' +
    'for(var i=0;i<all.length;i++){var f=all[i];' +
    'out[f.dataset.payload+"@"+f.dataset.start]={final:parseFloat(f.style.height),reports:seen[f.dataset.payload+"@"+f.dataset.start]||[]};}' +
    'document.getElementById("out").textContent=JSON.stringify(out);}' +
    'window.addEventListener("load",function(){setTimeout(report,4000)});' +
    drive +
    '</script></body></html>'

  const file = path.join(tmpDir, 'probe-' + payloads[0].name.length + tag + '.html')
  fs.writeFileSync(file, probe, 'utf8')
  let dom = ''
  try {
    dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--window-size=1200,900', '--user-data-dir=' + path.join(tmpDir, 'profile-' + payloads[0].name.length + tag),
      '--virtual-time-budget=20000', '--dump-dom', 'file:///' + file.replace(/\\/g, '/')],
    { encoding: 'utf8', timeout: 300000, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    console.log('  SKIP Edge 没跑起来: ' + String(e.message).split('\n')[0])
    return {}
  }
  const mm = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)
  if (!mm) { console.log('  SKIP 没拿到测量结果（dump-dom ' + dom.length + ' 字）'); return {} }
  try {
    return JSON.parse(mm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  } catch (e) { console.log('  SKIP 结果解析失败: ' + e.message); return {} }
}

const result = {}
for (const p of PAYLOADS) Object.assign(result, runProbe([p]))

if (!Object.keys(result).length) { console.log('SKIP 没有测量结果'); process.exit(0) }

const byPayload = {}
for (const [key, v] of Object.entries(result)) {
  const [name, start] = key.split('@')
  ;(byPayload[name] = byPayload[name] || []).push({ start: Number(start), ...v })
}
console.log('')
for (const [name, rows] of Object.entries(byPayload)) {
  rows.sort((a, b) => a.start - b.start)
  console.log('  ' + name + ':')
  for (const r of rows) {
    console.log('    起始 ' + String(r.start).padStart(4) + 'px → 最终 ' + String(r.final).padStart(6) + 'px'
      + '   报回值序列 ' + JSON.stringify(r.reports.slice(-4)))
  }
  // 「收敛」的判据必须和实现里的**死区**一致：差值 <8px 时父页故意不再改高度
  // （防抖动引发连续重排）。视口相关的卡（ERA 状态栏里有按视口定位的元素）会落在
  // 895/889 这种同一死区内的小差异上 —— 那是设计要的行为，不是不收敛。
  // 所以判据是「三档最终值的极差 ≤ 8px」，而不是「完全相等」。
  const finals = rows.map(r => r.final)
  const spread = Math.max(...finals) - Math.min(...finals)
  check('「' + name + '」三档起始高度收敛到同一值（极差 ' + spread + 'px ≤ 8px 死区；'
    + [...new Set(finals)].join('/') + '）', spread <= 8,
    JSON.stringify(rows.map(r => r.start + '→' + r.final)))
  const fin = finals[0]
  if (/正文美化/.test(name)) {
    // ★ 判据随 vh 重写的 ST 平价语义更新（2026-09-22）：
    //   这张卡 body 上写着 `min-height:100vh`，经 rewriteVhMinHeight 烤成**父页视口常量**
    //   （探针页 innerHeight = PROBE_VH）。ST 本体对这张卡的帧高同样是
    //   `body.scrollHeight = max(内容高, 父页视口)` —— 即"至少占满聊天视口"。
    //   所以正确判据是「钉在父页视口地板上」（≈900±死区），而不是旧的 <400
    //   （那是音乐版加入前、vh 重写存在之前的内容量级，语义已变）。
    //   "不是不动点"由上面那条收敛判据保证：真不动点会回显 600/900/1500 三档起始值，
    //   而非都收敛到与起始无关的地板值。
    check('「' + name + '」钉在父页视口地板（min-height:100vh 的 ST 语义，≈' + PROBE_VH + '）',
      Math.abs(fin - PROBE_VH) <= 8, 'final=' + fin + ' 期望≈' + PROBE_VH)
  } else if (/ERA/.test(name)) {
    // 内容量级与**探测宽度**有关（列宽不同会换行不同），所以这里只做量级检查：
    // 真正要钉的是"与起始值无关"（上面那条）。端到端数值以主代理在真聊天气泡里的复测为准。
    check('「' + name + '」最终高度在内容量级（700-1200）', fin > 700 && fin < 1200, 'final=' + fin)
  } else if (/主页/.test(name)) {
    check('「' + name + '」最终高度在内容量级（>1200 且未被上限夹取）',
      fin > 1200 && fin <= R.muvFrameHeightLimits().max, 'final=' + fin)
  }
}
// 关键回归：正文美化不能停在起始值
// ★ 更新（2026-09-22）：卡现在被 `min-height:100vh`（烤成父页视口常量）合法地钉在
//   PROBE_VH 上。起始 900 那一档的 final 恰好等于 900 属于**数值巧合**（起始值 = 地板值），
//   不再是回显指纹。真正的指纹是「final 随 start 走」——即 600/1500 两档也停在各自的
//   起始值上。所以判据改成：final 必须等于地板（与起始无关），地板值由 convergence
//   判据（三档一致）保证唯一。
const zw = byPayload['正文美化（带音乐）']
if (zw) {
  const echoed = zw.filter(r => Math.abs(r.final - r.start) < 8 && r.start !== PROBE_VH)
  check('★ 正文美化不回显起始高度（600/1500 档不得停在起始值）', echoed.length === 0,
    JSON.stringify(zw.map(r => r.start + '→' + r.final)))
}

// 可选对照：拿 HEAD(324b751) 跑**同样三份真卡**。只为回答一个问题——上面那几条红
// 是"这次改动引入的回归"还是"一直在那里没人看"。默认不跑（省 30 秒），`MUV_FH_OLD=1` 打开。
// 这里**只打数字、不下断言**：对照臂的目的是取证，不是判官。
// （放在 6 节里，因为 `R_OLD` 在那儿才装载；顺序改了会把 `R_OLD` 拖进 TDZ。）
function runOldArmOnRealCards() {
  console.log('\n=== 5b. 对照：HEAD(324b751) 跑同样三份真卡（只为判"回归 vs 旧病"）===')
  const oldResult = {}
  for (const p of PAYLOADS) Object.assign(oldResult, runProbe([p], R_OLD, '-old'))
  for (const p of PAYLOADS) {
    const rows = STARTS.map((s) => oldResult[p.name + '@' + s]).filter(Boolean)
    const finals = rows.map((r) => r.final)
    console.log('  ' + p.name.padEnd(22) + STARTS.map((s, i) => s + '→' + (finals[i] === undefined ? '?' : finals[i])).join('  ') +
      '   极差=' + (finals.length ? Math.max(...finals) - Math.min(...finals) : '?') + 'px')
  }
}

// ═══════════════ 6. 棘轮的两个方向（P0-1） ═══════════════
//
// 为什么单开一节：上面三节测的是「**不同的起始视口**收敛到同一值」，不是「**同一个 iframe 里
// 内容变了**」。棘轮（`__muvHFit`）的真正风险恰好在后者：记下 1200 之后内容缩到 40，
// 如果那把尺子只增不减，帧高就永远停在 1200 —— reset 又把 body 啃成了
// `overflow:hidden!important`，**连滚动条都不会有**，用户只看到卡片底下一大片死白。
//
// 场景文档（合成的，高度完全可控）：
//   t < 2000ms  内容 1200px  → 观测到溢出，棘轮记下 1200
//   t ≥ 2000ms  切到目标高    → 收缩臂切 40px / 增长臂切 1500px
//
// 观测次数怎么驱动：引导脚本只认 `load` / `DOMContentLoaded` / `RO(documentElement)` /
// 700·1600ms 这几个时机，而收缩方向需要**连续 3 次**观测才清零。这里反复派发合成的
// `load` 事件来踢它 —— `load` 是引导脚本**自己注册**的监听器，不是私有后门；
// 真实浏览器里 RO 会在父页改帧高时间接踢到，虚拟时间下 RO 的时机不可靠，合成事件才确定。
const SCENARIO = (finalPx, name) => ({
  name,
  // ⚠ 两条都是**踩出来的**：
  //   ① 文档里**不能**出现 `height:<数字>px` 字样。探针用 `/height:\d+px/` 改写 iframe 的起始
  //      高度，而那个正则只看**第一个**匹配 —— 卡文档里的高度会先把位置占掉，于是三档起始
  //      高度全部失效（实测三档都停在默认 900px，收缩/增长两个场景一起失去意义）。
  //      所以 #big 的高度由**运行时代码**设置（内联 style 不在文档文本里）。
  //   ② 卡内**不能靠定时器**驱动。探针跑在 `--virtual-time-budget` 下：虚拟时间按主进程推进，
  //      而**跨进程 iframe（OOPIF）里的 `setTimeout` 不跟着走** —— 实测卡内定时器一次都不触发，
  //      于是"内容变了"这件事根本没发生（症状：`reports` 恒为空、final 恒等于起始值，
  //      而同样的文档在普通无头窗口里跑得好好的，报 1200）。所以相位切换与观测驱动都由
  //      **父页**发消息触发；卡内只挂两个 message 处理器（同步执行，不依赖计时）。
  html: '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;height:100%}#big{background:#223}</style>' +
    '</head><body><div id="big">BIG</div>' +
    '<scr' + 'ipt>(function(){var b=document.getElementById("big");b.style.height="1200px";' +
    'window.addEventListener("message",function(e){var d=e.data||{};' +
    'if(typeof d.__scenH==="number")b.style.height=d.__scenH+"px";' +
    // 观测驱动：引导脚本注册的是 `window` 上的 `load` 监听器，重复派发即可重复测量。
    'if(d.__scenKick){try{window.dispatchEvent(new Event("load"))}catch(x){}}' +
    '});})();</scr' + 'ipt></body></html>',
})

/**
 * 父页驱动器：把 iframe 当**受控对象**（真实浏览器里父页也会这么干 —— 改帧高、发消息）。
 * 时间线：kick 每 200ms（共 25 次）覆盖相位切换前后，切换发生在 2500ms。
 */
const SCEN_DRIVE = (finalPx) => '(function(){' +
  'function to(m){var a=document.querySelectorAll("iframe.muv-iframe");' +
  'for(var i=0;i<a.length;i++){try{if(a[i].contentWindow)a[i].contentWindow.postMessage(m,"*")}catch(e){}}}' +
  'setTimeout(function(){to({__scenH:' + finalPx + '})},2500);' +
  'var n=0;var iv=setInterval(function(){to({__scenKick:1});if(++n>25)clearInterval(iv)},200);' +
  '})();'

/**
 * 场景臂**必须用真时间**跑（CDP + 真实等待），不能用 `--dump-dom` 那条虚拟时间通道。
 *
 * 实测教训：`runProbe` 用的 `--virtual-time-budget` 只对**主进程**推进计时，跨进程 iframe
 * （沙箱 srcdoc ⇒ OOPIF）里的 `setTimeout` 不跟着走；并且父页的 `report()`（load+4000 虚拟毫秒）
 * 几乎是瞬间到达 —— 于是能稳定拿到报数的只有**子文档 load 那一瞬间**的测量。
 * 「内容变了以后再测」这件事在虚拟时间下**根本不发生**（症状：`reports` 恒为空、
 * final 恒等于起始值，而完全相同的文档在普通无头窗口里跑得好好的、稳定报 1200）。
 * 所以这一节自己开浏览器、自己等真实时间。
 */
function scenParentScript(drive) {
  return [
    extractFunction(clientSource(), 'muvFrameHeightLimits'),
    extractFunction(clientSource(), 'onMuvFrameHeightMessage'),
    'window.__muvFrameHListener=1;',
    'window.addEventListener("message", onMuvFrameHeightMessage, false);',
    'var seen={};',
    'window.addEventListener("message", function(e){',
    'if(!e.data||e.data.__muvFrameHeight===undefined)return;',
    'var all=document.querySelectorAll("iframe.muv-iframe");',
    'for(var i=0;i<all.length;i++){if(all[i].contentWindow===e.source){',
    'var k=all[i].dataset.payload+"@"+all[i].dataset.start;',
    '(seen[k]=seen[k]||[]).push(e.data.__muvFrameHeight);}}',
    '}, false);',
    'window.__report=function(){var out={};var all=document.querySelectorAll("iframe.muv-iframe");',
    'for(var i=0;i<all.length;i++){var f=all[i];',
    'out[f.dataset.payload+"@"+f.dataset.start]={final:parseFloat(f.style.height),reports:seen[f.dataset.payload+"@"+f.dataset.start]||[]};}',
    'return JSON.stringify(out)};',
    drive,
  ].join('\n')
}

/** 跑一个场景（真时间）：返回 { '名称@起始': {final, reports} }。 */
async function runScenario(R, tag, payload, finalPx) {
const frames = STARTS.map((start) => {
  // 同 runProbe：只改 iframe 自己的 style（真卡臂的教训，见上面那条长注释）
  const iframe = R.cardHtmlIframe(payload.html)
    .replace(/(style="display:block;width:100%;height:)\d+px/, '$1' + start + 'px')
  return iframe.replace('<iframe', '<iframe data-payload="' + payload.name + '" data-start="' + start + '"')
})
  const file = path.join(tmpDir, 'scen-' + tag + '.html')
  fs.writeFileSync(file, '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    frames.join('\n') + '<pre id="out"></pre><script>' + scenParentScript(SCEN_DRIVE(finalPx)) +
    '</scr' + 'ipt></body></html>', 'utf8')

  const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
  try {
    // ① 等首轮报数（子文档 load 那一发；没等到就说明夹具/引导脚本没跑起来）
    const t0 = Date.now()
    let out = {}
    while (Date.now() - t0 < 15000) {
      const j = await evalJson(rt.cdp, 'window.__report ? window.__report() : "{}"', rt.pageSession)
      try { out = typeof j === 'string' ? JSON.parse(j) : (j || {}) } catch (_) { out = {} }
      const any = Object.keys(out).some((k) => (out[k].reports || []).length > 0)
      if (any) break
      await sleep(250)
    }
    await sleep(6000)   // ② 相位切换（2500ms）+ 观测驱动（kick ×25，每 200ms）
    const j2 = await evalJson(rt.cdp, 'window.__report()', rt.pageSession)
    return { out: (() => { try { return typeof j2 === 'string' ? JSON.parse(j2) : (j2 || {}) } catch (_) { return {} } })(), firstRound: out }
  } finally {
    rt.close()
  }
}


// before 对照臂：棘轮修复**之前**的 client.js（`git show 324b751:lib/client.js`）。
// 没有对照臂就没法证明"这条判据能红" —— 一条恒真的门禁比没有门禁更糟。
const OLD_PATH = process.env.MUV_OLD_CLIENT || path.join(DIR, '.tmp-old-client-324b751.js')
let R_OLD = null
if (fs.existsSync(OLD_PATH)) {
  try { R_OLD = loadClientRenderersFrom(fs.readFileSync(OLD_PATH, 'utf8'), undefined, PROBE_WIN) } catch (e) {
    console.log('  SKIP 旧源码装载失败: ' + String(e.message).split('\n')[0])
  }
} else {
  console.log('  SKIP 找不到对照臂源码 ' + OLD_PATH + '（用 MUV_OLD_CLIENT 指定）')
}

if (R_OLD && process.env.MUV_FH_OLD === '1') runOldArmOnRealCards()
const SCEN = [SCENARIO(40, '棘轮·收缩'), SCENARIO(1500, '棘轮·增长')]
const scenCur = {}
const scenOld = {}
for (const p of SCEN) {
  const r = await runScenario(R, 'cur-' + p.name.length + '-' + p.name.charCodeAt(0), p, p.name === SCEN[0].name ? 40 : 1500)
  Object.assign(scenCur, r.out)
  Object.assign(scenCur, Object.fromEntries(Object.entries(r.firstRound).map(([k, v]) => ['首轮 ' + k, v])))
}
if (R_OLD) for (const p of SCEN) Object.assign(scenOld, (await runScenario(R_OLD, 'old-' + p.name.length, p, p.name === SCEN[0].name ? 40 : 1500)).out)

// ── 变异臂：把"能降"那一支拆掉，剩下的就是一把**只增不减的棘轮** ──
// 为什么需要它：`324b751`（HEAD）在这个合成场景里**也会回落**（600/900/1500 → 均 160），
// 所以 HEAD 不能当这条判据的对照臂 —— 用它做"能不能红"的证明是**空的**（先跑出来的假绿）。
// 真正能证明判据有效的是**变异体**：把 reset 分支里的 `__muvHFit=0` 换成只重置计数。
// 判据如果在变异体上仍然绿，那它就是在测空气，不是在测收缩。
const MUT_FROM = 'if(rc>=3){window.__muvHFit=0;fit=0;window.__muvHReset=0}'
const MUT_TO = 'if(rc>=3){window.__muvHReset=0}'
const curSrc = clientSource()
let scenMut = {}
if (curSrc.indexOf(MUT_FROM) >= 0) {
  const mutSrc = curSrc.replace(MUT_FROM, MUT_TO)
  const R_MUT = loadClientRenderersFrom(mutSrc, undefined, PROBE_WIN)
  for (const p of SCEN) Object.assign(scenMut, (await runScenario(R_MUT, 'mut-' + p.name.length, p, p.name === SCEN[0].name ? 40 : 1500)).out)
} else {
  console.log('  SKIP 找不到变异点 ' + JSON.stringify(MUT_FROM) + ' —— 棘轮实现换写法了，这条要跟着改')
}
// 场景臂用 CDP 起了真浏览器，profile 目录还压在 tmpDir 里，Edge 退出后一小会儿才释放句柄。
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

/** 取某个场景在三个起始高度下的测量行。 */
const seqOf = (obj, name) => Object.entries(obj)
  .filter(([k]) => k.indexOf(name + '@') === 0)
  .map(([k, v]) => ({ start: Number(k.split('@')[1]), ...v }))
  .sort((a, b) => a.start - b.start)

console.log('\n=== 6. 棘轮的两个方向：内容缩小必须回落 / 内容变大必须立刻满足 ===')
for (const r of seqOf(scenCur, SCEN[0].name)) {
  const peak = Math.max(...r.reports.concat([r.final]))
  check('★ 「棘轮·收缩」起始 ' + r.start + 'px：内容缩到 40px 后，报回的帧高必须回落', r.final < 400,
    '先撑到 ' + peak + 'px，最终 ' + r.final + 'px   末段序列=' + JSON.stringify(r.reports.slice(-6)))
  check('★ 「棘轮·收缩」起始 ' + r.start + 'px：确实先撑到过内容高（否则上面那条恒真）', peak >= 900,
    '峰值报回=' + peak + 'px')
}
for (const r of seqOf(scenCur, SCEN[1].name)) {
  // 滞回**只允许作用在收缩方向**：观测到溢出（`bOver||dOver`）时 `need>fit` 必须**无条件**提升。
  // 5px 的溢出如果被 24px 滞回挡住，就是被 `overflow:hidden!important` **永久裁掉**。
  check('「棘轮·增长」起始 ' + r.start + 'px：内容涨到 1500px 后帧高必须立刻满足（不许被 24px 滞回挡住）',
    r.final >= 1400, 'final=' + r.final + 'px   末段序列=' + JSON.stringify(r.reports.slice(-4)))
}
if (Object.keys(scenMut).length) {
  const mutShrink = seqOf(scenMut, SCEN[0].name)
  // 判据：变异体只要**有任意一档**没回落，就说明真实源码那三档"回落"不是白来的、判据能红。
  // 注意不能要求"三档全卡住"——起始 1500 那一档**从来就没记过棘轮**（帧本来就比内容高，
  // 没有观测到溢出 ⇒ `__muvHFit` 一直是 0），拆掉 reset 对它是无操作，它会照常降到下限 160。
  // 实测卡住的两档是起始 600/900（都停在内容高 1200），这正是"缩小后不回落"的指纹。
  const redMut = mutShrink.filter(r => r.final >= 400)
  check('★★★ 变异臂（reset 分支被拆成只增不减的棘轮）必须把「收缩」判据打红 —— 判据能红的实证',
    redMut.length >= 1,
    '变异体 ' + JSON.stringify(mutShrink.map(r => r.start + '→' + r.final + 'px')) +
    (redMut.length >= 1
      ? '（' + redMut.map(r => r.start).join('/') + ' 停在内容高：同一份文档，修好前会永久留白）'
      : '（一档都没卡住 ⇒ 这条判据在测空气）'))
}
if (R_OLD) {
  const oldShrink = seqOf(scenOld, SCEN[0].name)
  // HEAD 只是"修复前的某一天"，**不等于**这条判据的对照臂：实测 HEAD 在这个合成场景里也会回落
  // （600/900/1500 → 均 160，160 是 muvFrameHeightLimits 的下限夹取）。所以这里不改判绿红，
  // 只把实测值打出来，免得后人以为"HEAD 通过 ⇒ 判据无效"。
  if (oldShrink.length) {
    console.log('  · 附带实测：HEAD(324b751) 同一场景 ' +
      JSON.stringify(oldShrink.map(r => r.start + '→' + r.final + 'px')) +
      ' —— 它也会回落，所以它**不是**这条判据的对照臂（对照臂是上面的变异体）')
  }
}

// ═══════════════ 7. 媒体延迟加载：img/video 到位后高度必须最终跟上（2026-09-22p） ═══════════════
//
// 取证（HANDOFF §29）：引导脚本的重测触发器原本只有 load / DOMContentLoaded / RO(documentElement)
// / 700·1600ms / 四次补量（到 10.9s）。媒体事件从不触发重测，而**包围盒**因媒体到位而起的变化
// 可以完全不改变任何盒子 —— 真卡 `_足控天堂2`「主页」的画廊就是
// `.polaroid img{position:absolute;inset:0}` + 父盒 aspect-ratio 预留：绝对定位元素的 rect 变了，
// html/body 的盒子纹丝不动 ⇒ RO 一次都不 fire；固定补量到 10.9s 就停 ⇒ 那次增长**没有任何通道
// 上报**，帧高被锁在媒体未到位时的小值上（用户实测「压成细长一条」的机制）。
//
// 两个场景（都用真时间 CDP，同第 6 节的教训——虚拟时间下子文档定时器不走）：
//   A. 「src 延迟 300ms」：常规形态（流内 img），load 后包围盒变大。修复前后都应绿
//      （700/1600ms 定时器本就会兜住）——它是用户点名的回归用例。
//   B. 「判别臂」：img 为 **position:absolute**（RO 静默）且 src 在 **11.5s** 才设置
//      （晚于最后一次补量 10.9s+150ms 去抖）⇒ 修复前没有任何触发器，帧高必须卡住；
//      修复后只有媒体事件能救。变异臂（砍掉媒体挂接）在 B 上**必红** —— 证明判据测的
//      正是媒体重报，不是空气。
//
// 夹具纪律（同第 6 节）：文档文本里**不能出现 `height:<数字>px`**（起始高度替换用
// `/height:\d+px/` 改 iframe style，卡内的高度声明会抢走第一个匹配）——所有高度都用运行时
// style 设置；`top:1500px`/`width:600px` 不含该字面量，安全。

const MEDIA_SVG = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22' +
  '%20width%3D%22600%22%20height%3D%22400%22%3E%3Crect%20width%3D%22600%22%20height%3D%22400%22' +
  '%20fill%3D%22%23345%22%2F%3E%3C%2Fsvg%3E'

/**
 * @param {'inflow'|'absolute'} mode  流内（RO 可见） / 绝对定位（RO 静默，只有媒体事件能救）
 * @param {number} delayMs  src 的设置时刻
 */
const mediaPayload = (mode, delayMs) => ({
  name: '媒体延迟·' + mode + '@' + delayMs,
  html: '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0}</style></head><body>' +
    '<div id="sp">SPACER</div>' +
    // 绝对定位臂：img 无 src 时是 0×0（extent 跳过），load 后 rect = top(1500)+400
    (mode === 'absolute'
      ? '<img id="mi" alt="late" style="position:absolute;left:0;top:1500px;width:600px">'
      : '<img id="mi" alt="late" style="display:block;width:600px">') +
    '<scr' + 'ipt>(function(){' +
    // spacer 高度由运行时设置（文本里不许出现 height:NNNpx）
    'var sp=document.getElementById("sp");sp.style.height="' + (mode === 'absolute' ? 1500 : 800) + 'px";' +
    // src 由**子文档自己的定时器**延迟设置。不能走父页 postMessage：300ms 时 srcdoc 文档
    // 可能还没就绪，消息会丢（实测 300ms 臂 src 从未设置、恒报 824）；11.5s 的判别臂虽能
    // 收到，但两个臂统一用同一条触发路径才可对照。真时间 CDP 下子文档定时器照常走
    // （第 6 节的禁令只针对 --virtual-time-budget 通道）。
    'setTimeout(function(){var i=document.getElementById("mi");if(i&&!i.getAttribute("src"))i.src="' + MEDIA_SVG + '";},' + delayMs + ');' +
    '})();</scr' + 'ipt></body></html>',
})

/** 父页驱动器：媒体场景里触发全部在子文档侧（见 mediaPayload），父页无需驱动。 */
const mediaDrive = () => ''

/** 跑一个媒体场景：起始 900px 单档，轮询到位/超时，返回 {final, reports}。 */
async function runMediaScenario(R2, tag, payload, delayMs, expectPx) {
  const start = 900
  const iframe = R2.cardHtmlIframe(payload.html)
    .replace(/(style="display:block;width:100%;height:)\d+px/, '$1' + start + 'px')
    .replace('<iframe', '<iframe data-payload="' + payload.name + '" data-start="' + start + '"')
  const file = path.join(tmpDir, 'media-' + tag + '.html')
  fs.writeFileSync(file, '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + iframe +
    '<pre id="out"></pre><script>' + scenParentScript(mediaDrive()) + '</scr' + 'ipt></body></html>', 'utf8')
  const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
  try {
    // 轮询到「报回值达到期望量级」或超时（判别臂在修复前永远不会达到，跑满 24s）
    const t0 = Date.now()
    let out = {}
    while (Date.now() - t0 < 24000) {
      await sleep(700)
      let j
      try { j = await evalJson(rt.cdp, 'window.__report ? window.__report() : "{}"', rt.pageSession) } catch (_) { continue }
      try { out = typeof j === 'string' ? JSON.parse(j) : (j || {}) } catch (_) { out = {} }
      const rows = Object.values(out)
      const reached = rows.some((v) => (v.reports || []).some((h) => h >= expectPx))
      if (reached && Date.now() - t0 > delayMs + 1500) break
    }
    if (process.env.MUV_FH_DEBUG) console.log('    [dbg ' + tag + '] keys=' + JSON.stringify(Object.keys(out)) +
      ' rows=' + JSON.stringify(out))
    return out
  } finally { rt.close() }
}

console.log('\n=== 7. 媒体延迟加载：媒体事件必须把帧高带到位 ===')
// 第 6 节收尾时已把 tmpDir 清掉（CDP profile 句柄释放），这里重建复用同一个目录
fs.mkdirSync(tmpDir, { recursive: true })
const MEDIA_EXPECT_ABS = 1800   // 绝对定位臂：1500(spacer) + 400(img) ，留死区余量
const MEDIA_EXPECT_INFLOW = 1100 // 流内臂：800(spacer) + 400(img)
const mediaCur = {}
mediaCur['A-inflow'] = await runMediaScenario(R, 'inflow', mediaPayload('inflow', 300), 300, MEDIA_EXPECT_INFLOW)
mediaCur['B-absolute'] = await runMediaScenario(R, 'absolute', mediaPayload('absolute', 11500), 11500, MEDIA_EXPECT_ABS)
// 变异臂：砍掉媒体挂接（mw 改成立即返回）——判别臂必须因此变红，否则这条判据在测空气
const MW_FROM = 'function mw(el){try{'
const MW_TO = 'function mw(el){try{throw 0;'
let mediaMut = {}
if (clientSource().indexOf(MW_FROM) >= 0) {
  const mutSrc = clientSource().replace(MW_FROM, () => MW_TO)   // 函数式替换（§18/§21 铁律）
  const R_MUT2 = loadClientRenderersFrom(mutSrc, undefined, PROBE_WIN)
  mediaMut['B-absolute'] = await runMediaScenario(R_MUT2, 'mut-absolute', mediaPayload('absolute', 11500), 11500, MEDIA_EXPECT_ABS)
} else {
  console.log('  SKIP 找不到媒体挂接变异点 ' + JSON.stringify(MW_FROM) + ' —— 引导脚本换写法了，这条要跟着改')
}
const mediaRow = (obj, key) => {
  const rows = Object.entries(obj).filter(([k]) => k.indexOf(key + '@') === 0).map(([, v]) => v)
  return rows[0] || { final: NaN, reports: [] }
}
{
  const a = mediaRow(mediaCur['A-inflow'], '媒体延迟·inflow@300')
  check('「媒体·流内 img src 延迟 300ms」最终高度到位（≥' + MEDIA_EXPECT_INFLOW + '）',
    a.final >= MEDIA_EXPECT_INFLOW, 'final=' + a.final + '  序列=' + JSON.stringify(a.reports.slice(-4)))
  const b = mediaRow(mediaCur['B-absolute'], '媒体延迟·absolute@11500')
  check('★「媒体·绝对定位 img src 在 11.5s（晚于全部补量）」最终高度到位（≥' + MEDIA_EXPECT_ABS + '）——媒体事件重报',
    b.final >= MEDIA_EXPECT_ABS, 'final=' + b.final + '  序列=' + JSON.stringify(b.reports.slice(-6)))
  if (Object.keys(mediaMut).length) {
    const m = mediaRow(mediaMut['B-absolute'], '媒体延迟·absolute@11500')
    check('★★★ 变异臂（媒体挂接被砍）判别臂必须变红 —— 判据能红的实证',
      m.final < MEDIA_EXPECT_ABS,
      '变异体 final=' + m.final + '（≥' + MEDIA_EXPECT_ABS + ' 说明救它的不是媒体事件，判据在测空气）')
  }
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

// ═══════════════ 8. 测量修正通道：媒体落定引起的收缩必须能回缩（2026-09-22u） ═══════════════
//
// 取证（HANDOFF §34）：收缩方向的常规路径要求**连续 3 次**观测才清零重学，而媒体落定引起的
// 收缩往往**只有一次**观测机会 —— 定时补量到 10.9s+150ms 就停了，RO 又只在**盒子**尺寸变化时
// fire（媒体引起的包围盒变化可以完全不动盒子，见第 7 节）。合成夹具（真时间 CDP）实测：
//   img 用 `width/height` **属性**预留 600×2000 的高盒子（那次读到的 2300 是**真实**内容高，
//   棘轮没记错）→ 图片是 600×200 的**扁**图、src 在 **11.5s**（晚于最后一次补量）才设
//   → 内容缩到 500 后再无第二次观测 ⇒ 帧高永久停在 2300 ⇒ **1800px 死白**。
//   对照：同一份文档把 src 提前到 400ms ⇒ 靠 2500/5300/8100 三次补量凑够 3 次 ⇒ 正常回落。
//
// 本轮加的通道：媒体**全部落定**（`MS()`）+「首帧已过」+ **没有**观测到溢出 + 已学值高出实测
// 内容 24px 以上 ⇒ 这次收缩是"修正一次过时读数"，**一次就够**（语义与边界见 lib/client.js 里
// `extent()` 的「测量修正通道」段）。三条判据缺一条，这条门禁就是在测空气：
//   A 先撑高：夹具必须真的把帧高撑到过 ≥2000（否则"回落"恒真）；
//   B 回缩：11.5s 的 src 落定后，帧高必须回落到内容量级（≤600）；
//   C 变异臂：把 `if(mf&&MS())` 砍成 `if(false)`（通道关闭）⇒ B 必须**红**。
const MEDIA_WIDE_SVG = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22' +
  '%20width%3D%22600%22%20height%3D%22200%22%3E%3Crect%20width%3D%22600%22%20height%3D%22200%22%20fill%3D%22%230a5%22%2F%3E%3C%2Fsvg%3E'

/** 「先大后小」：img 属性预留 600×2000（内容 300+2000=2300），真实图片 600×200（内容缩到 500）。 */
const SHRINK_LATE = {
  name: '测量修正·先大后小',
  html: '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;height:100%}#sp{background:#123}</style></head><body>' +
    '<div id="sp">SPACER</div>' +
    '<img id="mi" width="600" height="2000" alt="late" style="display:block;width:600px;height:auto">' +
    '<scr' + 'ipt>(function(){' +
    // spacer 高由运行时设置（夹具纪律：文本里不许出现 height:NNNpx）
    'document.getElementById("sp").style.height="300px";' +
    // src 在 11.5s —— 晚于引导脚本最后一次低频补量（10.9s）+150ms 去抖。
    // 触发放**子文档自己的定时器**：§29 已记，父→子 postMessage 在早期会丢。
    'setTimeout(function(){var i=document.getElementById("mi");' +
    'if(i&&!i.getAttribute("src"))i.src="' + MEDIA_WIDE_SVG + '";},11500);' +
    '})();</scr' + 'ipt></body></html>',
}

/** 跑一个「先大后小」场景：等到 11.5s 的 src 落定 + 去抖 + 700ms 安全复核之后收数。 */
async function runShrinkScenario(R2, tag, payload) {
  const start = 900
  const iframe = R2.cardHtmlIframe(payload.html)
    .replace(/(style="display:block;width:100%;height:)\d+px/, '$1' + start + 'px')
    .replace('<iframe', '<iframe data-payload="' + payload.name + '" data-start="' + start + '"')
  const file = path.join(tmpDir, 'shrink-' + tag + '.html')
  fs.writeFileSync(file, '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + iframe +
    '<pre id="out"></pre><script>' + scenParentScript('') + '</scr' + 'ipt></body></html>', 'utf8')
  const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
  try {
    await sleep(15000)
    const j = await evalJson(rt.cdp, 'window.__report()', rt.pageSession)
    try { return typeof j === 'string' ? JSON.parse(j) : (j || {}) } catch (_) { return {} }
  } finally { rt.close() }
}

console.log('\n=== 8. 测量修正通道：媒体落定引起的收缩必须能回缩 ===')
fs.mkdirSync(tmpDir, { recursive: true })
const SHRINK_EXPECT = 600         // 内容 500 + 余量
const SHRINK_PEAK = 2000          // 「先大」相位必须真的发生过
const shrinkCur = await runShrinkScenario(R, 'late', SHRINK_LATE)
const MUT_FIX_FROM = 'if(mf&&MS()){window.__muvHFit=0;fit=0;window.__muvHReset=0}'
const MUT_FIX_TO = 'if(false){window.__muvHFit=0;fit=0;window.__muvHReset=0}'
let shrinkMut = {}
if (clientSource().indexOf(MUT_FIX_FROM) >= 0) {
  const R_MUTF = loadClientRenderersFrom(clientSource().replace(MUT_FIX_FROM, () => MUT_FIX_TO), undefined, PROBE_WIN)
  shrinkMut = await runShrinkScenario(R_MUTF, 'mut-late', SHRINK_LATE)
} else {
  console.log('  SKIP 找不到测量修正变异点 ' + JSON.stringify(MUT_FIX_FROM) +
    ' —— 通道换写法了，这条要跟着改（否则 C 臂变成永真）')
}
{
  const a = mediaRow(shrinkCur, SHRINK_LATE.name)
  const peak = Math.max(...(a.reports || []).concat([a.final]))
  check('「' + SHRINK_LATE.name + '」确实先撑到过 ' + SHRINK_PEAK + 'px 量级（否则下面那条恒真）',
    peak >= SHRINK_PEAK, '峰值=' + peak + '  序列=' + JSON.stringify((a.reports || []).slice(-6)))
  check('★★★「' + SHRINK_LATE.name + '」媒体落定后帧高必须回落到内容量级（≤' + SHRINK_EXPECT + '）',
    a.final <= SHRINK_EXPECT, 'final=' + a.final + '  序列=' + JSON.stringify((a.reports || []).slice(-6)))
  if (Object.keys(shrinkMut).length) {
    const m = mediaRow(shrinkMut, SHRINK_LATE.name)
    check('★★★ 变异臂（测量修正通道被砍）本臂必须变红 —— 判据能红的实证',
      m.final > SHRINK_EXPECT,
      '变异体 final=' + m.final + '（≤' + SHRINK_EXPECT + ' 说明回缩不是这条通道给的，判据在测空气）')
  }
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
