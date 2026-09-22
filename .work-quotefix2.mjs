// 修 13 处「吃掉了收尾引号」的丢失：这些行的引号数为奇 + `?` 紧邻 , 或 ) ⇒ 把该 `?` 补成 `'`
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const src = fs.readFileSync(f, 'utf8')
const lines = src.split('\n')
const SUSPECT = [49, 56, 63, 78, 135, 137, 142, 206, 225, 243, 251, 288, 289]
let fixed = 0
for (const n of SUSPECT) {
  const i = n - 1
  const L = lines[i]
  if (!L || L.indexOf('?') < 0) { console.log(n + ': 没有 ?，跳过'); continue }
  // 找最后一个「?,」或「?)」里的 ?
  const m = /(\?)(?=[,)])/.exec(L.split('').reverse().join(''))   // 用反转找最后一个
  const idx = m ? L.length - 1 - m.index : -1
  if (idx < 0) { console.log(n + ': 找不到 ?, / ?) 形态，跳过 → ' + L.trim().slice(0, 80)); continue }
  lines[i] = L.slice(0, idx) + "'" + L.slice(idx + 1)
  fixed++
  console.log(n + ': 补引号 → ' + lines[i].trim().slice(0, 90))
}
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('共补 ' + fixed + ' 处')
