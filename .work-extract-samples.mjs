// 把本轮要用的**真实样本**从会话存档里解出来，并打印全部 `<…>` 形态（确认新判据的命中面）。
import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'
import fs from 'node:fs'

const TARGET = 'c98dfb13'
const DEV = /\[(PASS|FAIL|OK|warn)\]|^\s*(Now|Let me|I'll|The |Arm |Both )|```(js|javascript|mjs|json)\b|已发给父代理|报告已发给|probe|fixture|正则|源码|行号|grep/m

const found = { audioOnly: null, mediaEnvelope: null, proseOnly: null, proseList: [] }
for (const l of listSessionLogs()) {
  if (l.session.indexOf(TARGET) < 0) continue
  const r = readSessionLines(l.file)
  for (const line of r.lines) {
    if (line.type !== 'assistant/message') continue
    const content = line.data && line.data.message && line.data.message.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || part.type !== 'text') continue
      const t = String(part.text || '')
      if (t.length < 30) continue
      if (/<audio>欢快<\/audio>/.test(t) && !/<content/.test(t) && !/<now_plot/.test(t)) found.audioOnly = t
      if (/<content/.test(t) && /<video>/.test(t) && /<img>/.test(t)) found.mediaEnvelope = t
      // 纯散文候选：一个 <…> 形态都没有、不是开发文本、长度够
      if (!/</.test(t) && !DEV.test(t) && t.length > 600) found.proseList.push(t)
    }
  }
}
const L = s => (s ? s.length : 0)
console.log('audioOnly(真实失败样本): ' + L(found.audioOnly))
console.log('mediaEnvelope(同会话、守卫放行的那轮): ' + L(found.mediaEnvelope))
console.log('纯散文候选: ' + found.proseList.length + ' 条，长度 ' + JSON.stringify(found.proseList.map(L)))

function angles(t, tag) {
  const out = []
  const re = /<[^<>\n]{0,60}>/g
  let m
  while ((m = re.exec(t))) out.push(m[0])
  const uniq = [...new Set(out)]
  console.log('  ' + tag + ' 里的 <…> 形态: ' + uniq.length + ' 种')
  for (const u of uniq) console.log('     ' + JSON.stringify(u))
}
if (found.audioOnly) angles(found.audioOnly, 'audioOnly')
const NEW = /<[a-zA-Z_][\w:.-]*(\s[^>]*)?>/
console.log('\n新判据命中 audioOnly? ' + (found.audioOnly ? NEW.test(found.audioOnly) : 'n/a'))
if (found.proseList.length) {
  const p = found.proseList[0]
  console.log('纯散文候选命中新判据? ' + NEW.test(p) + '（应 false）')
  console.log('纯散文样本开头: ' + JSON.stringify(p.slice(0, 120)))
}
fs.writeFileSync('.work-samples.json', JSON.stringify({
  audioOnly: found.audioOnly, mediaEnvelope: found.mediaEnvelope, proseOnly: found.proseList[0] || null,
  proseCandidates: found.proseList.length,
}, null, 1), 'utf8')
console.log('\n-> .work-samples.json')
