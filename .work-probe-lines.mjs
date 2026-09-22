// 探针：看看会话 jsonl 一行的结构，确定"助手正文"落在哪个字段。
import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'

const logs = listSessionLogs()
console.log('会话日志数: ' + logs.length)
// 优先看酒馆预设那条最长的真实角色扮演会话
const prefer = logs.filter(l => /tavern/i.test(l.project))
console.log('酒馆预设会话数: ' + prefer.length)
const pick = (prefer.length ? prefer : logs)[0]
console.log('取样: ' + pick.file)

const { lines, frames, failed } = readSessionLines(pick.file)
console.log('帧数=' + frames + ' 解压失败帧=' + failed + ' 行数=' + lines.length)
const types = new Map()
for (const l of lines) {
  const t = l.type || l.kind || '?'
  types.set(t, (types.get(t) || 0) + 1)
}
console.log('行类型分布: ' + JSON.stringify([...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)))

// 打印每种类型一行的键
const seen = new Set()
for (const l of lines) {
  const t = l.type || l.kind || '?'
  if (seen.has(t)) continue
  seen.add(t)
  console.log('\n--- type=' + t + ' keys=[' + Object.keys(l).join(',') + '] ---')
  console.log(JSON.stringify(l).slice(0, 600))
}
