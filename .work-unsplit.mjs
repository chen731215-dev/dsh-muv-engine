// 把被 `//` 注释吞掉的代码行拆出来：在这些行里「最后一次出现的 `?` + 代码记号」之前插入换行。
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const SPLIT = {
  43: 'console.log(',
  62: 'const noVh',
  69: 'console.log(',
  122: 'const cache',
  139: "check('",
  145: 'console.log(',
  196: 'const page',
  244: 'const scrollOver',
  251: 'const geomOver',
  265: 'const rewritten',
}
let lines = fs.readFileSync(f, 'utf8').split('\n')
const add = []
for (const k of Object.keys(SPLIT)) {
  const i = Number(k) - 1
  const tok = SPLIT[k]
  const L = lines[i]
  const p = L.indexOf(tok)
  if (p < 0) { console.log(k + ': 找不到 ' + tok + '，跳过'); continue }
  const head = L.slice(0, p).replace(/\s+$/, '')
  const tail = tok + L.slice(p + tok.length)
  add.push([i, head, tail])
}
// 从后往前插，行号不漂
add.sort((a, b) => b[0] - a[0])
for (const [i, head, tail] of add) {
  console.log('拆 ' + (i + 1) + ':\n  注释 → ' + JSON.stringify(head.slice(-60)) + '\n  代码 → ' + JSON.stringify(tail.slice(0, 80)))
  lines.splice(i, 1, head, '  ' + tail)
}
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('总行数 ' + lines.length)
