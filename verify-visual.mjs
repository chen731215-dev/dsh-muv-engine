// 真浏览器端到端验证台 —— 不需要重启 DSH。
//
// 为什么需要它：单元断言只能证明「字符串变换是对的」，证明不了「用户看到的东西是
// 对的」。DSH 的事件循环里带着 Node 的模块缓存，改完源码必须重启才生效，而重启会
// 杀掉正在跑的会话；于是「改完到底长什么样」长期没人真正看过一眼。
//
// 做法：把 lib/client.js 里**真实源码**逐字提取出来执行（不是抄一份副本），拿**全部
// 5 张真卡**的正则产出当输入，生成最终 HTML，再用 Edge 无头模式截图。产物是图，可以
// 被人眼/视觉模型直接判断 —— 这就补上了「单元测试全绿但页面是空白」的盲区。
//
// 判据说明（踩过的坑，别再退回去）：
//   ✗ 「srcdoc 长度和原文一个数量级」—— 截掉一半仍然是同一数量级，会放过腰斩。
//   ✗ 「全文里能找到文档结尾那句话」—— 旧实现腰斩后，剩余 HTML 会**裸奔在 iframe
//     外面**，全文搜索照样能找到，等于永远通过。
//   ✗ 「遍历卡片但一条都没读到」—— 会输出「0 张、全部通过」。必须断言读到的正则条数。
//   ✓ 把 srcdoc 反转义后，检查围栏正文是否**逐字**是它的子串；再单独判断那段收尾
//     文字落在 iframe 里面（被渲染）还是外面（裸奔）。
//
// 运行：node verify-visual.mjs [旧版client.js路径]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
// 用独立目录：多个代理并行验证时共用 muv-visual 会互相踩（Edge 的 profile 锁会让
// 后启动的进程直接转发给已有实例并立刻退出，结果是「没有报错但也没有截图」）。
const OUT = path.join(os.tmpdir(), 'muv-visual-main')
mkdirSync(OUT, { recursive: true })

const CARD_DIR = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/**
 * `/` 在这里是正则字面量还是除号？（词法上不可判定，只能看前文）
 *
 * 前一个有效字符是标识符字符 / `)` / `]` / 引号 → 除号；否则（`( , = : [ ! & | ? { } ;`
 * 或行首）→ 正则；另外前面是一个**关键字**（`return` / `typeof` / `case`…）时也是正则。
 */
function regexAllowed(src, j, prev) {
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
 * 这个洞 `test-client-render.mjs` 和这个文件**各踩了一次** —— 所以下面的扫描器
 * 才是这个样子，别把它简化回去。
 */
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

/**
 * 提取入口函数及其在源码里能找到的**全部函数依赖**（迭代到不动点），再注入外部依赖
 * 后求值。自动发现是必须的：老版本没有 findClosingFence，写死依赖表会让对照实验在
 * 旧源码上直接抛错，报的是「测试崩了」而不是「行为不同」。
 */
/**
 * 扫出源码里的**模块级常量声明**（`var X = '…'` / `= null` / `= false` / `= {}` …），
 * 返回**声明语句的原文**。
 *
 * 为什么返回原文而不是求值结果：常量可能是多行字符串拼接（MUV_FRAME_BOOTSTRAP 就是），
 * 求值要正确处理换行/ASI/转义，很容易写错。直接把语句原文拼进被执行的代码里，语义
 * 与源码**逐字一致**，不会因为求值方式引入偏差。
 *
 * 只收「RHS 以字面量开头、且不引用浏览器全局」的声明：这样拼进去执行不会抛错。
 */
function moduleVarStatements(src) {
  const out = {}
  const re = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=/gm
  for (const m of src.matchAll(re)) {
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
      // 无分号声明（ASI）：深度 0 处遇到换行，且**表达式已经完整**时收尾。
      //
      // 判据是「最后一个非空白字符不是运算符」，**不是**「遇到空行」——
      // 多行字符串拼接会在中间夹空行，按空行收尾会把语句截成半截表达式，
      // 报出来是 `SyntaxError: Invalid or unexpected token`，而真正的错因是提取器自己
      // （这个坑我踩过一次，排查了很久）。
      else if (c === '\n' && depth === 0) {
        const sofar = src.slice(start, i).replace(/\s+$/, '')
        if (!/[+\-*/%.,([{=:?&|!<>]$/.test(sofar)) break
      }
    }
    const stmt = src.slice(start, i).trim()
    const rhs = stmt.replace(/^\s*var\s+[A-Za-z_$][\w$]*\s*=\s*/, '')
    // RHS 必须是**纯字面量表达式**：剥掉字符串 / 布尔 / null 之后不允许再剩下标识符。
    // 这条把函数内部的 `var text = '共 ' + s.count + ' 个'` 之类挡在外面 —— 那种声明的
    // RHS 引用了局部变量，拼到最前面执行会 ReferenceError（我就被这个坑了一次：
    // 抽出代码里 `text` 到处都是，于是它被当成"被引用但未声明"的模块常量注入了）。
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
    // 只把**带缩进的声明**当成依赖。函数体里的文本也包含源码片段（引导脚本字符串里
    // 就写着 `function m(`），不加这条会把字符串里的名字当成真函数去提取 ——
    // 这正是 `test-client-render.mjs` 踩过的第二个洞，同一套判据。
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[1]
      if (have.has(id)) continue
      if (new RegExp('\\n[ \\t]+function\\s+' + id + '\\s*\\(').test(src)) queue.push(id)
    }
  }
  // 把被引用、但没在抽出代码里声明的模块级常量按原文拼到最前面。
  // 常量之间可能互相引用，所以迭代到不动点。
  const pool = moduleVarStatements(src)
  if (process.env.MUV_DEBUG) {
    console.log('[debug] 候选模块常量: ' + Object.keys(pool).map((k) => `${k}(${pool[k].length}字)`).join(', '))
    const rawNames = [...src.matchAll(/^\s*var\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1])
    console.log('[debug] 源码里所有 var 名: ' + [...new Set(rawNames)].join(', '))
  }
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
  if (process.env.MUV_DEBUG) {
    console.log('[debug] 注入的模块常量: ' + [...need].map((k) => `${k}(${pool[k].length}字)`).join(', '))
    for (const k of need) console.log(`[debug] --- ${k} 尾部: ${JSON.stringify(pool[k].slice(-60))}`)
  }
  const keys = Object.keys(deps)
  let fn
  try {
    fn = new Function(...keys, header + '\n' + out + '\nreturn ' + ret)
  } catch (e) {
    // 把「提取了哪些函数」一起报出来：提取器出错时，裸 SyntaxError 完全指不到问题在哪
    // （前两次都是报在抽取到的中间某一行，看不出是谁的锅）。
    throw new Error(
      `提取出来的代码无法解析（提取器可能截断了某个函数）：${e.message}\n` +
      `  已提取: ${[...have].join(', ')}\n` +
      `  已注入常量: ${[...need].join(', ') || '（无）'}`
    )
  }
  return fn(...keys.map((k) => deps[k]))
}

function sandboxOf(src) {
  const m = /var\s+MUV_CARD_SANDBOX\s*=\s*(['"][^'"]*['"])/.exec(src)
  return m ? new Function('return ' + m[1])() : 'allow-scripts'
}

/** 用某一份源码造一个 renderFencedHtml。 */
function makeRenderer(src) {
  return buildFrom(src, ['renderFencedHtml'], { MUV_CARD_SANDBOX: sandboxOf(src) }, 'renderFencedHtml')
}

/**
 * 把**真实的高度监听运行时代码**逐字取出来，供内联进 fixture 页面。
 *
 * 为什么必须这样：fixture 页面如果只有静态 HTML，就没有客户端运行时 ——
 * `ensureFrameHeightListener` 从未注册，iframe 永远停在 600px。
 * 红队读我生成的 `tavern-inline.html` 时正是这么读的，并把它当成「度量被污染」的证据
 * （结论是错的：那只是缺运行时）。补上真实代码后，fixture 自己就能撑高，
 * 于是「iframe 高度是否脱离 600px」变成一个**浏览器实测**的判据。
 */
function heightRuntimeSource() {
  const names = new Set(['ensureFrameHeightListener', 'onMuvFrameHeightMessage'])
  // 这两个函数可能还依赖别的 Frame 相关小函数（如 muvFrameHeightLimits），一并带上
  for (const m of SRC.matchAll(/\n[ \t]+function\s+(\w*[Ff]rame\w*)\s*\(/g)) names.add(m[1])
  let out = ''
  for (const n of names) {
    try { out += extractFunction(SRC, n) + '\n' } catch (_) { /* 名字对不上就跳过 */ }
  }
  const consts = Object.values(moduleVarStatements(SRC)).join('\n')
  return consts + '\n' + out + '\n' +
    'if (typeof ensureFrameHeightListener === "function") ensureFrameHeightListener();'
}

/** 页面尾部探针：量 iframe 的实际高度，写成一行可 grep 的 VERDICT。 */
const HEIGHT_PROBE = '<script>setTimeout(function(){' +
  'var f=document.querySelector("iframe.muv-iframe");' +
  'var inline=f?f.style.height:"none";' +
  'var real=f?Math.round(f.getBoundingClientRect().height):-1;' +
  'var d=document.createElement("pre");d.id="heightVerdict";' +
  'd.textContent="HEIGHTVERDICT iframeInline="+inline+" iframeReal="+real+" heightAppliedTo="+(f?f.getAttribute("style"):"none");' +
  'd.style.cssText="position:fixed;left:0;bottom:0;z-index:2147483647;background:#000;color:#0f0;font:12px monospace;padding:4px;margin:0";' +
  'document.body.appendChild(d);},2600);<\/script>'

/** 给 fixture 页面注入真实高度运行时 + 探针。 */
function withHeightRuntime(bodyHtml) {
  return bodyHtml + '\n<script>/* 以下为 lib/client.js 逐字提取的真实代码 */<\/script>\n<script>' +
    heightRuntimeSource().replace(/<\/script/gi, '<\\/script') + '<\/script>\n' + HEIGHT_PROBE
}

/** escAttr 的逆运算。顺序必须与 escAttr 相反：&amp; 放最后，否则会把转义结果再解一次。 */
function unescapeAttr(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/**
 * 只按属性值取 srcdoc（转义后里面不含裸 `"`，所以扫到下一个 `"` 就是结尾）。
 * 用扫引号而不是正则，是因为正则会在任意一个 `" ` 处提前收尾。
 */
function srcdocOf(out) {
  const at = out.indexOf(' srcdoc="')
  if (at < 0) return null
  const from = at + ' srcdoc="'.length
  const end = out.indexOf('"', from)
  if (end < 0) return null
  const gt = out.indexOf('>', end)
  return { raw: out.slice(from, end), before: out.slice(0, at), after: gt < 0 ? '' : out.slice(gt + 1) }
}

/**
 * 取出围栏正文。只在正文内部没有裸反引号行时可用（真卡大正则满足：围栏在行首、都是
 * 3 个反引号、正文内部 0 段反引号）。条件不满足返回 null —— 宁可不判定，也不误判。
 */
function fenceBodyOf(text) {
  const lines = String(text).split('\n')
  const fenceLines = []
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]{0,3}`{3,}[ \t]*[a-zA-Z]*[ \t]*$/.test(lines[i])) fenceLines.push(i)
  }
  if (fenceLines.length !== 2) return null
  // 正文 = 开围栏那一行的**行尾之后**，到收围栏那一行的**行首之前** —— 含中间那个换行符。
  // 这必须与 renderFencedHtml 的 `source.slice(open.lastIndex, close.start)` 对齐：
  // 少这一个字符会让「逐字相等」永远差 1（我为这个 off-by-one 白排查了一轮，
  // 而它长得像「产品改写了正文」—— 判据错会伪装成产品缺陷）。
  return lines.slice(fenceLines[0] + 1, fenceLines[1]).join('\n') + '\n'
}

/** 与 renderFencedHtml 内部**同一套**判据：只看正文开头，不看信息串。 */
function looksLikeDoc(body) {
  const head = String(body).replace(/^\s+/, '').slice(0, 40).toLowerCase()
  return head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0
}

/**
 * 文档里**最后一个** `</body>` 是不是落在 `<script>…</script>` 里面？
 *
 * 为什么要查：高度引导脚本是「插在最后一个 `</body>` 之前」。如果卡自己的 JS 字符串里
 * 写着 `document.write('</body>')` 之类，注入点就会落进那个字符串**内部**，把卡的代码
 * 当场切断 —— 和 renderMediaTags 改写卡内正则字面量是同一类事故（那次让整页 JS 报废）。
 */
function lastBodyTagInScript(doc) {
  const ranges = []
  const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
  let m
  while ((m = re.exec(doc))) ranges.push([m.index, m.index + m[0].length])
  let last = -1
  const bre = /<\/body\s*>/gi
  while ((m = bre.exec(doc))) last = m.index
  if (last < 0) return false
  return ranges.some(([a, b]) => last > a && last < b)
}

/**
 * 逐字取出文档里每一段 `<script>…</script>`（含标签），带位置。
 * 「某段脚本有没有被注入」这类判据必须以**段**为单位，不能靠 `indexOf` 子串。
 */
function scriptBlocks(doc) {
  const out = []
  const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
  let m
  while ((m = re.exec(String(doc)))) out.push({ index: m.index, text: m[0] })
  return out
}

/**
 * 剥掉**整条注入链**，只留卡自己的文档。
 *
 * ⚠ 这里踩过两次，两次都是**判据错伪装成产品缺陷**，所以把话说全：
 *
 * ① 剥的**不是一段，是四段**。注入链是
 *    `withFrameHeightBootstrap(withCardLibs(withCardReset(withCardCompat(rewriteVhMinHeight(raw)))))`
 *    —— 内层先跑，三处都有产物：
 *      · `withCardReset` 在第一个 `<head>` 后插 `<meta name="viewport" …>` +
 *        `<style data-muv-reset="__muvReset">…</style>`（≈242 字）
 *      · `withCardCompat` 紧接着插 `<script>__muvKvSeed… + 垫片</script>`（≈4197 字）
 *      · `withCardLibs` 在 `</head>` 之前插 ST 同款前端库（≈691 字）
 *      · `withFrameHeightBootstrap` 在最后一个 `</body>` 前插引导脚本（≈1664 字）
 *    只剥引导脚本，「逐字相等」永远差 ①+② = 4443 字，而且**首处不同恒在 @42** ——
 *    42 正是第一个 `<head>` 的右尖括号之后，也就是 reset 那段 `<meta name="viewport">`
 *    的落点。看到 "@42" 不要往浏览器抖动上想，它在 @42 是**必然**。
 *
 * ② 定位**不能用** `indexOf('__muvH')` 这个子串。垫片里有 `__muvKvSeed` 与
 *    `__muvHello`，两者都**包含** `__muvH`，而垫片位置更靠前（@288 对 @62037）
 *    ⇒ 子串定位会剥掉**垫片那一整段**：剥后反而比正文多 1910 字（4197 减掉本该剥的
 *    1664 再扣掉 reset 的重叠），差值随卡而变，看起来像"产品多塞了东西"。
 *    定位一律用各段**专属 token**：引导脚本 `__muvHFit`、垫片 `__muvKvSeed`、
 *    reset `data-muv-reset="__muvReset"`。
 *
 * 剥干净之后判据反而**更强**：逐字相等 —— 既证明正文没被截断/改写，也证明注入的
 * 恰好就是这四段、没有别的东西被塞进 srcdoc。
 *
 * @returns {{doc:string, segments:Array<[string,number]>}} doc=剥后的文档；segments=各段名与字数
 */
function stripInjected(s) {
  let cur = String(s)
  const segments = []
  const cutScriptWith = (token) => {
    const blk = scriptBlocks(cur).find((b) => b.text.indexOf(token) !== -1)
    if (!blk) return false
    segments.push([token, blk.text.length])
    cur = cur.slice(0, blk.index) + cur.slice(blk.index + blk.text.length)
    return true
  }
  cutScriptWith('__muvHFit')       // 引导脚本：专属 token（先剥，它与末尾的 </body> 贴在一起）
  cutScriptWith('__muvKvSeed')     // 兼容垫片：专属 token
  // 前端库（ST 同款六件套，`withCardLibs` 注入在 `</head>` 之前）：
  // `<link data-muv-libs="fa">` + 5 个 `<script data-muv-libs=…>`，整段连续（≈691 字）。
  // 不剥它，「逐字相等」会恒定差 691 字、首处不同恒在 `</head>` 之前 —— 那个位置是**必然**。
  const li = cur.indexOf('<link data-muv-libs=')
  if (li >= 0) {
    const blks = scriptBlocks(cur).filter((b) => b.text.indexOf('data-muv-libs="vr"') !== -1)
    const blk = blks.length ? blks[blks.length - 1] : null
    if (blk) {
      const end = blk.index + blk.text.length
      segments.push(['libs', end - li])
      cur = cur.slice(0, li) + cur.slice(end)
    }
  }
  const META = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  const st = cur.indexOf('<style data-muv-reset="__muvReset">')
  if (st >= 0) {
    const close = cur.indexOf('</style>', st)
    if (close >= 0) {
      let from = st
      // 紧跟其前的那个 viewport meta 是同一处注入，必须一起剥
      if (cur.slice(Math.max(0, st - META.length), st) === META) from = st - META.length
      segments.push(['reset', close + '</style>'.length - from])
      cur = cur.slice(0, from) + cur.slice(close + '</style>'.length)
    }
  }
  return { doc: cur, segments }
}

/** 引导脚本被注入了**几段**？必须按段数，不能数 `window.__muvH=1`（卡自己也能写）。 */
function bootstrapBlocks(doc) {
  return scriptBlocks(doc).filter((b) => b.text.indexOf('__muvHFit') !== -1)
}

/** 第一处不同的位置，用来在失败时报出「差在哪」而不是只说「不相等」。 */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return n
}

const PAGE = (cap, body, title) => `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
<style>
  html,body{margin:0;padding:0}
  body{background:#16181d;color:#d7dae0;font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif;padding:14px}
  .cap{font-size:12px;color:#8b93a1;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #2b2f38}
  .cap b{color:#9ecbff}
  iframe{border:none;background:#000}
</style></head>
<body>
<div class="cap">${cap}</div>
${body}
</body></html>`

const fixtures = []
function emit(name, cap, body) {
  const file = path.join(OUT, name + '.html')
  writeFileSync(file, PAGE(cap, body, name), 'utf8')
  fixtures.push({ name, file, png: path.join(OUT, name + '.png') })
}

const renderNew = makeRenderer(SRC)

// ── 0. 收集全矩阵：5 张真卡里所有「围栏整页文档」 ─────────────────────────────
console.log('=== 0. 真卡矩阵收集 ===')
const targets = []
let totalScripts = 0
for (const file of readdirSync(CARD_DIR).filter((f) => f.toLowerCase().endsWith('.png'))) {
  let card
  try { card = readPngCard(path.join(CARD_DIR, file)) } catch (e) { console.log(`  ${file}: 读取失败 ${e.message}`); continue }
  const scripts = regexScriptsOf(card)   // ⚠ 必须传 readPngCard 的返回值，不是 card.data
  totalScripts += scripts.length
  let docs = 0
  for (const s of scripts) {
    const rep = String(s?.replaceString || '')
    if (rep.indexOf('```') === -1) continue
    const body = fenceBodyOf(rep)
    if (body === null) continue
    if (!looksLikeDoc(body)) continue
    docs++
    targets.push({ card: file.replace(/\.png$/i, ''), script: String(s.scriptName || '未命名'), rep, body })
  }
  console.log(`  ${file}: 正则 ${scripts.length} 条，围栏整页文档 ${docs} 条`)
}
check('真卡正则确实被读到（防空循环假绿）', totalScripts >= 15, `只读到 ${totalScripts} 条`)
check('矩阵里有多张卡的整页文档（不是只有一张卡在测）',
  new Set(targets.map((t) => t.card)).size >= 2,
  '只覆盖了 ' + [...new Set(targets.map((t) => t.card))].join(','))

// ── 1. 每一条：渲染后必须是恰好 1 个 iframe，正文逐字完整，外面无裸奔 ────────
console.log('\n=== 1. 逐条渲染（围栏正文 → iframe srcdoc） ===')
const biggest = new Map()
for (const t of targets) {
  const out = renderNew(t.rep)
  const sc = srcdocOf(out)
  const frames = (out.match(/<iframe\b/g) || []).length
  const tag = `${t.card} / ${t.script}`
  console.log(`\n  --- ${tag}  替换串=${t.rep.length}字  围栏正文=${t.body.length}字 ---`)
  console.log(`      输出=${out.length}字  iframe=${frames}`)
  check(`${tag}: 恰好 1 个 iframe`, frames === 1, '实际 ' + frames)
  check(`${tag}: iframe 结构闭合`, out.includes('</iframe>'), out.slice(-120))
  if (sc) {
    const rawUn = unescapeAttr(sc.raw)
    const inj = stripInjected(rawUn)
    const un = inj.doc
    check(`${tag}: 剥掉注入链（reset+垫片+前端库+引导脚本）后，正文逐字相等（无截断、无改写）`, un === t.body,
      un === t.body ? '' : `正文=${t.body.length}字 剥后=${un.length}字 差=${un.length - t.body.length} 首处不同@${firstDiff(un, t.body)} 剥掉的段=[${inj.segments.map((x) => x[0] + ':' + x[1]).join(' ')}]`)
    // ★ 判据必须是**引导脚本专属 token**，不能数 `window.__muvH=1`：卡自己也能写那一行
    //   （P0-2 的指标陷阱），数它会**因为错误的原因通过**。这里按「哪一段 `<script>` 含
    //   `__muvHFit`」计段数。对抗用例见 §2b。
    const boots = bootstrapBlocks(rawUn)
    check(`${tag}: 高度引导脚本只注入一次（按专属 token __muvHFit 的**段数**算）`,
      boots.length === 1,
      '含 __muvHFit 的 <script> 段数 = ' + boots.length +
      '（`window.__muvH=1` 出现 ' + (rawUn.match(/window\.__muvH=1/g) || []).length + ' 次）')
    check(`${tag}: iframe 外面无裸奔残渣`, !(sc.before + sc.after).includes('</html>'),
      'iframe 外出现 </html>，文档被腰斩后裸奔')
    check(`${tag}: 最后一个 </body> 不在 <script> 内（高度注入点不会切碎卡的 JS）`,
      !lastBodyTagInScript(t.body), '注入引导脚本会落进卡的 JS 字符串内部 → 卡代码被切断')
  } else {
    check(`${tag}: 有 srcdoc 属性`, false, '输出开头 ' + JSON.stringify(out.slice(0, 140)))
  }
  const prev = biggest.get(t.card)
  if (!prev || t.body.length > prev.body.length) biggest.set(t.card, t)
}
// 每张卡只截最大的那条，控制图片数量
for (const [cardName, t] of biggest) {
  const out = renderNew(t.rep)
  emit('card-' + cardName.replace(/[\\/:*?"<>|\s]+/g, '_'),
    `<b>${cardName}</b> / ${t.script} —— 正则产出 ${t.rep.length} 字 → 渲染 ${out.length} 字`, out)
}

// ── 2. 合成用例：文档正文里带 ``` 的围栏整页 HTML ───────────────────────────
console.log('\n=== 2. 文档内部含 ``` 的围栏（对照实验） ===')
const TAIL = '这段文字在旧实现里会被吞掉'
const SYNTH = '```html\n<!DOCTYPE html>\n<html><body style="background:#101820">\n' +
  '<h1 style="color:#7fd1ff">外层文档标题</h1>\n' +
  '<p>下面是一段代码示例，它自身含三反引号：</p>\n' +
  '<pre><code>```js\nconst a = 1\n```</code></pre>\n' +
  `<p id="tail" style="color:#7cf">${TAIL}</p>\n` +
  '</body></html>\n```\n'

/** 那段收尾文字到底落在 iframe 里面（被渲染）还是外面（裸奔）？ */
function placement(out) {
  const sc = srcdocOf(out)
  const frames = (out.match(/<iframe\b/g) || []).length
  if (!sc) return { frames, inside: false, outside: out.includes(TAIL) }
  return { frames, inside: unescapeAttr(sc.raw).includes(TAIL), outside: (sc.before + sc.after).includes(TAIL) }
}

const outSynthNew = renderNew(SYNTH)
const pNew = placement(outSynthNew)
console.log(`  新实现: iframe=${pNew.frames}  收尾文字在 iframe 内=${pNew.inside}  裸奔在外=${pNew.outside}`)
check('新实现：仍是 1 个 iframe（内部 ``` 没腰斩围栏）', pNew.frames === 1, '实际 ' + pNew.frames)
check('新实现：文档收尾文字在 iframe 内部（真的被渲染）', pNew.inside, '被吞了或跑到外面了')
check('新实现：iframe 外面没有裸奔的原文', !pNew.outside, '原文漏到 iframe 外')
emit('synth-new', '合成用例（文档正文含 ```）→ <b>新实现</b>', outSynthNew)

// ── 2b. 对抗用例：卡文档自带 `window.__muvH=1;`（P0-2 的指标陷阱） ──────────
//
// 为什么必须有这一条：判「引导脚本注入了几次」如果数 `window.__muvH=1`，那么**卡自己写
// 一行同样的文本**就会让计数 ≥1 ⇒ 断言**因为错误的原因通过**。这里把那个陷阱做成显式
// 的对抗用例：卡文档里直接写 `window.__muvH=1;`，断言引导脚本**仍然**被注入（按引导脚本
// 专属 token `__muvHFit` 的**段数**判），而朴素的子串计数**照样会读到 1**。
console.log('\n=== 2b. 对抗用例：卡自己写了 window.__muvH=1; ===')
const ADV = '```html\n<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head>\n<body>\n' +
  '<script>window.__muvH=1;</' + 'script>\n' +
  '<h1 style="color:#7fd1ff">对抗用例</h1>\n' +
  '</body></html>\n```\n'
{
  const advBody = fenceBodyOf(ADV)
  const out = renderNew(ADV)
  const sc = srcdocOf(out)
  const rawUn = sc ? unescapeAttr(sc.raw) : ''
  const boots = bootstrapBlocks(rawUn)
  const nH = (rawUn.match(/window\.__muvH=1/g) || []).length
  const inj = stripInjected(rawUn)
  console.log(`  iframe=${(out.match(/<iframe\b/g) || []).length}  含 __muvHFit 的段数=${boots.length}` +
    `  window.__muvH=1 出现=${nH} 次  剥后=${inj.doc.length}字 正文=${advBody ? advBody.length : '?'}字`)
  check('★ 对抗：卡自带 window.__muvH=1 时，高度引导脚本**仍然**被注入（按 __muvHFit 段数判）',
    boots.length === 1,
    '含 __muvHFit 的 <script> 段数 = ' + boots.length + '（0 = 被卡自己的拷贝顶掉了，引导脚本整段被跳过）')
  check('★ 对抗：朴素的「数 window.__muvH=1」在这里必然 ≥1 ⇒ 那种判据会因错误的原因通过',
    nH >= 1, 'window.__muvH=1 出现 ' + nH + ' 次（卡自己的那一份就在里面）')
  check('对抗：剥掉注入链后，对抗文档的正文也逐字相等',
    !!advBody && inj.doc === advBody,
    '剥后=' + inj.doc.length + ' 正文=' + (advBody ? advBody.length : '?') +
    ' 首处不同@' + (advBody ? firstDiff(inj.doc, advBody) : '-'))
  emit('synth-adversarial', '对抗用例：卡自带 <b>window.__muvH=1;</b>', out)
}

// ── 3. 老/新对照 ────────────────────────────────────────────────────────────
const oldPath = process.argv[2]
if (oldPath && existsSync(oldPath)) {
  console.log('\n=== 3. 老实现对照 ===')
  const renderOld = makeRenderer(readFileSync(oldPath, 'utf8'))
  const outSynthOld = renderOld(SYNTH)
  const pOld = placement(outSynthOld)
  console.log(`  旧实现: iframe=${pOld.frames}  收尾文字在 iframe 内=${pOld.inside}  裸奔在外=${pOld.outside}`)
  check('旧实现在同一输入上确实坏了（这才证明修的是真问题）', !pOld.inside,
    '旧实现居然也对 —— 那这个"修复"没有证据')
  check('旧实现的坏法正是「腰斩 + 残渣裸奔」', pOld.outside, '没有裸奔，坏法和我描述的不一致')
  emit('synth-old', '合成用例（文档正文含 ```）→ <b>旧实现</b>（对照）', outSynthOld)
} else {
  console.log('\n（未提供旧源码，跳过对照；传第二个参数可开启）')
}

// ── 4. iframe 固定 600px 到底够不够高？（实测，不靠猜） ─────────────────────
//
// 卡 HTML 走的是 `<iframe style="height:600px">`。205 KB 的状态栏塞进 600px 会不会
// 被裁掉，是个只有浏览器能回答的问题 —— 字符串断言看不见这个。实测已发现：
//   ERA 状态栏 894px  → 裁 294px
//   主页      1635px  → 裁 1035px（63%，截图里 "Profile." 卡片被从中间切断）
// 做法：把探针脚本拼进**卡文档内部**（不是外面），再走真实的 renderFencedHtml，探针把
// documentElement.scrollHeight 画在文档左上角。探针用 position:fixed，不参与
// scrollHeight，所以测量值不会被它自己污染。
console.log('\n=== 4. iframe 固定 600px 的裁切实测 ===')

const PROBE = '<script>(function(){function report(){' +
  'if(document.getElementById("__muvProbe"))return;' +
  'var de=document.documentElement,b=document.body;' +
  'var h=Math.max(de?de.scrollHeight:0,b?b.scrollHeight:0);' +
  'var d=document.createElement("div");d.id="__muvProbe";' +
  'd.textContent="SCROLLHEIGHT="+h+"px  |  iframe高=600px  |  视口="+window.innerWidth+"x"+window.innerHeight;' +
  'd.style.cssText="position:fixed;left:0;top:0;z-index:2147483647;background:#000;color:#0f0;font:bold 15px monospace;padding:6px 10px;border:2px solid #0f0";' +
  '(b||de).appendChild(d);}' +
  'if(document.readyState==="complete")report();else window.addEventListener("load",report);' +
  'setTimeout(report,1200);})()<\/script>'

let hi = 0
for (const [cardName, t] of biggest) {
  hi++
  const withProbe = /<\/body>/i.test(t.body) ? t.body.replace(/<\/body>/i, PROBE + '</body>') : t.body + PROBE
  const out = renderNew('```html\n' + withProbe + '\n```\n')
  check(`${cardName}/${t.script}: 探针版仍是 1 个 iframe`, (out.match(/<iframe\b/g) || []).length === 1)
  emit('height-' + String(hi).padStart(2, '0') + '-' + cardName.replace(/[\\/:*?"<>|\s]+/g, '_'),
    `高度实测：<b>${cardName}</b> / ${t.script}（左上角绿字 = 文档真实 scrollHeight，iframe 固定 600px）`,
    out)
}
check('高度实测用例已生成', hi >= 2, '只生成了 ' + hi + ' 个')

// ── 5. 酒馆路径：`_tavernRenderTags` 会不会把围栏整页文档转成 iframe？ ────────
//
// 为什么单独测：`renderFencedHtml` 的调用点**全在 `beautifyMuv`（DSH 原生路径）里**，
// 而酒馆面板走的是另一条：`window._tavernRenderTags`（client.js:830-931）→
// `dsh-tavern-v2` 的 `beautifyContentEl` → `contentEl.innerHTML = html`（bundle:5686）。
//
// 如果这条路径不把「围栏包住的整页 HTML」转成 iframe，那段 `<!DOCTYPE html><html>…`
// 就会被 `innerHTML` 直接解析进聊天 DOM —— `<style>` 是**全局生效**的，卡的
// `html,body{height:100%}` 与绝对定位会泄漏到整个面板。这正是「状态栏只剩一个头 /
// 满屏代码文本 / 内容列被压扁」这类症状的机制。
console.log('\n=== 5. 酒馆路径（_tavernRenderTags）===')
const SRC_RENAMED = SRC.replace('window._tavernRenderTags = function', 'function _tavernRenderTags')
let renderTavern = null
try {
  renderTavern = buildFrom(
    SRC_RENAMED,
    ['_tavernRenderTags'],
    { MUV_CARD_SANDBOX: sandboxOf(SRC), window: globalThis, document: undefined },
    '_tavernRenderTags'
  )
} catch (e) {
  console.log('  （拿不到 _tavernRenderTags：' + e.message + '）')
}

if (renderTavern) {
  let withoutIframe = 0
  for (const t of targets) {
    const out = String(renderTavern(t.rep) || '')
    const hasIframe = out.includes('<iframe')
    const fences = (out.match(/`{3,}/g) || []).length
    const hasDoctype = /<!doctype\s+html/i.test(out)
    if (!hasIframe) withoutIframe++
    console.log(`  ${t.card} / ${t.script}: 输出=${out.length}字 iframe=${hasIframe} 裸反引号段=${fences} 裸<!DOCTYPE>=${hasDoctype}`)
  }
  check('酒馆路径也把围栏整页文档转成 iframe（不转 → 卡 CSS 会泄漏进聊天 DOM）',
    withoutIframe === 0, `${withoutIframe}/${targets.length} 条没有 iframe，原样带着围栏和文档交出去`)

  // 这条路径的**本职**是媒体/标签渲染，顺便确认它确实在做这件事
  const mediaIn = '<video src="a.mp4"></video><插图>海边</插图>'
  const mediaOut = String(renderTavern(mediaIn) || '')
  check('酒馆路径：带 src 的 <video> 补了 controls', /<video[^>]*\bcontrols\b/.test(mediaOut), mediaOut.slice(0, 200))
  check('酒馆路径：<插图> 转成了插画块', mediaOut.includes('muv-illustration'), mediaOut.slice(0, 200))
}

// ── 6. 视觉证据：把酒馆路径的输出真的内联进聊天 DOM ─────────────────────────
//
// 同一个 fixture 在修复前后都能用：修复前它是「卡 CSS 泄漏、整条消息被撑爆」的现场，
// 修复后同一页应该变成「一个高度自适应的 iframe」。这样"修复有效"是可看图对比的，
// 而不是只看断言变绿。
console.log('\n=== 6. 内联后果的视觉证据 ===')
if (renderTavern && targets.length) {
  const t = targets.find((x) => x.card.indexOf('足控') >= 0) || targets[0]
  const inlined = String(renderTavern(t.rep) || '')
  // ⚠ 绝对不能把卡文档直接拼进 <script>：它内含未转义的 </script>，会把**宿主页面自己**
  //   搞坏（小黄鸭在这一步白折腾了几轮）。JSON.stringify 之后再转义 </script 与 <!--。
  const asJs = JSON.stringify(inlined).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
  const body = [
    '<div class="chat">',
    '  <div class="msg">上一条消息：这段排版应保持正常。</div>',
    '  <div class="msg" id="tavernMsg"><span style="color:#8b93a1">（酒馆渲染结果在此 innerHTML 注入）</span></div>',
    '  <div class="msg">下一条消息：<b>如果这段的排版被改变、页面被撑长，就说明卡的 CSS 泄漏了。</b></div>',
    '</div>',
    '<script>document.getElementById("tavernMsg").innerHTML = ' + asJs + ';<\/script>',
  ].join('\n')
  const file = path.join(OUT, 'tavern-inline.html')
  writeFileSync(file, PAGE(
    `酒馆路径内联「${t.card} / ${t.script}」的后果 —— 含 iframe=${inlined.includes('<iframe')}`,
    withHeightRuntime(body), 'tavern-inline'), 'utf8')
  fixtures.push({ name: 'tavern-inline', file, png: path.join(OUT, 'tavern-inline.png') })
  console.log(`  已生成 tavern-inline.html（输出 ${inlined.length} 字，含 iframe=${inlined.includes('<iframe')}）`)
}

// ── 7. 真实消息形状（盲区补测） ─────────────────────────────────────────────
//
// ⚠ 这一节的存在本身就是个教训：上面 [1] 测的是**裸替换串**（围栏恰好在第 0 位），
// 而真实消息里围栏是被包起来的 ——
//     <div class="muv-statusbar-wrap">```\n<!DOCTYPE html>…\n```</div>
// 于是「裸替换串通过」完全不能推出「真实消息通过」。小黄鸭实测报了这种形状下
// `renderFencedHtml` 原样返回（changed=false）而我上面全绿，两边必须当面对齐。
console.log('\n=== 7. 真实消息形状（围栏不在第 0 位）===')
const renderMedia = buildFrom(SRC, ['renderMediaTags'], { MUV_CARD_SANDBOX: sandboxOf(SRC) }, 'renderMediaTags')

let wrapFail = 0
for (const t of targets) {
  const tag = `${t.card} / ${t.script}`
  const cases = {
    'div 包裹': '<div class="muv-statusbar-wrap">\n' + t.rep + '\n</div>',
    '前后有正文': '前置正文。\n\n' + t.rep + '\n\n后置正文。',
    'div 包裹 + 前后正文': '开场。\n<div class="muv-statusbar-wrap">\n' + t.rep + '\n</div>\n结尾。',
  }
  for (const [label, input] of Object.entries(cases)) {
    const out = renderNew(input)
    const frames = (out.match(/<iframe\b/g) || []).length
    const sc = srcdocOf(out)
    const un = sc ? stripInjected(unescapeAttr(sc.raw)).doc : ''
    const ok = frames === 1 && !!sc && un === t.body
    if (!ok) {
      wrapFail++
      console.log(`  FAIL ${tag} [${label}]: iframe=${frames} srcdoc=${!!sc} 剥后=${un.length}字 正文=${t.body.length}字` +
        ` 首处不同@${sc ? firstDiff(un, t.body) : '-'} 输出=${out.length}字(输入${input.length})`)
    }
  }
}
check('真实消息形状下围栏也被正确转成 iframe（正文逐字）', wrapFail === 0,
  `${wrapFail} 个形状没有转成 iframe —— 裸替换串通过推不出真实消息通过`)

// 媒体标签：小用例只要求**线性**，真卡文档才是真正的考场
//
// ⚠ 这里我差点写下一条假结论：`renderMediaTags('<video src="a.mp4">')` 是 19→73 字符，
// 看着像"膨胀"，其实是**正确行为** —— 补了 controls/preload/class 就该变长。
// 两条 video 得到 146 = 2×73 也是线性。判据必须是「相对输入是否超线性」，
// 不是「是否变长」，否则会把正常行为报成 bug。
{
  const linear = (input, out) => out.length <= input.length * 3 + 200
  let bad = 0
  const cases = [
    '<video src="a.mp4">',
    '<video src="a.mp4"><video src="b.mp4">',
    '<audio src="a.mp3">',
    '<video src="a.mp4">尾部正文不应该被吞掉',
  ]
  for (const input of cases) {
    let out = ''
    try { out = String(renderMedia(input) || '') } catch (e) { out = 'THROW:' + e.message }
    const ok = !out.startsWith('THROW:') && linear(input, out) && out.indexOf('尾部正文') >= 0 || !input.includes('尾部正文')
    if (!ok) bad++
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} renderMediaTags(${JSON.stringify(input)}) → ${out.length}字`)
  }
  check('小用例的媒体改写是线性的、且不吞尾部正文', bad === 0, bad + ' 例异常')

  // 真卡文档：小黄鸭在这里撞到 `RangeError: Invalid string length`（V8 字符串上限）。
  // 指数膨胀一旦发生就会抛这个错，所以判据是「不抛 + 输出与输入同量级」。
  let realBad = 0
  for (const t of targets) {
    for (const [what, input] of [['围栏整页', t.rep], ['纯文档', t.body]]) {
      const t0 = Date.now()
      let out = ''
      let err = ''
      try { out = String(renderMedia(input) || '') } catch (e) { err = e.message }
      const ms = Date.now() - t0
      const ratio = input.length ? (out.length / input.length) : 0
      const ok = !err && ratio < 2
      if (!ok) realBad++
      console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${t.card}/${t.script} [${what}] ${input.length}字 → ${err ? 'THROW ' + err : out.length + '字 比值' + ratio.toFixed(2)} (${ms}ms)`)
    }
  }
  check('真卡整页文档过 renderMediaTags 不抛错、不膨胀', realBad === 0, realBad + ' 例抛错或膨胀')
}

// 一条消息里出现**多个**围栏文档（真机的 apply-regex-card 输出里就不止一个）
{
  const foot = targets.filter((t) => t.card.indexOf('足控') >= 0)
  if (foot.length >= 2) {
    const two = foot[0].rep + '\n\n中间正文\n\n' + foot[1].rep
    const out = renderNew(two)
    const frames = (out.match(/<iframe\b/g) || []).length
    check('一条消息里两个围栏文档 → 两个 iframe', frames === 2, '实际 ' + frames)
    const sc = [...out.matchAll(/ srcdoc="/g)].length
    check('两个 srcdoc 都在', sc === 2, '实际 ' + sc)
  }
}

// ── 8. 真实消息（服务端正则产出）在两条路径上的渲染 ────────────────────────
//
// 前面几节用的都是「卡的正则替换串」，那是**中间产物**。这一节用服务端
// `/api/muv-engine/apply-regex-card` 对一条**真 AI 回复**跑完之后的完整文本
// （`rewritten.txt`，213,953 字，含 `<VariableInsert>`、裸围栏整页文档、`<video>`），
// 也就是两条渲染路径真正吃到的东西。
console.log('\n=== 8. 真实消息的两条路径 ===')
const REAL_MSG = path.join(os.tmpdir(), 'muv-visual', 'rewritten.txt')
if (existsSync(REAL_MSG)) {
  const real = readFileSync(REAL_MSG, 'utf8')
  console.log(`  真实消息 ${real.length} 字`)
  const tavernOut = renderTavern ? String(renderTavern(real) || '') : ''
  const dshOut = String(renderNew(real) || '')
  const count = (s, re) => (s.match(re) || []).length
  for (const [label, out] of [['酒馆 _tavernRenderTags', tavernOut], ['DSH beautifyMuv(renderFencedHtml)', dshOut]]) {
    console.log(`  ${label}: 输出=${out.length}字 iframe=${count(out, /<iframe\b/g)} 裸反引号段=${count(out, /`{3,}/g)} 裸<!DOCTYPE>=${count(out, /<!doctype\s+html/gi)}`)
  }
  check('真实消息在酒馆路径上也转成了 iframe', count(tavernOut, /<iframe\b/g) >= 1,
    'iframe=0 —— 卡整页 HTML 会原样进 innerHTML')
  check('真实消息在酒馆路径上不再残留裸围栏', count(tavernOut, /`{3,}/g) === 0,
    '残留 ' + count(tavernOut, /`{3,}/g) + ' 段反引号')
  const asJs = (s) => JSON.stringify(s).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
  const mk = (name, cap, html) => {
    const body = [
      '<div class="chat">',
      '  <div class="msg">上一条消息：这段排版应保持正常。</div>',
      `  <div class="msg" id="realMsg"><span style="color:#8b93a1">（${name} 渲染结果在此 innerHTML 注入）</span></div>`,
      '  <div class="msg">下一条消息：<b>如果这段排版被改变、页面被撑长，就说明卡的 CSS 泄漏了。</b></div>',
      '</div>',
      '<script>document.getElementById("realMsg").innerHTML = ' + asJs(html) + ';<\/script>',
    ].join('\n')
    const file = path.join(OUT, name + '.html')
    writeFileSync(file, PAGE(cap, withHeightRuntime(body), name), 'utf8')
    fixtures.push({ name, file, png: path.join(OUT, name + '.png') })
  }
  mk('real-tavern', '真实消息 → <b>酒馆路径</b> → innerHTML（修复后应是一个自适应 iframe）', tavernOut)
  mk('real-dsh', '真实消息 → <b>DSH 原生路径</b>（renderFencedHtml）→ innerHTML', dshOut)
} else {
  console.log('  （没有 rewritten.txt，跳过；它由服务端 apply-regex-card 对一条真回复产出）')
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物目录: ' + OUT)
for (const f of fixtures) console.log('  ' + f.name + '.html')
process.exit(fail ? 1 : 0)
