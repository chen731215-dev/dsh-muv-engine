// Repro (keep): 状态栏的两个「CSS 与渲染器错配」——单测完全看不见这类问题。
//
//   P0-1 字段挤在一行：`.muv-sb-sub` 还是 `repeat(auto-fit,minmax(215px,1fr))` 三列网格
//        （浏览器把它算成 245px 245px 245px），而上一轮把「单列」写在了 `.muv-sb-body`
//        上 —— 改错了选择器，bug 没修掉，只是换了触发条件。
//        判据：字段行数 == 行顶数（不同 offsetTop 的个数）。
//   P0-2 角色名没有独立块：`.muv-sb-char` / `.muv-sb-char-name` 在 yaml/free 两个最常
//        走到的级联里出现 0 次（只有 loose 级联在输出），CSS 白定义。
//        判据：渲染输出里这两个类出现次数 > 0，且每个角色各一个块。
//
// 真浏览器测量用 Edge 无头（`--dump-dom` 把量到的数字带回 Node）。
// 用**独立** user-data-dir：多代理并行验证时共用 profile 会互相踩（不报错但也没结果）。
//
// Run: node repro-statusbar-layout.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderStatusFromText } from './lib/status-cascade.js'
import { clientSource } from './test-client-source.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
let fail = 0
function check(name, cond, detail) {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}

// ── 样本：瑟瑟提瓦特那种 YAML（字段多、值长，正是当年挤压的病灶） ───────────────
const SAMPLE = [
  '状态栏:',
  '  日期和时间: "⏰ 2025年01月17日 23点15分"',
  '  地点: "📍 步非烟的私人直播间"',
  '  用户列表:',
  '    - 用户: 步非烟 名字: "👤 步非烟" 行动: "📝 刚完成抽奖" 内心: "💭 为什么抽到的不是我" 穿搭: "👗 白色蕾丝连衣裙" 小穴: "💦 已经湿透了" 胸部: "🍈 D 罩杯" 肛门: "🚫 还没有被碰过" 最近性行为: "🛏️ 三小时前和用户做过"',
  '  行动选项:',
  '    - "🏆 继续连线"',
].join('\n')

const rendered = renderStatusFromText(SAMPLE)
check('样本走的是 yaml 级联', rendered && rendered.source === 'yaml', rendered && rendered.source)
const html = rendered ? rendered.html : ''

// ── ① 静态：CSS 类名 census（定义了却没人输出的类 = 死 CSS，P0-2 就是这么漏的） ──
const src = clientSource()
const cssStart = src.indexOf('var MUV_SB_CSS = ')
const cssEnd = src.indexOf('\n\n', cssStart)
const cssRegion = src.slice(cssStart, cssEnd)
const defined = new Set([...cssRegion.matchAll(/\.(muv-sb-[a-z-]+)/g)].map(m => m[1]))
// census 要按「整个 class 属性」拆词：`class="muv-sb muv-sb-empty"` 这种多类写法里，
// 第一个类名不以 `muv-sb-` 结尾（是 `muv-sb`），用 `class="(muv-sb-[a-z- ]+)"` 会整条漏掉——
// 一个会漏报的 census 比没有 census 更糟。
const classesIn = (text) => new Set([...text.matchAll(/class="([^"]*)"/g)]
  .flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('muv-sb')))
const emittedInClient = classesIn(src)
const emittedInCascade = classesIn(fs.readFileSync(path.join(DIR, 'lib', 'status-cascade.js'), 'utf8'))
const emitted = new Set([...emittedInClient, ...emittedInCascade])
const dead = [...defined].filter(c => !emitted.has(c)).sort()
console.log('  CSS 定义 ' + defined.size + ' 个 muv-sb-* 类；渲染器输出 ' + emitted.size + ' 个')
console.log('  定义了但没有任何渲染器输出的类: ' + (dead.length ? dead.join(', ') : '（无）'))
check('★ 没有"定义了却没人输出"的状态栏类（P0-2 的根因）', dead.length === 0, dead.join(', '))

// ── ② 静态：样本输出里的结构计数 ─────────────────────────────────────────────
const lines = (html.match(/class="muv-sb-line"/g) || []).length
const charBlocks = (html.match(/class="muv-sb-char"/g) || []).length
const charNames = (html.match(/muv-sb-char-name/g) || []).length
console.log('  样本输出: 字段行=' + lines + ' 角色块=' + charBlocks + ' 角色名=' + charNames)
check('★ 渲染器输出了 .muv-sb-char 块（以前是 0）', charBlocks > 0, 'blocks=' + charBlocks)
check('★ 渲染器输出了 .muv-sb-char-name（以前是 0）', charNames > 0, 'names=' + charNames)
check('每个角色一个块、一个名字', charBlocks === charNames, charBlocks + ' vs ' + charNames)
check('字段行都落在角色块里', (html.match(/<div class="muv-sb-line"/g) || []).length === lines)

// ── ③ 真浏览器：字段行数 == 行顶数（P0-1 的验收判据） ─────────────────────────
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p))

if (!EDGE) {
  console.log('  SKIP 真浏览器测量（本机找不到 msedge.exe）')
} else {
  // 从 client.js 里把状态栏 CSS 抠出来（每条规则都是一个单引号字符串）
  const css = [...cssRegion.matchAll(/'(\.[^']*\{[^']*\})'/g)].map(m => m[1]).join('')
  const probe = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css +
    'body{margin:0;font-family:sans-serif}</style></head><body>' + html +
    '<pre id="out"></pre><script>' +
    'function report(){var rows=document.querySelectorAll(".muv-sb-line");' +
    'var tops=new Set();for(var i=0;i<rows.length;i++)tops.add(Math.round(rows[i].getBoundingClientRect().top));' +
    'var subs=document.querySelectorAll(".muv-sb-sub");var cols=0;' +
    'if(subs.length){cols=getComputedStyle(subs[0]).gridTemplateColumns.split(" ").length;}' +
    'document.getElementById("out").textContent=JSON.stringify({rows:rows.length,tops:tops.size,' +
    'gridCols:getComputedStyle(subs[0]).display==="grid"?cols:0});}' +
    'window.addEventListener("load",function(){setTimeout(report,120)});' +
    '</script></body></html>'

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-layout-'))
  const file = path.join(tmpDir, 'probe.html')
  fs.writeFileSync(file, probe, 'utf8')
  let dom = ''
  try {
    dom = execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(tmpDir, 'profile'),
      '--virtual-time-budget=1500', '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
    ], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    console.log('  SKIP Edge 没跑起来: ' + String(e.message).split('\n')[0])
  }
  const m = /"rows":(\d+),"tops":(\d+),"gridCols":(\d+)/.exec(dom)
  if (!m) {
    console.log('  SKIP 没拿到测量结果（dump-dom 输出 ' + dom.length + ' 字）')
  } else {
    const [rows, tops, gridCols] = [Number(m[1]), Number(m[2]), Number(m[3])]
    console.log('  Edge 实测: 字段行=' + rows + ' 行顶=' + tops + ' 网格列数=' + gridCols)
    check('★ 字段行数 == 行顶数（没有两个字段挤在同一行）', rows > 0 && rows === tops, rows + ' 行 / ' + tops + ' 行顶')
    check('★ .muv-sb-sub 不再是多列网格', gridCols === 0, 'gridColumns=' + gridCols)
    fs.writeFileSync(path.join(DIR, 'tmp-statusbar-probe-report.json'),
      JSON.stringify({ rows, tops, gridCols, lines, charBlocks, charNames, dead }, null, 2))
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
