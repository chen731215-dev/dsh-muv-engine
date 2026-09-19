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
export function loadClientRenderers(doc) {
  const src = clientSource()
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

  const build = new Function('MUV_CARD_SANDBOX', 'document', code + '\nreturn {' +
    RENDER_EXPORTS.map(n => n + ': ' + n).join(', ') +
    '}')
  const out = build(sandboxDecl ? sandboxDecl[1] : 'allow-scripts',
    doc || { querySelectorAll: () => [] })
  out.sandbox = sandboxDecl ? sandboxDecl[1] : 'allow-scripts'
  out.liftedNames = [...have]
  return out
}
