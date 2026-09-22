// 静态扫：注释里是否还残留代码（升级版，把 var/let/if/}/]/) 都算上）
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
const pats = [
  { n: 'const声明', re: /\/\/.*\bconst\s+\w+\s*=/ },
  { n: 'var声明', re: /\/\/.*\bvar\s+\w+\s*=/ },
  { n: 'let声明', re: /\/\/.*\blet\s+\w+\s*=/ },
  { n: 'check调用', re: /\/\/.*\bcheck\(/ },
  { n: 'console调用', re: /\/\/.*\bconsole\.log\(/ },
  { n: 'for/if', re: /\/\/.*\b(for|if)\s*\(/ },
  { n: 'return', re: /\/\/.*\breturn\b/ },
  { n: 'process.exit', re: /\/\/.*process\.exit/ },
  { n: '行尾花括号', re: /\/\/.*[;{]\s*$/ },
]
let n = 0
for (let i = 0; i < lines.length; i++) {
  for (const p of pats) {
    if (p.re.test(lines[i])) {
      n++
      console.log((i + 1) + ' [' + p.n + '] ' + lines[i].replace(/\s+/g, ' ').slice(0, 140))
      break
    }
  }
}
console.log('命中 ' + n + ' 行')
