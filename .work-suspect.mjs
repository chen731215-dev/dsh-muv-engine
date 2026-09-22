// 一次性列出「`?` 紧跟在引号本该收尾的位置」的可疑行（被吃掉的通常是 汉字 + `'`）
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
const bad = []
for (let i = 0; i < lines.length; i++) {
  const L = lines[i]
  if (L.indexOf('?') < 0) continue
  // 逐字符走，遇到 `?` 时判断：这一行在这个位置之后是不是直接跟 , 或 ) 且**引号数为奇**
  const stripped = L.replace(/\/\/.*$/, '')
  const q = (stripped.match(/'/g) || []).length + (stripped.match(/"/g) || []).length
  const re = /\?(?=[,)\s]*$|\?[,)])/g
  if (re.test(L) && q % 2 === 1) bad.push({ n: i + 1, L: L.trim() })
}
console.log('可疑行 ' + bad.length + ' 条：')
for (const b of bad) console.log(b.n + ': ' + b.L.slice(0, 160))
