// 装饰链路门禁：在**真浏览器**里跑**真实模块 + 真实 DOM + 真实 `_decorateOne`**。
//
// 为什么必须这样测：`_decorateOne` 是「读 DOM → 变换 → 写回 DOM」的破坏性操作，
// 它的行为**只由真实的 DOM 语义决定**（`innerText` 返回渲染后文本、`closest()`、
// `innerHTML` 解析规则），字符串断言和 Node 里的假 DOM 都测不到。
//
// 判据（就是「装饰不该毁掉 markdown，但必须渲染出选项」）：
//   - 装饰后 `<strong>` / `<h2>` / `<pre><code>` / `<li>` **仍在**（markdown 未被抹掉）
//   - 且 `.muv-choice-btn` **出现**（选项仍然渲染）
// 只满足后者 = 用户看到的正文全变纯文字；只满足前者 = 选项没了（用户最初的抱怨）。
//
// 做法：`lib/client.js` 是 `window.__ModuleLoader__.load({ factory })` 形态，而
// `exports.apply` 是**零参**函数（不需要 Cordis 上下文），所以整个模块可以在页面里
// 原样加载并启动。之后调真实的 `window.MuvEngine.decorateMessage(el)`。
// `fetch` 打桩成失败：这样 `beautifyMuv` 的卡片分支被跳过，走的是**本地的 choices 路径**
// —— 也正是我们要测的那条。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-decorate-dom.mjs

import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 可以指向任意一份源码：用来做「修复前 vs 修复后」的对照。
// **必须做对照** —— 只看"现在通过了"无法区分「修复生效」和「这条判据本来就测不到东西」。
const SRC_PATH = process.env.MUV_CLIENT_SRC || path.join(__dirname, 'lib', 'client.js')
const CLIENT = readFileSync(SRC_PATH, 'utf8')
const OUT = path.join(os.tmpdir(), 'muv-visual-main')
mkdirSync(OUT, { recursive: true })

// 内联进 <script> 时必须打断 `</script`，否则会把宿主页面当场截断
const INLINED = CLIENT.replace(/<\/script/gi, '<\\/script')

const MESSAGE_HTML = `
<h2>午后 · 遗迹入口</h2>
<p>这是 <strong>粗体</strong>、<em>斜体</em>、<code>内联代码</code>。</p>
<pre><code>const a = 1</code></pre>
<ul><li>列表项一</li><li>列表项二</li></ul>
<p>安柏压低声音：「这里的风不对劲。」</p>
<p>&lt;choices&gt;
A. 悄悄摸进遗迹
B. 先在入口扎营
&lt;/choices&gt;</p>
`

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>decorate-dom</title>
<style>
  html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:14px/1.7 "Microsoft YaHei",system-ui,sans-serif}
  body{padding:14px}.wrap{max-width:760px;margin:0 auto}
  .cap{font:12px monospace;color:#8b93a1;margin:0 0 8px}
  #host{border:1px dashed #3a4048;border-radius:6px;padding:10px}
</style></head>
<body>
<div class="wrap">
  <div class="cap">装饰链路门禁：真实模块 + 真实 _decorateOne + 真实 DOM</div>
  <div id="host"><div id="msg" class="_markdown_abc123_7">${MESSAGE_HTML}</div></div>
</div>

<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${INLINED}</script>
<script>
(function () {
  var notes = [];
  function count(sel) { return document.querySelectorAll(sel).length; }
  function emit(state) {
    var msg = document.getElementById('msg');
    var txt = msg ? msg.innerText : '';
    var v = 'VERDICT state=' + state
      + ' strong=' + count('#msg strong')
      + ' h2=' + count('#msg h2')
      + ' pre=' + count('#msg pre')
      + ' li=' + count('#msg li')
      + ' choiceBtns=' + count('.muv-choice-btn')
      + ' iframes=' + count('#msg iframe')
      + ' literalStars=' + (/\\*\\*/.test(txt) ? 1 : 0)
      + ' notes=' + notes.join('|');
    var pre = document.createElement('pre');
    pre.id = 'verdict';
    pre.textContent = v;
    pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;background:#000;color:#0f0;font:11px monospace;padding:4px;margin:0;white-space:pre-wrap;max-width:100%';
    document.body.appendChild(pre);
  }
  window.addEventListener('error', function (e) { notes.push('onerror:' + e.message); });

  try {
    window.fetch = function () { return Promise.reject(new Error('stub: no server in fixture')) };
    var exports = window.__mod.factory(function () { return {} });
    notes.push('factory=ok');
    if (exports && typeof exports.apply === 'function') { exports.apply(); notes.push('apply=ok') }
    else notes.push('apply=MISSING');
  } catch (e) { notes.push('boot=THROW:' + e.message) }

  // 先记录**装饰前**的状态：这是"markdown 本来是好的"的证据
  setTimeout(function () {
    var msg = document.getElementById('msg');
    notes.push('before(strong=' + count('#msg strong') + ',h2=' + count('#msg h2') + ',pre=' + count('#msg pre') + ',li=' + count('#msg li') + ')');
    try {
      if (window.MuvEngine && typeof window.MuvEngine.decorateMessage === 'function') {
        window.MuvEngine.decorateMessage(msg);
        notes.push('decorate=called');
      } else { notes.push('decorate=MISSING(window.MuvEngine)') }
    } catch (e) { notes.push('decorate=THROW:' + e.message) }
  }, 80);

  setTimeout(function () { emit('after') }, 1400);
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'decorate-dom.html')
writeFileSync(file, page, 'utf8')
console.log('=== fixture 已生成 ===')
console.log('  ' + file + '（内联了真实 lib/client.js，' + CLIENT.length + ' 字符）')

const EDGE = process.env.MUV_EDGE
if (!EDGE) {
  console.log('\n设 MUV_EDGE 指向 msedge.exe 可自动跑：')
  console.log('  $env:MUV_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"; node verify-decorate-dom.mjs')
  process.exit(0)
}

const domFile = path.join(OUT, 'decorate-dom.dom.html')
const profDir = path.join(OUT, 'prof-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=6000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'decorate-dom.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const verdicts = [...dom.matchAll(/VERDICT state=after[^<\n]*/g)].map((m) => m[0].trim())
console.log('\n=== 浏览器实测 ===')
if (!verdicts.length) {
  console.log('  没拿到 VERDICT —— 装饰链路没跑起来（fixture 有问题，不是产品结论）')
  const note = dom.match(/notes=[^<\n]*/)
  if (note) console.log('  ' + note[0])
  process.exit(1)
}
const v = verdicts[0].replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const num = (k) => Number((new RegExp(k + '=(\\d+)').exec(v) || [])[1] || 0)
console.log('  ' + v)

const markdownKept = num('strong') >= 1 && num('h2') >= 1 && num('pre') >= 1 && num('li') >= 1
const choicesRendered = num('choiceBtns') >= 1
console.log('\n=== 判据 ===')
console.log('  markdown 存活（strong/h2/pre/li 都在）: ' + (markdownKept ? '是' : '**否**'))
console.log('  选项已渲染（.muv-choice-btn）        : ' + (choicesRendered ? '是' : '**否**'))

let bad = 0
if (!choicesRendered) { console.log('  FAIL 选项没有渲染出来 —— 用户的原始抱怨会复现'); bad++ }
if (!markdownKept) { console.log('  FAIL markdown 被抹掉（装饰 = 整条消息 DOM 被重写）'); bad++ }
console.log(bad ? `\n=== 装饰链路门禁: ${bad} 项未通过 ===` : '\n=== 装饰链路门禁: 全部通过 ===')
process.exit(bad ? 1 : 0)
