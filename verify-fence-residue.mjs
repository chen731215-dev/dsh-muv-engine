// Gate: 「`正文` 后面漏出 ```html」这条 DSH 引擎缺陷 —— 真卡 + 真模型回复，before/after + 能红对照。
//
// 被测对象：`_decorateOne` 拿 `body.innerText` 当输入时，DSH 的 markdown 已把 `### 正文`
// 渲染成标题、把紧跟的 `<content>` 折进同一行 ⇒ 卡的 `[1]` 把开围栏落到**行中部** ⇒
// `renderFencedHtml` 的行首锚定正则够不着它 ⇒ 三个反引号当普通文本留在消息里。
//
// 判据刻意写成「**srcdoc 之外**的反引号」而不是「产物里有反引号」：
//   卡自己的 JS 里有大量模板字符串反引号，它们**合法地**待在 iframe 的 srcdoc 属性里
//   （`escAttr` 不转义反引号）。只看"产物里有没有 ```"会把那些算成缺陷 —— 那就成了
//   "测的不是用户屏幕上那条路径"。用户能看到的是 **srcdoc 之外**的那些。
//
// 三个臂：
//   after    现盘 lib/client.js
//   broken1  只把 `fenceOpenAt` 的「跳过信息串」那一步删掉（回到"数不到反引号"那一版）
//   broken2  只把 `if (fenceOpen >= 0)` 改回 `if (fenceOpen)`（0 与"没找到"歧义）
//   before   `324b751:lib/client.js`（整条吞并逻辑都不存在）
// 三条对照臂都必须让主断言变红。
//
// 运行：node verify-fence-residue.mjs        （不需要浏览器）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyAllRegexScripts, extractStatusBarHtml, regexScriptsOf } from './lib/regex-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CARD = process.env.MUV_CARD || 'C:\\deepseek harness\\card-dump\\card.json'
const REPLY = process.env.MUV_REAL_REPLY ||
  'C:\\Users\\21334\\.dsh\\profiles\\web\\node_modules\\dsh-muv-engine\\.tmp-real-reply.normalized.txt'
const OLD_REV = '324b751'

if (!existsSync(CARD)) throw new Error('找不到卡：' + CARD)
if (!existsSync(REPLY)) throw new Error('找不到真实模型回复：' + REPLY)
const cardJson = JSON.parse(readFileSync(CARD, 'utf8'))
const RAW = readFileSync(REPLY, 'utf8')
const T = String.fromCharCode(96)
const BT3 = T + T + T

// 真机形态：标题与 <content> 同行
const V = {
  'V1 标题独占行（磁盘原样）': RAW,
  'V2 ★标题与 <content> 同行（真机形态）': RAW.replace('### 正文\n\n<content>\n<response>\n<now_plot>\n', '正文 <content>\n<response>\n<now_plot>\n'),
  'V3 标题+<content> 同行带空格': RAW.replace('### 正文\n\n', '正文 ').replace('<content>\n', '<content> '),
  'V4 全部折成一行（最坏情况）': RAW.replace(/### 正文\n\n/, '正文 ').replace(/\n/g, ' '),
}

/** 用户屏幕上能看到的反引号 = srcdoc 之外的反引号。 */
const visibleBackticks = (html) => (String(html).replace(/srcdoc="[^"]*"/g, 'SRCDOC').match(new RegExp(BT3, 'g')) || []).length

/** 产物指纹：用来判"两条臂产出的东西是不是同一个"（对照臂需要它）。 */
function hashOf(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0
    h2 = (h2 + c) >>> 0; h2 = (h2 * 0x85ebca6b) >>> 0
  }
  return h1.toString(16) + str.length.toString(16) + h2.toString(16)
}

/** 用一份 client.js 源码起一个 beautify（真卡 + 真 regex-engine，走真链路）。 */
function makeBeautify(clientSrc) {
  const el = () => ({
    style: {}, dataset: {}, className: '', children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    appendChild(c) { return c }, removeChild() {}, insertBefore() {}, remove() {},
    querySelector() { return null }, querySelectorAll() { return [] },
    addEventListener() {}, removeEventListener() {},
    textContent: '', innerHTML: '', innerText: '', closest() { return null }, contains() { return false },
  })
  const doc = {
    body: el(), head: el(), documentElement: el(),
    createElement: () => el(), createTextNode: () => ({}), getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createRange: () => ({ setStart() {}, setEnd() {}, deleteContents() {}, insertNode() {} }),
    createTreeWalker: () => ({ nextNode: () => null }), cookie: '',
  }
  const win = {
    innerHeight: 900, innerWidth: 940, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { href: 'http://127.0.0.1:3080/' }, document: doc,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return [] } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  }
  const fetchStub = async (url, opts) => {
    const u = String(url)
    if (u.startsWith('/api/muv-table/tavern-card')) {
      return { json: async () => ({ ok: true, name: 'c', data: cardJson.data, initvarData: {} }) }
    }
    if (u.startsWith('/api/muv-engine/apply-regex-card')) {
      const body = JSON.parse(opts.body)
      const scripts = regexScriptsOf(body.cardJson)
      const res = applyAllRegexScripts(body.text, scripts, 'display', { depth: body.depth })
      return { json: async () => ({ ok: true, text: res.text, applied: res.applied, statusBarHtml: extractStatusBarHtml(scripts) }) }
    }
    return { json: async () => ({ ok: false }) }
  }
  // 沙箱：用与产品同一个模块加载协议，跑**真** client.js 源码。
  // Node 里没有 `window`/`document` 全局，所以这里显式把 stub 注入 new Function 的形参。
  let captured = null
  win.__ModuleLoader__ = { load(def) { captured = def } }
  new Function('window', 'document', 'location', 'localStorage', 'MutationObserver', 'getComputedStyle', 'fetch', clientSrc)(
    win, doc, win.location, win.localStorage, win.MutationObserver, win.getComputedStyle, fetchStub)
  const req = createRequire(path.join(__dirname, 'verify-fence-residue.mjs'))
  captured.factory(req)
  return win.MuvEngine.beautify
}

const CUR = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')

// ── 三条对照臂的源码改造（每条只改一处，其余逐字相同）──────────────────────
function breakDropInfoString(src) {
  const needle = "        while (i > 0 && s2.charAt(i - 1) !== '`' && s2.charAt(i - 1) !== '\\n') i--"
  if (src.indexOf(needle) < 0) throw new Error('对照臂 broken1 的记号找不到（跳过信息串那一步被改过？）')
  return src.replace(needle, '        /* broken1: 跳过信息串的那一步被删掉 */')
}
function breakZeroSentinel(src) {
  const needle = '        if (fenceOpen >= 0) start = fenceOpen'
  if (src.indexOf(needle) < 0) throw new Error('对照臂 broken2 的记号找不到')
  return src.replace(needle, '        if (fenceOpen) start = fenceOpen')
}

let oldSrc = ''
try {
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status === 0 && r.stdout) oldSrc = r.stdout
} catch (_) {}

const arms = [
  { label: 'after', src: CUR },
  { label: 'broken1-无跳过信息串', src: breakDropInfoString(CUR) },
  { label: 'broken2-0当没找到', src: breakZeroSentinel(CUR) },
]
if (oldSrc) arms.push({ label: 'before-' + OLD_REV, src: oldSrc })

let bad = 0
const results = {}
console.log('卡: ' + CARD)
console.log('真实模型回复: ' + REPLY + '  ' + RAW.length + ' 字符')
console.log('真机形态 V2：' + JSON.stringify(V[Object.keys(V)[1]].slice(0, 26)))
console.log('')
console.log('判据：**srcdoc 之外**用户能看到的反引号段数（期望 0）')
console.log('')

for (const arm of arms) {
  const beautify = makeBeautify(arm.src)
  const per = {}
  let armBad = 0
  console.log('=== ' + arm.label + ' ===')
  for (const [name, text] of Object.entries(V)) {
    const out = await beautify(text)
    const n = visibleBackticks(out)
    const iframes = (out.match(/<iframe /g) || []).length
    per[name] = { visible: n, iframes, outLen: out.length, head: out.slice(0, 30), hash: hashOf(out) }
    const ok = n === 0
    if (!ok) armBad++
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + '  可见反引号=' + n + '  iframe=' + iframes + '  outLen=' + out.length + '  head=' + JSON.stringify(out.slice(0, 30)))
  }
  results[arm.label] = per
  if (arm.label === 'after') bad += armBad
  console.log('  → ' + (armBad ? armBad + '/4 条有残留' : '4/4 干净') + '\n')
}

console.log('=== 汇总（能红证据） ===')
const mainKey = Object.keys(V)[1]
console.log('  主断言 = V2 那一档「srcdoc 之外的反引号 = 0」')
for (const arm of arms) {
  const v = results[arm.label][mainKey].visible
  const head = results[arm.label][mainKey].head
  console.log('  ' + arm.label.padEnd(24) + ' V2 可见反引号=' + v + (v === 0 ? ' ✅' : ' ❌') + '   head=' + JSON.stringify(head))
}
const afterOk = Object.keys(V).every((k) => results['after'][k].visible === 0)
const break1Red = results['broken1-无跳过信息串'][mainKey].visible > 0
// ★ `broken2` 把 0 当成"没找到"。它**不会**漏出反引号（那条围栏会被"
//   段尾孤立开围栏"那条路补吃掉），但它会让产物**变成另一个样子** ——
//   实测 V2/V3：iframe 2→3、outLen 306033→283566。所以它的判据必须是
//   "产物与 after 逐字相同"，否则这条对照会假绿（第一版就是按反引号判的，于是"对照失效"）。
const diffKeys = Object.keys(V).filter((k) => results['broken2-0当没找到'][k].hash !== results['after'][k].hash)
const break2Red = diffKeys.length > 0
console.log('  after 全绿（4/4 可见反引号 = 0）  : ' + afterOk)
console.log('  broken1（删跳过信息串）           : ' + (break1Red ? '红 ✅（V2 露出 `正文 ```html` —— 正是用户截图那一行）' : '★仍然绿 ⇒ 对照失效'))
console.log('  broken2（0 当没找到）             : ' + (break2Red ? '红 ✅（产物与 after 不同的档：' + diffKeys.join(' / ') + '）' : '★仍然绿 ⇒ 对照失效'))
if (oldSrc) console.log('  before（' + OLD_REV + '）                : ' + (results['before-' + OLD_REV][mainKey].visible > 0 ? '红 ✅' : '★仍然绿'))
const verdict = { ok: afterOk && break1Red && break2Red, afterOk, break1Red, break2Red, diffKeys, results }
writeFileSync(path.join(__dirname, '.tmp-fence-residue-report.json'), JSON.stringify(verdict, null, 2), 'utf8')
console.log('\n  结论: ' + (verdict.ok ? '绿灯（after 全绿；两条改造臂都在主断言上变红）' : '红：见上'))
process.exit(verdict.ok ? 0 : 1)
