// A 步：把真卡的 regex 脚本按服务端**同一份代码**跑一遍，看视频声明活下来没有。
// 用的是 lib/regex-engine.js（服务端 /api/muv-engine/apply-regex-card 的同一个函数）。
import fs from 'node:fs'
import path from 'node:path'
import { applyAllRegexScripts, regexScriptsOf } from '../lib/regex-engine.js'

const card = JSON.parse(fs.readFileSync('C:\\dsh-muv-engine\\_vid-invest\\cards\\_足控天堂2.png.json', 'utf8'))
const scripts = regexScriptsOf(card)

console.log('=== 脚本清单（mode/placement/flags 原样）===')
scripts.forEach((s, i) => {
  console.log(`[${i}] name=${JSON.stringify(s.scriptName)} disabled=${s.disabled} markdownOnly=${s.markdownOnly} promptOnly=${s.promptOnly} placement=${JSON.stringify(s.placement)} len=${String(s.replaceString||'').length}`)
  console.log(`     findRegex=${JSON.stringify(String(s.findRegex||''))}`)
})

// 模型输出样本：带 <maintext>（卡片文档里声明的正文标签）+ 一条 <video> 指令 + <Status_block>
const MSG = `<maintext>
夜里的电台还在响，${'……'.repeat(3)}她转过身来。
<video>日常1</video>
</maintext>

<Status_block>
名字: "哈珂斯"
状态: "平静"
</Status_block>`

const out = applyAllRegexScripts(MSG, scripts, 'display')
const t = out.text
console.log('\n=== 服务端应用结果 ===')
console.log('applied=' + out.applied + ' len=' + t.length)
console.log('含 <video id="myVideo"      : ' + t.includes('<video id="myVideo"'))
console.log('含 myVideo                  : ' + (t.match(/myVideo/g) || []).length)
console.log('含 zyxjack123.top/…/视频/   : ' + (t.match(/zyxjack123\.top/g) || []).length)
console.log('含 裸 "<video>"（无属性）   : ' + (t.match(/<video>/g) || []).length)
console.log('含 ```（围栏）              : ' + (t.match(/```/g) || []).length)
console.log('含 <!DOCTYPE                : ' + (t.match(/<!DOCTYPE/gi) || []).length)

// 找出视频相关片段
for (const m of t.matchAll(/<video[^>]*>/g)) {
  console.log('  <video 标签 @' + m.index + ': ' + JSON.stringify(m[0].slice(0, 200)))
}
// 找出 视频 正则的产物
const i = t.indexOf('myVideo')
if (i >= 0) console.log('\n  [myVideo 上下文] ' + JSON.stringify(t.slice(Math.max(0, i - 260), i + 260)))

fs.writeFileSync('C:\\dsh-muv-engine\\_vid-invest\\docs\\server-out.txt', t, 'utf8')
