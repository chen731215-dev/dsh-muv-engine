// 修 `verify-frame-size.fixed2.mjs` 里那处**吃掉引号**的丢失（唯一真正的语法伤）：
// 原句：check('带空格 `min-height: 100vh` 也重写', R('a{min-height: 100vh}')...)
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
let t = fs.readFileSync(f, 'utf8')
const lines = t.split('\n')
const i = lines.findIndex((l) => l.indexOf('也重') >= 0 && l.indexOf('?') >= 0)
if (i < 0) { console.log('没找到目标行'); process.exit(0) }
console.log('第 ' + (i + 1) + ' 行（修前）: ' + JSON.stringify(lines[i]))
lines[i] = lines[i].replace(/也重[^,]*?,/, "'".length && /也重[^\u0000-\u007f]*\?/.test(lines[i]) ? "也重写'," : "也重写',")
console.log('第 ' + (i + 1) + ' 行（修后）: ' + JSON.stringify(lines[i]))
fs.writeFileSync(f, lines.join('\n'), 'utf8')
// 全文件再列一遍还在引号里的 `?`，供后续补字参考
let inStr = 0
const list = []
for (let k = 0; k < lines.length; k++) {
  const L = lines[k]
  let p = 0, q = null
  while (p < L.length) {
    const c = L[p]
    if (q) { if (c === '\\') p++; else if (c === q) q = null }
    else if (c === "'" || c === '"' || c === '`') q = c
    else if (L[p] === '?' && k > 0) { list.push((k + 1) + '|' + L.slice(Math.max(0, p - 26), p + 8)); inStr++ }
    p++
  }
}
console.log('仍在引号/代码位置的 ? 共 ' + inStr + ' 处（前 40 条）:')
console.log(list.slice(0, 40).join('\n'))
