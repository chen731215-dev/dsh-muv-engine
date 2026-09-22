// 门禁：卡 iframe 里的 **ST 同款前端库** 是否真的到位（真浏览器 + 真沙箱 + 真 CDN）
//
// 为什么必须开浏览器测：`test-client-render.mjs` 只能证明"字符串里出现了那几个 URL"，
// 证明不了 **①沙箱 iframe 里远程脚本真的加载得了 ②Tailwind 的类真的产生了 CSS
// ③jQuery/Vue 的全局真的挂上了**。这三条只有真浏览器能回答 —— 而它们正是
// "卡里东西出不来"那一条独立原因的全部内容（ST 的 `b1()` 无条件注入 `v1`，
// 见 ST-IFRAME-SPEC §3 / §7）。
//
// 两臂：
//   A（libs）  = 走 `withCardLibs` ⇒ 六个库必须都在、Tailwind 类必须生效；
//   B（nolibs）= 同一份文档**不注入** ⇒ 一个都不许有（**对照臂**：没有它，A 臂的
//                "jQuery 是 function"就是永真断言，证明不了任何事）。
//
// ⚠ 本门禁**依赖网络**（CDN 真下载）。离线时会红 —— 那是真实信号，不要改成跳过。
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
check('★ A 臂文档里确实带上了六个库（注入生效于字符串层）',
  (docs.libs.match(/data-muv-libs=/g) || []).length === 6,
  String((docs.libs.match(/data-muv-libs=/g) || []).length))
check('★ B 臂（对照）文档里一个库都没有', !/data-muv-libs=/.test(docs.nolibs))

// ── 夹具页：两个 srcdoc iframe，**沙箱与生产一致**（allow-scripts，不加 same-origin）──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-card-libs-'))
const page = '<!DOCTYPE html><html><body>\n' +
  '<iframe id="f1" sandbox="allow-scripts" srcdoc="' + escAttr(docs.libs) + '"></iframe>\n' +
  '<iframe id="f2" sandbox="allow-scripts" srcdoc="' + escAttr(docs.nolibs) + '"></iframe>\n' +
  '</body></html>'
const file = path.join(tmpDir, 'libs.html')
fs.writeFileSync(file, page, 'utf8')

const PROBE = '(window.__probe ? window.__probe() : JSON.stringify({title:document.title,missing:1}))'

const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
try {
  // 等两个 OOPIF 都挂上（沙箱 iframe 会被换进独立渲染进程）
  let sessions = []
  for (let i = 0; i < 100 && sessions.length < 2; i++) {
    sessions = rt.cdp.iframeSessions || []
    if (sessions.length < 2) await sleep(150)
  }
  check('★ 两个卡 iframe 都挂上了独立会话（OOPIF）', sessions.length === 2, '实际 ' + sessions.length)

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
  check('★ 两臂都读到了探针（title 认领成功）', !!A && !!B, Object.keys(byTitle).join(','))

  // A 臂：等 CDN 脚本真的到（网络慢时最多等 25s）
  let a = A ? A.o : null
  if (A) {
    const t0 = Date.now()
    while (Date.now() - t0 < 25000) {
      a = await read(A.sid)
      if (a.jq === 'function' && a.vue === 'object' && String(a.ready) === 'complete') break
      await sleep(250)
    }
  }
  const b = B ? await read(B.sid) : null

  console.log('\n  实测 A（注入）: ' + JSON.stringify(a))
  console.log('  实测 B（对照）: ' + JSON.stringify(b) + '\n')

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
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===')
process.exit(fail ? 1 : 0)
