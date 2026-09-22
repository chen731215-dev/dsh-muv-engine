// lib/client.js 里纯字符串变换函数的回归哨兵。
//
// 为什么要有这个文件：这些函数是「为可测而抽出」的（renderFencedHtml /
// renderMediaTags），但抽出之后一直没有测试 —— 注释里甚至指向了一个不存在的
// 文件名。结果是围栏截断、媒体被吞这类问题只能靠人肉发现。
//
// 做法：从 client.js **源码里逐字提取**函数体再执行，测的是真实代码，
// 不是抄一份副本（副本测试会在源码改动后继续通过，等于没有保护）。
//
// 运行：node test-client-render.mjs

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/**
 * 从源码里提取一个具名函数的完整文本。
 *
 * 三个必须处理的坑（都是踩出来的）：
 *  1. **花括号配平必须区分字符串/正则/注释里的 `{` `}`**：引导脚本就是拼在字符串
 *     里的 JavaScript（`'function m(){try{'`），老实计数器会当场多算两个 `{`，
 *     把函数从中间截断，`new Function` 报一个看不懂的 SyntaxError。
 *  2. **声明必须带缩进**才认（`\n    function name(`）：字符串里那一份没有缩进，
 *     于是不会被误当成顶层声明。裸 `indexOf('function name(')` 会先命中字符串里
 *     那一份，提取出来的"函数"是从字符串中间开始的半截。
 *  3. 提取结果**必须能解析**（`new Function` 不抛）才算数；前面的候选串成但解析不了
 *     就换下一个，而不是把坏片段交给调用方。
 *
 * 不用「从 0 扫一遍看当前位置在不在字符串里」的办法：`/` 是正则还是除号在词法上
 * 不可判定，整文件扫描一定会跑偏（client.js 里有除法），比这个办法更脆。
 */
function extractFunction(src, name) {
  const needles = ['\n    function ' + name + '(', '\n      function ' + name + '(',
    '\n    async function ' + name + '(', '\n      async function ' + name + '(',
    'function ' + name + '(', 'async function ' + name + '(']
  let lastError = null
  for (const needle of needles) {
    let at = src.indexOf(needle)
    while (at !== -1) {
      const start = needle.startsWith('\n') ? at + 1 : at
      const text = sliceBalanced(src, start)
      if (text) {
        try {
          new Function(text)
          return text
        } catch (e) { lastError = e }
      }
      at = src.indexOf(needle, at + 1)
    }
  }
  throw new Error('找不到可解析的函数 ' + name + (lastError ? '（' + lastError.message + '）' : ''))
}

/** 从 `start`（`function` 关键字处）配平到函数体结束；字符串/正则/注释感知。 */
function sliceBalanced(src, start) {
  let i = src.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  let state = 'code'
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue }
      if (c === '/' && n === '*') { state = 'block'; i++; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; continue }
      if (c === '/') { state = 'regex'; continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
    } else if (state === 'regex') {
      if (c === '\\') { i++; continue }
      if (c === '/') state = 'code'
    } else if (state === 'line') {
      if (c === '\n') state = 'code'
    } else if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i++ }
    } else {
      if (c === '\\') { i++; continue }
      if (c === state) state = 'code'
    }
  }
  return null
}

/** 取一个 var 声明的字面量值。 */
function extractVar(src, name) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*([\'"][^\'"]*[\'"])').exec(src)
  if (!m) throw new Error('找不到变量 ' + name)
  return m[1]
}

console.log('=== lib/client.js 渲染函数回归 ===\n')

// ── 从真实源码提取 ──────────────────────────────────────────────────────────
const escAttr = new Function(extractFunction(SRC, 'escAttr') + '; return escAttr')()
const sandboxLiteral = extractVar(SRC, 'MUV_CARD_SANDBOX')
const sandbox = new Function('return ' + sandboxLiteral)()

// renderFencedHtml / renderMediaTags 依赖 escAttr、escHtmlBasic、MUV_CARD_SANDBOX
const escHtmlBasic = new Function(extractFunction(SRC, 'escHtmlBasic') + '; return escHtmlBasic')()

/**
 * 提取一组函数（并按需注入外部依赖）后执行。
 *
 * **自动发现依赖**：目标函数的实现会演进（renderFencedHtml 抽出了
 * findClosingFence，renderMediaTags 抽出了 readStartTag / attrValue）。
 * 写死依赖列表会让测试在源码重构后**报错而不是报失败**，那是噪音不是信号。
 * 所以这里扫函数体里出现的调用名，凡在 client.js 里能找到同名 `function` 的
 * 一并提取，迭代到不动点。
 * @param {string[]} names 入口函数名
 * @param {object} deps 注入到函数作用域的外部依赖（名 → 值）
 * @param {string} ret 要返回的表达式
 */
function buildFrom(names, deps, ret) {
  const have = new Set()
  const lifted = new Map()
  /**
   * 取函数源码；取不到（或取到的片段解析不了）返回 null。
   * 自动发现是**怀疑制**的：它扫函数体里所有 `名字(` 形态，字符串里的代码也算，
   * 所以一定会出现"疑似依赖其实不是顶层函数"（引导脚本里的 `m(` / `s(`）。
   * 怀疑错了就跳过，不能让测试崩掉。
   */
  const lift = (n) => {
    if (lifted.has(n)) return lifted.get(n)
    let text = null
    try { text = extractFunction(SRC, n) } catch (_) { text = null }
    lifted.set(n, text)
    return text
  }
  const queue = [...names]
  let src = ''
  while (queue.length) {
    const n = queue.shift()
    if (have.has(n)) continue
    const body = lift(n)
    if (!body) continue
    have.add(n)
    src += body + '\n'
    // 扫函数体里出现的调用名，看看 client.js 里有没有同名函数
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = m[1]
      if (!have.has(callee) && lift(callee)) queue.push(callee)
    }
  }
  const keys = Object.keys(deps)
  return new Function(...keys, src + '\nreturn ' + ret)(...keys.map((k) => deps[k]))
}

const renderFencedHtml = buildFrom(
  ['renderFencedHtml'],
  { escAttr, escHtmlBasic, MUV_CARD_SANDBOX: sandbox },
  'renderFencedHtml'
)
const renderMediaTags = buildFrom(['renderMediaTags'], { escHtmlBasic }, 'renderMediaTags')

// ── 1. 安全哨兵：沙箱默认值 ────────────────────────────────────────────────
//
// 这条最重要。allow-same-origin 曾被误加进来（理由是错的，详见 HANDOFF 第 9 节），
// 它会让 srcdoc 继承父页来源 —— 卡里的 JS 就能读写 DSH 页面 DOM、带凭据打 /api/*。
// 任何人再想「顺手放开」都会在这里被拦下。
console.log('[1] 安全哨兵：iframe 沙箱默认值')
check('默认是 allow-scripts', sandbox === 'allow-scripts', '实际: ' + JSON.stringify(sandbox))
check('不含 allow-same-origin', !/allow-same-origin/.test(sandbox), sandbox)
check('不含 allow-top-navigation', !/allow-top-navigation/.test(sandbox))
check('不含 allow-popups', !/allow-popups/.test(sandbox))

// ── 2. escAttr 往返 ────────────────────────────────────────────────────────
console.log('\n[2] escAttr 转义（卡 HTML 要塞进 srcdoc 属性）')
function decodeAttr(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}
const escCases = [
  'a & b', '<html><body>x</body></html>', 'title="say &quot;hi&quot;"',
  "class='y'", 'if (a < b && c > d) {}', 'https://x.test/a.png?w=1&h=2',
  '足控天堂 Ⅱ · 🎀', '<script>var s = "```";</script>',
]
for (const s of escCases) {
  const back = decodeAttr(escAttr(s))
  check('往返: ' + JSON.stringify(s.slice(0, 28)), back === s, JSON.stringify(back.slice(0, 40)))
}
const escBig = escAttr('<div class="a" title=\'b\'>x & y</div>')
check('转义后无裸双引号（否则会截断 srcdoc）', !escBig.includes('"'), escBig)
check('转义后无裸尖括号', !/[<>]/.test(escBig), escBig)

// ── 3. renderFencedHtml ────────────────────────────────────────────────────
console.log('\n[3] renderFencedHtml：整页 HTML 走 iframe，普通代码块不动')
const isIframe = (out) => /<iframe[^>]*srcdoc=/.test(out)

const docCases = [
  ['``` 包整页 HTML', '```\n<!DOCTYPE html>\n<html><body>hi</body></html>\n```', true],
  ['```html 包整页 HTML', '```html\n<html><body>x</body></html>\n```', true],
  ['大写 <HTML>', '```\n<HTML><BODY>x</BODY></HTML>\n```', true],
  ['CRLF 换行', '```\r\n<!DOCTYPE html>\r\n<html></html>\r\n```', true],
  ['正文在围栏之外', '前面的话\n```\n<!DOCTYPE html><html></html>\n```\n后面的话', true],
  ['两个文档各转一个', '```\n<!DOCTYPE html><html>1</html>\n```\n\n```\n<!DOCTYPE html><html>2</html>\n```', true],
]
for (const [name, input, wantIframe] of docCases) {
  const out = renderFencedHtml(input)
  check(name + ' -> iframe', isIframe(out) === wantIframe, out.slice(0, 70))
}

const codeCases = [
  ['```js 代码块不动', '```js\nconst a = 1;\n```'],
  ['```python 不动', '```python\nprint(1)\n```'],
  ['```html 普通代码示例不动（围栏体不是整页文档）', '```html\n<div class="demo">hi</div>\n```'],
  ['无语言标记的普通代码块不动', '```\njust text\n```'],
  ['纯正文不动', '他推开门，风灌了进来。'],
  ['未闭合围栏不动', '```\n<!DOCTYPE html><html>'],
]
for (const [name, input] of codeCases) {
  const out = renderFencedHtml(input)
  check(name, out === input, out.slice(0, 70))
}

// ── 4. renderMediaTags ─────────────────────────────────────────────────────
console.log('\n[4] renderMediaTags：带 src 的成真实元素，裸提示词降级占位')
const mediaCases = [
  ['<video src> 保留且补 controls',
    '<video src="a.mp4"></video>', (o) => /<video[^>]*\bcontrols\b/.test(o), true],
  ['<video src> 带 controls 不重复补',
    '<video src="a.mp4" controls></video>', (o) => (o.match(/controls/g) || []).length === 1, true],
  ['<audio src> 成真实元素',
    '<audio src="a.mp3"></audio>', (o) => /<audio[^>]*\bsrc=/.test(o), true],
  ['补 preload="metadata"（不预载整段媒体）',
    '<video src="a.mp4"></video>', (o) => /preload="metadata"/.test(o), true],
  ['裸 <video>文字</video> 降级占位（用专用 class，不与音频共用）',
    '<video>雨声白噪音</video>', (o) => !/<video/.test(o) && /muv-video|muv-audio/.test(o), true],
  ['裸 <audio>文字</audio> 降级占位',
    '<audio>轻快的BGM</audio>', (o) => !/<audio/.test(o) && /muv-audio/.test(o), true],
  ['无媒体的正文不动',
    '他推开门。', (o) => o === '他推开门。', true],
]
for (const [name, input, test, want] of mediaCases) {
  const out = renderMediaTags(input)
  const got = test(out)
  check(name, got === want, out.slice(0, 80))
}

// 已知缺陷：自闭合与属性含 > —— 这两条是**记录现状**，不是断言正确行为。
// 修好后把期望值改过来（或直接把这两条改成正向断言）。
console.log('\n[5] 已知缺陷（记录现状；修好后请改成正向断言）')

/**
 * 取出 srcdoc 属性的值并解码回原始 HTML。
 *
 * 判断「有没有被截断」必须只看**属性值本身**：截断后残留的那半截文档会留在
 * iframe 标签之外，若拿「srcdoc= 之后的全部文本」去找闭合标签，永远能匹配到，
 * 于是永远误判成「完整」—— 这是个会撒谎的测试，必须避免。
 */
{
  const out = renderMediaTags('<video src="a.mp4" />')
  const hasControls = /<video[^>]*\bcontrols\b/.test(out)
  console.log('  NOTE 自闭合 <video src="a.mp4" /> -> ' + (hasControls ? '已补 controls（已修）' : '未补 controls（仍是已知缺陷）'))
}
{
  const out = renderMediaTags('<video data-x="a>b" src="m.mp4"></video>')
  const survived = /<video/.test(out) && /src="m\.mp4"/.test(out)
  console.log('  NOTE 属性含 > -> ' + (survived ? '媒体存活（已修）' : '媒体被吞成占位（仍是已知缺陷）'))
  console.log('       ' + out.slice(0, 140))
}
/**
 * 取出 srcdoc 属性的值并解码回原始 HTML。
 *
 * 判断「有没有被截断」必须只看**属性值本身**：截断后残留的那半截文档留在 iframe
 * 标签之外，若拿「srcdoc= 之后的全部文本」去找闭合标签，永远能匹配到，于是永远
 * 误判成「完整」—— 那是个会撒谎的测试。
 */
function srcdocOf(out) {
  const m = /srcdoc="([^"]*)"/.exec(out)
  if (!m) return null
  return decodeAttr(m[1])
}

{
  const full = '<!DOCTYPE html><html><script>var s = "```";</script></html>'
  const out = renderFencedHtml('```html\n' + full + '\n```')
  const doc = srcdocOf(out)
  const intact = doc !== null && doc.includes('</html>') && doc.includes(full)
  console.log('  NOTE 围栏内含 ``` -> ' + (intact ? '完整承载（已修）' : '被截断（仍是已知缺陷）'))
  console.log('       srcdoc 内文档长度 ' + (doc ? doc.length : 0) + ' / 期望 ' + full.length)
  // 截断时残留的半截文档会以裸文本留在消息里 —— 这是用户能看到的症状
  const leftover = out.replace(/<div class="muv-statusbar-wrap">[\s\S]*?<\/iframe><\/div>/, '')
  if (leftover.trim()) console.log('       残留裸文本: ' + JSON.stringify(leftover.trim().slice(0, 90)))
}
{
  const out = renderFencedHtml('````html\n<!DOCTYPE html><html></html>\n````')
  console.log('  NOTE 四反引号围栏 -> ' + (isIframe(out) ? '已识别（已修）' : '不识别（仍是已知缺陷）'))
}

// ── 6. 上面那三条"已知缺陷"转成**会失败的断言** ──────────────────────────────
//
// [5] 的 NOTE 只是给人看的诊断，永远不会让 CI 变红 —— 一个修好了、下次又被改回去的
// 缺陷会静默复活。下面把同一个行为钉成正向断言（内容有重叠是有意的：NOTE 负责
// 可读性，check 负责把关）。
console.log('\n[6] 已修缺陷的正向断言')

{
  const out = renderMediaTags('<video src="a.mp4" />')
  check('自闭合 <video src/> 补了 controls', /<video[^>]*\bcontrols\b/.test(out), out)
  check('自闭合 <video src/> 补了 preload', /preload="metadata"/.test(out), out)
  check('自闭合 <video src/> 留着 src', /src="a\.mp4"/.test(out), out)
  check('自闭合 <video src/> 不再吐出自闭合斜杠', !out.includes('/>'), out)
  const au = renderMediaTags("<audio src='x.mp3' />")
  check('自闭合 <audio src/> 同样补 controls', /<audio[^>]*\bcontrols\b/.test(au), au)
}

{
  const out = renderMediaTags('<video data-x="a>b" src="m.mp4"></video>')
  check('属性含 > 时 src 仍被认出', /src="m\.mp4"/.test(out), out)
  check('属性含 > 时媒体没被降级成占位', !/muv-audio|muv-video-ph|🎬/.test(out), out)
  check('属性含 > 时另一个属性也留着', out.includes('data-x="a>b"'), out)
  check('属性含 > 时没写出第二个 class 属性', !/class="[^"]*"\s+class=/.test(out), out)
}

// 卡自带 class 必须与 muv-media 合并：写成两个 class 属性时浏览器只认第一个，
// 卡自己的样式（_足控天堂2 的 .cg-char-thumb 等）会整体失效。
{
  const out = renderMediaTags('<video class="cg-thumb" src="x.mp4"></video>')
  check('卡自带 class 与 muv-media 合并', out.includes('class="muv-media cg-thumb"'), out)
}

// 「没有 src」有两种，处理必须不同：
//   ① 一个属性都没有 = 模型随手写的提示词 → 降级成占位；
//   ② 有属性但没 src  = 先占位、稍后由卡的 JS 赋 src（`<video id="carVid">`）→ 一动不动。
//      降级会让卡里的 getElementById('carVid') 找不到元素。
{
  const kept = '<video id="carVid" playsinline preload="metadata"></video>'
  check('无 src 但有属性的媒体元素原样不动', renderMediaTags(kept) === kept, renderMediaTags(kept))
  check('src="" 仍按媒体处理（那是"空 src"不是"没 src"）',
    /<video[^>]*src=""/.test(renderMediaTags('<video id="v" src=""></video>')))
  const bare = '<video>雨声白噪音</video>'
  check('真正的裸提示词仍然降级成占位', /muv-video-ph/.test(renderMediaTags(bare)) && !/<video/.test(renderMediaTags(bare)))
}
// NOTE（有意的取舍，别再为此改行为）：介于两者之间的形态 —— **有属性 + 有文本 +
// 没有 src**（例如 `<audio controls>轻快BGM</audio>`）—— 现在会**原样留住**那个空
// 元素，既不做播放器也不做文字占位，用户会看到一个空的播放器框。
// 取舍理由：判据是"功能损坏重于外观损坏"。一旦把"没有 src"当成提示词去降级，
// `<video id="carVid">` 这类由卡的 JS 后续赋 src 的元素就会被换掉，卡的播放功能
// 直接死掉（真机实测：carVid 存活 旧=丢失 新=保留）；而空播放器框只是不好看。
// 模型输出的裸提示词是"一个属性都没有"的形态，已被覆盖，所以这条中间态不值得为它
// 承担流式/回归风险。
console.log('  NOTE 有属性 + 有文本 + 无 src 的媒体元素原样留住（空播放器框）：' +
  JSON.stringify(renderMediaTags('<audio controls>轻快BGM</audio>')))

// 卡自带页面里的 <script> 也会出现同一批标签，那是**代码**不是标记：// 正则字面量 /<audio>(.*?)<\/audio>/g、注释里的示例、以及拼接出来的标签。
// 改它等于改卡的程序（实测：旧实现会把 AUDIO_RE 字面量换成 <div class="muv-audio">，
// 音频功能静默失效）。见 repro-media-script-corruption.mjs。
{
  const src = '<script>const R = /<audio>(.*?)<\\/audio>/g;</script><audio>提示</audio>'
  const out = renderMediaTags(src)
  check('卡内 <script> 里的 <audio> 原样不动', out.includes('/<audio>(.*?)<\\/audio>/g;'), out)
  check('script 之外的裸 <audio> 仍降级占位', out.includes('🎵 提示'), out)
}

// ── 7. 真实卡（缺卡时 SKIP，不是 FAIL） ─────────────────────────────────────
//
// 合成用例负责精确覆盖分支，真机卡负责证明「现在能用的东西没有被改坏」：
// 三条 56/46/205 KB 的 HTML 正则，以及卡自己 <script> 里的媒体元素。
let findCard = null, readPngCard = null
try {
  ({ findCard } = await import('./../dsh-muv-table/test-cards.mjs'))
  ({ readPngCard } = await import('./../dsh-muv-table/lib/png-card.js'))
} catch (_) { /* SKIP below */ }

const cardFile = findCard ? (findCard('_足控天堂2') || findCard('足控天堂2')) : null
if (!cardFile || !readPngCard) {
  console.log('\n[7] 真实卡 SKIP（找不到 足控天堂2 卡，或 dsh-muv-table 不在同级目录）')
} else {
  console.log('\n[7] 真实卡：足控天堂2')
  const card = readPngCard(cardFile)
  const data = card.data && typeof card.data === 'object' ? card.data : card
  const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []
  const fenced = scripts.filter(s => String(s?.replaceString || '').includes('```'))
  const withMedia = scripts.filter(s => /<(audio|video)/.test(String(s?.replaceString || '')))

  check('三条大 HTML 正则都在', fenced.length === 3, 'fenced=' + fenced.length)
  for (const s of fenced) {
    const rep = String(s.replaceString)
    const out = renderFencedHtml(rep)
    check('「' + s.scriptName + '」→ 恰好 1 个 iframe', (out.match(/muv-iframe/g) || []).length === 1,
      'iframe=' + (out.match(/muv-iframe/g) || []).length)
    check('「' + s.scriptName + '」→ 整个替换串都进了 srcdoc（' + rep.length + ' 字）',
      out.startsWith('<div class="muv-statusbar-wrap"><iframe') && out.endsWith('</iframe></div>'),
      JSON.stringify(out.slice(0, 50)) + ' … ' + JSON.stringify(out.slice(-30)))
    check('「' + s.scriptName + '」→ 没有半截 HTML 以裸文本残留', !/<\/html>|<\/script>|<\/body>/.test(out))
  }

  const scriptBodies = r => [...String(r).matchAll(/<script\b[\s\S]*?<\/script\s*>/gi)].map(m => m[0]).join('\n@@@\n')
  let scriptTouched = 0, placeholders = 0, lost = 0
  for (const s of withMedia) {
    const rep = String(s.replaceString)
    const out = renderMediaTags(rep)
    if (scriptBodies(rep) !== scriptBodies(out)) scriptTouched++
    placeholders += (out.match(/class="muv-(?:audio|video-ph)"/g) || []).length
    if ((out.match(/<(?:audio|video)\b/gi) || []).length !== (rep.match(/<(?:audio|video)\b/gi) || []).length) lost++
    check('「' + s.scriptName + '」→ 没有写出第二个 class 属性', !/class="[^"]*"\s+class=/.test(out))
  }
  check('★ 卡自己的 <script> 一个字节都没被改', scriptTouched === 0, '被改的正则数=' + scriptTouched)
  check('★ 没有真实媒体被降级成占位', placeholders === 0, '占位数=' + placeholders)
  check('★ 媒体元素数量没变（没有元素消失）', lost === 0, '数量变化的正则数=' + lost)

  const main = String((scripts.find(s => s.scriptName === '主页') || {}).replaceString || '')
  if (main) {
    const out = renderMediaTags(main)
    check('★ <video id="carVid">（无 src、由卡的 JS 填）保住了', /<video[^>]*id="carVid"/.test(out))
    // 属性顺序会被重排（controls/preload 统一提到前面），所以先把整个标签抓出来再逐项查。
    const coverTag = /<video[^>]*id="cover-vid"[^>]*>/.exec(out)
    check('有 src 的 <video id="cover-vid"> 仍可播放',
      !!coverTag && /\bsrc="https?:/.test(coverTag[0]) && /\bcontrols\b/.test(coverTag[0]),
      coverTag ? coverTag[0].slice(0, 140) : '找不到该标签')
  }
  const era = String((scripts.find(s => s.scriptName === 'ERA 状态栏') || {}).replaceString || '')
  if (era) {
    const out = renderMediaTags(era)
    check('卡自带 class="cg-…" 的媒体元素保住了自己的 class',
      out.includes('cg-char-thumb') && out.includes('cg-scene-thumb') && out.includes('cg-fs-main-img'))
  }
}

// ── 8. 两条 iframe 路径的沙箱口径 ───────────────────────────────────────────
//
// [1] 钉住了「卡 HTML」的沙箱常量。还有第二条 iframe 路径：代码块的实时预览
// （renderDoc / buildView），它用 allow-same-origin **是必要的** —— 父页要读
// frame.contentDocument 量高度（sizeFrame），不给就永远量不到。
// 它同时**不给 allow-scripts**，所以里面没有任何东西能执行，也就够不到父页。
// 两条路径口径不同是各自需求决定的，不是不一致的疏漏；但谁把 allow-scripts
// 加进预览路径，就等于重开 0.3.6 那个洞，所以这里一起钉住。
console.log('\n[8] iframe 沙箱口径（两条路径）')
check('代码块预览 frame 保留 allow-same-origin（量高度要用）', SRC.includes("sandbox', 'allow-same-origin'"))
check('代码块预览 frame 不给 allow-scripts', !/sandbox', 'allow-same-origin allow-scripts'/.test(SRC)
  && !/sandbox', 'allow-scripts allow-same-origin'/.test(SRC))
check('renderDoc 仍带 CSP 兜底（default-src none）', /default-src\s*\\'none\\'/.test(SRC))
check('卡 HTML 的 iframe 一律走 MUV_CARD_SANDBOX 常量（没有第二处写死的值）',
  !/srcdoc[\s\S]{0,120}?sandbox="allow-scripts"/.test(SRC))

// ── 9. 卡 HTML iframe 的自动撑高（跨源 postMessage） ─────────────────────────
//
// 卡 HTML iframe 的沙箱是 `allow-scripts`（**没有** allow-same-origin，见 [1]），
// 所以父页读不到 `contentDocument.scrollHeight`。写死 600px 会把真卡裁掉
// （实测：ERA 状态栏 894px、主页 1635px）。撑高只能靠子文档自己报了多少。
// 这一节钉住机制本身：注入点、注入物的文本安全性、父页的校验与夹取。
console.log('\n[9] 卡 HTML iframe 自动撑高（postMessage）')

const heightFrames = [{ contentWindow: { n: 'A' }, style: { height: '600px' } },
  { contentWindow: { n: 'B' }, style: { height: '600px' } }]
const frameApi = buildFrom(
  // 显式列出入口：`onMuvFrameHeightMessage` 是被 `addEventListener(…, fn, false)` 引用的
  // （不是 `fn(` 形态），自动发现看不到它，所以这里直接点名。
  ['cardHtmlIframe', 'onMuvFrameHeightMessage', 'withFrameHeightBootstrap', 'muvFrameBootstrap', 'muvFrameHeightLimits'],
  { escAttr, escHtmlBasic, MUV_CARD_SANDBOX: sandbox, document: { querySelectorAll: () => heightFrames } },
  '{cardHtmlIframe, withFrameHeightBootstrap, onMuvFrameHeightMessage, muvFrameBootstrap, muvFrameHeightLimits}')

const boot = frameApi.muvFrameBootstrap()
const lim = frameApi.muvFrameHeightLimits()

// 上限的**意图**是「拦畸形值」，不是「给内容封顶」：ST 本体无上限（ST-IFRAME-SPEC §6），
// 我们留一条只为 `__muvFrameHeight: 1e9` 这种值兜底。判据写成量级区间而不是等号：
// 写死数字会让「上限到底该多大」这件事只能靠改测试来表达（2400 曾经真的裁过卡）。
check('夹取下限 160，上限远高于真卡实测（2083）且仍在防护量级内',
  lim.min === 160 && lim.max >= 6000 && lim.max <= 100000, JSON.stringify(lim))
check('★ 引导脚本不含反引号', !boot.includes('`'), boot.slice(0, 60))
check('★ 引导脚本的源码里没有裸的 </script> 字面量（拼出来才不会截断内联的插件脚本）',
  !extractFunction(SRC, 'muvFrameBootstrap').includes('</script>'))
check('引导脚本确实闭合了 script 标签', boot.startsWith('<script>') && boot.endsWith('</script>'))
check('只发一个数字（postMessage），不发 HTML/不发卡内内容',
  boot.includes('postMessage') && !/innerHTML|outerHTML/.test(boot))
// ★ 度量指标：必须是「内容包围盒」，不能是 documentElement/body 的 scrollHeight。
// 这些卡写着 `html,body{height:100%}`，那两个值都等于**视口高**（= iframe 当前高度），
// 报回去是不动点：实测「正文美化」内容只有 ~251px，起始 600/900/1500 → 报 600/900/1500。
// 真浏览器三档收敛验证见 verify-frame-height.mjs。
check('★ 用内容包围盒度量（getBoundingClientRect 逐个元素取最大下沿）',
  boot.includes('getBoundingClientRect') && boot.includes('getElementsByTagName'))
check('★ 排除 fixed / sticky（否则视口高会被算成内容高）',
  boot.includes('fixed') && boot.includes('sticky'))
check('排除 display:none / visibility:hidden / 零尺寸元素',
  boot.includes('"none"') && boot.includes('"hidden"'))
check('每个元素取 max(rect.height, scrollHeight)（兜住被 overflow 裁掉的子元素）',
  boot.includes('Math.max(r.height,el.scrollHeight'))
check('★ 包围盒量不出来时不报数（body.scrollHeight 视口回声兜底已被 §15.3 禁用）',
  /if\(e>0\)window\.parent\.postMessage/.test(boot) && !boot.includes('document.body.scrollHeight'))
check('.muv-frame 度量不带 documentElement.scrollHeight（那是视口回显）',
  !boot.includes('document.documentElement.scrollHeight'))
check('有 ResizeObserver + 防抖 + 定时兜底',
  boot.includes('ResizeObserver') && /setTimeout\(m,150\)/.test(boot) && /setTimeout\(m,700\)/.test(boot))

// 注入点：只做末尾追加，且只认不在 <script> 里的最后一个 </body>
const docHtml = '<!DOCTYPE html><html><body><p>hi</p></body></html>'
const framed = frameApi.withFrameHeightBootstrap(docHtml)
check('插在 </body> 之前', framed.indexOf('__muvH') < framed.indexOf('</body>'))
check('没有 </body> 时接在末尾', frameApi.withFrameHeightBootstrap('<p>x</p>').endsWith('</script>'))
check('只注入一次', (framed.match(/window\.__muvH=1/g) || []).length === 1)
check('重复注入无害（已注入则原样返回）', frameApi.withFrameHeightBootstrap(framed) === framed)
// 卡自己的 JS 里可能出现 `document.write("</body>")` 这样的字符串；插进去就会切断卡的代码。
// 断言要拿**卡那一份** </script> 比，不能拿全局最后一个 —— 引导脚本自己也有个 </script>。
const bodyInScript = '<html><body><div>ok</div><script>document.write("</body>")</script></body></html>'
const injected = frameApi.withFrameHeightBootstrap(bodyInScript)
const cardScript = '<script>document.write("</body>")</script>'
check('★ 卡自己的 <script> 逐字节不变（含字符串里的 </body>）', injected.includes(cardScript),
  JSON.stringify(injected.slice(0, 120)))
check('★ 引导脚本落在卡内 <script> 之后（没插进它的范围里）',
  injected.indexOf('window.__muvH=1') > injected.indexOf(cardScript) + cardScript.length,
  '注入位置=' + injected.indexOf('window.__muvH=1') + ' 卡脚本结束=' + (injected.indexOf(cardScript) + cardScript.length))
// 极端情形：文档里唯一的 </body> 就在卡内 script 里 → 必须改成末尾追加，否则会切断代码
const onlyInsideScript = '<html><body><script>var s = "</body>";</script></html>'
const injected2 = frameApi.withFrameHeightBootstrap(onlyInsideScript)
check('★ 唯一 </body> 落在 script 里时改为末尾追加', injected2.endsWith('</script>') && injected2.includes('var s = "</body>";'),
  JSON.stringify(injected2.slice(-80)))

// cardHtmlIframe：唯一出口、沙箱常量、srcdoc 转义、默认高度兜底
const built = frameApi.cardHtmlIframe(docHtml)
check('cardHtmlIframe 产出恰好 1 个 iframe', (built.match(/<iframe/g) || []).length === 1, built.slice(0, 80))
check('沙箱走 MUV_CARD_SANDBOX（allow-scripts，无 allow-same-origin）',
  built.includes('sandbox="allow-scripts"') && !built.includes('allow-same-origin'))
check('默认高度是 900px 的兜底（收不到报数时不至于是个矮框；收到报数就被覆盖）', built.includes('height:900px'))
check('默认尺寸没有 max-height / max-width 上限（用户要"和 ST 一样大"）',
  (() => {
    // 只检查 iframe 自身的 style 属性：srcdoc 内的 reset CSS 合法地含
    // `max-width:100%`（§15.1，照 ST 的宿主侧卫生），不该连坐这一断言。
    const m = /<iframe[^>]*style="([^"]*)"/.exec(built)
    return !!m && !/max-(width|height)/.test(m[1])
  })())
check('srcdoc 是转义过的（里面没有裸双引号/尖括号）',
  /srcdoc="[^"]*"/.test(built) && !/srcdoc="[^"]*<[^"]*"/.test(built))
check('srcdoc 里带着引导脚本', built.includes('__muvH'))

// 父页处理器：只认自己的 iframe、夹取、非数字丢弃
const handle = frameApi.onMuvFrameHeightMessage
handle({ data: { __muvFrameHeight: 894 }, source: heightFrames[0].contentWindow })
check('采纳自己 iframe 报的高度（894）', heightFrames[0].style.height === '894px', heightFrames[0].style.height)
check('不动别的 iframe', heightFrames[1].style.height === '600px')
handle({ data: { __muvFrameHeight: 1635 }, source: heightFrames[1].contentWindow })
check('主页的 1635 也照收', heightFrames[1].style.height === '1635px')
const snapshot = heightFrames.map(f => f.style.height).join(',')
handle({ data: { __muvFrameHeight: 9999 }, source: {} })
check('★ 陌生 source 的消息被丢弃', heightFrames.map(f => f.style.height).join(',') === snapshot)
handle({ data: { __muvFrameHeight: 99999 }, source: heightFrames[0].contentWindow })
check('上限夹到 muvFrameHeightLimits().max（畸形卡不能把页面撑坏）',
  heightFrames[0].style.height === lim.max + 'px', heightFrames[0].style.height + ' vs ' + lim.max)
handle({ data: { __muvFrameHeight: 1 }, source: heightFrames[0].contentWindow })
check('下限夹到 160', heightFrames[0].style.height === '160px', heightFrames[0].style.height)
const kept = heightFrames[0].style.height
for (const bad of [undefined, null, {}, { __muvFrameHeight: 'NaN' }, { __muvFrameHeight: -1 }, { __muvFrameHeight: {} }, 42]) {
  handle({ data: bad, source: heightFrames[0].contentWindow })
}
check('★ 非数字/负数/无关负载一律不改高度', heightFrames[0].style.height === kept, heightFrames[0].style.height)
// 差值阈值**只作用在收缩方向**：亚像素/小抖动不该引发连续改高 + 重排，
// 但增长方向的几像素是**真溢出**（孩子侧报的是 body.scrollHeight 精确值），丢了就是永久裁掉。
heightFrames[0].style.height = '900px'
handle({ data: { __muvFrameHeight: 896 }, source: heightFrames[0].contentWindow })
check('★ 收缩方向差值 <8px 时不动高度（防抖动引发连续重排）', heightFrames[0].style.height === '900px', heightFrames[0].style.height)
handle({ data: { __muvFrameHeight: 940 }, source: heightFrames[0].contentWindow })
check('差值 >=8px 时正常改高', heightFrames[0].style.height === '940px', heightFrames[0].style.height)
// ★★ 实测回归：真卡 `_足控天堂2` 的 ERA 状态栏 内容 894 / 帧 889（差 5px，落在死区里）。
//    被吞掉的那 5px 就是**卡底部永久少一条**（reset 是 overflow:hidden!important）。
heightFrames[0].style.height = '889px'
handle({ data: { __muvFrameHeight: 894 }, source: heightFrames[0].contentWindow })
check('★★ 增长 5px 必须生效（溢出的最后几像素不许被死区吃掉）',
  heightFrames[0].style.height === '894px', heightFrames[0].style.height)

// ── 10. 酒馆路径（window._tavernRenderTags）也要把围栏整页文档转成 iframe ──────
//
// `renderFencedHtml` 的调用点原来全在 `beautifyMuv`（DSH 原生路径）。酒馆面板走的是
// `window._tavernRenderTags`（它的唯一调用者是 tavern bundle 的 beautifyContentEl），
// 那条路径**不转**围栏文档 —— 实测 9 条真卡文档里 8 条原样带着 ``` 围栏与裸
// `<!DOCTYPE html>` 进了 `contentEl.innerHTML`。后果不是"不好看"：卡文档里的 <style>
// 是全局生效的，`html,body{height:100%}` 和一堆绝对定位元素会泄漏进整个聊天 DOM。
console.log('\n[10] 酒馆路径：围栏整页文档 → iframe')

// `_tavernRenderTags` 是**赋值式**的（`window._tavernRenderTags = function(text) {`），
// 不是 `function name(` 声明，所以走 marker + 配平。
function extractAssignedFunction(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error('找不到赋值式函数: ' + marker)
  const text = sliceBalanced(src, src.indexOf('function', at))
  if (!text) throw new Error('配平失败: ' + marker)
  return text
}

const tagSource = extractAssignedFunction(SRC, 'window._tavernRenderTags = function')
const tagLifted = new Map()
const tagLift = (n) => {
  if (tagLifted.has(n)) return tagLifted.get(n)
  let text = null
  try { text = extractFunction(SRC, n) } catch (_) { text = null }
  tagLifted.set(n, text)
  return text
}
let tagQueue = []
for (const mm of tagSource.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (tagLift(mm[1])) tagQueue.push(mm[1])
const tagHave = new Set()
// 赋值式函数体是匿名的（`function(text) {…}`），要挂个名字才能当语句执行。
let tagCode = 'var _tavernRenderTags = ' + tagSource + '\n\n'
while (tagQueue.length) {
  const n = tagQueue.shift()
  if (tagHave.has(n)) continue
  const b = tagLift(n)
  if (!b) continue
  tagHave.add(n)
  tagCode += b + '\n\n'
  for (const mm of b.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (!tagHave.has(mm[1]) && tagLift(mm[1])) tagQueue.push(mm[1])
}
const renderTags = new Function('MUV_CARD_SANDBOX', 'document', 'window',
  tagCode + '\nreturn _tavernRenderTags')(sandbox, { querySelectorAll: () => [] }, {})

const fencedMsg = '前言\n\n```html\n<!DOCTYPE html>\n<html><body><p>x</p><script>var s = "```";</script></body></html>\n```\n\n后记'
const tagOut = renderTags(fencedMsg)
check('★ 酒馆路径把围栏整页文档转成了 iframe', (tagOut.match(/muv-iframe/g) || []).length === 1,
  'iframe=' + (tagOut.match(/muv-iframe/g) || []).length)
check('★ srcdoc 是转义的（消息里没有裸 DOCTYPE）', !/<!DOCTYPE html>/i.test(tagOut), tagOut.slice(0, 120))
check('★ 可见文本里没有残留的围栏反引号', !tagOut.replace(/srcdoc="[\s\S]*?"/, '').includes('`'),
  JSON.stringify(tagOut.replace(/srcdoc="[\s\S]*?"/, '[srcdoc]').slice(0, 80)))
check('围栏外的正文保留', tagOut.includes('前言') && tagOut.includes('后记'))
check('iframed 文档的沙箱仍是 allow-scripts（不给 allow-same-origin）',
  tagOut.includes('sandbox="allow-scripts"') && !tagOut.includes('allow-same-origin'))
check('普通 js 代码块仍原样不动', renderTags('```js\nvar a = 1;\n```') === '```js\nvar a = 1;\n```',
  renderTags('```js\nvar a = 1;\n```'))
// ★ 早插 iframe 的意义：卡文档进 srcdoc 之后，后面的标签/媒体正则再也碰不到它内部
check('★ 卡文档内部的 <video> 没有被媒体正则改写（它已经在 srcdoc 里了）', (() => {
  const out = renderTags('```html\n<!DOCTYPE html><html><body><video src="card.mp4"></video></body></html>\n```')
  return out.includes('&lt;video src=&quot;card.mp4&quot;&gt;') || out.includes('&lt;video src="card.mp4"&gt;')
})(), tagOut.slice(0, 100))
// 其它通用标签仍照常工作（证明早插 iframe 没把后面的流程挡掉）
check('围栏之外的 <video src> 仍然补 controls', /<video[^>]*\bcontrols\b/.test(renderTags('<video src="a.mp4"></video>')),
  renderTags('<video src="a.mp4"></video>'))
check('围栏之外的 <插图> 仍然转换', renderTags('<插图>海边</插图>').includes('muv-illustration'))

// ── 11. markdown 不丢：`<choices>` 改走 DOM 层（第一类迁移） ──────────────────
//
// `_decorateOne` 的整条替换（`body.innerHTML = html`）用的输入是 `innerText` ——
// `**`/`##`/``` 早就被 DSH 渲染掉了，写回去就把 markdown 永久抹掉。所以 `<choices>`
// 不能再走那条路：DOM 层新增 muvRenderChoices()，挂在 muvSanitizeNode 上。
// **真浏览器证明在 verify-choices-dom.mjs**（按钮出现 + <strong>/<h2>/<pre><code> 仍在）；
// 这里钉住源码层的形状，防止有人把那条路又接回字符串替换。
console.log('\n[11] <choices> 走 DOM 层（markdown 不丢）')

const choiceParse = buildFrom(['parseChoiceOptions'], {}, 'parseChoiceOptions')
check('换行分隔的选项', choiceParse('A. 甲\nB. 乙\nC. 丙').join('|') === '甲|乙|丙', JSON.stringify(choiceParse('A. 甲\nB. 乙\nC. 丙')))
check('★ 单行塌成空格也能拆（DSH 把整块渲染进同一个 <p> 时的形态）',
  choiceParse('A. 甲 B. 乙 C. 丙').join('|') === '甲|乙|丙', JSON.stringify(choiceParse('A. 甲 B. 乙 C. 丙')))
check('中文顿号 / 括号 / 数字前缀都认',
  choiceParse('A、甲\nb) 乙\n1. 丙\n2）丁').join('|') === '甲|乙|丙|丁',
  JSON.stringify(choiceParse('A、甲\nb) 乙\n1. 丙\n2）丁')))
check('项目符号分隔', choiceParse('• 甲\n• 乙').join('|') === '甲|乙', JSON.stringify(choiceParse('• 甲\n• 乙')))
check('跳过「请选择/选项/行动」这类引导行',
  choiceParse('请选择：\nA. 甲\nB. 乙').join('|') === '甲|乙', JSON.stringify(choiceParse('请选择：\nA. 甲\nB. 乙')))
check('空内容返回空数组', choiceParse('').length === 0 && choiceParse('   ').length === 0)

// 源码形状：两条路径必须共用同一份解析，DOM 实现必须挂进卫生 pass
check('★ replaceChoices 与 muvRenderChoices 共用 parseChoiceOptions（两条路径不会各说各话）', (() => {
  const rc = extractFunction(SRC, 'replaceChoices')
  const rd = extractFunction(SRC, 'muvRenderChoices')
  return rc.includes('parseChoiceOptions(') && rd.includes('parseChoiceOptions(')
})())
check('★ muvRenderChoices 挂在 muvSanitizeNode 上（否则跳过 round-trip 后按钮不会出现）',
  extractFunction(SRC, 'muvSanitizeNode').includes('muvRenderChoices('))
check('★ DOM 定位区分 <br>/块级换行（不用 textContent 直接拼，选项会粘成一个）',
  extractFunction(SRC, 'muvFindChoiceRange').includes('muvTextWithBreaks(')
  && extractFunction(SRC, 'muvTextWithBreaks').includes("'BR'"))
check('选项按钮用 textContent 而不是 innerHTML（模型文本不经过 HTML 解析）', (() => {
  const b = extractFunction(SRC, 'muvBuildChoices')
  return b.includes('createTextNode') && !/\.innerHTML\s*=/.test(b)
})())
check('★ 文本没被改动时 beautifyMuv 原样返回（不再整条替换 ⇒ markdown 保住）', (() => {
  const bm = extractFunction(SRC, 'beautifyMuv')
  return /if \(normalized === text\) return normalized/.test(bm)
})())
console.log('  NOTE 整条替换是否不再发生、markdown 是否存活，由 verify-choices-dom.mjs（真浏览器）')
console.log('       与主代理的 verify-visual.mjs 端到端判据共同盯住。')

// ── 12. markdown 不丢：`『』` 表头 + `<StatusPlaceHolderImpl/>` 走 DOM 段替换（第二类） ──
//
// 两条修法：
//  ① `muvFoldStatusHeader()` 在 DOM 层把跨行表头折成一行 —— 折完
//     `normalizeStatusHeader(innerText) === innerText`，于是 beautifyMuv 那一档
//     原样返回、不触发整条替换（真浏览器证明见 verify-header-fold.mjs）。
//  ② `applyDecoratedHtml()` 以前只认 `<Status_block>`，占位符那一类找不到落点就
//     整条替换 → markdown 全灭（主代理门禁 `B_header` 的基线 strong/h2/pre/li=0/0/0/0）。
//     现在多一条「占位符文本段」的 Range 替换；并且取状态栏片段改用配平扫描，
//     不再依赖「末尾恰好三个 </div>」的正则。
console.log('\n[12] 表头 + 占位符走 DOM 段替换（markdown 不丢）')

const wrapExtract = buildFrom(['extractStatusWrap'], {}, 'extractStatusWrap')
const builtinWrap = '<p>正文</p><div class="muv-statusbar-wrap"><div class="muv-sb"><div class="muv-sb-hd">头</div><div class="muv-sb-body">体</div></div></div><p>后面</p>'
check('取内置卡片的状态栏片段', wrapExtract(builtinWrap) === '<div class="muv-statusbar-wrap"><div class="muv-sb"><div class="muv-sb-hd">头</div><div class="muv-sb-body">体</div></div></div>',
  JSON.stringify(wrapExtract(builtinWrap)))
const iframeWrap = '<div class="muv-statusbar-wrap"><iframe class="muv-iframe" srcdoc="&lt;html&gt;"></iframe></div>'
check('★ 取卡自带整页 HTML 的 iframe 片段（旧的三-div 正则会漏）',
  wrapExtract(iframeWrap) === iframeWrap, JSON.stringify(wrapExtract(iframeWrap)))
const emptyWrap = '<div class="muv-statusbar-wrap"><div class="muv-sb muv-sb-empty">（暂无状态数据）</div></div>'
check('★ 取空状态片段（旧正则会漏）', wrapExtract(emptyWrap) === emptyWrap, JSON.stringify(wrapExtract(emptyWrap)))
check('没有状态栏时返回 null', wrapExtract('<p>只有正文</p>') === null)
check('嵌套 div 不影响配平（后面还有别的 div）',
  wrapExtract(builtinWrap + '<div>x</div>') === wrapExtract(builtinWrap), JSON.stringify(wrapExtract(builtinWrap + '<div>x</div>')))
check('★ 死正则 STATUS_WRAP_RE 已彻底移除',
  !/STATUS_WRAP_RE/.test(SRC), '源码里还有引用')

const applySrc = extractFunction(SRC, 'applyDecoratedHtml')
check('★ 占位符也走 Range 段替换（第二类修复点）',
  applySrc.includes('STATUS_PH_TEST') && applySrc.includes('insertHtmlAtRange('), applySrc.slice(0, 120))
check('取片段走配平扫描而不是写死正则', applySrc.includes('extractStatusWrap('))
check('找不到落点才整条替换（最后手段保留）', /body\.innerHTML = html/.test(applySrc))
check('★ 表头折叠挂在 muvSanitizeNode 上', extractFunction(SRC, 'muvSanitizeNode').includes('muvFoldStatusHeader('))
check('★ 表头折叠复用 normalizeStatusHeader（两条路径不各说各话）',
  extractFunction(SRC, 'muvFoldStatusHeader').includes('normalizeStatusHeader('))
check('表头折叠有收敛上限（不会死循环）', /guard < \d+/.test(extractFunction(SRC, 'muvFoldStatusHeader')))
// ★ 每一步各自 try：挤在同一个 try 里时，前一步抛异常会把后面几类的渲染一起带走
// （实测：探针少注入一个依赖 → 表头折叠抛 ReferenceError → 选项按钮 4 项断言同时红）。
check('★ 卫生 pass 每类标记各自 try（一类失败不牵连其它类）', (() => {
  const body = extractFunction(SRC, 'muvSanitizeNode')
  const steps = ['muvCleanText(', 'muvFoldStatusHeader(', 'muvRenderOpts(', 'muvRenderChoices(']
  return steps.every(s => new RegExp('try \\{[^}]*' + s.replace('(', '\\(')).test(body))
})())
console.log('  NOTE B_header 的端到端判据（markdown 存活 + statusBars>=1）由主代理的')
console.log('       verify-decorate-dom.mjs 门禁盯住；本节只钉源码形状与片段提取。')

// ── 13. 原生路径的媒体标签（④）：DOM 段替换 + 属性白名单 ──────────────────────
//
// `renderMediaTags` 只在酒馆路径上跑（唯一调用者 `_tavernRenderTags`），原生路径对
// `<video src>` 完全不可达 —— 模型自己写的媒体标签既不会变成播放器，也没有 controls。
// 补法是把它做成**DOM 层**的一步（`muvRenderMediaTags`）：只换那一段标签文本。
// 为什么不复用字符串那条路：媒体产物里没有状态栏片段 ⇒ `applyDecoratedHtml` 会落到
// 最后手段 `body.innerHTML = html`，把整条消息的 markdown 抹平
// （实测见 repro-native-media-path.mjs 的「修法岔路」一节）。
console.log('\n[13] 原生路径媒体标签（DOM）')

const mediaAttrs = /var MUV_MEDIA_ATTRS = \{[\s\S]*?\}/.exec(SRC)
check('存在媒体属性白名单', !!mediaAttrs)
check('★ 白名单里没有 on* 事件属性（否则等于把脚本请进 DSH 页面）',
  !!mediaAttrs && !/\bon[a-z]+\s*:/.test(mediaAttrs[0]), mediaAttrs && mediaAttrs[0].slice(0, 80))
check('白名单含 src / controls / preload / poster',
  !!mediaAttrs && ['src', 'controls', 'preload', 'poster'].every(k => new RegExp('\\b' + k + ':').test(mediaAttrs[0])))
const cloneSrc = extractFunction(SRC, 'muvCloneMediaElement')
check('★ 拷贝时显式丢掉 on* 属性', /name\.indexOf\('on'\) === 0/.test(cloneSrc), cloneSrc.slice(0, 120))
check('只拷白名单里的属性', cloneSrc.includes('MUV_MEDIA_ATTRS[name]'))
const buildSrc = extractFunction(SRC, 'muvBuildMediaElement')
check('★ 用 DOMParser 解析离线段（不是往活动文档塞 innerHTML）', buildSrc.includes('DOMParser'))
check('★ 不用 innerHTML', !/\.innerHTML\s*=/.test(buildSrc))
check('补 controls / preload', /setAttribute\('controls'/.test(buildSrc) && /setAttribute\('preload', 'metadata'\)/.test(buildSrc))
check('裸提示词降级成文字占位（与字符串路径同一取舍）',
  buildSrc.includes('muv-video-ph') && buildSrc.includes('muv-audio'))
check('★ 字符串路径与 DOM 路径**共用同一份判定**（mediaTagDisposition）',
  extractFunction(SRC, 'renderMediaTags').includes('mediaTagDisposition(')
  && buildSrc.includes('mediaTagDisposition('), '两条路径各写一份判定会漂移')
check('判定三分支：media / skip / placeholder',
  ['media', 'skip', 'placeholder'].every(k => extractFunction(SRC, 'mediaTagDisposition').includes("'" + k + "'")))
const disposition = (() => {
  const src = extractFunction(SRC, 'mediaTagDisposition')
  return new Function(src + '; return mediaTagDisposition')()
})()
check('有 src 值 → media', disposition(true, true, true, false) === 'media')
check('★ src=""（有属性、值为空）→ 仍算 media（真卡 cgFsVid 就是这种）',
  disposition(true, false, true, false) === 'media')
check('★ 有属性但根本没有 src 属性 → skip（脚本待填的元素，别降级成 div）',
  disposition(false, false, true, false) === 'skip')
check('一个属性都没有的裸提示词 → placeholder',
  disposition(false, false, false, false) === 'placeholder')
check('带 <source> 子节点但没 src → media', disposition(false, false, false, true) === 'media')
check('★ 挂在卫生 pass 上、且是独立的 try（一类失败不牵连其它类）', (() => {
  const body = extractFunction(SRC, 'muvSanitizeNode')
  return /try \{ muvRenderMediaTags\(md\) \}/.test(body)
})())
const mediaRenderSrc = extractFunction(SRC, 'muvRenderMediaTags')
check('跳过 <script>/<style> 里的同名标签（代码不是标记）', mediaRenderSrc.includes("'script, style'"))
check('有收敛上限', /guard < \d+/.test(mediaRenderSrc))
console.log('  NOTE 真浏览器判据（真元素 + controls + onerror 被丢 + markdown 存活）在')
console.log('       verify-media-dom.mjs。')

// ── 14. 第三类：变量块 / 推演块 / 摘要块在原生路径的 DOM 渲染 ──────────────────
//
// 原生路径这些标签一个渲染器都没有（只有酒馆路径的 `_tavernRenderTags` 有），
// 于是 `<UpdateVariable>{…JSON…}</UpdateVariable>` 原样显示给用户。
// 现在收进折叠卡；内容一律 `textContent`（JSON 里的 `<img onerror>` 只会是文本）。
console.log('\n[14] 变量块 / 推演块 / 摘要块（DOM）')

const varBlocksSrc = extractFunction(SRC, 'muvRenderVariableBlocks')
check('★ 认出三种变量块标签（VariableEdit / VariableInsert / UpdateVariable）',
  /\(VariableEdit\|VariableInsert\|UpdateVariable\)/.test(varBlocksSrc), varBlocksSrc.slice(0, 100))
check('★ <VariableThink> 与 <Abstract> 也在这一类里',
  varBlocksSrc.includes('<VariableThink>') && varBlocksSrc.includes('<Abstract>'))
check('复用酒馆路径同样的 class（样式共用）',
  varBlocksSrc.includes("'muv-varedit'") && varBlocksSrc.includes("'muv-varthink'") && varBlocksSrc.includes("'muv-abstract'"))
check('JSON 能解析就美化缩进（与酒馆路径一致）', varBlocksSrc.includes('JSON.stringify(JSON.parse(raw), null, 2)'))
const detailsSrc = extractFunction(SRC, 'muvDetailsBlock')
check('★ 折叠卡正文用 textContent（不解析 HTML）', detailsSrc.includes('textContent') && !/\.innerHTML/.test(detailsSrc))
check('★ 挂在卫生 pass 上、独立 try', extractFunction(SRC, 'muvSanitizeNode').includes('muvRenderVariableBlocks(md)'))
const replaceSrc = extractFunction(SRC, 'muvReplaceTagBlocks')
check('通用块替换：跳过 script/style 里的文本', replaceSrc.includes("'script, style'"))
check('通用块替换：有收敛上限', /guard < limit/.test(replaceSrc))
check('通用块替换：决定不处理时推过这一段继续找（不是 break）',
  /from = hit\.index \+ hit\[0\]\.length; continue/.test(replaceSrc))
console.log('  NOTE 真浏览器判据（折叠卡成型 + JSON 美化 + 不解析 HTML + 无注入 + markdown 存活）')
console.log('       在 verify-varblocks-dom.mjs。')

// ── 15. 第三类之二/之三：展示类标签 + 内部块（表驱动） ────────────────────────
//
// 原生路径这些标签一个渲染器都没有（只有酒馆路径 `_tavernRenderTags` 有）：
// 展示类原样显示成裸标签；而 `<rule_check>` / `<user_setting>` / `<system_prompt>` /
// `<status_current_variable>` 这类**内部块**更是把提示词工程外壳泄漏给用户。
// 两者都放进 `MUV_TAG_RULES` 一张表（一处定义，避免集合漂移）。
console.log('\n[15] 展示类标签 + 内部块（表驱动）')

const rulesDecl2 = /var MUV_TAG_RULES = \[[\s\S]*?\n      \]/.exec(SRC)
check('存在 MUV_TAG_RULES 表', !!rulesDecl2)
const rulesSrc2 = rulesDecl2 ? rulesDecl2[0] : ''
const tagRulesSrc = extractFunction(SRC, 'muvRenderTagRules')
check('★ 表里有「删掉」类规则（内部块）', /remove: true/.test(rulesSrc2))
check('表里有折叠卡（details）规则', /details: '/.test(rulesSrc2))
check('表里有 hr（分隔线）规则', /hr: true/.test(rulesSrc2))
check('★ 钩进卫生 pass 且是独立 try', extractFunction(SRC, 'muvSanitizeNode').includes('muvRenderTagRules(md)'))
check('★ 表驱动：遍历一张表而不是逐条 result.replace', tagRulesSrc.includes('MUV_TAG_RULES.length'))
// 覆盖面：酒馆路径那批标签必须都在表里（少一个 = 原生路径仍会露裸标签）
const COVERED = ['speech', 'dialogue', 'char', 'character', '引用', 'quote', 'location', 'scene',
  'pose', 'posture', 'thought', 'thinking', 'feeling', 'emotion', 'expression', 'inner', 'Drama',
  'story', 'narrative', 'action', 'time', 'weather', 'CG', 'inventory', '背包', 'skill', '技能',
  'JSONPatch', 'sep', 'hr', 'rule_check', 'dungeon_engine', 'user_setting', 'system_prompt',
  'status_current_variable', 'Analysis', 'style']
const missingTags = COVERED.filter(t => !rulesSrc2.includes(t))
check('★ 酒馆路径的展示/内部标签全部被表覆盖（' + COVERED.length + ' 项）',
  missingTags.length === 0, '缺: ' + missingTags.join(', '))
check('★ 简单块用 textContent（不解析 HTML）',
  !/\.innerHTML/.test(extractFunction(SRC, 'muvSimpleBlock')))
check('★ <img> 只带 src/alt + 固定属性（不搬 on*）', (() => {
  const b = extractFunction(SRC, 'muvRenderImages')
  return b.includes("setAttribute('src'") && b.includes("setAttribute('alt'") && !/on[a-z]+\s*=/.test(b)
})())
check('<img> 没有 src 的形态不动它', extractFunction(SRC, 'muvRenderImages').includes('return null'))

// ── 15.1 卡牌专属游戏标签（原生路径，G_gamecard） ────────────────────────────
// 上一版这里还是「有意未覆盖」的 NOTE；现在补齐了：原生路径与酒馆路径同一份
// 标签集合，渲染成 .muv-game-card（data-card 属性 + 标题 + 字段行）。
console.log('\n[15.1] 游戏卡标签（原生路径）')
const gameTagsDecl = /var MUV_GAME_TAGS = \[[\s\S]*?\n      \]/.exec(SRC)
check('存在 MUV_GAME_TAGS 表', !!gameTagsDecl)
const GAME_TAGS = ['赏令接取', '赏令完成', '拍卖购入', '盲盒开启', '道友收录', '飞剑回信', '自由开局']
const missingGame = GAME_TAGS.filter(t => !gameTagsDecl || !gameTagsDecl[0].includes(t))
check('★ 7 个游戏标签全部在表里', missingGame.length === 0, '缺: ' + missingGame.join(', '))
check('★ 钩进 muvRenderTagRules（否则等于没写）',
  extractFunction(SRC, 'muvRenderTagRules').includes('muvRenderGameCards(root)'))
const gameCardSrc = extractFunction(SRC, 'muvRenderGameCards')
check('产出 .muv-game-card + data-card 属性',
  gameCardSrc.includes("muv-game-card") && gameCardSrc.includes("setAttribute('data-card'"))
check('标题与字段全走 textContent（不解析 HTML）',
  gameCardSrc.includes('textContent') && !/\.innerHTML/.test(gameCardSrc))
check('★ 字段行是 .muv-card-field（门禁判据数它）',
  extractFunction(SRC, 'muvFillGameCardFields').includes('muv-card-field'))
check('★ 配色走既有 [data-card=…] CSS，元素不带内联样式',
  !/style=/.test(gameCardSrc) && SRC.includes('[data-card="赏令接取"]'))

// ── 16. 卡 → 宿主交互桥 + 运行时变量回灌（2026-09-22） ──────────────────────
console.log('\n[16] 用户消息桥 + 变量回灌')
const compatSrc = extractFunction(SRC, 'muvCardCompatScript')
check('★ 垫片定义 sendUserMessage（ERA 卡 sendToTavern 的首选路径）',
  compatSrc.includes('def("sendUserMessage"'))
check('★ 垫片有隐藏 #send_textarea 收件箱（主页卡 fillSendTextarea 的自文档路径）',
  compatSrc.includes('send_textarea') && compatSrc.includes('data-muv-inbox'))
check('★ 收件箱按需安装（卡源码不含约定符号就不装）',
  compatSrc.includes('indexOf("send_textarea")===-1') || compatSrc.includes('indexOf("send_textarea")===-1'))
check('★ 转发消息走 __muvUserSend 且限长 20000',
  compatSrc.includes('__muvUserSend:{text:s') && compatSrc.includes('s.length>20000'))
check('★ 宿主处理器认 __muvUserSend 且有每帧节流',
  SRC.includes('__muvUserSend') && SRC.includes('MUV_USERSEND_MIN_GAP'))
const deliverSrc = extractFunction(SRC, 'muvDeliverUserText')
check('★ 落地函数用原生 setter 写输入框（受控组件）',
  deliverSrc.includes('getOwnPropertyDescriptor') && deliverSrc.includes('dispatchEvent(new Event(\'input\''))
const sendFireSrc = extractFunction(SRC, 'muvUserSendFire')
check('★ send 通道矩阵：多通道（按钮 click + 完整 Enter 键盘序列），绝不清空输入框',
  SRC.includes('muvUserSendFire') && deliverSrc.includes('muvUserSendFire') &&
  sendFireSrc.includes('.click()') &&
  sendFireSrc.includes("keyCode: 13") && sendFireSrc.includes("which: 13") && sendFireSrc.includes("code: 'Enter'") &&
  !sendFireSrc.includes('ta.value = \'\'') && !sendFireSrc.includes('.value = \'\''))
check('★ 装饰管线挂了变量回灌（_decorateOne → muvFeedVariables）',
  /muvPushChatLog\(raw\)[\s\S]{0,400}muvFeedVariables\(/.test(SRC))
// ★ 喂的必须是 innerHTML：DSH 把消息渲染成元素时，`<VariableEdit>` 的**标签名不在 innerText 里**
//   （只剩 JSON 文本），拿 innerText 喂等于永远匹配不到标签 ⇒ 变量静默不生效（无异常、无请求）。
check('★★ 回灌喂 innerHTML（不是 innerText），否则标签名可能不在文本里',
  /muvFeedVariables\(body\.innerHTML\)/.test(SRC))
const feedSrc = extractFunction(SRC, 'muvFeedVariables')
check('★ 回灌收两种数据源：initvar/UpdateVariable + ERA 增量块（VariableEdit 等）+ 消息键 era_data',
  feedSrc.includes('<UpdateVariable') && feedSrc.includes('VariableEdit') && feedSrc.includes('era_data'))
check('★ 回灌前做实体解码（`&lt;VariableEdit&gt;` 形态也能命中）',
  feedSrc.includes('&lt;'))
check('★ 先剔掉 VariableThink 再扫块（模型会在思考里"提及"标签名，会错配到真块）',
  feedSrc.length > 0 && extractFunction(SRC, 'muvFeedVariables').length > 0 &&
  /THINK|VariableThink/i.test(SRC))
check('★ 回灌后主动把新状态推给在线卡帧（否则卡停在加载时那一次查询的旧值）',
  SRC.includes('muvEraPushNow') && SRC.includes('muvEraSchedulePush'))
// ★ 必须**多档重推**：卡 iframe 是消息渲染时才创建的，而回灌发生在渲染之前 ——
//   最后一次回灌完成时卡帧还不存在，推一次就落空（实测：服务端状态里有真值、卡上还是初值）。
check('★★ 重推是多档的（立刻 / 1.5s / 4s 三档覆盖晚出生的卡帧）',
  /var delays = \[0, 1500, 4000\]/.test(SRC) && SRC.includes('setTimeout(muvEraPushNow, delays[i])'))
check('推送有可观测日志（控制台能看到"推了几棵树给几帧"，否则症状不可观测）',
  /era push → /.test(SRC))
check('★ 回灌要求能定位会话（否则宁可不灌）',
  feedSrc.includes('currentSessionId()') && !/sessionId:\s*sid \|\| 'default'/.test(feedSrc))
const eraFetchSrc = extractFunction(SRC, 'muvEraFetchVars')
check('★ era 桥双源取数：初始变量(tavern-card) + 运行时(muv-engine/state)',
  eraFetchSrc.includes('/api/muv-table/tavern-card') && eraFetchSrc.includes('/api/muv-engine/state'))
check('★ 运行时状态覆盖初始变量（muvDeepMerge，runtime 在上）',
  eraFetchSrc.includes('muvDeepMerge(base, run)'))

// ── 17. 把"别人的一大段文本"拼进替换串 —— 必须函数式替换 ──────────────────────
//
// 与服务端第 4 轮那个 `$'` bug 是**同一个坑的两端**：`String.replace` 的**字符串替换**里，
// `$&` / `` $` `` / `$'` / `$$` / `$1…$99` / `$<name>` 都是引用语法。
// 而这里拼的是**卡自己的 JS**（210KB 整页文档）——真出过：
//   卡的 ERA 脚本里 `key.charAt(0)===&#39;$&#39;`，`$` 后紧跟 `&` 被当成 `$&`，
//   那行变成 `===&#39;<<StatusPlaceHolderImpl/>#39;}` ⇒ **卡脚本语法错误** ⇒
//   界面照常渲染、功能全废（选项空白 / 数值不动 / tab 点不动）。
console.log('\n[17] 卡 HTML 拼进替换串必须用函数式替换')
{
  const fnSrc = extractFunction(SRC, 'muvFrameBlock')
  check('★ muvFrameBlock 是独立函数（三处拼接都走它）', fnSrc.includes('muv-statusbar-wrap'))
  const block = new Function('return (' + fnSrc + ')')()('PAYLOAD')
  // 造一份带全部危险序列的"卡文档"
  const doc = 'var k=1; f(\'$&\'); g(a)=\'$\'\'; h=`$`x`; i="$1"; j="$<n>";'
  const blockWithDoc = new Function('return (' + fnSrc + ')')()(doc)
  check('muvFrameBlock 原样保留载荷', blockWithDoc.includes(doc), blockWithDoc.slice(0, 80))
  // ★ 行为对照：函数式安全 / 字符串替换**确实**会改写（证明判据能红）
  const viaFn = 'A<PH>B'.replace(/<PH>/, function () { return blockWithDoc })
  check('★★ 函数式替换：含 $& / $\' / $` / $1 的卡 HTML 逐字入文', viaFn.includes(doc),
    JSON.stringify(viaFn.slice(0, 120)))
  const viaStr = 'A<PH>B'.replace(/<PH>/, 'PRE' + blockWithDoc + 'POST')
  check('★★ 对照臂：字符串替换**确实**会改写它（同内容换写法就坏了 —— 判据不是空转）',
    !viaStr.includes(doc), JSON.stringify(viaStr.slice(0, 120)))
  // 源码级：三处调用点都不许退回字符串形态
  const sites = SRC.match(/replace\(STATUS_PH_ALL,\s*function|replace\([\s\S]{0,120}?Status_block[\s\S]{0,200}?function \(\)/g) || []
  check('★ 三处占位符/状态块替换都用了函数式形态', sites.length >= 3, '命中 ' + sites.length + ' 处')
  check('★ 不再存在"字符串替换 + muv-statusbar-wrap 拼接"的写法',
    !/replace\(\s*STATUS_PH_ALL\s*,\s*\n?\s*'<div class="muv-statusbar-wrap">'/.test(SRC) &&
    !/replace\([\s\S]{0,80}Status_block[\s\S]{0,80}?,\s*\n?\s*'<div class="muv-statusbar-wrap">'/.test(SRC))
}

console.log('\n[18] 绝不把自己的产物当成原文再跑一遍（重复装饰）')
{
  // ── 源码级：三条守卫必须都在 _decorateOne 里，且在取文之前 ──────────────
  const one = extractFunction(SRC, '_decorateOne')
  check('★ _decorateOne 有"已有我们的产物就跳过"守卫', one.includes('muvHasOwnArtifacts(body)'))
  check('★ _decorateOne 有"只认消息正文容器"守卫', one.includes('muvMessageBodyOf(body)'))
  check('★ _decorateOne 取文走 muvRawTextOf（不再裸读 body.innerText）',
    one.includes('muvRawTextOf(body)') && !/body\.innerText/.test(one))
  const iArt = one.indexOf('muvHasOwnArtifacts(body)')
  const iBody = one.indexOf('muvMessageBodyOf(body)')
  const iRaw = one.indexOf('muvRawTextOf(body)')
  check('★ 守卫在取文之前（顺序：产物 → 正文 → 取文）',
    iArt >= 0 && iBody > iArt && iRaw > iBody, [iArt, iBody, iRaw].join('/'))

  // ── 行为：把真实现成函数跑一遍（两个闭包变量从源码里取）────────────────
  const selVal = /var MUV_OWN_SEL = '([^']*)'/.exec(SRC)[1]
  const reExpr = /var MSG_BODY_RE = (\/[^\n]*)/.exec(SRC)[1]
  const MSG_BODY_RE = new Function('return ' + reExpr)()
  check('★ 产物选择器按前缀兜（不枚举类名 —— 本项目栽过三次）',
    selVal.includes('[class*="muv-"]'), selVal)
  const hasArt = new Function('MUV_OWN_SEL', 'return (' + extractFunction(SRC, 'muvHasOwnArtifacts') + ')')(selVal)
  const bodyOf = new Function('MSG_BODY_RE', 'return (' + extractFunction(SRC, 'muvMessageBodyOf') + ')')(MSG_BODY_RE)

  // ★ 这条就是线上那个 bug 的形态：正文里已经有我们的产物 ⇒ 必须拒绝
  const decorated = { querySelector: (s) => (String(s).includes('muv-') ? {} : null), matches: () => false }
  check('★★ 已含我们产物（iframe/📖 摘要框/💭 变量推演）的正文 ⇒ 拒绝装饰',
    hasArt(decorated) === true)
  // 对照臂：干净正文必须放行（否则守卫会把整条链掐死，判据变成"永真"）
  const clean = { querySelector: () => null, matches: () => false }
  check('★★ 对照臂：干净正文 ⇒ 放行（守卫不是永真）', hasArt(clean) === false)

  // 面板/侧栏里没有正文容器 ⇒ 必须拒绝（实测 DSH 的 _paneBody_* 曾被吃掉内容）
  const pane = { className: '_paneBody_17p4l_478', querySelectorAll: () => [] }
  check('★★ 面板（_paneBody_*）里没有 _markdown_* ⇒ 拒绝', bodyOf(pane) === null)
  // 正文容器本身 / 恰好包一个正文容器的消息根 ⇒ 放行，且归一到正文容器
  const bodyEl = { className: '_markdown_kcgor_5' }
  check('正文容器本身 ⇒ 直接用它', bodyOf(bodyEl) === bodyEl)
  const inner = { className: '_markdown_ab12_7' }
  const wrapper = { className: 'flowItem', querySelectorAll: () => [inner] }
  check('★ 消息根（恰好包一个正文容器）⇒ 归一到正文容器（不写根节点）',
    bodyOf(wrapper) === inner)
  const twoBodies = { className: 'list', querySelectorAll: () => [inner, { className: '_markdown_cd_1' }] }
  check('包里有两个正文容器 ⇒ 拒绝（那是消息列表，不是一条消息）', bodyOf(twoBodies) === null)

  // ── 取文：隐藏 → 读 → 还原 ────────────────────────────────────────────
  const ops = []
  const junk = { style: { getPropertyValue: () => '', setProperty: (k, v) => ops.push('set:' + k + '=' + v), removeProperty: () => ops.push('rm:display') } }
  const fake = { querySelectorAll: () => [junk], innerText: '正文\n✏️' }
  const rawText = new Function('MUV_OWN_SEL', 'return (' + extractFunction(SRC, 'muvRawTextOf') + ')')(selVal)
  check('取文返回 innerText（不是 textContent —— 保留块级换行）', rawText(fake) === '正文\n✏️')
  check('★ 取文期间把非正文 DOM 藏起来，读完还原',
    ops[0] === 'set:display=none' && ops[ops.length - 1] === 'rm:display', JSON.stringify(ops))
}

console.log('\n[19] 卡 iframe 垫片的音频兜底（CDN 文件名带序号）')
{
  // 取垫片里那段代码（就是若干字符串字面量的拼接）
  const lines = SRC.split('\n')
  const iS = lines.findIndex((l) => l.includes('var __muvAudioTried='))
  let iE = -1
  for (let i = iS; i < lines.length; i++) if (lines[i].includes('addEventListener("error"')) { iE = i; break }
  check('★ 垫片里有音频兜底段', iS >= 0 && iE > iS)
  const shim = new Function('return (' + lines.slice(iS, iE + 1).join('\n').replace(/\s+\+\s*$/, '') + ')')()
  check('  兜底代码可求值且已挂 error 监听', shim.includes('__muvAudioFix') && shim.includes('addEventListener("error"'))
  check('★ 只认 .mp3（别的资源一概不碰）', /\\\.mp3\$\/i/.test(shim), shim.slice(0, 40))
  check('★ 只认 audio（source 会回溯到父节点）', shim.includes('a=a.parentNode') && shim.includes('!=="audio"'))
  check('★★ 名字已带数字结尾就不猜（不许把正解猜坏）',
    shim.includes('!a.__muvAudioBase&&/') && shim.includes('.test(name))return'), shim.slice(0, 60))
  check('★★ 别名记号挂在**元素**上而不是全局名字表（全局表会改坏别的元素上合法的 日常1）',
    shim.includes('a.__muvAudioBase') && !/__muvAudioBase\[/.test(shim))
  check('★★ 重试上限 3（不许无限打 CDN）', shim.includes('if(n>=3)return'))
  check('★ 改写时清掉 <source> 子节点再设 src（只改 source.src 不会重新触发选源）',
    shim.includes('while(a.firstChild)a.removeChild(a.firstChild)') && shim.includes('a.setAttribute("src",cand)'))
}

// ── 20. 卡 iframe 注入 ST 同款前端库（Tailwind/jQuery/jQuery-UI/Vue/Vue-Router/FA）──
//
// 事实（从 ST 的 dist/index.js 里逐字取出的 `v1`）：ST 的 `b1()` **无条件**把六个库
// 塞进每一个卡 iframe ⇒ ST 里的卡 HTML 天然拥有 Tailwind 工具类、`$()`、Vue、
// FontAwesome。写卡的人直接依赖它们 ⇒ 我们一个都不注入时，卡会"布局塌 + 脚本第一行就抛"
// ——界面照常渲染、功能全废，和 §18/§21 那两次 `$'` / `$&` 打坏卡脚本是同一类观感。
console.log('\n[20] 卡 iframe 注入 ST 同款前端库')
{
  // 开关是布尔常量（`var MUV_CARD_LIBS = true`），不是字符串 —— 单独取
  const libsLiteral = (/(?:^|\n)\s*var MUV_CARD_LIBS\s*=\s*(true|false)\s*$/m.exec(SRC) || [])[1]
  check('★ 存在显式开关 MUV_CARD_LIBS', !!libsLiteral, String(libsLiteral))
  check('★ 默认开启（ST 是无条件注入的，关掉会让部分卡显示不全）', libsLiteral === 'true', String(libsLiteral))

  const tagsSrc = extractFunction(SRC, 'muvCardLibTags')
  const tags = buildFrom(['muvCardLibTags'], {}, 'muvCardLibTags')()
  const LIBS = [
    ['FontAwesome', /fontawesome-free@[\d.]+\/css\/all\.min\.css/],
    ['Tailwind', /@tailwindcss\/browser@[\d.]+\/dist\/index\.global\.js/],
    ['jQuery', /jquery@[\d.]+\/dist\/jquery\.min\.js/],
    ['jQuery-UI', /jquery-ui-dist@[\d.]+\/jquery-ui\.min\.js/],
    ['Vue', /vue@[\d.]+\/dist\/vue\.global\.prod\.js/],
    ['Vue-Router', /vue-router@[\d.]+\/dist\/vue-router\.global\.prod\.js/],
  ]
  for (const [name, re] of LIBS) {
    check('注入了 ' + name, re.test(tags), tags.slice(0, 60))
  }
  check('★ 六个 URL 全部走 https 的 jsdelivr（钉版本，不用 latest）',
    (tags.match(/https:\/\/cdn\.jsdelivr\.net\/npm\//g) || []).length === 6 && !/@latest/.test(tags),
    String((tags.match(/https:\/\/cdn\.jsdelivr\.net\/npm\//g) || []).length))
  // 顺序：ST 是「先 CSS 后 JS，jQuery 在 Vue 前」—— Vue-Router 依赖全局 Vue、
  // jQuery-UI 依赖全局 jQuery，顺序错了就是静默少一个库。
  const iFa = tags.indexOf('fontawesome')
  const iJq = tags.indexOf('jquery@')
  const iVue = tags.indexOf('vue@')
  const iVr = tags.indexOf('vue-router@')
  check('★ 顺序：FontAwesome(CSS) 在最前', iFa >= 0 && iFa < iJq, [iFa, iJq].join('/'))
  check('★ 顺序：jQuery 在 Vue 之前', iJq < iVue, [iJq, iVue].join('/'))
  check('★ 顺序：Vue 在 Vue-Router 之前', iVue < iVr, [iVue, iVr].join('/'))
  // 两条硬约束（宿主可能把客户端代码内联进 <script> 标签）
  check('★ 不含裸的 </script>（否则会截断宿主的 script 标签）',
    !/<\/script>/.test(tagsSrc), tagsSrc.slice(0, 60))
  check('★ 不含反引号（与 muvFrameBootstrap 同一约束）', !tagsSrc.includes('`'))
  check('★ 沙箱没被放宽（注入库不是放开 allow-same-origin 的理由）',
    sandbox === 'allow-scripts' && !/allow-same-origin/.test(SRC.split('MUV_CARD_SANDBOX')[0].slice(-200)))

  // ── 行为：把真函数跑一遍 ───────────────────────────────────────────────
  const withCardLibs = buildFrom(['withCardLibs'], { MUV_CARD_LIBS: true }, 'withCardLibs')
  const withCardLibsOff = buildFrom(['withCardLibs'], { MUV_CARD_LIBS: false }, 'withCardLibs')
  const doc = '<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>'
  const out = withCardLibs(doc)
  check('★★ 注入发生在 </head> 之前（body 之前 ⇒ 卡的脚本拿得到这些全局）',
    out.indexOf('data-muv-libs') > -1 && out.indexOf('data-muv-libs') < out.indexOf('</head>') &&
    out.indexOf('data-muv-libs') < out.indexOf('<body'), out.slice(0, 80))
  check('★★ 幂等：同一个文档注入两次 ⇒ 第二次逐字不变', withCardLibs(out) === out)
  check('★★ 开关关闭 ⇒ 逐字不动（一个字符都不加）', withCardLibsOff(doc) === doc)
  // 对照臂：不注入时文档里确实没有这些库 —— 否则上面"注入了 X"是永真
  check('★★ 对照臂：未注入的文档里没有 data-muv-libs（判据不是空转）',
    doc.indexOf('data-muv-libs') === -1)
  // 卡自己的 JS 字符串里写着 </head> ⇒ 落点不许落进那个字符串内部（否则切断卡的脚本）
  const tricky = '<!DOCTYPE html><html><head><script>var s="</head>";</script></head><body>x</body></html>'
  const out2 = withCardLibs(tricky)
  const iTag = out2.indexOf('data-muv-libs')
  check('★★ 卡脚本字符串里的 </head> 不被当成落点（注入点仍在真 head 末尾）',
    iTag > out2.indexOf('</script>'), out2.slice(out2.indexOf('<script'), out2.indexOf('<script') + 90))
  // 没有 head 的文档 / 纯片段：仍然注入（不静默放弃）
  check('没有 </head>/<head> 的文档 ⇒ 退到 <html> 之后', withCardLibs('<html><body>x</body></html>').includes('data-muv-libs'))
  check('纯片段 ⇒ 接在最前面', withCardLibs('<div>x</div>').indexOf('data-muv-libs') < 20)
}

// ── 21. 隐藏与 iframe 重复的整页源码块（ST 的 hidden! 的等价物）─────────────────
//
// ST 给消息里残留的 <pre><code> 加 hidden!。我们靠"整页 HTML 换成 iframe"绕过了大部分
// 情况，但卡正则没产出整页文档时那一大段源码仍然露成裸文本。
// 判据必须**窄**：无差别隐藏所有代码块会把用户正常的 ``` 代码块一起吃掉。
console.log('\n[21] 隐藏与 iframe 重复的整页源码块')
{
  const isPage = buildFrom(['muvIsPageSourceText'], {}, 'muvIsPageSourceText')
  const longDoc = '<!DOCTYPE html>\n<html><head><title>卡</title></head><body>' +
    '<div class="w-full">状态栏</div>'.repeat(20) + '</body></html>'
  check('★ 整页 HTML（doctype + html/head/body）⇒ 认', isPage(longDoc) === true)
  check('★ 没有 doctype 但 head+body 都在 ⇒ 认', isPage('<head><style>a{}</style></head><body>' + 'x'.repeat(300) + '</body>') === true)
  check('★ 含 __muvReset（我们自己注入过的产物）⇒ 认',
    isPage('x'.repeat(300) + '<style data-muv-reset="__muvReset">a{}</style>') === true)
  check('★ 普通 ```js 代码块 ⇒ 不认', isPage('const a = 1;\n'.repeat(30)) === false)
  check('★ 普通 ```html 片段（只有标签，没有 html/head/body 组合）⇒ 不认',
    isPage('<div class="card">' + '<span>字段</span>'.repeat(30) + '</div>') === false)
  check('★ 正文里举例提一句 <!DOCTYPE html>（短文）⇒ 不认',
    isPage('HTML 文档都以 <!DOCTYPE html> 开头，这一点很重要。') === false)

  // ── 行为：真函数 + 假 DOM ──────────────────────────────────────────────
  const mkPre = (text, opts = {}) => {
    const st = []
    return {
      textContent: text,
      getAttribute: () => null,
      setAttribute: (k) => st.push('attr:' + k),
      closest: () => (opts.own ? {} : null),
      style: { setProperty: (k, v, p) => st.push('set:' + k + '=' + v + '@' + p) },
      _ops: st,
    }
  }
  const mkBody = (pres) => ({ querySelectorAll: (sel) => (String(sel).includes('pre') ? pres : []) })
  const hide = buildFrom(['muvHidePageSourceBlocks'], {}, 'muvHidePageSourceBlocks')

  const pagePre = mkPre(longDoc)
  const codePre = mkPre('const a = 1;\n'.repeat(30))
  const ownPre = mkPre(longDoc, { own: true })
  const body = mkBody([pagePre, codePre, ownPre])
  const n = hide(body)
  check('★★ 整页源码块被隐藏（display:none!important）',
    pagePre._ops.some((o) => o === 'set:display=none@important'), JSON.stringify(pagePre._ops))
  check('★ 打上 data-muv-src-hidden 记号（门禁与排障数得到）',
    pagePre._ops.includes('attr:data-muv-src-hidden'), JSON.stringify(pagePre._ops))
  check('★★ 普通代码块**一个字符都不动**（不许无差别隐藏）',
    codePre._ops.length === 0, JSON.stringify(codePre._ops))
  check('★★ 我们自己产物里的 <pre> 不动（不许把刚渲染的折叠卡吞掉）',
    ownPre._ops.length === 0, JSON.stringify(ownPre._ops))
  check('返回值 = 隐藏的块数', n === 1, String(n))
  check('幂等：再跑一次不重复处理（已带记号就跳过）',
    (function () { const p = mkPre(longDoc); p.getAttribute = () => '1'; hide(mkBody([p])); return p._ops.length === 0 })())

  // ★★ 变异对照臂：把判据改成"什么都不认" ⇒ 同一份 DOM 上一块都不会被隐藏。
  //   没有这一条，上面的"整页源码块被隐藏"永远为真（判据空转 = 没证明任何事）。
  const mutantSrc = extractFunction(SRC, 'muvHidePageSourceBlocks')
    .replace(/if \(!muvIsPageSourceText\(t\)\) continue/, 'if (true) continue')
  check('★★ 变异对照臂：判据被摘掉后 ⇒ 一块都不隐藏（证明判据能红）',
    mutantSrc.includes('if (true) continue') &&
    (function () {
      const p = mkPre(longDoc)
      new Function('muvIsPageSourceText', 'return (' + mutantSrc + ')')(isPage)(mkBody([p]))
      return p._ops.length === 0
    })())
}

// ── 22. 守卫的"短文本放行"分支：占位符 greeting（纯文本 first_mes）─────────
//
// 第三次漏（2026-09-22 实锤）：社区卡的 first_mes 常是「【主页】」「星盟契约开场白」
// 这类**纯短文本**占位符，靠卡的 markdownOnly 显示层正则换成 ```html 包裹的整页 HTML
// （ST 首楼因此渲染出完整卡界面）。旧守卫只认 HTML 标签 ⇒ greeting 楼整楼在取卡之前
// 被跳过 ⇒ 首楼没有卡界面。修法：不含标签但去空白后 ≤ 300 字符的文本也放行去取卡。
// 真链路（真 Edge + 真卡 + 真正文的 before/after）在 verify-guard-tag-agnostic.mjs
// 的 B7（G 用例）；这里钉**源码形状 + 判据行为**。
console.log('\n[22] 守卫短文本放行：占位符 greeting')
{
  const bm = extractFunction(SRC, 'beautifyMuv')
  check('★ 守卫块在（标签判据 muvHasTag）', /var muvHasTag = \//.test(bm), bm.slice(0, 120))
  const tm = /muvTrimmedLen > (\d+) && muvTrimmedLen <= (\d+)/.exec(bm)
  check('★ 含短文本放行分支（上界 = 300）', !!tm && Number(tm[2]) === 300 && Number(tm[1]) === 0,
    tm ? tm[0] : '（没找到 muvTrimmedLen 判据）')
  check('★ 守卫行合成两个判据（不许退化成"只看标签"或"全放行"）',
    /if \(!muvHasTag && !muvShortOk\) return text/.test(bm))
  // 行为：从源码里抠出判据字面量与阈值，重建与实现同形状的决策函数。
  // 阈值不写死在这里 —— 从提取结果读，实现改阈值时本测试自动跟随上界断言之外的部分。
  const tagLit = /var muvHasTag = (\/[\s\S]*?\/[a-z]*)\.test\(text\)/.exec(bm)
  const tagRe = tagLit ? new Function('return ' + tagLit[1])() : null
  const decide = (t) => tagRe.test(t) || (() => {
    const n = String(t).trim().length
    return n > Number(tm[1]) && n <= Number(tm[2])
  })()
  check('占位符 greeting「【主页】」放行（能走到取卡）', decide('【主页】') === true)
  check('占位符 greeting「星盟契约开场白」（7 字）放行', decide('星盟契约开场白') === true)
  check('长散文（301 字、无标签）不取卡（防守卫退化成全放行）', decide('深'.repeat(301)) === false)
  check('纯空白不取卡', decide('   \n  ') === false)
  check('含标签的正文照旧由标签判据放行', decide('他推开门。\n<video src="x.mp4"></video>') === true)
  check('阈值上界本身（恰 300 字、无标签）放行', decide('深'.repeat(300)) === true)
  // ★ 对照臂（能红）：把短文本分支摘掉（模拟旧判据）⇒ 占位符 greeting 被拦 ⇒
  //   证明上面的"放行"结论确实由这个分支承担，不是恒真。
  const decideOld = (t) => tagRe.test(t)
  check('★ 对照臂：旧判据（只看标签）对「【主页】」确实不放行（判据不是空转）',
    decideOld('【主页】') === false && decideOld('星盟契约开场白') === false)
}

// ── 23. 卡脚本运行时（TavernHelper / 酒馆助手脚本注入）─────────────────────
//
// ST 里这类脚本由「酒馆助手」插件执行；MVU 的状态栏 HUD、各类运行时浮窗 UI 都是它们
// 画的 —— 真卡实测：`魔法少女MVU测试` 那两条消费 `<StatusPlaceHolderImpl/>` 的正则
// replaceString 是**空串**，HUD 全靠 `data.extensions.tavern_helper.scripts[0]` 那行
// `import '…/MagVarUpdate@master/artifact/bundle.js'` 拉起来。我们不执行 ⇒ bundle 不跑
// ⇒ HUD 恒空（用户实测缺口）。真浏览器那一半断言在 `verify-tavernhelper-scripts.mjs`。
console.log('\n[23] 卡脚本运行时：注入形态与开关')
{
  const literal = (/(?:^|\n)\s*var MUV_CARD_SCRIPTS\s*=\s*(true|false)\s*$/m.exec(SRC) || [])[1]
  check('★ 存在显式开关 MUV_CARD_SCRIPTS', !!literal, String(literal))
  check('★ 默认开启（ST 酒馆助手会执行卡脚本；关掉 = 状态栏/HUD 类功能全失效）',
    literal === 'true', String(literal))

  const tagSrc = extractFunction(SRC, 'muvCardScriptTags')
  // 报错收集器是**另一段**函数（它跟脚本串一起注入，但不参与拼标签）
  const probeSrc = extractFunction(SRC, 'muvCardScriptErrProbe')
  check('★ 注入器与收集器源码都不含反引号（与 muvFrameBootstrap 同一约束）',
    !tagSrc.includes('`') && !probeSrc.includes('`'), tagSrc.slice(0, 60))
  check('★ 注入器与收集器源码都不含裸的 script 收尾标记（否则会截断宿主的 script 标签）',
    !/<\/script>/.test(tagSrc) && !/<\/script>/.test(probeSrc), tagSrc.slice(0, 60))
  check('★ 用 `<script type="module">`（卡里普遍是 ESM；module 天然 defer ⇒ 跑在垫片之后）',
    tagSrc.includes('type="module"'))
  check('★ 每条脚本单独一个标签（一条 import 挂掉不拖垮其他）',
    /out \+= '<script type="module"/.test(tagSrc))
  check('★ 错误留痕：在捕获阶段监听 error（元素上那个不冒泡的加载失败才收得到）',
    probeSrc.includes('addEventListener("error",h,true)'))
  check('★ 留痕也收 unhandledrejection（module 顶层 await 被拒**不走**上面那条 error）',
    probeSrc.includes('unhandledrejection'))
  check('★ 留痕进 `__muvScriptErrs`（除控制台外还能被门禁/排障读出来）',
    probeSrc.includes('__muvScriptErrs'))
  check('★ 留痕上限 20 条（循环报错的卡不许把控制台刷爆）', /n>=20/.test(probeSrc))
  check('★ 内容带脚本收尾标记的条目跳过（内联会截断 srcdoc）', /<\\\/script\/i\.test\(c\)/.test(tagSrc))

  const withCardScriptsOn = buildFrom(['withCardScripts'], { MUV_CARD_SCRIPTS: true }, 'withCardScripts')
  const withCardScriptsOff = buildFrom(['withCardScripts'], { MUV_CARD_SCRIPTS: false }, 'withCardScripts')
  const listAll = [
    { name: '甲·写变量', content: "window.__probeA = 1;" },
    { name: '乙·纯 import', content: "import 'https://example.invalid/x.js';" }
  ]
  const docAll = '<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body><p>hi</p></body>\n</html>'
  const outAll = withCardScriptsOn(docAll, listAll)
  check('★★ 开关关闭 ⇒ 逐字不动（一个字符都不加）', withCardScriptsOff(docAll, listAll) === docAll)
  check('★★ 空清单 ⇒ 逐字不动', withCardScriptsOn(docAll, []) === docAll)
  check('★★ 注入了个 `<script type="module">`，每条一个',
    (outAll.match(/<script type="module"/g) || []).length === 2,
    String((outAll.match(/<script type="module"/g) || []).length))
  check('★★ 顺序 = 卡里数组的顺序（甲在乙之前）',
    outAll.indexOf('__probeA') < outAll.indexOf('example.invalid'))
  check('★★ 幂等：同一个文档注入两次 ⇒ 第二次逐字不变', withCardScriptsOn(outAll, listAll) === outAll)
  check('★ 内容带脚本收尾标记的条目跳过，其余照常注入',
    withCardScriptsOn(docAll, [
      { name: '坏', content: 'var s = "' + String.fromCharCode(60) + '/script>";' },
      { name: '好', content: 'window.__probeOk = 1;' }
    ]).indexOf('__probeOk') > -1)
  // 依赖必须能自动发现到脚本读取口：cardHtmlIframe 被逐字提取执行时会引用它
  // （提取器不认闭包变量，所以那一层写成了 `muvCardScriptsNow()` 这种读取函数）。
  const chain = buildFrom(['cardHtmlIframe'], { MUV_CARD_SCRIPTS: true }, 'cardHtmlIframe')
  check('★★ 提取 cardHtmlIframe 时依赖链能自足（含新增的脚本读取口）',
    typeof chain === 'function', String(typeof chain))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
