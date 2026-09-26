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
import { clientSource, extractFunction, loadClientRenderers } from './test-client-source.mjs'

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
//
// ★ 本轮更新（守卫标签无关化）：这条判据以前是手写枚举，只认 `<StatusPlaceHolder|<Prism|…`，
//   于是 `<video>` / `<img>` / `<audio>` / 中文标签**整轮跳过去** —— 用户看到的裸标签就来自这里。
//   现在换成形状判据 `/<[!\/]?[a-zA-Z_\u4e00-\u9fa5][^<>]*>/`：任何 HTML 形态的标签都放行。
//   下面这批断言因此**反向**：媒体输入必须被放行；同时补一组"仍然拦住"的反向用例
//   （纯散文 / `2 < 3` / 没闭合的尖括号）—— 那两条一起才说明判据既修好了、又没放过宽。
//   真机（真卡 + 真实助手正文 + 真 DOM）的 before/after 在 verify-guard-tag-agnostic.mjs。
const GUARD_LINE_RE = /^\s*if \(!muvHasTag && !muvShortOk\) return text\s*$/
const gateLine = SRC.split(/\r?\n/).find(l => GUARD_LINE_RE.test(l))
check('找到 beautifyMuv 的入口闸门', !!gateLine, gateLine ? '' : '（源码里没有形如 if (!muvHasTag && !muvShortOk) return text 的行）')
check('闸门不匹配时直接 return 原文', /return text/.test(gateLine || ''))
// 标签判据字面量在 muvHasTag 定义行上（守卫块的第一行），不在守卫行上。
const tagLine = SRC.split(/\r?\n/).find(l => /^\s*var muvHasTag = \//.test(l))
const gateLit = tagLine ? /var muvHasTag = (\/[\s\S]*?\/[a-z]*)\.test\(text\)/.exec(tagLine) : null
check('能取出闸门正则字面量', !!gateLit, tagLine ? tagLine.trim() : '')
const gate = gateLit ? new Function('return ' + gateLit[1])() : null
const MEDIA_INPUTS = [
  ['带 src 的 video', '<video src="x.mp4"></video>'],
  ['带 src 的 audio', '<audio src="x.mp3"></audio>'],
  ['裸 video 提示词', '<video>雨声白噪音</video>'],
  ['插图标签', '<插图>海边</插图>'],
  ['媒体 + 正文', '他推开门。\n<video src="x.mp4"></video>\n风灌了进来。'],
]
for (const [label, input] of MEDIA_INPUTS) {
  check('★ 闸门放行：媒体消息 ' + label + ' ⇒ beautifyMuv 继续往下走（旧枚举会整轮跳过）',
    gate && gate.test(input) === true, gate ? 'gate 没命中' : 'no gate')
}
// 对照：闸门认识的那些标记确实会被放行（证明闸门本身在工作，不是我取错了）
check('对照：带 <Status_block> 的消息会被闸门放行', gate && gate.test('<Status_block>x</Status_block>') === true)
check('对照：带 <choices> 的消息会被闸门放行', gate && gate.test('<choices>\nA. 甲\n</choices>') === true)
// ★ 反向用例：放开媒体名字不等于"什么文本都放行"。这些必须仍然被标签判据拦住 ——
//   注意 2026-09-22 起守卫多了一条**短文本放行**分支（占位符 greeting 那一档）：
//   短纯散文会被完整决策放行去取卡（有意的新语义），但**标签判据本身**仍然不命中它们；
//   长散文（>300 字、无标签）则整条被拦，早退还在 —— 下面的长散文用例钉这一条。
const PROSE_INPUTS = [
  ['纯散文（一个标签都没有）', '他推开门，风灌了进来。他说了一句"今天真冷"，然后把窗关上。'],
  ['算术：2 < 3', '他看到 2 < 3 就想反驳。'],
  ['比较：a <= b', '条件写成 a <= b 才算对。'],
  ['后面没有收尾的 `>`', '这行是 x <y 没有收尾。'],
  ['数字紧跟尖括号：1 <2', '他还说了一句 1 <2。'],
  ['长散文（301 字、无标签）—— 完整守卫对它整条拦下', '深'.repeat(301)],
]
for (const [label, input] of PROSE_INPUTS) {
  check('★ 闸门仍然拦住（不误命中）：' + label, gate && gate.test(input) === false,
    gate ? '却被放行了' : 'no gate')
}

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

console.log('\n=== ④ 修法的岔路：字符串整条写回 vs DOM 段替换（先量化，别猜） ===')

// 派单里原先的建议是「把 _tavernRenderTags 的等价步骤接到 _decorateOne 里
// applyDecoratedHtml **之前**（对 html 字符串做）」。那条建议早于 markdown 的发现，
// 所以现在必须先证明它还会不会踩 markdown：媒体渲染的产物里**没有任何状态栏片段**，
// 于是 applyDecoratedHtml 会落到「!cardMatch ⇒ body.innerHTML = html」那条最后手段上，
// 而那正是把 innerText 写回去、markdown 永久变平的那条路。
let mediaRendered = null
let wrapExtract = null
let applySrc = null
try {
  applySrc = extractFunction(SRC, 'applyDecoratedHtml')
  mediaRendered = loadClientRenderers().renderMediaTags('<video src="a.mp4"></video>')
  wrapExtract = new Function('document', 'MUV_CARD_SANDBOX',
    [extractFunction(SRC, 'escHtml'), extractFunction(SRC, 'escAttr'), extractFunction(SRC, 'extractStatusWrap')]
      .join('\n') + '\nreturn extractStatusWrap')({ querySelectorAll: () => [] }, 'allow-scripts')
} catch (e) {
  console.log('  SKIP 取函数失败: ' + e.message)
}
if (mediaRendered !== null && wrapExtract) {
  console.log('  媒体渲染产物: ' + JSON.stringify(mediaRendered))
  check('媒体渲染产物里没有状态栏片段',
    wrapExtract(mediaRendered) === null, JSON.stringify(wrapExtract(mediaRendered)))
  check('★ 因此「字符串整条写回」会落到 applyDecoratedHtml 的最后手段（body.innerHTML = html）',
    /body\.innerHTML = html/.test(applySrc))
  console.log('  ⇒ 结论：④ 必须做 **DOM 段替换**（像 muvRenderChoices 那样只换那一段），')
  console.log('     不能在 _decorateOne 里把字符串整条写回 —— 那会把刚修好的 markdown 再抹一次。')
}

console.log('\n=== 结论 ===')
console.log('  ① 原生路径的 `_decorateOne` 自己不认媒体标签：renderMediaTags 只挂在')
console.log('     window._tavernRenderTags 上，而它的唯一调用者是酒馆面板；')
console.log('     装饰链里能改文本的只有 beautifyMuv（卡的脚本）。')
console.log('  ② ★ 本轮更新：媒体消息现在**能过** beautifyMuv 的入口闸门了（判据改成标签无关，')
console.log('     见 ② 那一组断言）。所以卡自己的正则脚本（[6]「视频」/ [9]「CG插图」）第一次')
console.log('     有机会在原生路径上跑 —— 它们把 `<video>名字</video>` 补成带 src 的播放器。')
console.log('     真有元素落地的 before/after 数字在 verify-guard-tag-agnostic.mjs（真卡+真 DOM）。')
console.log('  ★ 仍然不成立的部分（别把它说成"修好了"）：卡里**没有**对应脚本的标记不会被美化。')
console.log('     实测：`<audio>欢快</audio>` 那一轮守卫已放行、真卡 10 条脚本 0 命中 ⇒ DOM 一字不改。')
console.log('  ③ DSH 自己的 markdown 管线没开 allowDangerousHtml ⇒ 原始 HTML 不会被原样输出成')
console.log('     可播放元素；落到页面里的元素一律来自引擎/卡的产物（上面 ④ 那条路）。')
console.log('  → ④ 的实现方式：**DOM 段替换**（上面两条断言给出理由）。')

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
