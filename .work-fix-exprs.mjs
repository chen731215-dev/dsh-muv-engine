// 一次性补丁（正确版）：8 条内嵌表达式少了一个 `}`（函数体的收尾花括号）。
// 判据：括号净深 0、花括号净深 +1；补进来之后必须能 `new Function` 解析。
// 做法：从右往左试「插入一个 `}` 或 `)`」，取第一个能解析的位置 —— 不写死位置，改完逐条复验。
import fs from 'node:fs'

const FILE = 'verify-card-compat.mjs'
let src = fs.readFileSync(FILE, 'utf8')
const re = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
const parses = (t) => { try { new Function('a', 'b', 'return ' + t + ';'); return true } catch (_) { return false } }
const fixes = []
let m
while ((m = re.exec(src))) {
  const t = m[2]
  if (parses(t)) continue
  let fixed = null
  for (let i = t.length; i >= 0 && !fixed; i--) {
    for (const ch of ['}', ')']) {
      const cand = t.slice(0, i) + ch + t.slice(i)
      if (parses(cand)) { fixed = cand; break }
    }
  }
  if (fixed) fixes.push({ sig: m[1], from: t, to: fixed, at: fixed.length - t.length })
  else console.log('!! 单字符插入修不好（需要更大的改动）: ' + t.slice(0, 100))
}
console.log('需修 ' + fixes.length + ' 条')
for (const f of fixes) {
  const needle = "await " + f.sig + "('" + f.from + "')"
  const hits = src.split(needle).length - 1
  if (hits !== 1) { console.log('!! 匹配 ' + hits + ' 次，跳过'); continue }
  src = src.replace(needle, "await " + f.sig + "('" + f.to + "')")
  console.log('  插入 ' + JSON.stringify(f.to.slice(f.to.length - f.at - 1, f.to.length - f.at + 1)) + ' 于倒数第 ' + f.at + ' 位')
}
fs.writeFileSync(FILE, src, 'utf8')

let bad = 0, n = 0
const re2 = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
while ((m = re2.exec(src))) { n++; if (!parses(m[2])) { bad++; console.log('仍坏 #' + n) } }
console.log('复验: ' + n + ' 条，坏 ' + bad + ' 条')
