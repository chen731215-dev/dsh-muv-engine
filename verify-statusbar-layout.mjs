// 状态栏布局门禁：把「两个字段挤在一行 / 角色名没有独立块」变成**浏览器实测**的断言。
//
// 为什么需要：这两条是小黄鸭用肉眼在截图里发现的。肉眼发现的问题不会自动回归 ——
// 改回去也没人知道。而它们又恰好是**单元测试完全看不见**的一类：
//   - `.muv-sb-sub` 的三列网格是 CSS 的事，字符串断言看不见布局
//   - `.muv-sb-char` 是「CSS 定义了、渲染器从不输出」，两边各自都"对"
// 所以这里同时做两件事：
//   ① 跑**真实的** status-cascade 三个阶段，拿真产物（不是手写 HTML）
//   ② 用无头 Edge 打开它 + **真实的 MUV_SB_CSS**，量 computed style 与每行 top
//
// 判据（spec）：
//   - `.muv-sb-sub` 必须是单列（flex column 或单列 grid）→ 否则长字段会流到隔壁列
//   - 同一个角色块里的每个 `.muv-sb-line` 必须各占一行（top 互不相同）
//   - 角色名必须有独立块：`.muv-sb-char` 数量 ≥ 角色数，且带圆角盒子
//   - 行高必须 > 0（防止"量到了但没有渲染"这种假绿）
//
// 运行：node verify-statusbar-layout.mjs   → 生成 fixture，并打印 Edge 命令
//       （浏览器那一半要外部跑：无头 Edge --dump-dom，然后把 VERDICT 行贴回来）

import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { extractStatusBody, renderStatusFromText } from './lib/status-cascade.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
const OUT = path.join(os.tmpdir(), 'muv-visual-main')
mkdirSync(OUT, { recursive: true })

/**
 * 取 `var NAME = <表达式>` 的表达式源码（**剥掉注释**）。
 *
 * 两个坑都是踩出来的：
 *  ① 收尾判据不能只看「本行末尾是不是运算符」—— MUV_SB_CSS 的拼接中间夹着注释行，
 *     只看本行会在第一个字符串常量的换行处截断（第一版只拿到 238 字）。
 *  ② 判定续行时要跳过注释，但**不能把注释并进结果**——否则注释文字会留在表达式末尾，
 *     求值时报 `SyntaxError: Unexpected token '}'`（第二版就是这么坏的）。
 * 所以扫描时直接不把注释写进 kept。
 */
function varExpression(src, name) {
  const m = new RegExp('^\\s*var\\s+' + name + '\\s*=', 'm').exec(src)
  if (!m) throw new Error('找不到 var ' + name)
  let depth = 0
  let quote = null
  let kept = ''
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i]
    const d = src[i + 1]
    if (quote) {
      kept += c
      if (c === '\\') { kept += src[i + 1] || ''; i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e - 1; continue }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; kept += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ';' && depth === 0) break
    else if (c === '\n' && depth === 0) {
      const sofar = kept.replace(/\s+$/, '')
      if (!/[+\-*/%.,([{=:?&|!<>]$/.test(sofar)) {
        // 下一行是续行吗？（跳过空行与整行注释）
        let j = i + 1
        let nextCh = ''
        while (j < src.length) {
          const le = src.indexOf('\n', j)
          const end = le < 0 ? src.length : le
          const t = src.slice(j, end).trim()
          if (t !== '' && t.indexOf('//') !== 0 && t.indexOf('*') !== 0 && t.indexOf('/*') !== 0) { nextCh = t.charAt(0); break }
          j = end + 1
        }
        if (!/^[+\-*/%.,?:&|)\]}]/.test(nextCh)) break
      }
    }
    kept += c
  }
  return kept.trim()
}

const CSS_EXPR = varExpression(SRC, 'MUV_SB_CSS')
if (process.env.MUV_DEBUG) {
  console.log('[debug] 表达式长度=' + CSS_EXPR.length)
  console.log('[debug] 头: ' + JSON.stringify(CSS_EXPR.slice(0, 90)))
  console.log('[debug] 尾: ' + JSON.stringify(CSS_EXPR.slice(-90)))
}
const CSS = new Function('return (' + CSS_EXPR + ')')()
console.log('=== 真实 CSS 已提取 ===')
console.log('  MUV_SB_CSS 长度 = ' + CSS.length)
console.log('  含 .muv-sb-sub 规则: ' + /\.muv-sb-sub\s*\{/.test(CSS))
console.log('  含 .muv-sb-char 规则: ' + /\.muv-sb-char\s*\{/.test(CSS))
console.log('  ⚠ 三列网格残留: ' + /grid-template-columns\s*:\s*repeat\(auto-fit/.test(CSS))

// ── 真实产物 ────────────────────────────────────────────────────────────────
//
// 输入形态必须对得上各级联阶段的**入口约定**，否则会静默落到别的阶段
// （我第一版编的 body 全落到 free，字段行被 stripHeaderFields 当头部字段吃掉了，
//  于是「字段行=0」—— 那不是缺陷，是我喂错了东西）。
const BODIES = {
  'free-notes': [
    '⏰ 时间：午后',
    '📍 地点：遗迹入口',
    '👤 安柏 😊 精力充沛',
    '正在遗迹入口观察地形，手指无意识地敲着剑柄。',
    '已经三天没有好好休息了，眼神里带着倦意。',
    '行动选项',
    '- 悄悄摸进遗迹',
    '- 先在入口扎营休息',
  ].join('\n'),
  'free-dialogue': [
    '👤 安柏',
    '「这里的风不对劲。」她压低了声音。',
    '「你跟紧我。」',
  ].join('\n'),
  yamlA: [
    '姓名: 安柏',
    '行动: 🏃 探索遗迹深处',
    '内心: 😟 有点紧张但很期待',
    '穿搭: 👕 轻便冒险装',
  ].join('\n'),
  yamlB: [
    '安柏:',
    '  行动: 🏃 探索遗迹深处',
    '  内心: 😟 有点紧张但很期待',
  ].join('\n'),
}

console.log('\n=== 真实级联产物 ===')
const stages = []
for (const [key, body] of Object.entries(BODIES)) {
  let r = null
  try { r = renderStatusFromText(body) } catch (e) { console.log(`  ${key}: 抛错 ${e.message}`); continue }
  if (!r || !r.html) { console.log(`  ${key}: 该形态没有产出（source=${r && r.source}）`); continue }
  const html = String(r.html)
  const nLine = (html.match(/class="muv-sb-line"/g) || []).length
  const nChar = (html.match(/class="muv-sb-char"/g) || []).length
  const nCharName = (html.match(/muv-sb-char-name/g) || []).length
  const nBtn = (html.match(/<button/g) || []).length
  console.log(`  ${key}: source=${r.source} html=${html.length}字 字段行=${nLine} 角色块=${nChar} 角色名=${nCharName} 选项按钮=${nBtn}`)
  if (nLine === 0) {
    console.log('       （没有字段行）产物：' + html.slice(0, 260).replace(/\s+/g, ' '))
    continue
  }
  stages.push({ key, source: r.source, html })
}

if (!stages.length) {
  console.log('\n没有拿到任何带字段行的结构级联产物 —— 门禁无法成立（这本身就是失败）。')
  process.exit(1)
}

// ── fixture：真 CSS + 真产物 + 探针 ─────────────────────────────────────────
const PROBE = `
<script>
(function(){
  function boxed(el){
    var cs = getComputedStyle(el);
    return cs.borderRadius !== '0px' && cs.borderRadius !== '' ? 1 : 0;
  }
  var out = [];
  var secs = document.querySelectorAll('.sb-stage');
  for (var s = 0; s < secs.length; s++) {
    var sec = secs[s], name = sec.getAttribute('data-stage');
    var sub = sec.querySelector('.muv-sb-sub');
    var lines = sec.querySelectorAll('.muv-sb-line');
    var blocks = sec.querySelectorAll('.muv-sb-char');
    var tops = {}, dup = 0, zeroH = 0;
    for (var i = 0; i < lines.length; i++) {
      var r = lines[i].getBoundingClientRect();
      if (r.height === 0) zeroH++;
      var t = Math.round(r.top);
      if (tops[t]) dup++; else tops[t] = 1;
    }
    var boxedN = 0;
    for (var b = 0; b < blocks.length; b++) boxedN += boxed(blocks[b]);
    var cs2 = sub ? getComputedStyle(sub) : null;
    var single = false;
    if (cs2) {
      if (cs2.display === 'flex') single = (cs2.flexDirection === 'column' || cs2.flexDirection === 'column-reverse');
      else if (cs2.display === 'grid') single = cs2.gridTemplateColumns.split(' ').length <= 1;
      else single = true;
    }
    var ok = single && dup === 0 && zeroH === 0 && blocks.length > 0 && boxedN === blocks.length;
    out.push('VERDICT stage=' + name
      + ' subDisplay=' + (cs2 ? cs2.display : 'MISSING')
      + ' subDir=' + (cs2 ? (cs2.flexDirection || cs2.gridTemplateColumns) : '-')
      + ' lines=' + lines.length + ' chars=' + blocks.length + ' boxedChars=' + boxedN
      + ' sameRowPairs=' + dup + ' zeroHeightLines=' + zeroH
      + ' => ' + (ok ? 'PASS' : 'FAIL'));
  }
  var pre = document.createElement('pre');
  pre.id = 'verdict';
  pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;background:#000;color:#0f0;font:12px monospace;padding:6px;margin:0;white-space:pre-wrap;max-width:100%';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);
})();
<\/script>`

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>statusbar-layout</title>
<style>
  html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif}
  body{padding:14px}
  .wrap{max-width:760px;margin:0 auto}
  .sb-stage{border:1px dashed #3a4048;border-radius:6px;padding:8px;margin:0 0 16px}
  .sb-cap{font:12px monospace;color:#8b93a1;margin:0 0 6px}
${CSS}
</style></head>
<body>
<div class="wrap">
${stages.map((s) => `<div class="sb-stage" data-stage="${s.key}"><div class="sb-cap">stage=${s.key} (source=${s.source})</div>${s.html}</div>`).join('\n')}
</div>
${PROBE}
</body></html>`

const file = path.join(OUT, 'statusbar-layout.html')
writeFileSync(file, page, 'utf8')
console.log('\n=== fixture 已生成 ===')
console.log('  ' + file)

// ── 浏览器那一半（设了 MUV_EDGE 就自动跑，否则打印命令） ────────────────────
const EDGE = process.env.MUV_EDGE
if (!EDGE) {
  console.log('  阶段数 = ' + stages.length + '（' + stages.map((s) => s.key).join(', ') + '）')
  console.log('\n设 MUV_EDGE 指向 msedge.exe 可自动跑浏览器这一半（否则请手工执行）：')
  console.log('  $env:MUV_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"')
  console.log('  node verify-statusbar-layout.mjs')
  console.log('\n⚠ 手工跑时必须**重定向到文件**，不能用 PowerShell 管道：')
  console.log('  Edge 的 --headless=new 会再 fork 一次，孙进程的 stdout 不会进 PS 的管道，')
  console.log('  结果是「没有报错、也没有任何输出」。用 Start-Process -RedirectStandardOutput。')
  process.exit(0)
}

const { execFileSync } = await import('node:child_process')
const domFile = path.join(OUT, 'statusbar-layout.dom.html')
const errFile = path.join(OUT, 'statusbar-layout.edge.err.txt')
const profDir = path.join(OUT, 'prof-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=4000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], {
  // 用**文件描述符**而不是管道：绕开「子进程再 fork 时 stdout 丢失」以及
  // 受限沙箱下管道会 EPERM 的问题。
  stdio: ['ignore', openSync(domFile, 'w'), openSync(errFile, 'w')],
})

const dom = readFileSync(domFile, 'utf8')
// 探针源码本身也含 "VERDICT stage=" 字样，所以要求 stage= 后面紧跟名字（源码里是 `' + name`）
const verdicts = [...dom.matchAll(/VERDICT stage=[\w-]+[^<\n]*/g)].map((m) => m[0].trim())
console.log('\n=== 浏览器实测（' + verdicts.length + ' 个阶段）===')
if (!verdicts.length) {
  console.log('  没拿到任何 VERDICT —— 探针没执行（可能是 fixture 生成失败或浏览器没起来）')
  process.exit(1)
}
let bad = 0
for (const v of verdicts) {
  const ok = /=> PASS$/.test(v.replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim())
  if (!ok) bad++
  console.log('  ' + (ok ? 'PASS ' : 'FAIL ') + v.replace(/&gt;/g, '>'))
}
// 防空循环：一条都没有 = 门禁没成立，不能算通过
if (verdicts.length < stages.length) {
  console.log(`  ⚠ 只有 ${verdicts.length} 个阶段有实测结果，但生成了 ${stages.length} 个 —— 门禁不完整`)
  bad++
}
console.log(bad ? `\n=== 布局门禁: ${bad} 项未通过 ===` : '\n=== 布局门禁: 全部通过 ===')
process.exit(bad ? 1 : 0)
