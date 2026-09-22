// **内联泄漏探针** —— 真实卡 `_足控天堂2` 的整页文档到底进了 iframe 还是被内联进宿主？
//
// 背景（用户实测）：
//   1. 卡的工具栏 `A-`/`A+`/☀ 出现在**整个 DSH 窗口右上角**并且一直盖着；
//   2. 消息中间一大段 HTML 没渲染、全是裸文本；
//   3. **每个会话**都变成「足控天堂」的界面 ⇒ 卡的 CSS 泄漏到宿主全局。
//
// 判据（都在**宿主页**上量，不量产物字符串）：
//   · muvIframes      本消息里真的有 `<iframe class="muv-iframe">`
//   · styleSignHits   宿主页 `<style>` 里出现卡文档特征（`--bg` / `#app` / `themeBtn` …）
//   · hostFixed       宿主页里非 iframe 的 `position:fixed` 元素（卡的固定工具栏）
//   · nakedLen        宿主里那段「裸 HTML 文本」的长度
//
// 为什么必须真浏览器：`_decorateOne` 读的是 `body.innerText`、写回走 `innerHTML`，
// 行为只由真实 DOM 语义决定；字符串断言测不到。
//
// 实现注意：本文件用 **token 替换**而不是嵌套模板字符串来塞大文本。
// 试过直接插值：`lib/client.js` 与真卡文档里都有 `${`（模板字符串插值语法）和 ```（反引号），
// 会把外层模板字符串当场截断 —— 报的是 `ReferenceError: DOCTYPE is not defined`，
// 那个错**指不到真正的原因**，所以我改用占位符。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-realcard-inline.mjs
// 对照：$env:MUV_CLIENT_SRC="<另一份 client.js>" 指向任意版本

import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_PATH = process.env.MUV_CLIENT_SRC || path.join(__dirname, 'lib', 'client.js')
const CLIENT = readFileSync(SRC_PATH, 'utf8')
const OUT = process.env.MUV_OUT || path.join(os.tmpdir(), 'muv-realcard-inline')
mkdirSync(OUT, { recursive: true })

const CARD_PNG = process.env.MUV_CARD_PNG ||
  'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'

// ─────────────────── 1. 取真卡的整页文档，按「服务端正则产物」拼出真实消息 ───────────────────
const card = readPngCard(CARD_PNG)
const scripts = regexScriptsOf(card)
const OPEN_FENCE = /^[ \t]{0,3}(`{3,})([^\n`]*)\r?\n/
const FENCE = '\u0060\u0060\u0060'

const docs = []
for (const s of scripts) {
  const rep = String(s.replaceString || '')
  const m = OPEN_FENCE.exec(rep)
  if (!m) continue
  const body = rep.slice(m.index + m[0].length).replace(/^\s+/, '')
  if (!/^<!doctype|^<html/i.test(body)) continue
  docs.push({ name: String(s.scriptName || ''), info: m[2] || '', body, len: body.length })
}
if (docs.length < 3) throw new Error('真卡里只读到 ' + docs.length + ' 份整页文档（应 >= 3）—— 卡片路径或解析器变了')

console.log('=== 真卡整页文档 ===')
for (const d of docs) {
  console.log(`  ${d.name}  正文 ${d.len} 字符  开头40=${JSON.stringify(d.body.slice(0, 40))}  围栏=是`)
}

const beauty = docs.find((d) => d.name.indexOf('正文美化') === 0) || docs[0]
const MESSAGE_TEXT = ['她抬起脚，趾尖在灯下泛着薄薄的光。', '', FENCE + beauty.info, beauty.body.replace(/\n$/, ''), FENCE].join('\n')

// ─────────────────── 2. 夹具页（token 替换，见文件头注释） ───────────────────
const HTML_ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// DSH 的 markdown 把围栏变成 <pre><code>；innerText 会把它读回**原文**（含围栏行）。
//
// ★ 必须带上一个**状态类标记**（这里用 `<StatusPlaceHolderImpl/>`，第二类消息的真实形状）。
//   原因：`beautifyMuv` 在 L973 有个 marker 闸门 —— 文本里一个标记都没有时它**原样返回**，
//   整条装饰链根本不动（`html === raw` ⇒ 调用方不做任何替换）。
//   第一版夹具只放了正文 + 围栏，实测结果就是「装饰前后完全一致」——看起来像"修复无效"，
//   其实是**什么都没被触发**。判据必须能区分「没泄漏」和「没跑」，否则又是一个假绿。
const FENCED_HTML = '<p>她抬起脚，趾尖在灯下泛着薄薄的光。</p>\n<pre><code>'
  + HTML_ESC(FENCE + beauty.info + '\n' + beauty.body) + '</code></pre>\n<p>&lt;StatusPlaceHolderImpl/&gt;</p>'

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="zh"><head><meta charset="utf-8"><title>realcard-inline</title>',
  '<style>',
  '  html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:14px/1.7 "Microsoft YaHei",system-ui,sans-serif}',
  '  body{padding:14px}.wrap{max-width:760px;margin:0 auto}',
  '</style></head>',
  '<body>',
  '<div class="wrap">',
  '  <div id="msg_X" class="_markdown_abc123_7">@_MSG_@</div>',
  '</div>',
  '<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };<\/script>',
  '<script>@_CLIENT_@<\/script>',
  '<script>',
  '/*__PROBE__*/',
  '<\/script>',
  '</body></html>',
].join('\n')

const PROBE = [
  '(function () {',
  '  var notes = [];',
  '  window.addEventListener("error", function (e) { notes.push("onerror:" + e.message) });',
  // 卡文档的特征串：宿主页里出现这些 = 卡的 CSS 泄漏进来了
  '  var CARD_SIGNS = ["--bg", "#app", "themeBtn", "processDialogue", "\u8db3\u63a7\u5929\u5802"];',
  '  function snapshot(tag) {',
  '    var m = document.getElementById("msg_X");',
  '    var hostEls = document.querySelectorAll("body *");',
  '    var html = document.documentElement.outerHTML;',
  '    var styles = "", st = document.querySelectorAll("style");',
  '    for (var i = 0; i < st.length; i++) styles += st[i].textContent || "";',
  '    var frames = document.querySelectorAll("iframe.muv-iframe");',
  '    var anyFrames = document.querySelectorAll("iframe");',
  '    var fixed = 0, fixedDump = [];',
  '    for (var j = 0; j < hostEls.length; j++) {',
  '      var el = hostEls[j];',
  '      if (el.tagName === "IFRAME") continue;',
  '      var cs; try { cs = getComputedStyle(el) } catch (_) { continue }',
  '      if (cs.position === "fixed" && cs.display !== "none") {',
  '        fixed++;',
  '        if (fixedDump.length < 4) fixedDump.push(el.tagName + "." + String(el.className || "").slice(0, 34));',
  '      }',
  '    }',
  '    var txt = m ? (m.innerText || "") : "";',
  // ★ 量「裸文本」必须**排除 <script>/<style>**：夹具把整份 `lib/client.js` 内联进了页面，
  //   而 headless 下 `innerText` 会把 `<script>` 的源码文本也算进来（本文件的函数注释里就有
  //   「`### 正文`」这种字面量）。不排除的话，判据量到的是**测试自己内联进去的源码**，
  //   报出来像「消息里还有 3 万字符裸 HTML」——那是假红，和「假绿」一样有害。
  '    var txtClean = "";',
  '    if (m) {',
  '      var w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT, {',
  '        acceptNode: function (node) {',
  '          var p = node.parentNode;',
  '          while (p && p !== m) {',
  '            if (p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.tagName === "IFRAME") return NodeFilter.FILTER_REJECT;',
  '            p = p.parentNode;',
  '          }',
  '          return NodeFilter.FILTER_ACCEPT;',
  '        }',
  '      });',
  '      var nn; while ((nn = w.nextNode())) txtClean += (nn.nodeValue || "") + "\\n";',
  '    }',
  '    var naked = 0;',
  '    var kl = txtClean.toLowerCase();',
  '    var k = kl.indexOf("<!doctype");',
  '    if (k < 0) k = kl.indexOf("<html");',
  '    if (k >= 0) naked = txtClean.length - k;',
  '    var textHits = 0, htmlHits = 0, styleHits = 0;',
  '    for (var q = 0; q < CARD_SIGNS.length; q++) {',
  '      if (txtClean.indexOf(CARD_SIGNS[q]) >= 0) textHits++;',
  '      if (html.indexOf(CARD_SIGNS[q]) >= 0) htmlHits++;',
  '      if (styles.indexOf(CARD_SIGNS[q]) >= 0) styleHits++;',
  '    }',
  '    return {',
  '      stage: tag,',
  '      muvIframes: frames.length, anyIframes: anyFrames.length,',
  '      hostFixed: fixed, hostFixedDump: fixedDump,',
  '      nakedLen: naked, msgTextLen: txtClean.length, msgInnerLen: txt.length,',
  '      textSignHits: textHits, htmlSignHits: htmlHits, styleSignHits: styleHits,',
  '      hostStylesLen: styles.length,',
  '      hasPreCode: m ? m.querySelectorAll("pre code").length : -1,',
  '      preTextLen: (function () { var ps = m ? m.querySelectorAll("pre") : []; var n = 0; for (var i = 0; i < ps.length; i++) n += (ps[i].textContent || "").length; return n })(),',
  '      statusWraps: m ? m.querySelectorAll(".muv-statusbar-wrap").length : -1,',
  '      childTags: m ? Array.prototype.map.call(m.children, function (e) { return e.tagName + "(" + (e.textContent || "").length + ")" }).join(",") : "",',
  '      msgHead: txtClean.slice(0, 120),',
  '      /**',
  '       * 装饰后消息内部到底长什么样 —— 直接看 HTML，不靠推断。',
  '       * ★ 用 base64 编码：`innerHTML` 里既有 `"` 也有被转义成 `&amp;quot;` 的引号，',
  '       *   直接塞进 JSON 再塞进 `<pre>` 会在反转义后把 JSON 字符串提前截断',
  '       *   （实测 `SyntaxError: Expected "," or "}" after property value`），',
  '       *   看起来像夹具崩了。编码成 base64 就没有任何字符能与 JSON 语法冲突。',
  '       */',
  '      msgHtmlHeadB64: m ? btoa(unescape(encodeURIComponent(String(m.innerHTML || "").slice(0, 300)))) : "",',
  '      msgHtmlTailB64: m ? btoa(unescape(encodeURIComponent(String(m.innerHTML || "").slice(-220)))) : "",',
  '      /** 有没有 iframe 落在消息里（与 .muv-statusbar-wrap 分开量，区分「插了壳没插内容」）。 */',
  '      msgIframes: m ? m.querySelectorAll("iframe").length : -1,',
  '      iframeInHostText: (function(){ var t = document.body.innerText || ""; return t.indexOf("<iframe") >= 0 ? 1 : 0 })()',
  '    };',
  '  }',
  '  var results = {};',
  '  try {',
  '    window.fetch = function () { return Promise.reject(new Error("stub")) };',
  '    var exports = window.__mod.factory(function () { return {} });',
  '    notes.push("factory=ok");',
  '    if (exports && typeof exports.apply === "function") { exports.apply(); notes.push("apply=ok") }',
  '    else notes.push("apply=MISSING");',
  '  } catch (e) { notes.push("boot=THROW:" + e.message) }',
  '  // 直接戳真实入口，绕开 _decorateOne 的早退：看 beautifyMuv 拿到真卡 innerText 后的**返回值**',
  '  try {',
  '    var mEl = document.getElementById("msg_X");',
  '    var rawText = mEl.innerText || "";',
  '    results.rawLen = rawText.length;',
  '    results.rawHead = JSON.stringify(rawText.slice(0, 60));',
  '    results.rawHasFence = /(^|\\n)[ \\t]{0,3}`{3,}/.test(rawText) ? 1 : 0;',
  '    window.MuvEngine.beautify(rawText).then(function (out) {',
  '      results.beauty = {',
  '        inLen: rawText.length, outLen: String(out || "").length,',
  '        changed: String(out) !== rawText ? 1 : 0,',
  '        outHead: JSON.stringify(String(out || "").slice(0, 80)),',
  '        outIframes: (String(out).match(/<iframe/g) || []).length,',
  '        outHasDoctype: /<!doctype/i.test(String(out)) ? 1 : 0,',
  '        outHasFence: /(^|\\n)[ \\t]{0,3}`{3,}/.test(String(out)) ? 1 : 0,',
  '        outHasStatusWrap: String(out).indexOf("muv-statusbar-wrap") >= 0 ? 1 : 0,',
  '        outHtmlTagCount: (String(out).match(/<html/gi) || []).length,',
  // 判定链最关键的三个数：装饰产物有多长、里面有没有裸文档、有没有 iframe。
  // 只看 DOM 结果分不清「产物没做对」和「产物做对了但没写回」。
  '        outHasNakedDoc: /<!doctype\\s+html/i.test(String(out)) ? 1 : 0,',
  '        outTail: JSON.stringify(String(out || "").slice(-120))',
  '      };',
  '      notes.push("beautify=ok");',
  '    }, function (e) { notes.push("beautify=REJECT:" + (e && e.message)) });',
  '  } catch (e) { notes.push("beautifyProbe=THROW:" + e.message) }',
  '  results.before = snapshot("before");',
  '  setTimeout(function () {',
  '    try {',
  '      if (window.MuvEngine && typeof window.MuvEngine.decorateMessage === "function") {',
  '        window.MuvEngine.decorateMessage(document.getElementById("msg_X"));',
  '        notes.push("decorate=called");',
  '      } else { notes.push("decorate=MISSING") }',
  '    } catch (e) { notes.push("decorate=THROW:" + e.message) }',
  '  }, 80);',
  '  setTimeout(function () {',
  '    results.after = snapshot("after");',
  '    var pre = document.createElement("pre");',
  '    pre.id = "RESULT";',
  '    pre.textContent = JSON.stringify(results);',
  '    var n = document.createElement("pre");',
  '    n.id = "NOTES";',
  '    n.textContent = "NOTES " + notes.join("|");',
  '    document.body.appendChild(pre);',
  '    document.body.appendChild(n);',
  '  }, 1500);',
  '})();',
].join('\n')

// 用 split/join 做替换：替换串里出现 `$&` 之类会让 String.replace 产生意外展开，
// 而 client.js 里全是 `$`（`$1` 反向引用…），所以绝不能用 replace 注入它。
const page = PAGE
  .split('@_MSG_@').join(FENCED_HTML)
  .split('@_CLIENT_@').join(CLIENT.replace(/<\/script/gi, '<\\/script'))
  .split('/*__PROBE__*/').join(PROBE)

const file = path.join(OUT, 'realcard-inline.html')
writeFileSync(file, page, 'utf8')
console.log('\n=== fixture ===')
console.log('  源码  : ' + SRC_PATH + ' (' + CLIENT.length + ' 字符)')
console.log('  消息  : ' + MESSAGE_TEXT.length + ' 字符（含 1 份围栏整页文档，正文 ' + beauty.body.length + '）')
console.log('  ' + file)

const EDGE = process.env.MUV_EDGE
if (!EDGE) { console.log('\n设 MUV_EDGE 可自动跑。'); process.exit(0) }

const domFile = path.join(OUT, 'realcard-inline.dom.html')
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=9000',
  '--user-data-dir=' + path.join(OUT, 'prof-' + Date.now().toString(36)),
  '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'realcard-inline.err.txt'), 'w')] })

const dump = readFileSync(domFile, 'utf8')
const dec = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
const raw = (/<pre id="RESULT">([\s\S]*?)<\/pre>/.exec(dump) || [])[1]
const notes = dec(((/<pre id="NOTES">([\s\S]*?)<\/pre>/.exec(dump) || [])[1] || '')).slice(0, 300)
if (!raw) {
  console.log('\n没拿到 RESULT —— 夹具没跑起来（不是产品结论）')
  console.log('  ' + notes)
  process.exit(1)
}
const R = JSON.parse(dec(raw))
const b64dec = (s) => { try { return decodeURIComponent(escape(Buffer.from(String(s || ''), 'base64').toString('latin1'))) } catch (_) { return '' } }
R.after.msgHtmlHead = b64dec(R.after.msgHtmlHeadB64)
R.after.msgHtmlTail = b64dec(R.after.msgHtmlTailB64)
R.before.msgHtmlHead = b64dec(R.before.msgHtmlHeadB64)
R.before.msgHtmlTail = b64dec(R.before.msgHtmlTailB64)
console.log('\n=== 浏览器实测 ===')
console.log('  ' + notes)
console.log('\n' + JSON.stringify(R, null, 2))

const a = R.after, b = R.before
console.log('\n=== 判定 ===')
console.log('  装饰前 pre>code = ' + b.hasPreCode + '（围栏按 markdown 渲染成代码块 ⇒ 真卡消息形状成立）')
console.log('  装饰后 muv-iframe = ' + a.muvIframes + ' / 任意 iframe = ' + a.anyIframes)
console.log('  装饰后宿主非 iframe fixed 元素 = ' + a.hostFixed + ' ' + JSON.stringify(a.hostFixedDump))
console.log('  装饰后宿主 <style> 命中卡特征 = ' + a.styleSignHits + '（宿主 style 总长 ' + a.hostStylesLen + '）')
console.log('  装饰后宿主 HTML 命中卡特征 = ' + a.htmlSignHits)
console.log('  消息裸 HTML 长度 = ' + a.nakedLen + '（消息文本总长 ' + a.msgTextLen + '）')

let bad = 0
const check = (name, cond, detail) => { console.log('  ' + (cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '  -> ' + detail)); if (!cond) bad++ }
console.log('')
check('装饰前确实有 pre>code（真卡消息形状成立，不是空跑）', b.hasPreCode >= 1, 'pre code=' + b.hasPreCode)
check('★ 卡的整页文档进入了 iframe（muv-iframe >= 1）', a.muvIframes >= 1, 'muv-iframe=' + a.muvIframes)
check('★ 宿主页里没有卡的 style 特征（无 CSS 泄漏）', a.styleSignHits === 0, 'styleSignHits=' + a.styleSignHits)
check('★ 宿主页里没有卡的非 iframe fixed 元素（工具栏没逃出来）', a.hostFixed === 0, JSON.stringify(a.hostFixedDump))
check('★ 消息里没有裸 HTML 文本', a.nakedLen === 0, 'nakedLen=' + a.nakedLen)
console.log(bad ? `\n=== 真卡内联泄漏探针: ${bad} 项未通过 ===` : '\n=== 真卡内联泄漏探针: 全部通过 ===')
console.log('产物: ' + OUT)
process.exit(bad ? 1 : 0)
