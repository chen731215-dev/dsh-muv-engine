// 预验：真实卡 + 真实回复 → 各用例会命中几条脚本、媒体 URL 映射成什么。
import fs from 'node:fs'
import { applyAllRegexScripts, regexScriptsOf } from './lib/regex-engine.js'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const CARD_PNG = 'C:/MySpecialFolder/SillyTavern/data/default-user/characters/_足控天堂2.png'
const card = readPngCard(CARD_PNG)
const scripts = regexScriptsOf(card)
console.log('真实卡脚本数: ' + scripts.length)
scripts.forEach((s, i) => console.log('  [' + i + '] ' + s.scriptName + '  find=' + String(s.findRegex).slice(0, 70)))

const S = JSON.parse(fs.readFileSync('verify-guard-samples.json', 'utf8'))
// innerText 近似：去掉 markdown 记号（DSH 渲染后 innerText 里就没有 ** / #### 了）
const innerText = (t) => t.split('\n').map(l => l.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '')).join('\n')
const imgLine = /<img>[^<\n]*<\/img>/.exec(S.mediaEnvelope)[0]
const videoLine = /<video>[^<\n]*<\/video>/.exec(S.mediaEnvelope)[0]
console.log('\n从真实那一轮里逐字取到的媒体行: ' + JSON.stringify(imgLine) + ' / ' + JSON.stringify(videoLine))

const cases = {
  A_audio_real: innerText(S.audioOnly),
  B_media_envelope: innerText(S.mediaEnvelope),
  C_media_bare: innerText(S.proseOnly) + '\n\n' + imgLine + '\n\n' + videoLine,
  D_prose_real: innerText(S.proseOnly),
  E_lt_notag: innerText(S.proseOnly) + '\n\n账上 3 < 5，a <= b，1 <2，x <y。',
}
const OLD = /<StatusPlaceHolder|<\/?now_plot\b|<\/?content\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i
const NEW = /<[!\/]?[a-zA-Z_\u4e00-\u9fa5][^<>]*>/
for (const [k, t] of Object.entries(cases)) {
  const r = applyAllRegexScripts(t, scripts, 'display', { depth: undefined })
  const urls = [...new Set((r.text.match(/https:\/\/zyxjack123\.top\/[^"'\s>]*/g) || []))]
  console.log('\n=== ' + k + ' === len=' + t.length + ' oldGuard=' + OLD.test(t) + ' newGuard=' + NEW.test(t))
  console.log('  applied=' + r.applied + ' len(out)=' + r.text.length + ' 状态栏占位符=' + /<StatusPlaceHolderImpl\s*\/>/.test(t))
  console.log('  映射出的 URL: ' + JSON.stringify(urls.slice(0, 4)))
  console.log('  产物里还有裸 <video>/<img>: ' + /<video>/.test(r.text) + ' / ' + /<img>/.test(r.text))
}
