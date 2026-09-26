// 门禁：renderFencedHtml 的围栏识别 —— 拿**真实卡 + 真实模型输出**验证
//   ① 卡片文档后面紧跟的「说明文字里的行首反引号」不会再把整块劫持成裸文本；
//   ② 没有围栏的裸整页文档（脚本 [6] 视频 / [9] CG插图 那种形态）也会进 iframe；
//   ③ 合法用法（```html / ```js / ````html）不受影响。
//
// 关键：判据必须能在**旧源码**上失败。用法：
//   node verify-fence-hijack-main.mjs
//   $env:MUV_CLIENT_SRC="<旧 client.js 路径>"; node verify-fence-hijack-main.mjs   # 对照臂
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ENGINE = 'C:\\dsh-muv-engine\\lib\\regex-engine.js'
const CLIENT = process.env.MUV_CLIENT_SRC || 'C:\\dsh-muv-engine\\lib\\client.js'
const CARD_DIR = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'
const SESS = path.join('C:\\Users\\21334\\.dsh', 'storages', 'session_projcache', 'sessions')

let pass = 0, fail = 0
const failures = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  [PASS] ${name}`) }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? '  -> ' + detail : ''}`) }
}

// 用「取函数源码 + new Function」执行，避免加载整个插件（它需要 window/Cordis）
//
// ★ 大括号配平必须**跳过字符串与正则字面量**：本文件里就有 `/^[ \t]{0,3}(`{3,})/`
//   这种正则，里面的 `{` `}` 会让朴素计数提前收尾，抽出一个半截函数，
//   然后以 `SyntaxError: Unexpected token ')'` 的形式炸在 new Function 上 ——
//   看起来像被测代码坏了，其实是测试脚手架坏了。本项目已多次栽在这类假象上。
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('not found: ' + name)
  let i = src.indexOf('{', start)
  let depth = 0
  let prev = ''          // 上一个非空白字符，用来判断 `/` 是除号还是正则起头
  let inS = null         // 当前所在字符串的引号
  let inRe = false       // 是否在正则字面量里
  let inLineComment = false
  let inBlockComment = false
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (inLineComment) { if (c === '\n') inLineComment = false; continue }
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++ } continue }
    if (inS) {
      if (c === '\\') { i++; continue }
      if (c === inS) inS = null
      continue
    }
    if (inRe) {
      if (c === '\\') { i++; continue }
      if (c === '[') { // 正则字符组里的 ] 不结束正则
        i++
        while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++ }
        continue
      }
      if (c === '/') { inRe = false }
      continue
    }
    if (c === '/' && n === '/') { inLineComment = true; i++; continue }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue }
    if (c === '"' || c === "'" || c === '`') { inS = c; prev = c; continue }
    if (c === '/') {
      // 正则只能在「期待一个值」的位置起头：前一个有效字符不是标识符/右括号/右方括号
      if (!/[A-Za-z0-9_$)\]}]/.test(prev)) { inRe = true; prev = '/'; continue }
      prev = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    if (!/\s/.test(c)) prev = c
  }
  return src.slice(start, i + 1)
}

const clientSrc = fs.readFileSync(CLIENT, 'utf8')
console.log(`源码: ${CLIENT}`)
console.log(`      ${clientSrc.length} 字符 / ${clientSrc.split('\n').length} 行`)
console.log(`      含 wrapLoneDocuments（新实现标志）: ${clientSrc.includes('function wrapLoneDocuments(')}\n`)

// 只抽本门禁真正依赖的符号。
//
// ★ 不抽 cardHtmlIframe 的**实现** —— 它属于另一条工作流（ST 平价尺寸），正在被并发
//   编辑（已经从 `rewriteVhMinHeight` 改成 `withCardReset(rewriteVhMinHeight(...))`，
//   还在加主题变量）。把它的实现抽进来，门禁就变成了「测别人正在改的代码」：
//   报错位置看起来像围栏坏了，其实是被测对象在动。本项目已多次栽在「测的不是被测对象」上。
//
//   本门禁要验的是**围栏识别**（renderFencedHtml / findClosingFence），所以用一个
//   **桩**替换 cardHtmlIframe：只要能观察到「有没有产出 iframe 元素、文档有没有被塞进去」
//   就够了，它的内部实现与本门禁的判据无关。
const deps = ['scriptRangesOf', 'rangesContain', 'findClosingFence', 'renderFencedHtml', 'wrapLoneDocuments']
let code = ''
const missing = []
for (const d of deps) {
  try { code += extractFn(clientSrc, d) + '\n' } catch { missing.push(d) }
}
for (const c of ['MUV_FRAME_H_MIN', 'MUV_FRAME_H_MAX', 'MUV_CARD_SANDBOX']) {
  const m = new RegExp('var\\s+' + c + '\\s*=\\s*([^\\n]+)').exec(clientSrc)
  if (m) code += `var ${c} = ${m[1].replace(/;$/, '')};\n`
  else missing.push('const:' + c)
}
console.log('未抽到的符号（旧源码属正常）: ' + (missing.join(', ') || '(无)'))

const win = { innerHeight: 1080, addEventListener() {} }
const doc = { querySelectorAll: () => [] }
// cardHtmlIframe 桩：只记录「哪段文档被要求进 iframe」，不实现它的内部逻辑。
// 判据只需要知道「有没有 iframe」和「文档有没有进去」。
const factory = new Function('window', 'document', 'escHtml', 'console', `
  var __frames = [];
  function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function cardHtmlIframe(html) {
    __frames.push(String(html == null ? '' : html));
    return '<iframe class="muv-iframe" sandbox="allow-scripts" srcdoc="' + escAttr(String(html == null ? '' : html)) + '"></iframe>';
  }
` + code + `
  return { renderFencedHtml: typeof renderFencedHtml==='function'?renderFencedHtml:null,
           findClosingFence: typeof findClosingFence==='function'?findClosingFence:null,
           frames: function(){ return __frames; } };`)
const api = factory(win, doc, s => String(s == null ? '' : s), console)
if (!api.renderFencedHtml) { console.log('\n*** 抽不出 renderFencedHtml，门禁无效 ***'); process.exit(2) }
console.log('已抽出 renderFencedHtml（cardHtmlIframe 用桩替代，避免测到别人的在改代码）\n')

function readPngChara(file) {
  const buf = fs.readFileSync(file); let off = 8; const texts = {}
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'tEXt') { const z = data.indexOf(0); texts[data.toString('latin1', 0, z)] = data.subarray(z + 1).toString('latin1') }
    if (type === 'IEND') break
    off += 12 + len
  }
  return texts
}
const { applyAllRegexScripts, regexScriptsOf } = await import(pathToFileURL(ENGINE).href)
const card = JSON.parse(Buffer.from(readPngChara(path.join(CARD_DIR, '_足控天堂2.png')).chara, 'base64').toString('utf8'))
const scripts = regexScriptsOf(card)
check('取数链路有效：卡脚本数 > 0（传 card.data 会静默返回 []）', scripts.length > 0, `scripts=${scripts.length}`)

let src = null
for (const f of fs.readdirSync(SESS).filter(x => x.endsWith('.json'))) {
  const txt = fs.readFileSync(path.join(SESS, f), 'utf8')
  if (!txt.includes('进行包裹')) continue
  let j; try { j = JSON.parse(txt) } catch { continue }
  const seen = new Set()
  const walk = x => {
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) return x.forEach(walk)
    for (const k of Object.keys(x)) {
      const v = x[k]
      if (typeof v === 'string' && v.length > 400 && /<(?:maintext|content|TXT|正文|response|Status_block)/i.test(v) && !seen.has(v)) { seen.add(v); if (!src || v.length > src.text.length) src = { file: f, text: v } }
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(j)
}
check('找到触发劫持的真实模型正文', !!src, src ? '' : '存档里没有含「进行包裹」的正文')

// ★ 样本必须真的是「会被渲染进消息的正文」。
//   存档里最长的那个串其实是**会话的 system prompt**（里面内嵌了角色卡自述，含
//   「正文标题必须输出`### 正文`,正文使用````html」这种**卡自己的格式说明**）。
//   拿它当样本会让门禁去验一段永远不会进聊天 DOM 的文本 —— 判据看似严格，实则
//   测错了对象（本项目反复栽在「测的不是被测对象」上）。这里显式检出并排除。
if (src && /^#\s*角色卡/.test(src.text.trim())) {
  console.log('  [warn] 最长的候选是 system prompt（以「# 角色卡」开头）—— 换用真正的助手正文')
  src = null
}
if (!src) {
  // 回退：找一条**没有** system prompt 痕迹、但仍触发劫持的正文
  for (const f of fs.readdirSync(SESS).filter(x => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(SESS, f), 'utf8')) } catch { continue }
    const seen = new Set()
    const walk = x => {
      if (!x || typeof x !== 'object') return
      if (Array.isArray(x)) return x.forEach(walk)
      for (const k of Object.keys(x)) {
        const v = x[k]
        if (typeof v === 'string' && v.length > 3000 && /進行包裹|进行包裹/.test(v) && !/^#\s*角色卡/.test(v.trim()) && !seen.has(v)) { seen.add(v); if (!src || v.length > src.text.length) src = { file: f, text: v } }
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(j)
  }
}

// ★ 样本从哪来 —— 一条必须说清楚的实测结论：
//
// DSH 的会话存档（`session_projcache/sessions/*.json`）**不含助手正文**。已实测：
// 里面长度 ≥3000 且带卡文档特征（`进行包裹` / `processDialogue` / `HEAVEN` …）的字符串
// 字段**全部落在 `record.rows.titleInput.val.first.text`**，也就是「本会话的任务提示词」，
// 不是任何一条聊天消息。挑得出「含劫持诱饵」的长字符串，但**它永远不会进聊天 DOM** ——
// 拿它当样本，门禁验的是空气（本项目反复栽在「测的不是被测对象」上）。
//
// 所以这里**诚实降级**：用「真卡真实 `replaceString` + 同形状的劫持诱饵」合成一条消息。
// 合成的只是**消息外壳**；文档本体、正则替换、被测函数全部是真的。
// 若将来存档里真的出现了助手正文，`src` 有值，就自动回到真实样本那一条路。
const SAMPLE_FROM_ARCHIVE = !!src
if (!src) {
  const beauty = scripts.find(s => String(s.scriptName || '').includes('正文美化'))
    || scripts.find(s => String(s.replaceString || '').includes('<!DOCTYPE'))
  check('降级样本可用：能从真卡取到一份带围栏的整页文档', !!beauty && /<!DOCTYPE/i.test(String(beauty.replaceString || '')),
    beauty ? String(beauty.scriptName) : '没取到')
  if (beauty) {
    // 形状对齐真机：正文 + 说明文字里的四反引号（劫持诱饵） + 完整整页文档
    const fenced = String(beauty.replaceString || '')
    const body = fenced.replace(/^[ \t]{0,3}`{3,}[^\n]*\r?\n/, '').replace(/\r?\n[ \t]{0,3}`{3,}[ \t]*$/, '')
    src = {
      file: '(合成：真卡 ' + String(beauty.scriptName) + ' 的 replaceString + 真机形状的劫持诱饵)',
      text: '\u5979\u62ac\u8d77\u811a\u3002\n\n````\u8fdb\u884c\u5305\u88f9\n\n' + body + '\n',
    }
  }
}
check('样本可用于复现劫持（真实存档样本，或已诚实标注的降级样本）', !!src,
  SAMPLE_FROM_ARCHIVE ? '存档样本' : '降级样本（存档里没有助手正文，已实测）')

if (src) {
  const prod = applyAllRegexScripts(src.text, scripts).text
  console.log(`\n真实替换产物: ${prod.length} 字符（来源 ${src.file}）`)

  const docCount = (prod.match(/<!DOCTYPE/gi) || []).length
  check('前置断言：产物里存在整页文档（否则本门禁测的是空气）', docCount > 0, `<!DOCTYPE x${docCount}`)
  check('前置断言：产物里存在「行首反引号 + 中文信息串」的劫持诱饵',
    /^[ \t]{0,3}`{3,}\S*[\u4e00-\u9fa5][^\n]*$/m.test(prod))

  const out = api.renderFencedHtml(prod)

  const leaked = /<!DOCTYPE\s+html/i.test(out)
  check('① 卡片文档没有被劫持成裸文本（输出里不含裸 <!DOCTYPE）', !leaked,
    leaked ? `仍泄漏 @${out.search(/<!DOCTYPE\s+html/i)}` : '')

  const frames = (out.match(/class="muv-iframe"/g) || []).length
  check('② 卡片文档确实进了 iframe（>=1 个 muv-iframe）', frames >= 1, `frames=${frames}`)

  const srcs = [...out.matchAll(/srcdoc="([\s\S]*?)"\s+sandbox=/g)].map(m => m[1])
  // ★ 双向 canary 必须两边都钉：只看「宿主里没有裸 <!DOCTYPE」会在**什么都没渲染**时
  //   也通过（假绿）。这里用门禁自己的 `__frames` 记录当第二边 —— 它记的是**真正被交给
  //   cardHtmlIframe 的文档原文**，比从产物里反解 `srcdoc` 属性更直接，也不受桩的
  //   属性顺序影响（早先那版用 `srcdoc="…"\s+sandbox=` 去匹配，桩换了属性顺序就报 0 段，
  //   报出来像产品坏了，其实是判据写死了无关的顺序）。
  const handed = api.frames()
  check('③ 双向 canary：确有整页文档被交给 iframe（防空渲染假绿）',
    handed.length >= 1 && handed.some(b => /<!DOCTYPE|<html/i.test(b)),
    `交给 iframe 的文档 ${handed.length} 份，最大 ${handed.length ? Math.max(...handed.map(x => x.length)) : 0} 字符`
    + `；srcdoc 反解段数=${srcs.length}（桩属性顺序变了会是 0，仅作参考）`)

  check('④ 文档后的说明文字仍然保留（防止删多了）', out.includes('进行包裹'))

  // ⑤ 宿主里不该残留裸的卡样式（内联泄漏的直接判据）
  const inlineStyle = /<style[\s>]/i.test(out)
  check('⑤ 输出里没有裸 <style>（卡的 CSS 不许内联进宿主 DOM）', !inlineStyle)

  console.log(`\n  产物 ${prod.length} -> 输出 ${out.length} 字符，iframe x${frames}`)
}

console.log('\n合法用法回归（防「修好劫持但打死正常代码块」）:')
const cases = [
  ['```html 围栏 + 整页文档', '前置说明\n\n```html\n<!DOCTYPE html>\n<html><body>hi</body></html>\n```\n\n后置说明', true],
  ['```js 普通代码块', '看代码：\n\n```js\nconst a = 1\nconsole.log(a)\n```\n结束', false],
  ['````html 四反引号（内部有 ```）', '````html\n<!DOCTYPE html>\n<html><body><pre>```</pre></body></html>\n````', true],
  ['未闭合围栏（流式一半）', '```html\n<!DOCTYPE html>\n<html><body>半截', false],
  // ★ CRLF：卡的正则在 Windows 上极易产出 `\r\n`。曾经「信息串必须是合法信息串」的收紧
  //   把 CRLF 一并误杀 —— 开围栏正则的 `([^\n`]*)` 会把 `\r` 吃进信息串（info = "\r"），
  //   而 `\r` 属于 `\s`，于是被判非法 ⇒ CRLF 换行的卡文档**全部退化成裸文本**。
  //   实测：收紧前 `\r\n` 产出 iframe，收紧后变成原样纯文本（test-client-render 的
  //   `CRLF 换行` 用例直接变红）。修法是在入口把 `\r\n` 归一成 `\n`。
  ['CRLF 围栏 + 整页文档', '```\r\n<!DOCTYPE html>\r\n<html><body>hi</body></html>\r\n```', true],
  ['CRLF ```html 围栏 + 整页文档', '```html\r\n<!DOCTYPE html>\r\n<html><body>hi</body></html>\r\n```', true],
  // 无围栏那一支必须先过 `wrapLoneDocuments` 的 400 字符下限（太短的多半是文档里的示例，
  // 不是卡页面），所以这里用一份**够长**的文档 —— 拿 39 字符的迷你文档测只会测到下限，
  // 测不到 CRLF。本卡的真实文档长度在 46KB–210KB（见下面「真卡三份整页文档」）。
  ['CRLF 无围栏整页文档', '\u524d\u7f6e\r\n<!DOCTYPE html>\r\n<html><body>' + 'x'.repeat(600) + '</body></html>\r\n\u540e\u7f6e', true],
]
for (const [name, input, wantFrame] of cases) {
  const o = api.renderFencedHtml(input)
  const gotFrame = /class="muv-iframe"/.test(o)
  check(`   ${name} -> iframe ${wantFrame ? '应出现' : '不应出现'}`, gotFrame === wantFrame, `实际 frame=${gotFrame}`)
}

// ── 真卡的三份整页文档（本卡最真实的形状，568KB 级） ───────────────────────────────
//
// ★ `replaceString` 取正文**必须把首尾两条围栏都剥掉**。早先的实现是「找第一处行首反引号、
//   从它之后切到末尾」，取到的 body **尾部还挂着收尾围栏** ⇒ 进到被测函数就成了「未闭合
//   行首围栏」⇒ 量出「修复无效」。**错的是夹具，不是产品。**
console.log('\n真卡三份整页文档（_足控天堂2，逐条钉死 iframe 且不泄漏裸文本）:')
{
  const fenceBody = (rep) => {
    const lines = String(rep).split('\n')
    const FL = /^[ \t]{0,3}`{3,}[ \t]*[a-zA-Z]*[ \t]*$/
    const fl = []
    for (let i = 0; i < lines.length; i++) if (FL.test(lines[i])) fl.push(i)
    if (fl.length !== 2) return null
    return lines.slice(fl[0] + 1, fl[1]).join('\n')
  }
  const realDocs = []
  for (const s of scripts) {
    const body = fenceBody(String(s.replaceString || ''))
    if (!body || !/^\s*<!doctype|^\s*<html/i.test(body)) continue
    realDocs.push({ name: String(s.scriptName || ''), body })
  }
  check('   前置断言：真卡里抽到 >= 3 份整页文档（防空循环假绿）', realDocs.length >= 3, `docs=${realDocs.length}`)
  for (const d of realDocs) {
    const label = `   ${d.name}（${d.body.length} 字符）`
    // (a) 围栏形态
    const oFenced = api.renderFencedHtml('\u5979\u62ac\u8d77\u811a\u3002\n\n```\n' + d.body + '\n```\n')
    check(label + ' 围栏形态 -> 进 iframe', /class="muv-iframe"/.test(oFenced), `head=${JSON.stringify(oFenced.slice(0, 60))}`)
    check(label + ' 围栏形态 -> 无裸 <style>', !/<style[\s>]/i.test(oFenced))
    // (b) **无围栏**形态：这正是根因（早退守卫 `indexOf('```') === -1` 直接 return）
    const oBare = api.renderFencedHtml('\u5979\u62ac\u8d77\u811a\u3002\n\n' + d.body + '\n')
    check(label + ' 无围栏形态 -> 进 iframe', /class="muv-iframe"/.test(oBare), `head=${JSON.stringify(oBare.slice(0, 60))}`)
    check(label + ' 无围栏形态 -> 无裸 <style>', !/<style[\s>]/i.test(oBare))
    // (c) 劫持形态：说明文字里的四反引号 + 后随无围栏文档
    const oHijack = api.renderFencedHtml('\u5979\u62ac\u8d77\u811a\u3002\n\n````\u8fdb\u884c\u5305\u88f9\n\n' + d.body + '\n')
    check(label + ' 劫持形态 -> 进 iframe', /class="muv-iframe"/.test(oHijack), `head=${JSON.stringify(oHijack.slice(0, 60))}`)
    check(label + ' 劫持形态 -> 无裸 <style>', !/<style[\s>]/i.test(oHijack))
  }
}

console.log(`\n${'='.repeat(62)}\n结果: ${pass} 通过 / ${fail} 失败`)
if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)) }
process.exit(fail ? 1 : 0)
