// 语法医生：给定行号，把「被吃掉的收尾引号」补回去（`?` 紧邻 , / ) / 行尾 且整行引号数为奇）
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const ln = Number(process.argv[2])
const lines = fs.readFileSync(f, 'utf8').split('\n')
const i = ln - 1
const L = lines[i]
if (!L) { console.log('行号越界'); process.exit(2) }
const par = (L.match(/'/g) || []).length % 2
let hit = -1
for (let p = 0; p < L.length; p++) {
  if (L[p] !== '?') continue
  const n = L[p + 1]
  if (n === ',' || n === ')' || n === undefined) hit = p
}
if (hit < 0 || par === 0) {
  console.log('找不到可修位置（引号奇偶=' + par + '）: ' + JSON.stringify(L.slice(0, 120)))
  process.exit(3)
}
lines[i] = L.slice(0, hit) + "'" + L.slice(hit + 1)
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('修好第 ' + ln + ' 行: ' + JSON.stringify(lines[i].trim().slice(0, 120)))
