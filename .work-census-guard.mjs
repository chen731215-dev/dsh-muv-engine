// 人口普查：全库真实**助手正文**里，旧守卫会跳过、新守卫会放行的那些。
// 纪律：只用**真实角色扮演回复**（tavern 预设会话 / 真卡会话），排除开发会话里的代码文本。
import { listSessionLogs, readSessionLines } from './.work-frame-split.mjs'
import fs from 'node:fs'

const OLD_GUARD = /<StatusPlaceHolder|<\/?now_plot\b|<\/?content\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i

const MARKS = [
  ['audio', /<audio\b[^>]*>[\s\S]*?<\/audio>|<audio\b[^>]*\/?>/i],
  ['img', /<img\b[^>]*>/i],
  ['video', /<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/?>/i],
  ['content', /<\/?content\b/i],
  ['now_plot', /<\/?now_plot\b/i],
  ['choices', /<choices?\b/i],
  ['Status_block', /<Status_?Block/i],
  ['StatusPlaceHolderImpl', /<StatusPlaceHolderImpl\s*\/?>/i],
  ['Abstract', /<Abstract\b/i],
  ['variableinsert', /<variableinsert\b/i],
  ['variableedit', /<variableedit\b/i],
  ['variabledelete', /<variabledelete\b/i],
  ['variablethink', /<variablethink\b/i],
  ['era_data', /<era_data\b/i],
]

const logs = listSessionLogs()
const rows = []
let scanned = 0
for (const l of logs) {
  let r
  try { r = readSessionLines(l.file) } catch (e) { continue }
  scanned++
  for (const line of r.lines) {
    if (line.type !== 'assistant/message') continue
    const content = line.data && line.data.message && line.data.message.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || part.type !== 'text') continue
      const t = String(part.text || '')
      if (t.length < 40) continue
      const hits = {}
      for (const [name, re] of MARKS) if (re.test(t)) hits[name] = (t.match(new RegExp(re.source, 'gi')) || []).length
      rows.push({
        file: l.file, project: l.project, session: l.session, mtime: l.mtime,
        len: t.length, hits, old: OLD_GUARD.test(t),
        dev: /```\s*(js|javascript|mjs|json|ts)\b|function\s+\w+\s*\(|\brequire\(|\bimport\s+\{/.test(t),
        text: t,
      })
    }
  }
}
console.log('扫描会话 ' + scanned + ' / ' + logs.length + '；助手正文段 ' + rows.length)

const isTavern = r => /tavern/i.test(r.project) || /preset/i.test(r.project)
const tavernRows = rows.filter(isTavern)
console.log('其中来自酒馆预设会话的: ' + tavernRows.length)
console.log('项目目录分布(酒馆):')
const byProj = new Map()
for (const r of tavernRows) byProj.set(r.project, (byProj.get(r.project) || 0) + 1)
for (const [k, v] of [...byProj.entries()].sort((a, b) => b[1] - a[1])) console.log('  ' + v + '  ' + k)

// 关键切片：**有标记但旧守卫跳过**的
for (const [label, pool] of [['酒馆会话', tavernRows], ['全部会话', rows]]) {
  console.log('\n=== ' + label + '：旧守卫会跳过（old=false）但带标记的 ===')
  const cand = pool.filter(r => !r.old && Object.keys(r.hits).length > 0)
  const cnt = new Map()
  for (const r of cand) for (const k of Object.keys(r.hits)) cnt.set(k, (cnt.get(k) || 0) + 1)
  console.log('  条数: ' + cand.length + '  标记分布: ' + JSON.stringify([...cnt.entries()].sort((a, b) => b[1] - a[1])))
  const nonDev = cand.filter(r => !r.dev)
  console.log('  其中非"开发代码文本"形态的: ' + nonDev.length)
  for (const r of nonDev.slice(0, 12)) {
    console.log('  --- ' + r.len + '字 ' + Object.keys(r.hits).join(',') + ' [' + r.session.slice(0, 18) + '] ' + r.project.slice(0, 46))
    console.log('      ' + JSON.stringify(r.text.slice(0, 160)))
  }
}

fs.writeFileSync('.work-census-rows.json', JSON.stringify(rows.map(r => ({ ...r, text: r.text.slice(0, 4000) })), null, 0), 'utf8')
console.log('\n明细 -> .work-census-rows.json')
