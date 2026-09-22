// 用原件（.work-frame-size-pristine.mjs）把"改动前就存在"的行里被吞掉的单字补回来。
// 判据：把当前行里的 `?` 当成通配（`{0,2}` 个任意字符），其余字符逐字转义后做整体匹配；
//       只替换"唯一命中"的行；命中多行（骨架撞车）就跳过并报出来，绝不瞎猜。
// 新加的代码块在原件里没有对应行 ⇒ 匹配不到 ⇒ 原样保留。
import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const pristine = fs.readFileSync(dir + '.work-frame-size-pristine.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
const cur = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')

const esc = (s) => s.replace(/[.*+^${}()|[\]\\]/g, '\\$&')
function toRe(line) {
  // 逐字符拼：`?` 当通配，其余原样转义（`\` 要单独处理，别让转义符互相吃掉）
  let out = ''
  for (const ch of line) out += ch === '?' ? '.{0,2}' : esc(ch)
  return new RegExp('^' + out + '$')
}
const matches = new Map()
for (const p of pristine) {
  const key = p.trim()
  if (!key) continue
  if (!matches.has(key)) matches.set(key, [])
}
// 用"全表扫描"匹配数量少，先按 ASCII 骨架分桶：把非 ASCII 都去掉做成桶键
const bucket = (s) => s.replace(/[^\x00-\x7F]/g, '').replace(/\?/g, '')
const byBucket = new Map()
pristine.forEach((p, i) => {
  const b = bucket(p)
  if (!byBucket.has(b)) byBucket.set(b, [])
  byBucket.get(b).push({ i, line: p })
})

let fixed = 0, ambiguous = 0, noMatch = 0, untouched = 0
const report = []
for (let i = 0; i < cur.length; i++) {
  const line = cur[i]
  if (!line.includes('?')) { untouched++; continue }
  const cands = (byBucket.get(bucket(line)) || []).filter((c) => toRe(line).test(c.line))
  if (cands.length === 1) {
    cur[i] = cands[0].line
    fixed++
    report.push('补 ' + (i + 1) + ' ← 原件 ' + cands[0].i + ': ' + JSON.stringify(line.slice(0, 90)))
  } else if (cands.length > 1) {
    ambiguous++
    report.push('!! 跳过 ' + (i + 1) + '（命中 ' + cands.length + ' 行）: ' + JSON.stringify(line.slice(0, 90)))
  } else {
    noMatch++
  }
}
fs.writeFileSync(dir + 'verify-frame-size.mjs', cur.join('\n'), 'utf8')
fs.writeFileSync(dir + '.work-restore-report.txt', report.join('\n'), 'utf8')
console.log('补回行数=' + fixed + '  歧义跳过=' + ambiguous + '  匹配不到（多半是新加代码）=' + noMatch + '  行里没有 ? 的=' + untouched)
console.log('新文件行数=' + cur.length + ' 字符数=' + cur.join('\n').length)
console.log('剩余 ? 数=' + (cur.join('\n').match(/\?/g) || []).length + '（原件里的 ? 数=' + (pristine.join('\n').match(/\?/g) || []).length + '）')
