// 在真卡全部字段里统计视频/媒体声明形态。
import fs from 'node:fs'
import path from 'node:path'
const DIR = 'C:\\dsh-muv-engine\\_vid-invest\\cards'

function walk(o, cb, pathStr = '$') {
  if (o == null) return
  if (typeof o === 'string') return cb(o, pathStr)
  if (Array.isArray(o)) return o.forEach((v, i) => walk(v, cb, pathStr + '[' + i + ']'))
  if (typeof o === 'object') return Object.keys(o).forEach(k => walk(o[k], cb, pathStr + '.' + k))
}

const PATS = [
  ['<video', /<video\b/gi],
  ['</video>', /<\/video>/gi],
  ['<source', /<source\b/gi],
  ['mp4', /\.mp4/gi],
  ['mp4-in-str', /mp4/gi],
  ['webm', /webm/gi],
  ['<audio', /<audio\b/gi],
  ['<iframe', /<iframe\b/gi],
  ['data:video', /data:video/gi],
  ['data:image', /data:image/gi],
  ['blob:', /blob:/gi],
  ['TavernHelper', /TavernHelper/g],
  ['getContext', /getContext\s*\(/g],
  ['SillyTavern', /SillyTavern/g],
  ['localStorage', /localStorage/g],
  ['createElement(video)', /createElement\(\s*['"`]video['"`]/gi],
  ['videojs', /videojs/gi],
  ['youtube', /youtube|youtu\.be/gi],
  ['bilibili', /bilibili|b23\.tv/gi],
  ['autoplay', /autoplay/gi],
  ['playsinline', /playsinline/gi],
]

for (const f of fs.readdirSync(DIR)) {
  const card = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  const per = {}
  const samples = {}
  walk(card, (s, p) => {
    for (const [name, re] of PATS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(s))) {
        per[name] = (per[name] || 0) + 1
        if (!samples[name]) samples[name] = []
        if (samples[name].length < 3) {
          samples[name].push({ at: p, ctx: s.slice(Math.max(0, m.index - 90), m.index + 130) })
        }
      }
    }
  })
  console.log('=== ' + f + ' ===')
  console.log(JSON.stringify(per, null, 1))
  for (const k of Object.keys(samples)) {
    if (k === 'localStorage' || k === 'getContext' || k === 'SillyTavern' || k === 'TavernHelper') continue
    console.log('  [' + k + ']')
    for (const s of samples[k]) console.log('    @' + s.at + '\n      ' + s.ctx.replace(/\n/g, '\\n'))
  }
}
