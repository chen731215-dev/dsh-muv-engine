// Verification (keep): 选项按钮改由 DOM 层渲染后，按钮还在吗？markdown 还在吗？
//
// 背景：`_decorateOne` 走的是 `body.innerHTML = html`（整条替换），而它的输入是
// `innerText` —— 已经丢掉 `**`/`##`/``` 的纯文本。所以只要这条路上做了 `<choices>`
// 的字符串替换，整条消息的 markdown 就被永久抹掉。
// 修法是不再走那条路：`muvSanitizeNode` 里新增 `muvRenderChoices()`，在 **DOM 层**
// 只把那一段 `<choices>` 文本换成按钮框。
//
// 这是**证明**，不是推断（约束 1：跳过 round-trip 后必须确认按钮仍然出现）：
// 在真 Edge 里跑**从 lib/client.js 源码提取的** muvSanitizeNode，喂一个模拟 DSH 渲染
// 结果的消息 DOM（`<strong>`/`<h2>`/`<pre><code>` + 一段含 `<choices>`、行间是 `<br>`
// 的文本），然后同时检查：按钮出现、markdown 元素仍在、`<choices>` 原文消失。
//
// 注意 `<br>` 不是装饰：DSH 把整块渲染进同一个 `<p>` 时，选项行之间正是 `<br>` /
// 布局换行 —— 而 `<br>` 自己没有任何文本，所以 DOM 层的实现必须**自己识别换行**，
// 否则 `A. 甲B. 乙` 会粘成一个选项（这条就是实测踩出来的）。
//
// Run: node verify-choices-dom.mjs
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

// 卫生层要跑的函数（都是从源码里逐字提取的真实实现）
const NEEDED = [
  'escHtmlBasic', 'muvCleanText', 'muvStripOpt', 'muvBuildChoices', 'parseChoiceOptions',
  'muvRenderOpts', 'muvStyleTavernOpts', 'muvTextWithBreaks', 'muvFindChoiceRange',
  'muvRenderChoices', 'muvSanitizeNode',
]
let code = ''
for (const n of NEEDED) {
  try { code += extractFunction(SRC, n) + '\n\n' } catch (e) {
    console.log('  FAIL 取不到函数 ' + n + ': ' + e.message); fail++
  }
}
// 那几个 var（RE_* / MUV_SAN_MARK）是闭包变量：从源码里整段抄过来一起执行。
// RE_* 在 muvCleanText 之前是连续一整块；MUV_SAN_MARK 单独在一处。
const reBlock = SRC.slice(SRC.indexOf('var RE_TOOLCALL'), SRC.indexOf('function muvCleanText'))
const markDecl = /var MUV_SAN_MARK = '[^']*'/.exec(SRC)
check('取到 RE_* 变量块', reBlock.length > 100, 'len=' + reBlock.length)
check('取到 MUV_SAN_MARK', !!markDecl, JSON.stringify(markDecl && markDecl[0]))

// 模拟 DSH 渲染结果：markdown 已经渲染成真元素；`<choices>` 是**文本节点**
// （DSH 把标签转义成文本，所以 innerText 里看得到字面的 `<choices>`）。
const MESSAGE = '<div class="_markdown_kcgor_5" id="msg">'
  + '<p>她侧过身，把 <strong>沾血的</strong> 手帕递过来。</p>'
  + '<h2>接下来</h2>'
  + '<pre><code>const a = 1;</code></pre>'
  + '<p>&lt;choices&gt;<br>A. 走过去搭话<br>B. 转身离开<br>C. 追问她的来意<br>&lt;/choices&gt;</p>'
  + '</div>'

const PROBE = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + MESSAGE +
  '<pre id="out"></pre><script>' + reBlock + '\n' + (markDecl ? markDecl[0] : '') + '\n' + code + '\n' +
  'function report(){' +
  'var msg=document.getElementById("msg");' +
  'var before=document.querySelectorAll(".muv-choice-btn").length;' +
  'var diag={hasParse:typeof parseChoiceOptions,hasBreaks:typeof muvTextWithBreaks};' +
  'try{var h=muvFindChoiceRange(msg);diag.content=h?String(h.content).slice(0,80):null}catch(e){diag.err=e.message}' +
  'muvSanitizeNode(msg);' +
  'var btns=document.querySelectorAll(".muv-choice-btn");' +
  'var texts=[],letters=[];' +
  'for(var i=0;i<btns.length;i++){' +
  'var b=btns[i];var sp=b.querySelector(".muv-choice-letter");' +
  'letters.push(sp?sp.textContent:null);' +
  'texts.push((b.lastChild&&b.lastChild.nodeValue)!==undefined?b.lastChild.nodeValue:b.textContent);}' +
  'document.getElementById("out").textContent=JSON.stringify({before:before,after:btns.length,' +
  'texts:texts,letters:letters,strong:document.querySelectorAll("strong").length,' +
  'h2:document.querySelectorAll("h2").length,pre:document.querySelectorAll("pre code").length,' +
  'rawChoices:msg.innerText.indexOf("<choices>")!==-1,diag:diag});}' +
  'window.addEventListener("load",function(){setTimeout(report,100)});' +
  '</script></body></html>'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('  SKIP 找不到 msedge.exe'); process.exit(fail ? 1 : 0) }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-choices-'))
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
  console.log('  Edge 实测: 按钮 ' + r.before + ' → ' + r.after + '，文本 ' + JSON.stringify(r.texts)
    + '，字母 ' + JSON.stringify(r.letters))
  console.log('  取到的块内容: ' + JSON.stringify(r.diag && r.diag.content))
  check('★ DOM 层渲染出了 3 个选项按钮', r.after === 3, 'after=' + r.after)
  check('选项字母标记 A/B/C 都在', Array.isArray(r.letters) && r.letters.join('') === 'ABC',
    JSON.stringify(r.letters))
  check('按钮文本正确（去掉了 A. / B. / C. 前缀）',
    r.texts.join('|') === '走过去搭话|转身离开|追问她的来意', r.texts.join('|'))
  check('★ <strong> 仍在（markdown 没被吃掉）', r.strong === 1, 'strong=' + r.strong)
  check('★ <h2> 仍在', r.h2 === 1, 'h2=' + r.h2)
  check('★ <pre><code> 仍在', r.pre === 1, 'pre=' + r.pre)
  check('★ <choices> 原文已消失（不会露给用户）', r.rawChoices === false)
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
