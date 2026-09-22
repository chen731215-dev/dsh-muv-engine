// 卡界面「宽度塌陷」判定台 —— 钉住用户报的那个现象：DSH 里卡片的框又窄又小，ST 里是满宽。
//
// 机制（可复现）：`.muv-statusbar-wrap` 落在**由内容决定宽度**的容器里（flex 子项 / inline-block）
// 时，它内部的 `<iframe style="width:100%">` 会按 iframe 的**固有宽度 300px** 反推父宽 ⇒
// 整框塌成 ~304px（卡自身还有 min-width 时是用户看到的 ~460px）。同一个原因也解释了"高度
// 变矮 + 出现内部滚动条"：宽度塌 → 卡按窄宽度重排 → 内容包围盒变矮 → 高度自适应报小。
//
// 这个工具做三件事：
//   ① **源码断言**：我们注入的承载容器规则里必须有显式的撑满声明，且不得有 `max-width` 上限；
//   ② **浏览器实测**：把 `renderFencedHtml` 的**真产物**放进 5 种父容器形状里量宽度，
//      其中 2 种用「剥掉撑满声明」的规则做**修复前对照**（必须塌，否则说明判据不敏感）；
//   ③ **真卡体检**：9 份真卡界面逐个放进 flex 父容器里量宽度，顺带报 iframe 高度。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-card-width.mjs
//
// ⚠ 判据必须"能红也能绿"：只断言"修复后是满宽"是不够的 —— 一个常量 940 也能通过。
//   所以同时断言"剥掉声明的对照组必须塌成 ~300px"。两边都成立，才证明撑满声明是**因**。

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  readEngineSource, buildFrom, sandboxOf, cssRuleFromSource, stripDecls,
  collectDocs, openPage, evalJson, htmlEsc, sleep,
} from './verify-shared.mjs'

const OUT = path.join(os.tmpdir(), 'muv-card-width')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SRC = readEngineSource()

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

// ─────────────────── 1. 源码断言：承载容器的撑满声明 ───────────────────
console.log('=== 1. 源码断言（我们注入的承载容器）===')

const SANDBOX = sandboxOf(SRC)
check('生产沙箱仍是 allow-scripts（没有为了排版放开同源）', SANDBOX === 'allow-scripts', SANDBOX)

const WRAP_REQUIRED = ['display:block', 'width:100%', 'min-width:0', 'align-self:stretch', 'box-sizing:border-box']
const wrapRule = cssRuleFromSource(SRC, '.muv-statusbar-wrap')
console.log('  .muv-statusbar-wrap 规则原文: ' + wrapRule.slice(0, 220))
for (const d of WRAP_REQUIRED) {
  check(`.muv-statusbar-wrap 含 ${d}`, wrapRule.replace(/\s+/g, '').includes(d.replace(/\s+/g, '')), wrapRule)
}
check('.muv-statusbar-wrap 不含 max-width 上限（用户明确要"非常大"）', !/max-width/.test(wrapRule), wrapRule)

const DSHV_REQUIRED = ['width:100%', 'min-width:0', 'box-sizing:border-box']
const dshvRule = cssRuleFromSource(SRC, '.dshv-root')
console.log('  .dshv-root 规则原文: ' + dshvRule.slice(0, 200))
for (const d of DSHV_REQUIRED) {
  check(`.dshv-root（visual 帧容器）含 ${d}`, dshvRule.replace(/\s+/g, '').includes(d.replace(/\s+/g, '')), dshvRule)
}
check('.dshv-root 不含 max-width 上限', !/max-width/.test(dshvRule), dshvRule)

const dshvFrameRule = cssRuleFromSource(SRC, '.dshv-frame')
check('.dshv-frame 含 width:100% 与 display:block',
  /width:100%/.test(dshvFrameRule) && /display:block/.test(dshvFrameRule), dshvFrameRule)

// 真产物：把最大的一份真卡界面过一遍 renderFencedHtml，拿它当被测对象（不是手抄的 iframe）
const renderFencedHtml = buildFrom(
  SRC, ['renderFencedHtml'],
  { MUV_CARD_SANDBOX: SANDBOX, window: { addEventListener() {} }, document: { querySelectorAll: () => [] } },
  'renderFencedHtml'
)
const docs = collectDocs()
check('读到真卡界面（防空矩阵假绿）', docs.length >= 5, '只读到 ' + docs.length + ' 份')
docs.sort((a, b) => b.body.length - a.body.length)
const biggest = docs[0]
const cardHtml = String(renderFencedHtml('```html\n' + biggest.body + '\n```\n'))
console.log(`  被测：${biggest.card} / ${biggest.script}  ${biggest.body.length} 字 → 渲染 ${cardHtml.length} 字`)
check('renderFencedHtml 产出了 .muv-statusbar-wrap 包裹的 iframe',
  cardHtml.includes('<div class="muv-statusbar-wrap">') && cardHtml.includes('class="muv-iframe"'), cardHtml.slice(0, 160))
// ⚠ 只查 **iframe 标签上的属性**：srcdoc 里是卡自己的 HTML，而 srcdoc 本身就是标签的一部分，
//   卡自己的 CSS 里到处都是 `max-width`（`>` 和 `"` 都已被 escAttr 转义，所以把 srcdoc="…"
//   整段挖掉是安全的）。第一版直接在整份 cardHtml 上查，被卡自己的样式骗出一堆假 FAIL。
const iframeTag = (/<iframe\b[^>]*>/.exec(cardHtml) || [''])[0].replace(/srcdoc="[^"]*"/, 'srcdoc="…"')
check('iframe 是满宽 + 默认高度不再是 600px 的"矮框"', /width:100%/.test(iframeTag) && /height:900px/.test(iframeTag) && !/height:600px/.test(iframeTag), iframeTag)
check('iframe 标签自己的属性上没有 max-width / max-height 上限', !/max-(width|height)/.test(iframeTag), iframeTag)

// ─────────────────── 2. 浏览器实测：父容器形状矩阵 ───────────────────
//
// 被测物体 = 上一步 renderFencedHtml 的**真产物**。
// 对照组 = 把撑满声明从**同一条源码规则**里剥掉（stripDecls），不是另写一条"看起来像旧的"规则。
// 对照组 = 把撑满声明**显式重置**成默认值（`width:auto` 等）。
//
// ⚠ 不能只写一条"更早版本的规则"去覆盖：CSS 里删掉一条声明**不会**抵消基类里同名的声明，
//   高优先级的规则少了 `width` 就只是"不覆盖它"，基类的 `width:100%` 照样生效 —— 第一版我
//   就是这么写的，结果对照组量出 940，被自己的断言抓住（"判据不敏感"那条 FAIL 得对）。
const oldWrapRule = stripDecls(wrapRule, WRAP_REQUIRED)
const RESET = 'width:auto;min-width:auto;align-self:auto;box-sizing:content-box;'
console.log('  （修复前的规则原文，仅作对照展示）: ' + oldWrapRule.slice(0, 200))
check('剥离后的对照规则确实不再含撑满声明',
  !WRAP_REQUIRED.some((d) => oldWrapRule.replace(/\s+/g, '').includes('{'.concat(d.replace(/\s+/g, '')))), oldWrapRule)
check('对照组用的是**显式重置**（width:auto 等），不是"少写几条声明"',
  /width:auto/.test(RESET) && /min-width:auto/.test(RESET) && /align-self:auto/.test(RESET), RESET)

const AVATAR = '<div class="avatar"></div>'
const cases = [
  { id: 'block', label: '块级父容器（修复前就能满宽的基线）', parent: 'col', inner: cardHtml, expect: 'container', rule: 'new' },
  { id: 'flexOld', label: 'flex 行 + **修复前规则**（必须塌，否则判据不敏感）', parent: 'col flex', inner: cardHtml, expect: 'collapse', rule: 'old' },
  { id: 'flexRow', label: 'flex 行 + 修复后规则', parent: 'col flex', inner: cardHtml, expect: 'container', rule: 'new' },
  { id: 'flexAvatar', label: 'flex 行 + 40px 头像兄弟 + 修复后规则', parent: 'col flex', inner: AVATAR + cardHtml, expect: 'container-48', rule: 'new' },
  { id: 'flexCol', label: 'flex 列 + 修复后规则', parent: 'col flexcol', inner: cardHtml, expect: 'container', rule: 'new' },
  { id: 'inlineBlock', label: 'inline-block 父容器 + 修复后规则（信息性）', parent: 'col ib', inner: cardHtml, expect: 'info', rule: 'new' },
]

const page = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>card-width</title>
<style>
  html,body{margin:0;background:#16181d;color:#d7dae0;font:13px/1.5 sans-serif}
  body{padding:10px}
  /* 模拟聊天列宽 940px；box-sizing:content-box 让 container 的内容宽正好是 940 */
  .col{width:940px;box-sizing:content-box;border:1px dashed #3a4048;padding:8px;margin:0 0 16px}
  .flex{display:flex;gap:8px}
  .flexcol{display:flex;flex-direction:column;gap:8px}
  .ib{display:inline-block}
  .avatar{flex:0 0 40px;width:40px;height:40px;background:#333;border-radius:6px}
  .cap{font:12px monospace;color:#8b93a1;margin:0 0 4px}
  ${wrapRule}
  .muv-iframe{display:block}
</style>
</head><body>
<!-- ⚠ 说明文字 .cap 必须放在**被测容器之外**：放进 flex 容器里它就成了一个占宽的兄弟 flex 项，
     量出来的宽度会莫名其妙地少 100 多 px（我第一版就这么错了，期望值全对不上）。 -->
${cases.map((c) => `<div data-case="${c.id}" data-expect="${c.expect}">
  <div class="cap">${htmlEsc(c.label)}</div>
  <div class="${c.parent}">${c.rule === 'old' ? `<style>[data-case="${c.id}"] .muv-statusbar-wrap{${RESET}}</style>` : ''}${c.inner}</div>
</div>`).join('\n')}
</body></html>`

const file = path.join(OUT, 'card-width.html')
writeFileSync(file, page, 'utf8')
console.log('\n=== 2. 父容器形状矩阵（浏览器实测）===')
console.log('  夹具: ' + file)

const MEASURE = `JSON.stringify([].slice.call(document.querySelectorAll('[data-case]')).map(function(c){
  var box = c.querySelector('.col') || c;
  var w = box.querySelector('.muv-statusbar-wrap');
  var f = box.querySelector('iframe.muv-iframe');
  var cs = getComputedStyle(box);
  var contentW = box.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
  var av = box.querySelector('.avatar');
  return { id: c.dataset.case, expect: c.dataset.expect,
    container: Math.round(box.getBoundingClientRect().width), content: Math.round(contentW),
    avatar: av ? Math.round(av.getBoundingClientRect().width) : 0,
    wrap: w ? Math.round(w.getBoundingClientRect().width) : -1,
    iframe: f ? Math.round(f.getBoundingClientRect().width) : -1,
    iframeH: f ? Math.round(f.getBoundingClientRect().height) : -1 };
}))`

const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: OUT, windowSize: '1400,2200' })
try {
  await sleep(1800)
  const rows = await evalJson(rt.cdp, MEASURE, rt.pageSession)
  console.log('  ' + JSON.stringify(rows.map((r) => ({ id: r.id, container: r.container, wrap: r.wrap, iframe: r.iframe }))))
  for (const r of rows) {
    const label = (cases.find((c) => c.id === r.id) || {}).label || r.id
    if (r.expect === 'info') {
      console.log(`  · ${r.id}: 容器内容宽=${r.content} wrap=${r.wrap} iframe=${r.iframe}  （信息性，不断言）`)
      continue
    }
    if (r.expect === 'collapse') {
      check(`${label}：剥离撑满声明后**确实塌到 iframe 固有宽度附近**（判据不是常量）`,
        r.wrap <= r.content - 400 && Math.abs(r.wrap - r.iframe) <= 2 && r.wrap > 250 && r.wrap < 420,
        `wrap=${r.wrap} iframe=${r.iframe} content=${r.content}`)
      continue
    }
    const want = r.expect === 'container-48' ? r.content - r.avatar - 8 : r.content
    check(`${label}：wrap 撑满（=${want}px）`, Math.abs(r.wrap - want) <= 2, `wrap=${r.wrap} want=${want}`)
    check(`${label}：iframe 与 wrap 同宽（没有第二层塌陷）`, Math.abs(r.iframe - r.wrap) <= 2, `iframe=${r.iframe} wrap=${r.wrap}`)
  }
} finally {
  rt.close()
}

// ─────────────────── 3. 真卡体检：9 份界面放进 flex 父容器 ───────────────────
console.log('\n=== 3. 真卡体检：每份界面都放进 flex 父容器量一次宽度 ===')
const CASES = docs.map((d) => ({ card: d.card, script: d.script, html: String(renderFencedHtml('```html\n' + d.body + '\n```\n')) }))
const page2 = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>card-width-cards</title>
<style>
  html,body{margin:0;background:#16181d;color:#d7dae0;font:13px/1.5 sans-serif}
  body{padding:10px}
  .col{width:940px;box-sizing:content-box;border:1px dashed #3a4048;padding:8px;margin:0 0 10px}
  .flex{display:flex;gap:8px}
  .avatar{flex:0 0 40px;width:40px;height:40px;background:#333}
  ${wrapRule}
  .muv-iframe{display:block}
</style></head><body>
${CASES.map((c, i) => `<div class="col flex" data-case="c${i}" data-card="${htmlEsc(c.card + ' / ' + c.script)}">
  <div class="avatar"></div>${c.html}
</div>`).join('\n')}
</body></html>`
const file2 = path.join(OUT, 'card-width-cards.html')
writeFileSync(file2, page2, 'utf8')

const rt2 = await openPage(EDGE, { url: 'file:///' + file2.replace(/\\/g, '/'), outDir: OUT, windowSize: '1400,3200' })
try {
  await sleep(3000)
  const rows = await evalJson(rt2.cdp, MEASURE, rt2.pageSession)
  let bad = 0
  for (const r of rows) {
    const want = r.content - r.avatar - 8
    const ok = Math.abs(r.wrap - want) <= 2 && Math.abs(r.iframe - r.wrap) <= 2
    if (!ok) bad++
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${r.id} ${String(r.id).padEnd(4)} ${JSON.stringify(r)}`)
  }
  check('全部真卡界面在 flex 父容器下都满宽（无一份塌陷）', bad === 0, bad + ' 份塌陷')
} finally {
  rt2.close()
}

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
console.log('产物: ' + file)
console.log('      ' + file2)
process.exit(fail ? 1 : 0)
