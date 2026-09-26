// 卡 iframe 宿主行为「对齐 SillyTavern」判定台 —— 真浏览器（Edge 无头 + CDP）实测。
//
// 这个工具回答四个问题，全部**带 before/after 对照**，判据一律取浏览器读数而不是源码字符串：
//   A. srcdoc 里有没有把 `min-height:…vh` 重写成父窗口 innerHeight（ST 的 `--TH-viewport-height`）；
//   B. 完整的那套 srcdoc reset（`box-sizing` + `html,body{margin/padding/overflow/max-width}`）
//      是否注入，缺哪条补哪条；
//   C. `iframe{display:block}`（消除 inline 基线造成的 6px 空隙）；
//   D. 宽度下限：卡窄于多少会切到**移动端分支**（是另一种布局，不是"变小"）。
//
// ⚠ 三条踩过的坑，都在代码里钉住：
//   ① 「修复前」必须**显式重置** `width:auto;min-width:auto;align-self:auto`。
//      只"不写撑满声明"会保留基线的 `width:100%` 得到**假绿**；
//   ② 宽度只在**内容自适应（flex）父容器**里量。写死宽度的测试页量不出塌陷
//      （flex 子项的 `width:auto` 按 min-content 定尺寸，iframe 的固有宽度是 300px）；
//   ③ 高度指标用**内容包围盒**，不是 `scrollHeight`（那是视口回声 / 不动点）。
//
// 运行：$env:MUV_EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"; node verify-host-parity.mjs
// 对照：$env:MUV_BEFORE_SRC="<另一份 client.js>" 可换掉「修复前」那一份（默认取 git HEAD）。

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  readEngineSource, extractFunction, sandboxOf, collectDocs, openPage, evalJson, sleep, htmlEsc,
} from './verify-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-host-parity')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

// 夹具窗口：**必须是真实尺寸**。重写后的 min-height 取的就是父窗口 innerHeight，
// 用一个 3200 高的无头窗口会得到一个不代表用户环境的巨大值。960×1080 ≈ 一台普通笔记本。
const HOST_W = 960
const HOST_H = 1080

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const row = (label, v) => console.log('  ' + label.padEnd(30) + v)
// 提前终止也必须留汇总行：没有汇总行的门禁在批处理里**看起来像"没跑"**，
// 会被当成通过（这正是当初把它标成"没有汇总行"的原因）。
const bail = (why) => {
  console.log('\n=== 断言: ' + pass + ' 通过, ' + fail + ' 失败 ===')
  console.log('!! 提前终止（未跑完，结果**不可**当通过）: ' + why)
  process.exit(1)
}

// ─────────────────────────── 两份源码：修复前 / 修复后 ───────────────────────────
const AFTER_SRC = readEngineSource()
const beforePath = process.env.MUV_BEFORE_SRC || path.join(OUT, 'client-before.js')
// ⚠ 必须用 Node 接管道，**不要**用 `git show … > file`：
//   本机是 Windows PowerShell 5.1，`>` 重定向按 UTF-16LE 写盘，中文与换行整成乱码，
//   提取器随即报「找不到函数 ×××」——而这个失败**看起来像源码问题**，会把人带到错的方向
//   （我就先怀疑了「另一个 agent 改坏了函数」，其实是自己的对照臂被写坏了）。
if (!process.env.MUV_BEFORE_SRC) {
  const head = execFileSync('git', ['show', 'HEAD:lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 28 }).toString('utf8')
  if (head.indexOf('\uFFFD') >= 0 || head.split('\n').length < 2000) {
    throw new Error('HEAD 上的 lib/client.js 取出来不是可用 UTF-8 —— 「修复前」的基准取错了')
  }
  // HEAD 就是「A/B/C 全都没做」的那个提交：它**不该**有 withCardReset。
  // 反过来写（要求 HEAD 里必须有）会把对照臂从一个真基准换成一个不存在的版本。
  if (head.indexOf('function withCardReset') >= 0) {
    throw new Error('HEAD 上已经有 withCardReset —— 基准提交选错了，对照不再是"修复前"')
  }
  writeFileSync(beforePath, head, 'utf8')
}
const BEFORE_SRC = readFileSync(beforePath, 'utf8')
check('两份源码都是可用的 UTF-8（对照臂没被 PowerShell 重定向写坏）',
  BEFORE_SRC.indexOf('\uFFFD') < 0 && BEFORE_SRC.split('\n').length > 2000,
  'FFFD=' + (BEFORE_SRC.match(/\uFFFD/g) || []).length + ' 行数=' + BEFORE_SRC.split('\n').length)
check('修复前源码里**确实没有** withCardReset（对照臂真的"修复前"）',
  BEFORE_SRC.indexOf('function withCardReset') < 0, '在 ' + beforePath + ' 里找到了 withCardReset')

console.log('=== 0. 环境 ===')
row('修复后源码', path.join(__dirname, 'lib', 'client.js') + ' (' + AFTER_SRC.length + ' 字)')
row('修复前源码', beforePath + ' (' + BEFORE_SRC.length + ' 字)')
row('夹具窗口', HOST_W + '×' + HOST_H + '（重写后的 min-height 应≈' + HOST_H + '）')
for (const f of [EDGE]) check('浏览器存在', existsSync(f), f)

const SANDBOX = sandboxOf(AFTER_SRC)
check('生产沙箱仍是 allow-scripts（没有为了排版放开同源）', SANDBOX === 'allow-scripts', SANDBOX)
check('两份源码的沙箱一致（对照不是"换了沙箱"）', sandboxOf(BEFORE_SRC) === SANDBOX)

// 真卡：用户点名的 `_足控天堂2.png`。它是唯一带「立绘」的卡。
const docs = collectDocs().filter((d) => d.card.indexOf('足控天堂') >= 0)
check('读到「_足控天堂2」的界面（防空矩阵假绿）', docs.length >= 1, '只读到 ' + docs.length + ' 份')
if (!docs.length) bail('没读到目标卡「_足控天堂2」（检查 MUV_CARD_DIR / 卡文件是否存在）')
const TARGET = docs[0]
console.log('  被测界面: ' + TARGET.card + ' / ' + TARGET.script + '  ' + TARGET.body.length + ' 字')

// ─────────────────────────── 逐字提取每个版本的真代码 ───────────────────────────
const mk = (src) => {
  const api = {}
  for (const n of ['rewriteVhMinHeight', 'withFrameHeightBootstrap', 'withCardReset', 'escAttr']) {
    try {
      // ⚠ 必须把这些函数**拼在同一个作用域里**再求值，不能逐个 `new Function`：
      //   `withCardReset` 调用的 `muvCardResetCss` 是同一层里的函数声明（靠提升可见），
      //   逐个求值时它不在作用域里，报的是 `ReferenceError: muvCardResetCss is not defined`
      //   —— 在我的 `catch` 里表现为 `api.withCardReset = null`，然后上层报
      //   「两份源码都有 withCardReset」FAIL。那个 FAIL 长得像**源码缺函数**，
      //   会把人带去查源码（我确实先去查了），实际是提取方式错了。
      let code = ''
      const seen = new Set()
      const take = (name) => {
        if (seen.has(name)) return
        seen.add(name)
        const body = extractFunction(src, name)
        code += body + '\n'
        for (const mm of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
          const id = mm[1]
          if (seen.has(id) || id === name) continue
          if (new RegExp('\\n\\s+function\\s+' + id + '\\s*\\(').test(src)) take(id)
        }
      }
      take(n)
      api[n] = new Function(code + '\nreturn ' + n)()
    } catch (e) {
      api[n] = null
      console.log('  提取 ' + n + ' 失败: ' + e.message.slice(0, 160))
    }
  }
  return api
}
const A = mk(AFTER_SRC)     // 修复后
const B = mk(BEFORE_SRC)    // 修复前

// 子文档里跑的那段挂 `data-case`，用来把 CDP 的 iframe target 对回夹具行。
// 插在 `</body>` 前，和高度引导脚本同一个注入点（顺带复用它的两条硬约束：
// 不含反引号、字符串里不出现裸的 `</script>`）。
function caseProbe(id) {
  return '<script>(function(){var id=' + JSON.stringify(id) + ';' +
    'function s(){try{document.documentElement.setAttribute("data-case",id)}catch(e){}}' +
    's();document.addEventListener("DOMContentLoaded",s);' +
    'window.addEventListener("load",function(){s();setTimeout(s,400)})})();</' + 'script>'
}

// ST 的 srcdoc reset，逐字取自 `C:\_st_spec\SPEC.md` §5.3 —— 这是**外部真值**，
// 不是我们从自己源码里抄的，所以它能当"有没有对上 ST"的判据。
const ST_RESET_RE = [
  ['box-sizing:border-box', /\*[^{]*\{[^}]*box-sizing\s*:\s*border-box/],
  ['html,body{margin:0!important}', /html\s*,\s*body\s*\{[^}]*margin\s*:\s*0\s*!important/],
  ['html,body{padding:0}', /html\s*,\s*body\s*\{[^}]*padding\s*:\s*0/],
  ['html,body{overflow:*:hidden!important}', /html\s*,\s*body\s*\{[^}]*overflow[^;:]*\s*:\s*hidden\s*!important/],
  ['html,body{max-width:100%!important}', /html\s*,\s*body\s*\{[^}]*max-width\s*:\s*100%\s*!important/],
]

/** 建一个 iframe 标签：只有 `useReset` 一个变量（其余属性与生产一致）。 */
function buildFrame(api, body, useReset, caseId) {
  let html = api.rewriteVhMinHeight(body)
  if (useReset) html = api.withCardReset(html)
  html = api.withFrameHeightBootstrap(html)
  const close = html.toLowerCase().lastIndexOf('</body>')
  html = close < 0 ? html + caseProbe(caseId) : html.slice(0, close) + caseProbe(caseId) + html.slice(close)
  return '<iframe class="muv-iframe" srcdoc="' + api.escAttr(html) + '" sandbox="' + SANDBOX +
    '" style="display:block;width:100%;height:900px;border:none;border-radius:8px;background:transparent"></iframe>'
}

// 承载容器的规则：逐字取生产源码，再按「显式重置」造修复前对照。
const wrapRuleNew = (() => {
  const m = /\.muv-statusbar-wrap\{[^}]*\}/.exec(AFTER_SRC)
  if (!m) throw new Error('源码里找不到 .muv-statusbar-wrap 规则')
  return m[0]
})()
const WRAP_DECLS = ['display:block', 'width:100%', 'min-width:0', 'align-self:stretch', 'box-sizing:border-box']
const wrapRuleOld = (() => {
  let s = wrapRuleNew
  for (const d of WRAP_DECLS) {
    s = s.replace(new RegExp('(^|[{;])\\s*' + d.split(':')[0] + '\\s*:[^;}]*', 'g'), '$1')
  }
  return s.replace(/;+/g, ';').replace(/\{;/, '{').replace(/;\}/, '}')
})()
// ★ 显式重置（不是"少写几条声明"）：CSS 里删掉一条声明**不会**抵消基类里同名的声明。
const RESET_EXPLICIT = 'width:auto;min-width:auto;align-self:auto;box-sizing:content-box'

const hasReset = !!A.withCardReset && !!B.withCardReset
check('两份源码都有 withCardReset（B 的注入点已经在源码里）', hasReset)
if (!hasReset) bail('两份源码里缺少 withCardReset，B 对照臂做不出来')

// ─────────────────────────── 夹具页 ───────────────────────────
// 聊天列 940px 内容宽 + 40px 头像兄弟 ⇒ 卡 iframe 实际可用宽 ≈ 892px（和 DSH 现状同量级）。
// `.col` 用 content-box：`clientWidth - padding` 才是内容宽，量出来不会被 padding 骗到。
const NARROW_W = 460   // 用来触发卡自己的 `@media (max-width:600px)` 移动端分支

const CASES = [
  {
    id: 'A_before', label: 'A 修复前（vh 未重写 + 无 reset + wrapper 撑满声明已剥）',
    wrap: 'old', inner: buildFrame(B, TARGET.body, false, 'A_before'),
  },
  {
    id: 'A_after', label: 'A 修复后（vh 重写 + reset + wrapper 撑满）',
    wrap: 'new', inner: buildFrame(A, TARGET.body, true, 'A_after'),
  },
  {
    id: 'B_noreset', label: 'B 对照：只缺 reset（vh 重写 + wrapper 撑满）',
    wrap: 'new', inner: buildFrame(A, TARGET.body, false, 'B_noreset'),
  },
  {
    id: 'C_before', label: 'C 修复前：iframe 是 inline（基线空隙）',
    wrap: 'new', inlineFrame: true, inner: buildFrame(A, TARGET.body, true, 'C_before'),
  },
  {
    id: 'D_narrow', label: 'D 窄容器（' + NARROW_W + 'px）：卡切移动端分支',
    wrap: 'new', width: NARROW_W, inner: buildFrame(A, TARGET.body, true, 'D_narrow'),
  },
]

const styleFor = (c) => {
  let s = c.wrap === 'old' ? wrapRuleOld : wrapRuleNew
  if (c.inlineFrame) s += '.muv-iframe{display:inline;vertical-align:baseline}'
  if (c.width) s += '[data-case="' + c.id + '"] .muv-statusbar-wrap{width:' + c.width + 'px;min-width:0;align-self:auto}'
  if (c.wrap === 'old') s += '[data-case="' + c.id + '"] .muv-statusbar-wrap{' + RESET_EXPLICIT + '}'
  return s
}

const HOST = [
  '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>host-parity</title>',
  '<style>',
  'html,body{margin:0;padding:0;background:#fff;color:#111;font:13px/1.5 sans-serif}',
  '.col{width:940px;box-sizing:content-box;border:1px dashed #c9ced6;padding:8px;margin:0 0 18px}',
  '.row{display:flex;gap:8px;align-items:flex-start}',
  '.avatar{flex:0 0 40px;width:40px;height:40px;background:#ddd;border-radius:6px}',
  '.cap{font:12px monospace;color:#667;margin:0 0 4px}',
  wrapRuleNew,
  '.muv-iframe{display:block;width:100%}',
  '</style></head><body>',
  CASES.map((c) => '<div data-case-wrap="' + c.id + '"><div class="cap">' + htmlEsc(c.label) + '</div>' +
    '<div class="col"><div class="row"><div class="avatar"></div><div class="muv-statusbar-wrap">' + c.inner + '</div></div></div>' +
    '<style>' + styleFor(c) + '</style></div>').join('\n'),
  '</body></html>',
].join('\n')

const file = path.join(OUT, 'host-parity.html')
writeFileSync(file, HOST, 'utf8')
console.log('\n  夹具: ' + file)

// ─────────────────────────── 探针 ───────────────────────────
// 夹具页里跑：量 iframe 元素本身 + 直接读 iframe 文档头（`contentDocument` 为空说明被换进了
// 独立渲染进程，那种行由 CDP 子会话探针补上）。两条路都留着，避免"没量到"被当成"通过了"。
const HOST_PROBE = `JSON.stringify((function(){
  var out = [];
  var rows = document.querySelectorAll('[data-case-wrap]');
  for (var i = 0; i < rows.length; i++) {
    var w = rows[i];
    var ifr = w.querySelector('iframe.muv-iframe');
    var wrap = w.querySelector('.muv-statusbar-wrap');
    var row = { id: w.getAttribute('data-case-wrap'),
      iframeW: ifr ? Math.round(ifr.getBoundingClientRect().width) : -1,
      iframeH: ifr ? Math.round(ifr.getBoundingClientRect().height) : -1,
      wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : -1,
      rowH: Math.round(w.querySelector('.row').getBoundingClientRect().height),
      cssDisplay: ifr ? getComputedStyle(ifr).display : '',
      cssMinWidth: ifr ? getComputedStyle(ifr).minWidth : '',
      ownScrollbar: ifr ? (ifr.scrollHeight > ifr.clientHeight + 1) : false,
      fromHost: null };
    try {
      var d = ifr.contentDocument;
      if (d && d.documentElement) {
        row.fromHost = probeDoc(d);
      }
    } catch (e) { row.fromHostErr = String(e && e.message); }
    out.push(row);
  }
  function probeDoc(d) {
    var de = d.documentElement, b = d.body;
    if (!b) return null;
    var all = b.getElementsByTagName('*'), maxB = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs2; try { cs2 = d.defaultView.getComputedStyle(el); } catch (_) { continue; }
      if (cs2.position === 'fixed' || cs2.position === 'sticky') continue;
      if (cs2.display === 'none' || cs2.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;
      var bot = r.top + (d.defaultView.scrollY || 0) + Math.max(r.height, el.scrollHeight || 0);
      if (bot > maxB) maxB = bot;
    }
    var app = d.getElementById('app');
    var acs = app ? d.defaultView.getComputedStyle(app) : null;
    return {
      innerW: d.defaultView.innerWidth, innerH: d.defaultView.innerHeight,
      caseAttr: de.getAttribute('data-case'),
      appMinH: acs ? acs.minHeight : '',
      bodyMinH: d.defaultView.getComputedStyle(b).minHeight,
      htmlMinH: d.defaultView.getComputedStyle(de).minHeight,
      contentBottom: Math.ceil(maxB),
      docScrollH: de.scrollHeight, docClientH: de.clientHeight,
      bodyMargin: d.defaultView.getComputedStyle(b).marginTop + '/' +
        d.defaultView.getComputedStyle(b).marginLeft,
      overflowX: d.defaultView.getComputedStyle(de).overflowX,
      overflowY: d.defaultView.getComputedStyle(de).overflowY,
      maxWidth: d.defaultView.getComputedStyle(de).maxWidth,
      boxSizing: d.defaultView.getComputedStyle(b).boxSizing,
      boxSizingApp: acs ? acs.boxSizing : '',
      hasReset: !!d.querySelector('style[data-muv-reset]'),
      hasViewportVar: d.defaultView.getComputedStyle(de).getPropertyValue('--TH-viewport-height').trim(),
      mq600: d.defaultView.matchMedia('(max-width:600px)').matches,
      mq1024: d.defaultView.matchMedia('(max-width:1024px)').matches,
    };
  }
  return out;
})())`

const IF_PROBE = `JSON.stringify((function(){
  var de = document.documentElement, b = document.body;
  function extent() {
    var all = b.getElementsByTagName('*'), maxB = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs2; try { cs2 = getComputedStyle(el); } catch (_) { continue; }
      if (cs2.position === 'fixed' || cs2.position === 'sticky') continue;
      if (cs2.display === 'none' || cs2.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;
      var bot = r.top + (window.scrollY || 0) + Math.max(r.height, el.scrollHeight || 0);
      if (bot > maxB) maxB = bot;
    }
    return Math.ceil(maxB);
  }
  var app = document.getElementById('app');
  var acs = app ? getComputedStyle(app) : null;
  return { caseAttr: de.getAttribute('data-case'),
    innerW: innerWidth, innerH: innerHeight,
    appMinH: acs ? acs.minHeight : '', bodyMinH: getComputedStyle(b).minHeight,
    htmlMinH: getComputedStyle(de).minHeight,
    contentBottom: extent(), docScrollH: de.scrollHeight, docClientH: de.clientHeight,
    bodyMargin: getComputedStyle(b).marginTop + '/' + getComputedStyle(b).marginLeft,
    overflowX: getComputedStyle(de).overflowX, overflowY: getComputedStyle(de).overflowY,
    maxWidth: getComputedStyle(de).maxWidth, boxSizing: getComputedStyle(b).boxSizing,
    hasReset: !!document.querySelector('style[data-muv-reset]'),
    hasViewportVar: getComputedStyle(de).getPropertyValue('--TH-viewport-height').trim(),
    mq600: matchMedia('(max-width:600px)').matches, mq1024: matchMedia('(max-width:1024px)').matches };
})())`

// ─────────────────────────── 跑 ───────────────────────────
const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: OUT, windowSize: HOST_W + ',' + HOST_H })
const out = []
let parentVp = { w: 0, h: 0 }
try {
  await sleep(4500)
  parentVp = await evalJson(rt.cdp, 'JSON.stringify({w: innerWidth, h: innerHeight})', rt.pageSession)
  console.log('  父窗口真实视口 = ' + parentVp.w + '×' + parentVp.h + '（重写出来的 min-height 应当≈这个高）')
  check('夹具窗口是真实尺寸（高 < 1400）—— 否则重写值不代表用户环境', parentVp.h < 1400, 'ih=' + parentVp.h)
  const hostRows = await evalJson(rt.cdp, HOST_PROBE, rt.pageSession)

  // 子会话探针（沙箱 iframe 常被换进独立渲染进程）
  const byCase = new Map()
  for (const s of rt.cdp.iframeSessions) {
    let m = null
    try { m = await evalJson(rt.cdp, IF_PROBE, s.sessionId) } catch (_) { continue }
    if (m && m.caseAttr) byCase.set(m.caseAttr, m)
  }
  row('父页探针行数', String(hostRows.length))
  row('能直接读到的子文档', String(hostRows.filter((r) => r.fromHost).length))
  row('CDP 子会话命中', [...byCase.keys()].join(', ') || '（无）')
  check('CDP 子会话覆盖全部夹具行（沙箱 iframe 真的被观测到了）',
    CASES.every((c) => byCase.has(c.id)), '命中 ' + [...byCase.keys()].join(','))

  for (const c of CASES) {
    const h = hostRows.find((r) => r.id === c.id) || {}
    const sub = byCase.get(c.id) || h.fromHost || {}
    out.push({ case: c.id, label: c.label, host: h, sub })
  }
} finally {
  rt.close()
}

// ─────────────────────────── 报告 ───────────────────────────
const fmt = (v, w) => String(v).padStart(w)
console.log('\n=== 1. 实测数字（父容器 = 内容自适应 flex：940px 聊天列 + 40px 头像）===')
console.log('  ' + '行'.padEnd(11) + '帧宽    帧高    内容包围盒  文档高  帧内innerW  帧内innerH  #app min-height  reset  --TH-vh  100vh?  mq600  元素高')
for (const r of out) {
  const s = r.sub
  const stillVh = /vh|dvh|svh|lvh/i.test(String(s.appMinH || '')) || /vh|dvh|svh|lvh/i.test(String(s.bodyMinH || ''))
  console.log('  ' + r.case.padEnd(11) +
    fmt(r.host.iframeW, 5) + '  ' + fmt(r.host.iframeH, 6) + '  ' +
    fmt(s.contentBottom, 10) + '  ' + fmt(s.docScrollH, 6) + '  ' +
    fmt(s.innerW, 10) + '  ' + fmt(s.innerH, 10) + '  ' +
    fmt(s.appMinH || s.bodyMinH, 15) + '  ' +
    fmt(s.hasReset ? 'yes' : 'NO', 5) + '  ' +
    fmt(s.hasViewportVar || '-', 8) + '  ' +
    fmt(stillVh ? 'YES' : 'no', 6) + '  ' +
    fmt(s.mq600 ? 'match' : '-', 6) + '  ' +
    fmt(r.host.rowH, 6))
}

const g = (id) => out.find((r) => r.case === id) || { host: {}, sub: {} }
const [A0, A1, B0, C0, D0] = [g('A_before'), g('A_after'), g('B_noreset'), g('C_before'), g('D_narrow')]

// ── A ──
console.log('\n=== 2. A：min-height:…vh 重写（对齐 ST 的 --TH-viewport-height）===')
row('修复前 #app min-height', String(A0.sub.appMinH || '(未读到)'))
row('修复后 #app min-height', String(A1.sub.appMinH || '(未读到)'))
row('父窗口 innerHeight（重写的取值来源）', parentVp.h + '（夹具窗口声明 ' + HOST_W + '×' + HOST_H + '，chrome 占掉一部分）')
check('A1 修复前：min-height 仍是 vh 单位（循环定义的证据）',
  /vh|dvh|svh|lvh/i.test(String(A0.sub.appMinH || '')) || /vh|dvh|svh|lvh/i.test(String(A0.sub.bodyMinH || '')),
  'app=' + A0.sub.appMinH + ' body=' + A0.sub.bodyMinH)
check('A2 修复后：#app 的 min-height 变成固定 px',
  /px/.test(String(A1.sub.appMinH || '')), String(A1.sub.appMinH))
check('A3 重写取的是**父窗口** innerHeight（' + parentVp.h + ' ± 30px），不是 iframe 自己的高',
  (() => {
    const v = parseFloat(String(A1.sub.appMinH || '').replace('px', ''))
    return isFinite(v) && Math.abs(v - parentVp.h) <= 30
  })(), 'app min-height=' + A1.sub.appMinH + ' 父 innerHeight=' + parentVp.h + ' 帧高=' + A1.host.iframeH)
check('A4 修复前的内容包围盒明显偏矮（循环定义把卡压回去了）',
  A0.sub.contentBottom > 0 && A0.sub.contentBottom < A1.sub.contentBottom - 100,
  'before=' + A0.sub.contentBottom + ' after=' + A1.sub.contentBottom)
check('A5 修复后：内容包围盒 == 帧高（±8px），无内部滚动条',
  Math.abs(A1.host.iframeH - A1.sub.contentBottom) <= 8 && !A1.host.ownScrollbar,
  'h=' + A1.host.iframeH + ' box=' + A1.sub.contentBottom + ' ownScrollbar=' + A1.host.ownScrollbar)

// ── B ──
console.log('\n=== 3. B：srcdoc reset（逐条比对 ST 原文）===')
const probeB = (() => {
  const html = A.withCardReset('<html><head><title>t</title></head><body>x</body></html>', HOST_H)
  return html
})()
for (const [label, re] of ST_RESET_RE) {
  check('B reset 含 ' + label, re.test(probeB), probeB.slice(0, 300))
}
check('B reset 在 <head> 之后、卡的任何样式之前', probeB.indexOf('<style data-muv-reset') > probeB.indexOf('<head>') &&
  probeB.indexOf('<style data-muv-reset') < probeB.indexOf('<title>'), probeB.slice(0, 240))
row('B 修复前 hasReset', String(A0.sub.hasReset))
row('B 修复后 hasReset', String(A1.sub.hasReset))
check('B1 修复前：iframe 里**没有** reset 样式表', A0.sub.hasReset === false)
check('B2 修复后：iframe 里有 reset 样式表', A1.sub.hasReset === true)
row('B 修复前 body margin', String(A0.sub.bodyMargin))
row('B 修复后 body margin', String(A1.sub.bodyMargin))
check('B3 reset 真的生效：body margin 从 8px 变成 0', String(A1.sub.bodyMargin) === '0px/0px', A1.sub.bodyMargin)
check('B4 reset 真的生效：body box-sizing=border-box', A1.sub.boxSizing === 'border-box', A1.sub.boxSizing)
check('B5 reset 真的生效：html max-width=100%', String(A1.sub.maxWidth) === '100%', A1.sub.maxWidth)
row('B 对照（只缺 reset）内容包围盒', String(B0.sub.contentBottom) + '  文档高=' + B0.sub.docScrollH + ' 帧高=' + B0.host.iframeH)
check('B6 对照不敏感也会红：缺 reset 时 body margin 不是 0（判据不是常量）',
  String(B0.sub.bodyMargin) !== '0px/0px' && String(B0.sub.bodyMargin) !== 'undefined/undefined',
  'noreset bodyMargin=' + B0.sub.bodyMargin)

// ── C ──
console.log('\n=== 4. C：iframe{display:block}（inline 基线空隙）===')
const frames = collectDocs().length
row('C 修复前 iframe display', String(C0.host.cssDisplay))
row('C 修复后 iframe display', String(A1.host.cssDisplay))
row('C 修复前 .row 高 − 帧高', String(C0.host.rowH - C0.host.iframeH))
row('C 修复后 .row 高 − 帧高', String(A1.host.rowH - A1.host.iframeH))
check('C1 修复后 iframe 是 display:block', A1.host.cssDisplay === 'block', A1.host.cssDisplay)
check('C2 对照（inline）确实多出基线空隙（≥4px）', (C0.host.rowH - C0.host.iframeH) >= 4,
  'gap=' + (C0.host.rowH - C0.host.iframeH))
check('C3 修复后空隙被消掉（≤1px）', Math.abs(A1.host.rowH - A1.host.iframeH) <= 1,
  'gap=' + (A1.host.rowH - A1.host.iframeH))

// ── D ──
console.log('\n=== 5. D：宽度下限 / 移动端分支 ===')
row('D 窄容器宽', String(D0.host.wrapW))
row('D 窄容器帧内 innerW', String(D0.sub.innerW))
row('D 窄容器内卡是否切移动端分支', 'mq600=' + D0.sub.mq600 + ' mq1024=' + D0.sub.mq1024)
row('A 修复后帧内 innerW（满宽）', String(A1.sub.innerW))
row('B_mq600 满宽行', String(A1.sub.mq600))
check('D1 满宽（' + A1.sub.innerW + 'px）不触发卡自己的 600px 断点', A1.sub.mq600 === false)
check('D2 窄容器（' + D0.sub.innerW + 'px）**确实**触发 600px 移动端分支（判据不是常量）', D0.sub.mq600 === true,
  'innerW=' + D0.sub.innerW)
check('D3 断点按 **iframe 自己的宽**求值（innerW == 帧宽 ±2）',
  Math.abs(D0.sub.innerW - D0.host.iframeW) <= 2, 'innerW=' + D0.sub.innerW + ' frameW=' + D0.host.iframeW)
row('D 窄容器帧高', String(D0.host.iframeH) + '  内容包围盒=' + String(D0.sub.contentBottom))
check('D4 移动端分支的内容包围盒与桌面分支不同（是**另一套布局**，不是缩放）',
  Math.abs((D0.sub.contentBottom || 0) - (A1.sub.contentBottom || 0)) > 20,
  'narrow=' + D0.sub.contentBottom + ' wide=' + A1.sub.contentBottom)
check('D5 我们**没有**给 iframe 设 min-width（ST 是 0；设了会让窄容器横向溢出）',
  A1.host.cssMinWidth === '0px' || A1.host.cssMinWidth === 'auto', A1.host.cssMinWidth)

// ── 宽度塌陷（陷阱 ② 的守卫）──
console.log('\n=== 6. 内容自适应（flex）父容器里的宽度（陷阱守卫）===')
row('A 修复前 wrap 宽 / 帧宽', A0.host.wrapW + ' / ' + A0.host.iframeW)
row('A 修复后 wrap 宽 / 帧宽', A1.host.wrapW + ' / ' + A1.host.iframeW)
row('父容器内容宽（940 − 40 头像 − 8 gap）', '892')
check('W1 修复前在 flex 容器里**确实塌**（不是满宽）—— 判据能红',
  A0.host.iframeW < 500, 'before frameW=' + A0.host.iframeW)
check('W2 修复后帧宽撑满（892 ± 4）', Math.abs(A1.host.iframeW - 892) <= 4, 'after frameW=' + A1.host.iframeW)

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物: ' + file)
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2), 'utf8')
console.log('读数: ' + path.join(OUT, 'report.json'))
process.exit(fail ? 1 : 0)
