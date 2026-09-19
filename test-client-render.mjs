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
  const needles = ['\n    function ' + name + '(', '\n      function ' + name + '(', 'function ' + name + '(']
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

check('夹取范围是 [160, 2400]', lim.min === 160 && lim.max === 2400, JSON.stringify(lim))
check('★ 引导脚本不含反引号', !boot.includes('`'), boot.slice(0, 60))
check('★ 引导脚本的源码里没有裸的 </script> 字面量（拼出来才不会截断内联的插件脚本）',
  !extractFunction(SRC, 'muvFrameBootstrap').includes('</script>'))
check('引导脚本确实闭合了 script 标签', boot.startsWith('<script>') && boot.endsWith('</script>'))
check('只发一个数字（postMessage），不发 HTML/不发卡内内容',
  boot.includes('postMessage') && !/innerHTML|outerHTML/.test(boot))
check('测量用 documentElement/body 的 scrollHeight 取最大',
  boot.includes('scrollHeight') && boot.includes('Math.max'))
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
check('默认高度仍是 600px（收不到报数时的兜底，不比修之前差）', built.includes('height:600px'))
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
check('上限夹到 2400（恶意卡不能把页面撑坏）', heightFrames[0].style.height === '2400px', heightFrames[0].style.height)
handle({ data: { __muvFrameHeight: 1 }, source: heightFrames[0].contentWindow })
check('下限夹到 160', heightFrames[0].style.height === '160px', heightFrames[0].style.height)
const kept = heightFrames[0].style.height
for (const bad of [undefined, null, {}, { __muvFrameHeight: 'NaN' }, { __muvFrameHeight: -1 }, { __muvFrameHeight: {} }, 42]) {
  handle({ data: bad, source: heightFrames[0].contentWindow })
}
check('★ 非数字/负数/无关负载一律不改高度', heightFrames[0].style.height === kept, heightFrames[0].style.height)

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
