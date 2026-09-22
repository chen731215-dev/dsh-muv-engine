import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'
const TARGET = 'c98dfb13'
const DEV = /\[(PASS|FAIL|OK|warn)\]|^\s*(Now|Let me|I'll|The |Arm |Both )|```(js|javascript|mjs|json)\b|已发给父代理|报告已发给|probe|fixture|正则|源码|行号|grep/m
const list = []
for (const l of listSessionLogs()) {
  if (l.session.indexOf(TARGET) < 0) continue
  const r = readSessionLines(l.file)
  for (const line of r.lines) {
    if (line.type !== 'assistant/message') continue
    const c = line.data && line.data.message && line.data.message.content
    if (!Array.isArray(c)) continue
    for (const p of c) {
      if (!p || p.type !== 'text') continue
      const t = String(p.text || '')
      if (!/</.test(t) && !DEV.test(t) && t.length > 600) list.push(t)
    }
  }
}
list.forEach((t, i) => {
  console.log('\n===== #' + i + ' len=' + t.length + ' =====')
  console.log(JSON.stringify(t.slice(0, 180)))
  console.log('   尾部: ' + JSON.stringify(t.slice(-140)))
})
