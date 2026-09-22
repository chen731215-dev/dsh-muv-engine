// 修 `.fixed.mjs` 的第一行（被往返弄丢首字符，留下一个裸 `?` 在注释之前 → 语法错）
import fs from 'node:fs'
const src = 'C:\\dsh-muv-engine\\verify-frame-size.fixed.mjs'
const dst = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
let t = fs.readFileSync(src, 'utf8')
if (t[0] === '?') t = t.slice(1)
// 顺手把开头那行里明显丢字的「锟?」类占位标注出来（不改，只报告）
fs.writeFileSync(dst, t, 'utf8')
const lines = t.split('\n')
console.log('写入 ' + dst + ' 行数=' + lines.length + ' 首行=' + JSON.stringify(lines[0].slice(0, 40)))
const q = []
for (let i = 0; i < lines.length; i++) if (lines[i].indexOf('?') >= 0) q.push(i + 1)
console.log('还有 ' + q.length + ' 行含 ?：' + q.join(','))
