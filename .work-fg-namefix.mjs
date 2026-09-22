import fs from 'node:fs'
const p = 'C:\\dsh-muv-engine\\verify-frame-gap.mjs'
let s = fs.readFileSync(p, 'utf8')
const before = s
const reps = [
  ['rows.push({ card: f.card, script: f.script,', 'rows.push({ cardName: f.card, script: f.script,'],
  ["console.log('  ' + (r.card + ' / ' + r.script).padEnd(42) +", "console.log('  ' + (r.cardName + ' / ' + r.script).padEnd(42) +"],
  ['--- ${r.card} / ${r.script}', '--- ${r.cardName} / ${r.script}'],
  [".map((r) => r.card + '/' + r.script + '=-'", ".map((r) => r.cardName + '/' + r.script + '=-'"],
  ['rows.map((r) => [r.card, r.reported, r.docScroll, r.bboxMax])', "rows.map((r) => [r.cardName + '/' + r.script, r.reported, r.docScroll, r.bboxMax])"],
  ["rows.map((r) => r.card + '/' + r.script + ' 包盒max='", "rows.map((r) => r.cardName + '/' + r.script + ' 包盒max='"],
]
for (const [a, b] of reps) {
  if (!s.includes(a)) { console.log('!! 没找到: ' + a.slice(0, 60)); continue }
  s = s.split(a).join(b)
}
if (s === before) throw new Error('一个替换都没生效')
fs.writeFileSync(p, s, 'utf8')
console.log('已改写 display 字段。剩余引用 r.card（= 探针对象，应当只出现在差值定位段）的行：')
s.split('\n').forEach((x, i) => { if (/r\.card(?!Name)/.test(x)) console.log('  ' + (i + 1) + ': ' + x.trim()) })
