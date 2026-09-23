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

// ★★ 2026-09-23 修：必须给 `window` 桩（与 verify-frame-height.mjs 同一条教训）。
//   真实 DSH 里 `cardHtmlIframe` 在**浏览器里**跑，`rewriteVhMinHeight` 读得到
//   `window.innerHeight` ⇒ 把卡里的 `min-height:100vh` 烤成**父页视口常量**（ST 语义）。
//   Node 侧不传桩 ⇒ 重写静默跳过 ⇒ 卡里的 `min-height:100vh` 原样进 iframe ⇒ 它 = iframe
//   自己的高度 ⇒ 真·不动点：起始 600/900/1500 → 报 600/900/1500（实测就是这么报的，
//   `正文美化` 那三档的 FAIL 就是这么来的 —— 那是**夹具缺省行为**，不是上线行为）。
//   探针窗口 1280×900 ⇒ headless 下 innerHeight 恰为 900。
const R = loadClientRenderers(undefined, { innerHeight: 900 })

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
      // ★★ 2026-09-23 修：产物里的 srcdoc 值被 `escAttr` **整体转义**（`<` → `&lt;`、
      //   `>` → `&gt;` —— 见 lib/client.js 的 escAttr）。所以：
      //   ① 要匹配的是**转义形态**的 `&lt;/body&gt;`，不是 `</body>`；
      //   ② 插进去的探针也必须**先转义**，浏览器解开属性实体后才还原成真脚本。
      //   原来那句 `doc.replace(/<\/body\s*>/, …)` 打在不含该字面量的转义产物上是**空操作**
      //   ⇒ 子文档探针从未注入 ⇒ 下面第 1 节的三列（`extent` / `走的路径` / `内容底`)
      //   **恒为 `?`**，两条判据（有没有走 `body.scrollHeight` 回退 / 内容底边是否可见）
      //   **恒真** —— 空判据。这与"空表假绿"是同一类病，一起修掉。
      const escProbe = (s) => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      html = html.replace(/(srcdoc=")([\s\S]*?)(" sandbox)/, (m, a, doc, b) => {
        const probe = escProbe(CASE_PROBE(key) + INSTRUMENT)
        const re = /&lt;\/body\s*&gt;/gi
        let mm, last = null
        while ((mm = re.exec(doc))) last = mm
        if (!last) return a + doc + b
        return a + doc.slice(0, last.index) + probe + doc.slice(last.index) + b
      })
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
    // ★★ 2026-09-23 修：这里是**多了一个 `}`** —— `}}}' + '}, false);'` 一共闭了 4 层，
    //   而 `function(e){ … for(…){ if(…){ … } } }` 只需要 3 层。整个父页内联脚本因此
    //   **语法错（`SyntaxError: missing ) after argument list`）⇒ 一行都不执行**
    //   ⇒ 没有监听器、没有 `#out`、`parsed={}` ⇒ 这个门禁从此**永远"全部通过"**（空表假绿）。
    //   实测：改动前后的源码（`git show b536cb4:lib/client.js`）表现完全一致。
    //   修法就是把这一层的花括号减掉：`h;}}`（收 `if(...){` 与 `for(...){`）
    //   + `}, false);`（收 `function(e){` 并结束 addEventListener 调用）＝ 一共 3 层。
    'var c=clamp[k];if(c.rawMax===null||e.data.__muvFrameHeight>c.rawMax)c.rawMax=e.data.__muvFrameHeight;' +
    'var h=Math.round(e.data.__muvFrameHeight);if(h<lim.min)h=lim.min;if(h>lim.max)h=lim.max;' +
    'if(c.clampedMax===null||h>c.clampedMax)c.clampedMax=h;}}' +
    '}, false);' +
    'window.__muvFrameHListener=1;' +
    'window.addEventListener("message", onMuvFrameHeightMessage, false);' +
    'function report(){var out={};var all=document.querySelectorAll("iframe.muv-iframe");' +
    'for(var i=0;i<all.length;i++){var f=all[i];var k=f.dataset.key;' +
    'out[k]={final:parseFloat(f.style.height),reports:(seen[k]||[]),clamp:(clamp[k]||null),' +
    'ownScrollbar:(f.scrollHeight>f.clientHeight+1)};}' +
    'var s=JSON.stringify(out);var o=document.getElementById("out");if(o)o.textContent=s;return s;}' +
    'window.__report=report;' +
    // 仍然挂 load+5s（有则更好），但**判据不再依赖它**：父页 `load` 要等 3 个真卡 iframe 的
    // 远程资源（字体/图/视频）全部落定，实测在这个夹具里**可能永远不 fire** ⇒ 只靠它就会拿到空表。
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
    // ★ 等"有帧 + 至少一条上报"（轮询而不是固定 sleep），再补 6s 让内容/棘轮收敛。
    //
    // 为什么必须改（实测，2026-09-23）：原来的 `await sleep(6500)` 之后只读一次
    // `#out`，而 `report()` 挂在**父页 `load` + 5000ms** 上；父页 `load` 要等这批
    // （1 真卡 × 3 档起点，其中 ERA 状态栏 210 KB、带远程字体/6 图/1 视频）全部落定，
    // 在这个夹具里**可能永远不 fire** ⇒ `#out` 空串 ⇒ `parsed={}` ⇒ `byName` 为空
    // ⇒ **下面的判据一条都不跑，直接报"全部通过"**（空表假绿）。
    // 已用 `git show b536cb4:lib/client.js`（改动前的源码）实测复现同样现象 ⇒ 与客户端无关。
    let dom = null
    const t0 = Date.now()
    while (Date.now() - t0 < 40000) {
      dom = await evalJson(rt.cdp, 'window.__report ? window.__report() : ""', rt.pageSession)
      let cur = {}
      try { cur = typeof dom === 'string' ? JSON.parse(dom) : (dom || {}) } catch (_) { cur = {} }
      if (Object.keys(cur).length && Object.values(cur).some((v) => (v.reports || []).length > 0)) break
      await sleep(400)
    }
    await sleep(6000)   // 原来的 6500ms 等待就是为这一段的收敛
    dom = await evalJson(rt.cdp, 'window.__report ? window.__report() : ""', rt.pageSession)
    let parsed = {}
    try { parsed = typeof dom === 'string' ? JSON.parse(dom) : (dom || {}) } catch (_) { parsed = {} }
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
// ★ 防空表假绿：一条实例读数都没有 ⇒ 下面的判据一条都不会跑，"全部通过"是空的。
//   第一次实测就是这么骗过去的（固定 sleep 抢在父页 report() 之前，见上面轮询那段）。
check('读到逐实例读数（防空表假绿）', Object.keys(all).length > 0,
  '0 条读数 ⇒ 下面的判据一条都没执行；这行必须红，别把空表当通过')
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
