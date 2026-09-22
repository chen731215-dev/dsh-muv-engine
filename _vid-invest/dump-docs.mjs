// 从真卡里抽出「主页」文档（regex[0]）与「视频」正则产出，落盘供复现使用。
import fs from 'node:fs'
import path from 'node:path'
const DIR = 'C:\\dsh-muv-engine\\_vid-invest\\cards'
const OUT = 'C:\\dsh-muv-engine\\_vid-invest\\docs'
fs.mkdirSync(OUT, { recursive: true })

const card = JSON.parse(fs.readFileSync(path.join(DIR, '_足控天堂2.png.json'), 'utf8'))
const d = card.data || card
const scripts = d.extensions.regex_scripts

for (let i = 0; i < scripts.length; i++) {
  const rs = String(scripts[i].replaceString || '')
  if (!rs) continue
  const name = scripts[i].scriptName || ('regex' + i)
  fs.writeFileSync(path.join(OUT, 'regex' + i + '.txt'), rs, 'utf8')
  console.log('--- regex[' + i + '] ' + name + ' len=' + rs.length)
  console.log('    head: ' + JSON.stringify(rs.slice(0, 160)))
  console.log('    tail: ' + JSON.stringify(rs.slice(-120)))
  const idx = rs.indexOf('<video')
  if (idx >= 0) console.log('    first <video> @' + idx + ': ' + JSON.stringify(rs.slice(idx, idx + 260)))
  const i2 = rs.indexOf('<video', idx + 1)
  if (i2 >= 0) console.log('    next  <video> @' + i2 + ': ' + JSON.stringify(rs.slice(i2, i2 + 220)))
}
