// verify-user-send.mjs
//
// 用户消息桥 send 通道门禁：卡里 `sendUserMessage(msg)` → postMessage → 宿主
// `muvDeliverUserText(text,'send')` → 把文本写进 DSH 输入框并代发。
//
// ── 测的是什么 ─────────────────────────────────────────────────────────────
// 真 Edge + 真 DOM + **从 lib/client.js 逐字提取**的 `muvDeliverUserText` 与
// `muvUserSendFire`（测的是真实代码，不是抄副本）。宿主夹具页里放一个「假 DSH 聊天框」：
//   · `<textarea id="fakeDshInput" data-muv-macro-hooked>`（带宏钩子标记，muvDeliverUserText
//     第一优先命中它）+ `<button id="fakeSendBtn">发送</button>`。
//   · 两个发送绑定（照 DSH 真实行为仿真）：按钮 onclick → 记录 __dshSend{via:'button'}；
//     输入框 onKeyDown(Enter) → 记录 __dshSend{via:'enter'}。任一命中即视为「发送通道被触发」。
// 宿主监听 `message`：收到 `{__muvUserSend:{text,mode}}` 就调真实 `muvDeliverUserText`
// （镜像 client.js 里 onMuvCardCompatMessage 的 isUserSend 分支）。
// iframe（沙箱 allow-scripts，与生产一致）内联卡的 `sendUserMessage` 垫片并调用它。
//
// ── 断言（每条都能红）───────────────────────────────────────────────────────
//   A 文本到达：#fakeDshInput.value === 卡提交文本（填值路径工作）
//   B 发送触发：__dshSend.fired === true（send 通道①按钮 或 ②键盘 命中其一）
//   C 按钮场景：有按钮时 via==='button'
//   D 键盘场景：无按钮时（同一页面 second load）via==='enter'（证明通道②键盘序列兜底有效）
//
// ── 真变红对照臂 ───────────────────────────────────────────────────────────
//   --break=send-channel：宿主把 mode 改为 'fill'（砍掉发送通道，只填不代发）。
//   此时 A 仍过，但 B 必红（__dshSend 永不被设）→ 进程非 0。证明门禁对「发送通道失效」敏感。
//
// 跑法：$env:MUV_EDGE="…\msedge.exe"; node verify-user-send.mjs
//       node verify-user-send.mjs --break=send-channel     （期望红，exit≠0）

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = path.join(os.tmpdir(), 'muv-verify-user-send')
fs.mkdirSync(OUT, { recursive: true })
const BREAK = (() => { const a = process.argv.find((x) => x.startsWith('--break=')); return a ? a.slice('--break='.length) : '' })()

// ── 从真实源码逐字提取函数（与 test-client-render.mjs 同款配平器）──────────
function sliceBalanced(src, start) {
  let i = src.indexOf('{', start); if (i < 0) return null
  let depth = 0, state = 'code'
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue }
      if (c === '/' && n === '*') { state = 'block'; i++; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; continue }
      if (c === '/') { state = 'regex'; continue }
      if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
    } else if (state === 'regex') { if (c === '\\') { i++; continue } if (c === '/') state = 'code' }
    else if (state === 'line') { if (c === '\n') state = 'code' }
    else if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++ } }
    else { if (c === '\\') { i++; continue } if (c === state) state = 'code' }
  }
  return null
}
function extractFunction(src, name) {
  const needles = ['\n    function ' + name + '(', '\n      function ' + name + '(',
    '\n    async function ' + name + '(', '\n      async function ' + name + '(',
    'function ' + name + '(', 'async function ' + name + '(']
  for (const needle of needles) {
    let at = src.indexOf(needle)
    while (at !== -1) {
      const start = needle.startsWith('\n') ? at + 1 : at
      const text = sliceBalanced(src, start)
      if (text) { try { new Function(text); return text } catch (_) {} }
      at = src.indexOf(needle, at + 1)
    }
  }
  throw new Error('找不到可解析的函数 ' + name)
}
const SRC_MUV_USER_SEND_FIRE = extractFunction(SRC, 'muvUserSendFire')
const SRC_MUV_DELIVER = extractFunction(SRC, 'muvDeliverUserText')

let pass = 0, fail = 0
const failed = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; failed.push(name); console.log('  FAIL ' + name + (detail === undefined ? '' : '  -> ' + detail)) }
}
const note = (s) => console.log('  NOTE ' + s)

// ── CDP 薄封装（复用 verify-card-interactive.mjs 的同款实现）───────────────
class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pend = new Map(); this.handlers = new Map()
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data)
      if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)(m); this.pend.delete(m.id); return }
      const hs = this.handlers.get(m.method); if (hs) for (const h of hs) h(m.params, m.sessionId) } }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn) }
  send(method, params = {}, sessionId) { const id = ++this.seq; const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    return new Promise((res) => { this.pend.set(id, res); this.ws.send(JSON.stringify(msg)) }) }
  close() { try { this.ws.close() } catch (_) {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchEdge(url) {
  const prof = path.join(OUT, 'prof-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36))
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', '--user-data-dir=' + prof, '--window-size=1200,1400',
    '--allow-file-access-from-files', url || 'about:blank'], { stdio: 'ignore' })
  const portFile = path.join(prof, 'DevToolsActivePort'); let port = 0
  for (let i = 0; i < 400; i++) { if (fs.existsSync(portFile)) { const t = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); if (t) { port = Number(t); break } } await sleep(75) }
  if (!port) { try { proc.kill() } catch (_) {}; throw new Error('Edge 没写出 DevToolsActivePort') }
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP WebSocket 连不上')) })
  return { proc, cdp: new CDP(ws) }
}

// ── 宿主夹具页 ───────────────────────────────────────────────────────────────
function fixtureHtml(nobtn, mode) {
  const btn = nobtn ? '' : '<button id="fakeSendBtn" type="button">发送</button>'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<textarea id="fakeDshInput" data-muv-macro-hooked rows="3" placeholder="给 DSH 发消息"></textarea>
${btn}
<div id="log"></div>
<script>
${SRC_MUV_USER_SEND_FIRE}
${SRC_MUV_DELIVER}
window.__dshSend = null;
// 仿真 DSH 的两个发送绑定
var inp = document.getElementById('fakeDshInput');
var btnEl = document.getElementById('fakeSendBtn');
function fire(via){ if(window.__dshSend) return; window.__dshSend = { fired:true, via:via, text: inp.value }; var l=document.getElementById('log'); if(l) l.textContent += via+' '; }
if (btnEl) btnEl.addEventListener('click', function(){ fire('button'); });
inp.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey) fire('enter'); });
// 宿主：镜像 onMuvCardCompatMessage 的 isUserSend 分支
window.addEventListener('message', function(ev){
  var d = ev.data;
  if (d && d.__muvUserSend && d.__muvUserSend.text) {
    muvDeliverUserText(d.__muvUserSend.text, ${BREAK === 'send-channel' ? "'fill'" : "d.__muvUserSend.mode"});
  }
});
</script>
<iframe id="card" sandbox="allow-scripts" srcdoc="<script>window.sendUserMessage=function(m){parent.postMessage({__muvUserSend:{text:m,mode:'${mode}'}},'*')};window.sendUserMessage('你好，DSH');<\/script>"></iframe>
</body></html>`
}

// 拿到真实页面会话（导航到 url 后求值）
async function withPage(url, fn) {
  const { proc, cdp } = await launchEdge(url)
  try {
    const t = await cdp.send('Target.getTargets', {})
    const pageInfo = (t.result.targetInfos || []).find((x) => x.type === 'page')
    if (!pageInfo) throw new Error('找不到 page target')
    const at = await cdp.send('Target.attachToTarget', { targetId: pageInfo.targetId, flatten: true })
    const sid = at.result.sessionId
    await cdp.send('Page.enable', {}, sid)
    await cdp.send('Runtime.enable', {}, sid)
    return await fn(cdp, sid)
  } finally { cdp.close(); try { proc.kill() } catch (_) {} }
}

async function run() {
  if (!fs.existsSync(EDGE)) { console.log('!! MUV_EDGE 不存在：' + EDGE); process.exit(2) }
  console.log('=== 用户消息桥 send 通道门禁 ===' + (BREAK ? '  [红臂: ' + BREAK + ']' : ''))
  // 场景①：有发送按钮（应走通道① button）
  const f1 = path.join(OUT, 'host-button.html'); fs.writeFileSync(f1, fixtureHtml(false, 'send'), 'utf8')
  const j1 = await withPage('file:///' + f1.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(800)
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ val: document.getElementById("fakeDshInput").value, send: window.__dshSend })',
      returnByValue: true, awaitPromise: true }, sid)
    return JSON.parse((r.result && r.result.result && r.result.result.value) || 'null') || {}
  })
  check('场景① A 文本到达输入框', j1.val === '你好，DSH', JSON.stringify(j1))
  check('场景① B 发送通道触发', !!(j1.send && j1.send.fired), JSON.stringify(j1))
  check('场景① C 命中按钮通道', !!(j1.send && j1.send.via === 'button'), JSON.stringify(j1))

  // 场景②：无发送按钮（应走通道② 键盘序列 enter）
  const f2 = path.join(OUT, 'host-noBtn.html'); fs.writeFileSync(f2, fixtureHtml(true, 'send'), 'utf8')
  const j2 = await withPage('file:///' + f2.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(800)
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ val: document.getElementById("fakeDshInput").value, send: window.__dshSend })',
      returnByValue: true, awaitPromise: true }, sid)
    return JSON.parse((r.result && r.result.result && r.result.result.value) || 'null') || {}
  })
  check('场景② A 文本到达输入框', j2.val === '你好，DSH', JSON.stringify(j2))
  check('场景② B 发送通道触发', !!(j2.send && j2.send.fired), JSON.stringify(j2))
  check('场景② D 命中键盘通道', !!(j2.send && j2.send.via === 'enter'), JSON.stringify(j2))

  console.log('\n' + (fail ? '❌ ' : '✅ ') + `通过 ${pass} / 失败 ${fail}`)
  if (failed.length) console.log('  失败项: ' + failed.join(' | '))
  process.exitCode = fail ? 1 : 0
}
run().catch((e) => { console.log('!! 运行异常: ' + (e && e.stack || e)); process.exit(3) })
