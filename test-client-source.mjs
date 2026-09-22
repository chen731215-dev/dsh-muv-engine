// Lifts the pure string-render helpers out of lib/client.js so a plain Node test can
// exercise **exactly what ships**.
//
// Why not just import them: client.js is a client-plugin bundle wrapped in
// `window.__ModuleLoader__.load({ factory: (require) => … })`, so it cannot be
// imported by Node and the helpers live inside the factory closure. Extracting the
// function *source* keeps the test honest (no copy that can drift) and fails loudly
// if a function is renamed — which is the point of a rename guard.
//
// Run of record: test-client-render.mjs (the regression sentinel) and
// repro-fence-media.mjs / repro-media-script-corruption.mjs (the bug reproductions).
import fs from 'node:fs'

const CLIENT_PATH = new URL('./lib/client.js', import.meta.url)

/**
 * Entry points the render tests execute. Dependencies are discovered automatically
 * (see loadClientRenderers), so adding a helper to client.js does not require editing
 * this list — only the entry points live here.
 */
export const RENDER_FN_NAMES = [
  'renderFencedHtml',
  'renderMediaTags',
  'parseChoiceOptions',
  'cardHtmlIframe',
  'withFrameHeightBootstrap',
  'onMuvFrameHeightMessage',
  'muvFrameBootstrap',
  'muvFrameHeightLimits',
]

/** Everything `loadClientRenderers` returns. */
const RENDER_EXPORTS = [
  'renderFencedHtml',
  'renderMediaTags',
  'parseChoiceOptions',
  'cardHtmlIframe',
  'withFrameHeightBootstrap',
  'onMuvFrameHeightMessage',
  'muvFrameBootstrap',
  'muvFrameHeightLimits',
]

export function clientSource() {
  return fs.readFileSync(CLIENT_PATH, 'utf8')
}

/**
 * Lift `    function <name>(…) {…}` out of a source string by brace matching.
 *
 * A plain brace counter is not enough: braces appear inside string literals,
 * template literals, line/block comments and regex literals. The scanner tracks
 * which of those it is inside. (It assumes `/` in code position opens a regex,
 * which holds for these functions — they contain no division.)
 * @param {string} src
 * @param {string} name
 * @returns {string} the function's full source text
 */
export function extractFunction(src, name) {
  // 声明必须带缩进才认（字符串里那份没有缩进）：client.js 里的函数分布在 4/6/8 空格
  // 三种缩进层级（模块级 / 卫生 pass 那层 / 装饰器那层），所以逐层试。
  const forms = ['function ' + name + '(', 'async function ' + name + '(']
  for (const form of forms) {
    for (let indent = 4; indent <= 12; indent += 2) {
      const mark = '\n' + ' '.repeat(indent) + form
      const start = src.indexOf(mark)
      if (start < 0) continue
      const text = sliceBalanced(src, start + 1)
      if (text) return text
    }
  }
  throw new Error('function not found in lib/client.js: ' + name)
}

/**
 * 从 `start`（`function` / `async function` 关键字处）配平到函数体结束。
 * 字符串 / 模板 / 正则 / 注释里的花括号不算数（引导脚本那种"字符串里的代码"会骗过老实计数器）。
 * @param {string} src
 * @param {number} start
 * @returns {string|null}
 */
function sliceBalanced(src, start) {
  let i = src.indexOf('{', start)
  if (i < 0) return null
  let depth = 0
  let state = 'code'
  // `/` 是**除号**还是**正则字面量开头**，词法上不可判定，只能看前文：
  // 前一个有效字符是标识符字符 / `)` / `]` / 引号 ⇒ 除号；否则是正则。
  // ★ 为什么必须这么判：`rewriteVhMinHeight` 里有一行
  //   `var px = Math.round(vh * parseFloat(m[1]) / 100)`。把它当正则开头，扫描器会
  //   一路吃到下一个 `/`（那是 `rewriteVhMinHeight` 之后某个函数里的注释放头），
  //   于是注释状态被吞掉、**切片越界到下一个函数**，`new Function` 当场
  //   `SyntaxError: Unexpected token 'function'`。
  //   ⇒ 表现是「三门禁一起崩、报的错在别的文件里」，而真因在这个扫描器的词法判断上。
  //   同类：`verify-shared.mjs` 的 `extractFunction` 早就有这套判断（`regexAllowed`）。
  let prev = ''
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue }
      if (c === '/' && n === '*') { state = 'block'; i++; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; prev = c; continue }
      if (c === '/' && regexAllowed(src, i, prev)) { state = 'regex'; continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
      else if (!/\s/.test(c)) prev = c
    } else if (state === 'regex') {
      if (c === '\\') { i++; continue }
      if (c === '/') { state = 'code'; prev = '/' }
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

/** `src[j]` 处的 `/` 是否为正则字面量开头（见 sliceBalanced 里的说明）。 */
function regexAllowed(src, j, prev) {
  if (!prev) return true
  if (!/[A-Za-z0-9_$)\]'"`]/.test(prev)) return true
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, j - 16), j))
  return !!(m && /^(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(m[1]))
}

/**
 * Evaluate the shipped render helpers and return them as real functions.
 *
 * `document` is injected so the parent-side message handler can be exercised in Node
 * with a fake `querySelectorAll`; in the browser it is simply the real document.
 * @param {object} [doc] `document` stub used by the frame-height handler
 * @returns {{renderFencedHtml: Function, renderMediaTags: Function, cardHtmlIframe: Function,
 *   withFrameHeightBootstrap: Function, onMuvFrameHeightMessage: Function,
 *   muvFrameBootstrap: Function, muvFrameHeightLimits: Function, sandbox: string}}
 */
export function loadClientRenderers(doc, win) {
  return loadClientRenderersFrom(clientSource(), doc, win)
}

/**
 * 同一件事，但源码由调用方给 —— 用于 **before 对照臂**（`git show <rev>:lib/client.js` 写进临时文件）。
 * 没有对照臂的门禁只能证明"现在没报错"，证明不了"这条判据真的能红"。
 * @param {string} src client.js 源码
 * @param {object} [doc]
 * @param {object} [win] `window` 桩。★ 为什么需要：`rewriteVhMinHeight` /
 *   `muvHostViewportHeight` 在**真实 DSH** 里读父页 `window.innerHeight`（vh 重写因此把
 *   `min-height:100vh` 烤成父页视口常量）。Node 里没有 `window` ⇒ 重写静默跳过 ⇒
 *   卡里的 `min-height:100vh` 原样进 iframe ⇒ 在探针里变成「随 iframe 高度伸缩」的
 *   真·不动点。高度收敛类门禁必须传一个 `{ innerHeight: <探针窗口高> }` 桩，
 *   否则测的是 Node 沙箱的缺省行为，不是上线行为（2026-09-22 verify-frame-height 之教训）。
 */
export function loadClientRenderersFrom(src, doc, win) {
  const sandboxDecl = /var MUV_CARD_SANDBOX\s*=\s*'([^']*)'/.exec(src)

  // 依赖自动发现：扫函数体里出现的 `名字(`，凡是真的能从顶层源码里提取出来的就一起带上。
  // 写死依赖列表会在源码每次重构后**报错**而不是报失败，那是噪音不是信号；而
  // "提取不到就跳过"是必需的——引导脚本那种"字符串里的代码"会让扫描命中 `m(` 这类
  // 并不存在的顶层函数。
  const lifted = new Map()
  const lift = (name) => {
    if (lifted.has(name)) return lifted.get(name)
    let text = null
    try { text = extractFunction(src, name) } catch (_) { text = null }
    lifted.set(name, text)
    return text
  }
  const have = new Set()
  const queue = [...RENDER_FN_NAMES]
  let code = ''
  while (queue.length) {
    const name = queue.shift()
    if (have.has(name)) continue
    const body = lift(name)
    if (!body) continue
    have.add(name)
    code += body + '\n\n'
    for (const mm of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = mm[1]
      if (!have.has(callee) && lift(callee)) queue.push(callee)
    }
  }

  // `window` 作为**形参**注入（不是全局）：沙箱里 `typeof window === 'undefined'` 的
  // 三个守卫点（rewriteVhMinHeight / ensureFrameHeightListener / ensureCardCompatListener）
  // 在传入桩时走"真实浏览器"分支。不给 win 时保持 undefined，行为与旧版完全一致。
  const build = new Function('MUV_CARD_SANDBOX', 'document', 'window', code + '\nreturn {' +
    RENDER_EXPORTS.map(n => n + ': ' + n).join(', ') +
    '}')
  const out = build(sandboxDecl ? sandboxDecl[1] : 'allow-scripts',
    doc || { querySelectorAll: () => [] },
    win)
  out.sandbox = sandboxDecl ? sandboxDecl[1] : 'allow-scripts'
  out.liftedNames = [...have]
  return out
}
