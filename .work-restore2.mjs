// 用原件（.work-frame-size-pristine.mjs）补回"改动前就存在"的行里被吞掉的单字。
// 做法：**只做前后缀夹逼的中间段替换** —— 当前行 D 与原件行 P 若满足
//   D 的公共前缀 + 公共后缀 ≈ D 全长（只差中间一小段），且 P 比 D 长（P 多出来的正是丢的字），
// 就把 D 换成 P。这样绝不会删掉我自己新加的代码（新代码行在原件里找不到这种夹逼关系）。
// 输入用还原前的备份，保证可重复；输出写回 verify-frame-size.mjs。
import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const P = fs.readFileSync(dir + '.work-frame-size-pristine.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const D = fs.readFileSync(dir + '.work-frame-size-before-restore.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')

function lcp(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
function lcs(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i }

let fixed = 0, ambiguous = 0, none = 0
const log = []
for (let i = 0; i < D.length; i++) {
  const d = D[i]
  if (!d.includes('?') || !d.trim() || d.trim().startsWith('//') === false && d.includes('?') === false) { /* 继续 */ }
  if (!d.includes('?')) continue
  const cands = []
  for (const p of P) {
    if (!p.includes('?') && p.length <= d.length) continue
    const a = lcp(d, p)
    const b = lcs(d, p)
    if (a + b < d.length - 4) continue          // 差异不止"中间一小段"
    if (p.length <= d.length) continue           // 原件必须更长（正是被吞掉的字）
    if (p.length - d.length > 12) continue       // 差太多就不是同一行
    const mid = p.slice(a, p.length - b)
    if (!mid) continue
    cands.push({ p, score: p.length - d.length, mid })
  }
  if (cands.length === 1) {
    D[i] = cands[0].p
    fixed++
    log.push('补 ' + (i + 1) + ': ' + JSON.stringify(d.slice(0, 70)) + '  ⇒  ' + JSON.stringify(cands[0].p.slice(0, 70)) + '   中间填=' + JSON.stringify(cands[0].mid))
  } else if (cands.length > 1) {
    ambiguous++
    log.push('!! 歧义 ' + (i + 1) + '（' + cands.length + ' 个候选）: ' + JSON.stringify(d.slice(0, 70)))
  } else none++
}
fs.writeFileSync(dir + '.work-restore2-report.txt', log.join('\n'), 'utf8')
fs.writeFileSync(dir + 'verify-frame-size.mjs', D.join('\n'), 'utf8')
console.log('补回=' + fixed + '  歧义=' + ambiguous + '  没找到夹逼关系=' + none)
console.log('剩余 ? 数=' + (D.join('\n').match(/\?/g) || []).length + '（原件 5）  行数=' + D.length)
