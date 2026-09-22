// 用 .work-line.txt 的内容替换 [start,end] 这段行（1-based，含两端），保持 UTF-8
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const a = Number(process.argv[2]), b = Number(process.argv[3])
const text = fs.readFileSync('C:\\dsh-muv-engine\\.work-line.txt', 'utf8').replace(/\r?\n$/, '')
const lines = fs.readFileSync(f, 'utf8').split('\n')
console.log('替换 ' + a + '-' + b + ' 行（' + (b - a + 1) + ' 行）为新文本 ' + text.split('\n').length + ' 行')
lines.splice(a - 1, b - a + 1, ...text.split('\n'))
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('总行数 ' + lines.length)
