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
let SRC_MUV_DELIVER = extractFunction(SRC, 'muvDeliverUserText')
// 红臂①：把 contenteditable 的兜底判据还原成"只看 execCommand 返回值"的旧版。
// 场景⑤（真机 execCommand 插入了却返回 false）必须因此变红 —— 证明这条判据能红。
if (BREAK === 'ce-append-fallback') {
  const before = SRC_MUV_DELIVER
  SRC_MUV_DELIVER = SRC_MUV_DELIVER.replace('if (!grew && !appended) {', 'if (!appended) {')
  if (SRC_MUV_DELIVER === before) throw new Error('红臂 ce-append-fallback 没能改写兜底判据（锚点串变了？）')
}
// 红臂②：把合成 InputEvent 还原成"无条件补一个"的旧版。
// 场景⑥（受控编辑器仿真）必须因此变红 —— 真机两份就是这么来的。
if (BREAK === 'ce-synthetic-input') {
  const before = SRC_MUV_DELIVER
  SRC_MUV_DELIVER = SRC_MUV_DELIVER.replace('if (!sawNativeInput) {', 'if (true) {')
  if (SRC_MUV_DELIVER === before) throw new Error('红臂 ce-synthetic-input 没能改写合成事件判据（锚点串变了？）')
}

// 场景④：宿主「选项按钮点击委托」本身（2026-09-26a 新增）。
//   `exports.apply` 里的这段委托不在具名函数里（是 `document.addEventListener('click', fn)`），
//   所以按**注释锚点**定位、再用同一个配平器切出 `function(e){…}`，测的仍是真实源码。
//   锚点 = 那句 `// ★ 全局点击委托：选项按钮点击`；断锚就报错，不给静默降级。
const SRC_CHOICE_DELEGATE = (() => {
  const at = SRC.indexOf('// ★ 全局点击委托：选项按钮点击')
  if (at < 0) throw new Error('找不到选项点击委托的注释锚点（源码被改动？）')
  const fnAt = SRC.indexOf('function(e)', at)
  if (fnAt < 0) throw new Error('锚点之后找不到委托函数 function(e)')
  let text = sliceBalanced(SRC, fnAt)
  if (!text) throw new Error('委托函数配平失败')
  try { new Function('return (' + text + ')') } catch (e) { throw new Error('委托函数不可解析: ' + e.message) }
  // 红臂：把选择器还原成"漏掉 .muv-sb-opt 的旧版"，场景④必须因此变红。
  if (BREAK === 'sb-opt-selector') {
    const before = text
    text = text.replace("'.muv-sb-opt, .muv-choice-btn, .tavern-option-btn'", "'.muv-choice-btn, .tavern-option-btn'")
    if (text === before) throw new Error('红臂 sb-opt-selector 没能改写选择器（锚点串变了？）')
  }
  return text
})()

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
// ★ 2026-09-25 新增场景③（contenteditable）：DSH 真机会话视图里 **0 个 textarea**，
//   聊天输入框是 `[contenteditable="true"]`（类名 uV2eYG_input，发送钮 aria-label「发送消息」）。
//   旧夹具用假 textarea ⇒ 门禁全绿但真机静默失败（muvDeliverUserText 找不到输入框直接
//   `return false`）——夹具必须贴真实 DOM，否则测的是幻觉。
function fixtureHtml(nobtn, mode, ce) {
  const btn = nobtn ? '' : '<button id="fakeSendBtn" type="button" aria-label="发送消息">发送</button>'
  const input = ce
    ? '<div id="fakeDshInput" contenteditable="true" role="textbox" class="uV2eYG_input" style="min-height:40px;border:1px solid #999"></div>'
    : '<textarea id="fakeDshInput" data-muv-macro-hooked rows="3" placeholder="给 DSH 发消息"></textarea>'
  const readVal = ce ? 'inp.textContent' : 'inp.value'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
${input}
${btn}
<div id="log"></div>
<script>
${SRC_MUV_USER_SEND_FIRE}
${SRC_MUV_DELIVER}
window.__dshSend = null;
// 仿真 DSH 的两个发送绑定
var inp = document.getElementById('fakeDshInput');
var btnEl = document.getElementById('fakeSendBtn');
function fire(via){ window.__dshSendCount = (window.__dshSendCount || 0) + 1; if(window.__dshSend) return; window.__dshSend = { fired:true, via:via, text: ${readVal} }; var l=document.getElementById('log'); if(l) l.textContent += via+' '; }
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

// ── 场景④夹具：宿主级联状态栏 / 卡选项按钮的**点击委托**（2026-09-26a）────────
// 真机形态：DSH 会话视图 0 个 textarea，输入框是 contenteditable，且**里面本来就可能有
// 用户没发出去的草稿**；四类按钮同时在页面上：
//   ① `.muv-sb-opt`（status-cascade 的「行动选项」，就是这次报的 bug）
//   ② `.muv-sb-opt` 且正文以 `A ` 开头（证明字母剥离不能无条件套 /^[A-D]/）
//   ③ `.muv-choice-btn` + `.muv-choice-letter` 子元素（字母必须剥）
//   ④ `.tavern-option-btn` + `data-opt-letter`（textContent 无字母，不该多剥）
//   `execFalse=true`：把 `document.execCommand` 换成「**确实插入了但返回 false**」的实现，
//   而且**不**派发 input 事件 —— 这是为了单独测「兜底判据看返回值还是看文本增长」。
//   `controlled=true`：再叠一层「受控编辑器」仿真 —— 宿主收到**合成** InputEvent（`isTrusted=false`）
//   且带 `data`/`inputType='insertText'` 时会按 data **再插一次**。真机 DSH 就是这样：0.3.10
//   的 `execCommand` 之后我们无条件补了一个合成 InputEvent，宿主把它当插入指令 ⇒ 选项原文
//   在输入框里出现两份（2026-09-26 真机取证 _probe-sbopt8.mjs）。夹具必须能复现这个，
//   否则又是「门禁全绿而真机两份」。
function fixtureChoiceHtml(execFalse, controlled) {
  const execOverride = (execFalse || controlled) ? `
document.execCommand = function(cmd, ui, val){
  if (cmd !== 'insertText') return ${execFalse ? 'false' : 'true'};
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return ${execFalse ? 'false' : 'true'};
  var rg = sel.getRangeAt(0);
  rg.deleteContents();
  var tn = document.createTextNode(String(val));
  rg.insertNode(tn);
  rg.setStartAfter(tn); rg.collapse(true);
  sel.removeAllRanges(); sel.addRange(rg);
  ${execFalse ? '' : `var ev = new InputEvent('input', { bubbles: true, data: String(val), inputType: 'insertText' });
  // 标明"这是浏览器自己派发的原生 input"：headless Edge 里给 isTrusted 装 getter 常常不生效，
  // 所以用自定义标记，受控编辑器仿真两样都认（e.isTrusted === true || e.__muvNative === true）。
  ev.__muvNative = true;
  try { Object.defineProperty(ev, 'isTrusted', { get: function(){ return true } }) } catch (_) {}
  inp.dispatchEvent(ev);`}
  return ${execFalse ? 'false' : 'true'};
};` : ''
  const controlledSim = controlled ? `
// 受控编辑器仿真：**合成** InputEvent（既非 isTrusted 也无 __muvNative）带 data ⇒ 宿主再插一次
inp.addEventListener('input', function(e){
  var native = (e.isTrusted === true) || (e.__muvNative === true);
  if (e.inputType === 'insertText' && e.data && !native) {
    inp.appendChild(document.createTextNode(String(e.data)));
  }
}, false);` : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div id="fakeDshInput" contenteditable="true" role="textbox" class="uV2eYG_input" style="min-height:40px;border:1px solid #999">已有草稿</div>
<button id="fakeSendBtn" type="button" aria-label="发送消息">发送</button>
<div class="muv-sb-opts">
  <button type="button" class="muv-sb-opt" id="sbOpt1">先去找琴团长报到</button>
  <button type="button" class="muv-sb-opt" id="sbOpt2">A new day 也要先把地图摊开</button>
</div>
<div class="muv-choices">
  <button type="button" class="muv-choice-btn" id="choiceBtn"><span class="muv-choice-letter">A</span>顺着安柏的力道走</button>
</div>
<div class="tavern-options">
  <button type="button" class="tavern-option-btn" id="tavernBtn" data-opt-letter="B">停下脚步</button>
</div>
<div id="log"></div>
<script>
${SRC_MUV_USER_SEND_FIRE}
${SRC_MUV_DELIVER}
window.__dshSend = null;
window.__dshSendCount = 0;
window.__muvInputEvents = 0;
var inp = document.getElementById('fakeDshInput');
var btnEl = document.getElementById('fakeSendBtn');
function fire(via){ window.__dshSendCount++; if(window.__dshSend) return; window.__dshSend = { fired:true, via:via, text: inp.textContent }; }
if (btnEl) btnEl.addEventListener('click', function(){ fire('button'); });
inp.addEventListener('input', function(){ window.__muvInputEvents++; });
inp.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey) fire('enter'); });
${execOverride}
${controlledSim}
// ★ 被门禁测的**真源码**：exports.apply 里那段点击委托
document.addEventListener('click', ${SRC_CHOICE_DELEGATE});
// 探针：__read 读当前状态；__clickBtn 只点按钮（状态读数必须**在点击之前**取，否则
//   execCommand 的原生 input 事件会在点击那一瞬同步打进计数，Δ 就永远是 0）。
window.__clickBtn = function(id){ var el = document.getElementById(id); if(!el) throw new Error('no btn '+id); el.click(); return true; };
window.__read = function(){ return JSON.stringify({ text: inp.textContent, sendCount: window.__dshSendCount, inputEvents: window.__muvInputEvents, send: window.__dshSend }); };
</script>
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

  // 场景③：DSH 真实形态 —— contenteditable 输入框（页面上没有 textarea）
  const f3 = path.join(OUT, 'host-ce.html'); fs.writeFileSync(f3, fixtureHtml(false, 'send', true), 'utf8')
  const j3 = await withPage('file:///' + f3.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(800)
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ val: document.getElementById("fakeDshInput").textContent, send: window.__dshSend })',
      returnByValue: true, awaitPromise: true }, sid)
    return JSON.parse((r.result && r.result.result && r.result.result.value) || 'null') || {}
  })
  check('场景③ A 文本到达 contenteditable 输入框', String(j3.val || '').indexOf('你好，DSH') !== -1, JSON.stringify(j3))
  check('场景③ B 发送通道触发', !!(j3.send && j3.send.fired), JSON.stringify(j3))
  check('场景③ C 命中按钮通道（aria-label=发送消息）', !!(j3.send && j3.send.via === 'button'), JSON.stringify(j3))
  check('场景③ E 无 textarea 时不再静默 return false', String(j3.val || '').length > 0 && !!(j3.send && j3.send.fired), JSON.stringify(j3))

  // 场景④：宿主选项按钮**点击委托**（2026-09-26a「行动选项点击没反应」的回归位）
  //   四次真实点击，每次点击后都要：① 文本**追加**（保留已有草稿）② InputEvent ③ 恰好一次发送。
  const f4 = path.join(OUT, 'host-choice.html'); fs.writeFileSync(f4, fixtureChoiceHtml(), 'utf8')
  const j4 = await withPage('file:///' + f4.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(600)
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
      const v = r.result && r.result.result && r.result.result.value
      return JSON.parse(v || 'null')
    }
    const out = {}
    // 每点一次都记「点击前」的文本与发送计数，断言用**增量**（Δ===1），
    //   这样红臂里只有真正被削掉的那条路径变红，其余按钮的断言不受序号漂移牵连。
    const click = async (id) => {
      const before = await ev('window.__read()')            // ← 点击前读数（文本/计数）
      await ev('window.__clickBtn(' + JSON.stringify(id) + ')')
      await sleep(260) // 让 muvDeliverUserText 的 60ms send 定时器跑完
      const after = await ev('window.__read()')
      return { before, after, delta: { send: after.sendCount - before.sendCount, input: after.inputEvents - before.inputEvents } }
    }
    out.sbOpt1 = await click('sbOpt1')
    out.sbOpt2 = await click('sbOpt2')
    out.choiceBtn = await click('choiceBtn')
    out.tavernBtn = await click('tavernBtn')
    // 反向对照：点非选项元素不应投递任何东西
    const noopBefore = (await ev('window.__read()')).sendCount
    await ev('document.body.click()')
    await sleep(200)
    out.noop = { before: noopBefore, after: (await ev('window.__read()')).sendCount }
    return out
  })
  const t1 = (j4.sbOpt1 && j4.sbOpt1.after && j4.sbOpt1.after.text) || ''
  const occurrences = (s, sub) => String(s).split(sub).length - 1
  check('场景④ A1 .muv-sb-opt 点击**发出**（不再是死按钮）',
    !!(j4.sbOpt1 && j4.sbOpt1.delta.send === 1 && j4.sbOpt1.after.send && j4.sbOpt1.after.send.via === 'button'),
    JSON.stringify(j4.sbOpt1))
  check('场景④ A2 文本**追加**而非覆盖（草稿「已有草稿」仍在）',
    !!(j4.sbOpt1 && j4.sbOpt1.before.text === '已有草稿' && t1.indexOf('已有草稿') === 0 && t1.indexOf('先去找琴团长报到') !== -1),
    JSON.stringify(j4.sbOpt1))
  check('场景④ A3 内容触发了 React 可见的 InputEvent',
    !!(j4.sbOpt1 && j4.sbOpt1.delta.input >= 1), JSON.stringify(j4.sbOpt1))
  check('场景④ A4 选项原文**只出现一次**（不许插两份）',
    occurrences(t1, '先去找琴团长报到') === 1, JSON.stringify({ t1, n: occurrences(t1, '先去找琴团长报到') }))
  const t2 = (j4.sbOpt2 && j4.sbOpt2.after && j4.sbOpt2.after.text) || ''
  // 精确取「第二次点击追加进去的那一段」：必须逐字等于按钮原文（开头那个 A 不许被吃掉）。
  //   不能写成 `indexOf('new day…') === -1` —— 「A new day…」本来就包含「new day…」，那是假阴性。
  const appended2 = t2.slice(t2.indexOf('先去找琴团长报到') + '先去找琴团长报到'.length)
  check('场景④ B1 .muv-sb-opt 正文以「A 」开头时**不**被误剥字母',
    !!(appended2 === 'A new day 也要先把地图摊开' && j4.sbOpt2 && j4.sbOpt2.delta.send === 1), JSON.stringify({ appended2, j4: j4.sbOpt2 }))
  const t3 = (j4.choiceBtn && j4.choiceBtn.after && j4.choiceBtn.after.text) || ''
  check('场景④ C1 .muv-choice-btn 的字母徽标仍被剥掉（旧行为不回归）',
    !!(t3.indexOf('顺着安柏的力道走') !== -1 && t3.indexOf('A顺着安柏') === -1 && j4.choiceBtn && j4.choiceBtn.delta.send === 1),
    JSON.stringify(j4.choiceBtn))
  const t4 = (j4.tavernBtn && j4.tavernBtn.after && j4.tavernBtn.after.text) || ''
  check('场景④ D1 .tavern-option-btn 仍可点（data-opt-letter 不误剥）',
    !!(t4.indexOf('停下脚步') !== -1 && j4.tavernBtn && j4.tavernBtn.delta.send === 1), JSON.stringify(j4.tavernBtn))
  check('场景④ E1 非选项元素的点击不投递（无副作用）',
    !!(j4.noop && j4.noop.before === j4.noop.after), JSON.stringify(j4.noop))

  // 场景⑤：真机 `execCommand` 行为臂 —— 「插入生效但返回 false」时必须仍然**只插一份**。
  //   真机取证（_probe-sbopt8.mjs，2026-09-26a）：只按返回值走 appendChild 兜底 ⇒ 输入框里
  //   选项原文出现两份。这条就是那个缺陷的回归位。
  const f5 = path.join(OUT, 'host-choice-execfalse.html'); fs.writeFileSync(f5, fixtureChoiceHtml(true), 'utf8')
  const j5 = await withPage('file:///' + f5.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(600)
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
      const v = r.result && r.result.result && r.result.result.value
      return JSON.parse(v || 'null')
    }
    const before = await ev('window.__read()')
    await ev('window.__clickBtn("sbOpt1")')
    await sleep(260)
    const after = await ev('window.__read()')
    return { before, after, delta: { send: after.sendCount - before.sendCount, input: after.inputEvents - before.inputEvents } }
  })
  const t5 = (j5.after && j5.after.text) || ''
  check('场景⑤ A 真机 execCommand（插入却返回 false）下文本**恰好一份**',
    t5 === '已有草稿先去找琴团长报到' && occurrences(t5, '先去找琴团长报到') === 1,
    JSON.stringify({ t5, n: String(t5).split('先去找琴团长报到').length - 1 }))
  check('场景⑤ B 该臂仍然发出一次（兜底修法没有把投递一起砍掉）',
    !!(j5.delta.send === 1 && j5.after.send && j5.after.send.via === 'button' && j5.delta.input >= 1), JSON.stringify(j5))

  // 场景⑥：受控编辑器仿真 —— 宿主会把**合成** InputEvent 当成插入指令。真机两份就是这个。
  const f6 = path.join(OUT, 'host-choice-controlled.html'); fs.writeFileSync(f6, fixtureChoiceHtml(false, true), 'utf8')
  const j6 = await withPage('file:///' + f6.replace(/\\/g, '/') + '?v=' + Date.now(), async (cdp, sid) => {
    await sleep(600)
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
      const v = r.result && r.result.result && r.result.result.value
      return JSON.parse(v || 'null')
    }
    const before = await ev('window.__read()')
    await ev('window.__clickBtn("sbOpt1")')
    await sleep(260)
    const after = await ev('window.__read()')
    return { before, after, delta: { send: after.sendCount - before.sendCount, input: after.inputEvents - before.inputEvents } }
  })
  const t6 = (j6.after && j6.after.text) || ''
  check('场景⑥ A 受控编辑器下文本**恰好一份**（合成 InputEvent 不许再触发一次插入）',
    t6 === '已有草稿先去找琴团长报到' && occurrences(t6, '先去找琴团长报到') === 1,
    JSON.stringify({ t6, n: String(t6).split('先去找琴团长报到').length - 1 }))
  check('场景⑥ B 原生 input 已到就不再补合成事件（每次点击恰好 1 个 input）',
    !!(j6.delta.input === 1), JSON.stringify(j6))
  check('场景⑥ C 该臂仍然恰好发出一次',
    !!(j6.delta.send === 1 && j6.after.send && j6.after.send.via === 'button'), JSON.stringify(j6))

  console.log('\n' + (fail ? '❌ ' : '✅ ') + `通过 ${pass} / 失败 ${fail}`)
  if (failed.length) console.log('  失败项: ' + failed.join(' | '))
  process.exitCode = fail ? 1 : 0
}
run().catch((e) => { console.log('!! 运行异常: ' + (e && e.stack || e)); process.exit(3) })
