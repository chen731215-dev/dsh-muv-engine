// 精确分类：把"真的在跑角色扮演的会话"挑出来（判据：会话里出现过酒馆预设注入
// 的「角色扮演启动指令」），再在**这些会话**里找媒体标记，排除开发会话的代码文本。
import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'
import fs from 'node:fs'

const OLD = /<StatusPlaceHolder|<\/?now_plot\b|<\/?content\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i
const NEW = /<[a-zA-Z_][\w:.-]*(\s[^>]*)?>/

const MARKS = [
  ['audio', /<audio\b/gi],
  ['img', /<img\b/gi],
  ['video', /<video\b/gi],
  ['content', /<\/?content\b/gi],
  ['now_plot', /<\/?now_plot\b/gi],
  ['choices', /<choices?\b/gi],
  ['Status_block', /<Status_?Block/gi],
  ['PHImpl', /<StatusPlaceHolderImpl\s*\/?>/gi],
  ['Abstract', /<Abstract\b/gi],
  ['VariableThink', /<VariableThink\b/gi],
  ['VariableInsert', /<VariableInsert\b/gi],
  ['VariableEdit', /<VariableEdit\b/gi],
  ['主页', /【主页】/g],
  ['era_data', /<era_data\b/gi],
]

const rows = []
let rpSessions = 0
for (const l of listSessionLogs()) {
  let r
  try { r = readSessionLines(l.file) } catch (e) { continue }
  const blob = JSON.stringify(r.lines.filter(x => x.type === 'system/message' || x.type === 'user/message')).slice(0, 400000)
  const isRP = blob.indexOf('角色扮演启动指令') >= 0
  if (isRP) rpSessions++
  for (const line of r.lines) {
    if (line.type !== 'assistant/message') continue
    const content = line.data && line.data.message && line.data.message.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || part.type !== 'text') continue
      const t = String(part.text || '')
      if (t.length < 30) continue
      const hits = {}
      for (const [name, re] of MARKS) { re.lastIndex = 0; const m = t.match(re); if (m) hits[name] = m.length }
      if (!Object.keys(hits).length) continue
      rows.push({ session: l.session, project: l.project, isRP, len: t.length, hits, old: OLD.test(t), new: NEW.test(t), text: t })
    }
  }
}
console.log('角色扮演会话数: ' + rpSessions + ' / ' + listSessionLogs().length)
console.log('带标记的助手正文段: ' + rows.length + '（其中来自角色扮演会话的 ' + rows.filter(r => r.isRP).length + '）')

const groups = {}
for (const r of rows) {
  if (!r.isRP) continue
  const key = Object.keys(r.hits).sort().join('+')
  groups[key] = groups[key] || []
  groups[key].push(r)
}
console.log('\n=== 角色扮演会话里，带标记的助手正文：按标记组合分组 ===')
for (const k of Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)) {
  const g = groups[k]
  const skipped = g.filter(r => !r.old).length
  console.log('  ' + String(g.length).padStart(4) + ' 组[' + k + ']  旧守卫会跳过 ' + skipped + ' 条')
  if (skipped) {
    for (const r of g.filter(x => !x.old).slice(0, 6)) {
      console.log('        [' + r.len + '字] ' + r.session.slice(0, 20) + ' ' + r.project.slice(0, 40))
      console.log('          ' + JSON.stringify(r.text.slice(0, 130)))
    }
  }
}

// 非角色扮演会话里、旧守卫会跳过的（用来抓"上一次父代理把开发会话算进去"的那个坑）
const devBad = rows.filter(r => !r.isRP && !r.old)
console.log('\n=== 非角色扮演会话里旧守卫会跳过的: ' + devBad.length + ' 条（这些**不算**真实样本）===')
const devGroups = {}
for (const r of devBad) { const k = Object.keys(r.hits).sort().join('+'); devGroups[k] = (devGroups[k] || 0) + 1 }
console.log('  分布: ' + JSON.stringify(devGroups))

fs.writeFileSync('.work-rp-rows.json', JSON.stringify(rows.filter(r => r.isRP), null, 1), 'utf8')
console.log('\n-> .work-rp-rows.json')
