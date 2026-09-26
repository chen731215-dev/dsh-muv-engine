// 「ERA 事件应答桥」的**真浏览器门禁** —— 判定卡 `_足控天堂2.png` 的《ERA 状态栏》脚本
// 能不能从宿主拿到变量、状态栏数值到底有没有从"空的"变成"有数的"。
//
// 为什么必须跑真卡 + 真浏览器（三条都是踩出来的）：
//   ① **必须跑对脚本。** 这张卡里 10 份正则脚本，《主页》和《ERA 状态栏》都是整页文档，
//      而 CG / era / eventEmit / data-era 的代码**全在《ERA 状态栏》里**（210,219 字符；
//      《主页》只有 57,618）。按《主页》跑，所有断言量到的都是 `undefined` —— 看起来"全绿"，
//      其实什么也没测到。所以下面把**脚本名与字符数当硬断言**，跑错脚本会当场红。
//   ② **沙箱必须与产品一致。** `MUV_CARD_SANDBOX = 'allow-scripts'`（不透明来源）是**有意**的
//      安全决策。门禁里**绝不能**为了变绿而加 `allow-same-origin` —— 有一条专门的反向断言
//      盯着 `window.parent.document` 必须仍被拒。
//   ③ **桥必须只有一个触发点。** 宿主 → 卡的应答只由卡的 `eventEmit`（垫片转发成
//      `__muvEventOut`）触发；`__muvHello` 只预热数据、不推事件。这样 before/after 才能把
//      桥**单独**关掉：`nobridge` 臂只改一个记号（`__muvEventOut` → `__muvEventOutOff`），
//      其余逐字相同 —— 它就是"没有应答桥"的对照组。
//
// before/after 三臂：
//   after    现盘 `lib/client.js`                                        → 必须**全绿**
//   nobridge 现盘源码，只把垫片上报的记号改名（桥整段落空）                    → `era:queryResult` 必须**收不到**
//   before   `324b751:lib/client.js`（兼容层之前，卡里连长啥都没有）           → `era:queryResult` 必须**收不到**
// 没有对照组就只能证明"现在没报错"，证明不了桥有用。
//
// 数据源：`/api/muv-table/tavern-card`（**只读**，本次不改 muv-table）。
//   ★ 夹具页从 `file://` 载入，跨源 `fetch` 会被 CORS 挡掉（DSH 不回 CORS 头），所以夹具里
//     的 `fetch` 是**桩**；但桩返回的 payload 是 Node 侧**从活着的 muv-table 抓回来的那一份**
//     （原样，不加工），不是编的。抓不到数据源就当场红。
//
// 运行（Windows PowerShell 5.1，没有 pwsh）：
//   $env:MUV_EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
//   node verify-era-bridge.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'
import { openPage, sleep, fenceBodyOf, looksLikeDoc, extractFunction, moduleVarStatements, DEFAULT_CARD_DIR } from './verify-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-era-bridge')
mkdirSync(OUT, { recursive: true })

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CARD_DIR = process.env.MUV_CARD_DIR || DEFAULT_CARD_DIR
const CARD_FILE = process.env.MUV_CARD_FILE || '_足控天堂2.png'
/** ★ 必须带 CG/era/eventEmit/data-era 的那一份。按《主页》跑量到的全是 undefined。 */
const CARD_SCRIPT = process.env.MUV_CARD_SCRIPT || 'ERA 状态栏'
const CARD_SCRIPT_LEN = 210219
/** ★ 对照臂基准：`324b751` 已随 §26.2 git 事故丢失 —— 与 verify-card-compat（§27.4）同一处置，改 `7623ffa`（现存最老 v0.3.9，无垫片），可 `MUV_OLD_REV` 覆盖。 */
const OLD_REV = process.env.MUV_OLD_REV || '7623ffa'
const DSH_API = process.env.MUV_DSH_API || 'http://127.0.0.1:3080'
/** 夹具用的假会话 id：`currentSessionId()` 的第三条分支（`data-dsh-current-session`）会读它。 */
const FAKE_SESSION = 'session-11111111-2222-3333-4444-555555555555'
/** 命中的变量路径（值必须来自真 payload，用来钉"数据到底从哪来"）。 */
const PROBE_PATH = '世界信息.时间.日期'

const argv = process.argv.slice(2)
const OPTS = {
  json: process.env.MUV_ERA_JSON || path.join(OUT, 'era-bridge-report.json'),
}

function makeChecks() {
  const rows = []
  return {
    rows,
    check(name, ok, detail) {
      rows.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
      console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail === undefined ? '' : '  -> ' + String(detail)))
    },
  }
}

// ─────────────────────── 宿主运行时的**逐字**提取 ───────────────────────

/**
 * 从一份 `client.js` 源码里造出**浏览器里可跑的宿主运行时源码**（字符串，供内联进夹具页）。
 *
 * 与 `verify-shared.buildFrom` 同一套提取器、同一套依赖闭包，区别只在这里返回**源码文本**
 * 而不是求值后的函数：夹具页需要的是"页面上真的加载了这份代码"。
 * 名字逐个 `try`：旧源码里没有的函数**跳过**而不是抛 —— 否则 before 臂报的是"测试崩了"，
 * 而不是"行为不同"。
 */
function hostRuntimeSource(src, roots) {
  const have = new Set()
  const queue = [...roots]
  let body = ''
  while (queue.length) {
    const n = queue.shift()
    if (have.has(n)) continue
    have.add(n)
    let text
    try { text = extractFunction(src, n) } catch (_) { continue }
    body += text + '\n'
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[1]
      if (have.has(id)) continue
      if (new RegExp('\\n[ \\t]+function\\s+' + id + '\\s*\\(').test(src)) queue.push(id)
    }
  }
  const pool = moduleVarStatements(src)
  const need = new Set()
  for (let round = 0; round < 8; round++) {
    let changed = false
    for (const k of Object.keys(pool)) {
      if (need.has(k) || have.has(k)) continue
      if (!new RegExp('\\b' + k + '\\b').test(body)) continue
      need.add(k)
      changed = true
    }
    if (!changed) break
  }
  return {
    header: [...need].map((k) => pool[k]).join('\n'),
    body,
    extracted: [...have],
  }
}

const HOST_ROOTS = [
  'cardHtmlIframe', 'withCardCompat', 'muvCardCompatScript', 'muvCardCompatSeed',
  'onMuvCardCompatMessage', 'ensureCardCompatListener', 'muvReplyToFrame',
  'muvEraAnswer', 'muvEraPrewarm', 'muvEraLocator',
]

function fixturePage(rt, envelope, label) {
  // 内联 JSON 里的 `<` 一律转义：payload 是不可信输入，出现 `</script` 会当场把夹具脚本截断。
  const env = JSON.stringify(envelope).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>era-bridge-fixture</title>
<style>html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:13px/1.5 sans-serif}
.cap{font:12px monospace;color:#8b93a1;padding:8px}iframe{display:block}</style>
</head><body>
<div class="cap">${label}</div>
<div id="host"></div>
<script>/* 宿主运行时：逐字取自 client.js */</script>
<script>document.documentElement.setAttribute('data-dsh-current-session', ${JSON.stringify(FAKE_SESSION)});
try { localStorage.setItem('__muvHostProbe', '1') } catch (e) {}</script>
<script>window.__payload = ${env};window.__fetchUrls = [];
window.fetch = function (u) { window.__fetchUrls.push(String(u)); return Promise.resolve({ json: function () { return Promise.resolve(window.__payload) } }) };</script>
<script>${rt.header}</script>
<script>${rt.body.replace(/<\/script/gi, '<\\/script')}</script>
<script>window.__host = {
  extracted: ${JSON.stringify(rt.extracted)},
  spawn: function (raw) {
    var box = document.createElement('div');
    box.innerHTML = cardHtmlIframe(raw);
    var f = box.firstChild;
    document.body.appendChild(f);
    return f;
  },
  install: function () { if (typeof ensureCardCompatListener === 'function') ensureCardCompatListener(); },
  locator: function () { return (typeof muvEraLocator === 'function') ? muvEraLocator() : null },
  sandboxOf: function () { return (typeof MUV_CARD_SANDBOX === 'string') ? MUV_CARD_SANDBOX : null },
  shim: function () { return (typeof muvCardCompatScript === 'function') ? muvCardCompatScript() : null }
};</script>
</body></html>`
}

async function pageEval(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    return { err: (d.exception && d.exception.description) || d.text || 'exception' }
  }
  return { value: r.result && r.result.result && r.result.result.value }
}

const jparse = (v, def) => { try { return typeof v === 'string' ? JSON.parse(v) : (v == null ? def : v) } catch (_) { return def } }

/**
 * 把一段「卡内代码」包成 `JSON.stringify` 的表达式。
 * 为什么要有这两个小工具：手写 `(function(){…})()` 时少了**函数体那个闭合花括号**，
 * CDP 报回来的是 `SyntaxError: Unexpected token ')'` —— 看起来像卡坏了，其实是门禁自己写错，
 * 很容易查错方向（踩过一次）。统一从这两个函数生成表达式，就不会再少。
 */
const EV = (body) => 'JSON.stringify((function(){' + body + '})())'
const EVT = (body) => EV('try{' + body + '}catch(e){return {err:String((e&&e.name)||e)+":"+String((e&&e.message)||"").slice(0,140)}}')

async function until(cdp, sid, expr, ms = 6000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) { last = await pageEval(cdp, sid, expr); if (last.value === true) return true; await sleep(100) }
  return last
}

// ─────────────────────────────── 单臂 ───────────────────────────────

async function runArm(arm, PAYLOAD, ENVELOPE) {
  console.log('\n=== 臂: ' + arm.label + '  (' + path.basename(arm.srcPath) + ') ===')
  const c = makeChecks()
  const report = { arm: arm.label, src: arm.srcPath, checks: c.rows, extracted: [], frames: {} }

  const rt = hostRuntimeSource(arm.source, HOST_ROOTS)
  report.extracted = rt.extracted

  const { cdp, pageSession, browserVersion, close } = await openPage(EDGE, { url: 'about:blank' })
  const sessions = []
  cdp.on('Target.attachedToTarget', (p) => {
    if (p.targetInfo.type === 'iframe') sessions.push({ targetId: p.targetInfo.targetId, sessionId: p.sessionId, url: p.targetInfo.url })
  })
  try {
    report.browser = browserVersion
    const fixture = path.join(OUT, 'era-bridge-' + arm.label + '.html')
    writeFileSync(fixture, fixturePage(rt, ENVELOPE, 'era-bridge · ' + arm.label), 'utf8')
    await cdp.send('Page.navigate', { url: 'file:///' + fixture.replace(/\\/g, '/') + '?v=' + Date.now() }, pageSession)
    await sleep(400)

    // ── 前置断言：提取器真拿到了链上那几个函数（否则后面量到的是空气） ──
    const srcOwnShim = rt.extracted.indexOf('muvCardCompatScript') >= 0
    c.check('前置：宿主侧 ERA 桥的函数被逐字提取到',
      ['onMuvCardCompatMessage', 'muvEraAnswer'].every((n) => rt.extracted.indexOf(n) >= 0),
      '已提取: ' + rt.extracted.join(', '))

    if (srcOwnShim) {
      const shim = jparse((await pageEval(cdp, pageSession, 'JSON.stringify({s:window.__host.shim()})')).value, {})
      const s = String(shim.s || '')
      c.check('★ 垫片产物里**不含反引号**（内联脚本是单引号拼出来的）', s.indexOf('`') < 0, 'len=' + s.length)
      c.check('★ 垫片产物里**不含裸的 `</script>`**（收尾标签必须拼）', s.indexOf('</script') < 0, '命中=' + (s.indexOf('</script') >= 0))
      c.check('★ 垫片确实是"卡内派发 + 上报宿主"两件事（有 fire 也有 __muvEventOut）',
        s.indexOf('function fire(') >= 0 && s.indexOf('__muvEventOut') >= 0, 'fire=' + (s.indexOf('function fire(') >= 0) + ' out=' + (s.indexOf('__muvEventOut') >= 0))
      c.check('★ 入站事件走 fire（防环）：没有把宿主回灌的事件再 emit 出去',
        s.indexOf('__muvEvent&&d.__muvEvent.name)fire(') >= 0, 'inbound-fire')
    } else {
      c.check('· 信息型：这份源码里没有兼容层（before 臂预期）', true, '')
    }

    const sandboxOfSrc = (await pageEval(cdp, pageSession, 'window.__host.sandboxOf()')).value
    report.sandbox = sandboxOfSrc
    c.check('★ 沙箱常量 = 生产值且**不含** allow-same-origin',
      sandboxOfSrc === 'allow-scripts' && String(sandboxOfSrc).indexOf('allow-same-origin') < 0,
      JSON.stringify(sandboxOfSrc))

    // 宿主监听装起来（与产品同一条路：ensureCardCompatListener）
    await pageEval(cdp, pageSession, 'window.__host.install()')

    // ── 造卡（srcdoc 由产品自己的 cardHtmlIframe 生成） ──
    const before = sessions.length
    const mk = await pageEval(cdp, pageSession, 'window.__host.spawn(' + JSON.stringify(arm.body) + ') && 1')
    if (mk.err) throw new Error('spawn 失败: ' + mk.err)
    const t0 = Date.now()
    while (sessions.length <= before && Date.now() - t0 < 15000) await sleep(100)
    if (sessions.length <= before) throw new Error('新 iframe 没有被 autoAttach 抓到（OOPIF 会话缺失）')
    const f = sessions[sessions.length - 1]
    report.frames.A = { session: f.sessionId, target: f.targetId, url: f.url }

    const attrSandbox = (await pageEval(cdp, pageSession, 'document.querySelectorAll("iframe.muv-iframe")[0].getAttribute("sandbox")')).value
    c.check('★ 真 iframe 的 sandbox 属性 = 生产常量（不是门禁自己放宽的）',
      String(attrSandbox) === 'allow-scripts', 'sandbox=' + JSON.stringify(attrSandbox))

    // 等卡自己的脚本跑起来（__homeInit 在 DOMContentLoaded 之后 0ms）
    await until(cdp, pageSession, 'document.querySelectorAll("iframe.muv-iframe").length===1')
    await sleep(1800)

    // ── 卡内：装显式探针 ──
    const probeSetup = await pageEval(cdp, f.sessionId, EVT(
      'if(typeof eventOn!=="function")return {bus:false};' +
      'window.__probe={q:[],w:[],bus:true};' +
      'eventOn("era:queryResult",function(d){window.__probe.q.push(d)});' +
      'eventOn("era:writeDone",function(d){window.__probe.w.push(d)});' +
      'return {bus:true};'))
    const pj = jparse(probeSetup.value, { bus: false, err: probeSetup.err })
    report.probe = pj
    c.check('前置：卡里有事件总线（eventOn 可用，垫片装上了）', pj.bus === true, JSON.stringify(pj))

    // 记下应答之前的 DOM 值（"数值不再空着"要有 before/after 才有意义）
    const DOM_Q = EV(`var el=document.querySelector('[data-era="${PROBE_PATH}"]');return {has:!!el,txt:el?el.textContent:null};`)
    const domBefore = jparse((await pageEval(cdp, f.sessionId, DOM_Q)).value, {})

    // ── ★ 主断言：卡自己 emit 一次，探针必须收到宿主回的 detail ──
    const emit = await pageEval(cdp, f.sessionId, EVT(
      'if(typeof eventEmit!=="function")return {ok:false,err:"no-eventEmit"};' +
      'eventEmit("era:getCurrentVars");return {ok:true};'))
    const ej = jparse(emit.value, { ok: false })
    c.check('前置：卡内 eventEmit("era:getCurrentVars") 不抛', ej.ok === true, JSON.stringify(ej))

    await until(cdp, f.sessionId, '(window.__probe&&window.__probe.q.length>0)===true', 5000)
    const got = jparse((await pageEval(cdp, f.sessionId, 'JSON.stringify(window.__probe||{})')).value, {})
    report.probeAfter = { q: (got.q || []).length, w: (got.w || []).length }
    c.check('★★ 卡内 eventOn("era:queryResult") **收到了**宿主回的 detail（显式探针）',
      (got.q || []).length > 0, 'era:queryResult 收到 ' + (got.q || []).length + ' 次')

    const d0 = (got.q && got.q[0]) || null
    c.check('★ 应答形状是卡要的：queryType==="getCurrentVars" 且有 result.stat',
      !!d0 && d0.queryType === 'getCurrentVars' && !!(d0.result && d0.result.stat),
      d0 ? ('queryType=' + d0.queryType + ' stat 顶层键=' + Object.keys(d0.result.stat || {}).join(',')) : '（没有 detail）')

    const wantVal = PAYLOAD && PAYLOAD['世界信息'] && PAYLOAD['世界信息'].时间 && PAYLOAD['世界信息'].时间.日期
    const delivered = d0 && d0.result && d0.result.stat && d0.result.stat['世界信息'] && d0.result.stat['世界信息'].时间
    c.check('★★ 送回去的就是数据源里那个值（不是编的）',
      !!delivered && String(delivered['日期']) === String(wantVal),
      '送达=' + JSON.stringify(delivered && delivered['日期']) + ' 数据源=' + JSON.stringify(wantVal))

    // ── ★★ 卡自己的代码路径：currentStat + data-era 的 DOM 文本 ──
    const cardState = jparse((await pageEval(cdp, f.sessionId, EVT(
      'var has=(typeof eraGet==="function");' +
      'return {has:has,v:has?eraGet("' + PROBE_PATH + '",""):null};'))).value, {})
    c.check('★★ 卡的 eraGet("' + PROBE_PATH + '") 取到了宿主送来的值',
      String(cardState.v) === String(wantVal), JSON.stringify(cardState))

    const domAfter = jparse((await pageEval(cdp, f.sessionId, DOM_Q)).value, {})
    report.dom = { before: domBefore, after: domAfter }
    c.check('★★ 状态栏那个元素（data-era="' + PROBE_PATH + '"）的文本 = 数据源的值（数值不再空着）',
      domAfter.has === true && String(domAfter.txt) === String(wantVal),
      'DOM 前=' + JSON.stringify(domBefore.txt) + ' 后=' + JSON.stringify(domAfter.txt) + ' 期望=' + JSON.stringify(wantVal))

    // ── ★★ 运行时状态必须**剥掉端点的 {data,updatedAt} 信封**（2026-09-22 现场抓到的 bug）──
    //    端点真身：`{ok:true, state:{data:{…变量树…}, updatedAt:…}}`。少剥一层 ⇒ 值被塞进
    //    `stat.data.*` ⇒ 卡按 `stat.世界信息.时间.时间详情` 读到 initvar 的 10:00 而不是 23:59。
    const rtQ = EV(`var el=document.querySelector('[data-era="世界信息.时间.时间详情"]');return {has:!!el,txt:el?el.textContent:null};`)
    const rt0 = jparse((await pageEval(cdp, f.sessionId, rtQ)).value, {})
    c.check('★★ 运行时值覆盖初始值（时间详情 = 23:59，不是 initvar 的 ' + String(INITVAR_TIME['时间详情']) + '）',
      rt0.has === true && String(rt0.txt) === '23:59',
      'DOM=' + JSON.stringify(rt0.txt) + '（显示 initvar 值 ⇒ 端点的 {data} 信封没剥，运行时状态整份没接上）')

    // ── ★★ initvar 为空、只有运行时才有的字段（就是用户看到的"选项空白"）──
    const chQ = EV(`var el=document.querySelector('[data-era="剧情选项.选项1"]');return {has:!!el,txt:el?el.textContent:null};`)
    const ch0 = jparse((await pageEval(cdp, f.sessionId, chQ)).value, {})
    c.check('★★ initvar 为空的字段（剧情选项.选项1）必须被运行时值填上（= 用户报的"选项里没有内容"）',
      ch0.has === true && String(ch0.txt).trim() === '测试选项一',
      'DOM=' + JSON.stringify(ch0.txt) + '（空 ⇒ 运行时状态没送到卡里）')

    // ── era:forceSync → era:writeDone ──
    await pageEval(cdp, f.sessionId, EVT(
      'window.__probe.w.length=0;eventEmit("era:forceSync",{mode:"latest"});return {ok:true};'))
    await until(cdp, f.sessionId, '(window.__probe&&window.__probe.w.length>0)===true', 5000)
    const wj = jparse((await pageEval(cdp, f.sessionId, 'JSON.stringify((window.__probe&&window.__probe.w)||[])')).value, [])
    c.check('★ era:forceSync → 卡收到 era:writeDone 且带 statWithoutMeta',
      Array.isArray(wj) && wj.length > 0 && !!(wj[0] && wj[0].statWithoutMeta),
      'writeDone ' + (Array.isArray(wj) ? wj.length : '?') + ' 次')

    // ── 请求 URL 用的是会话定位（不是"猜"的预设） ──
    const urls = jparse((await pageEval(cdp, pageSession, 'JSON.stringify(window.__fetchUrls||[])')).value, [])
    report.fetchUrls = urls
    c.check('★ 取数走 muv-table 的只读接口，且**会话优先**的定位参数',
      urls.length > 0 && String(urls[0]).indexOf('/api/muv-table/tavern-card') >= 0 && String(urls[0]).indexOf('sessionId=' + FAKE_SESSION) >= 0,
      urls.length ? urls[0] : '（一次都没取）')

    const loc = (await pageEval(cdp, pageSession, 'window.__host.locator()')).value
    c.check('★ 定位参数由 currentSessionId() 得出（夹具里是 data-dsh-current-session）',
      String(loc) === 'sessionId=' + FAKE_SESSION, JSON.stringify(loc))

    // ── ★★ 反向断言：安全护栏 —— 绝不能靠加 allow-same-origin 变绿 ──
    const sec = jparse((await pageEval(cdp, f.sessionId, EVT(
      'var d=window.parent.document;return {reached:!!d,tag:d&&d.documentElement?d.documentElement.tagName:null};'))).value, { bad: true })
    report.security = sec
    const denied = (sec && typeof sec.err === 'string' && sec.err.indexOf('SecurityError') === 0) || (sec && sec.reached === false)
    c.check('★★ 反向断言：卡内 `window.parent.document` 仍被拒（SecurityError 或 null）',
      denied, JSON.stringify(sec))

    const leak = jparse((await pageEval(cdp, f.sessionId, EVT(
      'return {v:String(localStorage.getItem("__muvHostProbe"))};'))).value, {})
    c.check('★★ 反向断言：卡仍看不见宿主的站点存储（不透明来源成立）',
      leak.v === 'null' || leak.v === 'undefined', JSON.stringify(leak))
  } finally {
    close()
  }
  return report
}

// ─────────────────── Node 侧：真卡脚本 + 真数据源 ───────────────────

if (!existsSync(EDGE)) throw new Error('找不到浏览器：' + EDGE + '（设 MUV_EDGE）')
const cardPng = path.join(CARD_DIR, CARD_FILE)
if (!existsSync(cardPng)) throw new Error('找不到真卡：' + cardPng)
const cardScripts = regexScriptsOf(readPngCard(cardPng))
const picked = cardScripts.find((s) => String(s.scriptName) === CARD_SCRIPT)
if (!picked) throw new Error('卡里找不到脚本《' + CARD_SCRIPT + '》；现有：' + cardScripts.map((s) => s.scriptName).join(' / '))
const CARD_BODY = fenceBodyOf(String(picked.replaceString))
if (!CARD_BODY || !looksLikeDoc(CARD_BODY)) throw new Error('《' + CARD_SCRIPT + '》的围栏正文不是整页文档')

console.log('真卡: ' + CARD_FILE)
console.log('整页脚本: ' + cardScripts
  .filter((s) => looksLikeDoc(String(fenceBodyOf(String(s.replaceString || '')) || '')))
  .map((s) => s.scriptName + '(' + String(s.replaceString || '').length + ')').join('  '))
console.log('选中: ' + CARD_SCRIPT + '  围栏正文 ' + CARD_BODY.length + ' 字符')

/** 找哪张预设绑着这张卡（就是服务端 `loadRawCardForPreset` 在找的那份）。 */
function findPresetIdForCard(cardName) {
  const root = path.join(os.homedir(), '.dsh', '.agent-presets')
  if (!existsSync(root)) return ''
  for (const n of readdirSync(root)) {
    if (!n.startsWith('preset-')) continue
    const cj = path.join(root, n, 'characters.json')
    if (!existsSync(cj)) continue
    // `characters.json` 在某些预设下是**目录**（同一份数据的另一种布局）—— 只读文件那份。
    try { if (!statSync(cj).isFile()) continue } catch (_) { continue }
    try {
      const txt = readFileSync(cj, 'utf8')
      if (txt.includes('"' + cardName + '"') || txt.indexOf(cardName) >= 0) return n
    } catch (_) {}
  }
  return ''
}

/**
 * 从活着的 muv-table **只读**抓一份变量表。这是夹具 fetch 桩返回的那一份。
 * 抓不到就当场红 —— 没有数据源，"ERA 数值不再空着"这件事无从谈起（也绝不编一份）。
 */
async function fetchRealPayload() {
  const cardName = path.basename(CARD_FILE).replace(/\.png$/i, '')
  const pid = findPresetIdForCard(cardName)
  const qs = pid ? ('preferPreset=1&presetId=' + encodeURIComponent(pid)) : 'preferActive=1'
  const url = DSH_API + '/api/muv-table/tavern-card?' + qs
  const r = await fetch(url)
  const d = await r.json()
  if (!d || !d.ok) throw new Error('数据源不可达：' + url + ' -> ' + JSON.stringify(d).slice(0, 200))
  const iv = d.initvarData
  if (!iv || typeof iv !== 'object' || !iv['世界信息']) {
    throw new Error('数据源里没有本卡的变量表：' + url + ' -> name=' + d.name + ' initvarData 键=' + Object.keys(iv || {}).join(','))
  }
  console.log('数据源: ' + url)
  console.log('  预设=' + d.presetDir + '  预设来源=' + d.presetSource + '  卡名=' + d.name)
  console.log('  变量表顶层键: ' + Object.keys(iv).join(' / '))
  console.log('  ' + PROBE_PATH + ' = ' + JSON.stringify(iv['世界信息']['时间']['日期']))
  return iv
}

function exportOldSource() {
  const dest = path.join(__dirname, '.tmp-era-old-client-' + OLD_REV + '.js')
  // ★ 环境容错（2026-09-24）：WorkBuddy 宿主的 node shim 里 `spawnSync('git')` 一律
  //   EBUSY（连 cmd.exe 都是）—— git 本身没问题（bash 里 `git show` 正常）。
  //   遇到这种宿主时，事先手工 `git show <rev>:lib/client.js > <dest>` 导出**同一份文件**
  //   （内容一致，可 md5 核对），脚本直接复用；正常环境仍走 git show，行为不变。
  if (existsSync(dest)) return dest
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) {
    throw new Error('git show ' + OLD_REV + ' 失败（宿主 EBUSY 时可手工导出到 ' + dest + '）: '
      + (r.stderr || '').slice(0, 300) + (r.error ? ' err=' + r.error.code : ''))
  }
  writeFileSync(dest, r.stdout, 'utf8')
  return dest
}

// ─────────────────────────────── main ───────────────────────────────

const PAYLOAD = await fetchRealPayload()
/** 夹具 `fetch` 桩返回的**完整响应包**：产品读的是 `d.initvarData`，只喂裸变量树会成为空对象。 */
/**
 * ★★ 运行时状态桩（2026-09-22 现场取证补的，**这条就是线上那个 bug 的判据**）。
 *
 * 为什么必须有它：原来那个 fetch 桩**对所有 URL 返回同一份** tavern-card 信封，
 * 于是客户端"取运行时状态"那条分支（`/api/muv-engine/state`）永远拿到 `d.state === undefined`
 * ⇒ 静默退回 base（initvarData）⇒ **"信封有没有剥掉"这件事根本测不到**。
 * 而线上真出了一次：端点回的是 `{ok, state:{data, updatedAt}}`，客户端少剥一层
 * ⇒ 运行时值被塞进 `stat.data.*`，卡按 `stat.剧情选项.选项1` 读又是 initvar 的空串
 * ⇒ 实测 17 个 `data-era` 填了 14 个，**只有 剧情选项.选项1/2/3 空着**、时间停在 initvar 的
 * 10:00 —— 看起来像"个别字段没填"，其实**整份运行时状态都没接上**。
 *
 * 让运行时值在两个维度上可辨识：
 *   ① 覆盖一个 initvar 也有的字段（时间详情 10:00 → 23:59）⇒ 不剥信封就会露 initvar 值；
 *   ② 提供一个 initvar **为空**的字段（剧情选项.选项1）⇒ 正是用户看到的那个症状。
 */
const RUNTIME = {
  世界信息: { 时间: { 时间详情: '23:59' } },
  剧情选项: { 选项1: '测试选项一', 选项2: '测试选项二', 选项3: '测试选项三' },
}
const INITVAR_TIME = (PAYLOAD['世界信息'] && PAYLOAD['世界信息'].时间) || {}

/** 夹具 fetch 桩对所有 URL 返回同一份 → 运行时状态就挂在这份信封里（见 RUNTIME 的长注释）。 */
const ENVELOPE = {
  ok: true,
  found: true,
  name: CARD_FILE.replace(/\.png$/i, ''),
  initvarData: PAYLOAD,
  state: { data: RUNTIME, updatedAt: Date.now() },
}

const nowSrc = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
const MARK = 'post({__muvEventOut:'
const noBridgeSrc = nowSrc.split(MARK).join('post({__muvEventOutOff:')
const hits = nowSrc.split(MARK).length - 1
if (hits !== 1) throw new Error('对照臂的记号在这份源码里出现 ' + hits + ' 次（期望 1 次）—— 改名对照失效，门禁不能算数')

const oldPath = exportOldSource()
const arms = [
  { label: 'after', srcPath: path.join(__dirname, 'lib', 'client.js'), source: nowSrc, body: CARD_BODY },
  { label: 'nobridge', srcPath: path.join(__dirname, 'lib', 'client.js'), source: noBridgeSrc, body: CARD_BODY },
  { label: 'before', srcPath: oldPath, source: readFileSync(oldPath, 'utf8'), body: CARD_BODY },
]

const reports = []
for (const arm of arms) reports.push(await runArm(arm, PAYLOAD, ENVELOPE))

console.log('\n=== 汇总 ===')
const count = (r) => ({
  p: r.checks.filter((x) => x.ok && !x.name.startsWith('·')).length,
  f: r.checks.filter((x) => !x.ok && !x.name.startsWith('·')).length,
})
/** 「桥真的把 detail 送到了卡里」这一条的名字（对照臂必须红的就是它）。 */
const KEY = '★★ 卡内 eventOn("era:queryResult") **收到了**宿主回的 detail（显式探针）'
for (const r of reports) {
  const n = count(r)
  console.log('  ' + r.arm + ': ' + n.p + ' 通过 / ' + n.f + ' 失败')
  for (const x of r.checks) if (!x.ok && !x.name.startsWith('·')) console.log('       FAIL: ' + x.name + '  -> ' + x.detail)
}
const after = reports.find((r) => r.arm === 'after')
const noBridge = reports.find((r) => r.arm === 'nobridge')
const before = reports.find((r) => r.arm === 'before')
const keyOk = (r) => !!(r && r.checks.find((x) => x.name === KEY) || {}).ok
const afterFail = count(after).f
const verdict = {
  ok: afterFail === 0 && !keyOk(noBridge) && !keyOk(before),
  afterFail,
  nobridgeKey: keyOk(noBridge),
  beforeKey: keyOk(before),
  nobridgeFail: count(noBridge).f,
  beforeFail: count(before).f,
  sandbox: after.sandbox,
  security: after.security,
  dom: after.dom,
  fetchUrls: after.fetchUrls,
  probeAfter: after.probeAfter,
  arms: Object.fromEntries(reports.map((r) => [r.arm, { pass: count(r).p, fail: count(r).f, extracted: r.extracted.length }])),
}
console.log('  after: ' + count(after).p + ' 通过 / ' + afterFail + ' 失败')
console.log('  对照 nobridge: 主断言 ' + (keyOk(noBridge) ? '★仍然绿（对照失效）' : '红 ✅') + '  其余失败 ' + count(noBridge).f + ' 条')
console.log('  对照 before  : 主断言 ' + (keyOk(before) ? '★仍然绿（对照失效）' : '红 ✅') + '  其余失败 ' + count(before).f + ' 条')
console.log('  sandbox=' + JSON.stringify(verdict.sandbox) + '  安全断言=' + JSON.stringify(verdict.security))
console.log('  DOM: data-era="' + PROBE_PATH + '" 前=' + JSON.stringify(verdict.dom.before.txt) + ' 后=' + JSON.stringify(verdict.dom.after.txt))
console.log('  取数 URL=' + JSON.stringify(verdict.fetchUrls))
console.log('  结论: ' + (verdict.ok
  ? '绿灯（after 全绿；两条对照臂在主断言上都是红的）'
  : (afterFail ? ('红：after 臂 ' + afterFail + ' 条失败') : '对照失效：某条对照臂在主断言上仍是绿的 ⇒ 这条件禁测不出东西')))
writeFileSync(OPTS.json, JSON.stringify({ verdict, reports }, null, 2), 'utf8')
console.log('  报告: ' + OPTS.json)
process.exit(verdict.ok ? 0 : 1)
