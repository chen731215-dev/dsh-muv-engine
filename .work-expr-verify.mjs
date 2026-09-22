import fs from 'node:fs'
const src = fs.readFileSync('verify-card-compat.mjs', 'utf8')
const re = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
let m
let n = 0
while ((m = re.exec(src))) {
  n++
  const t = m[2]
  let ok = true
  try { new Function('a', 'b', 'return ' + t + ';') } catch (_) { ok = false }
  // 语义冒烟：在假 window/document/localStorage 下求值，必须返回一个字符串
  let sem = ''
  try {
    const f = new Function('window', 'document', 'localStorage', 'return ' + t + ';')
    const win = { cgGetCache: () => 'v', parent: null }
    sem = typeof f(win, { documentElement: { style: {} } }, { getItem: () => null }) === 'string' ? 'STRING' : 'NOT-STRING'
  } catch (e) { sem = 'THROW:' + e.name }
  console.log('#' + n + ' ' + (ok ? 'OK ' : 'BAD') + ' ' + sem.padEnd(10) + ' tail=' + JSON.stringify(t.slice(-16)))
}
