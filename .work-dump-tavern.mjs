// 把酒馆预设会话里带标记的助手正文全列出来（找真实失败样本 / 真实可用样本）。
import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'
import fs from 'node:fs'

const OLD_GUARD = /<StatusPlaceHolder|<\/?now_plot\b|<\/?content\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i
const MARKS = [
  ['audio', /<audio\b[^>]*>[\s\S]*?<\/audio>|<audio\b[^>]*\/?>/gi],
  ['img', /<img\b[^>]*>/gi],
  ['video', /<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/?>/gi],
  ['content', /<\/?content\b/gi],
  ['now_plot', /<\/?now_plot\b/gi],
  ['choices', /<choices?\b/gi],
  ['Status_block', /<Status_?Block/gi],
  ['StatusPlaceHolderImpl', /<StatusPlaceHolderImpl\s*\/?>/gi],
  ['Abstract', /<Abstract\b/gi],
  ['variablethink', /<variablethink\b/gi],
  ['era_data', /<era_data\b/gi],
  ['VariableInsert', /<VariableInsert\b/g],
  ['VariableEdit', /<VariableEdit\b/g],
]

const ONLY = process.argv[2] || 'c98dfb13'
const out = []
for (const l of listSessionLogs()) {
  if (ONLY && l.session.indexOf(ONLY) < 0) continue
  let r
  try { r = readSessionLines(l.file) } catch (e) { continue }
  for (const line of r.lines) {
    if (line.type !== 'assistant/message') continue
    const content = line.data && line.data.message && line.data.message.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || part.type !== 'text') continue
      const t = String(part.text || '')
      if (t.length < 40) continue
      const hits = {}
      for (const [name, re] of MARKS) { re.lastIndex = 0; const m = t.match(re); if (m) hits[name] = m.length }
      out.push({ session: l.session, project: l.project, len: t.length, hits, old: OLD_GUARD.test(t), text: t })
    }
  }
}
console.log('会话(' + ONLY + ')助手正文段: ' + out.length)
for (const r of out) {
  console.log('  [' + r.len + '字] old=' + r.old + ' ' + (Object.keys(r.hits).length ? JSON.stringify(r.hits) : '(无标记)') + '  开头=' + JSON.stringify(r.text.slice(0, 60)))
}
const interesting = out.filter(r => Object.keys(r.hits).length > 0)
console.log('\n带标记的 ' + interesting.length + ' 条')
for (const r of interesting) {
  console.log('\n========== ' + r.len + '字 old=' + r.old + ' ' + JSON.stringify(r.hits) + ' ==========')
  console.log(r.text.slice(0, 700))
  console.log('   ...尾部...')
  console.log(r.text.slice(-400))
}
fs.writeFileSync('.work-tavern-rows.json', JSON.stringify(interesting, null, 1), 'utf8')
console.log('\n-> .work-tavern-rows.json')
