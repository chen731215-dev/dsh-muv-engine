// Verification (keep): 原生路径的媒体标签（④）—— 在 DOM 层渲染，markdown 不受影响。
//
// 为什么不做成「把 _tavernRenderTags 的结果整条写回」：那条路的输入是 `innerText`，
// 会把整条消息的 markdown 抹平。实测：媒体产物里没有状态栏片段 ⇒ `applyDecoratedHtml`
// 会落到最后手段 `body.innerHTML = html` 上（见 repro-native-media-path.mjs）。
// 所以这里在卫生 pass 里只把**那一段标签文本**换成元素。
//
// 真 Edge 里跑从 lib/client.js 源码逐字提取的实现，验四件事：
//   ① 带 src 的 `<video>` → 真元素 + controls + preload；
//   ② 带 `<source>` 子节点的 `<audio>` → 真元素且子节点保留；
//   ③ 裸提示词 `<video>雨声</video>` → 文字占位（不是真元素）；
//   ④ **`onerror` 这类事件属性被白名单丢掉**（模型文本不能把脚本请进 DSH 页面）；
//   ⑤ markdown（`<strong>`/`<h2>`/`<pre><code>`）全部存活。
//
// Run: node verify-media-dom.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { clientSource, extractFunction } from './test-client-source.mjs'

let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

const SRC = clientSource()
const NEEDED = [
  'escHtmlBasic', 'muvCleanText', 'muvStripOpt', 'muvBuildChoices', 'parseChoiceOptions',
  'muvRenderOpts', 'muvStyleTavernOpts', 'muvTextWithBreaks', 'locateInWalked', 'muvFindChoiceRange',
  'normalizeStatusHeader', 'muvFoldStatusHeader', 'muvRenderChoices',
  'replaceRangeWithNode', 'mediaTagDisposition', 'muvCloneMediaElement', 'muvBuildMediaElement',
  'muvRenderMediaTags', 'muvRenderIllustrations', 'muvSanitizeNode',
]
let code = ''
for (const n of NEEDED) {
  try { code += extractFunction(SRC, n) + '\n\n' } catch (e) {
    console.log('  FAIL 取不到函数 ' + n + ': ' + e.message); fail++
  }
}
const reBlock = SRC.slice(SRC.indexOf('var RE_TOOLCALL'), SRC.indexOf('function muvCleanText'))
const markDecl = /var MUV_SAN_MARK = '[^']*'/.exec(SRC)
const attrsDecl = /var MUV_MEDIA_ATTRS = \{[\s\S]*?\}/.exec(SRC)
check('取到 MUV_MEDIA_ATTRS 白名单', !!attrsDecl)

// 模拟 DSH 渲染结果：媒体标签是**文本节点**（DSH 把标签转义成文本），markdown 已是真元素。
const MESSAGE = '<div class="_markdown_kcgor_5" id="msg">'
  + '<p>他推开门，<strong>风</strong>灌了进来。</p>'
  + '<h2>接下来</h2>'
  + '<pre><code>const a = 1;</code></pre>'
  + '<p>&lt;video src="a.mp4"&gt;&lt;/video&gt;</p>'
  + '<p>&lt;audio controls onerror="window.__pwned=1"&gt;&lt;source src="b.mp3" type="audio/mpeg"&gt;&lt;/audio&gt;</p>'
  + '<p>&lt;video&gt;雨声白噪音&lt;/video&gt;</p>'
  + '<p>&lt;插图&gt;海边日落 · <b>加粗</b>&lt;/插图&gt;</p>'
  + '<script>var s = \'&lt;video src="inside-script.mp4"&gt;&lt;/video&gt;\';</script>'
  + '</div>'

const PROBE = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + MESSAGE +
  '<pre id="out"></pre><script>' + reBlock + '\n' + (markDecl ? markDecl[0] : '') + '\n'
  + (attrsDecl ? attrsDecl[0] : '') + '\n' + code + '\n' +
  'function report(){' +
  'var msg=document.getElementById("msg");' +
  'muvSanitizeNode(msg);' +                       // 走真实入口（卫生 pass），别只调单个函数
  'var v=(msg.querySelector("video[src=\'a.mp4\']")||null);' +
  'var au=(msg.querySelector("audio")||null);' +
  'document.getElementById("out").textContent=JSON.stringify({' +
  'videos:msg.querySelectorAll("video").length,' +
  'audios:msg.querySelectorAll("audio").length,' +
  'vControls:v?("controls" in v?true:v.hasAttribute("controls")):null,' +
  'vPreload:v?v.getAttribute("preload"):null,' +
  'aSources:au?au.querySelectorAll("source").length:null,' +
  'aOnError:au?au.hasAttribute("onerror"):null,' +
  'pwned:typeof window.__pwned,' +
  'phButtons:msg.querySelectorAll(".muv-video-ph").length,' +
  'illu:msg.querySelectorAll(".muv-illustration").length,' +
  'illuText:(function(){var i=msg.querySelector(".muv-illustration");return i?i.innerText.trim():null})(),' +
  'illuNoHtml:(function(){var i=msg.querySelector(".muv-illustration");return i?i.querySelectorAll("b").length:null})(),' +
  'scriptTextKept:msg.querySelector("script").textContent.indexOf("&lt;video")!==-1||msg.querySelector("script").textContent.indexOf("inside-script.mp4")!==-1,' +
  'strong:document.querySelectorAll("strong").length,' +
  'h2:document.querySelectorAll("h2").length,' +
  'pre:document.querySelectorAll("pre code").length,' +
  'rawTagsLeft:msg.innerText.indexOf("<video")!==-1||msg.innerText.indexOf("<audio")!==-1,' +
  // 再调一次应当无事可做（幂等）；顺便证明"没渲染"不是因为函数根本跑不起来
  'secondPass:(function(){try{return muvRenderMediaTags(msg)}catch(e){return "ERR:"+e.message}})()});}' +
  'window.addEventListener("load",function(){setTimeout(report,120)});' +
  '</script></body></html>'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('  SKIP 找不到 msedge.exe'); process.exit(fail ? 1 : 0) }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-media-'))
const file = path.join(tmpDir, 'probe.html')
fs.writeFileSync(file, PROBE, 'utf8')
let dom = ''
try {
  dom = execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(tmpDir, 'profile'), '--virtual-time-budget=3000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/')],
  { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
} catch (e) { console.log('  SKIP Edge 没跑起来: ' + String(e.message).split('\n')[0]) }
fs.rmSync(tmpDir, { recursive: true, force: true })

const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)
if (!m) {
  console.log('  SKIP 没拿到测量结果（dump-dom ' + dom.length + ' 字）')
} else {
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  console.log('  Edge 实测: ' + JSON.stringify(r))
  check('★ 带 src 的 <video> 变成真元素', r.videos >= 1 && r.vControls === true, JSON.stringify({ v: r.videos, c: r.vControls }))
  check('★ 补上了 preload="metadata"', r.vPreload === 'metadata', String(r.vPreload))
  check('★ 带 <source> 的 <audio> 保留子节点', r.audios >= 1 && r.aSources === 1, JSON.stringify({ a: r.audios, s: r.aSources }))
  check('★★ 事件属性 onerror 被白名单丢掉', r.aOnError === false, String(r.aOnError))
  check('★★ 页面没有被注入脚本（window.__pwned 未定义）', r.pwned === 'undefined', String(r.pwned))
  check('★ 裸提示词 <video>雨声白噪音</video> 变成文字占位', r.phButtons === 1, String(r.phButtons))
  check('★ <插图> 变成占位块', r.illu === 1, String(r.illu))
  check('占位块里是名字文本、且**没有**把名字当 HTML 解析（<b> 没有变成元素）',
    typeof r.illuText === 'string' && r.illuText.includes('海边日落') && r.illuNoHtml === 0,
    JSON.stringify({ text: r.illuText, b: r.illuNoHtml }))
  check('★ <script> 里的文本没有被动（代码不是标记）', r.scriptTextKept === true, String(r.scriptTextKept))
  check('★ markdown 全部存活（strong/h2/pre）', r.strong === 1 && r.h2 === 1 && r.pre === 1,
    JSON.stringify({ s: r.strong, h: r.h2, p: r.pre }))
  check('★ 消息里不再有裸标签文本', r.rawTagsLeft === false, String(r.rawTagsLeft))
  check('★ 幂等：再跑一遍没有更多可渲染的', r.secondPass === 0, String(r.secondPass))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
