// ② v5：注释块替换加上**长度上限**，杜绝"长块顶替短行"造成的重复插入。
// 规则：命中率(覆盖被损坏行的比例) ≥ 0.85 且 原件块长度 ≤ 被损坏行长度 × 1.35。
import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const P = fs.readFileSync(dir + '.work-frame-size-pristine.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const D = fs.readFileSync(dir + '.work-frame-size-before-restore.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')

const runs = []
for (let i = 0; i < P.length; i++) {
  if (!P[i].trim().startsWith('//')) continue
  let j = i
  while (j + 1 < P.length && P[j + 1].trim().startsWith('//')) j++
  runs.push({ from: i, lines: P.slice(i, j + 1) })
  i = j
}
const bag = (s) => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) || 0) + 1); return m }
const cov = (runText, d) => {
  const mb = bag(d), ma = bag(runText)
  let hit = 0
  for (const [c, n] of ma) hit += Math.min(n, mb.get(c) || 0)
  return hit / Math.max(1, d.length)
}
function lcp(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
function lcs(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i }

let cmt = 0, str = 0, amb = 0
const log = []
for (let i = 0; i < D.length; i++) {
  const d = D[i]
  if (!d.includes('?')) continue
  if (d.trim().startsWith('//')) {
    const cands = runs
      .map((r) => ({ r, t: r.lines.join('') }))
      .filter(({ t }) => t.length <= d.length * 1.35)
      .map(({ r, t }) => ({ r, s: cov(t, d) }))
      .filter((x) => x.s >= 0.85)
      .sort((a, b) => b.s - a.s)
    const best = cands[0]
    if (best && (!cands[1] || cands[1].s < best.s - 0.02)) {
      D.splice(i, 1, ...best.r.lines)
      cmt++
      log.push('注释块 ' + (i + 1) + ' ← 原件 ' + (best.r.from + 1) + '（' + best.r.lines.length + ' 行，覆盖 ' + best.s.toFixed(2) + '）')
      i += best.r.lines.length - 1
    } else { amb++; log.push('!! 注释歧义 ' + (i + 1) + ' 最高=' + (best ? best.s.toFixed(2) : '0')) }
    continue
  }
  let best = null
  for (const p of P) {
    if (p.trim().startsWith('//')) continue
    const a = lcp(d, p), b = lcs(d, p)
    if (a + b < d.length - 8) continue
    if (p.length < d.length || p.length - d.length > 12) continue
    const s = a + b - (p.length - d.length)
    if (!best || s > best.s) best = { p, s }
  }
  if (best && best.p !== d) { D[i] = best.p; str++; log.push('字符串 ' + (i + 1) + ': ' + JSON.stringify(d.slice(0, 60)) + ' ⇒ ' + JSON.stringify(best.p.slice(0, 60))) }
}
// 重复行自检：替换不该造出"同一行出现两次"（原件本身就是唯一的）
const seen = new Map()
D.forEach((x, i) => { const k = x.trim(); if (k.length > 12 && k.startsWith('//')) seen.set(k, (seen.get(k) || 0) + 1) })
const dup = [...seen.entries()].filter(([, n]) => n > 1)
fs.writeFileSync(dir + '.work-restore5-report.txt', log.join('\n') + '\n\n重复注释行=' + JSON.stringify(dup.slice(0, 10)), 'utf8')
fs.writeFileSync(dir + 'verify-frame-size.mjs', D.join('\n'), 'utf8')
console.log('注释块恢复=' + cmt + '  字符串恢复=' + str + '  歧义跳过=' + amb)
console.log('行数=' + D.length + '  重复注释行=' + dup.length + '  ' + JSON.stringify(dup.slice(0, 6)))
const s2 = D.join('\n')
console.log('剩余 ? 数=' + (s2.match(/\?/g) || []).length + '（原件 5）  非 ASCII 紧邻 ? 的行=' +
  D.filter((x) => /[^\x00-\x7F]\?/.test(x) || x.includes('\uFFFD')).length)
