#!/usr/bin/env node
/**
 * 客户端源码的**词法 + 作用域**工具：把 `lib/client.js` 里某个函数的函数体**原样**提出来，
 * 再把「这段代码据以运行的名字」逐个判定归属。
 *
 * ── 为什么必须有它（真实翻车，同栈刚发生的）──────────────────────────────
 * 把一段代码从一个作用域搬到另一个作用域时，最容易失效的**不是**逻辑，而是**接线**。
 * `dsh-tavern-v2` 把路由搬进新模块时写的"静态契约"是
 * **解构名集合 == 调用点键集合** —— 它比的是**自己枚举的两份清单**。
 * 于是有个名字（`json`，被用了 105 处）**两侧都没写**，契约恒等地看不见它，
 * 一路全绿，跑到冒烟才炸 `ReferenceError: json is not defined`。
 * ⇒ 教训：**任何"自己枚举清单去比对"的契约，对"清单本身漏了"这件事是盲的。**
 *
 * 这里的做法反过来：
 *   **从函数体里枚举自由标识符**，逐个要求能解析到
 *   （形参 / 区内局部 / 外层作用域绑定 / 真全局 / 调用方显式注入），
 *   **任何无法分类的名字 ⇒ 工具直接失败并点名**，不许静默丢弃。
 *
 * 同一把尺子也用在**活变量**上（`_decorating` 这类会被回写的变量）：
 * 归属是**从函数体反推**的（看谁被赋值），而不是誊抄一份清单。
 *
 * ── 实现口径（两条是刻意的）────────────────────────────────────────────
 * ① **词法优先**：字符串 / 模板 / 正则 / 注释里的 `{` `}`、函数名、标识符**全都不算数**。
 *    client.js 里"引导脚本"本身就是**写在字符串里的 JavaScript**（`'function m(){try{'`），
 *    老实计数器会当场多数两个 `{` 把函数从中间截断；而字符串里那份同名函数会骗过
 *    `indexOf('function name(')` 的查找。词法扫描天然免疫这两类。
 * ② **声明的归属按作用域放，引用再按作用域链解析**（两趟）：
 *    `var`/`function` 归最近的**函数**作用域（有提升，先用后声明也判对），
 *    `let`/`const`/`class` 归最近的**块**作用域。
 *    ★ 这条直接决定"遮蔽"判得对不对：内层函数里声明的 `var x` **不能**让外层的自由 `x`
 *      变成"区内可解析" —— 否则判据自己就会静默蒙混。
 *
 * ── ★★ 支撑全部结论的那条不变量（改这个文件之前先读它）──────────────────
 *   **只要"任何非区内可解析的引用都进 `missing`/`unresolved`"，两侧的收窄/放宽
 *     就都不会变成放行。**
 *
 * 本文件里有两处**方向相反**的不精确，它们都是安全的，靠的就是上面那条：
 *   · **故意收窄**（会低估"可用"⇒ 偏红）：`depthZeroDecls` 只收**每层相对深度 0** 的声明。
 *     于是**包在块里的 `var`**（有提升、运行时其实可见）与 **`catch (e)` 的参数**都会被
 *     标成 `unresolved`。安全，因为"少认一个可用名"只会让东西进 `missing`（偏严）。
 *   · **故意放宽**（会高估"绑定"⇒ 偏绿但只影响标签）：`collectDeclarationNames` 收多声明符
 *     `var a = 1, b = 2`（对）与解构 `const {q: r} = o`（这里面 **`q` 是源属性名、不是绑定**，
 *     被一起收进来了）。安全，因为 `enclosingBindings` 的产物只用来**标标签**；
 *     真正的放行判断走 `missing`/`unlanded`，`q` 不接线照样进 `missing`。
 *   ⇒ **什么不能改**：不许在任何路径上把"非 local 引用"就地放过（例如为了少报红而加豁免）。
 *     一旦有了那种路径，上面两处不精确立刻从"偏严/只影响标签"变成"真放行"。
 */

import fs from 'node:fs'

// ── EOL 归一化（所有接受源码文本的入口都要先过这一关）─────────────────────

/**
 * ★ 为什么必须归一化：本仓 `core.autocrlf = true` 且**没有 `.gitattributes`** ⇒
 * **同一个提交在不同检出形态下行尾不同**：
 *   · CI 的工作流里关掉了 autocrlf ⇒ 检出是 **LF**（所以 CI 绿）；
 *   · Windows 上任何人做一次普通 `git clone`（默认 autocrlf=true）⇒ 检出是 **CRLF**。
 * 判据里只要有一处逐字比较（例如 `mutateOnce` 的 needle 含 `\n` + 缩进），
 * 就会在"默认 clone"上假红 —— 而且看起来像真失败。**这是"CI 绿、默认 clone 红"，
 * 正好是 tavern 那次"本机绿、CI 红"的镜像。**
 *
 * 本仓 AGENTS §12 早有这条规矩：别用字符窗口定位代码，窗口会被 `\r` 撑破，
 * **匹配前先 `.replace(/\r\n/g, '\n')`**。这里把它固化成入口处的一次归一化。
 *
 * ★ 为什么放在**每个入口**而不是只放在 `tokenize`：本文件里有若干处会**按 token 偏移
 *   去切 `src`**（`findFunctionsIn` / `enclosingBindingsIn`）。如果 token 来自归一化文本
 *   而切片用的是原始文本，偏移会差 CR 的个数 ⇒ **静默切错**。所以"喂进来的文本"与
 *   "拿来切片的文本"必须是同一份：入口归一化后全程只用那一份。
 */
export const lf = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n')

/** 读一份源码并归一化行尾。**读源码一律走它**，别在各处自己 `readFileSync`。 */
export function readSourceText(pathOrUrl) {
  return lf(fs.readFileSync(pathOrUrl, 'utf8'))
}

// ── 保留字：不是"引用"，不进自由标识符集合 ──────────────────────────────
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'async', 'await', 'of', 'get', 'set',
  // 关键字字面量：不是"引用"，不该进自由标识符集合
  // （否则每个函数都会凭空多出 null/true/false 三个"全局"噪声）
  'true', 'false', 'null',
])

/**
 * ★ 真全局白名单 —— **故意写窄**。
 *
 * 白名单外的一切都必须落到「形参/区内局部/外层绑定/显式注入」之一，否则**报红**。
 * 这不是洁癖：一个没被分类的名字，正是"接线断了"的现场。
 * 新增真全局要走**显式的一次选择**（在调用点的 extraGlobals 里写明），而不是被静默放过。
 */
const TRUE_GLOBALS = new Set([
  'window', 'document', 'console', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'globalThis', 'self', 'top', 'parent', 'frames', 'origin',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'EvalError', 'URIError', 'Proxy', 'Reflect', 'Intl', 'Function',
  'isFinite', 'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'escape', 'unescape', 'atob', 'btoa',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone', 'fetch', 'URL', 'URLSearchParams',
  'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'XMLHttpRequest', 'WebSocket', 'Event', 'CustomEvent', 'MessageEvent', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'Element', 'Node', 'NodeList', 'HTMLElement',
  'HTMLIFrameElement', 'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt',
  'Infinity', 'NaN', 'arguments', 'eval', 'undefined',
])

/** 会**写**左值的运算符：命中即说明"这个名字被回写"。 */
const WRITE_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '++', '--', '&&=', '||=', '??='])

// ── 词法 ────────────────────────────────────────────────────────────────

const ID_START = /[\p{ID_Start}$_]/u
const ID_CONT = /[\p{ID_Continue}$_\u200C\u200D]/u

/** 多字符运算符：**先长后短**匹配（`===` 不能被切成 `==` + `=`）。 */
const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|',
  '^', '!', '~', '?', ':', '=', '.', '#', '@',
]

/** 表达式位置的关键字：下一个 `/` 是**正则**而不是除号。 */
const REGEX_PREFIX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do',
  'else', 'yield', 'await',
])

/**
 * 词法扫描。
 * @param {string} src
 * @returns {Array<{type:string,value:string,start:number,end:number}>}
 */
export function tokenize(src) {
  src = lf(src)
  const tokens = []
  let i = 0
  // 'code' = 普通代码；'template' = 模板字面量的**原文段**。
  // `${` 把模式切回 code 并压入一个 template 标记；与它配对的 `}` 再切回 template。
  let mode = 'code'
  const modeStack = []

  const push = (type, value, start, end) => tokens.push({ type, value, start, end })
  const prevSig = () => {
    for (let k = tokens.length - 1; k >= 0; k--) if (tokens[k].type !== 'comment') return tokens[k]
    return null
  }

  while (i < src.length) {
    if (mode === 'template') {
      const start = i
      let text = ''
      while (i < src.length) {
        if (src[i] === '\\') { text += src[i] + (src[i + 1] || ''); i += 2; continue }
        if (src[i] === '`') break
        if (src[i] === '$' && src[i + 1] === '{') break
        text += src[i]; i++
      }
      if (text) push('str', text, start, i)
      if (src[i] === '$' && src[i + 1] === '{') {
        modeStack.push({ kind: 'template' })
        push('punct', '${', i, i + 2)
        i += 2
        mode = 'code'
        continue
      }
      if (src[i] === '`') { push('punct', '`', i, i + 1); i++; mode = 'code'; continue }
      break
    }

    const c = src[i]
    const n = src[i + 1]

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }

    if (c === '/' && n === '/') {
      const start = i
      while (i < src.length && src[i] !== '\n') i++
      push('comment', src.slice(start, i), start, i)
      continue
    }
    if (c === '/' && n === '*') {
      const start = i
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(src.length, i + 2)
      push('comment', src.slice(start, i), start, i)
      continue
    }
    if (c === "'" || c === '"') {
      const start = i
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) { i++; break }
        i++
      }
      push('str', src.slice(start, i), start, i)
      continue
    }
    if (c === '`') { push('punct', '`', i, i + 1); i++; mode = 'template'; continue }

    if (c === '/' && regexAllowed(prevSig())) {
      const start = i
      i++
      let inClass = false
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        else if (src[i] === '/' && !inClass) { i++; break }
        else if (src[i] === '\n') break          // 未闭合的正则：别吞掉后面整个文件
        i++
      }
      while (i < src.length && ID_CONT.test(src[i])) i++   // 旗标 gimsuy
      push('regex', src.slice(start, i), start, i)
      continue
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n || ''))) {
      const start = i
      while (i < src.length) {
        const ch = src[i]
        if (/[0-9a-fA-FxXoObB._]/.test(ch)) { i++; continue }
        if ((ch === '+' || ch === '-') && /[eE]/.test(src[i - 1] || '')) { i++; continue }
        break
      }
      push('num', src.slice(start, i), start, i)
      continue
    }

    if (ID_START.test(c)) {
      const start = i
      i++
      while (i < src.length && ID_CONT.test(src[i])) i++
      push('ident', src.slice(start, i), start, i)
      continue
    }

    if (c === '}' && modeStack.length && modeStack[modeStack.length - 1].kind === 'template') {
      modeStack.pop()
      push('punct', '}', i, i + 1)
      i++
      mode = 'template'
      continue
    }

    let matched = null
    for (const p of PUNCT) if (src.startsWith(p, i)) { matched = p; break }
    if (matched) { push('punct', matched, i, i + matched.length); i += matched.length; continue }

    // 认不出来的字符：原样做一个 punct，**不吞、不跳过**
    push('punct', c, i, i + 1)
    i++
  }

  return tokens
}

/** `prev` 之后那个 `/` 是正则字面量的开头吗？（词法上不可判定，只能看前文） */
function regexAllowed(prev) {
  if (!prev) return true
  if (prev.type === 'num' || prev.type === 'str' || prev.type === 'regex') return false
  if (prev.type === 'ident') return REGEX_PREFIX_KEYWORDS.has(prev.value)
  if (prev.type === 'punct') return ![')', ']', '}', '++', '--'].includes(prev.value)
  return true
}

// ── 切函数体 ────────────────────────────────────────────────────────────

/** 由 `{` 的 token 下标配平到 `}` 的下标（词法已排掉字符串/注释/正则里的括号）。 */
export function matchBrace(tokens, openIdx) {
  let depth = 0
  for (let k = openIdx; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type !== 'punct') continue
    if (t.value === '{') depth++
    else if (t.value === '}') { depth--; if (depth === 0) return k }
  }
  return -1
}

/**
 * 找出**所有**名为 `name` 的具名函数声明（`function name(` / `async function name(`）。
 * ★ 返回**列表**而不是单个：重名会让"提取到的那份"变得不可信 ——
 *   一个同名空壳函数就能让"提取成功"这件事失去意义。调用方（常驻测试）显式断言唯一。
 */
export function findFunctions(src, name) {
  const text = lf(src)
  return findFunctionsIn(tokenize(text), text, name)
}

export function findFunctionsIn(tokens, src, name) {
  const out = []
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type !== 'ident' || t.value !== 'function') continue
    let j = k + 1
    const isGen = tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '*'
    if (isGen) j++
    const idt = (tokens[j] && tokens[j].type === 'ident') ? tokens[j] : null
    if (!idt || idt.value !== name) continue
    j++
    if (isGen) throw new Error('生成器函数暂不支持提取：' + name)
    const open = tokens[j]
    if (!open || open.type !== 'punct' || open.value !== '(') continue

    let pd = 0
    let p = j
    for (; p < tokens.length; p++) {
      const q = tokens[p]
      if (q.type !== 'punct') continue
      if (q.value === '(') pd++
      else if (q.value === ')') { pd--; if (pd === 0) { p++; break } }
    }
    let bodyOpen = -1
    for (; p < tokens.length; p++) {
      if (tokens[p].type === 'punct' && tokens[p].value === '{') { bodyOpen = p; break }
    }
    if (bodyOpen < 0) continue
    const close = matchBrace(tokens, bodyOpen)
    if (close < 0) continue

    const prev = tokens[k - 1]
    const startOff = (prev && prev.type === 'ident' && prev.value === 'async') ? prev.start : t.start
    out.push({
      startIdx: k, endIdx: close, bodyOpen, paramOpen: j,
      start: startOff, end: tokens[close].end,
      source: src.slice(startOff, tokens[close].end),
    })
    k = close
  }
  return out
}

/** 提取唯一一个名为 `name` 的函数源码。**多候选直接失败**（重名 = 提取不可信）。 */
export function extractFunction(src, name) {
  const text = lf(src)
  return extractFunctionIn(tokenize(text), text, name)
}

export function extractFunctionIn(tokens, src, name) {
  const cands = findFunctionsIn(tokens, src, name)
  if (!cands.length) throw new Error('源码里找不到函数：' + name)
  if (cands.length > 1) {
    throw new Error('函数重名，提取不可信（' + cands.length + ' 个候选）：' + name +
      ' @ ' + cands.map((c) => c.start).join(','))
  }
  return cands[0].source
}

// ── 作用域 ──────────────────────────────────────────────────────────────

const prevNonComment = (tokens, k) => {
  for (let m = k - 1; m >= 0; m--) if (tokens[m].type !== 'comment') return tokens[m]
  return null
}

/** 由 `(` 的下标配平到 `)` 的下标。 */
function matchParen(tokens, openIdx) {
  let depth = 0
  for (let k = openIdx; k < tokens.length; k++) {
    const q = tokens[k]
    if (q.type !== 'punct') continue
    if (q.value === '(') depth++
    else if (q.value === ')') { depth--; if (depth === 0) return k }
  }
  return -1
}

/**
 * 从**绑定模式**里收名字（形参表 / `catch (…)` / `var {a,b} = …`）。
 *
 * 覆盖：普通名、`...rest`、`{a, b: c}`、`[a, b]`、`a = 默认值`。
 * 默认值里的**标识符是引用**，不是绑定 —— 所以这里只**登记绑定名的 token 下标**，
 * 而不是"跳过一段区域"，这样默认值里的引用在第二趟照样会被算作引用。
 * @returns {{names:Set<string>, tokenIdx:Set<number>}}
 */
function collectPatternNames(tokens, from, to) {
  const names = new Set()
  const tokenIdx = new Set()
  let depth = 0
  let skipDefault = 0

  for (let k = from; k <= to && k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type === 'comment') continue

    if (t.type === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') { depth++; continue }
      if (t.value === ')' || t.value === ']' || t.value === '}') { depth--; continue }
      if (t.value === '=') { skipDefault = depth; continue }
      if (skipDefault && t.value === ',' && depth === skipDefault) { skipDefault = 0; continue }
      continue
    }

    if (t.type !== 'ident') continue
    if (skipDefault) continue                       // 默认值表达式里：全是引用
    if (t.value === 'undefined') continue
    const next = tokens[k + 1]
    // `{ a: b }` —— `a` 是键，不是绑定名
    if (depth > 0 && next && next.type === 'punct' && next.value === ':') continue
    names.add(t.value)
    tokenIdx.add(k)
  }
  return { names, tokenIdx }
}

/** `var|let|const` 之后那一串绑定里的名字（逗号分隔；支持解构）。 */
function collectDeclarationNames(tokens, kwIdx) {
  const names = new Set()
  const tokenIdx = new Set()
  let k = kwIdx + 1

  while (k < tokens.length) {
    const t = tokens[k]
    if (t.type === 'comment') { k++; continue }
    if (t.type === 'punct' && t.value === ';') break
    if (t.type === 'punct' && (t.value === ')' || t.value === '}')) break   // `for (var i;;)` / 块末尾

    // 一个绑定项：`ident` / `{…}` / `[…]`
    if (t.type === 'ident') {
      names.add(t.value)
      tokenIdx.add(k)
      k++
    } else if (t.type === 'punct' && (t.value === '{' || t.value === '[')) {
      const close = t.value === '{' ? matchBrace(tokens, k) : matchBracket(tokens, k)
      if (close < 0) break
      const inner = collectPatternNames(tokens, k + 1, close - 1)
      for (const nm of inner.names) names.add(nm)
      for (const ix of inner.tokenIdx) tokenIdx.add(ix)
      k = close + 1
    } else {
      k++
      continue
    }

    // 收尾：`= 初值` 跳到本项结束的 `,`
    let d = 0
    while (k < tokens.length) {
      const q = tokens[k]
      if (q.type === 'punct') {
        if (['(', '[', '{'].includes(q.value)) d++
        else if ([')', ']', '}'].includes(q.value)) { if (d === 0) break; d-- }
        else if (q.value === ',' && d === 0) { k++; break }
        else if (q.value === ';' && d === 0) return { names, tokenIdx }
      }
      k++
    }
  }
  return { names, tokenIdx }
}

function matchBracket(tokens, openIdx) {
  let depth = 0
  for (let k = openIdx; k < tokens.length; k++) {
    const q = tokens[k]
    if (q.type !== 'punct') continue
    if (q.value === '[') depth++
    else if (q.value === ']') { depth--; if (depth === 0) return k }
  }
  return -1
}

/**
 * 两趟作用域分析。
 *
 * 第一趟：建作用域树、把声明**按作用域归属**放好（var/function→最近函数作用域；
 *         let/const/class→当前块），并记下每个 token 属于哪个作用域。
 * 第二趟：把每个**引用**按它的作用域链解析 —— 解析得到就是区内局部，
 *         解析不到才是自由标识符。
 *
 * ★ 为什么必须两趟：`var` 有提升，`function f(){ return x; var x = 1 }` 里的 `x` 是局部的。
 *   一趟走（边走边收声明）会把这种前向引用误报成自由标识符。
 * @returns {{free:Array<{name:string,idx:number,token:object}>, local:Set<string>, bindTokenIdx:Set<number>}}
 */
function analyzeScopes(tokens, from, to) {
  const scopes = [{ parent: null, isFunc: true, bindings: new Set() }]
  const scopeAt = new Map()          // token 下标 -> 作用域对象
  const bindTokenIdx = new Set()
  const localNames = new Set()

  // 预先标出"函数体"的 `{`，以及它的形参（含箭头函数两种形态）
  const funcBodies = new Map()       // `{` 下标 -> {params: {names, tokenIdx}}
  const arrowExpr = []               // 表达式体箭头：{atIdx, scope} —— 近似定界的
  const catchBlocks = new Map()      // `{` 下标 -> {names, tokenIdx}

  for (let k = from; k <= to; k++) {
    const t = tokens[k]
    if (t.type !== 'ident') continue

    if (t.value === 'function') {
      let j = k + 1
      if (tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '*') j++
      if (tokens[j] && tokens[j].type === 'ident') j++
      if (tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '(') {
        const close = matchParen(tokens, j)
        if (close > 0) {
          let p = close + 1
          for (; p <= to; p++) {
            if (tokens[p] && tokens[p].type === 'punct' && tokens[p].value === '{') {
              funcBodies.set(p, { params: collectPatternNames(tokens, j + 1, close - 1) })
              break
            }
            if (tokens[p] && tokens[p].type === 'punct' && tokens[p].value === ';') break
          }
        }
      }
      continue
    }

    if (t.value === 'catch') {
      const j = k + 1
      if (tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '(') {
        const close = matchParen(tokens, j)
        if (close > 0) {
          for (let p = close + 1; p <= to; p++) {
            if (tokens[p] && tokens[p].type === 'punct' && tokens[p].value === '{') {
              catchBlocks.set(p, collectPatternNames(tokens, j + 1, close - 1))
              break
            }
            if (tokens[p] && tokens[p].type === 'punct' && tokens[p].value === ';') break
          }
        }
      }
      continue
    }
  }

  // 箭头函数
  for (let k = from; k <= to; k++) {
    const t = tokens[k]
    if (t.type !== 'punct' || t.value !== '=>') continue
    const prev = prevNonComment(tokens, k)
    if (prev && prev.type === 'punct' && prev.value === ')') {
      let d = 0
      for (let m = k - 1; m >= from; m--) {
        const q = tokens[m]
        if (q.type !== 'punct') continue
        if (q.value === ')') d++
        else if (q.value === '(') {
          d--
          if (d === 0) {
            const next = tokens[k + 1]
            if (next && next.type === 'punct' && next.value === '{') {
              funcBodies.set(k + 1, { params: collectPatternNames(tokens, m + 1, k - 1) })
            } else {
              arrowExpr.push({ atIdx: k, params: collectPatternNames(tokens, m + 1, k - 1) })
            }
            break
          }
        }
      }
    } else if (prev && prev.type === 'ident') {
      const next = tokens[k + 1]
      const names = new Set([prev.value])
      const tokenIdx = new Set([k - 1])
      if (next && next.type === 'punct' && next.value === '{') funcBodies.set(k + 1, { params: { names, tokenIdx } })
      else arrowExpr.push({ atIdx: k, params: { names, tokenIdx } })
    }
  }

  // ── 第一趟：作用域树 + 声明归属 ──
  let cur = scopes[0]
  /** 表达式体箭头的定界：在同一个括号深度遇到 `,` `)` `;` `]` `:` 就收摊（近似）。 */
  const openArrowExpr = []

  const declareIn = (scope, name) => {
    if (!name) return
    scope.bindings.add(name)
    localNames.add(name)
  }
  const nearestFunc = (s) => { let x = s; while (x && !x.isFunc) x = x.parent; return x || scopes[0] }

  for (let k = from; k <= to; k++) {
    const t = tokens[k]
    scopeAt.set(k, cur)

    if (t.type === 'punct') {
      if (t.value === '{') {
        const body = funcBodies.get(k)
        const cb = catchBlocks.get(k)
        const child = body
          ? { parent: cur, isFunc: true, bindings: new Set() }
          : { parent: cur, isFunc: false, bindings: new Set() }
        cur = child
        if (body) {
          for (const nm of body.params.names) declareIn(child, nm)
          for (const ix of body.params.tokenIdx) bindTokenIdx.add(ix)
        }
        if (cb) {
          for (const nm of cb.names) declareIn(child, nm)
          for (const ix of cb.tokenIdx) bindTokenIdx.add(ix)
        }
        scopeAt.set(k, cur)
        continue
      }
      if (t.value === '}') {
        if (cur.parent) cur = cur.parent
        scopeAt.set(k, cur)
        continue
      }
      if (t.value === ',' || t.value === ')' || t.value === ';' || t.value === ']' || t.value === ':') {
        // 表达式体箭头的收尾（近似 —— 本仓目标函数里没有靠它遮蔽的写法，见 masking 反证）
        while (openArrowExpr.length && openArrowExpr[openArrowExpr.length - 1].depth === cur) {
          const a = openArrowExpr.pop()
          for (const nm of a.params.names) declareIn(a.scope, nm)
          for (const ix of a.params.tokenIdx) bindTokenIdx.add(ix)
          if (a.scope.parent) cur = a.scope.parent
        }
      }
      continue
    }

    if (t.type !== 'ident') continue

    if (t.value === 'var' || t.value === 'let' || t.value === 'const') {
      const d = collectDeclarationNames(tokens, k)
      const target = t.value === 'var' ? nearestFunc(cur) : cur
      for (const nm of d.names) declareIn(target, nm)
      for (const ix of d.tokenIdx) bindTokenIdx.add(ix)
      continue
    }
    if (t.value === 'class') {
      const next = tokens[k + 1]
      if (next && next.type === 'ident') { declareIn(cur, next.value); bindTokenIdx.add(k + 1) }
      continue
    }
    if (t.value === 'function') {
      let j = k + 1
      if (tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '*') j++
      const idt = tokens[j]
      if (idt && idt.type === 'ident') {
        const prev = prevNonComment(tokens, k)
        const isExpr = prev && prev.type === 'punct' &&
          ['=', '(', ',', ':', '[', '!', '&', '|', '?', '=>', '.', 'return'].includes(prev.value)
        // 声明：名字归当前作用域；表达式：名字只活在自己的作用域里 —— 这里一律**不当引用**处理
        if (!isExpr) declareIn(cur, idt.value)
        bindTokenIdx.add(j)
      }
      continue
    }

    // 表达式体箭头的参数作用域：在 `=>` 之后的那段里生效
    if (t.value === '=>') {
      const a = arrowExpr.find((x) => x.atIdx === k)
      if (a) {
        const child = { parent: cur, isFunc: true, bindings: new Set() }
        cur = child
        openArrowExpr.push({ scope: child, params: a.params, depth: child.parent })
        for (const nm of a.params.names) declareIn(child, nm)
        for (const ix of a.params.tokenIdx) bindTokenIdx.add(ix)
      }
      continue
    }
    if (arrowExpr.some((x) => x.params.tokenIdx.has(k))) {
      // 单参箭头 `x => …`：名字已登记，token 也标好
      const a = arrowExpr.find((x) => x.atIdx === k + 1)
      if (a) {
        const child = { parent: cur, isFunc: true, bindings: new Set() }
        cur = child
        openArrowExpr.push({ scope: child, params: a.params, depth: child.parent })
        for (const nm of a.params.names) declareIn(child, nm)
        bindTokenIdx.add(k)
      }
      continue
    }
  }

  // ── 第二趟：解析引用 ──
  const free = []
  for (let k = from; k <= to; k++) {
    const t = tokens[k]
    if (t.type !== 'ident') continue
    if (RESERVED.has(t.value)) continue
    if (bindTokenIdx.has(k)) continue
    const prev = prevNonComment(tokens, k)
    if (prev) {
      if (prev.type === 'punct' && (prev.value === '.' || prev.value === '?.')) continue
      if (prev.type === 'punct' && prev.value === '#') continue
      if (prev.type === 'punct' && prev.value === '...') continue
      if (prev.type === 'ident' && ['var', 'let', 'const', 'function', 'class', 'catch'].includes(prev.value)) continue
      if (prev.type === 'punct' && prev.value === 'new') continue
    }
    const next = tokens[k + 1]
    // 对象字面量的键 / label：后面紧跟 `:`，且不是三元的 `?`
    if (next && next.type === 'punct' && next.value === ':' &&
      !(prev && prev.type === 'punct' && prev.value === '?')) continue

    // 作用域链解析
    let s = scopeAt.get(k) || scopes[0]
    let found = false
    while (s) { if (s.bindings.has(t.value)) { found = true; break } s = s.parent }
    free.push({ name: t.value, idx: k, token: t, local: found })
  }

  return { free, local: localNames, bindTokenIdx }
}

/**
 * 枚举 `src` 中 `atOffset` 处**外层作用域**的绑定（逐层，含每一层的语句级声明）。
 * 用途：判断自由标识符能不能解析到"外层模块级绑定"。
 * 只收**该层相对深度 0** 的声明 —— 更深的声明在别的块里，本函数看不见。
 *
 * ★★ **`atOffset` 必须是在【归一化后】文本里的偏移。**
 * 这里会在入口 `lf(src)`，但**偏移是你传进来的**、不会跟着换算：
 *   · 传"归一化后的文本 + 它自己的偏移"（用 token 的 `start`）⇒ 正确；
 *   · 传"CRLF 文本的偏移"配同一份内容 ⇒ 每个换行差 1 个 `\r`，结果会**静默偏大**
 *     （实测同一目标：LF 偏移 → 293 个外层绑定；CRLF 偏移配 CRLF 文本 → **296**，不报错）。
 * 仓内调用者一律走同源的 `enclosingBindingsIn(tokens, cand.start)`（token 偏移与文本同源）⇒
 * 目前**没有** live bug；记在这里是因为它是个"看起来能用"的坑，别留给下一个搬家人。
 * @param {string} src
 * @param {number} atOffset **归一化后**文本里的字符偏移（别用 `indexOf` 在原始文本上数）
 * @returns {Map<string, number>} 名字 -> 第几层外层（1 = 最近）
 */
export function enclosingBindings(src, atOffset) {
  const text = lf(src)
  return enclosingBindingsIn(tokenize(text), atOffset)
}

export function enclosingBindingsIn(tokens, atOffset) {
  const stack = []
  const encl = []
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type !== 'punct') continue
    if (t.value === '{') stack.push(k)
    else if (t.value === '}') {
      const open = stack.pop()
      if (open === undefined) continue
      if (tokens[open].start < atOffset && atOffset < t.end) encl.push([open, k])
    }
  }
  encl.sort((a, b) => b[0] - a[0])          // 内层在前

  const out = new Map()
  let level = 0
  for (const [open, close] of encl) {
    level++
    for (const name of statementLevelDecls(tokens, open, close)) {
      if (!out.has(name)) out.set(name, level)
    }
  }
  return out
}

/** 一个括号块**相对深度 0** 处的声明名。 */
function statementLevelDecls(tokens, openIdx, closeIdx) {
  return depthZeroDecls(tokens, openIdx + 1, closeIdx - 1)
}

/**
 * `[from, to]` 区间内**相对深度 0** 处的声明名（`function/var/let/const/class`）。
 *
 * ★ 只收相对深度 0：更深的声明在别的块里，外层看不见。这条是**故意的窄**——
 *   收宽了会把"内层才有的名字"当成外层可用，那是静默蒙混（遮蔽类缺陷就此隐身）。
 *   代价是**标签不精确**：包在块里的 `var`（有提升、运行时其实可见）会被算成
 *   "外层找不到"，于是进 unresolved/missing。对搬迁闸门无害（不接线照样要报、接线后能清空），
 *   但读材料时别把它当成"真悬空"——见 `where` 里那句"前源码里的外层绑定"。
 *   `catch (e)` 的参数同理只被认作绑定、不进这里的声明集。
 */
function depthZeroDecls(tokens, from, to) {
  const out = new Set()
  let depth = 0
  for (let k = from; k <= to && k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type === 'comment') continue
    if (t.type === 'punct') {
      if (t.value === '{' || t.value === '(' || t.value === '[') depth++
      else if (t.value === '}' || t.value === ')' || t.value === ']') depth--
      continue
    }
    if (depth !== 0 || t.type !== 'ident') continue
    if (t.value === 'function') {
      let j = k + 1
      if (tokens[j] && tokens[j].type === 'punct' && tokens[j].value === '*') j++
      if (tokens[j] && tokens[j].type === 'ident') out.add(tokens[j].value)
      continue
    }
    if (t.value === 'var' || t.value === 'let' || t.value === 'const') {
      const d = collectDeclarationNames(tokens, k)
      for (const nm of d.names) out.add(nm)
      continue
    }
    if (t.value === 'class') {
      const next = tokens[k + 1]
      if (next && next.type === 'ident') out.add(next.value)
    }
  }
  return out
}

// ── 右端校验：`provided` 里的名字，在新模块里**真的落地**了吗 ──────────────

/**
 * ★ 目标模块（新文件）的**顶层绑定**集合：`import` 说明符 + 模块顶层声明。
 *
 * ── 为什么必须有它（这是 tavern 那次失效的**镜像**）─────────────────────
 * `wiringReport` 只能答「**必须接线什么**」——它的 `provided` 是**调用方的声明**，
 * **没有任何东西核对过**。于是：只要 `provided` 里写了某个名字，判据就是绿的，
 * 哪怕新模块**根本没 import / 没声明**它。
 *   · tavern 那次是「**两侧都没写**」（`json`）⇒ `wiringReport` 能挡；
 *   · 这一次是「**写了但没落地**」      ⇒ 只有右端校验能挡。
 * 搬迁时每一次都要经过 `provided`，一次手滑就把闸门变成装饰 —— 所以两端都要看。
 *
 * ★ 只收**模块顶层**：嵌套函数里绑定的名字不是模块级绑定，收进来就成了静默蒙混。
 * @param {string} targetSrc 新模块的完整源码
 * @returns {Set<string>}
 */
export function targetBindings(targetSrc) {
  const target = lf(targetSrc)
  const tokens = tokenize(target)
  const out = new Set()

  // ① import 说明符（本地名）：`import d from` / `import {a, b as c} from` / `import * as ns from`
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type !== 'ident' || t.value !== 'import') continue
    const nx = tokens[k + 1]
    // `import.meta` / 动态 `import(` 都不是绑定
    if (nx && nx.type === 'punct' && (nx.value === '.' || nx.value === '(')) continue

    let braceDepth = 0
    for (let j = k + 1; j < tokens.length; j++) {
      const q = tokens[j]
      if (q.type === 'comment') continue
      if (q.type === 'str') break                                  // 模块说明符 ⇒ 结束
      if (q.type === 'punct') {
        if (q.value === '{') braceDepth++
        else if (q.value === '}') braceDepth--
        continue
      }
      if (q.type !== 'ident') continue
      if (q.value === 'from') break
      if (q.value === 'as') {
        // `as <本地名>`：本地名是**后面**那个
        const nm = tokens[j + 1]
        if (nm && nm.type === 'ident') { out.add(nm.value); j++ }
        continue
      }
      // 普通位置的名字：若紧跟 `as`，它是**导出名**而不是本地名，跳过
      const after = tokens[j + 1]
      if (after && after.type === 'ident' && after.value === 'as') continue
      out.add(q.value)
    }
  }

  // ② 模块顶层声明
  for (const nm of depthZeroDecls(tokens, 0, tokens.length - 1)) out.add(nm)
  return out
}

/**
 * ★ **两端一起看**：左端（必须接线什么）+ 右端（新模块里真的落地了吗）。
 *
 * 判绿条件：`missing` 为空 **且** `unlanded` 为空。
 * —— 少任何一端，闸门都能被绕过：只看左端 ⇒ 声明了就算数；只看右端 ⇒ 不知道要接什么。
 *
 * @param {object} o
 * @param {string} o.src        旧文件（如 lib/client.js）
 * @param {string[]} o.entries  一起搬走的入口函数
 * @param {Set<string>} o.provided  调用方声明的接线名字
 * @param {string} o.targetSrc  新模块源码（落地侧的真相）
 * @param {string[]} [o.extraGlobals]
 */
export function landingReport({ src, entries, provided = new Set(), targetSrc = '', extraGlobals = [] }) {
  // 两端都归一化：wiringReport / targetBindings 内部也会归一化（幂等），这里显式写出意图
  const left = wiringReport({ src: lf(src), entries, provided, extraGlobals })
  const landed = targetBindings(lf(targetSrc))
  // ★ `provided` 里的**每一个**名字都必须在新模块里找到绑定 —— 这里**不豁免任何名字**
  //   （真全局本来就不该出现在 `provided` 里：它们走 `extraGlobals`）。
  //   别把 `window` 这类顺手塞进 `provided`：它会被如实点名为"未落地"。
  const unlanded = [...provided].filter((n) => !landed.has(n)).sort()
  return {
    missing: left.missing,
    where: left.where,
    unlanded,
    liveVariables: left.liveVariables,
    landedBindings: [...landed].sort(),
    ok: left.missing.length === 0 && unlanded.length === 0,
  }
}

/**
 * ★ **反证用的受控变异**：把 `needle` 换成 `replacement`，且**必须恰好命中一次**。
 *
 * 为什么"恰好一次"是硬要求：反证的价值全在"坏样本真的变坏了"。
 * 如果 needle 写错、源码改过、或者命中 0 次，变异**静默没生效** ——
 * 于是"坏样本必须报红"这条对照会**恒等地通过**，比没有对照更糟（它给的是假信心）。
 * 命中多次同样危险：改到的可能不是被试的那一处。两种都直接抛错。
 * @param {string} src
 * @param {string} needle
 * @param {string} replacement
 * @returns {string}
 */
export function mutateOnce(src, needle, replacement) {
  // ★ 两边都归一化：检出形态是 CRLF 时，needle 里写死的 \n + 缩进会**原样命中 0 次**，
  //   于是反证恒等抛错（看起来像真失败）。归一化后两种检出形态行为一致。
  src = lf(src)
  needle = lf(needle)
  replacement = lf(replacement)
  const parts = src.split(needle)
  const hits = parts.length - 1
  if (hits !== 1) {
    throw new Error('变异没有生效或命中不唯一（命中 ' + hits + ' 次）：' + JSON.stringify(needle.slice(0, 90)))
  }
  const out = parts.join(replacement)
  if (out === src) throw new Error('变异是空操作（替换文本与被替换文本相同）')
  return out
}

// ── 主判据 ──────────────────────────────────────────────────────────────

/**
 * ★ 把一个函数的**自由标识符**逐个分类。
 *
 * 桶：`local`（函数内可解析）/ `enclosing`（外层作用域绑定）/ `global`（真全局）/
 *     `provided`（调用方显式注入）/ **`unresolved`（无法分类 ⇒ 调用方必须失败并点名）**。
 *
 * `liveVariables` 是**从函数体反推**出来的：外层绑定里被本函数**赋值/自增**的那些
 * —— 它们必须由调用方通过访问器接线，不能当成一个只读快照。
 *
 * @param {object} o
 * @param {string} o.src              整份源码（如 lib/client.js）
 * @param {string} o.name             函数名
 * @param {Set<string>} [o.provided]  调用方显式注入的名字
 * @param {string[]} [o.extraGlobals] 额外认可的真全局（每次都要在调用点写明理由）
 */
export function scopeReport({ src, name, provided = new Set(), extraGlobals = [] }) {
  // ★ 入口先归一化行尾：token 偏移与切片必须来自**同一份**文本（见 lf 的长注释）
  src = lf(src)
  const tokens = tokenize(src)
  const cands = findFunctionsIn(tokens, src, name)
  if (!cands.length) throw new Error('源码里找不到函数：' + name)
  if (cands.length > 1) throw new Error('函数重名，提取不可信：' + name)
  const cand = cands[0]

  const enclosing = enclosingBindingsIn(tokens, cand.start)
  const { free } = analyzeScopes(tokens, cand.startIdx, cand.endIdx)
  const extra = new Set(extraGlobals)

  const buckets = { local: [], enclosing: [], global: [], provided: [], unresolved: [] }
  const live = new Set()
  // ★ 按**引用**而不是按**名字**归类，且 `unresolved` 优先。
  //   为什么：一个名字可能既有"区内可解析"的用法、又有"解析不到"的用法 —— 典型是**遮蔽**
  //   （内层 `function inner(){ var x }` 之后，外层再用 `x`）。若按名字去重且先到的算数，
  //   外层的自由 `x` 会被内层的局部 `x` 顶掉，**遮蔽缺陷就此隐身**。
  const byName = new Map()
  for (const r of free) {
    const cls = r.local ? 'local'
      : provided.has(r.name) ? 'provided'
        : enclosing.has(r.name) ? 'enclosing'
          : (TRUE_GLOBALS.has(r.name) || extra.has(r.name)) ? 'global' : 'unresolved'
    const prev = byName.get(r.name)
    if (!prev || cls === 'unresolved') byName.set(r.name, cls)

    if (!r.local && enclosing.has(r.name) &&
      !!(tokens[r.idx + 1] && tokens[r.idx + 1].type === 'punct' && WRITE_OPS.has(tokens[r.idx + 1].value))) {
      live.add(r.name)
    }
  }
  for (const [name, cls] of byName) buckets[cls].push(name)
  for (const k of Object.keys(buckets)) buckets[k].sort()

  return {
    fn: name,
    buckets,
    free: free.map((r) => ({ name: r.name, local: r.local })),
    freeNames: [...byName.keys()].sort(),
    enclosing: [...enclosing.keys()].sort(),
    unresolved: buckets.unresolved.slice(),
    liveVariables: [...live].sort(),
  }
}

/**
 * ★ 接线判据：把一组入口函数**当成一次搬迁**来看 ——
 * 「本组函数用到的每一个名字，要么在组内可解析，要么由 `provided` 显式接线」。
 *
 * ★ 关键口径：**外层作用域的绑定也算"必须接线"**。
 *   搬迁之后原作用域不会跟过去 —— 一个 `enclosing` 名字若没被显式接线，
 *   到了新模块就是 `ReferenceError`。把它当"自动可用"正是 tavern 那次
 *   `json is not defined`（用了 105 处、从未接线、契约看不见）的同一种失效。
 *   ⇒ 这里把它算进 `missing`，并**点名**。`where` 给出它在前源码里的位置以便诊断。
 *
 * `unresolved` 同样优先：只要某个名字**有一处**解析不到，它就进 `missing`。
 *
 * @param {object} o
 * @param {string} o.src
 * @param {string[]} o.entries   会被**一起搬走**的入口函数（组内互相引用算 local）
 * @param {Set<string>} [o.provided] 调用方显式接线的名字
 * @param {string[]} [o.extraGlobals]
 * @returns {{missing:string[], where:Map<string,string>, resolved:object, liveVariables:string[]}}
 */
export function wiringReport({ src, entries, provided = new Set(), extraGlobals = [] }) {
  // ★ 入口先归一化行尾：token 偏移与切片必须来自**同一份**文本（见 lf 的长注释）
  src = lf(src)
  const tokens = tokenize(src)
  const entrySet = new Set(entries)
  const missing = new Set()
  const where = new Map()
  const resolved = { local: [], provided: [], global: [] }
  const live = new Set()

  for (const name of entries) {
    const cands = findFunctionsIn(tokens, src, name)
    if (!cands.length) { missing.add(name); where.set(name, '源码里找不到这个函数'); continue }
    if (cands.length > 1) { missing.add(name); where.set(name, '函数重名，提取不可信'); continue }
    const cand = cands[0]
    const enclosing = enclosingBindingsIn(tokens, cand.start)
    const { free } = analyzeScopes(tokens, cand.startIdx, cand.endIdx)

    for (const r of free) {
      if (r.local) continue
      if (entrySet.has(r.name)) { resolved.local.push(r.name); continue }
      if (!r.local && enclosing.has(r.name) &&
        !!(tokens[r.idx + 1] && tokens[r.idx + 1].type === 'punct' && WRITE_OPS.has(tokens[r.idx + 1].value))) {
        live.add(r.name)
      }
      if (TRUE_GLOBALS.has(r.name) || extraGlobals.includes(r.name)) { resolved.global.push(r.name); continue }
      if (provided.has(r.name)) { resolved.provided.push(r.name); continue }
      // ★ 必须显式接线：外层绑定不会跟着搬过去
      missing.add(r.name)
      where.set(r.name, enclosing.has(r.name)
        ? '前源码里的外层绑定（第 ' + enclosing.get(r.name) + ' 层）'
        : '前源码里也找不到（真·悬空）')
    }
  }

  return {
    missing: [...missing].sort(),
    where,
    resolved: {
      local: [...new Set(resolved.local)].sort(),
      provided: [...new Set(resolved.provided)].sort(),
      global: [...new Set(resolved.global)].sort(),
    },
    liveVariables: [...live].sort(),
  }
}
