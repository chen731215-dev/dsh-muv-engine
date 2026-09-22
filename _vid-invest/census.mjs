import fs from 'node:fs'
import path from 'node:path'
const DIR = 'C:\\dsh-muv-engine\\_vid-invest\\cards'

function medias(s) {
  const out = []
  const re = /<(video|audio|source|iframe)\b[^>]*>/gi
  let m
  while ((m = re.exec(s))) out.push({ tag: m[1].toLowerCase(), tagText: m[0].replace(/\s+/g, ' ').slice(0, 300), at: m.index })
  return out
}

for (const f of fs.readdirSync(DIR)) {
  if (f.startsWith('default_')) continue
  const card = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  const d = card.data || card
  console.log('\n########## ' + f + ' ##########')
  console.log('first_mes len=' + String(d.first_mes || '').length + '  desc len=' + String(d.description || '').length)
  const alts = d.alternate_greetings || []
  alts.forEach((a, i) => console.log('  alt[' + i + '] len=' + String(a).length + ' medias=' + JSON.stringify(medias(String(a)).map(x => x.tagText))))
  console.log('  first_mes medias=' + JSON.stringify(medias(String(d.first_mes || '')).map(x => x.tagText)))
  const scripts = (d.extensions && d.extensions.regex_scripts) || []
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]
    const rs = String(s.replaceString || '')
    const ms = medias(rs)
    console.log('  --- regex[' + i + '] name=' + JSON.stringify(s.scriptName || s.name) + ' find=' + JSON.stringify(String(s.findRegex || '').slice(0, 90)) +
      ' len=' + rs.length + ' disabled=' + s.disabled + ' placement=' + JSON.stringify(s.placement))
    for (const x of ms) console.log('        [' + x.tag + '] @' + x.at + ' ' + x.tagText.slice(0, 220))
    // src assignment in JS
    const re2 = /\.src\s*=\s*([^;\n]{0,120})/gi
    let m2
    let c = 0
    while ((m2 = re2.exec(rs)) && c < 12) { console.log('        [js .src=] ' + m2[0].replace(/\s+/g, ' ').slice(0, 160)); c++ }
    const re3 = /VID_BASE|IMG_BASE|BASE_URL\s*=\s*[^\n]{0,120}/g
    let m3
    let c3 = 0
    while ((m3 = re3.exec(rs)) && c3 < 8) { console.log('        [base] ' + m3[0].replace(/\s+/g, ' ').slice(0, 160)); c3++ }
  }
}
