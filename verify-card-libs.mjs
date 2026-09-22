// 门禁：卡 iframe 里的 **ST 同款前端库** 是否真的到位（真浏览器 + 真沙箱 + 真 CDN）
//
// 为什么必须开浏览器测：`test-client-render.mjs` 只能证明"字符串里出现了那几个 URL"，
// 证明不了 **①沙箱 iframe 里远程脚本真的加载得了 ②Tailwind 的类真的产生了 CSS
// ③jQuery/Vue 的全局真的挂上了**。这三条只有真浏览器能回答 —— 而它们正是
// "卡里东西出不来"那一条独立原因的全部内容（ST 的 `b1()` 无条件注入 `v1`，
// 见 ST-IFRAME-SPEC §3 / §7）。
//
// 四臂（2026-09-23 第 31 轮从两臂扩到四臂）：
//   A（libs）  = 走 `withCardLibs` ⇒ 十个库标签必须都在、Tailwind 类必须生效；
//   B（nolibs）= 同一份文档**完全不注入** ⇒ 一个都不许有；
//   C（nodash）= 注入全部、**只摘掉 lodash 三段** ⇒ `_` 必须消失（因果钉在 lodash 上）；
//   D（nozod） = 注入全部、**只摘掉 zod 那一标签** ⇒ `window.z.object` 必须不可用。
//   ★ C/D 是 A 与 B 之间那道"差着八个库"的缺口的补丁：只有它们变红，才能说
//     "`_` 是 lodash 带来的"，而不是"注入了什么库都会带来 `_`"。
//
// ⚠ 本门禁**依赖网络**（CDN 真下载）。离线时会红 —— 那是真实信号，不要改成跳过。
//   ★ 但失败时它会**再做一次 node 侧直连**把「网络不可达」与「注入缺失」分开报
//   （见文件末尾的「失败归因」段）—— 这两种红的处置完全不同，不能混成一句 FAIL。
//   运行：node verify-card-libs.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openPage, evalJson, sleep, buildFrom } from './verify-shared.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'client.js'), 'utf8')

const EDGE = process.env.MUV_EDGE ||
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail === undefined ? '' : '  → ' + detail)) }
}

// ── 从 client.js 逐字取真函数 ────────────────────────────────────────────────
const withCardLibs = buildFrom(SRC, ['withCardLibs'], { MUV_CARD_LIBS: true }, 'withCardLibs')
const escAttr = buildFrom(SRC, ['escAttr'], {}, 'escAttr')

// ── 卡文档：一边用 ST 生态里最常见的写法，一边留一个"内容还在"的记号 ──────────
//   class="w-full" / "flex" / "hidden" → Tailwind 工具类（ST 里天然有，我们没有就只是普通 div）
//   fa-solid                            → FontAwesome（图标全靠它）
//   jQuery / Vue / VueRouter 的全局      → 卡脚本第一行就用
//
// ★ Tailwind 的**判据不能用 w-full 的宽度**：块级 div 默认宽度就已经等于父宽，
//   两臂一样，判据会空转。用三个只有 Tailwind 才会给的样式：
//   `.hidden`→display:none、`.flex`→display:flex、以及 preflight 的 `body{margin:0}`。
const CARD = '<!DOCTYPE html>\n<html>\n<head>\n<title>TITLE_HERE</title>\n</head>\n<body>\n' +
  '<div id="box" class="w-full">KEEPME</div>\n' +
  '<div id="hid" class="hidden">SHOULD_BE_NONE</div>\n' +
  '<div id="fl" class="flex">FLEXBOX</div>\n' +
  '<i id="ic" class="fa-solid fa-house"></i>\n' +
  '<script>\n' +
  'window.__probe = function () {\n' +
  '  var g = function (n) { return typeof window[n] };\n' +
  '  var sheets = [];\n' +
  '  try { [].slice.call(document.styleSheets).forEach(function (s) { sheets.push(String(s.href || "")) }) } catch (e) {}\n' +
  '  var fa = false;\n' +
  '  for (var i = 0; i < sheets.length; i++) { if (sheets[i].indexOf("fontawesome") >= 0) fa = true }\n' +
  '  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : -1 };\n' +
  '  var cs = function (el, pseudo) { try { return getComputedStyle(el, pseudo || null) } catch (e) { return null } };\n' +
  '  var cBefore = cs(document.getElementById("ic"), "::before");\n' +
  '  var cHid = cs(document.getElementById("hid"));\n' +
  '  var cFl = cs(document.getElementById("fl"));\n' +
  '  var cBox = cs(document.getElementById("box"));\n' +
  '  var cBody = cs(document.body);\n' +
  '  return JSON.stringify({\n' +
  '    title: document.title,\n' +
  '    jq: g("jQuery"),\n' +
  '    jqV: (window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery) || "",\n' +
  '    jqui: !!(window.jQuery && window.jQuery.ui),\n' +
  '    vue: g("Vue"),\n' +
  '    vueApp: !!(window.Vue && window.Vue.createApp),\n' +
  '    vr: g("VueRouter"),\n' +
  '    vrCreate: !!(window.VueRouter && window.VueRouter.createRouter),\n' +
  // ── 2026-09-23（第 31 轮）新增的两项：lodash / zod ────────────────────────
  //   判据取的是**卡真正用到的方法**，不是"全局存在"：
  //   · `_`：卡里是 `_.get(stat,'账本.待结算',{})` / `_.set` ⇒ 点名要 `.get` / `.set`；
  //   · `z`：卡里是 `z.object/z.record/z.preprocess/z.coerce.string()/…prefault` ——
  //     其中 **`.prefault` 只在 zod v4 有**（v3 叫 `.default`）⇒ 它同时钉住了**版本代际**，
  //     比"typeof z === 'object'"强得多（一个 v3 的 z 也能过后者，却跑不了卡）。
  '    dashFn: g("_"),\n' +
  '    dashGet: !!(window._ && typeof window._.get === "function"),\n' +
  '    dashSet: !!(window._ && typeof window._.set === "function"),\n' +
  '    dashV: (window._ && window._.VERSION) || "",\n' +
  '    zodFn: g("z"),\n' +
  '    zodObj: !!(window.z && typeof window.z.object === "function"),\n' +
  '    zodRec: !!(window.z && typeof window.z.record === "function"),\n' +
  '    zodPre: !!(window.z && typeof window.z.preprocess === "function"),\n' +
  '    zodCoerce: !!(window.z && window.z.coerce && typeof window.z.coerce.string === "function"),\n' +
  '    zodPrefault: (function () { try { return typeof window.z.number().prefault === "function" } catch (e) { return false } })(),\n' +
  '    dashPrevLeak: Object.prototype.hasOwnProperty.call(window, "__muvDashPrev"),\n' +
  '    fa: fa,\n' +
  '    faFont: cBefore ? String(cBefore.fontFamily || "") : "",\n' +
  '    twHidden: cHid ? String(cHid.display) : "",\n' +
  '    twFlex: cFl ? String(cFl.display) : "",\n' +
  '    bodyMarg: cBody ? String(cBody.marginTop) : "",\n' +
  '    twW: cBox ? num(cBox.width) : -1,\n' +
  '    bodyW: cBody ? num(cBody.width) : -1,\n' +
  '    text: (document.body.innerText || "").indexOf("KEEPME") >= 0,\n' +
  '    ready: document.readyState\n' +
  '  });\n' +
  '};\n' +
  '<\/script>\n' +
  '</body>\n</html>'

const docs = {
  libs: withCardLibs(CARD.replace('TITLE_HERE', 'arm-libs')),
  nolibs: CARD.replace('TITLE_HERE', 'arm-nolibs'),
}
// ★ 对照臂 C/D（2026-09-23 第 31 轮新增）：从**已经注入好的** A 臂文档里，只摘掉
//   lodash 三段（C）或只摘掉 zod 那一标签（D）。为什么要有它：
//   A 臂的 "`_` 是 function" 与 "B 臂 `_` 不是 function" 之间差着**八个库**，
//   不能证明差异**就是** lodash 造成的（§24 那次差点吃过的亏）。C 臂把变量收敛到
//   "只少 lodash、其余九个标签逐字不变" ⇒ 它变红才真正把因果钉在 lodash 上。
const stripDash = (s) => s
  .replace(/<script data-muv-libs="dash-save">[\s\S]*?<\/script>/g, '')
  .replace(/<script data-muv-libs="lodash" src="[^"]*"><\/script>/g, '')
  .replace(/<script data-muv-libs="dash-keep">[\s\S]*?<\/script>/g, '')
const stripZod = (s) => s.replace(/<script type="module" data-muv-libs="zod">[\s\S]*?<\/script>/g, '')
docs.libsNoDash = stripDash(withCardLibs(CARD.replace('TITLE_HERE', 'arm-nodash')))
docs.libsNoZod = stripZod(withCardLibs(CARD.replace('TITLE_HERE', 'arm-nozod')))

check('★ A 臂文档里确实带上了十个库标签（注入生效于字符串层）',
  (docs.libs.match(/data-muv-libs=/g) || []).length === 10,
  String((docs.libs.match(/data-muv-libs=/g) || []).length))
check('★ B 臂（对照）文档里一个库都没有', !/data-muv-libs=/.test(docs.nolibs))
check('★★ C 臂：只摘掉 lodash 三段，其余九个标签原样（因果能收敛到 lodash）',
  (docs.libsNoDash.match(/data-muv-libs=/g) || []).length === 7 && !/lodash@/.test(docs.libsNoDash) &&
  /data-muv-libs="zod"/.test(docs.libsNoDash),
  String((docs.libsNoDash.match(/data-muv-libs=/g) || []).length))
check('★★ D 臂：只摘掉 zod 那一标签，其余九个原样（因果能收敛到 zod）',
  (docs.libsNoZod.match(/data-muv-libs=/g) || []).length === 9 && !/zod@/.test(docs.libsNoZod) &&
  /data-muv-libs="lodash"/.test(docs.libsNoZod),
  String((docs.libsNoZod.match(/data-muv-libs=/g) || []).length))

// ── 网络归因：把"CDN 拉不到"与"注入缺失"分开（否则两者都只报一句 FAIL）──────────
// 判据是**同一台机器**用 node 直接 GET 那两个 URL：node 也失败 ⇒ 网络问题；
// node 成功而浏览器里没有 ⇒ 注入/沙箱问题。这是用户明确要求要能区分的那件事。
async function cdnProbe(url) {
  try {
    const r = await fetch(url, { method: 'GET' })
    const t = r.ok ? await r.text() : ''
    return 'HTTP ' + r.status + ' len=' + t.length
  } catch (e) {
    return 'NET-FAIL ' + String(e && e.message).slice(0, 90)
  }
}
const CDN_LODASH = 'https://cdn.jsdelivr.net/npm/lodash@4.18.1/lodash.min.js'
const CDN_ZOD = 'https://cdn.jsdelivr.net/npm/zod@4.4.3/+esm'
let netReport = ''
async function attribute(what, ok) {
  if (ok) return
  const a = await cdnProbe(CDN_LODASH)
  const b = await cdnProbe(CDN_ZOD)
  netReport += '  [归因] ' + what + ' 在浏览器里不可用。node 侧直连：\n' +
    '         lodash → ' + a + '\n' +
    '         zod    → ' + b + '\n' +
    '         两个都 NET-FAIL ⇒ **网络不可达**（重跑一次；仍失败则是真离线，不是注入缺失）；\n' +
    '         node 能拿到而浏览器里没有 ⇒ 是**注入/沙箱**问题，看上面的 data-muv-libs 计数。\n'
}

// ── 夹具页：四个 srcdoc iframe，**沙箱与生产一致**（allow-scripts，不加 same-origin）──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-card-libs-'))
const page = '<!DOCTYPE html><html><body>\n' +
  '<iframe id="f1" sandbox="allow-scripts" srcdoc="' + escAttr(docs.libs) + '"></iframe>\n' +
  '<iframe id="f2" sandbox="allow-scripts" srcdoc="' + escAttr(docs.nolibs) + '"></iframe>\n' +
  '<iframe id="f3" sandbox="allow-scripts" srcdoc="' + escAttr(docs.libsNoDash) + '"></iframe>\n' +
  '<iframe id="f4" sandbox="allow-scripts" srcdoc="' + escAttr(docs.libsNoZod) + '"></iframe>\n' +
  '</body></html>'
const file = path.join(tmpDir, 'libs.html')
fs.writeFileSync(file, page, 'utf8')

const PROBE = '(window.__probe ? window.__probe() : JSON.stringify({title:document.title,missing:1}))'

const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
try {
  // 等四个 OOPIF 都挂上（沙箱 iframe 会被换进独立渲染进程）
  let sessions = []
  for (let i = 0; i < 100 && sessions.length < 4; i++) {
    sessions = rt.cdp.iframeSessions || []
    if (sessions.length < 4) await sleep(150)
  }
  check('★ 四个卡 iframe 都挂上了独立会话（OOPIF）', sessions.length === 4, '实际 ' + sessions.length)

  const read = async (sid) => {
    try {
      const v = await evalJson(rt.cdp, PROBE, sid)
      return typeof v === 'string' ? JSON.parse(v) : v
    } catch (e) { return { title: 'ERR', err: String(e).slice(0, 120) } }
  }
  // 按**文档自己的 title**认领（不假设 session 顺序）
  const byTitle = {}
  for (const s of sessions) {
    const o = await read(s.sessionId)
    if (o && o.title) byTitle[o.title] = { o, sid: s.sessionId }
  }
  const A = byTitle['arm-libs']
  const B = byTitle['arm-nolibs']
  const C = byTitle['arm-nodash']
  const D = byTitle['arm-nozod']
  check('★ 四臂都读到了探针（title 认领成功）', !!A && !!B && !!C && !!D, Object.keys(byTitle).join(','))

  // A 臂：等 CDN 脚本真的到（网络慢时最多等 25s）
  let a = A ? A.o : null
  if (A) {
    const t0 = Date.now()
    while (Date.now() - t0 < 25000) {
      a = await read(A.sid)
      if (a.jq === 'function' && a.vue === 'object' && a.dashFn === 'function' &&
        a.zodObj === true && String(a.ready) === 'complete') break
      await sleep(250)
    }
  }
  const b = B ? await read(B.sid) : null
  // C/D 臂：等它们**本该到位的那些**库到齐（否则断言会拿"还没加载完"当"缺失"）
  const waitFor = async (o, pred, ms) => {
    if (!o) return null
    const t0 = Date.now()
    let v = o.o
    while (Date.now() - t0 < ms) {
      v = await read(o.sid)
      if (pred(v)) break
      await sleep(250)
    }
    return v
  }
  const c = await waitFor(C, (v) => v && v.dashFn !== 'function' && v.zodObj === true && String(v.ready) === 'complete', 25000)
  const d = await waitFor(D, (v) => v && v.dashFn === 'function' && v.zodObj !== true && String(v.ready) === 'complete', 25000)

  console.log('\n  实测 A（注入全部）: ' + JSON.stringify(a))
  console.log('  实测 B（不注入）  : ' + JSON.stringify(b))
  console.log('  实测 C（只少 lodash）: ' + JSON.stringify(c))
  console.log('  实测 D（只少 zod）   : ' + JSON.stringify(d) + '\n')

  // ── A 臂：六个库都必须在位 ────────────────────────────────────────────────
  check('★★ jQuery 真的挂上了（typeof === function）', !!a && a.jq === 'function', a && a.jq)
  check('★★ jQuery-UI 挂上了（$.ui 存在）', !!a && a.jqui === true, a && String(a.jqui))
  check('★★ Vue 挂上了且能 createApp', !!a && a.vue === 'object' && a.vueApp === true, a && (a.vue + '/' + a.vueApp))
  check('★★ Vue-Router 挂上了且能 createRouter', !!a && a.vr === 'object' && a.vrCreate === true, a && (a.vr + '/' + a.vrCreate))
  check('★★ FontAwesome 样式表真的进了文档', !!a && a.fa === true, a && String(a.fa))
  check('★ FontAwesome 的 ::before 字体真的生效（图标不是靠猜）',
    !!a && /Font Awesome/i.test(String(a.faFont)), a && a.faFont)
  check('★★ Tailwind 生效① .hidden ⇒ display:none', !!a && String(a.twHidden) === 'none', a && a.twHidden)
  check('★★ Tailwind 生效② .flex ⇒ display:flex', !!a && String(a.twFlex) === 'flex', a && a.twFlex)
  check('★★ Tailwind 生效③ preflight 的 body{margin:0}',
    !!a && String(a.bodyMarg) === '0px', a && a.bodyMarg)
  check('★ w-full 的宽度等于父宽（信息项：块级元素默认也如此，不能当判据）',
    !!a && a.twW > 0 && Math.abs(a.twW - a.bodyW) <= 2, a && (a.twW + ' vs ' + a.bodyW))
  check('★ 注入库之后卡自己的内容没被破坏（KEEPME 仍在）', !!a && a.text === true, a && String(a.text))

  // ── A 臂：lodash / zod（2026-09-23 第 31 轮新增）──────────────────────────
  //   判据点名卡里**真正用到**的方法（`_.get/_.set`、`z.object/z.record/z.preprocess/
  //   z.coerce.string()/…prefault`），不是"全局存在"。其中 `.prefault` 只在 zod **v4**
  //   有 ⇒ 它同时证明版本代际对（一个 v3 的 z 也过得了 `typeof z === 'object'`）。
  check('★★ lodash 挂上了（typeof window._ === "function"）', !!a && a.dashFn === 'function', a && a.dashFn)
  check('★★ lodash 的 _.set / _.get 真的能用（卡里就是这两个在裸引用）',
    !!a && a.dashSet === true && a.dashGet === true, a && (a.dashSet + '/' + a.dashGet))
  check('★ lodash 版本号可读（4.18.1 = ST 本体那一代）',
    !!a && /^4\.18\.1$/.test(String(a.dashV)), a && String(a.dashV))
  check('★ lodash 的临时标记 __muvDashPrev 没留在 window 上（用完即删）',
    !!a && a.dashPrevLeak === false, a && String(a.dashPrevLeak))
  check('★★ zod 挂上了（window.z 可用）', !!a && a.zodObj === true, a && (a.zodFn + '/' + a.zodObj))
  check('★★ zod 的卡用得到的方法都在：object / record / preprocess / coerce.string',
    !!a && a.zodRec === true && a.zodPre === true && a.zodCoerce === true,
    a && [a.zodObj, a.zodRec, a.zodPre, a.zodCoerce].join('/'))
  check('★★ zod 是 **v4**（`.prefault` 是 v4 API，v3 叫 `.default` —— 这条钉的是版本代际）',
    !!a && a.zodPrefault === true, a && String(a.zodPrefault))

  // ── B 臂（对照）：一个都不许有 —— 没有它上面全是永真 ───────────────────────
  check('★★ 对照臂：不注入时 jQuery **不是** function（判据能红）', !!b && b.jq !== 'function', b && b.jq)
  check('★★ 对照臂：不注入时 Vue **不是** object', !!b && b.vue !== 'object', b && b.vue)
  check('★★ 对照臂：不注入时 Vue-Router **不是** object', !!b && b.vr !== 'object', b && b.vr)
  check('★★ 对照臂：不注入时没有 FontAwesome 样式表', !!b && b.fa !== true, b && String(b.fa))
  check('★★ 对照臂：不注入时 .hidden **不是** display:none', !!b && String(b.twHidden) !== 'none', b && b.twHidden)
  check('★★ 对照臂：不注入时 .flex **不是** display:flex', !!b && String(b.twFlex) !== 'flex', b && b.twFlex)
  check('★★ 对照臂：不注入时 body 仍是浏览器默认的 8px margin（Tailwind 不在场）',
    !!b && String(b.bodyMarg) !== '0px', b && b.bodyMarg)
  check('★ 对照臂：不注入时卡内容同样在（隐藏/注入都没吃掉正文）', !!b && b.text === true, b && String(b.text))
  check('★★ 对照臂：不注入时 `_` 不是 function / `z` 不是 object',
    !!b && b.dashFn !== 'function' && b.zodObj !== true, b && (b.dashFn + '/' + b.zodObj))

  // ── C/D 臂（对照）：把变量收敛到"只差一个库"，因果才钉得住 ─────────────────
  check('★★ C 臂（其余九个库照旧、**只少 lodash**）：`_` 必须不是 function ⇒ ' +
    '证明 `_` 的存在**就是** lodash 注入造成的，而不是"注入了什么库都会带来 `_`"',
    !!c && c.dashFn !== 'function', c && c.dashFn)
  check('★ C 臂的其余库确实还在（jQuery 在 ⇒ 这不是"整篇都没生效"的假红）',
    !!c && c.jq === 'function' && c.zodObj === true, c && (c.jq + '/' + c.zodObj))
  check('★★ D 臂（其余九个库照旧、**只少 zod**）：`z.object` 必须不可用',
    !!d && d.zodObj !== true, d && String(d.zodObj))
  check('★ D 臂的其余库确实还在（`_` 与 jQuery 都在）',
    !!d && d.dashFn === 'function' && d.jq === 'function', d && (d.dashFn + '/' + d.jq))

  // ── 网络归因（只在真的失败时才去打 URL）：把「CDN 拉不到」与「注入缺失」分开 ──
  await attribute('lodash（window._）', !!a && a.dashFn === 'function')
  await attribute('zod（window.z）', !!a && a.zodObj === true)
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

if (netReport) console.log('\n  ── 失败归因（node 侧直连同一批 URL）──\n' + netReport)

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===')
process.exit(fail ? 1 : 0)
