// 临时：分类 verify-frame-size.fixed.mjs 里每个 `?`（丢失字符的占位）所在的位置：
//   comment  = 在 // 之后 → 无害（只是注释缺一个字）
//   string   = 在引号里 → 只要没吃掉引号就只是文案缺字
//   CODE     = 在代码位置 → 必须修（可能吃掉的是引号/运算符）
import fs from 'node:fs'

const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
let comment = 0, str = 0, code = 0
const codeList = []
for (let i = 0; i < lines.length; i++) {
  const L = lines[i]
  if (L.indexOf('?') < 0) continue
  for (let p = 0; p < L.length; p++) {
    if (L[p] !== '?') continue
    const before = L.slice(0, p)
    // 注释位置？（// 或 /* 之后，且不在引号里）
    let inStr = null, j = 0
    while (j < p) {
      const c = L[j]
      if (inStr) { if (c === '\\') j++; else if (c === inStr) inStr = null }
      else if (c === "'" || c === '"' || c === '`') inStr = c
      else if (c === '/' && L[j + 1] === '/') break
      j++
    }
    const isComment = j < p && L[j] === '/' && L[j + 1] === '/'
    if (isComment) comment++
    else if (inStr) str++
    else { code++; codeList.push((i + 1) + ': ' + L.trim().slice(0, 150)) }
  }
}
console.log('注释里=' + comment + '  字符串里=' + str + '  代码位置=' + code)
console.log('---- 代码位置的 ? ----')
for (const c of codeList) console.log(c)
