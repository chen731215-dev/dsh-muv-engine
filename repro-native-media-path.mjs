// Repro (keep): is `<video>` / `<audio>` / `<插图>` reachable at all on DSH's **native**
// message path, and what does the user end up seeing?
//
// Why this matters: the card's own regex output carries media tags, and that HTML is
// injected by *our* code (srcdoc / decorated HTML), so real cards look fine. What is
// untested is a media tag the **model itself wrote**. Two separate questions:
//
//   ① can the engine act on it on the native path?  (static reachability)
//   ② if not, what does the reader see?              (what DSH's own renderer does)
//
// ① is measured here exactly. ② is measured as far as Node can see it (the renderer
// runs inside the browser app), so the evidence is: the app never enables
// `allowDangerousHtml` on its markdown pipeline, i.e. raw HTML is not emitted as live
// markup. The decisive browser-side confirmation belongs in verify-visual.mjs.
//
// Run: node repro-native-media-path.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { clientSource } from './test-client-source.mjs'

let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

const SRC = clientSource()
const ENGINE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))

console.log('=== ① 可达性：原生路径到底碰不碰媒体标签 ===')

// `renderMediaTags` 有几个调用点？定义处不算。
const callSites = [...SRC.matchAll(/=\s*renderMediaTags\(|renderMediaTags\([^)]*\)/g)]
  .map(m => m[0])
  .filter(t => !/function\s+renderMediaTags/.test(t))
const mediaCalls = [...SRC.matchAll(/\brenderMediaTags\(/g)].length
console.log('  renderMediaTags( 出现次数（含注释/测试提及）: ' + mediaCalls)
// 真正的可执行调用点：`result = renderMediaTags(result)` 这种赋值形态
const realCalls = [...SRC.matchAll(/=\s*renderMediaTags\(/g)].length
check('renderMediaTags 只有 1 个可执行调用点', realCalls === 1, 'realCalls=' + realCalls)

// 它挂在哪个函数里？`_tavernRenderTags` 是**赋值式**的（`window._tavernRenderTags = function …`），
// 所以不能靠「向上找最近的 function 名」——那样会命中上一个具名函数。改为按赋值标记切块：
// 调用点必须落在赋值标记之后，且两者之间不能再出现一个新的顶层具名函数。
const at = SRC.indexOf('= renderMediaTags(')
const marker = SRC.indexOf('window._tavernRenderTags = function')
const between = marker >= 0 && at > marker ? SRC.slice(marker, at) : null
check('这个调用点在 _tavernRenderTags 里（通用标签渲染器）',
  !!between && !/\n {4}(?:async )?function /.test(between),
  between === null ? '(调用点在赋值标记之前)' : '区间里出现了新的顶层函数')

// 原生装饰器 `_decorateOne`（2050 行起）有没有碰通用标签渲染器？
const decStart = SRC.indexOf('async function _decorateOne(')
const decRest = decStart >= 0 ? SRC.slice(decStart + 10) : ''
const decEndRel = decRest.search(/\n {4}(?:async )?function /)
const decoratorBody = decStart >= 0 ? SRC.slice(decStart, decEndRel < 0 ? SRC.length : decStart + 10 + decEndRel) : ''
check('_decorateOne 的函数体切出来了（不是空片）', decoratorBody.length > 500, 'len=' + decoratorBody.length)
check('_decorateOne 里没有 renderMediaTags', !decoratorBody.includes('renderMediaTags'))
check('_decorateOne 里没有 _tavernRenderTags', !decoratorBody.includes('_tavernRenderTags'))
check('_decorateOne 只走 beautifyMuv（围栏/状态栏/选项）', decoratorBody.includes('beautifyMuv('))
check('_decorateOne 里没有 <插图> 这类通用标签转换', !decoratorBody.includes('muv-illustration'))

// 谁调用 window._tavernRenderTags？酒馆面板 bundle 是唯一调用者。
const TAVERN = path.join(ENGINE, '..', 'dsh-tavern-v2', 'lib', 'client.manager.bundle.js')
if (!fs.existsSync(TAVERN)) {
  console.log('  SKIP 找不到 dsh-tavern-v2 bundle（无法确认真机唯一调用者）')
} else {
  const tb = fs.readFileSync(TAVERN, 'utf8')
  const n = [...tb.matchAll(/_tavernRenderTags\(/g)].length
  check('酒馆面板是 _tavernRenderTags 的唯一调用者（1 处）', n === 1, '调用次数=' + n)
  check('engine 自身不调用 _tavernRenderTags（只定义）',
    [...SRC.matchAll(/_tavernRenderTags\(/g)].length === 0)
}

console.log('\n=== ② beautifyMuv 的入口闸门放不放媒体标签过去 ===')

// 闸门是 beautifyMuv 的第一条语句：不匹配就直接 return text（原样返回，什么都不做）。
const gateLine = SRC.split(/\r?\n/).find(l => l.includes('if (!/<StatusPlaceHolder'))
check('找到 beautifyMuv 的入口闸门', !!gateLine)
check('闸门不匹配时直接 return 原文', /return text/.test(gateLine || ''))
const gateLit = gateLine ? /\/<StatusPlaceHolder[\s\S]*?\/i/.exec(gateLine) : null
check('能取出闸门正则字面量', !!gateLit)
const gate = gateLit ? new Function('return ' + gateLit[0])() : null
const MEDIA_INPUTS = [
  ['带 src 的 video', '<video src="x.mp4"></video>'],
  ['带 src 的 audio', '<audio src="x.mp3"></audio>'],
  ['裸 video 提示词', '<video>雨声白噪音</video>'],
  ['插图标签', '<插图>海边</插图>'],
  ['媒体 + 正文', '他推开门。\n<video src="x.mp4"></video>\n风灌了进来。'],
]
for (const [label, input] of MEDIA_INPUTS) {
  check('闸门放行？否 → 媒体消息 ' + label + ' 原样返回（beautifyMuv 什么也不做）',
    gate && gate.test(input) === false, gate ? 'gate matched' : 'no gate')
}
// 对照：闸门认识的那些标记确实会被放行（证明闸门本身在工作，不是我取错了）
check('对照：带 <Status_block> 的消息会被闸门放行', gate && gate.test('<Status_block>x</Status_block>') === true)
check('对照：带 <choices> 的消息会被闸门放行', gate && gate.test('<choices>\nA. 甲\n</choices>') === true)

console.log('\n=== ③ DSH 自己的 markdown 管线：原始 HTML 会被放行成真元素吗 ===')

const FE = path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh',
  'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')
if (!fs.existsSync(FE)) {
  console.log('  SKIP 找不到 dsh-web-frontend/dist —— 这条只能在有前端产物的机器上测')
} else {
  const files = fs.readdirSync(FE).filter(n => n.endsWith('.js'))
  const app = files.map(n => ({ n, s: fs.readFileSync(path.join(FE, n), 'utf8') }))
  const count = (s, m) => (s.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  const appWithMicromark = app.filter(a => a.s.includes('micromark'))
  const appWithDangerous = app.filter(a => a.s.includes('allowDangerousHtml'))
  const vendorWithDangerous = app.filter(a => a.s.includes('allowDangerousHtml') && !a.s.includes('micromark'))

  check('前端确实用 micromark 一族做 markdown（存在该库）', appWithMicromark.length > 0,
    'files=' + appWithMicromark.map(a => a.n).join(','))
  // 应用层代码里没有 allowDangerousHtml ⇒ 没有开启「原始 HTML 原样输出」这个开关。
  // 库自身的默认值是 false（vendor 里能看到 `allowDangerousHtml||!1`），所以 raw 节点会被转义。
  check('★ 应用层没有开启 allowDangerousHtml（原始 HTML 不会被原样输出成真元素）',
    appWithMicromark.every(a => !a.s.includes('allowDangerousHtml')),
    '开启了 allowDangerousHtml 的 chunk: ' + appWithDangerous.map(a => a.n).join(','))
  if (vendorWithDangerous.length) {
    check('库默认值是 false（`allowDangerousHtml||!1` 出现在依赖里）',
      vendorWithDangerous.some(a => a.s.includes('allowDangerousHtml:n.allowDangerousHtml||!1')
        || a.s.includes('allowDangerousHtml||!1')))
  }
  // 没有任何 HTML 消毒器/白名单库：说明清理不是靠 sanitizer，而是靠"根本不输出原始 HTML"
  check('前端没有 DOMPurify 一类的消毒器（清理靠上游不输出，而不是过滤）',
    app.every(a => !a.s.includes('DOMPurify') && !a.s.includes('dompurify')))
}

console.log('\n=== 结论 ===')
console.log('  ① 原生路径的引擎侧对媒体标签完全不可达：renderMediaTags 只挂在')
console.log('     window._tavernRenderTags 上，而它的唯一调用者是酒馆面板。')
console.log('  ② 媒体消息连 beautifyMuv 的入口闸门都过不去 → 引擎返回原文，什么都不做。')
console.log('  ③ 因此「模型自己写的 <video src>」在原生路径上没有任何东西会给它加')
console.log('     controls/preload；DSH 自己的 markdown 管线也没开 allowDangerousHtml，')
console.log('     原始 HTML 不会被原样输出成可播放元素。')
console.log('  → 结论：不是"DSH 已经渲染正常"，而是这条链在原生路径上整个缺失。')
console.log('     浏览器侧最终观感（裸标签文本 vs 无 controls 的空元素）请用 verify-visual.mjs 复核。')

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
