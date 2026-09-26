// Verification (keep): 『📅…|⏰…|📍…』表头改成 DOM 层折叠后，markdown 还在吗？表头还对吗？
//
// 第二类迁移。折叠本身是**纯文本变换**（normalizeStatusHeader：括号内换行→空格、
// 归一化 ` | `），不需要 `body.innerHTML = html` —— 而那条路的输入是 `innerText`，
// 会把整条消息的 markdown 抹掉。折完之后 `normalizeStatusHeader(innerText) === innerText`，
// beautifyMuv 那一档就原样返回、不触发整条替换。
//
// 这里验三件事（真 Edge，跑从 lib/client.js 源码逐字提取的实现）：
//   ① 跨行的『』表头被折成一行；
//   ② <strong>/<h2>/<pre><code> 仍在（markdown 没被吃掉）；
//   ③ 折完之后 normalizeStatusHeader(innerText) 是恒等 ⇒ 证明不会再走整条替换那条路；
//   ④ 再跑一遍是幂等的（不会越折越多/重复插入）。
//
// Run: node verify-header-fold.mjs
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

// normalizeStatusHeader 与卫生层都在模块里；摘出需要的实现。
const NEEDED = ['normalizeStatusHeader', 'muvTextWithBreaks', 'muvFindChoiceRange', 'locateInWalked',
  'muvFoldStatusHeader', 'muvSanitizeNode', 'muvCleanText', 'muvRenderChoices',
  'muvBuildChoices', 'parseChoiceOptions', 'muvRenderOpts', 'muvStyleTavernOpts', 'muvStripOpt', 'escHtmlBasic']
let code = ''
for (const n of NEEDED) {
  try { code += extractFunction(SRC, n) + '\n\n' } catch (e) {
    console.log('  FAIL 取不到函数 ' + n + ': ' + e.message); fail++
  }
}
const reBlock = SRC.slice(SRC.indexOf('var RE_TOOLCALL'), SRC.indexOf('function muvCleanText'))
const markDecl = /var MUV_SAN_MARK = '[^']*'/.exec(SRC)

// 模拟 DSH 渲染结果：表头被模型拆成多行（DSH 渲染成若干行），中间夹着 markdown 元素。
const MESSAGE = '<div class="_markdown_kcgor_5" id="msg">'
  + '<p>『📅 05月14日 星期三 |</p>'
  + '<p>⏰ 21:14 |</p>'
  + '<p>📍 暮川市·旧片区·森田宅门口』</p>'
  + '<p>她抬起眼，<strong>指尖</strong>还沾着血。</p>'
  + '<h2>接下来</h2>'
  + '<pre><code>const a = 1;</code></pre>'
  + '</div>'

const PROBE = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + MESSAGE +
  '<pre id="out"></pre><script>' + reBlock + '\n' + (markDecl ? markDecl[0] : '') + '\n' + code + '\n' +
  'function report(){' +
  'var msg=document.getElementById("msg");' +
  'var beforeText=msg.innerText;' +
  'var beforeIdem=(normalizeStatusHeader(beforeText)===beforeText);' +
  'muvSanitizeNode(msg);' +
  'var afterText=msg.innerText;' +
  'var idem=(normalizeStatusHeader(afterText)===afterText);' +
  'var twice=afterText;' +
  'msg.removeAttribute("data-muv-sanitized");' +
  'muvSanitizeNode(msg);' +
  'var afterTwice=msg.innerText;' +
  'document.getElementById("out").textContent=JSON.stringify({' +
  'beforeIdem:beforeIdem,afterIdem:idem,' +
  'headerFolded:afterText.indexOf("📅 05月14日 星期三 | ⏰ 21:14 | 📍 暮川市·旧片区·森田宅门口")!==-1,' +
  'singleLine:afterText.split("\\n")[0],' +
  'strong:document.querySelectorAll("strong").length,' +
  'h2:document.querySelectorAll("h2").length,' +
  'pre:document.querySelectorAll("pre code").length,' +
  'idempotent:twice===afterTwice,' +
  'bracketLeft:(afterText.match(/『/g)||[]).length});}' +
  'window.addEventListener("load",function(){setTimeout(report,120)});' +
  '</script></body></html>'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p))
if (!EDGE) { console.log('  SKIP 找不到 msedge.exe'); process.exit(fail ? 1 : 0) }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-header-'))
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
  console.log('  折叠前 normalizeStatusHeader 是恒等: ' + r.beforeIdem + '（应为 false = 需要折）')
  console.log('  折叠后第一行: ' + JSON.stringify(r.singleLine))
  check('★ 跨行表头被折成一行', r.headerFolded === true, JSON.stringify(r.singleLine))
  check('★ 折叠后 normalizeStatusHeader 变成恒等（⇒ beautifyMuv 原样返回、不做整条替换）',
    r.afterIdem === true, 'afterIdem=' + r.afterIdem)
  check('★ <strong> 仍在（markdown 没被吃掉）', r.strong === 1, 'strong=' + r.strong)
  check('★ <h2> 仍在', r.h2 === 1, 'h2=' + r.h2)
  check('★ <pre><code> 仍在', r.pre === 1, 'pre=' + r.pre)
  check('★ 幂等：再跑一遍不再变化', r.idempotent === true)
  check('『 括号仍保留（只折行，不删装饰）', r.bracketLeft === 1, 'count=' + r.bracketLeft)
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
