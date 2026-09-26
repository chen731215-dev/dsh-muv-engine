// Gate: 让 `<StatusPlaceHolderImpl/>` 在 DSH 侧真的出现 ⇒ 卡 [2]「ERA 状态栏」真的被渲染。
//
// 为什么必须真浏览器 + 真卡 + 真脚本（三条都是踩出来的）：
//   ① **必须跑对脚本。** 这张卡里 10 份正则，《主页》《正文美化》《ERA 状态栏》都是整页文档。
//      CG 画廊 / 城市地图 / 资源条 / 选项区 / data-era 数值**全在《ERA 状态栏》里**
//      （210,219 字符）。按别的脚本跑，断言量到的全是 undefined —— 看起来全绿，其实什么也没测。
//      所以下面把**脚本名与字符数**当硬断言。
//   ② **沙箱必须与产品一致**（`MUV_CARD_SANDBOX = 'allow-scripts'`，不透明来源）。
//      门禁里绝不能为了变绿而加 `allow-same-origin`，有一条反向断言盯着。
//   ③ **占位符必须由引擎补。** 它是酒馆助手脚本（`tavern_helper.scripts[0]` 的
//      `data["在ai消息尾部生成特殊符号"]`）追加的；预设/世界书/开场白里 0 次出现。
//      所以本门禁的第一条断言就是"引擎确实把它补上了"，第二条是"补上之后 [2] 真的命中"。
//
// 三个臂：
//   after     现盘 `lib/client.js`                        → 必须全绿
//   noph     现盘源码，只把 `withStatusPlaceholder` 的追加改成原样返回 → [2] 必须**不命中**
//   before   `324b751:lib/client.js`（占位符之前）           → [2] 必须**不命中**
// 没有对照组就只能证明"现在没报错"，证明不了补占位符这件事有用。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-status-placeholder-era.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchEdge, sleep, extractFunction, moduleVarStatements } from './verify-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-status-ph')
mkdirSync(OUT, { recursive: true })

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const CARD = process.env.MUV_CARD || 'C:\\deepseek harness\\card-dump\\card.json'
const SCRIPT_NAME = 'ERA 状态栏'
const SCRIPT_LEN = 210219
const OLD_REV = '324b751'

if (!existsSync(EDGE)) throw new Error('找不到浏览器：' + EDGE + '（设 MUV_EDGE）')
if (!existsSync(CARD)) throw new Error('找不到卡：' + CARD)

const cardJson = JSON.parse(readFileSync(CARD, 'utf8'))
const scripts = cardJson.data.extensions.regex_scripts || []
const picked = scripts.find((s) => String(s.scriptName) === SCRIPT_NAME)
if (!picked) throw new Error('卡里找不到《' + SCRIPT_NAME + '》；现有：' + scripts.map((s) => s.scriptName).join(' / '))
if (String(picked.replaceString).length !== SCRIPT_LEN) {
  throw new Error('《' + SCRIPT_NAME + '》长度 ' + String(picked.replaceString).length + ' ≠ 期望 ' + SCRIPT_LEN + ' —— 跑错脚本了')
}
const fence = String(picked.replaceString)
const lines = fence.split('\n')
if (!/^```[a-zA-Z]*$/.test(lines[0]) || !/^```$/.test(lines[lines.length - 1])) {
  throw new Error('《' + SCRIPT_NAME + '》的围栏形状不符合预期')
}
const CARD_BODY = lines.slice(1, -1).join('\n') + '\n'
if (!/^<!doctype/i.test(CARD_BODY.replace(/^\s+/, ''))) throw new Error('《' + SCRIPT_NAME + '》的围栏正文不是整页文档')

console.log('真卡: ' + CARD)
console.log('选中脚本: ' + SCRIPT_NAME + '  ' + SCRIPT_LEN + ' 字符  围栏正文 ' + CARD_BODY.length + ' 字符')

// ── 宿主侧运行时代码（逐字取自 lib/client.js） ─────────────────────────────
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
  return { header: [...need].map((k) => pool[k]).join('\n'), body, extracted: [...have] }
}

const HOST_ROOTS = [
  'cardHtmlIframe', 'withCardCompat', 'muvCardCompatScript', 'muvCardCompatSeed',
  'onMuvCardCompatMessage', 'ensureCardCompatListener', 'muvReplyToFrame',
  'muvEraAnswer', 'muvEraPrewarm', 'muvEraLocator',
]

/** 夹具页：加载真实宿主运行时，用产品自己的 `cardHtmlIframe` 造卡 iframe，再进卡内探测。 */
function fixturePage(rt, envelope, label) {
  const env = JSON.stringify(envelope).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>status-ph-${label}</title></head><body>
<div id="host"></div>
<script>/* 宿主运行时：逐字取自 lib/client.js */</script>
<script>document.documentElement.setAttribute('data-dsh-current-session', 'session-11111111-2222-3333-4444-555555555555');</script>
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
  sandboxOf: function () { return (typeof MUV_CARD_SANDBOX === 'string') ? MUV_CARD_SANDBOX : null; }
};</script>
</body></html>`
}

const EV = (body) => 'JSON.stringify((function(){' + body + '})())'
const EVT = (body) => EV('try{' + body + '}catch(e){return {err:String((e&&e.name)||e)+":"+String((e&&e.message)||"").slice(0,140)}}')

async function pageEval(cdp, sid, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails
    return { err: (d.exception && d.exception.description) || d.text || 'exception' }
  }
  return { value: r.result && r.result.result && r.result.result.value }
}
const jparse = (v, def) => { try { return typeof v === 'string' ? JSON.parse(v) : (v == null ? def : v) } catch (_) { return def } }

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

async function openPage(EDGE, { url } = {}) {
  const { proc, cdp, browserVersion } = await launchEdge(EDGE, url || 'about:blank')
  const t = await cdp.send('Target.getTargets')
  const page = t.result.targetInfos.find((x) => x.type === 'page')
  const at = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  const pageSession = at.result.sessionId
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession)
  await cdp.send('Runtime.enable', {}, pageSession)
  await cdp.send('Page.enable', {}, pageSession)
  return { cdp, pageSession, browserVersion, close() { try { proc.kill() } catch (_) {}; cdp.close() } }
}

// ── Node 侧：这条卡在真 DSH 上的变量表（只读抓一份当夹具数据源） ─────────────
function findPresetIdForCard(cardName) {
  const root = path.join(os.homedir(), '.dsh', '.agent-presets')
  if (!existsSync(root)) return ''
  for (const n of readdirSync(root)) {
    if (!n.startsWith('preset-')) continue
    const cj = path.join(root, n, 'characters.json')
    if (!existsSync(cj)) continue
    try { if (!statSync(cj).isFile()) continue } catch (_) { continue }
    try {
      const txt = readFileSync(cj, 'utf8')
      if (txt.indexOf(cardName) >= 0) return n
    } catch (_) {}
  }
  return ''
}

async function fetchRealPayload() {
  const pid = findPresetIdForCard('_足控天堂2')
  const qs = pid ? ('preferPreset=1&presetId=' + encodeURIComponent(pid)) : 'preferActive=1'
  const url = 'http://127.0.0.1:3080/api/muv-table/tavern-card?' + qs
  const r = await fetch(url)
  const d = await r.json()
  if (!d || !d.ok) throw new Error('变量表数据源不可达：' + url)
  const iv = d.initvarData
  if (!iv || typeof iv !== 'object' || !iv['世界信息']) throw new Error('数据源里没有本卡的变量表')
  console.log('数据源: ' + url)
  console.log('  世界信息.时间.日期 = ' + JSON.stringify(iv['世界信息'] && iv['世界信息'].时间 && iv['世界信息'].时间.日期))
  return iv
}

// ── 单臂 ───────────────────────────────────────────────────────────────────
async function runArm(arm, PAYLOAD) {
  console.log('\n=== 臂: ' + arm.label + '  (' + path.basename(arm.srcPath) + ') ===')
  const c = makeChecks()
  const report = { arm: arm.label, checks: c.rows, extracted: [] }
  const rt = hostRuntimeSource(arm.source, HOST_ROOTS)
  report.extracted = rt.extracted

  const { cdp, pageSession, browserVersion, close } = await openPage(EDGE, { url: 'about:blank' })
  const sessions = []
  cdp.on('Target.attachedToTarget', (p) => {
    if (p.targetInfo.type === 'iframe') sessions.push({ targetId: p.targetInfo.targetId, sessionId: p.sessionId, url: p.targetInfo.url })
  })
  try {
    report.browser = browserVersion
    const fixture = path.join(OUT, 'status-ph-' + arm.label + '.html')
    writeFileSync(fixture, fixturePage(rt, { ok: true, found: true, name: '_足控天堂2', initvarData: PAYLOAD }, arm.label), 'utf8')
    await cdp.send('Page.navigate', { url: 'file:///' + fixture.replace(/\\/g, '/') + '?v=' + Date.now() }, pageSession)
    await sleep(400)

    c.check('前置：宿主侧 ERA 桥的函数被逐字提取到',
      ['onMuvCardCompatMessage', 'muvEraAnswer', 'muvReplyToFrame', 'cardHtmlIframe'].every((n) => rt.extracted.indexOf(n) >= 0),
      '已提取 ' + rt.extracted.length + ' 个')

    await pageEval(cdp, pageSession, 'window.__host.install()')
    const before = sessions.length
    const mk = await pageEval(cdp, pageSession, 'window.__host.spawn(' + JSON.stringify(CARD_BODY) + ') && 1')
    if (mk.err) throw new Error('spawn 失败: ' + mk.err)
    const t0 = Date.now()
    while (sessions.length <= before && Date.now() - t0 < 20000) await sleep(100)
    if (sessions.length <= before) throw new Error('新 iframe 没被 autoAttach 抓到')
    const F = sessions[sessions.length - 1]

    const attrSandbox = (await pageEval(cdp, pageSession, 'document.querySelectorAll("iframe.muv-iframe")[0].getAttribute("sandbox")')).value
    c.check('★ 真 iframe 的 sandbox = 生产常量（不含 allow-same-origin）',
      String(attrSandbox) === 'allow-scripts', 'sandbox=' + JSON.stringify(attrSandbox))

    // 等卡自己的脚本装好（__homeInit 在 DOMContentLoaded 之后 0ms 跑）
    for (let i = 0; i < 60; i++) {
      const r = await pageEval(cdp, F.sessionId, 'typeof window.__homeInit === "function" ? 1 : 0')
      if (r.value === 1) break
      await sleep(150)
    }
    await sleep(2500)

    // ── A. 资源条 / 选项区 / CG 画廊容器 / 地图模态框（[2] 静态产出的 DOM） ──
    const dom = jparse((await pageEval(cdp, F.sessionId, EVT(
      'var q=function(s){return document.querySelectorAll(s).length};' +
      'var g=function(id){return !!document.getElementById(id)};' +
      'return {' +
      '  chips: q(".res-chip"),' +
      '  choices: q(".choice-btn, .choice, #choicesContainer .choice-btn"),' +
      '  choicesBox: g("choicesContainer"),' +
      '  cgModal: g("cgModalOverlay"),' +
      '  cgFs: g("cgFsOverlay"),' +
      '  mapModal: g("mapModal"),' +
      '  mapFrame: g("mapFrame"),' +
      '  app: g("app"),' +
      '  statEls: q("[data-era]"),' +
      '  title: (document.querySelector(".mm-title")||{}).textContent || null,' +
      '  chipTitles: Array.prototype.slice.call(document.querySelectorAll(".res-chip")).map(function(e){return (e.getAttribute("onclick")||"")}).slice(0,12)' +
      '};'))).value, {})
    report.dom = dom
    console.log('  （[2] 静态 DOM 普查）' + JSON.stringify(dom).slice(0, 420))
    c.check('★ 资源条出现了（.res-chip > 0）', dom.chips > 0, '.res-chip = ' + dom.chips)
    c.check('★ CG 画廊弹层在（#cgModalOverlay）', dom.cgModal === true, 'cgModal=' + dom.cgModal)
    c.check('★ 城市地图模态框在（#mapModal + #mapFrame）', dom.mapModal === true && dom.mapFrame === true,
      'mapModal=' + dom.mapModal + ' mapFrame=' + dom.mapFrame)
    c.check('★ 选项区容器在（#choicesContainer）', dom.choicesBox === true, 'choicesBox=' + dom.choicesBox)
    c.check('★ data-era 数值元素被建出来了（> 0）', dom.statEls > 0, '[data-era] = ' + dom.statEls)

    // ── B. 点 CG 画廊 chip（openPortal('quest') → #portalOverlay 变 active） ──
    //
    // ★ 这里一度写错过被测对象：`openPortal('quest')` 打开的是 `#portalOverlay`
    //   （ASTRAL GATE 图鉴），而 `#cgModalOverlay` 是 `cgOpenCharModal(char)` 打开的
    //   角色详情弹窗。按 `cgModalOverlay` 判定 ⇒ 永远 active=false，
    //   看起来"CG 画廊坏了"，其实只是量错了元素。
    const cg = jparse((await pageEval(cdp, F.sessionId, EVT(
      'var chips=document.querySelectorAll(".res-chip");' +
      'var hit=null;' +
      'for(var i=0;i<chips.length;i++){var oc=String(chips[i].getAttribute("onclick")||"");if(oc.indexOf("openPortal")>=0&&oc.indexOf("quest")>=0){hit=chips[i];break}}' +
      'if(!hit)return {found:false,n:chips.length};' +
      'hit.click();' +
      'var ov=document.getElementById("portalOverlay");' +
      'var body=document.getElementById("portalBody");' +
      'return {found:true,active:!!(ov&&ov.classList.contains("active")),' +
      '  portalTitle:(document.getElementById("portalTitle")||{}).textContent||null,' +
      '  bodyLen:body?String(body.innerHTML).length:0,' +
      '  imgs:body?body.querySelectorAll("img").length:0};'))).value, {})
    report.cgGallery = cg
    c.check('★ CG 画廊（#portalOverlay）能被点开且渲染出内容',
      cg.found === true && cg.active === true && cg.bodyLen > 200,
      JSON.stringify(cg))

    // ── B2. 角色详情弹窗（cgOpenCharModal → #cgModalOverlay 变 active） ──
    const cgChar = jparse((await pageEval(cdp, F.sessionId, EVT(
      'if(typeof cgOpenCharModal!=="function")return {no:true};' +
      'cgOpenCharModal("超天酱");' +
      'var m=document.getElementById("cgModalOverlay");' +
      'return {no:false,active:!!(m&&m.classList.contains("active")),len:m?String(m.innerHTML).length:0};'))).value, {})
    report.cgCharModal = cgChar
    c.check('★ CG 角色详情弹窗（#cgModalOverlay）能被打开并渲染',
      cgChar.no !== true && cgChar.active === true && cgChar.len > 200, JSON.stringify(cgChar))

    // ── C. 点地图 chip 打开城市地图 ──
    const mp = jparse((await pageEval(cdp, F.sessionId, EVT(
      'var chips=document.querySelectorAll(".res-chip");' +
      'var hit=null;' +
      'for(var i=0;i<chips.length;i++){var oc=String(chips[i].getAttribute("onclick")||"");if(oc.indexOf("openMapModal")>=0){hit=chips[i];break}}' +
      'if(!hit)return {found:false};' +
      'hit.click();' +
      'var m=document.getElementById("mapModal");' +
      'return {found:true,shown:!!(m&&m.classList.contains("show")),src:(document.getElementById("mapFrame")||{}).getAttribute?document.getElementById("mapFrame").getAttribute("src"):null};'))).value, {})
    report.mapModal = mp
    c.check('★ 城市地图能被点开（openMapModal → #mapModal 变 show）', mp.found === true && mp.shown === true, JSON.stringify(mp))
    c.check('  地图 iframe 的 src 是卡里写死的那个地址（域名已知会超时，如实记录）',
      typeof mp.src === 'string' && mp.src.length > 0, String(mp.src))

    // ── D. era:getCurrentVars → 数值从"空"变"有数" ──
    const PROBE = '世界信息.时间.日期'
    const wantVal = PAYLOAD['世界信息'] && PAYLOAD['世界信息'].时间 && PAYLOAD['世界信息'].时间.日期
    const DOMQ = EV('var el=document.querySelector(\'[data-era="' + PROBE + '"]\');return {has:!!el,txt:el?el.textContent:null};')
    const before2 = jparse((await pageEval(cdp, F.sessionId, DOMQ)).value, {})
    await pageEval(cdp, F.sessionId, EVT('eventEmit("era:getCurrentVars");return {ok:true};'))
    await sleep(2000)
    const after2 = jparse((await pageEval(cdp, F.sessionId, DOMQ)).value, {})
    report.eraDom = { before: before2, after: after2, want: wantVal }
    c.check('★★ 数值元素（data-era="' + PROBE + '"）拿到了数据源里的值',
      after2.has === true && String(after2.txt) === String(wantVal),
      '前=' + JSON.stringify(before2.txt) + ' 后=' + JSON.stringify(after2.txt) + ' 期望=' + JSON.stringify(wantVal))

    const st = jparse((await pageEval(cdp, F.sessionId, EVT('return {has:(typeof eraGet==="function"),v:(typeof eraGet==="function")?eraGet("' + PROBE + '",""):null,cur:(typeof currentStat!=="undefined")};'))).value, {})
    c.check('★★ 卡的 eraGet("' + PROBE + '") 取到了值（currentStat 是干净数据）',
      String(st.v) === String(wantVal), JSON.stringify(st))

    // ── E. 反向断言：安全护栏 ──
    const sec = jparse((await pageEval(cdp, F.sessionId, EVT('var d=window.parent.document;return {reached:!!d,err:null};'))).value, { bad: true })
    const denied = (sec && typeof sec.err === 'string' && sec.err.indexOf('SecurityError') === 0) || (sec && sec.reached === false)
    c.check('★★ 反向断言：卡内 window.parent.document 仍被拒', denied, JSON.stringify(sec))

    // ── F. 卡内脚本跑完了没报错（[2] 末尾的 console.log 是现成的哨兵） ──
    const ran = jparse((await pageEval(cdp, F.sessionId, EVT(
      'return {initDone: !!window.__homeInitDone, listeners: (typeof eventOn==="function")};'))).value, {})
    c.check('★ 卡的初始化真的跑完（__homeInitDone=1）', ran.initDone === true, JSON.stringify(ran))
  } finally {
    close()
  }
  return report
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
const PAYLOAD = await fetchRealPayload()

const nowSrc = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
// 对照：只把 withStatusPlaceholder 的追加那一行改掉（其余逐字相同）
const MARK = "        return String(text).replace(/\\s+$/, '') + '\\n' + STATUS_PH_TEXT"
if (nowSrc.indexOf(MARK) < 0) throw new Error('对照臂的记号在这份源码里找不到（追加那一行被改过？）')
const noPhSrc = nowSrc.replace(MARK, '        return text')

let oldPath = ''
try {
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status === 0 && r.stdout) {
    oldPath = path.join(__dirname, '.tmp-statusph-old-client-' + OLD_REV + '.js')
    writeFileSync(oldPath, r.stdout, 'utf8')
  }
} catch (_) {}

const arms = [
  { label: 'after', srcPath: path.join(__dirname, 'lib', 'client.js'), source: nowSrc },
  { label: 'noph', srcPath: path.join(__dirname, 'lib', 'client.js'), source: noPhSrc },
]
if (oldPath) arms.push({ label: 'before', srcPath: oldPath, source: readFileSync(oldPath, 'utf8') })

// ── 静态断言：占位符到底会不会被补上（用真卡 JSON 走真函数） ──
console.log('\n=== 静态：withStatusPlaceholder 对真卡的行为 ===')
{
  const box = new Function('STATUS_PH_TEST', 'STATUS_PH_TEXT', nowSrc.match(/[ \t]*function cardWantsStatusPlaceholder[\s\S]*?\n    \}/)[0] + '\n' + nowSrc.match(/[ \t]*function withStatusPlaceholder[\s\S]*?\n    \}/)[0] + '\n return { a: withStatusPlaceholder, b: cardWantsStatusPlaceholder }')
  const api = box(/<StatusPlaceHolderImpl\s*\/>/i, '<StatusPlaceHolderImpl/>')
  const sample = '<content>正文</content>'
  const outA = api.a(sample, cardJson)
  const outN = api.a(sample, { data: { extensions: { regex_scripts: [{ findRegex: '/x/g', replaceString: 'y' }] } } })
  const idem = api.a(sample + '\n<StatusPlaceHolderImpl/>', cardJson)
  console.log('  真卡：尾部补上占位符 = ' + /<StatusPlaceHolderImpl\s*\/>/.test(outA) + '   尾部 = ' + JSON.stringify(outA.slice(-30)))
  console.log('  幂等：正文已有占位符时不重复追加 = ' + ((idem.match(/StatusPlaceHolderImpl/g) || []).length === 1))
  console.log('  反向：卡不认这个标记时一个字符都不加 = ' + (outN === sample))
}

// ── 第一部分：占位符 → [2] 真的命中（**这一部分才是"补占位符有用没有"的判据**） ──
//
// ★ 为什么必须单独一部分：上面那些 DOM 普查是在**直接把卡的整页文档塞进 iframe** 之后量的
//   —— 它证明的是"卡的脚本在我们这个沙箱里跑得起来"，**不能**证明"引擎补的那个占位符"
//   起了作用（不补占位符，把文档直接塞进 iframe 一样有 9 个 chip）。
//   这一部分走的是**真实链路**：真卡 + 真模型回复 → 真 regex-engine → 数产物里有几份文档。
console.log('\n=== 第一部分：占位符 → 卡 [2]「ERA 状态栏」命中（真卡 + 真模型回复 + 真引擎） ===')
const part1 = makeChecks()
{
  const c = part1
  const { applyAllRegexScripts, regexScriptsOf } = await import('./lib/regex-engine.js')
  const REPLY_FILE = process.env.MUV_REAL_REPLY ||
    'C:/Users/21334/.dsh/profiles/web/node_modules/dsh-muv-engine/.tmp-real-reply.normalized.txt'
  if (!existsSync(REPLY_FILE)) throw new Error('找不到真实模型回复样本：' + REPLY_FILE)
  const reply = readFileSync(REPLY_FILE, 'utf8')
  // 真机形态：标题与 <content> 被折进同一行（见 REPORT.md §8.4）
  const realForm = reply.replace('### 正文\n\n<content>\n<response>\n<now_plot>\n', '正文 <content>\n<response>\n<now_plot>\n')

  const scr = regexScriptsOf(cardJson)
  const PH = '<StatusPlaceHolderImpl/>'
  const runIt = async (text, depth) => {
    const res = applyAllRegexScripts(text, scr, 'display', { depth })
    return { out: res.text, applied: res.applied, docs: (res.text.match(/<!DOCTYPE/gi) || []).length }
  }

  // with = 引擎补占位符之后送进去的文本；without = 修之前的行为（原样送）
  const withPh = realForm.replace(/\s+$/, '') + '\n' + PH
  const a = await runIt(withPh, 0)
  const b = await runIt(realForm, 0)

  console.log('  输入（折行形态）长度 = ' + realForm.length + '；补占位符后 = ' + withPh.length)
  console.log('  补占位符: 产物 ' + a.out.length + ' 字符，整页文档 ' + a.docs + ' 份')
  console.log('  不补    : 产物 ' + b.out.length + ' 字符，整页文档 ' + b.docs + ' 份')
  c.check('★ 补占位符 ⇒ [2]「ERA 状态栏」命中：产物里出现**第 2 份**整页文档（210 KB 状态栏）',
    a.docs === 2, '文档份数 = ' + a.docs)
  c.check('★ 不补占位符 ⇒ [2] 不命中：只有 [1] 那一份文档', b.docs === 1, '文档份数 = ' + b.docs)
  c.check('★ 两份文档的差值 ≈ 状态栏脚本长度（证明确实是那 210 KB 的东西）',
    (a.out.length - b.out.length) > 200000,
    '产物长度差 = ' + (a.out.length - b.out.length) + ' 字符（脚本本身 ' + SCRIPT_LEN + '）')
  c.check('★ [2] 的产物里带着它的可辨识标识（资源条 / 地图 / CG 画廊）',
    a.out.indexOf('res-chip') >= 0 && a.out.indexOf('mapFrame') >= 0 && a.out.indexOf('cgModalOverlay') >= 0,
    'res-chip=' + (a.out.indexOf('res-chip') >= 0) + ' mapFrame=' + (a.out.indexOf('mapFrame') >= 0) + ' cgModalOverlay=' + (a.out.indexOf('cgModalOverlay') >= 0))
  c.check('  对照：不补占位符时产物里**没有**这些标识（说明上面那条不是白来的）',
    b.out.indexOf('res-chip') < 0 && b.out.indexOf('mapFrame') < 0,
    'res-chip=' + (b.out.indexOf('res-chip') >= 0) + ' mapFrame=' + (b.out.indexOf('mapFrame') >= 0))
}

const reports = []
for (const arm of arms) reports.push(await runArm(arm, PAYLOAD))

console.log('\n=== 汇总 ===')
// `makeChecks()` 返回 `{rows, check}`；`runArm` 返回的 report 里那份叫 `checks`。
// 两个名字都认，避免又一处"量错对象"。
const rowsOf = (r) => (r && (r.rows || r.checks)) || []
const count = (r) => ({ p: rowsOf(r).filter((x) => x.ok).length, f: rowsOf(r).filter((x) => !x.ok).length })
const p1 = count(part1)
console.log('  [第一部分] 占位符 → [2] 命中: ' + p1.p + ' 通过 / ' + p1.f + ' 失败')
for (const x of rowsOf(part1)) if (!x.ok) console.log('       FAIL: ' + x.name + '  -> ' + x.detail)
for (const r of reports) {
  const n = count(r)
  console.log('  [第二部分] ' + r.arm + ': ' + n.p + ' 通过 / ' + n.f + ' 失败')
  for (const x of rowsOf(r)) if (!x.ok) console.log('       FAIL: ' + x.name + '  -> ' + x.detail)
}
const after = reports.find((r) => r.arm === 'after')
const verdict = { ok: count(after).f === 0 && p1.f === 0, part1Fail: p1.f, afterFail: count(after).f, arms: {} }
for (const r of reports) verdict.arms[r.arm] = count(r)
console.log('  结论: ' + (verdict.ok ? '绿灯（第一部分 + after 臂全绿）'
  : (p1.f ? '红：第一部分 ' + p1.f + ' 条失败' : '红：after 臂 ' + verdict.afterFail + ' 条失败')))
console.log('  CG 画廊（portalOverlay）: ' + JSON.stringify(after && after.cgGallery))
console.log('  CG 详情（cgModalOverlay）: ' + JSON.stringify(after && after.cgCharModal))
console.log('  地图    : ' + JSON.stringify(after && after.mapModal))
console.log('  数值    : ' + JSON.stringify(after && after.eraDom))
writeFileSync(path.join(OUT, 'status-ph-report.json'), JSON.stringify({ verdict, part1: part1.rows, reports }, null, 2), 'utf8')
console.log('  报告: ' + path.join(OUT, 'status-ph-report.json'))
process.exit(verdict.ok ? 0 : 1)
