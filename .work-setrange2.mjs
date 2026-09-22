// 用 .work-line.txt 的内容替换目标文件的 [start,end] 行（1-based，含两端）
// 用法：node .work-setrange2.mjs <目标文件> <start> <end>
import fs from 'node:fs'
const f = process.argv[2]
const a = Number(process.argv[3]), b = Number(process.argv[4])
const text = fs.readFileSync('C:\\dsh-muv-engine\\.work-line.txt', 'utf8').replace(/\r?\n$/, '')
const lines = fs.readFileSync(f, 'utf8').split('\n')
console.log(f.split('\\').pop() + ' 替换 ' + a + '-' + b + ' 行（' + (b - a + 1) + ' 行）为新文本 ' + text.split('\n').length + ' 行')
lines.splice(a - 1, b - a + 1, ...text.split('\n'))
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('总行数 ' + lines.length)
