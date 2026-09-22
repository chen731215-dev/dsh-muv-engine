// 差分测试：新的**逐字符扫描**版 rewriteVhMinHeight 与旧的**正则字面量**版行为是否等价。
//
// 存在理由：新版是为了摆脱「`/` 在代码位置 = 正则开头」这个词法假设（那个假设会让
// test-client-source.mjs / verify-shared.mjs 的切片越界，两个门禁一起崩）。删掉正则字面量
// 属于「重写实现」，所以必须拿旧实现逐用例对照 —— 只测"新版能跑"等于没测。
//
// Run: node _st-verify/rewrite-diff.mjs

import { readEngineSource, extractFunction } from '../verify-shared.mjs'

const src = readEngineSource()

function take(name, seen) {
  if (seen.has(name)) return ''
  seen.add(name)
  const body = extractFunction(src, name)
  let code = body + '\n'
  for (const mm of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const id = mm[1]
    if (seen.has(id) || id === name) continue
    if (new RegExp('\\n\\s+function\\s+' + id + '\\s*\\(').test(src)) code += take(id, seen)
  }
  return code
}
const code = take('rewriteVhMinHeight', new Set())
const NEW = new Function('window', 'return (function(){' + code + '; return rewriteVhMinHeight})()')({ innerHeight: 1080 })

// 旧实现：原样抄自 `git show HEAD:lib/client.js`（正则字面量那版）
function scriptRangesOf(source) {
  const out = []
  const re = /<script\b[\s\S]*?<\/script\s*>/gi
  let m
  while ((m = re.exec(source))) out.push([m.index, re.lastIndex])
  return out
}
function rangesContain(r, i) {
  for (let k = 0; k < r.length; k++) if (i >= r[k][0] && i < r[k][1]) return true
  return false
}
function OLD(html) {
  const s = String(html == null ? '' : html)
  const vh = 1080
  const ranges = scriptRangesOf(s)
  const re = /min-height\s*:\s*([0-9.]+)\s*(vh|dvh|svh|lvh)\b/gi
  let out = '', last = 0, m, hits = 0
  while ((m = re.exec(s))) {
    if (rangesContain(ranges, m.index)) continue
    const px = Math.round(vh * parseFloat(m[1]) / 100)
    out += s.slice(last, m.index) + 'min-height:' + px + 'px'
    last = re.lastIndex
    hits++
  }
  return hits ? out + s.slice(last) : s
}

const CASES = [
  'a{min-height:100vh}', 'a{min-height: 100vh}', 'a{min-height:86vh}', 'a{min-height:86.5vh}',
  'a{min-height:0.5vh}', '<div style="min-height:100vh">', 'a{max-height:86vh}', 'a{height:100vh}',
  '<script>var css="min-height:100vh"</script>',
  '<style>a{min-height:100vh}</style><script>var s="min-height:100vh"</script>',
  '<p>hi</p>', 'a{min-height:0}', 'a{min-height:52px}',
  'a{min-height:100VH}', 'a{min-height:100vH}', 'a{min-height:100Vh}',
  'a{min-height:100vhx}', 'a{min-height:100vh_foo}', 'a{min-height:100vh-foo}',
  'a{min-height:100dvh}', 'a{min-height:100svh}', 'a{min-height:100lvh}',
  'a{min-height:100vh;min-height:50vh}', 'x{MIN-HEIGHT:100vh}', 'a{min-width:100vh}',
  'a{min-height:;}', 'a{min-height:vh}', 'a{min-height:  }', 'a{min-height:100%}',
  'a{min-height:calc(100vh)}', 'a{min-height:calc(100vw)}',
  'pre{min-height:100vh}<script>document.body.innerHTML="min-height:100vh"</script>post{min-height:7vh}',
  'a{min-height:100vh}b{min-height:100vh}c{min-height:100vh}',
  // 真卡里的实际形态
  '#app{display:none;grid-template-columns:250px 1fr;min-height:100vh}',
  '#app{min-height:100vh}',
  '.x{min-height:100vh;\n  color:red}',
  '.x{min-height:\n  100vh}',
  '.x{--a:min-height:100vh}',
  'a{min-height:100vh}',          // 与真卡同形，重复一次做稳定性对照
  'a{min-height:99vh}',
  'a{min-height:1vh}',
  '<script src="x.js"></script>a{min-height:100vh}',
  'A{MIN-HEIGHT:100dvh}B{Min-Height:50svh}',
]

let bad = 0
const diffs = []
for (const c of CASES) {
  let n, o, err = null
  try { n = NEW(c) } catch (e) { err = 'NEW threw: ' + e.message }
  try { o = OLD(c) } catch (e) { err = 'OLD threw: ' + e.message }
  if (err) { bad++; diffs.push([c, err]); continue }
  if (n !== o) { bad++; diffs.push([c, 'new=' + JSON.stringify(n), 'old=' + JSON.stringify(o)]) }
}
console.log('用例数: ' + CASES.length + '   差异: ' + bad)
for (const d of diffs) console.log('  DIFF ' + JSON.stringify(d))
if (!bad) console.log('  ✓ 新旧实现逐用例等价')
process.exit(bad ? 1 : 0)
