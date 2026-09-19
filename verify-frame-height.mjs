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
import { loadClientRenderers, extractFunction, clientSource } from './test-client-source.mjs'

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

const R = loadClientRenderers()
const STARTS = [600, 900, 1500]

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('SKIP 找不到 msedge.exe'); process.exit(0) }

// 探针页：每个文档 × 每个起始高度一个 iframe，跑真实的 cardHtmlIframe 产物 + 真实的
// 父页处理器（两者都从 lib/client.js 源码里取，测的是上线代码）。见下方 runProbe()。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-frameh-'))

/** 跑一个探针页，返回报告对象。每个文档单独起一次 Edge：9 个重 iframe 的 DOM 太大，
 *  一次 dump 会把管道缓冲打爆（ENOBUFS）。 */
function runProbe(payloads) {
  const framesHtml = []
  for (const p of payloads) {
    for (const start of STARTS) {
      const iframe = R.cardHtmlIframe(p.html).replace('height:600px', 'height:' + start + 'px')
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
    '</script></body></html>'

  const file = path.join(tmpDir, 'probe-' + payloads[0].name.length + '.html')
  fs.writeFileSync(file, probe, 'utf8')
  let dom = ''
  try {
    dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--window-size=1200,900', '--user-data-dir=' + path.join(tmpDir, 'profile-' + payloads[0].name.length),
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
fs.rmSync(tmpDir, { recursive: true, force: true })

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
    // 内容只有 ~250px：必须能缩到内容高（这就是"视口回显不动点"的对照组）
    check('「' + name + '」能缩小到内容高（不是不动点）', fin < 400, 'final=' + fin)
  } else if (/ERA/.test(name)) {
    // 内容量级与**探测宽度**有关（列宽不同会换行不同），所以这里只做量级检查：
    // 真正要钉的是"与起始值无关"（上面那条）。端到端数值以主代理在真聊天气泡里的复测为准。
    check('「' + name + '」最终高度在内容量级（700-1200）', fin > 700 && fin < 1200, 'final=' + fin)
  } else if (/主页/.test(name)) {
    check('「' + name + '」最终高度在内容量级（1200-2400）', fin > 1200 && fin <= 2400, 'final=' + fin)
  }
}
// 关键回归：正文美化不能停在起始值
const zw = byPayload['正文美化（带音乐）']
if (zw) {
  const stayed = zw.filter(r => Math.abs(r.final - r.start) < 8)
  check('★ 正文美化没有停在起始高度（视口回显的指纹）', stayed.length === 0,
    JSON.stringify(zw.map(r => r.start + '→' + r.final)))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
