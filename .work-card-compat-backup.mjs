// 卡 ST 兼容垫片的**真浏览器门禁** —— 判定 lib/client.js 注入进卡 srcdoc 的那层兼容层
// 到底有没有真的生效，以及**安全护栏有没有被顺手拆掉**。
//
// 为什么必须有这条门禁（三条都是踩出来的）：
//   ① **必须跑真卡、且必须跑对脚本。** 这张卡里有 10 份正则脚本，「主页」和「ERA 状态栏」
//      都是整页文档。CG / era / localStorage 的代码**全在「ERA 状态栏」里**（210,219 字符；
//      「主页」只有 57,618）。按「主页」跑，所有断言量到的都是 `undefined` —— 看起来"全绿"，
//      其实什么也没测到。所以下面把**脚本名与字符数当硬断言**，跑错脚本会当场红。
//   ② **沙箱必须与产品一致。** `MUV_CARD_SANDBOX = 'allow-scripts'`（不透明来源）是**有意的
//      安全决策**（见 client.js 里那段长注释：卡内代码会探测 `window.parent.document` 找输入框）。
//      不透明来源下 `localStorage` 抛 `SecurityError`，所以垫片才需要"内存实现 + 宿主记账"。
//      门禁里**绝不能**为了让断言变绿而加 `allow-same-origin` —— 有一条专门的反向断言盯着它。
//   ③ **KV 必须跨 iframe。** 卡在**每条消息**里各拿一个 iframe，CG 画廊状态正是在这些 iframe
//      之间流转的（「上一条消息解锁了 CG，下一条看得见」）。只用内存垫片的话每个 iframe 都是
//      孤岛，画廊一直空着 —— 和修之前一样。所以"新建的第二个 iframe 首屏就拿到第一个写的 key"
//      是本门禁的核心判据，而不是锦上添花。
//
// before/after 对照：`--old-export`（或 `--src=<旧 client.js>`）时多跑一条 before 臂，
// 用 324b751 的旧源码渲染同一个夹具 → 必须**红**。没有对照的门禁证明不了东西。
//
// 运行（Windows PowerShell 5.1，没有 pwsh；npm 要写 npm.cmd）：
//   $env:MUV_EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
//   node verify-card-compat.mjs --old-export
//
// 环境事实（都是会咬人的）：
//   - 无头 Edge 每次都要**新的** --user-data-dir（verify-shared.launchEdge 已经这么做）；
//   - 沙箱 iframe 会被换进独立渲染进程（OOPIF），求值必须发到**子 target 的会话**上，
//     开在浏览器会话上抓不到（见 verify-card-interactive.mjs 头部的踩坑记录）；
//   - 夹具里**先不放 iframe**：卡 iframe 由 CDP 求值动态 append，每个 iframe 出现的时刻
//     才能和 `Target.attachedToTarget` 对齐（静态写死的 iframe 在 autoAttach 生效前就建好了 target）；
//   - 绝对不要碰 3080 上正在跑的 DSH —— 本脚本只起自己的无头 Edge。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'
import { sleep, openPage, fenceBodyOf, looksLikeDoc, heightRuntimeSource, extractFunction, moduleVarStatements } from './verify-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-card-compat')
mkdirSync(OUT, { recursive: true })

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CARD_DIR = process.env.MUV_CARD_DIR || 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'
const CARD_FILE = process.env.MUV_CARD_FILE || '_足控天堂2.png'
/** ★ 必须带 CG/era/localStorage 代码的那一份。按「主页」跑量到的全是 undefined。 */
const CARD_SCRIPT = process.env.MUV_CARD_SCRIPT || 'ERA 状态栏'
const CARD_SCRIPT_LEN = 210219
const OLD_REV = '324b751'

// ─────────────── 真卡 + 期望键（模块求值期就要有：BOOTSTRAP / runArm 都读它） ───────────────

if (!existsSync(CARD_DIR)) throw new Error('找不到卡目录：' + CARD_DIR)
const cardPng = path.join(CARD_DIR, CARD_FILE)
if (!existsSync(cardPng)) throw new Error('找不到真卡：' + cardPng)
const cardScripts = regexScriptsOf(readPngCard(cardPng))
const picked = cardScripts.find((s) => String(s.scriptName) === CARD_SCRIPT)
if (!picked) throw new Error('卡里找不到脚本《' + CARD_SCRIPT + '》；现有：' + cardScripts.map((s) => s.scriptName).join(' / '))
const CARD_BODY = fenceBodyOf(String(picked.replaceString))
if (!CARD_BODY || !looksLikeDoc(CARD_BODY)) throw new Error('《' + CARD_SCRIPT + '》的围栏正文不是整页文档')
const CARD_CONTENT_KEY = 'kv@' + CARD_BODY.length

console.log('真卡: ' + CARD_FILE)
console.log('整页脚本: ' + cardScripts
  .filter((s) => looksLikeDoc(String(fenceBodyOf(String(s.replaceString || '')) || '')))
  .map((s) => s.scriptName + '(' + String(s.replaceString || '').length + ')').join('  '))
console.log('选中: ' + CARD_SCRIPT + '  围栏正文 ' + CARD_BODY.length + ' 字符')

/** 逐字复算 data-muv-kv（不抄一份散列实现，直接执行源码里那个函数）。 */
function expectedKeyOf(src, body) {
  const fn = new Function(extractFunction(src, 'muvCompatKey') + '\nreturn muvCompatKey')()
  return fn(body)
}

// ─────────────────────────── CLI ───────────────────────────
const argv = process.argv.slice(2)
const flag = (name, def) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='))
  if (!hit) return def
  if (hit === '--' + name) return true
  return hit.slice(name.length + 3)
}
const OPTS = {
  src: String(flag('src', '') || ''),
  oldExport: !!flag('old-export', false),
  settle: Number(flag('settle', 1400)),
  debug: !!flag('debug', false),
  json: String(flag('json', path.join(OUT, 'card-compat-report.json'))),
}

/** 旧源码导出：**不能用 PowerShell 的 `>`**（写成 UTF-16，中文乱码、JS 解析失败）。 */
function exportOldSource() {
  const dest = path.join(__dirname, '.tmp-old-client-' + OLD_REV + '.js')
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) throw new Error('git show ' + OLD_REV + ' 失败: ' + String(r.stderr || '').slice(0, 300))
  writeFileSync(dest, r.stdout, 'utf8')     // Node 写：不带 BOM，不写 UTF-16
  return dest
}

// ─────────────────── 逐字提取的渲染运行时（夹具用） ───────────────────

const htmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const IDENT = /^[A-Za-z_$][\w$]*$/

function sandboxOf(src) {
  const m = /var\s+MUV_CARD_SANDBOX\s*=\s*(['"][^'"]*['"])/.exec(src)
  if (!m) throw new Error('这份 client.js 里找不到 MUV_CARD_SANDBOX')
  return new Function('return ' + m[1])()
}

/**
 * 从一份 client.js 源码里造出**浏览器里可跑的渲染运行时**。
 *
 * 做法同 verify-shared.heightRuntimeSource：把 `var X = <纯字面量>` 的模块级声明**逐字**搬过去，
 * 再加上自足的具名函数。按**名字存在性**挑函数而不是写死清单：旧源码里没有
 * `withCardCompat` / `muvCardCompatScript` / `rewriteVhMinHeight` 也能构造出来，
 * 于是「旧源码 ⇒ 断言必红」是**同一个夹具**上的对照，而不是两套代码。
 *
 * 导出 `makeIframe(raw)`：逐字调用生产里的 `cardHtmlIframe`（同一处 escAttr、同一处
 * MUV_CARD_SANDBOX、同一条注入链、同一个 `data-muv-kv` 键），所以夹具走的是真实渲染出口。
 */

/**
 * ★ 这一层**必须存在**：上面 `fixtureRuntime` 返回的是一个 `new Function` 实例，
 *   而 `Function.prototype.toString` 只能转出它自己的源码 —— 它**闭包里的 `names` 没了**。
 *   页面上要看到 `names`/`kv`/`chatLog` 这些引用，就必须把函数体连同注入的源码一起
 *   **在外层再拼一遍**（而不是把裸的 `() => fn()` 转成字符串发过去 —— 那样浏览器拿到的是
 *   一句引用不存在变量的箭头函数，静默产出 `rt.names = undefined`，
 *   接着 `pageEval` 就因为表达式语法错误报 `Unexpected end of input`，看起来像 CDP 出问题）。
 *   真踩过这个坑，所以这里写成显式的「构造 + 包裹 + 调用」三步：
 *     ① fixtureRuntimeFactory(src) 在 Node 侧造出 body 文本；
 *     ② 把它和取引用那几行拼成一个 IIFE 文本；
 *     ③ `new Function(该文本)` 在**页面里**跑，把 `window.__compatRuntime` 挂好。
 */
function fixtureRuntimeFactory(src) {
  const KEEP = /Frame|CardCompat|CardReset|VhMinHeight|escAttr|ScriptRanges|muvHostViewport|muvJsonSafe|muvChat|muvKv|muvCompatKey|muvCompatSeedMap/
  const isFn = (n) => new RegExp('\\n[ \\t]+function\\s+' + n + '\\s*\\(').test(src)
  const queue = []
  for (const m of src.matchAll(/^[ \t]*var\s+([A-Za-z_$][\w$]*)\s*=/gm)) if (KEEP.test(m[1])) queue.push(m[1])
  for (const m of src.matchAll(/^[ \t]+function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) if (KEEP.test(m[1]) && IDENT.test(m[1])) queue.push(m[1])
  // ★ 必须显式把 `cardHtmlIframe` 加进来，并沿函数体做**名字闭包**：
  //   `KEEP` 里写的是 `Frame`（大写 F），它能匹配引导脚本那一族
  //   （muvFrameBootstrap / withFrameHeightBootstrap / onMuvFrameHeightMessage / sizeFrame），
  //   却**匹配不到 `cardHtmlIframe`** —— 那里是大写 I + 小写 `frame`。
  //   而 `cardHtmlIframe` 正是本夹具唯一的渲染出口（`window.makeIframe` 直接调它）。
  //   漏掉它的后果：夹具在**第一次 spawn** 就抛 `ReferenceError: cardHtmlIframe is not defined`，
  //   而 `spawnFrame` 只看会话数 ⇒ 报出来的是"新 iframe 没有被 autoAttach 抓到（OOPIF 会话缺失）"，
  //   把根因指向浏览器隔离域，完全是错的方向。这条门禁上一轮从未跑通，就是这个。
  queue.push('cardHtmlIframe')
  const have = new Set()
  const names = []
  const chunks = []
  let out = ''
  while (queue.length) {
    const n = queue.shift()
    if (have.has(n)) continue
    have.add(n)
    names.push(n)
    let code = null
    try { code = extractFunction(src, n) } catch (_) { code = null }
    if (code === null) continue            // 不是函数（是常量）⇒ 交给下面的字面量池
    chunks.push(code)
    out += code + '\n'
    for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[1]
      if (have.has(id)) continue
      if (isFn(id)) queue.push(id)
    }
  }
  // 模块级字面量：只带**被上面那段代码真的引用到**的（`cardHtmlIframe` 里的
  // `MUV_CARD_SANDBOX` 必须带上，KEEP 不含它）。名单写死会让下一次新增常量时又是同一种崩。
  const pool = moduleVarStatements(src)
  const head = []
  // ★ `muvKv` / `muvChatLog` **无条件**注入：旧源码（324b751）里这两个名字**根本不存在**
  //   （它们是这一轮新加的父页记账容器），而 `muvChatList` / `muvCompatSeedMap` 这两个
  //   被提取到的函数会引用它们 ⇒ before 臂会在第一次 spawn 抛 `ReferenceError: muvKv is not defined`，
  //   整条门禁在半路崩掉、连汇总行都打不出来。夹具要的是"同名同语义的空容器"，与源码里
  //   有没有这一行无关。（原来把它们挂在 `names` 的循环里，等于要求源码里有声明 —— 那正是漏。）
  head.push('  var muvKv = {};')
  head.push('  var muvChatLog = [];')
  for (const k of Object.keys(pool)) {
    if (k === 'muvKv' || k === 'muvChatLog') continue
    if (have.has(k)) continue
    if (!new RegExp('\\b' + k + '\\b').test(out)) continue
    head.push(pool[k])
  }
  return { names, constLines: head, fnChunks: chunks, bodyText: head.join('\n') + '\n' + out }
}

/**
 * 夹具运行时代码必须**先在 Node 里能解析**，再送进浏览器。
 *
 * 为什么：拼出来的文本如果语法坏了，页面上只会报一句没有行号、没有来源的
 * `SyntaxError: Unexpected token 'var'`；`makeFirst` 随之中止 ⇒ `spawnFrame` 报的又是
 * "OOPIF 会话缺失"。三层错位，读的人会去查浏览器隔离域，而真因是"我们自己的拼接坏了"。
 * （上一轮它就是这么死的：`cardHtmlIframe` 没被提取进来。）
 *
 * 逐**段**校验而不是整段二分：每一段（常量声明行 / 每个函数体）单独放进 `new Function`
 * 都必须能解析，坏的那一段能直接被点出来，没有任何启发式。
 */
function validateSegments(segments) {
  const bad = []
  for (const s of segments) {
    try { new Function(String(s) + '\n') } catch (e) { bad.push({ err: e.message, text: String(s).slice(0, 240) }) }
  }
  return bad
}

/** 整段能不能解析？（先整段，再逐段定位 —— 逐段只是**定位手段**，不是判据） */
function runtimeTextError(text, segments) {
  try { new Function(String(text) + '\n'); return null } catch (e) {
    const bad = validateSegments(segments)
    return { whole: e.message, bad }
  }
}

/**
 * 页面里要执行的文本：**不需要**再包一层 IIFE —— 这一段直接放进 `new Function` 体里跑。
 * （`var window` / `var document` 一律不许出现，见 fixtures 里那条注释。）
 */
function runtimeSourceText(src) {
  const { names, constLines, fnChunks } = fixtureRuntimeFactory(src)
  // ★ 引用的四个运行时句柄都做**存在性兜底**：旧源码（before 臂）里没有
  //   `muvChatList` / `muvCompatSeedMap`，裸引用会让整个夹具在解析后的**求值期**抛
  //   `ReferenceError: muvChatList is not defined` ⇒ 整臂崩掉、连汇总都出不来。
  //   before 臂**必须**能跑起来（它要红的是断言，不是崩在夹具上）。
  const runtimeLines = [
    'var CARD_HOST_H = 900;',
    'var muvCardHostProbeDocument = { querySelectorAll: function () { return []; } };',
    'function __pick(fn, fallback) { return typeof fn === "function" ? fn : fallback; }',
    'window.makeIframe = function (raw) { return cardHtmlIframe(raw) };',
    'window.__compatRuntime = { names: ' + JSON.stringify(names) + ', makeIframe: window.makeIframe, hostH: CARD_HOST_H,',
    '  kv: muvKv, chatLog: muvChatLog,',
    '  chatList: __pick(typeof muvChatList === "undefined" ? undefined : muvChatList, function () { return []; }),',
    '  seedMap: __pick(typeof muvCompatSeedMap === "undefined" ? undefined : muvCompatSeedMap, function () { return {}; }) };',
  ]
  // ⚠ `runtimeLines` 必须当成**一个**段：它是一个跨多行的对象字面量，
  //   逐行丢进 `new Function` 每条都会报 `Unexpected token`（那不是拼接坏了，是物理行不是语句）。
  return {
    text: [...constLines, ...fnChunks, ...runtimeLines].join('\n'),
    segments: [...constLines, ...fnChunks, runtimeLines.join('\n')],
  }
}

const BOOTSTRAP = `(function () {
  var H = document.getElementById('host');
  var built = [];
  var RT = window.__compatRuntime;
  function K() { return 'kv@' + ${JSON.stringify(CARD_CONTENT_KEY)}; }
  window.__compat = {
    key: K,
    makeFirst: function (raw) {
      var count = built.length;
      var el = document.createElement('div');
      el.innerHTML = RT.makeIframe(raw);
      var frame = el.firstElementChild;
      frame.id = 'muv-frame-' + count;
      H.appendChild(frame);
      built.push(frame);
      return JSON.stringify({ i: count, kv: frame.getAttribute('data-muv-kv') });
    },
    frameCount: function () { return built.length },
    seed: function (name, k, v) { (RT.kv[name] = RT.kv[name] || {})[k] = v; return true },
    kvHas: function (name) { return !!(RT.kv[name] && Object.prototype.hasOwnProperty.call(RT.kv[name], 'ft2_cg_state')) },
    kvGet: function (name, k) { var st = RT.kv[name] || {}; return Object.prototype.hasOwnProperty.call(st, k) ? st[k] : null },
    kvDump: function (name) { return JSON.stringify(RT.kv[name] || {}) },
    pushChat: function (t) { RT.chatLog.push(String(t)); return true },
    /**
     * 把当前记账**回送**给已经建好的第 0 帧。
     *
     * 为什么需要：卡 iframe 的静态种子来自「注入那一刻宿主 KV 里已有的东西」。帧 A 是在
     * 手工 seed 之前建的，所以它自己那一份静态快照是空的 —— 生产里这正是「__muvHello
     * 报名消息」存在的理由（子文档起来后向宿主报名，宿主再把快照回送）。这里显式跑一次那条路，
     * 才能把「种子回送」这件事也纳入判定，而不是只测静态注入。
     */
    reseed: function (name) {
      if (!built.length) return false;
      built[0].contentWindow.postMessage({ __muvKvSeed: RT.seedMap(name), __muvChat: { list: RT.chatList() } }, '*');
      return true;
    },
    dump: function () { return JSON.stringify({ names: RT.names, kvNamespaces: Object.keys(RT.kv).length, built: built.length, chat: RT.chatList().length }) },
  };
  window.__compatReseed = window.__compat.reseed;
  window.compatReady = true;
})()`

/**
 * 宿主夹具页。先不放任何 iframe —— 见头部注释里 OOPIF 的那条。
 */
function fixturePage(runtimeSource, heightRuntime, label) {
  const S = (t) => String(t).replace(/<\/script/gi, '<\\/script')
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>card-compat-fixture</title>
<style>html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:13px/1.5 sans-serif}
.cap{font:12px monospace;color:#8b93a1;padding:8px}iframe{display:block}</style>
</head><body>
<div class="cap">${htmlEsc(label)}</div>
<div id="host"></div>
<script>/* 渲染运行时：逐字取自 client.js */</script>
<script>${S(runtimeSource)}</script>
<script>/* 父页高度运行时：逐字取自 client.js */</script>
<script>${S(heightRuntime)}</script>
<script>${S(BOOTSTRAP)}</script>
</body></html>`
}

// ─────────────────────────── CDP ───────────────────────────

/** 页会话 + 认领 OOPIF 子会话。 */
async function connect() {
  const { cdp, pageSession, browserVersion, close } = await openPage(EDGE, { url: 'about:blank' })
  const state = { sessions: [], exceptions: [] }
  cdp.on('Target.attachedToTarget', (p) => {
    if (p.targetInfo.type === 'iframe') state.sessions.push({ targetId: p.targetInfo.targetId, sessionId: p.sessionId, url: p.targetInfo.url })
  })
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p && p.exceptionDetails
    const txt = d && ((d.exception && (d.exception.description || d.exception.value)) || d.text)
    if (txt) state.exceptions.push(String(txt).split('\n')[0].slice(0, 200))
  })
  return { cdp, pageSession, browserVersion, state, close }
}

/** 求值；失败时 `err` 是**完整异常描述**（安全断言要从中认 SecurityError）。 */
async function evalIn(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    return { err: (d.exception && d.exception.description) || d.text || 'exception' }
  }
  return { value: r.result && r.result.result && r.result.result.value }
}
const jparse = (v, def) => { try { return typeof v === 'string' ? JSON.parse(v) : (v == null ? def : v) } catch (_) { return def } }

/** 轮询直到表达式为 true（跨进程的 postMessage 记账是异步的）。 */
async function until(cdp, sid, expr, ms = 5000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) { last = await evalIn(cdp, sid, expr); if (last.value === true) return true; await sleep(100) }
  return last.value === true ? true : last
}

async function waitFor(cdp, sid, expr, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const r = await evalIn(cdp, sid, expr); if (r.value === true) return true; await sleep(100) }
  return false
}

// ─────────────────── 判定台 ───────────────────────────

function makeChecks() {
  const rows = []
  return {
    rows,
    check(name, ok, detail) {
      rows.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
      console.log('  ' + (ok ? 'OK  ' : 'FAIL ') + name + (detail === undefined ? '' : '  -> ' + String(detail)))
    },
  }
}

async function runArm(arm) {
  console.log('\n=== 臂: ' + arm.label + '  (' + path.basename(arm.srcPath) + ') ===')
  const c = makeChecks()
  const report = { arm: arm.label, src: arm.srcPath, script: CARD_SCRIPT, scriptLen: arm.scriptLen, sandbox: arm.sandbox, checks: c.rows, frames: {} }

  const { cdp, pageSession, browserVersion, state, close } = await connect()
  try {
    report.browser = browserVersion
    const fixture = path.join(OUT, 'fixture-' + arm.label + '.html')
    const rtText = runtimeSourceText(arm.source)
    // ★ 送进浏览器**之前**先在这里解析一次并逐段定位。理由见 validateSegments 的注释：
    //   拼接坏了的话，页面只报一句无来源的 SyntaxError，下游还会把它翻译成"OOPIF 会话缺失"。
    const bad = runtimeTextError(rtText.text, rtText.segments)
    if (bad) {
      c.check('★★ 夹具运行时代码在 Node 侧就能解析（拼接没坏）', false,
        '整段解析失败: ' + bad.whole +
        (bad.bad.length ? ' · 坏的段: ' + bad.bad.map((b) => b.err + ' :: ' + b.text).join(' || ').slice(0, 600)
          : ' · 每一段单独都能解析（问题在段的组合）'))
      console.log('  ARM-ABORT ' + arm.label + ': 夹具运行时代码语法坏，不再起浏览器')
      return report
    }
    c.check('★★ 夹具运行时代码在 Node 侧就能解析（拼接没坏）', true, rtText.segments.length + ' 段全部可解析')
    writeFileSync(fixture, fixturePage(rtText.text, heightRuntimeSource(arm.source), 'compat-fixture · ' + arm.label), 'utf8')

    state.sessions.length = 0
    await cdp.send('Page.navigate', { url: 'file:///' + fixture.replace(/\\/g, '/') + '?v=' + Date.now() }, pageSession)
    const got = await waitFor(cdp, pageSession, 'typeof window.__compat === "object"', 15000)
    if (OPTS.debug) {
      const raw = await evalIn(cdp, pageSession, 'JSON.stringify({compat:typeof window.__compat,ready:window.compatReady===true,iframeCount:document.querySelectorAll("iframe").length,names:((window.__compatRuntime||{}).names||[]).length,rtKeys:Object.keys(window.__compatRuntime||{}).join(","),make:typeof window.makeIframe,probe:(function(){var o={};try{o.kv=typeof muvKv}catch(e){o.kv="THROW:"+e.message}try{o.chatList=typeof muvChatList}catch(e){o.chatList="THROW:"+e.message}try{o.seedMap=typeof muvCompatSeedMap}catch(e){o.seedMap="THROW:"+e.message}try{o.escAttr=typeof escAttr}catch(e){o.escAttr="THROW:"+e.message}try{o.compatScript=typeof muvCardCompatScript}catch(e){o.compatScript="THROW:"+e.message}return o})()})')
      console.log('  [debug] ' + JSON.stringify(raw).slice(0, 700))
      const rt0 = await evalIn(cdp, pageSession, 'typeof window.__compat === "object" ? window.__compat.dump() : "no-__compat"')
      console.log('  [debug] dump = ' + JSON.stringify(rt0).slice(0, 400))
      report.debug = { got, raw, rt0 }
      return report
    }
    const rt = jparse((await evalIn(cdp, pageSession, 'window.__compat.dump()')).value, {})
    const rtProbe = jparse((await evalIn(cdp, pageSession, 'JSON.stringify({n:((window.__compatRuntime||{}).names||[]).length,make:typeof window.makeIframe,kv:typeof ((window.__compatRuntime||{}).kv),chatList:typeof ((window.__compatRuntime||{}).chatList),seedMap:typeof ((window.__compatRuntime||{}).seedMap),cardHtml:typeof cardHtmlIframe,sandbox:(typeof MUV_CARD_SANDBOX==="string")?MUV_CARD_SANDBOX:"MISSING",hasFit:(typeof muvFrameBootstrap==="function"?muvFrameBootstrap().indexOf("__muvHFitProbe")>=0:false)})')).value, {})
    c.check('夹具运行时构造成功（逐字提取的函数都注入到页面里了）',
      rtProbe.n > 10 && rtProbe.make === 'function' && rtProbe.kv === 'object' && rtProbe.chatList === 'function' && rtProbe.seedMap === 'function' &&
      // ★ `cardHtmlIframe` 与 `MUV_CARD_SANDBOX` 单列两条：漏掉它们时夹具会在**第一次 spawn**
      //   抛 ReferenceError，而下游只报"OOPIF 会话缺失"（见 fixtureRuntimeFactory 的注释）。
      //   把"链能不能真的组装出 iframe"钉在这里，这种崩法就再也伪装不了。
      rtProbe.cardHtml === 'function' && rtProbe.sandbox === 'allow-scripts' && rtProbe.hasFit === true,
      '注入 ' + rtProbe.n + ' 个符号 · makeIframe=' + rtProbe.make + ' cardHtmlIframe=' + rtProbe.cardHtml +
      ' sandbox=' + rtProbe.sandbox + ' 引导脚本含专属 token=' + rtProbe.hasFit +
      ' kv=' + rtProbe.kv + ' chatList=' + rtProbe.chatList + ' seedMap=' + rtProbe.seedMap)

    async function spawnFrame(raw) {
      const before = state.sessions.length
      const spawn = jparse((await evalIn(cdp, pageSession, 'window.__compat.makeFirst(' + JSON.stringify(raw) + ')')).value, {})
      const t0 = Date.now()
      while (state.sessions.length <= before && Date.now() - t0 < 15000) await sleep(100)
      if (state.sessions.length <= before) {
        // ★ 把 `makeFirst` 自己的报错带出来。只看会话数会把「夹具组装 iframe 时抛异常」
        //   （例如某个函数没被逐字提取进去）报成"OOPIF 会话缺失"，指向完全错的方向。
        const dom = await evalIn(cdp, pageSession, 'document.querySelectorAll("iframe").length')
        throw new Error('新 iframe 没有被 autoAttach 抓到（OOPIF 会话缺失）' +
          ' · makeFirst 返回=' + JSON.stringify(spawn).slice(0, 300) +
          ' · 页面上 iframe 数=' + JSON.stringify(dom.value) +
          ' · 页面异常=' + JSON.stringify(state.exceptions.slice(0, 3)))
      }
      const s = state.sessions[state.sessions.length - 1]
      await sleep(OPTS.settle)
      return { s, spawn }
    }

    // ── 脚本选择：硬断言（跑错脚本 ⇒ 后面全部量到 undefined，看起来"全绿"） ──
    c.check('★ 用的是「' + CARD_SCRIPT + '」而不是「主页」', arm.scriptLen === CARD_SCRIPT_LEN,
      '脚本=' + CARD_SCRIPT + ' replaceString=' + arm.scriptLen + ' 字符 期望=' + CARD_SCRIPT_LEN +
      '（「主页」=' + arm.otherLen + '）')
    c.check('★ 卡文档是一份整页 HTML', looksLikeDoc(arm.body), '头 12 字符=' + JSON.stringify(arm.body.slice(0, 12)))

    // ── 宿主「上一条消息」留下的状态 + 宿主 chat ──────────────────────────
    const STATE_SEED = JSON.stringify({ domain: '足控天堂2', category: 'NSFW' })
    const A_PAYLOAD = JSON.stringify({ SFW: { '帧A': [1, 2] }, NSFW: {} })
    const CHAT_MARK = 'CG解锁标记-' + arm.label
    await evalIn(cdp, pageSession, 'window.__compat.pushChat(' + JSON.stringify('<img>测试CG</img> ' + CHAT_MARK) + ')')

    // ── 帧 A ──────────────────────────────────────────────────────────────
    const A = await spawnFrame(arm.body)
    const a = (expr) => evalIn(cdp, A.s.sessionId, expr)
    report.frames.A = { session: A.s.sessionId, target: A.s.targetId, url: A.s.url }
    const attrKv = String(A.spawn.kv || '')
    report.dataMuvKv = attrKv
    c.check('★ iframe 的 data-muv-kv = 源码散列（同一张卡每次重建都一致，不同的卡互不串）',
      attrKv === arm.expectedKey, 'attr=' + attrKv + ' 逐字复算=' + arm.expectedKey)

    const sandboxAttr = (await evalIn(cdp, pageSession, 'document.querySelectorAll("iframe")[0].getAttribute("sandbox")')).value
    c.check('iframe 沙箱 = 生产常量且**不含** allow-same-origin',
      String(sandboxAttr) === arm.sandbox && String(sandboxAttr).indexOf('allow-same-origin') < 0,
      'sandbox=' + JSON.stringify(sandboxAttr) + ' 源码常量=' + JSON.stringify(arm.sandbox))

    // 跑错脚本会在这里第二次兜住：真卡文档里必须有卡的入口
    c.check('★ 卡文档里真的有 window.cgGetCache（跑错脚本/跑错卡会在这里露馅）',
      (await a('typeof window.cgGetCache')).value === 'function',
      'typeof=' + (await a('typeof window.cgGetCache')).value)

    // ① localStorage 真能不抛错地读写
    const lsj = jparse((await a('(function(){try{localStorage.setItem("probe_key","probe_val");return JSON.stringify({ok:localStorage.getItem("probe_key")==="probe_val"})}catch(e){return JSON.stringify({ok:false,err:String((e&&e.name)||e).slice(0,120)})}})()')).value, { ok: false })
    c.check('① localStorage.setItem/getItem 不抛错且值能读回', lsj.ok === true, JSON.stringify(lsj))

    // ② 走**卡自己的入口**读回垫片预置的值（证明卡真的拿到了，不只是我们自说自话）
    await evalIn(cdp, pageSession, 'window.__compat.seed(' + JSON.stringify(attrKv) + ',' + JSON.stringify('ft2_cg_state') + ',' + JSON.stringify(STATE_SEED) + ')')
    c.check('宿主 KV 记账函数可用（seed 后命名空间里有 ft2_cg_state）',
      (await evalIn(cdp, pageSession, 'window.__compat.kvHas(' + JSON.stringify(attrKv) + ')')).value === true, attrKv)
    // 让 A 重新拿一次种子（A 是在 seed 之前建的，所以要显式回送一次 —— 与生产 `__muvHello` 同路）
    await evalIn(cdp, pageSession, 'window.__compatReseed(' + JSON.stringify(attrKv) + ')')
    await sleep(400)

    const cgj = jparse((await a('JSON.stringify((function(){try{return {hasFn:typeof window.cgGetCache==="function",cb:window.cgGetCache?window.cgGetCache():null}}catch(e){return {hasFn:typeof window.cgGetCache==="function",err:String((e&&e.name)||e)}})())')).value, {})
    c.check('② 走卡自己的入口 window.cgGetCache() 能读回垫片预置的值',
      cgj.hasFn === true && cgj.cb && typeof cgj.cb === 'object' && cgj.cb.SFW && cgj.cb.NSFW,
      'hasFn=' + cgj.hasFn + ' 返回=' + JSON.stringify(cgj.cb) + (cgj.err ? ' err=' + cgj.err : ''))

    const cgState = jparse((await a('JSON.stringify((function(){try{return {s:localStorage.getItem("ft2_cg_state")}}catch(e){return {err:String((e&&e.name)||e)}})())')).value, {})
    c.check('②b 种子是按 key 精确落地的（不是"碰巧没报错"）', cgState.s === STATE_SEED, JSON.stringify(cgState).slice(0, 160))

    // ③ getContext().chat
    const ctxj = jparse((await a('JSON.stringify((function(){try{var x=window.SillyTavern&&window.SillyTavern.getContext?window.SillyTavern.getContext():null;return {has:!!x,chatType:Array.isArray(x&&x.chat)?"array":typeof(x&&x.chat),n:(x&&x.chat?x.chat.length:-1),hit:!!(x&&x.chat&&JSON.stringify(x.chat).indexOf(' + JSON.stringify(CHAT_MARK) + ')>=0)}}catch(e){return {has:false,err:String((e&&e.name)||e)}})())')).value, {})
    c.check('③ window.SillyTavern.getContext().chat 是数组', ctxj.chatType === 'array', 'chat=' + ctxj.chatType + ' n=' + ctxj.n)
    c.check('③b chat 里带着宿主喂进来的消息文本（卡的 cgScanChat 要扫它）', ctxj.hit === true, '命中=' + ctxj.hit)

    // ④ 事件总线
    const evj = jparse((await a('JSON.stringify((function(){try{' +
      'var names=["eventOn","eventEmit","eventOnce","eventOff","eventClearAll"];var miss=[];for(var i=0;i<names.length;i++)if(typeof window[names[i]]!=="function")miss.push(names[i]);' +
      'if(miss.length)return {err:"missing:"+miss.join(",")};' +
      'var got=[];function f(d){got.push("on:"+d)};eventOn("t:a",f);eventEmit("t:a",1);eventOff("t:a",f);eventEmit("t:a",2);' +
      'var once=0;eventOnce("t:b",function(){once++});eventEmit("t:b",1);eventEmit("t:b",2);' +
      'eventClearAll();eventEmit("t:a",3);' +
      'return {got:got.join("|"),once:once}}catch(e){return {err:String((e&&e.name)||e)+":"+String((e&&e.message)||"").slice(0,120)}})())')).value, {})
    c.check('④ eventOn/eventEmit/eventOnce/eventOff/eventClearAll 存在且调用不抛',
      !evj.err && evj.once === 1 && evj.got === 'on:1', JSON.stringify(evj))

    // ⑤ 视口高变量
    const hostH = (await evalIn(cdp, pageSession, 'window.innerHeight')).value
    const vhj = jparse((await a('JSON.stringify({v:String(document.documentElement.style.getPropertyValue("--TH-viewport-height")||"")})')).value, { v: '' })
    c.check('⑤ --TH-viewport-height = 宿主视口高（不是 iframe 自己的高度）',
      /^\d+px$/.test(vhj.v) && Number(vhj.v.replace('px', '')) === hostH, JSON.stringify(vhj) + ' 宿主 innerHeight=' + hostH)

    // ⑥ 卡写 → 宿主记账（KV 持久化的上半程）
    const writeAj = jparse((await a('(function(){try{localStorage.setItem("ft2_cg_cache_v2",' + JSON.stringify(A_PAYLOAD) + ');' +
      'var r=localStorage.getItem("ft2_cg_cache_v2");return JSON.stringify({ok:r===' + JSON.stringify(A_PAYLOAD) + '})}catch(e){return JSON.stringify({ok:false,err:String((e&&e.name)||e).slice(0,120)})}})()')).value, { ok: false })
    c.check('⑥ iframe A 写入 ft2_cg_cache_v2（回读一致）', writeAj.ok === true, JSON.stringify(writeAj))
    const hostSaw = await until(cdp, pageSession, 'window.__compat.kvGet(' + JSON.stringify(attrKv) + ',"ft2_cg_cache_v2")===' + JSON.stringify(A_PAYLOAD))
    c.check('★ 宿主**记账**了 A 的写入（父页 KV 里同一 key 同一值）', hostSaw === true,
      '宿主 KV=' + String((await evalIn(cdp, pageSession, 'window.__compat.kvDump(' + JSON.stringify(attrKv) + ')')).value).slice(0, 200))

    // ⑦ ★★ 跨 iframe：新建的 B 首屏就要看得见（「上一条解锁、下一条可见」）
    const B = await spawnFrame(arm.body)
    const b = (expr) => evalIn(cdp, B.s.sessionId, expr)
    report.frames.B = { session: B.s.sessionId, target: B.s.targetId, url: B.s.url }
    c.check('两个 iframe 拿到**同一个** data-muv-kv 命名空间',
      !!B.spawn.kv && String(B.spawn.kv) === attrKv, String(B.spawn.kv) + ' vs ' + attrKv)

    const bState = jparse((await b('JSON.stringify((function(){try{return {s:localStorage.getItem("ft2_cg_state")}}catch(e){return {err:String((e&&e.name)||e).slice(0,120)}})())')).value, {})
    c.check('★★ 新建的 iframe B 首屏读到宿主的 ft2_cg_state（种子回送）',
      bState.s === STATE_SEED, JSON.stringify(bState).slice(0, 160))

    const bCache = jparse((await b('JSON.stringify((function(){try{return {v:localStorage.getItem("ft2_cg_cache_v2")}}catch(e){return {err:String((e&&e.name)||e).slice(0,120)}})())')).value, {})
    c.check('★★★ 新建的 iframe B 首屏读到 A 写入的 ft2_cg_cache_v2（跨 iframe 持久化闭环）',
      bCache.v === A_PAYLOAD, 'B 读到=' + String(bCache.v).slice(0, 140))

    const bOwn = jparse((await b('JSON.stringify((function(){try{return {hasFn:typeof window.cgGetCache==="function",cb:window.cgGetCache?window.cgGetCache():null}}catch(e){return {err:String((e&&e.name)||e)}})())')).value, {})
    c.check('★★★ **卡自己**在 B 里就看得见 A 解锁的 CG（走 cgGetCache 的真实路径）',
      !!(bOwn.cb && bOwn.cb.SFW && Array.isArray(bOwn.cb.SFW['帧A']) && bOwn.cb.SFW['帧A'].join(',') === '1,2'),
      JSON.stringify(bOwn.cb))

    // ⑧ ★★ 安全护栏：反向断言，绝不能靠加 allow-same-origin 变绿
    const parentAj = jparse((await a('JSON.stringify((function(){try{var d=window.parent.document;return {reached:!!d,tag:d&&d.documentElement?d.documentElement.tagName:null}}catch(e){return {threw:true,name:String((e&&e.name)||e)}})())')).value, { bad: true })
    report.security = { frameA: parentAj }
    c.check('★★ **反向断言**：卡内 `window.parent.document` 仍被拒（SecurityError 或 null）',
      (parentAj.threw === true && parentAj.name === 'SecurityError') || parentAj.reached === false, JSON.stringify(parentAj))
    const parentBj = jparse((await b('JSON.stringify((function(){try{var d=window.parent.document;return {reached:!!d}}catch(e){return {threw:true,name:String((e&&e.name)||e)}})())')).value, {})
    c.check('★★ 同一护栏在 B 里也成立', (parentBj.threw === true && parentBj.name === 'SecurityError') || parentBj.reached === false, JSON.stringify(parentBj))

    // ⑨ 沙箱确实是不透明来源：卡碰不到宿主的**站点存储**
    await evalIn(cdp, pageSession, 'try{localStorage.setItem("__muvHostProbe","1")}catch(e){}')
    const leak = jparse((await a('JSON.stringify((function(){try{return {v:localStorage.getItem("__muvHostProbe")}}catch(e){return {threw:true,name:String((e&&e.name)||e)}})())')).value, {})
    c.check('⑨ 卡看不见宿主的站点存储（不透明来源成立，不是"共享同一个 localStorage"）',
      leak.v === null, '卡读到 __muvHostProbe=' + JSON.stringify(leak))

    report.exceptions = state.exceptions.slice(-8)
    c.check('· 信息型：卡 iframe 未捕获异常（不计入判定）', true,
      state.exceptions.length ? state.exceptions.slice(0, 3).join(' || ') : '（无）')
  } finally {
    close()
  }
  return report
}

// ─────────────────────────── main ───────────────────────────

function buildArms() {
  const otherScript = cardScripts.find((s) => String(s.scriptName) === '主页')
  const arms = []
  const nowSrc = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
  arms.push({
    label: 'after', srcPath: path.join(__dirname, 'lib', 'client.js'), source: nowSrc,
    body: CARD_BODY, scriptLen: String(picked.replaceString).length,
    otherLen: otherScript ? String(otherScript.replaceString).length : 0,
    sandbox: sandboxOf(nowSrc), expectedKey: expectedKeyOf(nowSrc, CARD_BODY),
  })
  if (OPTS.src || OPTS.oldExport) {
    const p = OPTS.src ? path.resolve(OPTS.src) : exportOldSource()
    const oldSrc = readFileSync(p, 'utf8')
    let k = null
    try { k = expectedKeyOf(oldSrc, CARD_BODY) } catch (_) { k = null }
    arms.push({
      label: 'before', srcPath: p, source: oldSrc, body: CARD_BODY,
      scriptLen: String(picked.replaceString).length, otherLen: otherScript ? String(otherScript.replaceString).length : 0,
      sandbox: sandboxOf(oldSrc), expectedKey: k,
    })
  }
  return arms
}

const arms = buildArms()
const allReports = []
for (const arm of arms) {
  try {
    allReports.push(await runArm(arm))
  } catch (e) {
    // ★ 单臂崩溃**不能**吃掉整条门禁的汇总。原来这里是 `allReports.push(await runArm(arm))`：
    //   任一臂抛异常，进程直接死在栈里 —— 退出码非零但**没有汇总行**，读的人分不清
    //   "产品坏了"还是"夹具/门禁自己坏了"（这条门禁上一轮就死在这里：before 臂缺 muvKv）。
    //   现在把它记成一条失败的检查，汇总行照常打印。
    const msg = String((e && e.message) || e).split('\n').slice(0, 4).join(' | ')
    console.log('  ARM-CRASH ' + arm.label + ': ' + msg)
    allReports.push({
      arm: arm.label, src: arm.srcPath, crashed: msg, frames: {},
      checks: [{ name: '★ 整臂跑完（夹具/门禁自身没有崩）', ok: false, detail: msg }],
    })
  }
}

console.log('\n=== 汇总 ===')
const count = (r) => ({
  p: r.checks.filter((x) => x.ok && !x.name.startsWith('·')).length,
  f: r.checks.filter((x) => !x.ok && !x.name.startsWith('·')).length,
})
for (const r of allReports) {
  const n = count(r)
  console.log('  ' + r.arm + ': ' + n.p + ' 通过 / ' + n.f + ' 失败' +
    (r.arm === 'before' ? '（before 臂**必须**红）' : '') +
    (r.crashed ? '  ⚠ 整臂崩溃: ' + r.crashed.slice(0, 160) : ''))
  for (const x of r.checks) if (!x.ok && !x.name.startsWith('·')) console.log('       FAIL: ' + x.name + '  -> ' + x.detail)
}
const after = allReports.find((r) => r.arm === 'after') || allReports[0]
const before = allReports.find((r) => r.arm === 'before')
const afterFail = count(after).f
const beforeFail = before ? count(before).f : null
const verdict = {
  ok: afterFail === 0 && (beforeFail === null ? false : beforeFail > 0),
  afterFail, beforeFail, beforeSeen: !!before,
  crashed: allReports.filter((r) => r.crashed).map((r) => r.arm),
  sandbox: after.sandbox,
  dataMuvKv: after.dataMuvKv,
  frames: after.frames,
  security: after.security,
}
if (!before) console.log('  ⚠ 没有 before 臂：`--old-export` 才能给出对照（否则门禁只证明"现在没报错"）')
if (verdict.crashed.length) console.log('  ⚠ 有整臂崩溃: ' + verdict.crashed.join(', ') + '（先修门禁自己，读数才可信）')
console.log('  sandbox=' + JSON.stringify(verdict.sandbox) + '  data-muv-kv=' + JSON.stringify(verdict.dataMuvKv))
console.log('  B 帧会话=' + (verdict.frames && verdict.frames.B ? verdict.frames.B.session : '—'))
console.log('  结论: ' + (verdict.ok
  ? ('绿灯（before 臂红 ' + beforeFail + ' 条，对照成立）')
  : (afterFail ? ('红：after 臂 ' + afterFail + ' 条失败') : '对照失效：before 臂全绿 ⇒ 这条门禁测不出东西')))
writeFileSync(OPTS.json, JSON.stringify({ verdict, reports: allReports }, null, 2), 'utf8')
console.log('  报告: ' + OPTS.json)
process.exit(verdict.ok ? 0 : 1)
