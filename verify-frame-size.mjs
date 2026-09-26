// 卡界面「尺�?/ �?ST 平价」验收台�?//
// 用户报的「立绘很小、内容塌了、框里还有滚动条」的根因�?*循环定义**�?//   卡的 CSS �?`min-height:100vh` �?`100vh` �?iframe 里就�?iframe 自己的高�?�?//   而我们又要「以内容包围盒决�?iframe 的高度」。两边互为因果，一旦报小就再也长不回去�?// ST 的办法是�?`min-height:…vh` 重写成父窗口视口高（实测 1080px）。这个工具验收我们照做后的效果�?//
// 四节�?//   A. min-height:…vh 重写（单�?+ 真卡端到端：不再有内部滚动条�?//   B. reset 注入（box-sizing / html,body �?margin·padding·overflow·max-width�?//   C. iframe display:block（卡下方不多出基线空隙）
//   D. 宽度下限：窄窗口下卡会切�?*手机分支**（是另一种布局，不是缩放）—�?报出阈�?//
// 运行�?env:MUV_EDGE="...\msedge.exe"; node verify-frame-size.mjs
// �?浏览器窗口高度必须是**真实尺寸**（默�?1400×980）：重写后的 min-height 取的就是父窗�?//   innerHeight，用 3200 高的无头窗口会得到一个不代表用户的巨大值。这条本身也断言住�?
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
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
  console.log('=== A1. min-height:…vh 重写（单元，注入 window.innerHeight=1080�?==')
const R = api.rewriteVhMinHeight
check('100vh → 1080px', R('a{min-height:100vh}').includes('min-height:1080px'), R('a{min-height:100vh}'))
check('带空格 `min-height: 100vh` 也重写', R('a{min-height: 100vh}').includes('min-height:1080px'), R('a{min-height: 100vh}'))
check('86vh → 929px（按比例，不是一律替换成 100vh 的值）',
  R('a{min-height:86vh}').includes('min-height:929px'), R('a{min-height:86vh}'))
check('内联 style="min-height:100vh" 也重�',
  R('<div style="min-height:100vh">').includes('min-height:1080px'), R('<div style="min-height:100vh">'))
check('★ max-height:86vh 不动（与 ST 一致）', R('a{max-height:86vh}').includes('max-height:86vh'), R('a{max-height:86vh}'))
check('★ height:100vh 不动', R('a{height:100vh}').includes('height:100vh'), R('a{height:100vh}'))
check('★ <script> 里的同名文本不动',
  R('<script>var css="min-height:100vh"</script>').includes('min-height:100vh'),
  R('<script>var css="min-height:100vh"</script>'))
check('script 之外的那处仍然被改（跳过不是整段放弃�',
  R('<style>a{min-height:100vh}</style><script>var s="min-height:100vh"</script>').startsWith('<style>a{min-height:1080px}</style><script>var s="min-height:100vh"'),
  R('<style>a{min-height:100vh}</style><script>var s="min-height:100vh"</script>'))
check('没有 vh 声明时原样返回（不引入无谓改动）', R('<p>hi</p>') === '<p>hi</p>')
check('min-height:0 / 52px 这类非 vh 值不动', R('a{min-height:0;b:min-height:52px}') === 'a{min-height:0;b:min-height:52px}')
{
  // 拿不到可信视口高时必�?*不重�?*（写个错的固定值比不改更糟�?
  const noVh = buildFrom(SRC, ['rewriteVhMinHeight'], { MUV_CARD_SANDBOX: SANDBOX, window: {}, document: { querySelectorAll: () => [] } }, 'rewriteVhMinHeight')
  check('�?拿不�?window.innerHeight 时原样返回（宁可不改�',
    noVh('a{min-height:100vh}') === 'a{min-height:100vh}', noVh('a{min-height:100vh}'))
  const tiny = buildFrom(SRC, ['rewriteVhMinHeight'], { MUV_CARD_SANDBOX: SANDBOX, window: { innerHeight: 12 }, document: { querySelectorAll: () => [] } }, 'rewriteVhMinHeight')
  check('★ 视口高离谱（12px）时也不重写', tiny('a{min-height:100vh}') === 'a{min-height:100vh}', tiny('a{min-height:100vh}'))
}

// ═══════════════════ B/C 源码断言 ═══════════════════
  console.log('\n=== B/C. reset �?iframe 盒子（源码断言�?==')
let resetProbe = null
try {
  const withCardReset = buildFrom(SRC, ['withCardReset', 'muvCardResetCss'], { MUV_CARD_SANDBOX: SANDBOX, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } }, 'withCardReset')
  resetProbe = withCardReset('<html><head><title>t</title></head><body>x</body></html>')
} catch (e) {
  resetProbe = null
}
if (resetProbe === null) {
  check('B: withCardReset 存在（reset 注入点）', false, '源码里还没有 withCardReset（B 尚未实现�')
  console.log('       （B 未实现时这一节按"未完�?处理，不计入失败数：下面�?SKIP 标注�')
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
  check('B: 不重复注入（已注入则原样返回�', (() => {
    try {
      const w = buildFrom(SRC, ['withCardReset', 'muvCardResetCss'], { MUV_CARD_SANDBOX: SANDBOX, window: {}, document: { querySelectorAll: () => [] } }, 'withCardReset')
      return w(resetProbe) === resetProbe
    } catch (_) { return false }
  })())
}
const iframeTag = (/<iframe\b[^>]*>/.exec(api.cardHtmlIframe('<p>x</p>')) || [''])[0].replace(/srcdoc="[^"]*"/, 'srcdoc="…"')
check('C: iframe 标签内联了 display:block', /display:block/.test(iframeTag), iframeTag)
check('C: .muv-iframe 规则也含 display:block', /display:block/.test(IFRAME_RULE), IFRAME_RULE)

// ── 父页记账：同一�?raw 调两次，产物必须逐字节相同，且注入缓存只�?1 �?──
// 这条挡的�?每次重建都往缓存里塞一份新产物"这种看不见的泄漏：卡一多（或消息一重渲染）
// 内存就跟着涨，�?*外观上完全正�?*。逐字节相同同时也是幂等性的前提条件�?
  {
  const raw = '<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>'
  // `muvInjectCache` 是父页的模块�?`var`（client.js:2264）。这里把它当 **dep 传进�?*
  // （不是让它自动注入）：自动注入会�?`var muvInjectCache = {}` 也塞进函数头�?  // 那会**重置**掉我们想观测的那个对象（var 重复声明把参数的值冲掉）�?
  const cache = {}
  const api2 = buildFrom(SRC, ['cardHtmlIframe'],
    { MUV_CARD_SANDBOX: SANDBOX, muvInjectCache: cache, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } },
    '({html:cardHtmlIframe,gc:function(){var n=0;for(var k in muvInjectCache){if(Object.prototype.hasOwnProperty.call(muvInjectCache,k))n++}return n}})')
  const raw2 = '<!DOCTYPE html><html><head><title>t2</title></head><body><p>yo</p></body></html>'
  const n0 = api2.gc()
  const a1 = api2.html(raw)
  const a2 = api2.html(raw)
  check('�?同一 raw 两次 cardHtmlIframe 产物逐字节相同（幂等，不含时间戳/随机数）', a1 === a2,
    '长度 ' + a1.length + ' vs ' + a2.length + '，首处不�?@' +
    (() => { let i = 0; while (i < Math.min(a1.length, a2.length) && a1[i] === a2[i]) i++; return i })())
  const n1 = api2.gc()
  const a3 = api2.html(raw)
  const n2 = api2.gc()
  const b1 = api2.html(raw2)
  const n3 = api2.gc()
  // 这条挡的�?每次重建都往缓存里塞一份新产物"这种看不见的泄漏：卡一多、消息一重渲染，
  // 内存就跟着涨，�?*外观上完全正�?*。判据是"�?raw N �?�?恰好 1 �?，不�?N �?�?N �?�?
  check('�?父页 muvInjectCache �?raw 记账：同 raw �?3 次只入账 1 �', n1 === n0 + 1 && n2 === n0 + 1,
    '起始 ' + n0 + ' → 第 1 次 ' + n1 + ' → 第 3 次 ' + n2 + '（每次产物都与首次相同？' + (a3 === a1) + '）')
  check('�?换一�?raw �?+1（不�?什么都没记"�', n3 === n0 + 2 && b1 !== a1,
    '�?raw �?' + n3 + ' 项（期望 ' + (n0 + 2) + '�')
}

// ═══════════════════ A2. 真卡端到端 ═══════════════════
  console.log('\n=== A2. 真卡端到端（iframe 890×900 附近，父窗口高度为真实尺寸）===')
const cards = collectDocs()
check('读到真卡界面（防空矩阵假绿）', cards.length >= 5, '只读�?' + cards.length + ' �')

const HOST = `<style>
  html,body{margin:0;padding:0;background:#16181d}
  /* 模拟 DSH 聊天列：940px 内容宽；flex �?+ 40px 头像 �?�?iframe 实际�?890px */
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
  // body �?*直接子元�?*底边：这些的溢出才会传导到文档（更深的元素可能被卡自己的
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
  console.log('  父窗口视�?= ' + hostVh.iw + '×' + hostVh.ih + '（重写后�?min-height 应当≈这个高度）')
  check('�?夹具窗口是真实尺寸（�?< 1200）—�?否则量出来的 min-height 不代表用户环�',
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
      (m.overflowPx > 1 ? '  �?内部溢出 ' + m.overflowPx + 'px' : '  �?无内部溢�'))
  }

  const stillVh = rows.filter((r) => /vh|dvh|svh|lvh/i.test(r.m.appMinH) || /vh|dvh|svh|lvh/i.test(r.m.bodyMinH))
  check('�?没有任何真卡�?min-height 还是 vh 单位（重写生效）', stillVh.length === 0,
    stillVh.map((r) => r.script + ': app=' + r.m.appMinH + ' body=' + r.m.bodyMinH).join(' | '))
  // ── 判据口径：什么是"真的溢出/被裁" ────────────────────────────────────────
  //
  // 这里量过三个口径，结论是**只有 html（文档滚动区）那一项算数**：
  //
  //   口径            冻短帧高（真裁 1755px）  ERA 状态栏（帧与内容齐平）
  //   html 滚动溢出         1755px  ✅ 抓到        0px     ✅ 干净
  //   body 滚动溢出            0px  ❌ 漏掉        5px     ❌ 假红
  //   几何底边超出           2056>2055 ✅         929>923  ⚠ 浮动/外边距折叠造成的包围盒差
  //
  // 为什么 body 不可靠：reset 给 `html,body` 都上了 `overflow:hidden!important`（照 ST，
  // 见 ST-IFRAME-SPEC.md §1/§8①），body 因此变成**不滚动的盒子**，它的 `scrollHeight`
  // 在正常态与冻结态下都不代表被裁掉的内容量（上面两列正好互相矛盾）。而 ERA 那 5px
  // 是 body 盒底与内容底边的差（浮动/外边距折叠），帧本身比内容还高 6px，用户什么都看不见
  // —— 它在改动前后都以约 1/3 概率红，是**间歇假红**。
  //
  // 为什么几何口径也不能当判据：`topBottom(929) > docScroll(923)` 同样来自浮动/折叠，
  // 真正被裁时它和 html 口径同向（2056 > 2055），但干净时也会因为 6px 包围盒差误报。
  // 所以它**降级为信息行**（下面那行 `· 几何口径`），只用来和 html 口径互相印证。
  //
  // ★ 不许放过真溢出：下面 `=== A3 ===` 是**冻短帧高**的对照臂 —— 用样式表 `!important`
  //   把帧高钉死在 300px（这张卡要 1080px），此时 html 滚动溢出必须 > 2px。它红了，
  //   上面这条绿才是"真绿"。
  const scrollOver = (r) => (r.m.docScroll || 0) - (r.m.docClient || 0)
  const bodyOver = (r) => (r.m.bodyScroll || 0) - (r.m.bodyClient || 0)
  const overflowed = rows.filter((r) => scrollOver(r) > 1)
  check('★ 没有任何真卡出现内部滚动条（真正的滚动溢出：html 的 scrollHeight 不超过 clientHeight + 1）',
    overflowed.length === 0,
    overflowed.map((r) => r.script + ' html溢 ' + r.m.overflowPx + 'px / body溢 ' + r.m.bodyOverflowPx + 'px').join(' | '))
  // body 口径与几何口径都**只报数字不作判据**（理由见上）。
  const bodyNoise = rows.filter((r) => bodyOver(r) > 1)
  const geomOver = rows.filter((r) => r.m.topBottom > r.m.docScroll + 1)
  console.log('  · body 口径（信息，不作判据）: ' + (bodyNoise.length
    ? bodyNoise.map((r) => r.script + ' body溢 ' + bodyOver(r) + 'px（html 溢 ' + scrollOver(r) + 'px）').join(' | ')
    : '所有卡的 body 盒都没溢出'))
  console.log('  · 几何口径（信息，不作判据）: ' + (geomOver.length
    ? geomOver.map((r) => r.script + ' 底边 ' + r.m.topBottom + ' / 文档 ' + r.m.docScroll + '（差 ' + (r.m.topBottom - r.m.docScroll) + 'px，html 滚动溢出 ' + scrollOver(r) + 'px）').join(' | ')
    : '所有卡的元素底边都没超过文档高'))
  check('★ 文档级内容没有被裁掉（口径=真正的滚动溢出：html 的 scrollHeight ≤ clientHeight）',
    overflowed.length === 0,
    JSON.stringify(overflowed.map((r) => [r.script, scrollOver(r), r.m.topBottom, r.m.docScroll])))
  check('B: 真卡�?reset 生效（body �?overflow/margin 被接管）',
    rows.every((r) => r.m.bodyMargin === '0px' && r.m.bodyOverflowY !== '' ),
    JSON.stringify(rows.map((r) => [r.script, r.m.bodyMargin, r.m.bodyOverflowX, r.m.bodyOverflowY])))
  check('B: html/body 纵向 overflow �?hidden（ST 口径 —�?�?ST-IFRAME-SPEC.md §1 / §8①）',
    rows.every((r) => r.m.bodyOverflowY === 'hidden' && r.m.htmlOverflowY === 'hidden'),
    JSON.stringify(rows.map((r) => [r.script, r.m.htmlOverflowY, r.m.bodyOverflowY])))
  // 重写过的卡：文档高必须真的被抬到 STUB_VH 之上（证明 min-height 真的生效，
  // 而不是"读起来不是 vh 了、其实没起作用"）
  const rewritten = rows.filter((r) => r.rewrote)
  check('�?' + rewritten.length + ' 份卡被重写过（不是一份都没改�', rewritten.length >= 2, 'rewritten=' + rewritten.length)
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
  console.log('  最后一份界面里�?max/min-width 的媒体查�?' + mq.count + ' 条：' + JSON.stringify(mq.sample))
  console.log('  �?这些断点�?**iframe 宽度** 求值：容器窄于断点时卡会切�?*手机分支**（另一种布局，不是缩放）�')
  console.log('     结论：不要为�?看起来合�?把容器做窄；满宽（≈890px）在多数卡上是桌面分支�')

  // ══════════════════�?A3. 口径的对照臂：把帧高冻短，判据必须红 ══════════════════�?  //
  // 为什么必须做：把"溢出"从几何包围盒换成滚动容器口径�?*有可能把判据换废** —�?  // 万一 `scrollHeight` 在这些卡上永远等�?`clientHeight`，那两条断言就变成了恒真�?  // 这一臂把父页的高度处理器停掉、帧高钉死在 300px（内容要 1080px），制�?*确定的裁�?*�?  // 滚动口径与几何口�?*�?*必须报红。它红了，上面那两条绿才有意义�?
  console.log('\n=== A3. 对照臂：冻短帧高（判据必须能红）===')
  {
    const d = rows[0]
    // �?*样式�?!important** 把帧高钉�?300px：高度处理器写的是内�?`style.height`（不�?    // !important），样式表能盖住�?�?帧永�?300px，而这张卡�?1080px �?必然裁切�?    // 这比"想办法把父页�?message 监听器摘�?稳得多（摘监听器要依赖函数名，脆）�?
  const page = readFileSync(d.file, 'utf8')
      .replace('</style>', '  iframe.muv-iframe{height:300px !important}\n</style>')
    const file2 = path.join(OUT, 'frozen-300.html')
    writeFileSync(file2, page, 'utf8')
    const before2 = rt.cdp.iframeSessions.length
    await rt.cdp.send('Page.navigate', { url: 'file:///' + file2.replace(/\\/g, '/') + '?v=' + Date.now() }, rt.pageSession)
    const t1 = Date.now()
    while (rt.cdp.iframeSessions.length === before2 && Date.now() - t1 < 15000) await sleep(100)
    const sess2 = rt.cdp.iframeSessions[rt.cdp.iframeSessions.length - 1]
    await sleep(2600)
    const m2 = await evalJson(rt.cdp, MEASURE, sess2.sessionId)
    const over2 = m2.docScroll - m2.docClient
    const body2 = m2.bodyScroll - m2.bodyClient
    console.log('  冻短后的 "' + d.script + '": 帧 ' + m2.iw + '×' + m2.ih +
      ' html 滚动溢出=' + over2 + 'px（body ' + body2 + 'px）' +
      ' 几何底边=' + m2.topBottom + ' / 文档=' + m2.docScroll)
    check('★★ 冻短帧高后 html 口径必须红（否则上面那两条是恒真）', over2 > 2, 'html 滚动溢出=' + over2 + 'px')
    // 这条把「只能信 html」这个结论钉死：真被裁时 body 口径反而报 0（冻短后 body 仍是
    // 不滚动的盒子，溢出全算到 html 头上）。哪天有人把判据改回 body 口径，这条会立刻红。
    check('★★ 冻短帧高后 body 口径**不**报溢出（实证：body 不是可靠信号，只能信 html）',
      body2 <= 1, 'body 滚动溢出=' + body2 + 'px（html ' + over2 + 'px）')
  }
} finally {
  rt.close()
}

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物: ' + OUT)
process.exit(fail ? 1 : 0)

