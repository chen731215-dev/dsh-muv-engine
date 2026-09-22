// Repro (keep): card-HTML iframes are pinned to 600px, so tall cards get cut off.
//
// Measured with a real browser (headless Edge, probe script painted inside the card
// document): ERA 状态栏 renders 894px, 主页 renders 1635px — both taller than the
// hard-coded 600px, i.e. up to 63% of the card is clipped (the 主页 "Profile." card is
// visibly cut through the middle).
//
// The fix has to stay cross-origin: the card iframe is `sandbox="allow-scripts"` with NO
// `allow-same-origin` (HANDOFF §9 — the card's own code probes `window.parent.document`
// looking for `#send_textarea`, so same-origin would make those probes live). So the
// height must arrive by `postMessage`, not by reading `contentDocument`.
//
// This script asserts the DESIRED end state, so it fails before the fix and guards it
// afterwards:
//   - every card-HTML iframe carries the measuring bootstrap;
//   - the bootstrap lands right before the last </body> (never inside a card <script>);
//   - the bootstrap text itself is safe to inline (no backtick, no `</script>` literal
//     that could terminate an inlined plugin script tag early);
//   - the parent-side handler validates the source window and clamps the value.
//
// Run: node repro-frame-height.mjs
import { clientSource, extractFunction, loadClientRenderers } from './test-client-source.mjs'

let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

const SRC = clientSource()

console.log('=== 现状：卡 HTML iframe 的高度是写死的 ===')
const fixedHeights = [...SRC.matchAll(/height:600px/g)].length
console.log('  写死 height:600px 的地方: ' + fixedHeights + '（修后只剩 cardHtmlIframe 里的默认值）')
check('存在写死高度（这就是被裁的原因，也是收不到报数时的兜底）', fixedHeights > 0)

console.log('\n=== 期望：统一构造点 + 注入测量脚本 ===')
check('存在统一的 cardHtmlIframe() 构造点', SRC.includes('function cardHtmlIframe('))
// 卡 HTML 的 srcdoc 拼接只允许出现在 cardHtmlIframe 里（其它两处已改为调用它）
const scattered = [...SRC.matchAll(/srcdoc="' \+ escAttr/g)].length
check('★ 卡 HTML iframe 只在 cardHtmlIframe() 里构造（散落处已归零）', scattered === 1,
  'srcdoc 拼接处数=' + scattered + '（应为 1 = cardHtmlIframe 自己）')
check('存在注入函数 withFrameHeightBootstrap()', SRC.includes('function withFrameHeightBootstrap('))
check('存在父页消息处理器 onMuvFrameHeightMessage()', SRC.includes('function onMuvFrameHeightMessage('))
check('存在幂等的监听安装器 ensureFrameHeightListener()', SRC.includes('function ensureFrameHeightListener('))

let R = null
try { R = loadClientRenderers() } catch (e) { console.log('  取函数失败: ' + e.message) }

// 引导脚本的文本安全性：内联进插件脚本时不能提前结束 script 标签，也不能出现反引号
// （插件客户端代码可能被 DSH 内联进 <script>，字符串里的 `</script>` 会当场截断它）。
if (!R) {
  check('能加载渲染器', false)
} else {
  const boot = R.muvFrameBootstrap()
  const decl = extractFunction(SRC, 'muvFrameBootstrap')
  check('★ 引导脚本文本里没有反引号', !boot.includes('`'), boot.slice(0, 80))
  check('★ 源码里没有裸的 </script> 字面量（用拼接避开）', !decl.includes('</script>'), decl.slice(0, 80))
  check('确实拼出了收尾标签（否则脚本不闭合）', boot.includes('</script>') && boot.includes('<script>'))
  check('用 postMessage 而不是读父页 DOM', boot.includes('postMessage'))
  check('带 load 后测量 + ResizeObserver + 定时兜底',
    boot.includes('addEventListener("load"') && boot.includes('ResizeObserver') && /setTimeout\(m,700\)/.test(boot))
  const lim = R.muvFrameHeightLimits()
  check('夹取：下限 160 / 上限远高于真卡实测（2083）且仍是防护量级',
    lim.min === 160 && lim.max >= 6000 && lim.max <= 100000, lim.min + '/' + lim.max)
}

console.log('\n=== 注入：插在最后一个 </body> 之前，且不碰卡自己的脚本 ===')
if (!R) {
  check('注入函数可用', false)
} else {
  const withBoot = R.withFrameHeightBootstrap
  const doc = '<!DOCTYPE html><html><body><p>hi</p></body></html>'
  const out = withBoot(doc)
  check('插在 </body> 之前', out.indexOf('__muvH') < out.indexOf('</body>'), out.slice(0, 60))
  const noBody = withBoot('<p>no body tag</p>')
  check('没有 </body> 时接在末尾', noBody.endsWith('script>'))
  // 注意：引导脚本自身出现两次 `__muvH`（`if(window.__muvH)return;window.__muvH=1;`），
  // 所以按 `window.__muvH=1` 计数才是"注入了几个脚本"。
  check('只注入一次', (out.match(/window\.__muvH=1/g) || []).length === 1,
    '注入次数=' + (out.match(/window\.__muvH=1/g) || []).length)
  check('重复调用是确定性的（同一输入同一输出）', withBoot(doc) === out)
  check('已含引导脚本时不再重复注入', withBoot(out) === out)
  // 卡自己的 <script> 必须逐字节不动 —— 这正是 renderMediaTags 踩过的坑
  const cardish = '<html><body><script>var s = "```"; const R = /<audio>(.*?)<\\/audio>/g;</script>'
    + '<div>x</div></body></html>'
  const injected = withBoot(cardish)
  const cardScripts = s => [...s.matchAll(/<script\b[\s\S]*?<\/script\s*>/gi)]
    .map(m => m[0]).filter(m => !m.includes('__muvH')).join('|')
  check('★ 卡自己的 <script> 内容没被改动', cardScripts(cardish) === cardScripts(injected),
    JSON.stringify(cardScripts(injected).slice(0, 90)))
  check('引导脚本插在最后一个 </body> 前（有多个 body 时取最后一个）',
    withBoot('<body>a</body>X<body>b</body>').lastIndexOf('__muvH') < out.length)
}

console.log('\n=== 父页处理器：只认自己的 iframe、夹取范围、非数字丢弃 ===')
if (!R) {
  check('处理器可用', false)
} else {
  const winA = { name: 'A' }, winB = { name: 'B' }
  const frames = [{ contentWindow: winA, style: { height: '600px' } }, { contentWindow: winB, style: { height: '600px' } }]
  const H = loadClientRenderers({ querySelectorAll: () => frames }).onMuvFrameHeightMessage

  H({ data: { __muvFrameHeight: 894 }, source: winA })
  check('来自自己 iframe 的高度被采纳（894 → 894px）', frames[0].style.height === '894px', frames[0].style.height)
  check('不会误改其它 iframe', frames[1].style.height === '600px', frames[1].style.height)

  H({ data: { __muvFrameHeight: 1635 }, source: winB })
  check('1635 → 1635px', frames[1].style.height === '1635px', frames[1].style.height)

  const before = frames.map(f => f.style.height).join(',')
  H({ data: { __muvFrameHeight: 9999 }, source: { name: 'stranger' } })
  check('★ 陌生 source 的消息被丢弃', frames.map(f => f.style.height).join(',') === before, before)

  H({ data: { __muvFrameHeight: 99999 }, source: winA })
  check('上限夹到 muvFrameHeightLimits().max', frames[0].style.height === R.muvFrameHeightLimits().max + 'px', frames[0].style.height)
  H({ data: { __muvFrameHeight: 10 }, source: winA })
  check('下限夹到 160', frames[0].style.height === '160px', frames[0].style.height)

  const keep = frames[0].style.height
  for (const bad of [{ __muvFrameHeight: 'NaN' }, { __muvFrameHeight: null }, { __muvFrameHeight: {} },
    { __muvFrameHeight: -5 }, {}, null, 'x', 42]) {
    H({ data: bad, source: winA })
  }
  check('★ 非数字 / 无用负载一律不改高度', frames[0].style.height === keep, frames[0].style.height)
  H({ data: { other: 1 }, source: winA })
  check('无关消息不误触发', frames[0].style.height === keep)
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
