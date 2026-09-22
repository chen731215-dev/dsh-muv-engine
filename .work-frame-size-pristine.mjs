// 卡界面「尺寸 / 照 ST 平价」验收台。
//
// 用户报的「立绘很小、内容塌了、框里还有滚动条」的根因是**循环定义**：
//   卡的 CSS 写 `min-height:100vh` → `100vh` 在 iframe 里就是 iframe 自己的高度 →
//   而我们又要「以内容包围盒决定 iframe 的高度」。两边互为因果，一旦报小就再也长不回去。
// ST 的办法是把 `min-height:…vh` 重写成父窗口视口高（实测 1080px）。这个工具验收我们照做后的效果。
//
// 四节：
//   A. min-height:…vh 重写（单元 + 真卡端到端：不再有内部滚动条）
//   B. reset 注入（box-sizing / html,body 的 margin·padding·overflow·max-width）
//   C. iframe display:block（卡下方不多出基线空隙）
//   D. 宽度下限：窄窗口下卡会切到**手机分支**（是另一种布局，不是缩放）—— 报出阈值
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-frame-size.mjs
// ⚠ 浏览器窗口高度必须是**真实尺寸**（默认 1400×980）：重写后的 min-height 取的就是父窗口
//   innerHeight，用 3200 高的无头窗口会得到一个不代表用户的巨大值。这条本身也断言住。

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readEngineSource, buildFrom, sandboxOf, collectDocs, openPage, evalJson, heightRuntimeSource, sleep,
} from './verify-shared.mjs'

const OUT = path.join(os.tmpdir(), 'muv-frame-size')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SRC = readEngineSource()
const SANDBOX = sandboxOf(SRC)

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const STUB_VH = 1080      // 单元断言里注入的父窗口视口高（= A2 夹具里重写出来的那个值）
const HEIGHT_RUNTIME = heightRuntimeSource(SRC)
const api = buildFrom(
  SRC, ['cardHtmlIframe', 'rewriteVhMinHeight'],
  { MUV_CARD_SANDBOX: SANDBOX, window: { addEventListener() {}, innerHeight: STUB_VH }, document: { querySelectorAll: () => [] } },
  '{cardHtmlIframe, rewriteVhMinHeight}'
)
const WRAP_RULE = (() => {
  const m = /\.muv-statusbar-wrap\{[^}]*\}/.exec(SRC)
  if (!m) throw new Error('源码里找不到 .muv-statusbar-wrap 规则')
  return m[0]
})()
const IFRAME_RULE = (() => {
  const m = /\.muv-iframe\{[^}]*\}/.exec(SRC)
  return m ? m[0] : ''
})()

// ═══════════════════ A1. 重写的单元断言 ═══════════════════
console.log('=== A1. min-height:…vh 重写（单元，注入 window.innerHeight=1080）===')
const R = api.rewriteVhMinHeight
check('100vh → 1080px', R('a{min-height:100vh}').includes('min-height:1080px'), R('a{min-height:100vh}'))
check('带空格 `min-height: 100vh` 也重写', R('a{min-height: 100vh}').includes('min-height:1080px'), R('a{min-height: 100vh}'))
check('86vh → 929px（按比例，不是一律替换成 100vh 的值）',
  R('a{min-height:86vh}').includes('min-height:929px'), R('a{min-height:86vh}'))
check('内联 style="min-height:100vh" 也重写',
  R('<div style="min-height:100vh">').includes('min-height:1080px'), R('<div style="min-height:100vh">'))
check('★ max-height:86vh 不动（与 ST 一致）', R('a{max-height:86vh}').includes('max-height:86vh'), R('a{max-height:86vh}'))
check('★ height:100vh 不动', R('a{height:100vh}').includes('height:100vh'), R('a{height:100vh}'))
check('★ <script> 里的同名文本不动',
  R('<script>var css="min-height:100vh"</script>').includes('min-height:100vh'),
  R('<script>var css="min-height:100vh"</script>'))
check('script 之外的那处仍然被改（跳过不是整段放弃）',
  R('<style>a{min-height:100vh}</style><script>var s="min-height:100vh"</script>').startsWith('<style>a{min-height:1080px}</style><script>var s="min-height:100vh"'),
  R('<style>a{min-height:100vh}</style><script>var s="min-height:100vh"</script>'))
check('没有 vh 声明时原样返回（不引入无谓改动）', R('<p>hi</p>') === '<p>hi</p>')
check('min-height:0 / 52px 这类非 vh 值不动', R('a{min-height:0;b:min-height:52px}') === 'a{min-height:0;b:min-height:52px}')
{
  // 拿不到可信视口高时必须**不重写**（写个错的固定值比不改更糟）
  const noVh = buildFrom(SRC, ['rewriteVhMinHeight'], { MUV_CARD_SANDBOX: SANDBOX, window: {}, document: { querySelectorAll: () => [] } }, 'rewriteVhMinHeight')
  check('★ 拿不到 window.innerHeight 时原样返回（宁可不改）',
    noVh('a{min-height:100vh}') === 'a{min-height:100vh}', noVh('a{min-height:100vh}'))
  const tiny = buildFrom(SRC, ['rewriteVhMinHeight'], { MUV_CARD_SANDBOX: SANDBOX, window: { innerHeight: 12 }, document: { querySelectorAll: () => [] } }, 'rewriteVhMinHeight')
  check('★ 视口高离谱（12px）时也不重写', tiny('a{min-height:100vh}') === 'a{min-height:100vh}', tiny('a{min-height:100vh}'))
}

// ═══════════════════ B/C 源码断言 ═══════════════════
console.log('\n=== B/C. reset 与 iframe 盒子（源码断言）===')
let resetProbe = null
try {
  const withCardReset = buildFrom(SRC, ['withCardReset', 'muvCardResetCss'], { MUV_CARD_SANDBOX: SANDBOX, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } }, 'withCardReset')
  resetProbe = withCardReset('<html><head><title>t</title></head><body>x</body></html>')
} catch (e) {
  resetProbe = null
}
if (resetProbe === null) {
  check('B: withCardReset 存在（reset 注入点）', false, '源码里还没有 withCardReset（B 尚未实现）')
  console.log('       （B 未实现时这一节按"未完成"处理，不计入失败数：下面用 SKIP 标注）')
} else {
  const need = [
    ['box-sizing:border-box', /\*[^{]*\{[^}]*box-sizing:border-box/],
    ['html,body margin:0!important', /html\s*,\s*body\{[^}]*margin:0!important/],
    ['html,body padding:0', /html\s*,\s*body\{[^}]*padding:0/],
    ['html,body max-width:100%!important', /html\s*,\s*body\{[^}]*max-width:100%!important/],
    // ★ 已按 ST 规格对齐：ST 的 `b1()` 注入的是**一条规则、单个简写属性**
    //   `html,body{…;overflow:hidden!important}`（见 ST-IFRAME-SPEC.md §1）。
    //   我们此前是「横向 hidden、纵向 auto」的偏离，理由是"让卡自己能滚"；但那条偏离
    //   正是用户看到的"框里还有滚动条"，而且和高度口径互为因果（纵向靠滚动兜底 ⇒
    //   内容再高也不报高度）。现在高度按内容量走 ⇒ 必须跟 ST 一样 hidden。
    //   ⚠ 想改回 `overflow-y:auto` 之前，先读 muvCardResetCss 的注释与 §8 偏离表。
    ['html,body overflow:hidden!important（ST 口径，简写属性）', /html\s*,\s*body\{[^}]*overflow:hidden!important/],
  ]
  for (const [label, re] of need) check('B: reset 含 ' + label, re.test(resetProbe), resetProbe.slice(0, 260))
  // 反向断言：锁死旧偏离，别让它悄悄回退（回退了卡里就会重新长出内部滚动条）
  check('B: reset 不含 overflow-y:auto（旧偏离不许回退）',
    !/overflow-y\s*:\s*auto/.test(resetProbe), resetProbe.slice(0, 260))
  check('B: reset 在 <body> 之前（第一帧就生效，不闪）', resetProbe.indexOf('<style') < resetProbe.indexOf('<body'), resetProbe.slice(0, 200))
  check('B: <script> 里的 <head> 不当作注入点', (() => {
    try {
      const w = buildFrom(SRC, ['withCardReset', 'muvCardResetCss'], { MUV_CARD_SANDBOX: SANDBOX, window: {}, document: { querySelectorAll: () => [] } }, 'withCardReset')
      const out = w('<html><head><script>var s="<head>"</script></head><body>x</body></html>')
      return out.indexOf('<style') < out.indexOf('</head>')
    } catch (_) { return false }
  })())
  check('B: 不重复注入（已注入则原样返回）', (() => {
    try {
      const w = buildFrom(SRC, ['withCardReset', 'muvCardResetCss'], { MUV_CARD_SANDBOX: SANDBOX, window: {}, document: { querySelectorAll: () => [] } }, 'withCardReset')
      return w(resetProbe) === resetProbe
    } catch (_) { return false }
  })())
}
const iframeTag = (/<iframe\b[^>]*>/.exec(api.cardHtmlIframe('<p>x</p>')) || [''])[0].replace(/srcdoc="[^"]*"/, 'srcdoc="…"')
check('C: iframe 标签内联了 display:block', /display:block/.test(iframeTag), iframeTag)
check('C: .muv-iframe 规则也含 display:block', /display:block/.test(IFRAME_RULE), IFRAME_RULE)

// ═══════════════════ A2. 真卡端到端 ═══════════════════
console.log('\n=== A2. 真卡端到端（iframe 890×900 附近，父窗口高度为真实尺寸）===')
const cards = collectDocs()
check('读到真卡界面（防空矩阵假绿）', cards.length >= 5, '只读到 ' + cards.length + ' 份')

const HOST = `<style>
  html,body{margin:0;padding:0;background:#16181d}
  /* 模拟 DSH 聊天列：940px 内容宽；flex 行 + 40px 头像 ⇒ 卡 iframe 实际宽 890px */
  .col{width:940px;box-sizing:content-box;padding:8px}
  .row{display:flex;gap:8px}
  .avatar{flex:0 0 40px;width:40px;height:40px;background:#333}
  .cap{font:12px monospace;color:#8b93a1}
  ${WRAP_RULE}
  ${IFRAME_RULE}
</style>`

const MEASURE = `(function(){
  var de = document.documentElement, b = document.body;
  var app = document.getElementById('app') || b;
  var cs = getComputedStyle(app), bs = getComputedStyle(b), hs = getComputedStyle(de);
  var over = de.scrollHeight - de.clientHeight;
  var all = b.getElementsByTagName('*'), maxB = 0, visB = 0, y = window.scrollY || 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i], s2; try { s2 = getComputedStyle(el) } catch(_) { continue }
    if (s2.position === 'fixed' || s2.position === 'sticky') continue;
    if (s2.display === 'none' || s2.visibility === 'hidden') continue;
    var r = el.getBoundingClientRect(); if (r.height === 0 && r.width === 0) continue;
    var bot = r.top + y + Math.max(r.height, el.scrollHeight || 0); if (bot > maxB) maxB = bot;
    // 纯几何底边（不含 el.scrollHeight 的"被父级裁掉也算"那一项）：裁切的判据用这个。
    // 用前面那个会误报 —— 引导脚本故意把 overflow 裁掉的静态子元素也算进去。
    var vb = r.top + y + r.height; if (vb > visB) visB = vb;
  }
  // body 的**直接子元素**底边：这些的溢出才会传导到文档（更深的元素可能被卡自己的
  // overflow 裁着，那种"几何底边超出"是卡自己的设计，不是我们的帧短了）。
  var topB = 0, kids = b.children;
  for (var j = 0; j < kids.length; j++) {
    var ke = kids[j], ks; try { ks = getComputedStyle(ke) } catch(_) { continue }
    if (ks.position === 'fixed' || ks.position === 'sticky') continue;
    if (ks.display === 'none' || ks.visibility === 'hidden') continue;
    var kr = ke.getBoundingClientRect();
    var kb = kr.top + y + kr.height; if (kb > topB) topB = kb;
  }
  return JSON.stringify({
    iw: innerWidth, ih: innerHeight,
    appMinH: cs.minHeight, bodyMinH: bs.minHeight,
    bodyOverflowY: bs.overflowY, bodyOverflowX: bs.overflowX,
    htmlOverflowY: hs.overflowY, bodyMargin: bs.marginTop,
    docScroll: de.scrollHeight, docClient: de.clientHeight, overflowPx: over,
    bodyScroll: b.scrollHeight, bodyClient: b.clientHeight, bodyOverflowPx: b.scrollHeight - b.clientHeight,
    contentBottom: Math.ceil(maxB), visibleBottom: Math.ceil(visB), topBottom: Math.ceil(topB)
  });
})()`

for (const d of cards) {
  const frame = api.cardHtmlIframe(d.body)
  // ★ 必须带上**真实的**高度运行时：不带它，iframe 会永远停在默认 900px，
  //   "有没有内部滚动条"就变成了夹具自己造出来的假象（我第一版就没带，量出一堆假溢出）。
  const page = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>size</title>${HOST}
</head><body><div class="col"><div class="cap">${d.card} / ${d.script}</div><div class="row"><div class="avatar"></div>${frame}</div></div>
<script>/* 高度运行时：逐字提取自 lib/client.js */<\/script>
<script>${HEIGHT_RUNTIME.replace(/<\/script/gi, '<\\/script')}<\/script>
</body></html>`
  d.rewrote = api.rewriteVhMinHeight(d.body) !== d.body
  const file = path.join(OUT, 'size-' + (d.card + '-' + d.script).replace(/[^\w\u4e00-\u9fa5]/g, '') + '.html')
  writeFileSync(file, page, 'utf8')
  d.file = file
}

const rt = await openPage(EDGE, { url: 'file:///' + cards[0].file.replace(/\\/g, '/'), outDir: OUT, windowSize: '1400,980' })
try {
  const hostVh = await evalJson(rt.cdp, 'JSON.stringify({ih: innerHeight, iw: innerWidth})', rt.pageSession)
  console.log('  父窗口视口 = ' + hostVh.iw + '×' + hostVh.ih + '（重写后的 min-height 应当≈这个高度）')
  check('★ 夹具窗口是真实尺寸（高 < 1200）—— 否则量出来的 min-height 不代表用户环境',
    hostVh.ih < 1200, 'ih=' + hostVh.ih)

  const rows = []
  for (const d of cards) {
    const before = rt.cdp.iframeSessions.length
    await rt.cdp.send('Page.navigate', { url: 'file:///' + d.file.replace(/\\/g, '/') + '?v=' + Date.now() }, rt.pageSession)
    const t0 = Date.now()
    while (rt.cdp.iframeSessions.length === before && Date.now() - t0 < 15000) await sleep(100)
    const sess = rt.cdp.iframeSessions[rt.cdp.iframeSessions.length - 1]
    await sleep(2600)
    const m = await evalJson(rt.cdp, MEASURE, sess.sessionId)
    d.m = m
    rows.push(d)
    console.log('  ' + (d.card + ' / ' + d.script).padEnd(42) +
      ' 帧 ' + String(m.iw).padStart(4) + '×' + String(m.ih).padStart(4) +
      ' minH(app)=' + String(m.appMinH).padStart(8) +
      ' 内容底=' + String(m.contentBottom).padStart(5) +
      ' 文档=' + String(m.docScroll).padStart(5) + '/' + String(m.docClient).padStart(4) +
      (m.overflowPx > 1 ? '  ⚠ 内部溢出 ' + m.overflowPx + 'px' : '  ✅ 无内部溢出'))
  }

  const stillVh = rows.filter((r) => /vh|dvh|svh|lvh/i.test(r.m.appMinH) || /vh|dvh|svh|lvh/i.test(r.m.bodyMinH))
  check('★ 没有任何真卡的 min-height 还是 vh 单位（重写生效）', stillVh.length === 0,
    stillVh.map((r) => r.script + ': app=' + r.m.appMinH + ' body=' + r.m.bodyMinH).join(' | '))
  const overflowed = rows.filter((r) => r.m.overflowPx > 1 || r.m.bodyOverflowPx > 1)
  check('★ 没有任何真卡出现内部滚动条（html 与 body 两个滚动区都不溢出）', overflowed.length === 0,
    overflowed.map((r) => r.script + ' html溢 ' + r.m.overflowPx + 'px / body溢 ' + r.m.bodyOverflowPx + 'px').join(' | '))
  const clipped = rows.filter((r) => r.m.topBottom > r.m.docScroll + 1)
  check('★ 文档级内容没有被裁掉（body 直接子元素的最大底边 <= 文档高 + 1）', clipped.length === 0,
    JSON.stringify(clipped.map((r) => [r.script, r.m.topBottom, r.m.docScroll])))
  check('B: 真卡上 reset 生效（body 的 overflow/margin 被接管）',
    rows.every((r) => r.m.bodyMargin === '0px' && r.m.bodyOverflowY !== '' ),
    JSON.stringify(rows.map((r) => [r.script, r.m.bodyMargin, r.m.bodyOverflowX, r.m.bodyOverflowY])))
  check('B: html/body 纵向 overflow 是 hidden（ST 口径 —— 见 ST-IFRAME-SPEC.md §1 / §8①）',
    rows.every((r) => r.m.bodyOverflowY === 'hidden' && r.m.htmlOverflowY === 'hidden'),
    JSON.stringify(rows.map((r) => [r.script, r.m.htmlOverflowY, r.m.bodyOverflowY])))
  // 重写过的卡：文档高必须真的被抬到 STUB_VH 之上（证明 min-height 真的生效，
  // 而不是"读起来不是 vh 了、其实没起作用"）
  const rewritten = rows.filter((r) => r.rewrote)
  check('有 ' + rewritten.length + ' 份卡被重写过（不是一份都没改）', rewritten.length >= 2, 'rewritten=' + rewritten.length)
  check('★ 重写过的卡：文档高确实被抬到 ' + STUB_VH + 'px 量级（min-height 真生效）',
    rewritten.every((r) => r.m.docScroll >= STUB_VH * 0.9),
    JSON.stringify(rewritten.map((r) => [r.script, r.m.docScroll])))

  // ── D. 宽度下限 ──
  console.log('\n=== D. 宽度下限（窄窗口下卡会切到另一套布局，不是缩放）===')
  const lastSession = rt.cdp.iframeSessions[rt.cdp.iframeSessions.length - 1].sessionId
  const mq = await evalJson(rt.cdp, `JSON.stringify((function(){
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sh = document.styleSheets[i], rules;
      try { rules = sh.cssRules } catch(_) { continue }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (r.media && /max-width|min-width/.test(r.media.mediaText)) out.push(r.media.mediaText);
        if (r.cssRules) for (var k = 0; k < r.cssRules.length; k++) {
          var r2 = r.cssRules[k];
          if (r2.media && /max-width|min-width/.test(r2.media.mediaText)) out.push(r2.media.mediaText);
        }
      }
    }
    var u = []; for (var z = 0; z < out.length; z++) if (u.indexOf(out[z]) < 0) u.push(out[z]);
    return { count: u.length, sample: u.slice(0, 10) };
  })())`, lastSession)
  console.log('  最后一份界面里带 max/min-width 的媒体查询 ' + mq.count + ' 条：' + JSON.stringify(mq.sample))
  console.log('  ⇒ 这些断点按 **iframe 宽度** 求值：容器窄于断点时卡会切到**手机分支**（另一种布局，不是缩放）。')
  console.log('     结论：不要为了"看起来合适"把容器做窄；满宽（≈890px）在多数卡上是桌面分支。')
} finally {
  rt.close()
}

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物: ' + OUT)
process.exit(fail ? 1 : 0)
