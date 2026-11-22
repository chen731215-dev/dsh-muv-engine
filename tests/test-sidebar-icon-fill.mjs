// **UI_CSS 的侧栏图标棘轮**（issue #3 的回归护栏）。
//
// 背景：`UI_CSS` 会被 `injectUiCss()` 无条件注入宿主页面 <head>，里面有若干条针对
// `[data-pane="sidebar"]` 的规则。issue #3 的根因是其中三条带了 `fill:currentColor
// !important`，把 DSH 的**描边型** SVG 图标（`fill="none"` + 子元素 `stroke="currentColor"`）
// 中间的镂空处填实 ⇒ 深色主题下整个侧栏图标变成一块白色实心块。
//
// 这个判据是**纯字符串**的（吃内存里的产物文本），不需要浏览器：
//   ① 产物里**不允许**任何 CSS 声明的 `fill:` 去命中侧栏 svg
//      —— 只认「真正的 CSS 属性」，注释里提到 fill 不算违规（本项目栽过"把注释当代码"）；
//   ② `stroke:` 也不许被硬加到侧栏 svg 上（那会把少数填充型图标变成描边空壳）；
//   ③ 颜色必须仍然跟随宿主主题（`color:var(...)` 那条要还在，否则修完变成另一头坏：
//      图标颜色不再跟主题走）；
//   ④ 反向自证：把 issue #3 的三个原始片段塞进样本，判据必须报红
//      （否则这些断言只是在"测我自己抄得对不对"）。
//
// 运行：node tests/test-sidebar-icon-fill.mjs

// ★ 必须走收口点 clientSource()，不要自己 fs.readFile('lib/client.js') ——
//   本仓有一条判据（tests/test-client-source-convergence.mjs）盯着「只有收口点能读产物」，
//   自己开读口会被当场点名。收口点顺带做了 CRLF 归一，判据也更稳。
import { clientSource } from './test-client-source.mjs'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const raw = clientSource()
// 产物里既有代码也有注释：注释是 C 风格 `/* … */` 与 `//`。
// 判据要区分「注释里提到 fill」与「真正的 CSS 声明」。
function stripComments(src) {
  // 只剥 /* … */（UI_CSS 的长注释都在这里）。保守起见保留字符串原样 ——
  // 我们的目标是找 CSS 文本里的 `fill:`，而 CSS 就在模板字符串里。
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}
const code = stripComments(raw)

/**
 * 抽出一条 CSS 规则的声明体（`{…}` 里那段）。
 * @param {string} src
 * @param {RegExp} selectorRe 形如 /\[data-pane="sidebar"\][^{]*svg\s*\{/
 * @returns {string[]} 命中的声明体列表
 */
function ruleBodies(src, selectorRe) {
  const out = []
  const re = new RegExp(selectorRe.source, 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf('{', m.index + m[0].length - 1)
    if (open < 0) continue
    const close = src.indexOf('}', open)
    if (close < 0) continue
    out.push(src.slice(open + 1, close))
    re.lastIndex = close
  }
  return out
}

console.log('=== ① 产物里不许有 CSS 属性的 fill 命中侧栏 svg（issue #3） ===')

// 三条原规则的选择器（issue #3 报告里逐个点名过）
const SIDEBAR_SVG_SELECTORS = [
  /\[data-pane="sidebar"\][^{]*\bsvg\b[^{]*\{/,
  /button\.Kad6XG_iconButton\s+svg\s*\{/,
  /\[data-pane="sidebar"\][^{]*\.(?:hHd-Xa|qDHVXG)_iconButton[^{]*\{/,
]

let fillHits = 0
for (const sel of SIDEBAR_SVG_SELECTORS) {
  for (const body of ruleBodies(code, sel)) {
    // 真正的 CSS 属性：`fill:`（排除 `fill-*` 与选择器里的 .xxx-fill 类名）
    const m = /(?<![-\w.])fill\s*:/.exec(body)
    if (m) { fillHits++; console.log('        命中：' + body.trim().slice(0, 120)) }
  }
}
check('侧栏 svg 规则里没有 CSS 的 fill 声明', fillHits === 0, fillHits + ' 处')

// 再补一道「全文任何 CSS 声明都不许给 svg 上 fill」的口径：
// 只要 `fill:` 紧跟在 `svg` 选择器所在的规则里就算。
let anySvgFill = 0
{
  const re = /svg[^{]*\{([^}]*)\}/g
  let m
  while ((m = re.exec(code)) !== null) {
    if (/(?<![-\w.])fill\s*:/.test(m[1])) {
      // 排除我们自己的 UI 组件类（.muv-sb-fill 之类是类名不是属性）
      anySvgFill++
      console.log('        其它 svg 规则命中：' + m[0].trim().slice(0, 120))
    }
  }
}
check('全产物里没有任何 svg 规则带 CSS fill 声明', anySvgFill === 0, anySvgFill + ' 处')

console.log('=== ② 也不许反手硬加 stroke 到侧栏 svg ===')
let strokeHits = 0
for (const sel of SIDEBAR_SVG_SELECTORS) {
  for (const body of ruleBodies(code, sel)) {
    if (/(?<![-\w.])stroke\s*:/.test(body)) strokeHits++
  }
}
check('侧栏 svg 规则里没有硬加的 CSS stroke 声明（会把填充型图标变空壳）', strokeHits === 0, strokeHits + ' 处')

console.log('=== ③ 颜色仍跟随宿主主题 ===')
const sidebarColorBodies = ruleBodies(code, /\[data-pane="sidebar"\]\[data-pane="sidebar"\][^{]*\{/)
const hasThemeColor = sidebarColorBodies.some((b) => /color\s*:\s*var\(--dsw-alias-/.test(b))
check(
  '侧栏仍用 var(--dsw-alias-*) 跟随宿主主题色（否则修完变另一头坏）',
  hasThemeColor,
  sidebarColorBodies.length + ' 条侧栏规则'
)

console.log('=== ④ 反向自证：issue #3 的原样片段必须被判红 ===')
// 把三条原始规则塞进一个样本，判据必须报红 —— 否则上面的断言是空转。
const BAD_SAMPLE = [
  'button.Kad6XG_iconButton svg{width:16px !important;height:16px !important;fill:currentColor !important;}',
  'html body [data-pane="sidebar"][data-pane="sidebar"] button svg,html body [data-pane="sidebar"][data-pane="sidebar"] [role="button"] svg{color:var(--dsw-alias-label-primary) !important;fill:currentColor !important;opacity:1 !important;}',
  'html body [data-pane="sidebar"][data-pane="sidebar"] .hHd-Xa_iconButton.hHd-Xa_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_iconButton.qDHVXG_iconButton{color:var(--dsw-alias-label-secondary) !important;fill:currentColor !important;background:transparent !important;}',
].join('\n')

let badHits = 0
for (const sel of SIDEBAR_SVG_SELECTORS) {
  for (const body of ruleBodies(BAD_SAMPLE, sel)) {
    if (/(?<![-\w.])fill\s*:/.test(body)) badHits++
  }
}
check(
  '★ 反向自证：把 issue #3 的三条原规则塞进样本，判据必须报红（≥1 处）',
  badHits > 0,
  '实测 ' + badHits + ' 处（为 0 说明判据空转）'
)

// 三条都要被抓到（分别验证，避免某一条选择器失灵被另外两条掩盖）
const perRule = [
  'button.Kad6XG_iconButton svg{fill:currentColor !important;}',
  '[data-pane="sidebar"] button svg{fill:currentColor !important;}',
  '[data-pane="sidebar"] .hHd-Xa_iconButton{fill:currentColor !important;}',
]
for (let i = 0; i < perRule.length; i++) {
  let hits = 0
  for (const sel of SIDEBAR_SVG_SELECTORS) {
    for (const body of ruleBodies(perRule[i], sel)) {
      if (/(?<![-\w.])fill\s*:/.test(body)) hits++
    }
  }
  check(`★ 反向自证 #${i + 1}：单独一条原规则也必须被抓到`, hits > 0, '实测 ' + hits)
}

console.log('')
console.log(`=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
