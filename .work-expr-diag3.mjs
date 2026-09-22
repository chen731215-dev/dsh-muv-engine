import fs from 'node:fs'
const src = fs.readFileSync('verify-card-compat.mjs', 'utf8')
const re = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
const items = []
let m
let n = 0
while ((m = re.exec(src))) {
  n++
  const t = m[2]
  let ok = true
  try { new Function('a', 'b', 'return ' + t + ';') } catch (_) { ok = false }
  items.push({ n, t, ok })
}
function depths(t) {
  let par = 0, br = 0, state = 'code'
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (state === 'code') {
      if (c === '"' || c === "'") { state = c; continue }
      if (c === '(') par++; else if (c === ')') par--
      else if (c === '{') br++; else if (c === '}') br--
    } else if (c === state) state = 'code'
  }
  return { par, br }
}
for (const it of items) {
  const d = depths(it.t)
  console.log('#' + it.n + ' ' + (it.ok ? 'OK  ' : 'BAD ') + 'len=' + it.t.length +
    ' 括号净深=' + d.par + ' 花括号净深=' + d.br + '  尾巴=' + JSON.stringify(it.t.slice(-24)))
}
