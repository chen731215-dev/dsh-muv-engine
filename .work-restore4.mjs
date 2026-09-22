// ② 用原件补回丢字：注释块按"整块替换"（连丢掉的换行一起恢复），代码行里的显示字符串按"前后缀夹逼"补中间。
// 只碰注释块与字符串，绝不改代码结构；原始输入用还原前备份，可重复跑。
import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const P = fs.readFileSync(dir + '.work-frame-size-pristine.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const D = fs.readFileSync(dir + '.work-frame-size-before-restore.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')

// ── 原件的注释块（连续 `//` 行）──
const runs = []
for (let i = 0; i < P.length; i++) {
  if (!P[i].trim().startsWith('//')) continue
  let j = i
  while (j + 1 < P.length && P[j + 1].trim().startsWith('//')) j++
  runs.push({ from: i, lines: P.slice(i, j + 1) })
  i = j
}
const bag = (s) => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) || 0) + 1); return m }
const score = (text, d) => {
  const mb = bag(d), ma = bag(text)
  let hit = 0
  for (const [c, n] of ma) hit += Math.min(n, mb.get(c) || 0)
  return hit / Math.max(1, d.length)
}
const runText = (r) => r.lines.join('')
const runScore = runs.map((r) => ({ r, t: runText(r) }))

function lcp(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
function lcs(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i }

let cmt = 0, str = 0, amb = 0
const log = []
for (let i = 0; i < D.length; i++) {
  const d = D[i]
  if (!d.includes('?')) continue
  if (d.trim().startsWith('//')) {
    const cands = runScore.map(({ r, t }) => ({ r, s: score(t, d) })).filter((x) => x.s >= 0.7)
    cands.sort((a, b) => b.s - a.s)
    const best = cands[0]
    if (best && (!cands[1] || cands[1].s < best.s - 0.02)) {
      D.splice(i, 1, ...best.r.lines)
      cmt++
      log.push('注释块 ' + (i + 1) + ' ← 原件 ' + (best.r.from + 1) + '（' + best.r.lines.length + ' 行，吻合 ' + best.s.toFixed(2) + '）')
      i += best.r.lines.length - 1
    } else { amb++; log.push('!! 注释歧义 ' + (i + 1) + ' 最高=' + (best ? best.s.toFixed(2) : '0')) }
    continue
  }
  // 代码行里的字符串：前后缀夹逼
  let best = null
  for (const p of P) {
    if (p.trim().startsWith('//')) continue
    const a = lcp(d, p), b = lcs(d, p)
    const cover = a + b
    if (cover < d.length - 8) continue
    if (p.length < d.length) continue
    if (p.length - d.length > 12) continue
    const s = cover - (p.length - d.length)
    if (!best || s > best.s) best = { p, s, a, b }
  }
  if (best && best.p !== d) {
    D[i] = best.p
    str++
    log.push('字符串 ' + (i + 1) + ': ' + JSON.stringify(d.slice(0, 60)) + ' ⇒ ' + JSON.stringify(best.p.slice(0, 60)))
  }
}
fs.writeFileSync(dir + '.work-restore4-report.txt', log.join('\n'), 'utf8')
fs.writeFileSync(dir + 'verify-frame-size.mjs', D.join('\n'), 'utf8')
console.log('注释块恢复=' + cmt + '  字符串恢复=' + str + '  歧义跳过=' + amb)
console.log('剩余 ? 数=' + (D.join('\n').match(/\?/g) || []).length + '（原件 5）  行数=' + D.length)
