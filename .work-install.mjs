// 装上修好的 verify-frame-size.mjs：把坏掉的那份留成 .work-frame-size-corrupt.bak（不删，便于对照），
// 再把 fixed2 复制为正式文件。全程 Node + utf8，不经 PowerShell 文本读写。
import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const good = fs.readFileSync(dir + 'verify-frame-size.fixed2.mjs', 'utf8')
const cur = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8')
const holes = (s) => (s.match(/\?/g) || []).length
console.log('当前 verify-frame-size.mjs（坏）: ' + Buffer.byteLength(cur, 'utf8') + ' 字节, ? 数=' + holes(cur))
console.log('待装 fixed2: ' + Buffer.byteLength(good, 'utf8') + ' 字节, ? 数=' + holes(good))
fs.writeFileSync(dir + '.work-frame-size-corrupt.bak', cur, 'utf8')
fs.writeFileSync(dir + 'verify-frame-size.mjs', good, 'utf8')
const back = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8')
console.log('装入后校验: 与原 fixed2 相同? ' + (back === good) + '  行数=' + back.split('\n').length)
console.log('check( 出现次数=' + (back.match(/check\(/g) || []).length + '  console.log=' + (back.match(/console\.log/g) || []).length)
