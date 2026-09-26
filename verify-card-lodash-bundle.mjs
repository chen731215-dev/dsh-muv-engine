// 探针：真实 MagVarUpdate bundle 端到端 —— 验证「缺 lodash 就是 MVU HUD 不出来的直接原因」
//
// 为什么要有这个文件：`verify-card-libs.mjs` 证明的是「沙箱里 `window._` 到位」。它证明
// 不了**卡脚本真的会因为它而活/死**。本探针把真 bundle（§30 实测 573,299 字节）真的 import
// 进一个真沙箱 iframe，两臂对照：
//   P（全量）= compat 垫片 + 全部库 + 错误留痕 + `<script type="module">import '<bundle>'`
//   Q（剥 lodash）= 同一份文档，**只**摘掉 lodash 三段
// 判据（两句话，都能指到具体字符串）：
//   P 臂：`window.__muvScriptErrs` 里**不许**出现 `_ is not defined`；
//   Q 臂：**必须**出现 —— 否则"lodash 是那个缺口"就是猜的。
//
// ⚠ 三重网络依赖（bundle 本体 + 它自己的二级 import + CDN 库）。离线/墙 ⇒ 两臂都会红，
//   报告里会打「网络归因」（node 侧直连同一批 URL）。
//   运行：node verify-card-lodash-bundle.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openPage, evalJson, sleep, buildFrom, readEngineSource } from './verify-shared.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = readEngineSource(HERE)
const EDGE = process.env.MUV_EDGE ||
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))

// 卡 `data.extensions.tavern_helper.scripts[0]` 的原文（§30.2 逐字取证；这里原样照抄）
const BUNDLE = 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail === undefined ? '' : '  → ' + detail)) }
}

// ── 从 client.js 逐字取真函数（与生产同一份代码，不抄） ────────────────────────
const compat = buildFrom(SRC, ['muvCardCompatScript'], {}, 'muvCardCompatScript')()
const withCardLibs = buildFrom(SRC, ['withCardLibs'], { MUV_CARD_LIBS: true }, 'withCardLibs')
const escAttr = buildFrom(SRC, ['escAttr'], {}, 'escAttr')
const scriptTags = buildFrom(SRC, ['muvCardScriptTags'], {}, 'muvCardScriptTags')([{ name: 'MVU', content: "import '" + BUNDLE + "'" }])

// 复刻 `muvInjectDoc` 的层序（compat → libs → 错误留痕 → 卡脚本），只留本探针需要的那几层。
function docFor(title, libsHtml) {
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>' + title + '</title>\n' +
    '<script data-muv-compat="__muvCompatOn">' + compat + '</' + 'script>\n' +
    libsHtml + '\n' +
    '<script>window.__probe = function () {\n' +
    '  var errs = []; try { errs = window.__muvScriptErrs || [] } catch (e) {}\n' +
    '  return JSON.stringify({\n' +
    '    title: document.title,\n' +
    '    dashFn: typeof window._, dashGet: !!(window._ && window._.get),\n' +
    '    zodObj: !!(window.z && typeof window.z.object === "function"),\n' +
    '    mvu: typeof window.Mvu, th: typeof window.TavernHelper,\n' +
    '    thVer: (window.getTavernHelperVersion ? window.getTavernHelperVersion() : null),\n' +
    '    wgi: typeof window.waitGlobalInitialized,\n' +
    '    errs: errs,\n' +
    '    ready: document.readyState\n' +
    '  });\n' +
    '};</' + 'script>\n' +
    '</head>\n<body>\n' + scriptTags + '\n</body>\n</html>\n'
}

const full = docFor('arm-full', withCardLibs('<x data-muv-x></x>').replace('<x data-muv-x></x>', ''))
const noDash = docFor('arm-no-dash',
  withCardLibs('<x data-muv-x></x>').replace('<x data-muv-x></x>', '')
    .replace(/<script data-muv-libs="dash-save">[\s\S]*?<\/script>/g, '')
    .replace(/<script data-muv-libs="lodash" src="[^"]*"><\/script>/g, '')
    .replace(/<script data-muv-libs="dash-keep">[\s\S]*?<\/script>/g, ''))

check('P 臂文档里 lodash 三段在', /data-muv-libs="lodash"/.test(full))
check('Q 臂（对照）文档里 lodash 三段被摘掉', !/lodash@/.test(noDash) && /data-muv-libs="zod"/.test(noDash))
check('两臂都注入了卡脚本 module（就是卡里那行 import）',
  full.includes("import '" + BUNDLE + "'") && noDash.includes("import '" + BUNDLE + "'"))
// ★ `withCardLibs` 的落点是 `</head>` 之前；这里用 `<x>` 占位再摘掉，是为了拿到"纯标签串"
check('★ 库标签确实落在 </head> 之前（卡脚本的 module 才能排在它们后面）',
  full.indexOf('data-muv-libs') < full.indexOf('</head>') &&
  full.indexOf('data-muv-libs') < full.indexOf('data-muv-thscript'))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-mvu-bundle-'))
const page = '<!DOCTYPE html><html><body>\n' +
  '<iframe id="f1" sandbox="allow-scripts" srcdoc="' + escAttr(full) + '"></iframe>\n' +
  '<iframe id="f2" sandbox="allow-scripts" srcdoc="' + escAttr(noDash) + '"></iframe>\n' +
  '</body></html>'
const file = path.join(tmpDir, 'bundle.html')
fs.writeFileSync(file, page, 'utf8')

const PROBE = '(window.__probe ? window.__probe() : JSON.stringify({title:document.title,missing:1}))'
const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
let netReport = ''
try {
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
  const byTitle = {}
  for (const s of sessions) {
    const o = await read(s.sessionId)
    if (o && o.title) byTitle[o.title] = { o, sid: s.sessionId }
  }
  const P = byTitle['arm-full']
  const Q = byTitle['arm-no-dash']
  check('★ 两臂都读到了探针（title 认领成功）', !!P && !!Q, Object.keys(byTitle).join(','))

  // bundle 573KB + 二级 import ⇒ 给足时间。★ 用**固定时长**而不是"错误列表稳定就退出"：
  //   P 臂本来就可能一条错都没有，靠"稳定"会在 bundle 还没开始在 1 秒后就误判成绿。
  //   两臂对称地等同样久，"Q 臂确实抛了 `_ is not defined`"本身就是"bundle 真的开始执行了"
  //   的证据 —— 有了它，P 臂的"没有这条错"才有意义（否则可能只是 bundle 压根没加载）。
  const settle = async (arm, ms) => {
    if (!arm) return null
    const t0 = Date.now()
    let v = arm.o
    while (Date.now() - t0 < ms) { v = await read(arm.sid); await sleep(500) }
    return v
  }
  const p = await settle(P, 30000)
  const q = await settle(Q, 30000)

  console.log('\n  实测 P（全量）  : ' + JSON.stringify(p))
  console.log('  实测 Q（剥 lodash）: ' + JSON.stringify(q) + '\n')

  const hasRef = (v, needle) => ((v && v.errs) || []).some((s) => String(s).indexOf(needle) >= 0)
  // ★ 先确认两臂都真的把子资源拉起来了（否则"没有 `_ is not defined`"可能只是"bundle 根本没加载"）
  check('★ P 臂的 CDN 库到位（`_` 是 function、zod 是 object）',
    !!p && p.dashFn === 'function' && p.zodObj === true, p && (p.dashFn + '/' + p.zodObj))
  check('★ P 臂的 compat 垫片到位（Mvu / TavernHelper / getTavernHelperVersion / waitGlobalInitialized）',
    !!p && p.mvu === 'object' && p.th === 'object' && p.thVer === '3.4.17' && p.wgi === 'function',
    p && [p.mvu, p.th, p.thVer, p.wgi].join('/'))
  check('★★ Q 臂（对照，只少 lodash）：**必须**出现 `_ is not defined`' +
    '（这一条同时是"bundle 真的加载并开始执行了"的证据 —— 判据不是空转）',
    !!q && hasRef(q, '_ is not defined'), q && JSON.stringify((q.errs || []).slice(0, 3)))
  check('★★ P 臂：同一份真实 bundle，lodash 到位后**没有** `_ is not defined`',
    !!p && !hasRef(p, '_ is not defined'), p && JSON.stringify((p.errs || []).slice(0, 3)))
  check('★ Q 臂的其余库确实还在（zod 在 ⇒ 不是"整篇都没生效"的假红）',
    !!q && q.zodObj === true && q.mvu === 'object', q && (q.zodObj + '/' + q.mvu))

  if (fail > 0) {
    if (q && !hasRef(q, '_ is not defined')) {
      netReport += '  [归因] Q 臂（剥 lodash）没出现 `_ is not defined` —— 多半是 bundle 本身没起来。\n' +
        '         Q 臂错误列表（前 6 条）= ' + JSON.stringify((q.errs || []).slice(0, 6)) + '\n'
    }
    try {
      const r = await fetch(BUNDLE, { method: 'GET' })
      const t = r.ok ? await r.text() : ''
      netReport += '  [归因] bundle 直连：HTTP ' + r.status + ' len=' + t.length + '\n'
    } catch (e) {
      netReport += '  [归因] bundle 直连：NET-FAIL ' + String(e && e.message).slice(0, 90) +
        ' ⇒ **网络不可达**（不是注入问题；本探针依赖真 bundle，离线时只能记「仅真机可验」）\n'
    }
  }
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

if (netReport) console.log('\n  ── 归因 ──\n' + netReport)
console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===')
process.exit(fail ? 1 : 0)
