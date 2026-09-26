// Verification (keep): 第三类 —— 变量块 / 推演块 / 摘要块在原生路径上的 DOM 渲染。
//
// 原生路径这些标签**一个渲染器都没有**（只有酒馆路径的 `_tavernRenderTags` 有），
// 于是模型输出里那一大坨 `<UpdateVariable>{…JSON…}</UpdateVariable>` 原样显示给用户。
// 这里在卫生 pass 里收进折叠卡（DOM 段替换，markdown 不受影响）。
//
// 真 Edge 里跑从 lib/client.js 源码逐字提取的实现，验：
//   ① `<UpdateVariable>{json}</UpdateVariable>` → `details.muv-varedit`，正文是**美化后的 JSON**；
//   ② JSON 里的 `<img onerror=…>` **不会**变成元素（textContent，不解析 HTML）；
//   ③ `<VariableThink>` / `<Abstract>` 各自成型；
//   ④ markdown（strong/h2/pre/li）全部存活；
//   ⑤ 消息里不再有裸标签文本；
//   ⑥ 幂等 + `<script>` 里的同名文本不动。
//
// Run: node verify-varblocks-dom.mjs
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
  'muvRenderIllustrations', 'muvReplaceTagBlocks', 'muvDetailsBlock', 'muvRenderVariableBlocks',
  'muvSanitizeNode',
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

// 注意两处**必须**的转义/反义（这两条都是踩出来的）：
//  - JSON 里的 `<img onerror=…>` 在探针 HTML 里要写成实体，否则浏览器先把它解析成真
//    元素、onerror 真的执行，测出来的就是"探针自己注入了脚本"，而不是被测代码；
//  - 而 `<script>` 里的那段要写**原样**的 `<Abstract>…`：`<script>` 是 raw text，
//    实体不会被解码，写成实体就测不到"跳过 script 内文本"这条守卫。
const JSONISH = '{"世界系统":{"日期":"2026-08-26"},"注入":"&lt;img src=x onerror=window.__pwned=1&gt;"}'
const MESSAGE = '<div class="_markdown_kcgor_5" id="msg">'
  + '<p>她把账本推过来，<strong>指尖</strong>点在最后一页。</p>'
  + '<h2>接下来</h2>'
  + '<pre><code>const a = 1;</code></pre>'
  + '<ul><li>一</li><li>二</li></ul>'
  + '<p>&lt;UpdateVariable&gt;' + JSONISH + '&lt;/UpdateVariable&gt;</p>'
  + '<p>&lt;VariableThink&gt;他大概会先核对日期&lt;/VariableThink&gt;</p>'
  + '<p>&lt;Abstract&gt;上一幕：她在渡口等了很久。&lt;/Abstract&gt;</p>'
  + '<script>var s = \'<Abstract>脚本里的不算</Abstract>\';</script>'
  + '</div>'

const PROBE = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + MESSAGE +
  '<pre id="out"></pre><script>' + reBlock + '\n' + (markDecl ? markDecl[0] : '') + '\n'
  + (attrsDecl ? attrsDecl[0] : '') + '\n' + code + '\n' +
  'function report(){' +
  'var msg=document.getElementById("msg");' +
  'muvSanitizeNode(msg);' +
  'var det=msg.querySelector("details.muv-varedit");' +
  'var body=det?det.querySelector("pre"):null;' +
  'var an=msg.querySelector(".muv-abstract");' +
  'document.getElementById("out").textContent=JSON.stringify({' +
  'varedit:msg.querySelectorAll("details.muv-varedit").length,' +
  'pretty:body?body.textContent.indexOf("\\n  \\"世界系统\\"")!==-1:null,' +
  'imgs:det?det.querySelectorAll("img").length:null,' +
  'pwned:typeof window.__pwned,' +
  'varthink:msg.querySelectorAll("details.muv-varthink").length,' +
  'abstract:msg.querySelectorAll(".muv-abstract").length,' +
  'abstractText:an?an.innerText.trim():null,' +
  'strong:document.querySelectorAll("strong").length,' +
  'h2:document.querySelectorAll("h2").length,' +
  'pre:document.querySelectorAll("pre code").length,' +
  'li:document.querySelectorAll("li").length,' +
  'rawTags:(msg.innerText.match(/<(UpdateVariable|VariableThink|Abstract)[>/]/g)||[]).length,' +
  'scriptKept:(msg.querySelector("script").textContent.indexOf("脚本里的不算")!==-1)&&(msg.querySelector("script").textContent.indexOf("<Abstract>")!==-1),' +  'secondPass:(function(){try{return muvRenderVariableBlocks(msg)}catch(e){return "ERR:"+e.message}})()});}' +
  'window.addEventListener("load",function(){setTimeout(report,120)});' +
  '</script></body></html>'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('  SKIP 找不到 msedge.exe'); process.exit(fail ? 1 : 0) }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-varblocks-'))
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
  check('★ <UpdateVariable> 变成折叠卡 details.muv-varedit', r.varedit === 1, String(r.varedit))
  check('★ 正文是**美化后**的 JSON（能解析就缩进）', r.pretty === true, String(r.pretty))
  check('★★ JSON 里的 <img onerror> 没有变成元素（textContent，不解析 HTML）', r.imgs === 0, String(r.imgs))
  check('★★ 页面没有被注入脚本（window.__pwned undefined）', r.pwned === 'undefined', String(r.pwned))
  check('★ <VariableThink> 变成 details.muv-varthink', r.varthink === 1, String(r.varthink))
  check('★ <Abstract> 变成 .muv-abstract 摘要条', r.abstract === 1, String(r.abstract))
  check('摘要文本正确', typeof r.abstractText === 'string' && r.abstractText.includes('渡口'), String(r.abstractText))
  check('★ markdown 全部存活（strong/h2/pre/li）',
    r.strong === 1 && r.h2 === 1 && r.pre === 1 && r.li === 2,
    JSON.stringify({ s: r.strong, h: r.h2, p: r.pre, l: r.li }))
  check('★ 消息里不再有裸标签文本', r.rawTags === 0, String(r.rawTags))
  check('★ <script> 里的同名文本没被动（代码不是标记）', r.scriptKept === true, String(r.scriptKept))
  check('★ 幂等：再跑一遍没有更多可渲染的', r.secondPass === 0, String(r.secondPass))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
