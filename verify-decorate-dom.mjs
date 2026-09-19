// 装饰链路门禁：在**真浏览器**里跑**真实模块 + 真实 DOM + 真实 `_decorateOne`**。
//
// 为什么必须这样测：`_decorateOne` 是「读 DOM → 变换 → 写回 DOM」的破坏性操作，
// 它的行为**只由真实的 DOM 语义决定**（`innerText` 返回渲染后文本、`closest()`、
// `innerHTML` 解析规则），字符串断言和 Node 里的假 DOM 都测不到。
//
// 两条被测消息，对应两类标记（逐类迁移，一类一条）：
//   A_choices —— 纯 `<choices>` 消息（第一类）
//   B_header  —— 带 `『📅…|⏰…|📍…』` 表头 + `<StatusPlaceHolderImpl/>`（第二类）
//
// 对每条消息的判据都是两件事**同时**成立：
//   ① markdown 存活：`<strong>` / `<h2>` / `<pre><code>` / `<li>` 仍在
//   ② 该渲染的东西真的渲染了：A 要 `.muv-choice-btn`，B 要 `.muv-statusbar-wrap`
// 只满足② = 用户看到的正文全变纯文字（实测：真实消息里 `**` 有 352/604/792 处）；
// 只满足① = 选项/状态栏没了（用户最初的抱怨）。**两个方向都必须钉住。**
//
// 做法：`lib/client.js` 是 `window.__ModuleLoader__.load({ factory })` 形态，而
// `exports.apply` 是**零参**函数（不需要 Cordis 上下文），所以整个模块可以在页面里
// 原样加载并启动。之后调真实的 `window.MuvEngine.decorateMessage(el)`。
// `fetch` 打桩成失败：这样 `beautifyMuv` 的卡片分支被跳过，走的是**本地路径**
// —— 也正是我们要测的那条。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-decorate-dom.mjs
// 对照：$env:MUV_CLIENT_SRC="<另一份 client.js>" 可指向任意版本做修复前后对比。

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

const MARKDOWN = `
<h2>午后 · 遗迹入口</h2>
<p>这是 <strong>粗体</strong>、<em>斜体</em>、<code>内联代码</code>。</p>
<pre><code>const a = 1</code></pre>
<ul><li>列表项一</li><li>列表项二</li></ul>`

const MESSAGES = {
  A_choices: `${MARKDOWN}
<p>安柏压低声音：「这里的风不对劲。」</p>
<p>&lt;choices&gt;
A. 悄悄摸进遗迹
B. 先在入口扎营
&lt;/choices&gt;</p>`,
  B_header: `<p>『📅2026年8月26日|⏰10:00|📍遗迹入口』</p>${MARKDOWN}
<p>安柏压低声音：「这里的风不对劲。」</p>
<p>&lt;StatusPlaceHolderImpl/&gt;</p>`,
  // 目标里明确要求「插画与视频」，但此前只在字符串层验过。
  // 这条给出**浏览器实测**的基线：DSH 原生路径目前对媒体标签一个渲染器都没有
  // （`renderMediaTags` 唯一调用点挂在酒馆路径的 `_tavernRenderTags` 上）。
  C_media: `${MARKDOWN}
<p>&lt;插图&gt;海边日落&lt;/插图&gt;</p>
<p>&lt;video src="https://example.invalid/a.mp4"&gt;&lt;/video&gt;</p>
<p>&lt;audio src="https://example.invalid/b.mp3"&gt;&lt;/audio&gt;</p>`,
}

/** 每条消息「该渲染出来的东西」——**两个方向都要钉**：markdown 不能丢，功能也不能丢。 */
const NEEDS = {
  A_choices: ['choiceBtns'],
  B_header: ['statusBars'],
  C_media: ['videos', 'illustrations'],
}

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>decorate-dom</title>
<style>
  html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:14px/1.7 "Microsoft YaHei",system-ui,sans-serif}
  body{padding:14px}.wrap{max-width:760px;margin:0 auto}
  .cap{font:12px monospace;color:#8b93a1;margin:14px 0 6px}
  .host{border:1px dashed #3a4048;border-radius:6px;padding:10px}
</style></head>
<body>
<div class="wrap">
  <div class="cap">装饰链路门禁：真实模块 + 真实 _decorateOne + 真实 DOM</div>
${Object.keys(MESSAGES).map((k) => `  <div class="cap">${k}</div>\n  <div class="host"><div id="msg_${k}" class="_markdown_abc123_7">${MESSAGES[k]}</div></div>`).join('\n')}
</div>

<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${INLINED}</script>
<script>
(function () {
  var KEYS = ${JSON.stringify(Object.keys(MESSAGES))};
  var notes = [];
  function msg(k) { return document.getElementById('msg_' + k) }
  function count(k, sel) { var m = msg(k); return m ? m.querySelectorAll(sel).length : -1 }
  function emit(state) {
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], m = msg(k), txt = m ? m.innerText : '';
      var v = 'VERDICT msg=' + k + ' state=' + state
        + ' strong=' + count(k, 'strong') + ' h2=' + count(k, 'h2')
        + ' pre=' + count(k, 'pre') + ' li=' + count(k, 'li')
        + ' choiceBtns=' + count(k, '.muv-choice-btn')
        + ' statusBars=' + count(k, '.muv-statusbar-wrap')
        + ' iframes=' + count(k, 'iframe')
        + ' videos=' + count(k, 'video') + ' audios=' + count(k, 'audio')
        + ' imgs=' + count(k, 'img') + ' illustrations=' + count(k, '.muv-illustration')
        + ' literalStars=' + (/\\*\\*/.test(txt) ? 1 : 0);
      var pre = document.createElement('pre');
      pre.className = 'verdict';
      pre.textContent = v;
      pre.style.cssText = 'position:fixed;left:0;bottom:' + (i * 22) + 'px;z-index:2147483647;background:#000;color:#0f0;font:11px monospace;padding:2px 4px;margin:0;white-space:nowrap;max-width:100%;overflow:hidden';
      document.body.appendChild(pre);
    }
    var n = document.createElement('pre');
    n.id = 'notes';
    n.textContent = 'NOTES ' + notes.join('|');
    n.style.cssText = 'position:fixed;right:0;bottom:0;z-index:2147483647;background:#111;color:#8b93a1;font:10px monospace;padding:2px;margin:0';
    document.body.appendChild(n);
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
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      notes.push('before(' + k + ':strong=' + count(k, 'strong') + ',h2=' + count(k, 'h2') + ',pre=' + count(k, 'pre') + ',li=' + count(k, 'li') + ')');
      try {
        if (window.MuvEngine && typeof window.MuvEngine.decorateMessage === 'function') {
          window.MuvEngine.decorateMessage(msg(k));
          notes.push('decorate(' + k + ')=called');
        } else { notes.push('decorate=MISSING(window.MuvEngine)') }
      } catch (e) { notes.push('decorate(' + k + ')=THROW:' + e.message) }
    }
  }, 80);

  setTimeout(function () { emit('after') }, 1400);
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'decorate-dom.html')
writeFileSync(file, page, 'utf8')
console.log('=== fixture 已生成 ===')
console.log('  源码: ' + SRC_PATH)
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
const verdicts = [...dom.matchAll(/VERDICT msg=[\w]+ state=after[^<\n]*/g)].map((m) => m[0].trim())
console.log('\n=== 浏览器实测 ===')
if (!verdicts.length) {
  console.log('  没拿到 VERDICT —— 装饰链路没跑起来（fixture 有问题，不是产品结论）')
  const note = dom.match(/NOTES[^<\n]*/)
  if (note) console.log('  ' + note[0].replace(/&gt;/g, '>'))
  process.exit(1)
}

const clean = (s) => s.replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
let bad = 0
const seen = new Set()
for (const raw of verdicts) {
  const v = clean(raw)
  const key = (/msg=([\w]+)/.exec(v) || [])[1]
  seen.add(key)
  const num = (k) => Number((new RegExp('\\b' + k + '=(\\d+)').exec(v) || [])[1] || 0)
  const markdownKept = num('strong') >= 1 && num('h2') >= 1 && num('pre') >= 1 && num('li') >= 1
  const needs = NEEDS[key] || ['choiceBtns']
  const featureOk = needs.every((n) => num(n) >= 1)
  const ok = markdownKept && featureOk
  if (!ok) bad++
  console.log(`\n  [${key}] ${ok ? 'PASS' : 'FAIL'}`)
  console.log('    ' + v)
  console.log('    markdown 存活=' + (markdownKept ? '是' : '**否**') +
    '   ' + needs.map((n) => n + '=' + num(n)).join(' '))
}
// 防空循环：每条消息都必须有结果
for (const k of Object.keys(MESSAGES)) {
  if (!seen.has(k)) { console.log(`\n  [${k}] FAIL 没有实测结果（fixture 没跑到这条）`); bad++ }
}
console.log(bad ? `\n=== 装饰链路门禁: ${bad} 项未通过 ===` : '\n=== 装饰链路门禁: 全部通过 ===')
process.exit(bad ? 1 : 0)
