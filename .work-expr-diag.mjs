// 诊断：把这 8 条坏表达式**完整**打出来 + 括号深度轨迹，找到真正的不平衡点。
import fs from 'node:fs'
const src = fs.readFileSync('verify-card-compat.mjs', 'utf8')
const re = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
let m
let n = 0
while ((m = re.exec(src))) {
  n++
  const t = m[2]
  try { new Function('a', 'b', 'return ' + t + ';'); continue } catch (_) { /* 坏 */ }
  console.log('=== #' + n + ' (len ' + t.length + ') ===')
  console.log(JSON.stringify(t))
  // 深度轨迹（忽略字符串内容）
  let depth = 0, state = 'code', bad = -1
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (state === 'code') {
      if (c === '"' || c === "'") { state = c; continue }
      if (c === '(') depth++
      else if (c === ')') { depth--; if (depth < 0 && bad < 0) bad = i }
    } else if (c === state) state = 'code'
  }
  console.log('  末尾深度=' + depth + '  首次负深度位置=' + bad)
}
console.log('共 ' + n + ' 条')
