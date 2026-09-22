// 用 .work-line.txt（UTF-8，由 write 工具写入，不会被我搞坏编码）整行替换 fixed2 的第 N 行
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const ln = Number(process.argv[2])
const text = fs.readFileSync('C:\\dsh-muv-engine\\.work-line.txt', 'utf8').replace(/\r?\n$/, '')
const lines = fs.readFileSync(f, 'utf8').split('\n')
console.log('第 ' + ln + ' 行（旧）: ' + JSON.stringify((lines[ln - 1] || '').slice(0, 120)))
lines[ln - 1] = text
fs.writeFileSync(f, lines.join('\n'), 'utf8')
console.log('第 ' + ln + ' 行（新）: ' + JSON.stringify(text.slice(0, 120)))
