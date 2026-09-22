import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const A = fs.readFileSync(dir + '.work-frame-size-before-restore.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const B = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
// 逐行 LCS 对齐，只打印差异（替换/插入/删除）
const n = A.length, m = B.length
const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
let i = 0, j = 0, shown = 0
while (i < n && j < m) {
  if (A[i] === B[j]) { i++; j++; continue }
  // 收集一段差异
  const ai = i, bj = j
  while (i < n && j < m && A[i] !== B[j]) { j++ }
  const seg = B.slice(bj, j)
  console.log('A' + (ai + 1) + ' → B' + (bj + 1) + '   (删 ' + (ai - ai) + ' 行, 换入 ' + seg.length + ' 行)')
  for (const s of seg) console.log('   B: ' + s.slice(0, 150))
  if (++shown > 22) { console.log('… 还有更多差异'); break }
}
