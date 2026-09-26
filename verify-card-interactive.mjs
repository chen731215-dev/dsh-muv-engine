// 卡界面「可互动性」判定台 —— 判定「在 DSH 的沙箱 iframe 里，卡的面板到底能不能点」。
//
// 为什么不用截图对比、也不用 --dump-dom 探针（两种都被踩过）：
//   ✗ 探针画在子文档里：卡的 JS 会重绘 body 把它冲掉；position:fixed 也会被卡的 CSS 困住。
//   ✗ 子文档 postMessage 到 file:// 父页：实测收不到。
//   ✗ 父页读 iframe.contentDocument：要求 allow-same-origin，与生产沙箱不一致。
//   ✗ --dump-dom 只输出**顶层**文档：子文档里写什么都读不到。
//   ✓ 现在的做法：CDP（Chrome DevTools Protocol）。沙箱 iframe 会被 Chromium 换进**独立
//     渲染进程**（OOPIF，`Page.frameDetached reason:swap` → `Target.attachedToTarget`），
//     于是可以在**生产沙箱（allow-scripts）原封不动**的前提下：
//       ① 在子文档的 JS 上下文里求值（读 DOM、装 MutationObserver、看异常）；
//       ② 通过 Input 域派发**真实鼠标事件**（经浏览器命中测试，能发现遮罩/几何问题）；
//       ③ 把结论当作结构化数据取回 Node —— 不依赖任何跨源通道。
//
// 关键实现细节（都是实测出来的，别退回去）：
//   ★ `Target.setAutoAttach` 必须开在**页会话**上（sessionId），开在浏览器会话上抓不到
//     OOPIF 子框架（试验 2 全绿但 0 个子 target，试验 5 才对）。
//   ★ 窗口要够大（默认 1500x3200）：iframes 高，卡的面板可能落在窗口可视区之外，
//     真实鼠标事件在窗口外会被丢弃。窗口够大 + iframe 顶到页顶 ⇒ 帧内坐标即命中坐标。
//   ★ 夹具用 lib/client.js 里**逐字提取**的 `cardHtmlIframe` 生成 iframe（同一处 escAttr、
//     同一处 MUV_CARD_SANDBOX、同一处高度引导脚本），再用逐字提取的高度运行时装父页，
//     所以夹具与生产渲染路径一致，而不是「照抄一份」。
//   ★ 每个候选目标**重新加载**一次夹具：点开模态框之后，后面目标的命中会被遮罩吃掉，
//     共用一次加载会测出假阴性。
//
// 运行：
//   $env:MUV_EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
//   node verify-card-interactive.mjs --selftest                 # 工具可信度自检（必须全绿）
//   node verify-card-interactive.mjs --list                     # 列出真卡里的整页界面
//   node verify-card-interactive.mjs --doc=足控 --script=ERA --sel=.res-chip --text=世界
//   node verify-card-interactive.mjs --all                      # 全矩阵
//   node verify-card-interactive.mjs --doc=足控 --script=ERA --sel=.res-chip --shim=storage
//
// ⚠ 窗口尺寸的坑：卡的面板常常落在文档的 y≈2800px 处（ERA 的导航胶囊就在 y=2814）。
//   **真实鼠标事件在窗口外会被直接丢弃**，所以无头窗口必须至少和内容一样高 ——
//   本工具默认 `--window-size=1500,3200`，并且点击前会把目标 scrollIntoView 到帧视口中央。
//   自己复现时别用默认的 800 高窗口，否则会得到「点了没反应」的假阴性。
//
// 判据：`realClick` = 真实鼠标事件让「可见 DOM 签名」变了，或让 DOM 变更数**明显超出
// 同长度的空转基线**。空转基线是必需的：卡自己可能有轮播/计时器，一直产生变更。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-card-interactive')
mkdirSync(OUT, { recursive: true })
const CARD_DIR = process.env.MUV_CARD_DIR || 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'
const SRC = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')

// ─────────────────────────── CLI ───────────────────────────
const argv = process.argv.slice(2)
const flag = (name, def) => {
  const hit = argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='))
  if (!hit) return def
  if (hit === '--' + name) return true
  return hit.slice(name.length + 3)
}
const OPTS = {
  list: !!flag('list', false),
  all: !!flag('all', false),
  selftest: !!flag('selftest', false),
  doc: flag('doc', ''),
  script: flag('script', ''),
  sel: flag('sel', ''),
  text: flag('text', ''),
  index: Number(flag('index', 0)),
  maxTargets: Number(flag('max-targets', 2)),
  sandbox: String(flag('sandbox', 'prod')),           // prod = allow-scripts（与 DSH 一致）
  shim: String(flag('shim', '')),                     // storage = 内存版 localStorage/sessionStorage
  inject: String(flag('inject', '')),                 // 注入的 JS 文件（在卡代码之前执行）
  settle: Number(flag('settle', 1600)),
  wait: Number(flag('wait', flag('hold', 1500))),     // 等签名变化的截止时间（ms）
  json: String(flag('json', path.join(OUT, 'card-interactive-report.json'))),
  eval: String(flag('eval', '')),                     // 在卡文档上下文里额外求值一段表达式并打印
  evalParent: String(flag('eval-parent', '')),        // 在宿主夹具页里求值
  evalOnly: String(flag('eval-only', '')),            // 只跑 --eval，不点任何东西
}

const SANDBOX_PROD = /var\s+MUV_CARD_SANDBOX\s*=\s*(['"])allow-scripts\1/.exec(SRC)
  ? 'allow-scripts' : null
if (!SANDBOX_PROD) {
  console.log('!! 从 lib/client.js 里读不到 MUV_CARD_SANDBOX = \'allow-scripts\'，拒绝继续（免得用错沙箱出假结论）')
  process.exit(2)
}
const SANDBOX = OPTS.sandbox === 'diag' ? 'allow-scripts allow-same-origin' : SANDBOX_PROD

// ─────────────── 从 lib/client.js 逐字提取渲染函数（同 verify-visual.mjs 的判据） ───────────────
// 抄一套不共享的理由：verify-visual.mjs 是「执行即验证」的脚本，不可 import；且它是
// 必须保持全绿的门禁文件，不该为了复用去改它。这里的提取器与它同源、同步演进。

/** `/` 是正则字面量还是除号：看前一个有效字符与关键字。 */
function regexAllowed(src, j, prev) {
  if (!prev) return true
  if (!/[A-Za-z0-9_$)\]'"`]/.test(prev)) return true
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, j - 16), j))
  return !!(m && /^(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(m[1]))
}

/** 花括号配平地截出具名函数源码；必须跳过注释/字符串/模板串/正则字面量。 */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('找不到函数 ' + name)
  const open = src.indexOf('{', start)
  if (open < 0) throw new Error('找不到函数体 ' + name)
  let depth = 0
  let prev = ''
  for (let j = open; j < src.length; j++) {
    const c = src[j]
    const d = src[j + 1]
    if (c === '/' && d === '/') { const e = src.indexOf('\n', j); if (e < 0) break; j = e; prev = '\n'; continue }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', j + 2); if (e < 0) break; j = e + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      for (j++; j < src.length; j++) {
        if (src[j] === '\\') { j++; continue }
        if (src[j] === c) break
      }
      prev = c
      continue
    }
    if (c === '/' && regexAllowed(src, j, prev)) {
      let inClass = false
      for (j++; j < src.length; j++) {
        const e = src[j]
        if (e === '\\') { j++; continue }
        if (e === '\n') break
        if (e === '[') inClass = true
        else if (e === ']') inClass = false
        else if (e === '/' && !inClass) break
      }
      prev = '/'
      continue
    }
    if (c === '{') { depth++; prev = c; continue }
    if (c === '}') { depth--; prev = c; if (depth === 0) return src.slice(start, j + 1); continue }
    if (!/\s/.test(c)) prev = c
  }
  throw new Error('花括号不配平 ' + name)
}

/** 扫出「RHS 是纯字面量」的模块级 var 声明，返回声明原文（多行拼接的字符串必须逐字保留）。 */
function moduleVarStatements(src) {
  const out = {}
  for (const m of src.matchAll(/^\s*var\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
    const name = m[1]
    const start = m.index
    let i = m.index + m[0].length
    let depth = 0
    let quote = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        if (c === '\\') { i++; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ';' && depth === 0) { i++; break }
      else if (c === '\n' && depth === 0) {
        const sofar = src.slice(start, i).replace(/\s+$/, '')
        if (!/[+\-*/%.,([{=:?&|!<>]$/.test(sofar)) break
      }
    }
    const stmt = src.slice(start, i).trim()
    const rhs = stmt.replace(/^\s*var\s+[A-Za-z_$][\w$]*\s*=\s*/, '')
    const bare = rhs
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/\b(?:true|false|null|undefined)\b/g, '')
    if (/[A-Za-z_$][\w$]*/.test(bare)) continue
    out[name] = stmt
  }
  return out
}

const isDeclaredIn = (code, name) => new RegExp('(?:var|let|const|function)\\s+' + name + '\\b').test(code)
const isUsedIn = (code, name) => new RegExp('\\b' + name + '\\b').test(code)

function buildFrom(src, names, deps, ret) {
  const have = new Set()
  const queue = [...names]
  let out = ''
  while (queue.length) {
    const n = queue.shift()
    if (have.has(n)) continue
    have.add(n)
    const body = extractFunction(src, n)
    out += body + '\n'
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
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
      if (need.has(k) || k in deps) continue
      if (!isUsedIn(out, k) || isDeclaredIn(out, k)) continue
      need.add(k)
      changed = true
    }
    if (!changed) break
  }
  const header = [...need].map((k) => pool[k]).join('\n')
  const keys = Object.keys(deps)
  let fn
  try {
    fn = new Function(...keys, header + '\n' + out + '\nreturn ' + ret)
  } catch (e) {
    throw new Error(`提取出来的代码无法解析：${e.message}\n  已提取: ${[...have].join(', ')}`)
  }
  return fn(...keys.map((k) => deps[k]))
}

/** 生产的 iframe 构造函数：与 DSH 同一条出口（escAttr / MUV_CARD_SANDBOX / 高度引导脚本）。 */
const cardHtmlIframe = buildFrom(
  SRC,
  ['cardHtmlIframe'],
  { MUV_CARD_SANDBOX: SANDBOX_PROD, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } },
  'cardHtmlIframe'
)

/** 父页高度运行时（逐字提取），让夹具与 DSH 一样「iframe 自己长高」。 */
function heightRuntimeSource() {
  const names = new Set(['ensureFrameHeightListener', 'onMuvFrameHeightMessage'])
  for (const m of SRC.matchAll(/\n[ \t]+function\s+(\w*[Ff]rame\w*)\s*\(/g)) names.add(m[1])
  let out = ''
  for (const n of names) {
    try { out += extractFunction(SRC, n) + '\n' } catch (_) { /* 名字对不上就跳过 */ }
  }
  return Object.values(moduleVarStatements(SRC)).join('\n') + '\n' + out + '\n' +
    'if (typeof ensureFrameHeightListener === "function") ensureFrameHeightListener();'
}
const HEIGHT_RUNTIME = heightRuntimeSource()

// ─────────────────────── 1. 收集真卡里的整页界面 ───────────────────────

/** 取出围栏正文（行首三反引号、内部无裸反引号行）。判据同 verify-visual.mjs。 */
function fenceBodyOf(text) {
  const lines = String(text).split('\n')
  const fl = []
  for (let i = 0; i < lines.length; i++) if (/^[ \t]{0,3}`{3,}[ \t]*[a-zA-Z]*[ \t]*$/.test(lines[i])) fl.push(i)
  if (fl.length !== 2) return null
  return lines.slice(fl[0] + 1, fl[1]).join('\n') + '\n'
}
const looksLikeDoc = (b) => {
  const h = String(b).replace(/^\s+/, '').slice(0, 40).toLowerCase()
  return h.indexOf('<!doctype') === 0 || h.indexOf('<html') === 0
}

function collectDocs() {
  const out = []
  const files = existsSync(CARD_DIR) ? readdirSync(CARD_DIR).filter((f) => f.toLowerCase().endsWith('.png')) : []
  for (const f of files) {
    let card
    try { card = readPngCard(path.join(CARD_DIR, f)) } catch (_) { continue }
    for (const s of regexScriptsOf(card)) {
      const body = fenceBodyOf(String(s?.replaceString || ''))
      if (!body || !looksLikeDoc(body)) continue
      out.push({ card: f.replace(/\.png$/i, ''), script: String(s.scriptName || '未命名'), body })
    }
  }
  return out
}

// ─────────────────────── 2. 夹具页面 ───────────────────────

const htmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 卡代码之前注入的 shim。用途：验证「不透明来源下 localStorage 抛错会不会打断交互」。
 * 只提供内存实现，**不碰父页、不碰站点存储、不放开 allow-same-origin**。
 */
const STORAGE_SHIM = `(function(){
  try { window.localStorage.getItem('__probe'); return } catch (e) {}
  function mk(){ var m = Object.create(null); return {
    getItem: function(k){ k = String(k); return k in m ? m[k] : null },
    setItem: function(k,v){ m[String(k)] = String(v) },
    removeItem: function(k){ delete m[String(k)] },
    clear: function(){ m = Object.create(null) },
    key: function(i){ var ks = Object.keys(m); return i < ks.length ? ks[i] : null },
    get length(){ return Object.keys(m).length }
  } }
  var ls = mk(), ss = mk();
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function(){ return ls } }) } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function(){ return ss } }) } catch (e) {}
})();`

/** 在卡文档**最前面**插入一段脚本（必须在卡自己的代码之前跑，才叫 shim）。 */
function injectBeforeCard(head, body) {
  if (!head) return body
  const tag = '<script>' + head.replace(/<\/script/gi, '<\\/script') + '<\/script>'
  const m = /<head\b[^>]*>/i.exec(body)
  if (m) return body.slice(0, m.index + m[0].length) + tag + body.slice(m.index + m[0].length)
  const h = /<html\b[^>]*>/i.exec(body)
  if (h) return body.slice(0, h.index + h[0].length) + tag + body.slice(h.index + h[0].length)
  return tag + body
}

function makeFixture(doc, label) {
  let body = doc.body
  const pre = []
  if (OPTS.inject) pre.push(readFileSync(OPTS.inject, 'utf8'))
  if (OPTS.shim === 'storage') pre.push(STORAGE_SHIM)
  if (pre.length) body = injectBeforeCard(pre.join('\n'), body)

  let frame = cardHtmlIframe(body)
  if (SANDBOX !== SANDBOX_PROD) frame = frame.replace('sandbox="' + SANDBOX_PROD + '"', 'sandbox="' + SANDBOX + '"')

  const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>card-fixture</title>
<style>html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:13px/1.5 sans-serif}
.cap{font:12px monospace;color:#8b93a1;padding:8px}iframe{display:block}</style>
</head><body>
<div class="cap">沙箱=${htmlEsc(SANDBOX)} · ${htmlEsc(label)}${OPTS.shim ? ' · shim=' + htmlEsc(OPTS.shim) : ''}${OPTS.inject ? ' · inject=' + htmlEsc(OPTS.inject) : ''}</div>
${frame}
<script>/* 高度运行时：逐字提取自 lib/client.js */<\/script>
<script>${HEIGHT_RUNTIME.replace(/<\/script/gi, '<\\/script')}<\/script>
</body></html>`
  const file = path.join(OUT, 'fixture.html')
  writeFileSync(file, page, 'utf8')
  return file
}

// ─────────────────────── 3. CDP 客户端 ───────────────────────

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pend = new Map()
    this.handlers = new Map()
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)(m); this.pend.delete(m.id); return }
      const hs = this.handlers.get(m.method)
      if (hs) for (const h of hs) h(m.params, m.sessionId)
    }
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    return new Promise((res) => { this.pend.set(id, res); this.ws.send(JSON.stringify(msg)) })
  }
  close() { try { this.ws.close() } catch (_) {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchEdge(EDGE, url, { windowSize = '1500,3200' } = {}) {
  const prof = path.join(OUT, 'prof-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36))
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', '--user-data-dir=' + prof, '--window-size=' + windowSize,
    '--allow-file-access-from-files',
    url || 'about:blank',
  ], { stdio: 'ignore' })

  const portFile = path.join(prof, 'DevToolsActivePort')
  let port = 0
  for (let i = 0; i < 400; i++) {
    if (existsSync(portFile)) {
      const t = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (t) { port = Number(t); break }
    }
    await sleep(75)
  }
  if (!port) { try { proc.kill() } catch (_) {}; throw new Error('Edge 没写出 DevToolsActivePort（启动失败？）') }
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP WebSocket 连不上')) })
  return { proc, cdp: new CDP(ws), browserVersion: ver.Browser }
}

/** 一次「加载夹具 → 观察」的会话。每次测量都重建，避免上一步的模态框污染命中测试。 */
class CardSession {
  constructor(cdp, pageSession, version) {
    this.cdp = cdp
    this.page = pageSession
    this.version = version
    this.iframeSession = null     // OOPIF（生产沙箱下走这条）
    this.iframeContext = null     // 同源/同进程时的 executionContextId（diag 沙箱走这条）
    this.iframeFrameId = null
    this.logs = []
    this.exceptions = []
  }

  /** 加载一份夹具并等它稳定。返回本卡文档所在「执行环境」的描述。 */
  async load(file, settleMs) {
    const url = 'file:///' + file.replace(/\\/g, '/') + '?v=' + Date.now()
    this.iframeSession = null
    this.iframeContext = null
    this.iframeFrameId = null
    // ★ 先登记：接下来的 Target.attachedToTarget（OOPIF）要认领到这个会话上
    this.cdp.__pendingSession = this
    await this.cdp.send('Page.navigate', { url }, this.page)
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      if (this.iframeSession) break
      await sleep(100)
    }
    if (this.cdp.__pendingSession === this) this.cdp.__pendingSession = null
    await sleep(settleMs)
    if (!this.iframeSession) {
      // 同源沙箱（diag）不会变成 OOPIF：帧留在主进程里 → 用隔离世界读/点
      // （隔离世界与主世界共享 DOM 与事件，dispatch 出去的 click 主世界监听器收得到）
      const ft = await this.cdp.send('Page.getFrameTree', {}, this.page)
      const kids = (ft.result && ft.result.frameTree && ft.result.frameTree.childFrames) || []
      const child = kids.find((f) => f.frame.url === 'about:srcdoc') || kids[0]
      if (child) this.iframeFrameId = child.frame.id
      if (this.iframeFrameId) {
        const w = await this.cdp.send('Page.createIsolatedWorld', { frameId: this.iframeFrameId, worldName: 'ci-probe' }, this.page)
        if (w.result) this.iframeContext = w.result.executionContextId
      }
    }
    await this.installProbe()
    return this.where()
  }

  where() {
    if (this.iframeSession) return 'OOPIF(独立进程)'
    if (this.iframeContext) return '同进程隔离世界 ctx=' + this.iframeContext
    return '❌ 找不到卡文档'
  }

  async evalInCard(expr) {
    if (this.iframeSession) {
      const r = await this.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, this.iframeSession)
      if (r.result && r.result.exceptionDetails) {
        return { err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || 'exception' }
      }
      return { value: r.result && r.result.result && r.result.result.value }
    }
    if (this.iframeContext) {
      const r = await this.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, contextId: this.iframeContext }, this.page)
      if (r.result && r.result.exceptionDetails) {
        return { err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || 'exception' }
      }
      return { value: r.result && r.result.result && r.result.result.value }
    }
    return { err: 'no-card-context' }
  }

  /** 在卡文档里装观察器：DOM 变更计数 + 点击是否真的落到卡里 + 运行时错误。 */
  async installProbe() {
    const probe = `(function(){
  window.__ci = { n:0, clickSeen:0, clickTarget:'', errs:[], ready:true };
  var ci = window.__ci;
  try { new MutationObserver(function(ms){ ci.n += ms.length })
        .observe(document.documentElement, { childList:true, subtree:true, attributes:true, characterData:true }) } catch(e) {}
  document.addEventListener('click', function(e){
    ci.clickSeen++;
    try { var t = e.target; ci.clickTarget = t ? (t.tagName + '#' + (t.id||'') + '.' + String(t.className||'').slice(0,60)) : '?' } catch(_) {}
  }, true);
  window.addEventListener('error', function(e){ try { ci.errs.push(String(e.message).slice(0,160)) } catch(_) {} });
  return 'ok';
})()`
    const r = await this.evalInCard(probe)
    return r.value === 'ok'
  }

  async resetCounter() {
    await this.evalInCard('window.__ci ? (window.__ci.n = 0, window.__ci.clickSeen = 0) : 0')
  }

  async counters() {
    const r = await this.evalInCard('JSON.stringify(window.__ci ? {n:window.__ci.n, clickSeen:window.__ci.clickSeen, clickTarget:window.__ci.clickTarget, errs:window.__ci.errs} : null)')
    try { return JSON.parse(r.value || 'null') } catch (_) { return null }
  }

  async signature() {
    const r = await this.evalInCard(SIG_EXPR)
    try { return JSON.parse(r.value || 'null') } catch (_) { return null }
  }

  /** 在父页（宿主夹具）里求值。用于量 iframe 自己的盒子。 */
  async pageEval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, this.page)
    if (r.result && r.result.exceptionDetails) return null
    return r.result && r.result.result && r.result.result.value
  }

  /** 帧视口 vs iframe 盒子 vs 内容高：判「点不到」到底是几何还是卡自己的问题。 */
  async geometry() {
    const inCard = await this.evalInCard(
      "JSON.stringify({iw:innerWidth,ih:innerHeight,sy:Math.round(scrollY),dh:document.documentElement.scrollHeight,bodySh:document.body?document.body.scrollHeight:0})")
    const inPage = await this.pageEval(
      'JSON.stringify((function(){var f=document.querySelector("iframe");if(!f)return null;var b=f.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),styleH:f.style.height,pw:innerWidth,ph:innerHeight}})())')
    let card = null
    let frame = null
    try { card = JSON.parse(inCard.value) } catch (_) {}
    try { frame = JSON.parse(inPage) } catch (_) {}
    return { card, frame }
  }

  /** 候选点击目标：可见、有面积、看着像控件。 */
  async candidates(sel) {
    const expr = `(function(){
  var sel = ${JSON.stringify(sel)};
  var nodes = document.querySelectorAll(sel);
  var out = [], seen = [];
  for (var i = 0; i < nodes.length && out.length < 60; i++) {
    var e = nodes[i];
    if (seen.indexOf(e) >= 0) continue; seen.push(e);
    var st; try { st = getComputedStyle(e) } catch(_) { continue }
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue;
    var r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    var txt = (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    out.push({ i: out.length, si: i, tag: e.tagName, id: e.id || '', cls: String(e.className || '').slice(0, 60),
               text: txt, onclick: e.getAttribute && (e.getAttribute('onclick') || '').slice(0, 60),
               x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return JSON.stringify(out);
})()`
    const r = await this.evalInCard(expr)
    try { return JSON.parse(r.value || '[]') } catch (_) { return [] }
  }

  /**
   * 派发**真实鼠标事件**。OOPIF 会话里坐标相对帧视口；同进程时坐标要加上 iframe 在父页的偏移。
   *
   * ★ 两次实测踩出来的两条硬约束：
   *   ① **先把目标滚进帧视口**（用「选择器+序号」取元素再 scrollIntoView，不是按坐标找），
   *      否则长文档里的目标 rect.y 会远大于帧视口高，真实输入落在窗口外被直接丢弃，
   *      表现成「点了没反应」的**假阴性**（`_足控天堂2 / 主页` 的按钮就在 y=59520）。
   *   ② 帧视口外的点**一律判 `inconclusive`，不判 NO** —— 工具不能把「我点不到」说成
   *      「卡点不动」。
   * @returns {Promise<{ok:boolean, reason?:string, rect?:object, viewport?:object}>}
   */
  async realClick(sel, si) {
    const p = await this.prepare(sel, si)
    if (!p.ok) return p
    await this.dispatchAt(p.point)
    return p
  }

  /** 滚进视口 + 算出命中点，**先不点**（点击前要把变更计数器归零，否则把滚动算成点击效果）。 */
  async prepare(sel, si) {
    const r1 = await this.evalInCard(`(function(){
      var el = document.querySelectorAll(${JSON.stringify(sel)})[${si}];
      if (!el) return JSON.stringify({ err:'no-element-at-index' });
      try { el.scrollIntoView({ block:'center', inline:'center' }) } catch(_) { try { el.scrollIntoView() } catch(__) {} }
      return 'scrolled';
    })()`)
    if (r1.err) return { ok: false, reason: r1.err }
    await sleep(150)
    const r2 = await this.evalInCard(`(function(){
      var el = document.querySelectorAll(${JSON.stringify(sel)})[${si}];
      if (!el) return JSON.stringify({ err:'no-element-after-scroll' });
      var b = el.getBoundingClientRect();
      return JSON.stringify({ x:b.x, y:b.y, w:b.width, h:b.height,
        vw: innerWidth, vh: innerHeight, sy: Math.round(scrollY), dh: document.documentElement.scrollHeight });
    })()`)
    let m
    try { m = JSON.parse(r2.value) } catch (_) { return { ok: false, reason: 'rect-unreadable:' + r2.err } }
    if (m.err) return { ok: false, reason: m.err }
    const cx = Math.round(m.x + m.w / 2)
    const cy = Math.round(m.y + m.h / 2)
    if (!(m.w > 0 && m.h > 0) || cy < 0 || cy >= m.vh || cx < 0 || cx >= m.vw) {
      return { ok: false, reason: 'out-of-frame-viewport', rect: m }
    }
    let px = cx
    let py = cy
    if (!this.iframeSession) {
      const r = await this.cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify(document.querySelector("iframe").getBoundingClientRect())', returnByValue: true,
      }, this.page)
      const fr = JSON.parse(r.result.result.value)
      px = Math.round(fr.x) + cx
      py = Math.round(fr.y) + cy
    }
    return { ok: true, rect: m, point: { x: cx, y: cy, px, py } }
  }

  /** 在给定点派发真实鼠标事件（moved → pressed → released）。 */
  async dispatchAt(point) {
    const s = this.iframeSession || this.page
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.px, y: point.py, button: 'none' }, s)
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.px, y: point.py, button: 'left', clickCount: 1 }, s)
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.px, y: point.py, button: 'left', clickCount: 1 }, s)
  }

  /**
   * 对照路径：**程序化点击同一个元素**（不走命中测试）。
   *
   * 必须按「选择器 + 序号」重新取元素，不能按坐标 `elementFromPoint` 取：被遮罩盖住时
   * point 上拿到的是遮罩，那样测出的「程序化点击也无效」是假的，会把几何问题误判成逻辑问题。
   */
  async jsClick(sel, si) {
    return this.evalInCard(`(function(){
      var el = document.querySelectorAll(${JSON.stringify(sel)})[${si}];
      if (!el) return 'no-element-at-index';
      try { el.click() } catch (e) { return 'click-throw:' + e.message }
      return 'clicked:' + el.tagName + '.' + String(el.className || '').slice(0, 40);
    })()`)
  }

  /** 元素中心点是否真的能被命中（elementFromPoint 回不到它 ⇒ 被别的元素盖住了）。 */
  async hitTest(x, y) {
    const r = await this.evalInCard(`(function(){
      var el = document.elementFromPoint(${x}, ${y});
      if (!el) return 'null';
      return el.tagName + '#' + (el.id||'') + '.' + String(el.className||'').slice(0,60);
    })()`)
    return r.value
  }
}

/**
 * 可见 DOM 签名：可见元素数 + 可见叶文本的 FNV 哈希 + **属性/内联样式指纹** + 文档高 + 可见顶层块清单。
 *
 * ⚠ 属性指纹那一项是**必须的**，我差点漏掉：`_足控天堂2 / 正文美化（带音乐）` 的字号按钮
 * `adjustFontSize(-1)` 只改 `.reading-content` 的**内联样式**（17.2px → 16.2px），
 * 一个字的文本都没变 —— 只看文本的签名会把一个**明明生效了**的按钮判成 NO。
 */
const SIG_EXPR = `(function(){
  var els = document.querySelectorAll('body *'), n = 0, len = 0, h = 2166136261 >>> 0, a = 2166136261 >>> 0, top = [], fp = 0;
  for (var i = 0; i < els.length; i++) {
    var e = els[i], st;
    try { st = getComputedStyle(e) } catch(_) { continue }
    if (!st || st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
    var r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    n++;
    if (e.childElementCount === 0) {
      var t = e.textContent || '';
      len += t.length;
      for (var k = 0; k < t.length; k++) { h ^= t.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0 }
    }
    if (fp < 3000) {
      fp++;
      var sg = String(e.className || '') + '|' + (e.getAttribute ? (e.getAttribute('style') || '') : '') +
               '|' + (e.getAttribute ? (e.getAttribute('data-theme') || '') : '');
      for (var q = 0; q < sg.length; q++) { a ^= sg.charCodeAt(q); a = Math.imul(a, 16777619) >>> 0 }
    }
    var p = e.parentElement;
    if (p && (p.tagName === 'BODY' || p.id === 'app')) {
      top.push(e.tagName.toLowerCase() + '#' + (e.id || '') + '.' + String(e.className || '').slice(0, 45) + ':' + (r.height | 0) + 'px');
    }
  }
  return JSON.stringify({ n: n, len: len, h: h, a: a, fp: fp,
    sh: document.documentElement ? document.documentElement.scrollHeight : 0, top: top.slice(0, 24) });
})()`

/** 把签名的各个分量拼成可比较的键（漏掉任何一项 = 对那一类交互失明）。 */
const sigKey = (s) => (s ? [s.n, s.len, s.h, s.a, s.sh].join('|') : '')

// ─────────────────────── 4. 一次「目标 → 结论」测量 ───────────────────────

/**
 * 等「可见签名」变化，最多等 deadlineMs。
 *
 * ★ 为什么不能固定 sleep 一段时间：`_足控天堂2 / 主页` 的 `startSystem()` 是
 *   `cover.style.opacity='0'` 之后 **600ms 才 `setTimeout` 切面板**。第一版固定等 450ms，
 *   于是真实点击被判 NO，而随后的一次程序化点击「生效」其实是被延迟的定时器兑现的假阳性。
 *   固定窗口对**有延迟的 UI 过渡**系统性偏错，必须改成「轮询到变化 or 到截止时间」。
 */
async function waitForChange(session, base, deadlineMs, pollMs = 100) {
  const t0 = Date.now()
  let last = base
  const bkey = sigKey(base)
  while (Date.now() - t0 < deadlineMs) {
    await sleep(pollMs)
    last = await session.signature()
    if (last && bkey && sigKey(last) !== bkey) {
      return { changed: true, sig: last, waited: Date.now() - t0 }
    }
  }
  return { changed: false, sig: last, waited: deadlineMs }
}

/**
 * 对一个候选目标做完整测量：
 *   ① 空转基线（不点击，等到期或自己变化）→ 卡自己的动画/轮播/延迟初始化产生的变更量；
 *   ② 真实鼠标点击 → 等签名变化（带截止时间） + 变更量；
 *   ③ 真实点击无效时补一次程序化点击，用来看「是几何问题还是处理逻辑问题」。
 */
async function measureTarget(session, target, wait, sel) {
  const pre = await session.signature()
  await session.resetCounter()
  const idle = await waitForChange(session, pre, wait)
  const idleCounters = await session.counters()
  const base = idle.sig || pre

  const rec = {
    target: target.tag,
    text: target.text,
    cls: target.cls,
    selector: target.onclick ? '[onclick]=' + target.onclick : '',
    rectBeforeScroll: { x: target.x, y: target.y },
    sigBefore: pre && { n: pre.n, len: pre.len, h: pre.h, a: pre.a, sh: pre.sh },
    idleMutations: idleCounters ? idleCounters.n : 0,
    idleDrift: idle.changed,                       // 卡自己就在动 → 判据要更保守
  }
  const prep = await session.prepare(sel, target.si)
  if (!prep.ok) {
    // 点不到 ≠ 点不动。几何上够不着的目标一律标 inconclusive，绝不并入 NO。
    rec.inconclusive = prep.reason
    rec.rectAfterScroll = prep.rect
    rec.realClickWorks = null
    return rec
  }
  rec.point = prep.point.x + ',' + prep.point.y
  rec.rectAfterScroll = { x: Math.round(prep.rect.x), y: Math.round(prep.rect.y), w: Math.round(prep.rect.w), h: Math.round(prep.rect.h) }
  rec.frameViewport = { w: prep.rect.vw, h: prep.rect.vh, scrollY: prep.rect.sy, docHeight: prep.rect.dh }
  rec.hitTest = await session.hitTest(prep.point.x, prep.point.y)

  await session.resetCounter()
  await session.dispatchAt(prep.point)
  const post = await waitForChange(session, base, wait)
  const postCounters = await session.counters()

  const clickMut = postCounters ? postCounters.n : 0
  const mutDelta = clickMut - rec.idleMutations
  rec.sigAfter = post.sig && { n: post.sig.n, len: post.sig.len, h: post.sig.h, a: post.sig.a, sh: post.sig.sh }
  rec.waitedMs = post.waited
  rec.clickMutations = clickMut
  rec.mutationDelta = mutDelta
  rec.clickSeen = postCounters ? postCounters.clickSeen : 0
  rec.sigChanged = post.changed
  const mutWorks = mutDelta > Math.max(2, Math.ceil(rec.idleMutations * 0.5))
  rec.realClickWorks = post.changed || mutWorks
  // 卡自己在持续改 DOM 时，「点完就变了」不再能归因给点击（可能是它自己的定时器/轮播）。
  // 这种时候只有变更量明显超出空转基线才算数；两个信号都不成立就诚实地说"判不了"。
  if (!post.changed && !mutWorks && rec.idleDrift) {
    rec.inconclusive = 'idle-drift（卡自己在动，且点击后既无签名变化也无超出基线的变更量）'
    rec.realClickWorks = null
    return rec
  }

  if (!rec.realClickWorks) {
    // 先确认"无人操作时也不动"，否则程序化点击的阳性可能只是延迟定时器兑现的假阳性
    const settled = await waitForChange(session, post.sig, 400)
    const drifty = settled.changed
    const r = await session.jsClick(sel, target.si)
    const after = await waitForChange(session, settled.sig || post.sig, wait)
    rec.jsClick = r.value || r.err
    rec.jsClickWorks = after.changed && !drifty
    rec.jsClickNote = drifty
      ? '点击后仍有自发变更（延迟定时器/轮播），这次对照不可信 —— 不据此下结论'
      : '对照有效：真实点击无效、程序化点击生效 ⇒ 问题在几何/遮罩，不在处理逻辑'
  }
  return rec
}

// ─────────────────────── 5. 单份文档的完整判定 ───────────────────────

async function judgeDoc(cdp, pageSession, doc, { sel, textFilter, index, maxTargets, settle, wait, label }) {
  const file = makeFixture(doc, doc.card + ' / ' + doc.script)
  const result = { card: doc.card, script: doc.script, bytes: doc.body.length, sandbox: SANDBOX, targets: [], errors: [], note: '' }

  // 目标清单：用一次加载取候选（每个候选后面都会重新加载）
  const s0 = new CardSession(cdp, pageSession)
  result.context = await s0.load(file, settle)
  result.storage = (await s0.evalInCard("(function(){ try { localStorage.setItem('__ci_t','1'); localStorage.removeItem('__ci_t'); return 'ok' } catch(e) { return 'THROW:' + (e && e.name) } })()")).value
  result.parentDoc = (await s0.evalInCard("(function(){ try { return (window.parent && window.parent !== window && window.parent.document) ? 'READABLE' : 'BLOCKED' } catch(e) { return 'BLOCKED:' + (e && e.name) } })()")).value
  result.cardApiReady = (await s0.evalInCard("JSON.stringify({showStatInfo: typeof showStatInfo, openPortal: typeof openPortal, document: document.readyState, scripts: document.scripts.length})")).value
  const geo = await s0.geometry()
  result.frameGeom = geo
  result.handlers = (await s0.evalInCard(`(function(){
    var oc = document.querySelectorAll('[onclick]').length;
    var ev = 0;
    try { ev = 0 } catch(_) {}
    var scripts = 0, inlineWithClick = 0;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) { if (all[i].getAttribute && all[i].getAttribute('onclick')) scripts++; }
    var src = document.documentElement.outerHTML;
    return JSON.stringify({ onclickAttrs: oc, addEvClick: (src.match(/addEventListener\\(\\s*['"]click/g) || []).length,
      pointerdown: (src.match(/addEventListener\\(\\s*['"]pointerdown/g) || []).length,
      mousedown: (src.match(/addEventListener\\(\\s*['"]mousedown/g) || []).length,
      parentRefs: (src.match(/window\\.parent/g) || []).length,
      externalScripts: document.querySelectorAll('script[src]').length });
  })()`)).value

  const useSel = sel || (textFilter ? '*' : '[onclick],button,.res-chip,.portal-tab,[role="button"],a[href^="#"]')
  if (OPTS.eval) {
    const r = await s0.evalInCard(OPTS.eval)
    console.log('  [eval 卡文档] ' + (r.err ? 'THROW: ' + r.err : r.value))
  }
  if (OPTS.evalParent) {
    const v = await s0.pageEval(OPTS.evalParent)
    console.log('  [eval 宿主页] ' + v)
  }
  if (OPTS.evalOnly) {
    result.verdict = 'EVAL-ONLY'
    return result
  }
  let cands = await s0.candidates(useSel)
  if (textFilter) cands = cands.filter((c) => c.text.indexOf(textFilter) >= 0)
  result.candidateCount = cands.length
  if (index) cands = cands.slice(index, index + 1)
  else cands = cands.slice(0, maxTargets)
  result.picked = cands.map((c) => `${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls.split(' ')[0] : ''}"${c.text}"`)

  if (!cands.length) {
    result.verdict = 'NO-TARGET'
    result.note = '按给定条件没找到可点的候选（选择器=' + useSel + (textFilter ? ' 文本~' + textFilter : '') + '）'
    return result
  }

  for (const c of cands) {
    const s = new CardSession(cdp, pageSession)
    await s.load(file, settle)                       // ★ 每个目标重新加载：避免模态框遮罩造成假阴性
    const again = (await s.candidates(useSel)).filter((x) => textFilter ? x.text.indexOf(textFilter) >= 0 : true)
    const t = again.find((x) => x.text === c.text && x.cls === c.cls) || again[0] || c
    const rec = await measureTarget(s, t, wait, useSel)
    const ctr = await s.counters()
    if (ctr && ctr.errs && ctr.errs.length) rec.pageErrors = ctr.errs.slice(0, 4)
    result.targets.push(rec)
  }

  result.errors = collectExceptions(cdp)
  const works = result.targets.filter((t) => t.realClickWorks === true).length
  const nos = result.targets.filter((t) => t.realClickWorks === false).length
  const inc = result.targets.filter((t) => t.realClickWorks === null).length
  result.works = works
  result._nos = nos
  result._inc = inc
  result.verdict = works && !nos && !inc ? 'YES'
    : works ? `PARTIAL(${works}/${result.targets.length})`
      : nos ? 'NO'
        : 'INCONCLUSIVE'
  return result
}

/** 收集本次运行期间捕获到的未捕获异常（iframe 会话里抛的都会到这儿）。 */
function collectExceptions(cdp) {
  return (cdp.exceptions || []).slice(-8)
}

// ─────────────────────── 6. 工具自检（可信度证明） ───────────────────────

const SELFTEST_POSITIVE = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#eee">
<div id="panelA">面板A的内容</div>
<div id="panelB" style="display:none">面板B的另外一段内容</div>
<button id="navB" onclick="document.getElementById('panelA').style.display='none';document.getElementById('panelB').style.display='block'">切到B</button>
</body></html>`
const SELFTEST_NEGATIVE = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#eee">
<div id="panelA">面板A的内容</div>
<div id="panelB" style="display:none">面板B的另外一段内容</div>
<button id="navB">切到B（没有挂任何处理器）</button>
</body></html>`
const SELFTEST_DELAYED = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#eee">
<div id="panelA">面板A的内容</div>
<div id="panelB" style="display:none">面板B的另外一段内容</div>
<button id="navB" onclick="setTimeout(function(){document.getElementById('panelA').style.display='none';document.getElementById('panelB').style.display='block'},600)">延迟切到B</button>
</body></html>`
// 只改**内联样式**、一个字都不改的交互（真卡里就有：字号按钮 adjustFontSize(-1)）。
// 只看文本的签名会把它判成 NO —— 这条对照专门钉住"属性/样式指纹"这一项。
const SELFTEST_STYLEONLY = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#eee">
<div class="reading-content" id="rc" style="font-size:17.2px">正文内容一个字都不会变</div>
<button id="fz" onclick="var e=document.getElementById('rc');e.style.fontSize=(parseFloat(e.style.fontSize)-1)+'px'">A−</button>
</body></html>`

async function selftest(cdp, pageSession) {
  let pass = 0
  let fail = 0
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  OK   ' + name) }
    else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
  }
  console.log('=== 工具自检：它必须既能报 YES、也能报 NO ===')

  // A. 正对照：真的挂了 onclick 的按钮 → 必须报「可互动」
  const posFile = makeFixture({ card: 'SELFTEST', script: '正对照（有 onclick）', body: SELFTEST_POSITIVE }, 'selftest-positive')
  const sA = new CardSession(cdp, pageSession)
  const ctxA = await sA.load(posFile, 400)
  check('正对照：卡文档被执行环境拿到（' + ctxA + '）', ctxA.indexOf('❌') !== 0, ctxA)
  const candA = (await sA.candidates('button')).filter((c) => c.text.indexOf('切到B') >= 0)
  check('正对照：找得到目标按钮', candA.length === 1, JSON.stringify(candA))
  const recA = await measureTarget(sA, candA[0], 1200, 'button')
  console.log('        ' + JSON.stringify({ hit: recA.hitTest, sigChanged: recA.sigChanged, idle: recA.idleMutations, click: recA.clickMutations, delta: recA.mutationDelta, seen: recA.clickSeen }))
  check('正对照：真实鼠标点击被判为「有效」', recA.realClickWorks === true, '签名没变且变更量没超过基线')
  check('正对照：点击确实落进了卡文档（capture 监听器数到 1）', recA.clickSeen >= 1, 'clickSeen=' + recA.clickSeen)
  check('正对照：面板真的切换了（A 消失 / B 出现的签名变化）', recA.sigChanged === true, '签名未变')

  // A2. 延迟过渡的正对照 —— 钉死「固定等待窗口」这个坑。
  //     `_足控天堂2 / 主页` 的 startSystem() 是 600ms 后才切面板；固定等 450ms 会把它判成 NO。
  const delayedFile = makeFixture({ card: 'SELFTEST', script: '正对照（600ms 后才切面板）', body: SELFTEST_DELAYED }, 'selftest-delayed')
  const sA2 = new CardSession(cdp, pageSession)
  await sA2.load(delayedFile, 400)
  const candA2 = (await sA2.candidates('button')).filter((c) => c.text.indexOf('延迟切到B') >= 0)
  check('正对照2：找得到延迟按钮', candA2.length === 1, JSON.stringify(candA2))
  const recA2 = await measureTarget(sA2, candA2[0], 1500, 'button')
  console.log('        ' + JSON.stringify({ sigChanged: recA2.sigChanged, waitedMs: recA2.waitedMs, delta: recA2.mutationDelta }))
  check('正对照2：600ms 后才生效的面板切换仍被判为「有效」', recA2.realClickWorks === true, '延迟过渡被误判成 NO')
  check('正对照2：判据等到了延迟生效（waitedMs 落在 400~1400ms）',
    recA2.waitedMs >= 400 && recA2.waitedMs < 1400, 'waitedMs=' + recA2.waitedMs)

  // A3. 只改内联样式的正对照 —— 钉住签名里的「属性/样式指纹」。
  //     `_足控天堂2 / 正文美化（带音乐）` 的字号按钮就是这样：文本一字未改，样式变了。
  const styleFile = makeFixture({ card: 'SELFTEST', script: '正对照（只改内联样式）', body: SELFTEST_STYLEONLY }, 'selftest-styleonly')
  const sA3 = new CardSession(cdp, pageSession)
  await sA3.load(styleFile, 400)
  const candA3 = (await sA3.candidates('button')).filter((c) => c.text.indexOf('A−') >= 0)
  check('正对照3：找得到字号按钮', candA3.length === 1, JSON.stringify(candA3))
  const recA3 = await measureTarget(sA3, candA3[0], 1200, 'button')
  const fontNow = (await sA3.evalInCard("document.getElementById('rc').style.fontSize")).value
  console.log('        ' + JSON.stringify({ sigChanged: recA3.sigChanged, before: recA3.sigBefore, after: recA3.sigAfter, fontSize: fontNow }))
  check('正对照3：只改内联样式的交互仍被判为「有效」（文本哈希不变，靠样式指纹认出来）',
    recA3.realClickWorks === true, '被文本签名骗成了 NO')
  check('正对照3：卡的样式真的被改了（17.2px → 16.2px）', fontNow === '16.2px', String(fontNow))

  // B. 负对照 1：结构一样但**没有任何处理器** → 必须报「点了没变化」
  const negFile = makeFixture({ card: 'SELFTEST', script: '负对照（无处理器）', body: SELFTEST_NEGATIVE }, 'selftest-negative')
  const sB = new CardSession(cdp, pageSession)
  await sB.load(negFile, 400)
  const candB = (await sB.candidates('button')).filter((c) => c.text.indexOf('切到B') >= 0)
  check('负对照1：找得到目标按钮', candB.length === 1)
  const recB = await measureTarget(sB, candB[0], 1200, 'button')
  console.log('        ' + JSON.stringify({ hit: recB.hitTest, sigChanged: recB.sigChanged, idle: recB.idleMutations, click: recB.clickMutations, delta: recB.mutationDelta, seen: recB.clickSeen }))
  check('负对照1：真实鼠标点击被判为「无效」', recB.realClickWorks === false, '竟然报了有效 —— 工具的判据太松')
  check('负对照1：点击仍然落进了卡文档（说明「无效」不是没点到）', recB.clickSeen >= 1, 'clickSeen=' + recB.clickSeen)

  // C. 负对照 2：点一个**不存在的目标**（文本过滤到空） → 必须报 NO-TARGET
  const sC = new CardSession(cdp, pageSession)
  await sC.load(negFile, 400)
  const candC = (await sC.candidates('button')).filter((c) => c.text.indexOf('这段文字绝对不存在ZZZ') >= 0)
  check('负对照2：指定不存在的目标文本 → 候选数为 0', candC.length === 0, '居然找到了 ' + candC.length + ' 个')

  // D. 负对照 3：把点击目标换成「被遮罩盖住」的元素里的按钮 → 真实点击应无效、程序化点击应有效
  const COVERED = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111;color:#eee">
<div id="panelA">面板A的内容</div>
<div id="panelB" style="display:none">面板B的另外一段内容</div>
<button id="navB" onclick="document.getElementById('panelA').style.display='none';document.getElementById('panelB').style.display='block'">切到B</button>
<div style="position:absolute;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.01);z-index:5"></div>
</body></html>`
  const covFile = makeFixture({ card: 'SELFTEST', script: '负对照（被遮罩）', body: COVERED }, 'selftest-covered')
  const sD = new CardSession(cdp, pageSession)
  await sD.load(covFile, 400)
  const candD = (await sD.candidates('button')).filter((c) => c.text.indexOf('切到B') >= 0)
  const recD = candD.length ? await measureTarget(sD, candD[0], 1200, 'button') : null
  if (recD) {
    console.log('        ' + JSON.stringify({ hit: recD.hitTest, sigChanged: recD.sigChanged, seen: recD.clickSeen, js: recD.jsClick, jsWorks: recD.jsClickWorks }))
    check('负对照3：遮罩下的按钮，真实点击被判为无效', recD.realClickWorks === false, '竟然穿透遮罩成功了')
    check('负对照3：同一目标程序化点击仍然能生效（区分「几何」与「逻辑」）', recD.jsClickWorks === true,
      'jsClick=' + recD.jsClick)
  } else {
    check('负对照3：找得到目标按钮', false)
  }

  console.log(`\n=== 自检: ${pass} 通过, ${fail} 失败 ===`)
  return fail === 0
}

// ─────────────────────── 7. 主流程 ───────────────────────

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

async function withBrowser(fn) {
  if (!existsSync(EDGE)) { console.log('找不到浏览器：' + EDGE + '（设 MUV_EDGE 或装 Edge）'); process.exit(2) }
  const { proc, cdp, browserVersion } = await launchEdge(EDGE, 'about:blank')
  cdp.exceptions = []
  cdp.__pendingSession = null
  try {
    const t = await cdp.send('Target.getTargets')
    const page = t.result.targetInfos.find((x) => x.type === 'page')
    const at = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    const sid = at.result.sessionId
    // ★ 只开在页会话上：开在浏览器会话上抓不到被 swap 出去的沙箱 iframe（OOPIF，实测）
    cdp.on('Target.attachedToTarget', (p) => {
      cdp.lastChild = { targetId: p.targetInfo.targetId, type: p.targetInfo.type, sessionId: p.sessionId, url: p.targetInfo.url }
      if (p.targetInfo.type === 'iframe' && cdp.__pendingSession) {
        cdp.__pendingSession.iframeSession = p.sessionId
        cdp.__pendingSession = null
      }
    })
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid)
    await cdp.send('Runtime.enable', {}, sid)
    await cdp.send('Page.enable', {}, sid)
    cdp.on('Runtime.exceptionThrown', (p) => {
      try {
        const d = p.exceptionDetails
        const txt = (d.exception && (d.exception.description || d.exception.value)) || d.text
        cdp.exceptions.push(String(txt).slice(0, 220))
      } catch (_) {}
    })
    console.log('浏览器: ' + browserVersion + '  · 沙箱: ' + SANDBOX + (OPTS.shim ? '  · shim=' + OPTS.shim : ''))
    return await fn(cdp, sid)
  } finally {
    try { proc.kill() } catch (_) {}
    cdp.close()
  }
}

async function main() {
  const docs = collectDocs()

  if (OPTS.list) {
    console.log('=== 真卡里的整页界面 ===')
    for (const d of docs) console.log(`  ${d.card} / ${d.script}  ${d.body.length} 字`)
    console.log(`  共 ${docs.length} 份，来自 ${new Set(docs.map((d) => d.card)).size} 张卡`)
    return 0
  }

  let sel = docs
  if (OPTS.doc) sel = sel.filter((d) => d.card.indexOf(OPTS.doc) >= 0)
  if (OPTS.script) sel = sel.filter((d) => d.script.indexOf(OPTS.script) >= 0)
  if (!OPTS.all && !OPTS.doc && !OPTS.script && !OPTS.selftest) sel = sel.slice(0, 1)

  const report = { when: new Date().toISOString(), sandbox: SANDBOX, shim: OPTS.shim || null, selftest: null, docs: [] }

  const ok = await withBrowser(async (cdp, sid) => {
    if (OPTS.selftest) {
      const good = await selftest(cdp, sid)
      report.selftest = { pass: good }
      if (!OPTS.doc && !OPTS.all && !OPTS.script) return good
    }
    console.log(`\n=== 判定 ${sel.length} 份界面（沙箱=${SANDBOX}）===`)
    let i = 0
    for (const d of sel) {
      i++
      console.log(`\n--- [${i}/${sel.length}] ${d.card} / ${d.script}  ${d.body.length} 字 ---`)
      const r = await judgeDoc(cdp, sid, d, {
        sel: OPTS.sel, textFilter: OPTS.text, index: OPTS.index, maxTargets: OPTS.maxTargets,
        settle: OPTS.settle, wait: OPTS.wait,
      })
      report.docs.push(r)
      console.log(`  执行环境: ${r.context}   候选: ${r.candidateCount}`)
      console.log(`  localStorage: ${r.storage}   window.parent.document: ${r.parentDoc}`)
      console.log(`  卡内 API: ${r.cardApiReady}`)
      if (r.frameGeom) console.log(`  几何: 帧视口 ${JSON.stringify(r.frameGeom.card)} · iframe 盒子 ${JSON.stringify(r.frameGeom.frame)}`)
      if (r.handlers) console.log(`  点击相关静态量: ${r.handlers}`)
      for (const t of r.targets) {
        console.log(`  · 点 ${t.target}${t.cls ? '.' + t.cls.split(' ')[0] : ''}"${t.text}" @${t.rectBeforeScroll ? t.rectBeforeScroll.x + ',' + t.rectBeforeScroll.y : '?'}`)
        if (t.inconclusive) {
          console.log(`      ❓ 无法判定：${t.inconclusive}  滚动后 rect=${JSON.stringify(t.rectAfterScroll)}（工具够不着，不当作卡的问题）`)
          continue
        }
        console.log(`      命中元素=${t.hitTest}  签名变化=${t.sigChanged}  空转变更=${t.idleMutations} 点击后变更=${t.clickMutations} (Δ${t.mutationDelta})  卡内收到点击=${t.clickSeen}`)
        if (t.jsClick) console.log(`      程序化点击对照: ${t.jsClick}  → 生效=${t.jsClickWorks}`)
        if (t.pageErrors) console.log(`      卡内运行时错误: ${JSON.stringify(t.pageErrors)}`)
      }
      console.log(`  ⇒ 结论: ${r.verdict}${r.note ? '  (' + r.note + ')' : ''}`)
      if (r.errors && r.errors.length) console.log(`  未捕获异常: ${JSON.stringify(r.errors)}`)
    }
    const yes = report.docs.filter((d) => d.verdict === 'YES').length
    const no = report.docs.filter((d) => d.verdict === 'NO').length
    const partial = report.docs.filter((d) => String(d.verdict).startsWith('PARTIAL')).length
    const inc = report.docs.filter((d) => d.verdict === 'INCONCLUSIVE').length
    console.log(`\n=== 汇总: 可互动 ${yes} · 完全不可互动 ${no} · 部分 ${partial} · 判不了 ${inc} · 无目标 ${report.docs.filter((d) => d.verdict === 'NO-TARGET').length} ===`)
    return report.selftest ? report.selftest.pass : true
  })

  writeFileSync(OPTS.json, JSON.stringify(report, null, 2), 'utf8')
  console.log('报告: ' + OPTS.json)
  console.log('夹具: ' + path.join(OUT, 'fixture.html'))
  return ok ? 0 : 1
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('崩了: ' + (e && e.stack ? e.stack : e))
  process.exit(3)
})
