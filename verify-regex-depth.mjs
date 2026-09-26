// Gate: 卡的 `[8]「自动总结，隐藏6楼以上除摘要外内容」`（`minDepth = 7`）在 DSH 侧是不是死代码
//       —— 即「装饰链有没有把 depth 传给取卡那一步」。
//
// 被测对象（用户屏幕上的那条路径）：
//   `_decorateOne` → `beautifyMuv(raw, {depth})` → `POST /api/muv-engine/apply-regex-card`
//   → `regex-engine.js:applyAllRegexScripts(..., {depth})` → `depthAllows(script, depth)`
//
// 为什么必须量"请求体里的 depth"：`index.js:168` 把 `body.depth` 原样交给引擎；
// 引擎在 display 侧对 `undefined` 取默认 **0**（`regex-engine.js:194-197`）。
// 所以**不传 depth 与传 0 完全一样** —— 卡里 `minDepth = 7` 的 [8] 永远不满足，
// 而 `[7]` 又把 `<Abstract>` 删掉 ⇒ 旧楼层"既没摘要、也没塌陷"，两头落空。
//
// 三个臂：
//   after   现盘 lib/client.js
//   nodepth 只把请求体里那个 `depth: depth` 改回不传（= 修之前的行为）
//   before  `324b751:lib/client.js`
// `nodepth` 是本门禁**唯一**的能红落点：它必须让「[8] 在 depth≥7 时生效」变红。
//
// 运行：node verify-regex-depth.mjs      （不需要浏览器）
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
const V2 = RAW.replace('### 正文\n\n<content>\n<response>\n<now_plot>\n', '正文 <content>\n<response>\n<now_plot>\n')

const scripts = regexScriptsOf(cardJson)
const HIDE = scripts.find((s) => String(s.scriptName).indexOf('自动总结') >= 0)
if (!HIDE) throw new Error('卡里找不到 [8]「自动总结…」脚本')
console.log('真卡: ' + CARD)
console.log('  [8] 脚本名: ' + HIDE.scriptName + '   minDepth=' + HIDE.minDepth + '   maxDepth=' + HIDE.maxDepth)
if (Number(HIDE.minDepth) !== 7) throw new Error('[8] 的 minDepth 不是 7（' + HIDE.minDepth + '）—— 门禁的前提变了')

let bad = 0
const check = (name, ok, detail) => {
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail === undefined ? '' : '  -> ' + String(detail)))
  if (!ok) bad++
}

// ── 引擎侧的真实阈值（不经过装饰链，直接量 [8] 在哪个 depth 开始生效）──────────
console.log('\n=== 引擎侧基线：[8] 在哪个 depth 开始生效（真脚本 + 真回复）===')
const engineAt = (d) => {
  const r = applyAllRegexScripts(V2, scripts, 'display', { depth: d })
  return { len: r.text.length, applied: r.applied }
}
const e0 = engineAt(0)
const e6 = engineAt(6)
const e7 = engineAt(7)
console.log('  depth=0 → ' + e0.len + ' 字符')
console.log('  depth=6 → ' + e6.len + ' 字符')
console.log('  depth=7 → ' + e7.len + ' 字符')
check('depth<7 时 [8] 不生效（产物仍然很长）', e6.len > 1000, 'depth=6 len=' + e6.len)
check('★ depth>=7 时 [8] 生效（除摘要外全被吞掉 ⇒ 产物骤降）', e7.len < e6.len / 10,
  'depth=7 len=' + e7.len + '   depth=6 len=' + e6.len)
check('[8] 确实带着 minDepth=7 这个门槛被引擎认到（不是"恰好"变的）',
  Number(HIDE.minDepth) === 7 && e0.len !== e7.len, 'minDepth=7')

// ── 装饰链侧：真 beautify + 真卡 + 真回复，看请求体里到底有没有 depth ──────────
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
  const seen = []
  const fetchStub = async (url, opts) => {
    const u = String(url)
    if (u.startsWith('/api/muv-table/tavern-card')) {
      return { json: async () => ({ ok: true, name: 'c', data: cardJson.data, initvarData: {} }) }
    }
    if (u.startsWith('/api/muv-engine/apply-regex-card')) {
      const body = JSON.parse(opts.body)
      seen.push({ hasDepth: Object.prototype.hasOwnProperty.call(body, 'depth'), depth: body.depth })
      const res = applyAllRegexScripts(body.text, scripts, 'display', { depth: body.depth })
      return { json: async () => ({ ok: true, text: res.text, applied: res.applied, statusBarHtml: extractStatusBarHtml(scripts) }) }
    }
    return { json: async () => ({ ok: false }) }
  }
  let captured = null
  win.__ModuleLoader__ = { load(def) { captured = def } }
  new Function('window', 'document', 'location', 'localStorage', 'MutationObserver', 'getComputedStyle', 'fetch', clientSrc)(
    win, doc, win.location, win.localStorage, win.MutationObserver, win.getComputedStyle, fetchStub)
  const req = createRequire(path.join(__dirname, 'verify-regex-depth.mjs'))
  captured.factory(req)
  return { beautify: win.MuvEngine.beautify, seen }
}

const CUR = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
function breakNoDepth(src) {
  const needle = 'body: JSON.stringify({ text: regText, cardJson, depth: depth })'
  if (src.indexOf(needle) < 0) throw new Error('对照臂 nodepth 的记号找不到')
  return src.replace(needle, 'body: JSON.stringify({ text: regText, cardJson })')
}
let oldSrc = ''
try {
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status === 0 && r.stdout) oldSrc = r.stdout
} catch (_) {}

const arms = [
  { label: 'after', src: CUR },
  { label: 'nodepth-不传depth', src: breakNoDepth(CUR) },
]
if (oldSrc) arms.push({ label: 'before-' + OLD_REV, src: oldSrc })

console.log('\n=== 装饰链侧：请求体里的 depth 与产物（真 beautify + 真卡 + 真回复）===')
const per = {}
for (const arm of arms) {
  console.log('\n--- ' + arm.label + ' ---')
  const { beautify, seen } = makeBeautify(arm.src)
  const rows = []
  for (const want of [0, 3, 6, 7, 9]) {
    seen.length = 0
    const out = await beautify(V2, { depth: want })
    const got = seen.length ? seen[0] : null
    rows.push({ want, got, outLen: out.length })
    console.log('  传 depth=' + want + ' → 请求体 depth=' + JSON.stringify(got && got.depth) +
      '（有该键=' + (got && got.hasDepth) + '）  产物 ' + out.length + ' 字符')
  }
  per[arm.label] = rows
}

console.log('\n=== 汇总（能红证据）===')
const afterRows = per['after']
check('★ after：装饰链把 depth 原样送到了取卡请求里（0/3/6/7/9 全部对得上）',
  afterRows.every((r) => r.got && r.got.hasDepth === true && r.got.depth === r.want),
  JSON.stringify(afterRows.map((r) => r.got && r.got.depth)))

const after7 = afterRows.find((r) => r.want === 7)
const after6 = afterRows.find((r) => r.want === 6)
check('★ after：depth=7 时 [8] 真的生效（产物骤降 ⇒ 旧楼层被塌陷）',
  after7.outLen < after6.outLen / 10, 'depth=6 → ' + after6.outLen + ' 字符；depth=7 → ' + after7.outLen + ' 字符')
check('★ after：depth<7 时 [8] 不生效（新楼层照常完整渲染）',
  after6.outLen > 1000, 'depth=6 → ' + after6.outLen + ' 字符')

const nodRows = per['nodepth-不传depth']
check('★★ 能红：nodepth 臂（不传 depth）⇒ 请求体里没有 depth 这个键',
  nodRows.every((r) => r.got && r.got.hasDepth === false),
  JSON.stringify(nodRows.map((r) => r.got && r.got.hasDepth)))
check('★★ 能红：nodepth 臂下 [8] 永不生效（depth=7 与 depth=0 产物相同 ⇒ 死代码）',
  nodRows.every((r) => r.outLen === nodRows[0].outLen),
  JSON.stringify(nodRows.map((r) => r.outLen)))

if (oldSrc) {
  const oldRows = per['before-' + OLD_REV]
  check('  before（' + OLD_REV + '）同样量不到 depth（对照臂如实变红）',
    oldRows.every((r) => !r.got || r.got.hasDepth === false),
    JSON.stringify(oldRows.map((r) => r.got && r.got.hasDepth)))
}

const verdict = {
  ok: bad === 0,
  hide: { name: HIDE.scriptName, minDepth: HIDE.minDepth, maxDepth: HIDE.maxDepth },
  engine: { d0: e0.len, d6: e6.len, d7: e7.len },
  arms: per,
}
writeFileSync(path.join(__dirname, '.tmp-regex-depth-report.json'), JSON.stringify(verdict, null, 2), 'utf8')
console.log('\n  结论: ' + (verdict.ok ? '绿灯（after 全绿；nodepth 臂在两条主断言上都是红的）' : '红：见上 ' + bad + ' 条'))
process.exit(verdict.ok ? 0 : 1)
