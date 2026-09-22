// 帧高机制「定点探针」（老法师 review 第 2/3 条要求的实测，不是推理）。
//
// 三个问题，全部要**数字**：
//   ① 高度棘轮：`extent()` 取 `r.top + max(height, scrollHeight)`，而 `rewriteVhMinHeight`
//      只重写 `min-height`、**不动** `height:…vh`（照 ST 的正确做法）。
//      推理链：`height:100vh` 的元素 + 任意 top 偏移 ⇒ 报 H+40 ⇒ 帧高 +40 ⇒ `100vh` 又 +40
//      ⇒ 一路上涨（到 2400 时代是撞上限），死区拦不住。**必须实测**，命中就修。
//   ② 帧高上限：真卡已测到 2083 / 2056 —— 当年上限 2400 只留 13% 余量。
//      超限的**表现是静默截断**（`html,body{overflow:hidden!important}` ⇒ 连滚动条都没有）
//      ⇒ 判据必须是「内容底边在帧内可见」，不能靠「有没有滚动条」。
//      （2026-09-22：上限已按 ST 平价提到 12000 —— ST 本体**无上限**，见 ST-IFRAME-SPEC §6。）
//   ③ `extent()===0` 的回退：真卡有 9 处 `position:fixed`，而遍历排除 fixed/sticky。
//      回退到 `body.scrollHeight` 就是 HANDOFF §15.3 禁用的视口回声值。要确认它有没有被触发。
//
// 观测量（每个 iframe 一套）：
//   final        父页最终写进 iframe.style.height 的值（是否收敛 / 是否被夹到 2400）
//   reports      子文档报回来的高度序列（看有没有单调上涨 = 棘轮）
//   clampHits    父页夹取**前后**的值（有没有真的被 2400 夹住）
//   extentNow    子在报告那一刻 `extent()` 的返回值（0 表示"量不出来"）
//   fallbackUsed 是否走了 `body.scrollHeight` 回退（棘轮/视口回声的另一条入口）
//   contentBottom / docScrollH / frameH  —— 内容是"底边可见"还是"被裁掉"
//
// Run: $env:MUV_EDGE="…\msedge.exe"; node verify-frame-ratchet.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { loadClientRenderers, extractFunction, clientSource } from './test-client-source.mjs'
import { collectDocs } from './verify-shared.mjs'
import { launchEdge, CDP, openPage, evalJson, sleep } from './verify-shared.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
let fail = 0
const check = (name, cond, detail) => {
  if (cond) console.log('  OK   ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}
const row = (k, v) => console.log('  ' + k.padEnd(26) + v)

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const STARTS = [600, 900, 1500]

// ───────── 载荷 ─────────
const CARD = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'
const card = fs.existsSync(CARD) ? readPngCard(CARD) : null
const data = card && card.data && typeof card.data === 'object' ? card.data : card
const scripts = (data && Array.isArray(data.extensions?.regex_scripts)) ? data.extensions.regex_scripts : []
const fencedBody = (rep) => String(rep).replace(/^[ \t]{0,3}`{3,}[^\n`]*\r?\n/, '').replace(/`{3,}[ \t]*\r?\n?$/, '')

const PAYLOADS = []
for (const s of scripts) {
  const rep = String(s?.replaceString || '')
  if (!rep.includes('```')) continue
  PAYLOADS.push({ name: '真卡·' + String(s.scriptName), html: fencedBody(rep), kind: 'real' })
}
check('读到 _足控天堂2 的围栏文档（防空矩阵假绿）', PAYLOADS.length >= 3, '只读到 ' + PAYLOADS.length + ' 份')

// ───────── 对抗载荷：棘轮 ─────────
// 三个用例把「有没有 top 偏移」这一个变量单独拉出来。
const HERO = (extra) => '<!DOCTYPE html><html><head><style>' +
  'html,body{margin:0;padding:0}' +
  '.hero{height:100vh;background:linear-gradient(#333,#111);color:#fff;overflow:hidden}' +
  extra +
  '</style></head><body><div class="hero">HERO(100vh)</div></body></html>'

PAYLOADS.push({
  name: '对抗·100vh无偏移(对照)', kind: 'ratchet',
  html: HERO(''),
})
PAYLOADS.push({
  name: '对抗·100vh+padding-top:40px', kind: 'ratchet',
  html: HERO('body{padding-top:40px}'),
})
PAYLOADS.push({
  name: '对抗·100vh+容器padding40', kind: 'ratchet',
  html: HERO('.hero{padding-top:40px}'),
})
PAYLOADS.push({
  name: '对抗·100vh+absolute top:40', kind: 'ratchet',
  html: HERO('.hero{position:absolute;top:40px;left:0;right:0}'),
})

const R = loadClientRenderers()

// 每个实例在子文档里挂 `data-payload@start`，用来把消息事件对回具体 iframe。
const CASE_PROBE = (key) => '<script>(function(){var k=' + JSON.stringify(key) + ';' +
  'function s(){try{document.documentElement.setAttribute("data-key",k)}catch(e){}}' +
  's();document.addEventListener("DOMContentLoaded",s);' +
  'window.addEventListener("load",function(){s();setTimeout(s,500)})})();</' + 'script>'
// 在报告那一刻抓 extent / 回退 / 夹取前值 —— 不靠事后猜。
const INSTRUMENT = '<script>(function(){window.__probe={extent:null,fallback:false,h:null,sent:[]};' +
  'function extent(){' +
  'var body=document.body;if(!body)return 0;var de=document.documentElement;' +
  'var all=body.getElementsByTagName("*"),y=window.scrollY||0,maxB=0;' +
  'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el);' +
  'if(cs.position==="fixed"||cs.position==="sticky")continue;' +
  'if(cs.display==="none"||cs.visibility==="hidden")continue;' +
  'var r=el.getBoundingClientRect();if(r.height===0&&r.width===0)continue;' +
  'var b=r.top+y+Math.max(r.height,el.scrollHeight||0);if(b>maxB)maxB=b}' +
  'var bmh=parseFloat(getComputedStyle(body).minHeight);if(isFinite(bmh)&&bmh>maxB)maxB=bmh;' +
  'var hmh=de?parseFloat(getComputedStyle(de).minHeight):0;if(isFinite(hmh)&&hmh>maxB)maxB=hmh;' +
  'return Math.ceil(maxB)}' +
  'window.__probe.snapshot=function(){' +
  'var e=extent();var body=document.body,de=document.documentElement;' +
  'var bo=body?body.scrollHeight:0,dc=body?body.clientHeight:0;' +
  'var dO=de?(de.scrollHeight>de.clientHeight+1):false,bO=(bo>dc+1);' +
  'return {extent:e,bodyScrollH:bo,bodyClientH:dc,docScrollH:de?de.scrollHeight:0,docClientH:de?de.clientHeight:0,' +
  'bodyOver:bO,docOver:dO,frameH:innerHeight,frameW:innerWidth,' +
  'fallbackWouldUse:(e>0?e:bo),fallbackPath:(e>0?"extent":"body.scrollHeight")}};' +
  '})();'
  + '</' + 'script>'

function buildPage(payloads) {
  const frames = []
  for (const p of payloads) {
    for (const start of STARTS) {
      const key = p.name + '@' + start
      let html = R.cardHtmlIframe(p.html)
      // 起点高度用**正则**改写，不要把 900 写死（默认值改过一次，写死的 replace 会静默不生效）
      // ★ 只改 iframe 自己的 style：srcdoc 里卡自己的 CSS 也有 `height:62px` 这类声明，
      //   第一个匹配会落在卡 CSS 上（verify-frame-height 真卡臂踩过的坑，见其长注释）。
      html = html.replace(/(style="display:block;width:100%;height:)\d+px/, '$1' + start + 'px')
      html = html.replace('<iframe', '<iframe data-key="' + key.replace(/"/g, '&quot;') + '"')
      // 注入到 srcdoc 里（`</body>` 前）
      html = html.replace(/(srcdoc=")([\s\S]*?)(" sandbox)/, (m, a, doc, b) =>
        a + doc.replace(/<\/body\s*>/, CASE_PROBE(key).replace(/&/g, '&amp;').replace(/"/g, '&quot;') +
          INSTRUMENT.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '</body>') + b)
      frames.push(html)
    }
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + frames.join('\n') +
    '<pre id="out"></pre><script>' +
    extractFunction(clientSource(), 'muvFrameHeightLimits') + '\n' +
    extractFunction(clientSource(), 'onMuvFrameHeightMessage') + '\n' +
    'var seen={},clamp={};' +
    // 复刻父页的**夹取前**值：onMuvFrameHeightMessage 内部夹取后写 style，夹取前的原始值
    // 只有在本监听器里才看得到。两个监听器都挂上，顺序不影响（都只读 e.data）。
    'window.addEventListener("message", function(e){' +
    'if(!e.data||e.data.__muvFrameHeight===undefined)return;' +
    'var all=document.querySelectorAll("iframe.muv-iframe");' +
    'for(var i=0;i<all.length;i++){if(all[i].contentWindow===e.source){' +
    'var k=all[i].dataset.key;(seen[k]=seen[k]||[]).push(e.data.__muvFrameHeight);' +
    'var lim=muvFrameHeightLimits();' +
    'clamp[k]=clamp[k]||{min:lim.min,max:lim.max,rawMax:null,clampedMax:null};' +
    'var c=clamp[k];if(c.rawMax===null||e.data.__muvFrameHeight>c.rawMax)c.rawMax=e.data.__muvFrameHeight;' +
    'var h=Math.round(e.data.__muvFrameHeight);if(h<lim.min)h=lim.min;if(h>lim.max)h=lim.max;' +
    'if(c.clampedMax===null||h>c.clampedMax)c.clampedMax=h;}}}' +
    '}, false);' +
    'window.__muvFrameHListener=1;' +
    'window.addEventListener("message", onMuvFrameHeightMessage, false);' +
    'function report(){var out={};var all=document.querySelectorAll("iframe.muv-iframe");' +
    'for(var i=0;i<all.length;i++){var f=all[i];var k=f.dataset.key;' +
    'out[k]={final:parseFloat(f.style.height),reports:(seen[k]||[]),clamp:(clamp[k]||null),' +
    'ownScrollbar:(f.scrollHeight>f.clientHeight+1)};}' +
    'document.getElementById("out").textContent=JSON.stringify(out);}' +
    'window.addEventListener("load",function(){setTimeout(report,5000)});' +
    '</script></body></html>'
}

const OUT = path.join(os.tmpdir(), 'muv-ratchet')
fs.mkdirSync(OUT, { recursive: true })

const all = {}
// 一次塞 9+12 个重 iframe 会把 DOM 撑爆 ⇒ 按载荷分批
for (let i = 0; i < PAYLOADS.length; i++) {
  const p = PAYLOADS[i]
  const file = path.join(OUT, 'probe-' + i + '.html')
  fs.writeFileSync(file, buildPage([p]), 'utf8')
  const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: OUT, windowSize: '1280,900' })
  try {
    await sleep(6500)
    const dom = await evalJson(rt.cdp, 'JSON.stringify((function(){var o={};' +
      'var all=document.querySelectorAll("iframe.muv-iframe");' +
      'var frames=[];for(var i=0;i<all.length;i++){frames.push({key:all[i].dataset.key})}' +
      'o.frames=frames;o.out=(document.getElementById("out")||{}).textContent||"";return o})())', rt.pageSession)
    let parsed = {}
    try { parsed = JSON.parse(dom.out || '{}') } catch (_) { parsed = {} }
    // 子文档侧的 extent 快照：走 CDP 子会话（沙箱 iframe 在独立渲染进程里）
    const snaps = new Map()
    for (const s of rt.cdp.iframeSessions) {
      let m = null
      try { m = await evalJson(rt.cdp, 'JSON.stringify((function(){var d=document.documentElement;' +
        'return {key:d.getAttribute("data-key"),snap:(window.__probe&&window.__probe.snapshot)?window.__probe.snapshot():null}})())', s.sessionId) } catch (_) { continue }
      if (m && m.key) snaps.set(m.key, m.snap)
    }
    for (const [k, v] of Object.entries(parsed)) all[k] = { ...v, sub: snaps.get(k) || null }
  } finally { rt.close() }
}

// ───────── 报告 ─────────
console.log('\n=== 1. 逐实例读数（extent / 回退 / 夹取 / 收敛）===')
console.log('  ' + '载荷@起点'.padEnd(34) + 'final'.padStart(7) + '  报回序列(末4)'.padEnd(22) +
  'extent'.padStart(7) + '  走的路径'.padEnd(20) + '夹取raw→clamped'.padEnd(18) + 'ownSB  内容底  文档高')
const byName = {}
for (const [k, v] of Object.entries(all)) {
  const [name, start] = k.split('@')
  ;(byName[name] = byName[name] || []).push({ start: Number(start), key: k, ...v })
}
for (const [name, rows] of Object.entries(byName)) {
  rows.sort((a, b) => a.start - b.start)
  for (const r of rows) {
    const s = r.sub || {}
    const c = r.clamp || {}
    console.log('  ' + r.key.padEnd(34) + String(r.final).padStart(7) + '  ' +
      JSON.stringify((r.reports || []).slice(-4)).padEnd(22) +
      String(s.extent === undefined ? '?' : s.extent).padStart(7) + '  ' +
      String(s.fallbackPath || '?').padEnd(20) +
      ((c.rawMax === null || c.rawMax === undefined) ? '-' : (c.rawMax + '→' + c.clampedMax)).padEnd(18) +
      String(r.ownScrollbar).padEnd(7) +
      String(s.docScrollH === undefined ? '?' : (s.docScrollH - (s.frameH || 0))).padStart(7) + '  ' +
      String(s.docScrollH === undefined ? '?' : s.docScrollH).padStart(6))
  }
}

console.log('\n=== 2. 判据 ===')
const spreadOf = (rows) => {
  const f = rows.map((r) => r.final)
  return Math.max(...f) - Math.min(...f)
}
for (const [name, rows] of Object.entries(byName)) {
  const spread = spreadOf(rows)
  const isRatchet = /对抗/.test(name) && !/无偏移/.test(name)
  const finals = rows.map((r) => r.final)
  if (/无偏移/.test(name)) {
    check('「' + name + '」三档收敛（极差 ' + spread + 'px ≤ 8px 死区） ' + finals.join('/'), spread <= 8)
  } else if (isRatchet) {
    check('★ 棘轮载荷「' + name + '」三档**也收敛**（极差 ' + spread + 'px ≤ 8px） ' + finals.join('/'),
      spread <= 8, '如果这里红了 = 老法师的棘轮推理命中')
    check('★ 棘轮载荷「' + name + '」没有跑到上限 ' + finals.join('/'),
      finals.every((f) => f < R.muvFrameHeightLimits().max), '被夹到上限 = 静默截断')
  } else {
    const er = /ERA/.test(name)
    const zw = /正文美化/.test(name)
    const home = /主页/.test(name)
    check('「' + name + '」三档收敛（极差 ' + spread + 'px） ' + finals.join('/'), spread <= 8)
    if (zw) check('「' + name + '」能缩到内容量级（<400）', finals[0] < 400, 'final=' + finals[0])
    if (er) check('「' + name + '」在内容量级 700-1200', finals[0] > 700 && finals[0] < 1200, 'final=' + finals[0])
    if (home) check('「' + name + '」在内容量级 >1200 且未被上限夹取',
      finals[0] > 1200 && finals[0] <= R.muvFrameHeightLimits().max, 'final=' + finals[0])
  }
  // 上限夹取：rawMax > max 才算真的被夹（max 从实现读，别写死 —— 写死会让"上限该多大"只能靠改测试表达）
  const clampedRows = rows.filter((r) => r.clamp && r.clamp.rawMax > r.clamp.max)
  check('「' + name + '」没有被上限夹取',
    clampedRows.length === 0,
    JSON.stringify(clampedRows.map((r) => r.key + ' raw=' + r.clamp.rawMax)))
  // ★ 判据：内容底边在帧内可见（不是「有没有滚动条」）
  const hidden = rows.filter((r) => r.sub && r.sub.docScrollH > r.sub.frameH + 1)
  check('★ 「' + name + '」内容底边在帧内可见（文档高 ≤ 帧高，全部三档）',
    hidden.length === 0,
    JSON.stringify(hidden.map((r) => r.key + ' 文档 ' + r.sub.docScrollH + ' > 帧 ' + r.sub.frameH)))
  // extent()===0 回退有没有被触发
  const fb = rows.filter((r) => r.sub && r.sub.fallbackPath === 'body.scrollHeight')
  console.log('     · extent()===0 回退触发次数: ' + fb.length + '/' + rows.length +
    (fb.length ? '  → ' + JSON.stringify(fb.map((r) => r.key + ' extent=0 bodyScrollH=' + r.sub.bodyScrollH)) : ''))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
console.log('产物: ' + OUT)
process.exit(fail ? 1 : 0)
