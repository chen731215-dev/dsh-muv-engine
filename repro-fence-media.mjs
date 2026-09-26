// Repro (keep): two latent bugs in the client-side string renderers.
//
//   ① renderFencedHtml — the fenced-HTML matcher is not fence-aware:
//      a ``` inside the document truncates the iframe and leaves the rest of the
//      document as raw text in the message; a 4-backtick fence (``` ````html ````)
//      is not handled at all.
//   ② renderMediaTags — a self-closing <video src… /> never gets controls/preload,
//      and an attribute containing `>` cuts the tag short, so the src is missed
//      and the media is downgraded to a text placeholder.
//
// The two functions live inside the client module-loader factory (not importable),
// so they are lifted out of the shipped source and evaluated as-is — the test then
// exercises exactly what ships, not a copy. The lifter is shared with the other
// repro scripts (test-client-source.mjs).
//
// Run: node repro-fence-media.mjs
import { loadClientRenderers } from './test-client-source.mjs'

const { renderFencedHtml, renderMediaTags } = loadClientRenderers()

let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

// A raw `</html>` / `</script>` in the output can only come from *unescaped*
// leftover HTML: inside srcdoc escAttr turns them into `&lt;/html&gt;`.
const leaksRawHtml = s => /<\/html>|<\/script>|<\/body>/.test(s)
// Everything the reader actually sees — the message with the rendered iframes cut out.
// Backticks *inside* a rendered document are the document's own content (escaped
// into srcdoc) and are fine; a backtick left in the visible text is a stray fence.
const visibleText = s => s.replace(/<div class="muv-statusbar-wrap">[\s\S]*?<\/div>/g, '[iframe]')

console.log('=== ① renderFencedHtml 围栏匹配 ===\n')

// Plain, well-behaved fence — must keep working.
const plain = '前言\n\n```html\n<!DOCTYPE html>\n<html><body><p>hi</p></body></html>\n```\n\n后记'
const rp = renderFencedHtml(plain)
check('[基准] 普通围栏仍是 1 个 iframe', (rp.match(/muv-iframe/g) || []).length === 1)
check('[基准] 普通围栏没有裸 HTML 残留', !leaksRawHtml(rp))
check('[基准] 前言后记还在', rp.includes('前言') && rp.includes('后记'))

// The trigger from the report: a ``` inside the document (JS string / <code> example).
const nested = '前言\n\n```html\n<!DOCTYPE html>\n<html><body>\n<p>a</p>\n<script>var s = "```";</script>\n<p>b</p>\n</body></html>\n```\n\n后记'
const rn = renderFencedHtml(nested)
check('[①a] 内嵌 ``` 时仍是 1 个 iframe', (rn.match(/muv-iframe/g) || []).length === 1,
  'iframe 数=' + (rn.match(/muv-iframe/g) || []).length)
check('[①a] 内嵌 ``` 时没有半截 HTML 裸奔', !leaksRawHtml(rn),
  '残留片段: ' + JSON.stringify(rn.replace(/^[\s\S]*?srcdoc="/, '').slice(0, 160)))
check('[①a] 内嵌 ``` 时后半段没被留在消息里', rn.includes('<p>b</p>') || !rn.includes('<p>a</p>'),
  'iframe 之外的可见文本: ' + JSON.stringify(rn.replace(/<div class="muv-statusbar-wrap">[\s\S]*?<\/div>/, '[iframe]')))

// A 4-backtick fence — the correct markdown way to embed a ``` in the content.
const four = '前言\n\n````html\n<!DOCTYPE html>\n<html><body>\n<script>var s = "```";</script>\n<p>b</p>\n</body></html>\n````\n\n后记'
const rf = renderFencedHtml(four)
check('[①b] 四反引号围栏渲染成 1 个 iframe', (rf.match(/muv-iframe/g) || []).length === 1,
  'iframe 数=' + (rf.match(/muv-iframe/g) || []).length)
check('[①b] 四反引号围栏没有裸 HTML 残留', !leaksRawHtml(rf),
  '残留: ' + JSON.stringify(rf.slice(0, 200)))
check('[①b] 四反引号围栏没有多出反引号', !visibleText(rn).includes('`') && !visibleText(rf).includes('`'),
  '可见反引号: ' + JSON.stringify((visibleText(rf).match(/.{0,12}`.{0,12}/g) || []).slice(0, 3)) + ' / ' +
  JSON.stringify(visibleText(rf)))

// Non-document fences must stay untouched (误伤代码块比不渲染更糟).
const jsFence = '说明：\n\n```js\nvar s = "```";\nconsole.log(1)\n```\n'
check('[①c] 普通 js 代码块原样不动', renderFencedHtml(jsFence) === jsFence)

console.log('\n=== ② renderMediaTags ===\n')

const selfClosed = '<video src="a.mp4" />'
const rsc = renderMediaTags(selfClosed)
check('[②a] 自闭合 <video src/> 加上 controls', /\bcontrols\b/.test(rsc), rsc)
check('[②a] 自闭合 <video src/> 加上 preload', /preload="metadata"/.test(rsc), rsc)
check('[②a] 自闭合 <video src/> 保留 src', /src="a\.mp4"/.test(rsc), rsc)

const quotedGt = '<video data-x="a>b" src="m.mp4"></video>'
const rq = renderMediaTags(quotedGt)
check('[②b] 属性含 > 时不吞掉 src', /src="m\.mp4"/.test(rq), rq)
check('[②b] 属性含 > 时不降级成文字占位', !rq.includes('muv-audio') && !rq.includes('🎬'), rq)
check('[②b] 属性含 > 时仍是 <video> 元素', /<video\b/.test(rq), rq)

const audioSelfClosed = "<audio src='x.mp3' />"
const ras = renderMediaTags(audioSelfClosed)
check('[②c] 自闭合 <audio src/> 加上 controls', /\bcontrols\b/.test(ras), ras)

const plainVideo = '<video src="x.mp4" controls>'
check('[②d] 普通带 src 的 video 保持可播放', /<video\b/.test(renderMediaTags(plainVideo)) && /src="x\.mp4"/.test(renderMediaTags(plainVideo)),
  renderMediaTags(plainVideo))
check('[②d] 不出现重复的 controls', (renderMediaTags(plainVideo).match(/\bcontrols\b/g) || []).length === 1,
  renderMediaTags(plainVideo))

const bareAudio = '<audio>轻快的BGM</audio>'
check('[②e] 无 src 的 audio 仍降级成占位', renderMediaTags(bareAudio).includes('🎵') && renderMediaTags(bareAudio).includes('轻快的BGM'),
  renderMediaTags(bareAudio))
check('[②f] 无 src 的 video 用视频占位 class（不是 muv-audio）',
  !renderMediaTags('<video>一段视频提示</video>').includes('class="muv-audio"'),
  renderMediaTags('<video>一段视频提示</video>'))

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败（这就是要修的东西）' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
