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

/** All functions the render tests execute, in dependency order. */
export const RENDER_FN_NAMES = [
  'escHtmlBasic',
  'escAttr',
  'findClosingFence',
  'renderFencedHtml',
  'readStartTag',
  'attrValue',
  'dropAttr',
  'renderMediaTags',
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
  const start = src.indexOf('    function ' + name + '(')
  if (start < 0) throw new Error('function not found in lib/client.js: ' + name)
  let i = src.indexOf('{', start)
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
  throw new Error('unbalanced braces while extracting: ' + name)
}

/**
 * Evaluate the shipped render helpers and return them as real functions.
 * @returns {{renderFencedHtml: Function, renderMediaTags: Function}}
 */
export function loadClientRenderers() {
  const src = clientSource()
  const code = RENDER_FN_NAMES.map(n => extractFunction(src, n)).join('\n\n')
  const build = new Function('MUV_CARD_SANDBOX', code +
    '\nreturn { renderFencedHtml: renderFencedHtml, renderMediaTags: renderMediaTags }')
  // The sandbox value is read from the source too, so a change there is visible here.
  const sandbox = /var MUV_CARD_SANDBOX\s*=\s*'([^']*)'/.exec(src)
  return build(sandbox ? sandbox[1] : 'allow-scripts')
}
