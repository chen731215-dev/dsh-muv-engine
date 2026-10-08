// 卡界面「高度报小」取证台 —— 用户报的「框里有滚动条」的直接来源。
//
// 现象：高度引导脚本报回的值比 `documentElement.scrollHeight` 小，iframe 于是比内容矮，
// 框内出现内部滚动条。实测最严重的一份差 **118px**（_足控天堂2 / 正文美化（带音乐）：
// 报 251 / 文档 369），另有 5px、20px 的两份。
//
// 这个工具做两件事：
//   ① **对照表**：9 份真卡界面上，「引导脚本量到的值」 vs「documentElement.scrollHeight」，
//      差值做成断言（不是打印）；
//   ② **定位到元素**：在卡文档里逐元素复算引导脚本的算法，把 `rect.bottom + scrollY` 最大的
//      几个元素、以及 html/body 自己的 padding/margin 全打出来 —— 让"被漏算的那 118px"
//      落到具体元素上，而不是靠猜着扩大测量范围（那会引进"多算"这一类新 bug）。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-frame-gap.mjs

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readEngineSource, buildFrom, sandboxOf, collectDocs, openPage, evalJson, heightRuntimeSource, sleep,
} from './verify-shared.mjs'

const OUT = path.join(os.tmpdir(), 'muv-frame-gap')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SRC = readEngineSource()

let pass = 0, fail = 0
let frozen = null
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const SANDBOX = sandboxOf(SRC)
const cardHtmlIframe = buildFrom(
  SRC, ['cardHtmlIframe'],
  { MUV_CARD_SANDBOX: SANDBOX, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } },
  'cardHtmlIframe'
)
const HEIGHT_RUNTIME = heightRuntimeSource(SRC)

/**
 * 在卡文档里复算引导脚本的 `extent()`，并把**差值来自哪里**的候选一起报出来。
 *
 * 与 `muvFrameBootstrap` 里的算法逐条对齐：排除 fixed/sticky、排除 display:none /
 * visibility:hidden / 零尺寸，每元素取 `max(rect.height, el.scrollHeight)`。
 * 注意它遍历的是 `body.getElementsByTagName('*')` —— **不含 body/html 自己**，
 * 也不含任何元素的 margin。这两点正是"报小"的候选来源，所以这里把它们单独量出来。
 */
const PROBE = `(function(){
  var de = document.documentElement, b = document.body;
  if (!b) return JSON.stringify({ err: 'no-body' });
  var y = window.scrollY || 0;
  var all = b.getElementsByTagName('*'), maxB = 0, list = [];
  var skipped = { fixed: 0, hidden: 0, zero: 0 };
  for (var i = 0; i < all.length; i++) {
    var el = all[i], cs;
    try { cs = getComputedStyle(el) } catch(_) { continue }
    if (cs.position === 'fixed' || cs.position === 'sticky') { skipped.fixed++; continue }
    if (cs.display === 'none' || cs.visibility === 'hidden') { skipped.hidden++; continue }
    var r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) { skipped.zero++; continue }
    var bot = r.top + y + Math.max(r.height, el.scrollHeight || 0);
    if (bot > maxB) maxB = bot;
    list.push({ bot: Math.round(bot), tag: el.tagName, id: el.id || '', cls: String(el.className || '').slice(0, 44),
      pos: cs.position, h: Math.round(r.height), sh: el.scrollHeight || 0, mb: cs.marginBottom });
  }
  list.sort(function(a, b2) { return b2.bot - a.bot });
  var bs = getComputedStyle(b), hs = getComputedStyle(de);
  return JSON.stringify({
    iw: innerWidth, ih: innerHeight,
    docScroll: de.scrollHeight, docClient: de.clientHeight,
    bodyScroll: b.scrollHeight, bodyRectH: Math.round(b.getBoundingClientRect().height),
    bodyOffsetTop: b.offsetTop,
    htmlPadT: hs.paddingTop, htmlPadB: hs.paddingBottom, htmlMarginB: hs.marginBottom,
    bodyMarginT: bs.marginTop, bodyMarginB: bs.marginBottom, bodyPadB: bs.paddingBottom,
    bboxMax: Math.ceil(maxB), skipped: skipped, top: list.slice(0, 6)
  });
})()`

const docs = collectDocs()
check('读到真卡界面（防空矩阵假绿）', docs.length >= 5, '只读到 ' + docs.length + ' 份')
// 提前终止也要留汇总行 + 非零退出：批处理里"没汇总行"看起来像"没跑"，会被当成通过。
if (docs.length < 5) {
  console.log('\n=== 断言: ' + pass + ' 通过, ' + fail + ' 失败 ===')
  console.log('!! 提前终止（未跑完，结果**不可**当通过）: 只读到 ' + docs.length + ' 份真卡界面（检查 MUV_CARD_DIR）')
  process.exit(1)
}

const rows = []
let i = 0
const fixturePass = []
for (const d of docs) {
  i++
  const frame = cardHtmlIframe(d.body)
  const page = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>frame-gap-${i}</title>
<style>html,body{margin:0;padding:0;background:#16181d}iframe{display:block;width:100%}</style>
</head><body>
${frame}
<script>/* 高度运行时：逐字提取自 lib/client.js */<\/script>
<script>${HEIGHT_RUNTIME.replace(/<\/script/gi, '<\\/script')}<\/script>
</body></html>`
  const file = path.join(OUT, 'gap-' + String(i).padStart(2, '0') + '.html')
  writeFileSync(file, page, 'utf8')
  fixturePass.push({ card: d.card, script: d.script, file })
}

const rt = await openPage(EDGE, { url: 'file:///' + fixturePass[0].file.replace(/\\/g, '/'), outDir: OUT, windowSize: '1500,3200' })
try {
  for (const f of fixturePass) {
    // 每份都重新导航，等新的 OOPIF 会话挂上来
    const before = rt.cdp.iframeSessions.length
    await rt.cdp.send('Page.navigate', { url: 'file:///' + f.file.replace(/\\/g, '/') + '?v=' + Date.now() }, rt.pageSession)
    const t0 = Date.now()
    while (rt.cdp.iframeSessions.length === before && Date.now() - t0 < 15000) await sleep(100)
    const sess = rt.cdp.iframeSessions[rt.cdp.iframeSessions.length - 1]
    await sleep(2600)                       // 引导脚本自己有 700/1600ms 两次报数
    const card = await evalJson(rt.cdp, PROBE, sess.sessionId)
    const host = await evalJson(rt.cdp,
      'JSON.stringify((function(){var f=document.querySelector("iframe");return {styleH:f.style.height, rectH:Math.round(f.getBoundingClientRect().height)}})())',
      rt.pageSession)
    const reported = parseFloat(host.styleH)
    rows.push({ cardName: f.card, script: f.script, reported, docScroll: card.docScroll, bodyScroll: card.bodyScroll, bboxMax: card.bboxMax, card, host })
  }
  // ── A4. 对照臂：把帧高冻短，判据必须能红（必须在 rt 关掉之前做）──────────────
  {
    const frozenSrc = readFileSync(fixturePass[0].file, 'utf8')
    const frozenFile = path.join(OUT, 'gap-frozen-300.html')
    writeFileSync(frozenFile, frozenSrc, 'utf8')
    const before2 = rt.cdp.iframeSessions.length
    await rt.cdp.send('Page.navigate', { url: 'file:///' + frozenFile.replace(/\\/g, '/') + '?v=' + Date.now() }, rt.pageSession)
    const t2 = Date.now()
    while (rt.cdp.iframeSessions.length === before2 && Date.now() - t2 < 15000) await sleep(100)
    const sess2 = rt.cdp.iframeSessions[rt.cdp.iframeSessions.length - 1]
    await sleep(1200)
    // ★ 冻短手法：**内联 !important 反复压**，而不是往样式表里插规则。
    //   为什么：父页那个高度处理器是在收到子帧消息后写 `f.style.height` 的 ——
    //   上一版往样式表插 `iframe{height:300px !important}`，实测完全没生效
    //   （冻短后报数还是 1636），因为内联样式里带 `!important` 的话样式表压不住它。
    //   这里改成每 50ms 用 `setProperty(..., 'important')` 压一次，谁后写谁赢，
    //   帧在测量窗口里恒为 300px ⇒ 内容（1635px）必然被裁。
    await evalJson(rt.cdp,
      "(function(){var f=document.querySelector('iframe');" +
      "window.__pin=setInterval(function(){f.style.setProperty('height','300px','important')},50);return '1'})()",
      rt.pageSession)
    await sleep(1400)
    const card2 = await evalJson(rt.cdp, PROBE, sess2.sessionId)
    const h2 = await evalJson(rt.cdp,
      'JSON.stringify((function(){var f=document.querySelector("iframe");return {styleH:f.style.height}})())',
      rt.pageSession)
    await evalJson(rt.cdp, '(function(){clearInterval(window.__pin);return "1"})()', rt.pageSession)
    frozen = { script: fixturePass[0].script, card: card2, host: h2 }
    frozen.reported = parseFloat(frozen.host.styleH)
  }
} finally {
  rt.close()
}

console.log('\n=== 对照表：引导脚本报的值 vs 文档真实高度 ===')
console.log('  卡 / 界面'.padEnd(44) + '报数   文档高  包盒max  差(文档-报数)')
for (const r of rows) {
  const gap = r.docScroll - r.reported
  console.log('  ' + (r.cardName + ' / ' + r.script).padEnd(42) +
    String(r.reported).padStart(5) + String(r.docScroll).padStart(8) + String(r.bboxMax).padStart(9) +
    String(gap).padStart(12) + (gap > 2 ? '  ← 报小' : ''))
}

console.log('\n=== 差值定位（差值最大的三份，逐元素取证）===')
const worst = [...rows].sort((a, b) => (b.docScroll - b.reported) - (a.docScroll - a.reported)).slice(0, 3)
for (const r of worst) {
  const c = r.card
  console.log(`\n  --- ${r.cardName} / ${r.script}  报数=${r.reported} 文档高=${c.docScroll} 包盒max=${c.bboxMax} ---`)
  console.log(`      帧视口=${c.ih}  body.scrollHeight=${c.bodyScroll}  body 盒子高=${c.bodyRectH}  body.offsetTop=${c.bodyOffsetTop}`)
  console.log(`      html padding=${c.htmlPadT}/${c.htmlPadB} margin-bottom=${c.htmlMarginB} · body margin=${c.bodyMarginT}/${c.bodyMarginB} padding-bottom=${c.bodyPadB}`)
  console.log(`      被排除：fixed/sticky=${c.skipped.fixed} hidden=${c.skipped.hidden} 零尺寸=${c.skipped.zero}`)
  console.log('      贡献最大的元素:')
  for (const t of c.top) {
    console.log(`        bot=${String(t.bot).padStart(6)}  ${t.tag}${t.id ? '#' + t.id : ''}${t.cls ? '.' + t.cls.split(' ')[0] : ''}` +
      `  pos=${t.pos} rectH=${t.h} scrollH=${t.sh} margin-bottom=${t.mb}`)
  }
}

console.log('\n=== 断言 ===')
const gaps = rows.map((r) => r.docScroll - r.reported)
const bad = gaps.filter((g) => g > 2)
check('每一份界面的 iframe 高度都不小于文档真实高度（报小 <= 2px）', bad.length === 0,
  bad.length + ' 份报小：' + JSON.stringify(rows.filter((r) => r.docScroll - r.reported > 2).map((r) => r.cardName + '/' + r.script + '=-' + (r.docScroll - r.reported))))
// ── 判据口径（体检结论，与 verify-frame-size 的 C 节同一套口径）────────────────
//
//  判据只认**文档滚动区**：`documentElement.scrollHeight` 才是"有没有内容被裁掉"的信号；
//  `bboxMax`（元素几何包围盒上界）会被**浮动 / 外边距折叠**抬高，跟"被裁"无关。
//  实测（本文件同一次运行）：ERA 状态栏 `报数=889 文档滚动高=889 包盒max=895` ——
//  文档滚区与报数**严丝合缝**（真正裁掉时会变成 895>889 并触发上面那条红），
//  多出来的 6px 全在包盒口径里，正是 frame-size 里定性过的同一个假象。
//  所以：判据 = 报数必须紧贴**它自己那份文档**的滚动高；包盒只作信息行。
//  ★ 不许放过真溢出：下面 `=== A4 ===` 是冻短帧高的对照臂 —— 样式表 `!important`
//    把帧钉在 300px，此时"报小"必须 > 2px。
check('★ 报数确实来自测量而不是兜底（每份报数都紧贴它自己文档的真实滚动高；且包盒量到了内容）',
  rows.every((r) => r.bboxMax > 0 && Math.abs(r.docScroll - r.reported) <= 2),
  JSON.stringify(rows.map((r) => [r.cardName + '/' + r.script, r.reported, r.docScroll, r.bboxMax])))
console.log('  · 几何口径（信息，不作判据）: ' + rows.map((r) => r.cardName + '/' + r.script + ' 包盒max=' + r.bboxMax +
  ' 文档滚动高=' + r.docScroll + ' 报数=' + r.reported + '（包盒多出 ' + (r.bboxMax - r.docScroll) + 'px）').join(' | '))

// ── A4. 对照臂：把帧高冻短，上面两条判据必须红 ────────────────────────────────
{
  const c2 = frozen.card
  const rep2 = frozen.reported
  const gap2 = c2.docScroll - rep2
  console.log('\n=== A4. 对照臂：冻短帧高（判据必须能红）===')
  console.log('  冻短后的 "' + frozen.script + '": 报数=' + rep2 + ' 文档滚动高=' + c2.docScroll +
    ' 包盒max=' + c2.bboxMax + ' ⇒ 报小=' + gap2 + 'px')
  check('★★ 冻短帧高后「报小」判据必须红（否则上面那两条是恒真）', gap2 > 2, '报小=' + gap2 + 'px')
  check('★★ 冻短帧高后 html 溢出判据也必须红（滚动高 > 帧视口高 +2）',
    c2.docScroll - c2.docClient > 2, 'html 溢出=' + (c2.docScroll - c2.docClient) + 'px 文档滚动高=' + c2.docScroll + ' 帧视口=' + c2.ih)
}
console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物: ' + OUT)
process.exit(fail ? 1 : 0)
