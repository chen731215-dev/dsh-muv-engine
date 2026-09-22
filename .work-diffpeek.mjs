import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const P = fs.readFileSync(dir + '.work-frame-size-pristine.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const D = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
function lcp(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
function lcs(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i }
let shown = 0
for (let i = 0; i < D.length && shown < 10; i++) {
  const d = D[i]
  if (!d.includes('?')) continue
  // 找原件里 LCS 最长的行
  let best = null
  for (const p of P) {
    const a = lcp(d, p), b = lcs(d, p)
    const s = a + b
    if (!best || s > best.s) best = { p, s, a, b }
  }
  shown++
  console.log('D' + (i + 1) + ' len=' + d.length + ' | ' + JSON.stringify(d))
  console.log('  P len=' + (best.p || '').length + ' 公共前缀=' + best.a + ' 公共后缀=' + best.b + ' | ' + JSON.stringify(best.p))
  console.log('  D中间=' + JSON.stringify(d.slice(best.a, d.length - best.b)))
  console.log('  P中间=' + JSON.stringify((best.p || '').slice(best.a, (best.p || '').length - best.b)))
}
