// Verification (keep): 第三类之二/之三 —— 展示类标签 + 内部块，在原生路径的 DOM 渲染。
//
// 原生路径这些标签**一个渲染器都没有**（只有酒馆路径的 `_tavernRenderTags` 有）：
// 展示类原样显示成裸标签文本；而 `<rule_check>` / `<user_setting>` / `<system_prompt>` /
// `<status_current_variable>` 这类**内部块**更是把提示词工程外壳直接泄漏给用户 ——
// 后者比标签噪音严重。两者都由 `MUV_TAG_RULES` 表驱动（一处定义，避免集合漂移）。
//
// 真 Edge 里跑从 lib/client.js 源码逐字提取的实现，验：
//   ① 展示类标签各自成型（speech / dialogue / char / 引用 / location / pose / JSONPatch / 背包 / sep）；
//   ② 内部块整段消失；
//   ③ 内容一律 textContent（`<speech><img onerror=…></speech>` 不产生元素、不执行）；
//   ④ markdown 存活、无裸标签残留、幂等、`<script>` 内文本不动。
//
// Run: node verify-tags-dom.mjs
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
  'normalizeStatusHeader', 'muvFoldStatusHeader', 'muvRenderChoices', 'replaceRangeWithNode',
  'mediaTagDisposition', 'muvCloneMediaElement', 'muvBuildMediaElement', 'muvRenderMediaTags',
  'muvRenderIllustrations', 'muvReplaceTagBlocks', 'muvDetailsBlock', 'muvSimpleBlock',
  'muvRenderVariableBlocks', 'muvRenderImages', 'muvRenderTagRules', 'muvSanitizeNode',
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
const rulesDecl = /var MUV_TAG_RULES = \[[\s\S]*?\n      \]/.exec(SRC)
check('取到 MUV_TAG_RULES 表', !!rulesDecl)

const MESSAGE = '<div class="_markdown_kcgor_5" id="msg">'
  + '<p>她把杯子推过来，<strong>指尖</strong>停在杯沿。</p>'
  + '<h2>接下来</h2>'
  + '<pre><code>const a = 1;</code></pre>'
  + '<ul><li>一</li><li>二</li></ul>'
  + '<p>&lt;speech&gt;「别急着走。」&lt;/speech&gt;</p>'
  + '<p>&lt;dialogue&gt;那我先告辞了。&lt;/dialogue&gt;</p>'
  + '<p>&lt;char&gt;安柏&lt;/char&gt;</p>'
  + '<p>&lt;引用&gt;旧约第一条&lt;/引用&gt;</p>'
  + '<p>&lt;location&gt;遗迹入口&lt;/location&gt;</p>'
  + '<p>&lt;pose&gt;半跪着&lt;/pose&gt;</p>'
  + '<p>&lt;JSONPatch&gt;[{"op":"replace","path":"/世界系统/日期","value":"08-26"}]&lt;/JSONPatch&gt;</p>'
  + '<p>&lt;背包&gt;火把 ×2&lt;/背包&gt;</p>'
  + '<p>&lt;sep/&gt;</p>'
  + '<p>&lt;rule_check&gt;内部自检：不要输出本段&lt;/rule_check&gt;</p>'
  + '<p>&lt;user_setting&gt;用户设定：偏好简短&lt;/user_setting&gt;</p>'
  + '<p>&lt;system_prompt&gt;系统提示：保持角色&lt;/system_prompt&gt;</p>'
  + '<p>&lt;status_current_variable&gt;{&quot;hp&quot;:10}&lt;/status_current_variable&gt;</p>'
  + '<p>&lt;Analysis&gt;分析：他应该先确认时间&lt;/Analysis&gt;</p>'
  + '<p>&lt;speech&gt;&lt;img src=x onerror=window.__pwned=1&gt;&lt;/speech&gt;</p>'
  + '<p>&lt;img src="https://example.invalid/pic.png" alt="插图"&gt;</p>'
  + '<script>var s = \'<rule_check>脚本里的不算</rule_check>\';</script>'
  + '</div>'

const PROBE = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + MESSAGE +
  '<pre id="out"></pre><script>' + reBlock + '\n' + (markDecl ? markDecl[0] : '') + '\n'
  + (attrsDecl ? attrsDecl[0] : '') + '\n' + (rulesDecl ? rulesDecl[0] : '') + '\n' + code + '\n' +
  'function report(){' +
  'var msg=document.getElementById("msg");' +
  'muvSanitizeNode(msg);' +
  'document.getElementById("out").textContent=JSON.stringify({' +
  'speech:msg.querySelectorAll(".muv-speech").length,' +
  'dialogue:msg.querySelectorAll(".muv-dialogue").length,' +
  'charName:msg.querySelectorAll("b.muv-char-name").length,' +
  'quote:msg.querySelectorAll("blockquote.muv-quote").length,' +
  'location:msg.querySelectorAll(".muv-location").length,' +
  'locationText:(function(){var e=msg.querySelector(".muv-location");return e?e.textContent:null})(),' +
  'pose:msg.querySelectorAll(".muv-pose").length,' +
  'jsonpatch:msg.querySelectorAll("details.muv-jsonpatch").length,' +
  'inventory:msg.querySelectorAll("details.muv-inventory").length,' +
  'sep:msg.querySelectorAll("hr.muv-sep").length,' +
  'img:msg.querySelectorAll("img.muv-img").length,' +
  'hiddenLeft:msg.innerText.indexOf("内部自检")!==-1||msg.innerText.indexOf("用户设定")!==-1||msg.innerText.indexOf("系统提示")!==-1||msg.innerText.indexOf("分析：")!==-1||msg.innerText.indexOf("hp")!==-1,' +
  'imgsInsideSpeech:msg.querySelectorAll(".muv-speech img").length,' +
  'pwned:typeof window.__pwned,' +
  'strong:document.querySelectorAll("strong").length,' +
  'h2:document.querySelectorAll("h2").length,' +
  'pre:document.querySelectorAll("pre code").length,' +
  'li:document.querySelectorAll("li").length,' +
  'rawTags:(msg.innerText.match(/<(speech|dialogue|char|引用|location|pose|JSONPatch|背包|sep|rule_check|user_setting|system_prompt|status_current_variable|Analysis)[ >\/]/g)||[]).length,' +
  'scriptKept:msg.querySelector("script").textContent.indexOf("脚本里的不算")!==-1&&msg.querySelector("script").textContent.indexOf("<rule_check>")!==-1,' +
  'secondPass:(function(){try{return muvRenderTagRules(msg)}catch(e){return "ERR:"+e.message}})()});}' +
  'window.addEventListener("load",function(){setTimeout(report,150)});' +
  '</script></body></html>'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('  SKIP 找不到 msedge.exe'); process.exit(fail ? 1 : 0) }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-tags-'))
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
  check('speech / dialogue 成型', r.speech === 1 && r.dialogue === 1, JSON.stringify({ s: r.speech, d: r.dialogue }))
  check('char → b.muv-char-name', r.charName === 1, String(r.charName))
  check('引用 → blockquote.muv-quote', r.quote === 1, String(r.quote))
  check('★ location → .muv-location（带 📍 前缀）',
    r.location === 1 && String(r.locationText).includes('📍') && String(r.locationText).includes('遗迹入口'),
    JSON.stringify({ n: r.location, t: r.locationText }))
  check('pose → span.muv-pose', r.pose === 1, String(r.pose))
  check('★ JSONPatch → details.muv-jsonpatch', r.jsonpatch === 1, String(r.jsonpatch))
  check('背包 → details.muv-inventory', r.inventory === 1, String(r.inventory))
  check('sep → hr.muv-sep', r.sep === 1, String(r.sep))
  check('★ <img src> → img.muv-img', r.img === 1, String(r.img))
  check('★★ 内部块整段消失（rule_check / user_setting / system_prompt / status_current_variable / Analysis）',
    r.hiddenLeft === false, String(r.hiddenLeft))
  check('★★ speech 里的 <img onerror> 没有变成元素', r.imgsInsideSpeech === 0, String(r.imgsInsideSpeech))
  check('★★ 页面没有被注入脚本（window.__pwned undefined）', r.pwned === 'undefined', String(r.pwned))
  check('★ markdown 全部存活（strong/h2/pre/li）',
    r.strong === 1 && r.h2 === 1 && r.pre === 1 && r.li === 2,
    JSON.stringify({ s: r.strong, h: r.h2, p: r.pre, l: r.li }))
  check('★ 消息里不再有裸标签文本', r.rawTags === 0, String(r.rawTags))
  check('★ <script> 里的同名文本没被动（代码不是标记）', r.scriptKept === true, String(r.scriptKept))
  check('★ 幂等：再跑一遍没有更多可处理的', r.secondPass === 0, String(r.secondPass))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
