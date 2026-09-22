// 通用「解吞」：行里出现 `?`（丢字标记）且**它之后**还有代码记号 ⇒ 在记号前插入换行。
// 只在 `?` 之后动刀，是为了不误伤正常注释里提到的代码（那种行的 `?` 之后一般没有代码）。
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const TOKENS = ['{', 'const ', "check('", 'console.log(', 'for (', 'if (', 'process.exit', 'return ', '])', '}']
let lines = fs.readFileSync(f, 'utf8').split('\n')
let total = 0
for (let round = 0; round < 6; round++) {
  let changed = 0
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const q = L.lastIndexOf('?')
    if (q >= 0 && !/^\s*$/.test(L) && L.trim().startsWith('//')) {
      let best = -1, tok = null
      for (const t of TOKENS) {
        const p = L.indexOf(t, q + 1)
        if (p > 0 && (best < 0 || p < best)) { best = p; tok = t }
      }
      // `{` 结尾这种（`…条件。（{`）也覆盖：token 是 `{`
      if (best > 0) {
        const head = L.slice(0, best).replace(/\s+$/, '')
        const tail = L.slice(best)
        out.push(head, '  ' + tail)
        changed++
        continue
      }
    }
    out.push(L)
  }
  lines = out
  total += changed
  console.log('第 ' + round + ' 轮拆开 ' + changed + ' 行')
  if (!changed) break
}
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('共拆 ' + total + ' 行，总行数 ' + lines.length)
