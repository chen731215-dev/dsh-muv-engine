// 验证工具的共享底座：**从 lib/client.js 逐字提取源码**的能力 + 一个极简 CDP 客户端。
//
// 为什么要把这两块抽出来：
//   ① 提取器（extractFunction / moduleVarStatements / buildFrom）已经被 `verify-visual.mjs`、
//      `test-client-render.mjs` 各抄了一份，再抄第三、第四份就是纯粹的腐化源 —— 提取器一旦
//      升级（比如支持新的字面量形态），漏改一份就会得到「测试还在跑，但测的不是真代码」。
//      这两个旧文件**保持不动**（它们是必须全绿的门禁，不为了复用去改），新工具从这里 import。
//   ② CDP 驱动（launchEdge / CDP）是「生产沙箱原封不动」地观测沙箱 iframe 的关键，
//      细节多且都是踩出来的（见 verify-card-interactive.mjs 头部注释），只该有一份实现。
//
// ⚠ 这个文件在 `package.json` 的 `files` 之外（只发 lib），是纯开发期工具。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ───────────────────────────── 源码逐字提取 ─────────────────────────────

/**
 * `/` 在这里是正则字面量还是除号？（词法上不可判定，只能看前文）
 *
 * 前一个有效字符是标识符字符 / `)` / `]` / 引号 → 除号；否则（`( , = : [ ! & | ? { } ;`
 * 或行首）→ 正则；另外前面是一个**关键字**（`return` / `typeof` / `case`…）时也是正则。
 */
export function regexAllowed(src, j, prev) {
  if (!prev) return true
  if (!/[A-Za-z0-9_$)\]'"`]/.test(prev)) return true
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, j - 16), j))
  return !!(m && /^(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(m[1]))
}

/**
 * 花括号配平地截出一个具名函数的完整源码。
 *
 * **必须跳过注释、字符串、模板串与正则字面量。** 老实计数器会被源码里的
 * `'function m(){try{'` 骗到（那是引导脚本文本，不是真代码），函数被从中间截断，
 * 报出来是看不懂的 `SyntaxError: Invalid or unexpected token`，而真正的错因在提取器。
 */
export function extractFunction(src, name) {
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

/**
 * 扫出源码里的**模块级常量声明**（`var X = '…'` / `= null` / `= false` / `= {}` …），
 * 返回**声明语句的原文**。
 *
 * 返回原文而不是求值结果：常量可能是多行字符串拼接，求值要正确处理换行/ASI/转义，
 * 很容易写错；把语句原文拼进被执行的代码里，语义与源码**逐字一致**。
 * 只收「RHS 是纯字面量」的声明（剥掉字符串/布尔/null 后不允许剩下标识符）。
 */
export function moduleVarStatements(src) {
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
      // 无分号声明（ASI）：深度 0 处遇到换行且表达式已完整时收尾。判据是「最后一个非空白
      // 字符不是运算符」，不是「遇到空行」—— 多行字符串拼接会在中间夹空行。
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

/**
 * 提取入口函数及其在源码里能找到的**全部函数依赖**（迭代到不动点），再注入外部依赖后求值。
 * 自动发现是必须的：写死依赖表会让对照实验在旧源码上直接抛错，报的是「测试崩了」而不是
 * 「行为不同」。
 */
export function buildFrom(src, names, deps, ret) {
  const have = new Set()
  const queue = [...names]
  let out = ''
  while (queue.length) {
    const n = queue.shift()
    if (have.has(n)) continue
    have.add(n)
    const body = extractFunction(src, n)
    out += body + '\n'
    // 只把**带缩进的声明**当成依赖：函数体里的文本也包含源码片段（引导脚本字符串里就写着
    // `function m(`），不加这条会把字符串里的名字当成真函数去提取。
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
    // 把「提取了哪些函数」一起报出来：提取器出错时，裸 SyntaxError 完全指不到问题在哪。
    throw new Error(
      `提取出来的代码无法解析（提取器可能截断了某个函数）：${e.message}\n` +
      `  已提取: ${[...have].join(', ')}\n  已注入常量: ${[...need].join(', ') || '（无）'}`
    )
  }
  return fn(...keys.map((k) => deps[k]))
}

export function readEngineSource(repoDir = __dirname) {
  return readFileSync(path.join(repoDir, 'lib', 'client.js'), 'utf8')
}

/** 生产沙箱常量（从源码里读，绝不写死 —— 写死会让「放宽沙箱」的改动测不出来）。 */
export function sandboxOf(src) {
  const m = /var\s+MUV_CARD_SANDBOX\s*=\s*(['"][^'"]*['"])/.exec(src)
  if (!m) throw new Error("lib/client.js 里找不到 MUV_CARD_SANDBOX")
  return new Function('return ' + m[1])()
}

/**
 * 源码里**逐字**取一条 CSS 规则（`sel{...}` 形式，取第一处）。
 *
 * 为什么要从源码里取而不是在测试里重写一遍：手抄的规则会与产品漂移，测试就会永远绿。
 * 取不到直接抛错（宁可不判定，也不要拿空规则去量宽度得到假绿）。
 */
export function cssRuleFromSource(src, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(esc + '\\{[^}]*\\}')
  const m = re.exec(src)
  if (!m) throw new Error('源码里找不到 CSS 规则 ' + selector)
  return m[0]
}

/** 从一条规则里剥掉指定的声明（用于构造「修复前」的对照）。 */
export function stripDecls(rule, decls) {
  let out = rule
  for (const d of decls) {
    const prop = d.split(':')[0]
    out = out.replace(new RegExp('(^|[{;])\\s*' + prop + '\\s*:[^;}]*', 'g'), '$1')
  }
  return out.replace(/;+/g, ';').replace(/\{;/, '{').replace(/;\}/, '}')
}

// ───────────────────────────── 真卡文档收集 ─────────────────────────────

export const DEFAULT_CARD_DIR = process.env.MUV_CARD_DIR || 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

/** 取出围栏正文（行首三反引号、内部无裸反引号行）；判据同 verify-visual.mjs。 */
export function fenceBodyOf(text) {
  const lines = String(text).split('\n')
  const fl = []
  for (let i = 0; i < lines.length; i++) if (/^[ \t]{0,3}`{3,}[ \t]*[a-zA-Z]*[ \t]*$/.test(lines[i])) fl.push(i)
  if (fl.length !== 2) return null
  return lines.slice(fl[0] + 1, fl[1]).join('\n') + '\n'
}

export const looksLikeDoc = (b) => {
  const h = String(b).replace(/^\s+/, '').slice(0, 40).toLowerCase()
  return h.indexOf('<!doctype') === 0 || h.indexOf('<html') === 0
}

/** 真卡里所有「围栏整页 HTML 界面」。 */
export function collectDocs(cardDir = DEFAULT_CARD_DIR) {
  const out = []
  if (!existsSync(cardDir)) return out
  for (const f of readdirSync(cardDir).filter((f) => f.toLowerCase().endsWith('.png'))) {
    let card
    try { card = readPngCard(path.join(cardDir, f)) } catch (_) { continue }
    for (const s of regexScriptsOf(card)) {
      const body = fenceBodyOf(String(s?.replaceString || ''))
      if (!body || !looksLikeDoc(body)) continue
      out.push({ card: f.replace(/\.png$/i, ''), script: String(s.scriptName || '未命名'), body })
    }
  }
  return out
}

// ───────────────────────────── 极简 CDP 客户端 ─────────────────────────────

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class CDP {
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

/**
 * 起一个无头 Edge，开 CDP，连上 browser WebSocket。
 *
 * ⚠ 窗口尺寸的坑：卡的面板常落在文档 y≈2800px 处，**真实鼠标事件在窗口外会被直接丢弃**。
 *   无头窗口必须至少和内容一样高，默认 1500x3200。
 */
export async function launchEdge(EDGE, url, { windowSize = '1500,3200', outDir, extraArgs = [] } = {}) {
  if (!EDGE || !existsSync(EDGE)) throw new Error('找不到浏览器：' + EDGE + '（设 MUV_EDGE）')
  const dir = outDir || path.join(os.tmpdir(), 'muv-verify')
  const prof = path.join(dir, 'prof-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36))
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', '--user-data-dir=' + prof, '--window-size=' + windowSize,
    '--allow-file-access-from-files',
    ...extraArgs,
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

/**
 * 连接页会话，并在**页会话**上开 autoAttach。
 *
 * ★ 必须开在页会话上：沙箱 iframe 会被 Chromium 换进独立渲染进程（OOPIF），
 *   开在**浏览器会话**上抓不到它（实测：全绿但 0 个子 target）。
 * @returns {Promise<{pageSession:string, iframeSession:string|null, close:Function, cdp:CDP, browserVersion:string}>}
 */
export async function openPage(EDGE, { url, windowSize, outDir, extraArgs } = {}) {
  const { proc, cdp, browserVersion } = await launchEdge(EDGE, url, { windowSize, outDir, extraArgs })
  const t = await cdp.send('Target.getTargets')
  const page = t.result.targetInfos.find((x) => x.type === 'page')
  const at = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  const pageSession = at.result.sessionId
  cdp.__pendingSession = null
  cdp.iframeSessions = []
  cdp.on('Target.attachedToTarget', (p) => {
    if (p.targetInfo.type === 'iframe') {
      cdp.iframeSessions.push({ targetId: p.targetInfo.targetId, sessionId: p.sessionId, url: p.targetInfo.url })
      if (cdp.__pendingSession) {
        cdp.__pendingSession.iframeSession = p.sessionId
        cdp.__pendingSession = null
      }
    }
  })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession)
  await cdp.send('Runtime.enable', {}, pageSession)
  await cdp.send('Page.enable', {}, pageSession)
  return {
    cdp, pageSession, browserVersion,
    close() { try { proc.kill() } catch (_) {}; cdp.close() },
  }
}

/** 在某个会话里求值并取回结构化的 JSON（失败返回 null）。 */
export async function evalJson(cdp, expr, sessionId) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    throw new Error('求值异常: ' + ((d.exception && d.exception.description) || d.text))
  }
  const v = r.result && r.result.result && r.result.result.value
  try { return JSON.parse(v) } catch (_) { return v }
}

/**
 * 把**真实的高度监听运行时代码**逐字取出来，供内联进夹具页面。
 *
 * 为什么必须这样：夹具页面如果只有静态 HTML，就没有客户端运行时 —— `ensureFrameHeightListener`
 * 从未注册，iframe 永远停在默认高度。补上真实代码后，夹具自己就能撑高，「iframe 高度是否
 * 脱离默认值」才是一个**浏览器实测**的判据。
 */
export function heightRuntimeSource(src) {
  const names = new Set(['ensureFrameHeightListener', 'onMuvFrameHeightMessage'])
  for (const m of src.matchAll(/\n[ \t]+function\s+(\w*[Ff]rame\w*)\s*\(/g)) names.add(m[1])
  let out = ''
  for (const n of names) {
    try { out += extractFunction(src, n) + '\n' } catch (_) { /* 名字对不上就跳过 */ }
  }
  return Object.values(moduleVarStatements(src)).join('\n') + '\n' + out + '\n' +
    'if (typeof ensureFrameHeightListener === "function") ensureFrameHeightListener();'
}

export const htmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
