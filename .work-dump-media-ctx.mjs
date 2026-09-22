// 打捞细节：真实角色扮演轮里 <audio>/<video>/<img> 的上下文。
import fs from 'node:fs'
const rows = JSON.parse(fs.readFileSync('.work-rp-rows.json', 'utf8'))

function ctx(t, re, n = 3) {
  const out = []
  let m
  re.lastIndex = 0
  while ((m = re.exec(t)) && out.length < n) {
    out.push(JSON.stringify(t.slice(Math.max(0, m.index - 120), m.index + m[0].length + 160)))
  }
  return out
}

// 排除明显开发文本
const DEV = /\[(PASS|FAIL|OK|warn)\]|^\s*(Now|Let me|I'll|The |Arm |Both )|```(js|javascript|mjs|json)\b|已发给父代理|报告已发给|probe|源码|行号|grep|fixture|正则/m

console.log('=== ① 旧守卫会跳过、且不是开发文本的（真实失败样本候选）===')
for (const r of rows) {
  if (r.old) continue
  if (DEV.test(r.text)) continue
  console.log('\n----- ' + r.len + '字 ' + r.session + ' ' + JSON.stringify(r.hits))
  console.log(r.text.slice(0, 520))
  for (const k of ['audio', 'video', 'img']) {
    if (r.hits[k]) for (const c of ctx(r.text, new RegExp('<' + k + '\\b[^>]*>[\\s\\S]*?<\\/' + k + '>', 'gi'))) console.log('   <' + k + '>: ' + c)
  }
  console.log('   ...尾部...\n   ' + JSON.stringify(r.text.slice(-260)))
}

console.log('\n\n=== ② 含 <video>/<img> 且旧守卫放行（= 已经能被美化的真实轮）===')
for (const r of rows) {
  if (!r.hits.video && !r.hits.img) continue
  if (DEV.test(r.text)) continue
  console.log('\n----- ' + r.len + '字 ' + r.session + ' old=' + r.old + ' ' + JSON.stringify(r.hits))
  console.log(r.text.slice(0, 300))
  for (const k of ['video', 'img', 'audio']) {
    if (r.hits[k]) for (const c of ctx(r.text, new RegExp('<' + k + '\\b[^>]*>[\\s\\S]*?<\\/' + k + '>', 'gi'))) console.log('   <' + k + '>: ' + c)
  }
}

console.log('\n\n=== ③ 所有含 <audio> 的真实轮（不管守卫放不放行、是不是开发文本）===')
for (const r of rows) {
  if (!r.hits.audio) continue
  const dev = DEV.test(r.text)
  console.log('\n----- ' + r.len + '字 old=' + r.old + ' dev=' + dev + ' ' + r.session + ' ' + JSON.stringify(r.hits))
  for (const c of ctx(r.text, /<audio\b[^>]*>[\s\S]*?<\/audio>/gi, 2)) console.log('   audio: ' + c)
}
