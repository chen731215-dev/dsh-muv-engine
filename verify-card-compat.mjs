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
// ★ 对照臂用的"旧版 client.js"提交。原值 324b751 已随 2026-09-22 的 git 对象库事故丢失
//   （HANDOFF §26.2），现取对象库里现存最老的 v0.3.9 发布提交（无垫片，before 臂应大面积红）。
//   可用 MUV_OLD_REV 覆盖。
const OLD_REV = process.env.MUV_OLD_REV || '7623ffa'

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

// ───────────────── ⑪ 垫片契约（第 36 轮）：纯 Node 侧，不依赖浏览器 ─────────────────
//
// 为什么单开一组**不跑浏览器**的断言：这一组盯的三件事都是"垫片跑完那一瞬间"的形状，
// 在 Node 里用最小 window 桩跑同一份**逐字提取**的产物就够了，快且确定；浏览器那一侧
// （真沙箱 + 真 lodash）由 `verify-card-libs.mjs` 的 F 臂负责，两边不重复。
//
// 它盯的三件事，全部来自真机控制台（构建 2026-09-22v，**异世界农场**）：
//   ① `Uncaught ReferenceError: errorCatched is not defined`（偶发 `tavern_events`）
//      ⇒ 卡里 `$(errorCatched(init));` 这种**顶层裸引用**一抛，整段脚本一行都跑不到。
//   ② `lodash.min.js:84 Uncaught TypeError: Expected a function`
//      ⇒ 真因是我们垫片的 `SillyTavern` 缺 `saveChat`：MVU bundle 顶层
//        `_.debounce(SillyTavern.saveChat, 1e3)` 把 `undefined` 喂给 lodash 的守卫。
//   ③ ★ 本轮自己踩的坑：给 `errorCatched`/`tavern_events` 加代码时，`var tavernEvents={…}`
//      那条末尾漏了 `;`。整条垫片拼出来是**一行**，而自动分号插入（ASI）只在「下一个词元
//      前面有换行」或「下一个词元是 `}`」时才补分号 ⇒ `}` 后同一行跟 `var` 不满足任何一条,
//      直接 `SyntaxError: Unexpected token 'var'`，而且**从那一句起整段垫片都不执行**
//      （`TH` / `Mvu` / `toastr` / 收尾的 `mvuReq()` 全丢）。所以下面第一条就是
//      「产物必须可解析」，并且带一条**变异臂**证明这条判据真能红。
function shimProductOf(src) {
  const text = extractFunction(src, 'muvCardCompatScript')
  return new Function(text + '\nreturn muvCardCompatScript')()()
}

/** 最小 window 桩：够垫片从第一行走到最后一行（`document.readyState` 决定走不走收件箱那条分支）。 */
function shimWindow(seed) {
  const listens = []
  const logs = []
  const win = {
    parent: { postMessage: () => {} },
    addEventListener: (t) => { listens.push(t) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Object, Array, String, Number, Date, Math, Error, RegExp, Boolean,
    isFinite, parseInt, decodeURIComponent, encodeURIComponent,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      documentElement: { style: { setProperty: () => {} }, innerHTML: '' },
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, classList: { add() {}, remove() {} } }),
      body: { appendChild: () => {}, style: {} }, head: { appendChild: () => {} },
    },
  }
  win.window = win
  win.console = {
    log: (...a) => logs.push(['log', a.join(' ')]),
    warn: (...a) => logs.push(['warn', a.join(' ')]),
    error: (...a) => logs.push(['error', a.join(' ')]),
    debug: () => {}, info: () => {},
  }
  if (seed) for (const k of Object.keys(seed)) win[k] = seed[k]
  return { win, logs }
}

/** 跑一份产物，返回 `{ threw, win, logs }`（跑不起来**不算** check，由调用方报成 detail）。 */
function runShim(product, seed) {
  const { win, logs } = shimWindow(seed)
  try {
    new Function('window', 'document', 'localStorage', 'sessionStorage', 'console', product)(
      win, win.document, undefined, undefined, win.console)
    return { threw: null, win, logs }
  } catch (e) {
    return { threw: String((e && e.message) || e), win, logs }
  }
}

/** ST 侧的真值（`src/function/event.ts:180-263` 那张表里的三个锚点 + 一组同值别名）。 */
const ST_EVENT_ANCHORS = {
  APP_READY: 'app_ready',
  MESSAGE_DELETED: 'message_deleted',
  CHARACTER_DELETED: 'characterDeleted',
  MEDIA_ATTACHMENT_DELETED: 'media_attachment_deleted',
}

async function shimContract(src, c) {
  let product = null
  let productErr = null
  try { product = shimProductOf(src) } catch (e) { productErr = String((e && e.message) || e) }
  // before 臂（旧源码，没有垫片）必然取不到 ⇒ 报成一条红，而不是崩在半路
  if (product === null) {
    c.check('★★★ 垫片产物存在且可解析（旧源码没有垫片 ⇒ 这组必然红）', false,
      'extractFunction/muvCardCompatScript 取不到: ' + productErr)
    return
  }
  let parseErr = null
  try { new Function(product) } catch (e) { parseErr = String((e && e.message) || e) }
  c.check('★★★ 垫片产物在 Node 侧可解析（第 36 轮踩过：`};` 少一个分号 ⇒ 从 `var tavernEvents` 起整段垫片不执行）',
    parseErr === null, parseErr === null ? product.length + ' 字符整段可解析' : 'SyntaxError: ' + parseErr)

  // ★ 变异臂：把那一个 `;` 摘掉，必须**真的**变红 —— 否则上面那条是永真。
  const mutated = product.replace('};var TH={', '}var TH={')
  let mutErr = null
  try { new Function(mutated) } catch (e) { mutErr = String((e && e.message) || e) }
  c.check('★★ 变异臂：把产物里 `};var TH=` 的 `;` 摘掉 ⇒ 必须不可解析（判据能红）',
    mutated !== product && mutErr !== null,
    mutated === product ? '变异没生效（产物里找不到 `};var TH={`）' : ('变异后 ' + (mutErr ? '如预期解析失败: ' + mutErr : '竟然仍可解析')))

  const run = runShim(product)
  if (run.threw) {
    c.check('★★★ 垫片产物能跑完（最小 window 桩下不抛）', false, run.threw)
    return
  }
  const w = run.win
  c.check('★★★ 垫片产物能跑完（最小 window 桩下不抛）', true, '留痕 ' + run.logs.length + ' 条')

  // ── errorCatched：ST `src/function/util.ts:17`（纯函数版）+ `:43`（iframe 绑定版）
  //    ⇒ `src/iframe/predefine.js:14-18` 去下划线后成为**裸全局**。语义四条见 client.js 注释。
  c.check('★★★ 裸全局 `errorCatched` 是函数（真机那条 ReferenceError 的判据）',
    typeof w.errorCatched === 'function', typeof w.errorCatched)
  if (typeof w.errorCatched === 'function') {
    const wrapped = w.errorCatched(function (a, b) { return a + b })
    c.check('★★★ `errorCatched(fn)` **返回包装函数**（卡里是 `$(errorCatched(init))`：jQuery 的 `$(fn)` 是 ready 回调 ⇒ 返回非函数就当场抛）',
      typeof wrapped === 'function', typeof wrapped)
    c.check('★★ 包装函数透传返回值与入参', wrapped(1, 2) === 3, String(typeof wrapped === 'function' ? wrapped(1, 2) : 'n/a'))
    let threwMsg = null
    try { w.errorCatched(function () { throw new Error('boom-契约') })() } catch (e) { threwMsg = String((e && e.message) || e) }
    c.check('★★ 同步抛 ⇒ toastr 留痕之后 **rethrow**（不吞掉 —— ST 是 `throw error`，不是 return）',
      threwMsg === 'boom-契约', JSON.stringify(threwMsg))
    // 返回的 promise：ST 走 `then(undefined, onError)`，onError 里 toastr 之后 `throw` ⇒
    // 包装结果必须**仍被拒**（卡里 `await errorCatched(x)()` 才能照常炸出来）。
    // 微任务要等一拍才落定，所以这里 await 一次 setTimeout(0)（`runArm` 是 async）。
    let outcome = 'pending'
    const rejected = w.errorCatched(function () { return Promise.reject(new Error('rej-契约')) })()
    if (!rejected || typeof rejected.then !== 'function') outcome = '不是 thenable'
    else rejected.then(() => { outcome = 'resolved' }, () => { outcome = 'rejected' })
    await new Promise((r) => setTimeout(r, 0))
    c.check('★★ 返回的 promise 被拒 ⇒ 包装结果**仍是被拒**（不吞、不翻成 resolved）',
      outcome === 'rejected', outcome)
  }

  // ── tavern_events：ST `src/function/event.ts:180-263`（82 条），`index.ts:311` 挂在 TavernHelper 上
  const te = w.tavern_events
  c.check('★★★ 裸全局 `tavern_events` 是对象', !!te && typeof te === 'object', typeof te)
  if (te) {
    const keys = Object.keys(te)
    c.check('★★★ `tavern_events` 条数与 ST 的常量表一致（82 条）', keys.length === 82, String(keys.length))
    const wrong = Object.keys(ST_EVENT_ANCHORS).filter((k) => te[k] !== ST_EVENT_ANCHORS[k])
    c.check('★★★ `tavern_events` 的取值逐字等于 ST（APP_READY/MESSAGE_DELETED/CHARACTER_DELETED/MEDIA_ATTACHMENT_DELETED 四个锚点 + 大小写怪例 `characterDeleted`）',
      wrong.length === 0, wrong.length ? wrong.map((k) => k + '=' + JSON.stringify(te[k])).join(' ') : '四个锚点全对')
    c.check('★ 同值别名也照抄（ST 自己留的 `SMOOTH_STREAM_TOKEN_RECEIVED` / `STREAM_TOKEN_RECEIVED` 同值；删任何一个都会让走它的卡拿到 undefined）',
      te.SMOOTH_STREAM_TOKEN_RECEIVED === 'stream_token_received' && te.STREAM_TOKEN_RECEIVED === 'stream_token_received',
      JSON.stringify([te.SMOOTH_STREAM_TOKEN_RECEIVED, te.STREAM_TOKEN_RECEIVED]))
  }

  // ── TavernHelper 上也要有（ST `index.ts:311` / `:433`）
  const th = w.TavernHelper
  c.check('★★ `TavernHelper.errorCatched` / `TavernHelper.tavern_events` 同时在（ST 的 TavernHelper 上本来就有）',
    !!th && typeof th.errorCatched === 'function' && !!th.tavern_events, th ? Object.keys(th).length + ' 个成员' : String(th))

  // ── SillyTavern：`saveChat` 是 lodash `Expected a function` 的**真因**
  const st = w.SillyTavern
  c.check('★★★ `SillyTavern` 落位的是 `{...getContext(), getContext}` 形状且**逐次重算**（ST `iframe/predefine.js:26-34` 就是 defineProperty getter）',
    !!st && typeof st.getContext === 'function' && typeof st.getChatMessages === 'undefined' && Array.isArray(st.chat),
    st ? 'chat=数组:' + Array.isArray(st.chat) + ' getContext=' + typeof st.getContext : String(st))
  c.check('★★★ `SillyTavern.saveChat` 是函数（真机 `lodash.min.js:84 Expected a function` 的根因：MVU bundle 顶层 `_.debounce(SillyTavern.saveChat, 1e3)` 拿到 undefined）',
    !!st && typeof st.saveChat === 'function', st ? typeof st.saveChat : String(st))
  if (st && typeof st.saveChat === 'function') {
    let isThenable = false
    try { const r = st.saveChat(); isThenable = !!r && typeof r.then === 'function' } catch (e) { isThenable = 'throw:' + e.message }
    c.check('★★ `saveChat()` 返回 thenable（卡的 `await saveChat()` 不能挂；DSH 没有落盘动作 ⇒ 返回已完成 Promise + 首次留痕）',
      isThenable === true, String(isThenable))
  }
  // 卡侧证据链：`hostChat` 是模块级数组，宿主会用 `__muvChat` 消息**整条替换**它。
  // 所以 `SillyTavern.chat` 不能是快照 —— 这里钉"两次取值拿到同一个引用"，
  // 用 `def`（固定值）而不是 `defGet`（逐次重算）时这条会红。
  c.check('★★ `SillyTavern.chat` 与 `getContext().chat` 是**同一个数组**（宿主整条替换 `hostChat` 时两边一起更新，不是钉死的快照）',
    !!st && Array.isArray(st.chat) && st.getContext().chat === st.chat,
    st ? '同引用=' + (st.getContext().chat === st.chat) + ' 是数组=' + Array.isArray(st.chat) : String(st))

  // ── 「只在缺失时补」：卡自己定义了就不许动（与 withCardCompat 里所有落位同一口径）
  const seedFn = function sentinelErrorCatched() { return '卡自己的' }
  const seedEv = { CARD_OWN: true }
  const seeded = runShim(product, { errorCatched: seedFn, tavern_events: seedEv })
  c.check('★★★ 卡自己定义了 `errorCatched` / `tavern_events` ⇒ 垫片**不覆盖**（真机那张卡自己会从 predefine 拿，不许被我们换掉）',
    seeded.threw === null && seeded.win.errorCatched === seedFn && seeded.win.tavern_events === seedEv,
    seeded.threw ? '跑不起来: ' + seeded.threw
      : 'errorCatched 保持=' + (seeded.win.errorCatched === seedFn) + ' tavern_events 保持=' + (seeded.win.tavern_events === seedEv))
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
  // ★ `PushChatLog` 必须在 KEEP 里：`muvPushChatLog`（宿主把已装饰消息记进 chat 环形
  //   缓冲的产品入口）不含 "muvChat" 子串（是 Push**Chat**Log），KEEP 匹配不到 ⇒
  //   夹具的 `__pick(typeof muvPushChatLog …)` 落到 no-op 兜底 ⇒ ③b 恒红
  //   （宿主侧 chatLog 条数=0、子侧 chat 永远扫不到消息）。2026-09-22 实测。
  const KEEP = /Frame|CardCompat|CardReset|VhMinHeight|escAttr|ScriptRanges|muvHostViewport|muvJsonSafe|muvChat|muvKv|muvCompatKey|muvCompatSeedMap|PushChatLog/
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
  // ★ `muvKv` / `muvChatLog` 只在**提取出来的文本没有声明**它们时才兜底注入。
  //   为什么必须保留兜底：旧源码（324b751）里这两个名字**根本不存在**（它们是这一轮新加的
  //   父页记账容器），而 `muvChatList` / `muvCompatSeedMap` 这些被提取到的函数会引用它们 ⇒
  //   before 臂会在第一次 spawn 抛 `ReferenceError: muvKv is not defined`，整条门禁在半路崩掉、
  //   连汇总行都打不出来。
  //   为什么不能**无条件**注入：现版源码里已经有 `var muvKv = {}` / `var muvChatLog = []`，
  //   再塞一份就会在夹具里造出**第二份绑定** —— 夹具写一份、产品函数读另一份。D1 / ③b / ★ / ★★
  //   那几条红就是这么来的：`RT.kv[ns]` 里躺着夹具塞的 `ft2_cg_state`，而 `muvCompatSeedMap`
  //   读的是另一份（只看得到子 iframe 自己写回去的 `probe_key` / `ft2_cg_cache_v2`）。
  const declRe = (n) => new RegExp('\\bvar\\s+' + n + '\\s*=')
  for (const n of ['muvKv', 'muvChatLog']) {
    const already = declRe(n).test(out) || head.some((h) => declRe(n).test(h))
    if (!already) head.push('  var ' + n + ' = ' + (n === 'muvKv' ? '{}' : '[]') + ';')
  }
  console.log('  [夹具] 提取文本里自己声明了 muvKv=' + declRe('muvKv').test(out) +
    ' muvChatLog=' + declRe('muvChatLog').test(out) +
    ' ⇒ 兜底注入=' + JSON.stringify(head.filter((h) => /var muv(Kv|ChatLog)/.test(h))))
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
    // ★ D1 的根因就在这一行：产品落库的命名空间是 `muvKvTouch(卡键)`（= `<卡键>@<会话 id>`，
    //   见 lib/client.js:2240 与 muvKvKeyOf 的注释），**不是**裸的 `data-muv-kv` 属性值。
    //   夹具此前直接写 `RT.kv[name]` ⇒ 值进了一个产品从不读的键，`muvCompatSeedMap` 里
    //   自然没有它，子 iframe `getItem` 只能拿到 null。这不是垫片的前缀 bug（垫片写的
    //   `probe_key` / `ft2_cg_cache_v2` 都带 `L:` 前缀出现在 seedMap 里，说明前缀机制是好的）。
    //   把产品自己的 key 派生函数借过来，夹具才和产品写同一本账。
    '  nsOf: __pick(typeof muvKvTouch === "undefined" ? undefined : muvKvTouch, function (k) { return k; }),',
    '  pushChatLog: __pick(typeof muvPushChatLog === "undefined" ? undefined : muvPushChatLog, function () {}),',
    '  chatList: __pick(typeof muvChatList === "undefined" ? undefined : muvChatList, function () { return []; }),',
    '  seedMap: __pick(typeof muvCompatSeedMap === "undefined" ? undefined : muvCompatSeedMap, function () { return {}; }) };',
    // ★ 安装产品**父页侧**的消息处理器（KV 快照回送 + ERA 应答 + 用户消息桥都由它分发）。
    //   旧源码没有它 ⇒ typeof 判定跳过，before 臂照常跑（它要红的是断言）。
    'if (typeof onMuvCardCompatMessage === "function") { window.addEventListener("message", onMuvCardCompatMessage, false); }',
    'window.__userSendLog = [];',
    'window.addEventListener("message", function (e) { var d = e.data || {}; if (d.__muvUserSend) window.__userSendLog.push(d.__muvUserSend); });',
    'window.__inputVal = function () { var t = document.getElementById("dsh-input"); return t ? t.value : null };',
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
    /**
     * 把值种进宿主 KV。
     *
     * ★ 这里**同时**走两条路，刻意不假设"夹具写的对象就是产品读的对象"：
     *   ① RT.kv[RT.nsOf(name)]：直写（方便肉眼观察）；
     *   ② 合成一条来自**卡 iframe 自己**的 message（source = frame.contentWindow），
     *      喂给产品真正的写入口 onMuvCardCompatMessage —— 它用 muvKvTouch(卡键) 找命名空间，
     *      **不管产品内部的绑定长什么样都能落到同一本账上**。
     *   为什么必须加②：只走①时，RT.kv[ns] 里明明躺着夹具塞的 ft2_cg_state，而产品自己的读出口
     *   muvCompatSeedMap(key) 里却只有子 iframe 写回去的 probe_key —— 说明夹具写的位置和产品读的
     *   位置**不是同一处**。②让夹具改走产品的入口，测的才是被测对象。
     */
    seed: function (name, k, v) {
      try { var ns = RT.nsOf(name); (RT.kv[ns] = RT.kv[ns] || {})[k] = v } catch (e) { window.__compatSeedErr = 'direct:' + ((e && e.message) || e) }
      try {
        var f = built[0]
        if (f && typeof MessageEvent === 'function') {
          window.dispatchEvent(new MessageEvent('message', {
            data: { __muvKv: 'set', k: String(k), v: String(v) },
            source: f.contentWindow,
          }))
          window.__compatSeedSent = true
        }
      } catch (e) { window.__compatSeedErr = 'post:' + ((e && e.message) || e) }
      return true
    },
    seedErr: function () { return window.__compatSeedErr || null },
    /**
     * ★ 读出口一律走**产品自己的** muvCompatSeedMap（= 产品准备发给子 iframe 的那份账），
     *   而不是夹具自己写的那个对象。这样这三条读断言问的是"产品会告诉卡什么"，
     *   不掺任何关于内部绑定的假设。
     */
    kvHas: function (name) { var m = RT.seedMap(name) || {}; return Object.prototype.hasOwnProperty.call(m, 'L:ft2_cg_state') },
    kvGet: function (name, k) { var m = RT.seedMap(name) || {}; return Object.prototype.hasOwnProperty.call(m, 'L:' + k) ? m['L:' + k] : null },
    kvDump: function (name) { return JSON.stringify(RT.seedMap(name) || {}) },
    chatLen: function () { return RT.chatLog.length },
    /**
     * ★ 走**产品自己的** chat 入口 muvPushChatLog（= 宿主把已装饰消息记进环形缓冲的那个函数），
     *   而不是直接 push 夹具自己的数组。理由与 KV 那两条完全一样：实测夹具数组长度=1 而
     *   **产品自己的视图** muvChatList().length=0 —— 夹具写的数组与产品读的缓冲不是同一处，
     *   于是 ③b（卡的 getContext().chat 要扫到消息）永远测不到东西。
     *   回退保留数组 push，是为了旧源码（324b751）里没有这个函数时夹具仍能跑（那臂本来就该红）。
     */
    pushChat: function (t) {
      if (typeof RT.pushChatLog === 'function') { RT.pushChatLog(String(t)); return true }
      RT.chatLog.push(String(t)); return true
    },
    chatProductView: function () { return (typeof muvChatList === 'function') ? muvChatList().length : 'NO_FN' },
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
<!-- ★ 交互桥的落点：一个与 DSH 聊天输入框同口径的 textarea（placeholder 关键词 + rows≥2
     两条寻找路径都命中），产品函数 muvDeliverUserText 会写进它。 -->
<textarea id="dsh-input" rows="3" placeholder="输入消息"></textarea>
<div id="sent"></div>
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

/**
 * 求值；失败时 `err` 是**完整异常描述**（安全断言要从中认 SecurityError）。
 *
 * ★ 关键：失败时**不要**只返回 `{err}` 而让 `.value` 是 undefined —— 每一个断言都写
 *   `jparse(r.value, {})`，于是 `SyntaxError`（比如门禁自己少了半个花括号）会**静默**
 *   变成一个空对象，FAIL 行只显示 `-> {}`，读的人分不清是产品问题还是门禁自己写错了。
 *   实测代价：8 条内嵌表达式语法坏，整门的核心判据全废却看不出原因。
 *   所以这里把 `err` 也塞进 `value`（一个 JSON 字符串）⇒ 任何走 `jparse` 的断言都会把
 *   `__evalError` 打在 FAIL 行上。返回值本身仍带 `err`，不影响既有断言。
 */
async function evalIn(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  if (r.error) {
    const msg = 'CDP 协议错: ' + JSON.stringify(r.error).slice(0, 200)
    return { err: msg, value: JSON.stringify({ __evalError: msg }) }
  }
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    const msg = (d.exception && d.exception.description) || d.text || 'exception'
    return { err: msg, value: JSON.stringify({ __evalError: String(msg).split('\n')[0].slice(0, 220) }) }
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

  // ⑪ 垫片契约（第 36 轮）：**在起浏览器之前**先跑。它不需要浏览器，而且 before 臂
  //    （旧源码、没有垫片）在这里就要红 —— 不让"垫片缺失"伪装成后面的 OOPIF 读不到。
  await shimContract(arm.source, c)

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

    const cgj = jparse((await a('JSON.stringify((function(){try{return {hasFn:typeof window.cgGetCache==="function",cb:window.cgGetCache?window.cgGetCache():null}}catch(e){return {hasFn:typeof window.cgGetCache==="function",err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('② 走卡自己的入口 window.cgGetCache() 能读回垫片预置的值',
      cgj.hasFn === true && cgj.cb && typeof cgj.cb === 'object' && cgj.cb.SFW && cgj.cb.NSFW,
      'hasFn=' + cgj.hasFn + ' 返回=' + JSON.stringify(cgj.cb) + (cgj.err ? ' err=' + cgj.err : ''))

    const cgState = jparse((await a('JSON.stringify((function(){try{return {s:localStorage.getItem("ft2_cg_state")}}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    // ★ D1 取证：种子的**键名**到底是带 `L:` 前缀（父页 muvCompatSeedMap 的写法）还是裸键？
    //   两条可能要：父页那边 seedMap 产出的键、子 iframe 里真正收到的 __muvKvSeed 键。
    const seedHost = jparse((await evalIn(cdp, pageSession, 'JSON.stringify((function(){try{var RT=window.__compatRuntime||{};var ns=RT.nsOf?RT.nsOf(' + JSON.stringify(attrKv) + '):"NO_NSOF";var kv=(RT.kv||{})[ns]||{};var sm=RT.seedMap?RT.seedMap(' + JSON.stringify(attrKv) + '):null;return {nsOf:ns,kvKeys:Object.keys(kv),kvAll:Object.keys(RT.kv||{}),seedMapKeys:sm?Object.keys(sm):"NO_SEEDMAP",seedMapVal:sm?JSON.stringify(sm).slice(0,200):null}}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    const seedChild = jparse((await a('JSON.stringify((function(){try{var s=window.__muvKvSeed;return {seedKeys:s?Object.keys(s):null,bare:s?s["ft2_cg_state"]:null,prefixed:s?s["L:ft2_cg_state"]:null}}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    console.log('    D1 取证 父页: ' + JSON.stringify(seedHost))
    console.log('    D1 取证 子 iframe: ' + JSON.stringify(seedChild))
    c.check('②b 种子是按 key 精确落地的（不是"碰巧没报错"）', cgState.s === STATE_SEED,
      JSON.stringify(cgState).slice(0, 160) + ' | 子侧种子键=' + JSON.stringify(seedChild.seedKeys) +
      ' 裸键值=' + JSON.stringify(seedChild.bare) + ' 前缀键值=' + JSON.stringify(seedChild.prefixed) +
      ' | 父页 seedMap 键=' + JSON.stringify(seedHost.seedMapKeys))

    // ③ getContext().chat
    const ctxj = jparse((await a('JSON.stringify((function(){try{var x=window.SillyTavern&&window.SillyTavern.getContext?window.SillyTavern.getContext():null;return {has:!!x,chatType:Array.isArray(x&&x.chat)?"array":typeof(x&&x.chat),n:(x&&x.chat?x.chat.length:-1),hit:!!(x&&x.chat&&JSON.stringify(x.chat).indexOf(' + JSON.stringify(CHAT_MARK) + ')>=0),first:x&&x.chat?String(x.chat[0]):null,chatLogKeys:(window.__muvChat&&window.__muvChat.list)?("list:"+window.__muvChat.list.length):"no__muvChat"}}catch(e){return {has:false,err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('③ window.SillyTavern.getContext().chat 是数组', ctxj.chatType === 'array', 'chat=' + ctxj.chatType + ' n=' + ctxj.n)
    c.check('③b chat 里带着宿主喂进来的消息文本（卡的 cgScanChat 要扫它）', ctxj.hit === true,
      '命中=' + ctxj.hit + ' has=' + ctxj.has + ' 类型=' + ctxj.chatType + ' 子侧条数=' + ctxj.n +
      ' 宿主侧 RT.chatLog 条数=' + (await evalIn(cdp, pageSession, 'window.__compat.chatLen()')).value +
      ' 产品自己的视图 muvChatList().length=' +
      (await evalIn(cdp, pageSession, 'JSON.stringify((function(){try{return (typeof muvChatList==="function")?muvChatList().length:"NO_FN"}catch(e){return "THROW:"+e.message}})())')).value +
      ' | 子侧第一条=' + JSON.stringify(String((ctxj.first || '')).slice(0, 120)))

    // ④ 事件总线
    const evj = jparse((await a('JSON.stringify((function(){try{' +
      'var names=["eventOn","eventEmit","eventOnce","eventOff","eventClearAll"];var miss=[];for(var i=0;i<names.length;i++)if(typeof window[names[i]]!=="function")miss.push(names[i]);' +
      'if(miss.length)return {err:"missing:"+miss.join(",")};' +
      'var got=[];function f(d){got.push("on:"+d)};eventOn("t:a",f);eventEmit("t:a",1);eventOff("t:a",f);eventEmit("t:a",2);' +
      'var once=0;eventOnce("t:b",function(){once++});eventEmit("t:b",1);eventEmit("t:b",2);' +
      'eventClearAll();eventEmit("t:a",3);' +
      'return {got:got.join("|"),once:once}}catch(e){return {err:String((e&&e.name)||e)+":"+String((e&&e.message)||"").slice(0,120)}}})())')).value, {})
    c.check('④ eventOn/eventEmit/eventOnce/eventOff/eventClearAll 存在且调用不抛',
      !evj.err && evj.once === 1 && evj.got === 'on:1', JSON.stringify(evj))

    // ⑤ 视口高变量
    const hostH = (await evalIn(cdp, pageSession, 'window.innerHeight')).value
    const vhj = jparse((await a('JSON.stringify({v:String(document.documentElement.style.getPropertyValue("--TH-viewport-height")||"")})')).value, { v: '' })
    c.check('⑤ --TH-viewport-height = 宿主视口高（不是 iframe 自己的高度）',
      /^\d+px$/.test(vhj.v) && Number(vhj.v.replace('px', '')) === hostH, JSON.stringify(vhj) + ' 宿主 innerHeight=' + hostH)

    // ⑧ ★ 卡 → 宿主「用户消息桥」（2026-09-22）：垫片定义 sendUserMessage + 隐藏收件箱
    //    （卡自查自文档 #send_textarea 的路径），两者触发后宿主的聊天输入框都必须被填入。
    const bridge = jparse((await a('JSON.stringify((function(){try{' +
      'return {sendFn:typeof window.sendUserMessage,inbox:document.querySelectorAll("[data-muv-inbox]").length,' +
      'hasInboxId:!!document.getElementById("send_textarea")}}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('⑧ 垫片定义了 window.sendUserMessage（真卡 sendToTavern 的首选路径）',
      bridge.sendFn === 'function', JSON.stringify(bridge))
    c.check('⑧b 隐藏收件箱 #send_textarea 已装上（主页卡 fillSendTextarea 的自文档路径）',
      bridge.inbox === 1 && bridge.hasInboxId === true, JSON.stringify(bridge))
    // 触发 ①：卡调 sendUserMessage（ERA 卡首选）→ 宿主要把文本写进聊天输入框
    await a('window.sendUserMessage(' + JSON.stringify('MUVPROBE-A') + ')')
    const gotA = await until(cdp, pageSession, 'window.__inputVal()===' + JSON.stringify('MUVPROBE-A'))
    c.check('★★ 卡调 sendUserMessage → 宿主聊天输入框被填入（不是"什么都没发生"）', gotA === true,
      '输入框=' + JSON.stringify(String((await evalIn(cdp, pageSession, 'window.__inputVal()')).value)).slice(0, 80))
    await sleep(1000)   // 每帧 800ms 节流：第二次触发要跨过窗口
    // 触发 ②：卡往自己的隐藏收件箱写值并派发 input（主页卡的 fillSendTextarea 路径）
    await a('(function(){var t=document.getElementById("send_textarea");if(!t)return;t.value=' +
      JSON.stringify('MUVPROBE-B') + ';t.dispatchEvent(new Event("input",{bubbles:true}))})()')
    const gotB = await until(cdp, pageSession, 'window.__inputVal()===' + JSON.stringify('MUVPROBE-B'))
    c.check('★★ 卡写隐藏收件箱 → 宿主输入框被填入（fill 模式，与卡的提示语一致）', gotB === true,
      '输入框=' + JSON.stringify(String((await evalIn(cdp, pageSession, 'window.__inputVal()')).value)).slice(0, 80))
    const sendLog = (await evalIn(cdp, pageSession, 'JSON.stringify(window.__userSendLog||[])')).value
    c.check('⑧c 两条触发都进入了宿主的消息处理链（模式分别是 send / fill）',
      /"mode":"send"/.test(String(sendLog)) && /"mode":"fill"/.test(String(sendLog)),
      String(sendLog).slice(0, 200))

    // ── ⑩ 变量宿主 API 垫片：TavernHelper / Mvu / 裸全局 / triggerSlash 白名单 ──
    //
    // 为什么必须有这一组：新导入的 MVU 卡（实测 `1.txt`）`stat_data × 105`、`Mvu. × 53`、
    // `getVariables( × 17`、`insertOrAssignVariables( × 3`、`triggerSlash( × 6` —— 缺任何一个
    // 都是"卡什么都不显示 / 按钮点不动"，而**控制台毫无动静**（没有异常、没有请求）。
    // 判据分三层：① 对象与方法在不在（旧源码必然没有 ⇒ before 臂红）；
    // ② 卡的**真实读写链**能不能走通（同步读拿到 stat_data、写/命令进宿主记账）；
    // ③ 白名单之外的命令**不执行**（"假装做过"比"没做"更坏）。
    //
    // 计数器要在**这一组开头**装好：垫片的 `__muvMvuReq` 是子文档起来时就发过一次的，
    // 装晚了就永远看不到（那会变成一条"永远为真/永远为假"的空转判据）。
    await evalIn(cdp, pageSession, 'window.__mvuReqs=[];window.__varWrites=[];window.__mvuEvents=[];' +
      'window.addEventListener("message",function(e){var d=e.data||{};' +
      'if(d.__muvMvuReq!==undefined)window.__mvuReqs.push(1);' +
      'if(d.__muvVarWrite)window.__varWrites.push(d.__muvVarWrite);' +
      'if(d.__muvEvent&&d.__muvEvent.name)window.__mvuEvents.push(d.__muvEvent.name)})')
    const shimApi = jparse((await a('JSON.stringify((function(){try{' +
      'var TH=window.TavernHelper,Mvu=window.Mvu;' +
      'var thFns=["getVariables","replaceVariables","insertOrAssignVariables","triggerSlash",' +
      '"eventOn","eventEmit","getChatMessages","formatAsTavernRegexedString"];' +
      'var missTH=[];for(var i=0;i<thFns.length;i++)if(typeof (TH||{})[thFns[i]]!=="function")missTH.push(thFns[i]);' +
      'var missMvu=[];var mvuFns=["getMvuData","replaceMvuData"];' +
      'for(var j=0;j<mvuFns.length;j++)if(typeof (Mvu||{})[mvuFns[j]]!=="function")missMvu.push(mvuFns[j]);' +
      'var bare=["insertOrAssignVariables","getVariables","replaceVariables","triggerSlash","getLastMessageId",' +
      '"formatAsTavernRegexedString","getChatMessages"];' +
      'var missBare=[];for(var k=0;k<bare.length;k++)if(typeof window[bare[k]]!=="function")missBare.push(bare[k]);' +
      'var md=Mvu&&typeof Mvu.getMvuData==="function"?Mvu.getMvuData():null;' +
      'var th=TH&&typeof TH.getVariables==="function"?TH.getVariables({type:"chat"}):null;' +
      'return {thType:typeof TH,mvuType:typeof Mvu,missTH:missTH.join(","),missMvu:missMvu.join(","),' +
      'missBare:missBare.join(","),thVer:(TH&&TH.version)||null,' +
      'mvuEvents:(Mvu&&Mvu.events&&Mvu.events.VARIABLE_UPDATE_ENDED)||null,' +
      'mdHas:!!(md&&md.stat_data),thHas:!!(th&&th.stat_data),' +
      'format:(TH&&typeof TH.formatAsTavernRegexedString==="function")?String(TH.formatAsTavernRegexedString("原文","user",0)):null,' +
      'chatIsArr:(TH&&typeof TH.getChatMessages==="function")?Array.isArray(TH.getChatMessages()):null};' +
      '}catch(e){return {err:String((e&&e.name)||e)+":"+String((e&&e.message)||"").slice(0,120)}}})())')).value, {})
    c.check('⑩ 垫片提供 window.TavernHelper 且八个方法齐全（缺一个就是一类卡全废）',
      shimApi.thType === 'object' && !shimApi.missTH && !shimApi.err,
      'type=' + shimApi.thType + ' 缺=' + JSON.stringify(shimApi.missTH) + ' version=' + JSON.stringify(shimApi.thVer))
    c.check('⑩b 垫片提供 window.Mvu（getMvuData / replaceMvuData）+ events.VARIABLE_UPDATE_ENDED',
      shimApi.mvuType === 'object' && !shimApi.missMvu && shimApi.mvuEvents === 'mag_variable_update_ended',
      'type=' + shimApi.mvuType + ' 缺=' + JSON.stringify(shimApi.missMvu) + ' events=' + JSON.stringify(shimApi.mvuEvents))
    c.check('⑩c 裸全局也有（酒馆助手在 ST 里就是注入裸全局；实测卡两种写法都有）',
      !shimApi.missBare, '缺=' + JSON.stringify(shimApi.missBare))
    c.check('⑩e Mvu.getMvuData()/getVariables(scope) 都是 {stat_data:…} 形状（卡的 pickStat 只认它）',
      shimApi.mdHas === true && shimApi.thHas === true, JSON.stringify({ mdHas: shimApi.mdHas, thHas: shimApi.thHas }))
    c.check('⑩f formatAsTavernRegexedString 原样返回；getChatMessages() 是数组',
      shimApi.format === '原文' && shimApi.chatIsArr === true,
      'format=' + JSON.stringify(shimApi.format) + ' chatIsArr=' + JSON.stringify(shimApi.chatIsArr))

    // ★ 父页探测：判据必须照**真卡的实际形状**写，不能照想象写。
    //   取证（C:\deepseek harness\_scratch\probe2.out.txt，从 1.txt 里逐字抠出来的 resolveTH）：
    //     function resolveTH(){ var c=[]; try{c.push(window.TavernHelper)}catch(e){}
    //       try{c.push(W.TavernHelper)}catch(e){} try{c.push(window.parent&&window.parent.TavernHelper)}catch(e){} … }
    //   也就是「**多条探针各自 try 包住**，`window.X` 排第一，父页/顶层只是备选」。
    //   ★ 关键事实（同一次取证 + verify-era-bridge 的反向断言）：沙箱是不透明来源 ⇒
    //     `window.parent.TavernHelper` 是**抛 SecurityError**，不是"返回 undefined"。
    //     所以在我们这儿「父页回落」根本不靠 `||` 短路 —— 靠的是**把同名对象定义在卡自己的 window 上**。
    //     （不去为了迁就 `window.parent.X || window.X` 放宽沙箱：那是把隔离换便利，本项目不换。）
    //   判据三件套：① 真卡那条探针链命中的是我们这份；② `W`（卡的 `var W = …?window.parent:window`）
    //   在沙箱下必须解析成 `window` **本身**（否则卡里 `W.TavernHelper` 会取空）；③ 父页确实被拒。
    const parentProbe = jparse((await a('JSON.stringify((function(){try{' +
      'var W=(function(){try{return window.parent&&window.parent.document?window.parent:window}catch(e){return window}})();' +
      'function resolveTH(){var c=[];' +
      'try{c.push(window.TavernHelper)}catch(e){}' +
      'try{c.push(W.TavernHelper)}catch(e){}' +
      'try{c.push(window.parent&&window.parent.TavernHelper)}catch(e){}' +
      'for(var i=0;i<c.length;i++)if(c[i]&&typeof c[i].getVariables==="function")return c[i];return null}' +
      'var th=resolveTH();var parentThrew="";try{window.parent.TavernHelper}catch(e){parentThrew=String((e&&e.name)||e)}' +
      'return {wIsSelf:W===window,parentThrew:parentThrew,hit:!!th,hitVer:(th&&th.version)||null,' +
      'ownType:typeof window.TavernHelper,ownGet:typeof (window.TavernHelper||{}).getVariables,' +
      'mvuOnW:typeof (W.Mvu||{}).getMvuData};' +
      '}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('⑩d ★ 照真卡形状的探针链（各自 try + window.X 排第一）命中的是我们这份；W 解析成 window 自身',
      parentProbe.hit === true && parentProbe.ownType === 'object' && parentProbe.ownGet === 'function' &&
      parentProbe.wIsSelf === true && parentProbe.mvuOnW === 'function' && parentProbe.parentThrew === 'SecurityError',
      JSON.stringify(parentProbe))

    // ★ 宿主推来的变量必须被垫片吸收进缓存（`Mvu.getMvuData()` 是**同步**读 ——
    //   不吸进缓存就只能回初始值，表现是"服务端有真值、卡上是空的"）。
    const PROBE_TREE = { stat_data: { 金钱: 4242, 主角: { 名字: '探针' } } }
    await evalIn(cdp, pageSession, 'document.querySelectorAll("iframe.muv-iframe")[0].contentWindow.postMessage({__muvEvent:{name:"mag_variable_update_ended",detail:' + JSON.stringify(PROBE_TREE) + '}},"*")')
    await sleep(300)
    const absorbed = jparse((await a('JSON.stringify((function(){try{' +
      'var md=window.Mvu.getMvuData();' +
      'return {money:(md&&md.stat_data&&md.stat_data["金钱"]),name:(md&&md.stat_data&&md.stat_data["主角"]&&md.stat_data["主角"]["名字"]),' +
      'viaPath:window.Mvu.getMvuVariable("stat_data.金钱",0),viaFlat:window.Mvu.getMvuVariable("金钱",0),' +
      'viaTh:window.TavernHelper.getVariables("金钱",{defaultValue:0})};' +
      '}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('⑩g ★★ 宿主推来的 mag_variable_update_ended 被吸收：同步读立刻拿到新值（含扁平路径兜底）',
      absorbed.money === 4242 && absorbed.name === '探针' && absorbed.viaPath === 4242 &&
      absorbed.viaFlat === 4242 && absorbed.viaTh === 4242,
      JSON.stringify(absorbed))
    // 垫片启动时就该问过一次 MVU 数据（跨过 1s 节流窗口后再补一次，保证判据不靠时序运气）
    await sleep(1100)
    await a('window.Mvu.getMvuData()')
    const sawReq = await until(cdp, pageSession, '(window.__mvuReqs||[]).length>=1', 3000)
    c.check('⑩h 垫片启动即向宿主问过一次 MVU 数据（__muvMvuReq）', sawReq === true,
      'reqs=' + (await evalIn(cdp, pageSession, 'JSON.stringify(window.__mvuReqs||[])')).value)
    // 卡自己的刷新钩子：`eventOn('mag_variable_update_ended', ingestMvuEvent)` 必须被触发
    // （实测 `1.txt` 的 `bindEvents()` 就是这么订阅的）。吸收进缓存是"同步读"，
    // 事件派发是"刷 UI" —— 两件事都要成立，缺一个都是"卡上不动"。
    const evRecv = jparse((await a('JSON.stringify((function(){try{' +
      'window.__mvuEvSeen=[];window.eventOn("mag_variable_update_ended",function(d){window.__mvuEvSeen.push(d&&d.stat_data&&d.stat_data["金钱"])});' +
      'return {ok:typeof window.eventOn==="function"};}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    await evalIn(cdp, pageSession, 'document.querySelectorAll("iframe.muv-iframe")[0].contentWindow.postMessage({__muvEvent:{name:"mag_variable_update_ended",detail:' + JSON.stringify({ stat_data: { 金钱: 9090 } }) + '}},"*")')
    await sleep(300)
    c.check('⑩h2 ★★ 卡的 `eventOn("mag_variable_update_ended")` 收到 detail（刷新钩子真的被触发）',
      evRecv.ok === true && (await a('JSON.stringify(window.__mvuEvSeen||[])')).value === '[9090]',
      'preOk=' + JSON.stringify(evRecv) + ' seen=' + (await a('JSON.stringify(window.__mvuEvSeen||[])')).value)

    // ★★ triggerSlash 白名单：`/send` 要真的转发；名单外的 `/inject` **不许执行**（只警告）。
    //    "假装做过"比"如实没做"更坏：卡会以为注入成功，后面每一步都错。
    await a('window.__warns=[];(function(){var ow=console.warn;console.warn=function(m){window.__warns.push(String(m));try{ow.apply(console,arguments)}catch(e){}}})()')
    await sleep(1000)   // 用户消息桥每帧 800ms 节流：跨过窗口
    const inputBefore = await evalIn(cdp, pageSession, 'window.__inputVal()')
    await a('window.triggerSlash("/inject id=MUVPROBE position=chat depth=0")')
    await sleep(200)
    const injectWarns = jparse((await a('JSON.stringify({warns:window.__warns})')).value, { warns: [] })
    c.check('⑩i ★ 名单外命令 `/inject` 只 console.warn、不执行（警告文案里带命令原文）',
      Array.isArray(injectWarns.warns) && injectWarns.warns.some((w) => String(w).indexOf('triggerSlash 未支持：/inject') >= 0),
      JSON.stringify(injectWarns.warns))
    const inputAfterInject = await evalIn(cdp, pageSession, 'window.__inputVal()')
    c.check('⑩j ★ 名单外命令没有偷偷改写宿主输入框（没执行就是没执行）',
      String(inputAfterInject.value) === String(inputBefore.value),
      '前=' + JSON.stringify(inputBefore.value) + ' 后=' + JSON.stringify(inputAfterInject.value))
    await a('window.triggerSlash("/send MUVPROBE-TH")')
    const sentViaSlash = await until(cdp, pageSession, 'window.__inputVal()===' + JSON.stringify('MUVPROBE-TH'))
    c.check('⑩k ★ `/send 文本` 走白名单：宿主输入框被填入（不是"什么都没发生"）',
      sentViaSlash === true, '输入框=' + JSON.stringify(String((await evalIn(cdp, pageSession, 'window.__inputVal()')).value)).slice(0, 80))

    // `/setvar` 与写 API：必须在**宿主侧**看到 `__muvVarWrite` 记账（落库由宿主做）。
    await a('window.triggerSlash("/setvar 金钱 77")')
    await a('window.TavernHelper.insertOrAssignVariables({公司:{总现金:9}})')
    await a('window.Mvu.replaceMvuData({stat_data:{钱:1}})')
    await sleep(300)
    const writes = jparse((await evalIn(cdp, pageSession, 'JSON.stringify(window.__varWrites||[])')).value, [])
    c.check('⑩l ★★ 三条写 API（/setvar · insertOrAssignVariables · replaceMvuData）都进了宿主记账',
      Array.isArray(writes) && writes.length >= 3, '记账 ' + (Array.isArray(writes) ? writes.length : '?') + ' 条：' + JSON.stringify(writes).slice(0, 220))
    // 载荷语义：整树（带 stat_data）用 replace；增量/平铺用 merge。判错方向会把别的键抹掉。
    const wSetvar = (writes || []).find((w) => w && w.data && Object.prototype.hasOwnProperty.call(w.data, '金钱'))
    const wMvu = (writes || []).find((w) => w && w.data && w.data.stat_data)
    c.check('⑩m 平铺增量走 merge（replace=false），整树 stat_data 走 replace（replace=true）',
      !!wSetvar && wSetvar.replace === false && !!wMvu && wMvu.replace === true,
      'setvar=' + JSON.stringify(wSetvar) + ' mvu=' + JSON.stringify(wMvu))
    // `/setvar` 的本地值要能立刻读回（`/getvar` 是卡的常用读法）
    const getVarP = await a('(function(){try{return String(window.triggerSlash("/getvar 金钱"))}catch(e){return "THROW:"+e.message}})()')
    c.check('⑩n `/getvar` 返回 Promise（不抛异常）', String(getVarP.value).indexOf('THROW') < 0, String(getVarP.value))

    // 源码形状（before 臂必然没有 ⇒ 这一组能红）
    c.check('⑩o 源码里有 triggerSlash 白名单的警告文案（名单外必须 warning）',
      arm.source.includes('triggerSlash 未支持：'), 'hits=' + (arm.source.split('triggerSlash 未支持：').length - 1))
    c.check('⑩p 源码里有两条新通道（__muvMvuReq / __muvVarWrite）与 MVU 推送事件名',
      arm.source.includes('__muvMvuReq') && arm.source.includes('__muvVarWrite') &&
      arm.source.includes('mag_variable_update_ended'),
      JSON.stringify({
        req: arm.source.includes('__muvMvuReq'),
        write: arm.source.includes('__muvVarWrite'),
        ev: arm.source.includes('mag_variable_update_ended'),
      }))

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

    const bState = jparse((await b('JSON.stringify((function(){try{return {s:localStorage.getItem("ft2_cg_state")}}catch(e){return {err:String((e&&e.name)||e).slice(0,120)}}})())')).value, {})
    c.check('★★ 新建的 iframe B 首屏读到宿主的 ft2_cg_state（种子回送）',
      bState.s === STATE_SEED, JSON.stringify(bState).slice(0, 160))

    const bCache = jparse((await b('JSON.stringify((function(){try{return {v:localStorage.getItem("ft2_cg_cache_v2"),t:typeof localStorage.getItem("ft2_cg_cache_v2")}}catch(e){return {err:String((e&&e.name)||e).slice(0,120)}}})())')).value, {})
    // ★ 这条原先是 `bCache.v === A_PAYLOAD`（逐字字符串等值），lib 侧定性为**断言过紧**：
    //   壳回送的是**合并后**的对象（A 的条目 + 卡自己的条目），B 读到的 JSON 里同时有
    //   `SFW.帧A`（A 写的）和 `SFW.润羽露西娅`（卡自带的）—— 这正是"上一条解锁、下一条可见"
    //   要的效果，逐字等值却会把它判红。改成对**合并对象**断言，并**加一条更严的**：
    //   两份条目必须同时在（证明是合并而不是覆盖）。
    //   这条断言原本要证明的：**A 的写入跨 iframe 到达了 B** —— 改后仍证明它（查的就是 A 的
    //   标记 `SFW.帧A === [1,2]`），而且比原来多证明一条（合并不覆盖）。
    //   能红的证据：把 ⑥ 里 A 的 `setItem` 拿掉（或把 B 的种子断掉），`SFW.帧A` 就不存在 ⇒ 红。
    let merged = null
    try { merged = JSON.parse(bCache.v) } catch (_) { merged = null }
    const aEntry = !!(merged && merged.SFW && Array.isArray(merged.SFW['帧A']) && merged.SFW['帧A'].join(',') === '1,2')
    c.check('★★★ 新建的 iframe B 首屏读到 A 写入的 ft2_cg_cache_v2（跨 iframe 持久化闭环）',
      aEntry, 'B 读到=' + String(bCache.v).slice(0, 160) + ' 类型=' + bCache.t)
    // 「合并不覆盖」这条我上一版**加错了**，这里退回成信息行（不是放宽上面那条）：
    //   `setItem` 的语义就是**整值替换**，产品从没承诺"新写入会与旧值合并"。
    //   上一版之所以在 B 里看到两份条目（帧A + 润羽露西娅），是夹具"两本账"的副产物
    //   （读到的那份值里同时躺着卡自己走的另一条路写进去的内容），不是产品保证。
    //   现在夹具改走产品自己的写入口，B 读到的就是 A 写的那份：SFW 键=["帧A"]。
    console.log('  · 合并语义（信息，不作断言）: B 的 SFW 键=' + JSON.stringify(merged && merged.SFW ? Object.keys(merged.SFW) : null))

    const bOwn = jparse((await b('JSON.stringify((function(){try{return {hasFn:typeof window.cgGetCache==="function",cb:window.cgGetCache?window.cgGetCache():null}}catch(e){return {err:String((e&&e.name)||e)}}})())')).value, {})
    c.check('★★★ **卡自己**在 B 里就看得见 A 解锁的 CG（走 cgGetCache 的真实路径）',
      !!(bOwn.cb && bOwn.cb.SFW && Array.isArray(bOwn.cb.SFW['帧A']) && bOwn.cb.SFW['帧A'].join(',') === '1,2'),
      JSON.stringify(bOwn.cb))

    // ⑧ ★★ 安全护栏：反向断言，绝不能靠加 allow-same-origin 变绿
    const parentAj = jparse((await a('JSON.stringify((function(){try{var d=window.parent.document;return {reached:!!d,tag:d&&d.documentElement?d.documentElement.tagName:null}}catch(e){return {threw:true,name:String((e&&e.name)||e)}}})())')).value, { bad: true })
    report.security = { frameA: parentAj }
    c.check('★★ **反向断言**：卡内 `window.parent.document` 仍被拒（SecurityError 或 null）',
      (parentAj.threw === true && parentAj.name === 'SecurityError') || parentAj.reached === false, JSON.stringify(parentAj))
    const parentBj = jparse((await b('JSON.stringify((function(){try{var d=window.parent.document;return {reached:!!d}}catch(e){return {threw:true,name:String((e&&e.name)||e)}}})())')).value, {})
    c.check('★★ 同一护栏在 B 里也成立', (parentBj.threw === true && parentBj.name === 'SecurityError') || parentBj.reached === false, JSON.stringify(parentBj))

    // ⑨ 沙箱确实是不透明来源：卡碰不到宿主的**站点存储**
    await evalIn(cdp, pageSession, 'try{localStorage.setItem("__muvHostProbe","1")}catch(e){}')
    const leak = jparse((await a('JSON.stringify((function(){try{return {v:localStorage.getItem("__muvHostProbe")}}catch(e){return {threw:true,name:String((e&&e.name)||e)}}})())')).value, {})
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

/**
 * ★ 自检：本文件里**内嵌进 CDP 求值**的表达式，必须先在这里能解析。
 *
 * 为什么必须有：`evalIn` 拿到页面的 `SyntaxError` 时只会返回 `{value: undefined}`，
 * 而这门禁每个断言都写 `jparse(r.value, {…})` ⇒ 语法错**静默变成空对象/默认值**，
 * 显示成 `-> {}`，读的人分不清是"产品坏了"还是"门禁自己写错了"。
 * 实测代价：这一版上一轮有 **8 条**这样的表达式（都少了函数体的收尾 `}`），
 * 于是"垫片有没有生效"这一门的核心判据**全部无效**却看不出原因。这条自检把它们变成一句话。
 */
function selfCheckExpressions() {
  const own = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const bad = []
  for (const m of own.matchAll(/await [ab]?\('((?:[^'\\]|\\.)*)'\)/g)) {
    try { new Function('a', 'b', 'return ' + m[1] + ';') } catch (e) { bad.push({ err: e.message, text: m[1].slice(-100) }) }
  }
  return bad
}

const arms = buildArms()
const exprBad = selfCheckExpressions()
if (exprBad.length) {
  console.log('=== 自检: 门禁内嵌的求值表达式 ===')
  for (const b of exprBad) console.log('  FAIL ' + b.err + '   …' + b.text)
  console.log('\n=== 汇总 ===')
  console.log('  结论: 红：门禁自身有 ' + exprBad.length + ' 条内嵌表达式语法坏 —— 先修门禁，读数无意义')
  process.exit(1)
}
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
