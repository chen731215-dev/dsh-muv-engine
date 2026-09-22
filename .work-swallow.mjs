// 找出「代码行被并进 // 注释里」的地方：一行中 `//` 之后还出现 check( / console.log( / ] / for( / const 等代码特征
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
const pat = /\/\/.*(check\(|console\.log\(|const |let |]|\bfor \(|return |process\.exit)/
let n = 0
for (let i = 0; i < lines.length; i++) {
  if (pat.test(lines[i])) {
    n++
    console.log((i + 1) + ': ' + lines[i].replace(/\s+/g, ' ').slice(0, 150))
  }
}
console.log('可疑（代码被注释吞掉）行数 = ' + n)
