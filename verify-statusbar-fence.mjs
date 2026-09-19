// 判定老法师的 BLOCKER 1：「状态栏整页 HTML 带裸围栏」到底会不会被用户看到。
//
// 分歧点（两边都对，但说的是不同路径）：
//   - `extractStatusBarHtml`（regex-engine.js:182）只解 ```` ```html ```` 围栏，真卡
//     「主页 / ERA 状态栏」用的是**裸 ```**，所以它的返回值**带着围栏**。
//   - 但客户端只在**消息里还剩 `<StatusPlaceHolderImpl/>`** 时才把这份 HTML 插进
//     iframe（client.js:652-661）。如果卡自己的正则已经把占位符替换掉了，这份带围栏
//     的 HTML 就根本不会被用到 —— 用户看不到。
//
// 所以判据不是「函数返回值带不带围栏」，而是「占位符会不会活到那一步」。这个脚本实测
// 后者：拿一条带占位符的消息跑真实正则，看占位符与围栏各自的去向。
//
// 运行：node verify-statusbar-fence.mjs

import { readdirSync } from 'node:fs'
import path from 'node:path'
import {
  regexScriptsOf,
  extractStatusBarHtml,
  isStatusPlaceholderScript,
  applyAllRegexScripts,
} from './lib/regex-engine.js'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const DIR = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/** 围栏形态：返回 {fence:'```'|'````'|null, lang:string} */
function fenceShape(s) {
  const m = /^\s*(`{3,})([a-zA-Z]*)[ \t]*\r?\n/.exec(String(s || ''))
  return m ? { fence: m[1], lang: m[2] } : { fence: null, lang: '' }
}
const isFullDoc = (s) => /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(String(s || '').replace(/^\s*`{3,}[a-zA-Z]*[ \t]*\r?\n/, ''))

const PNG = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png'))
console.log(`真卡 PNG：${PNG.length} 张\n`)

let affectedByLatentFence = 0   // extractStatusBarHtml 返回值确实带围栏
let affectedInPractice = 0      // 而且占位符活到了客户端插入那一步 → 用户真能看到
let totalScripts = 0            // 防空循环：这里必须是 0 才是失败

for (const file of PNG) {
  const full = path.join(DIR, file)
  let card
  try { card = readPngCard(full) } catch (e) { console.log(`--- ${file}  读取失败: ${e.message}`); continue }
  // ⚠ regexScriptsOf 认的是 **readPngCard 的返回值**（它取 card.data.extensions.regex_scripts）
  // 或带 cardJson 的载荷。传 card.data 进去会**静默返回空数组** —— 那会让整个循环空转、
  // 汇总报「0 张、全部通过」。这个坑我踩过了，所以下面加了 totalScripts 断言。
  const scripts = regexScriptsOf(card)
  totalScripts += scripts.length
  if (!scripts.length) {
    console.log(`--- ${file}  正则 0 条（不是 MUV 卡）\n`)
    continue
  }

  const sb = extractStatusBarHtml(scripts)
  const shape = fenceShape(sb)
  const statusScripts = scripts.filter(isStatusPlaceholderScript)
  const withFence = !!(shape.fence && isFullDoc(sb))
  if (withFence) affectedByLatentFence++

  console.log(`--- ${file}  （正则 ${scripts.length} 条，状态占位符脚本 ${statusScripts.length} 条）`)
  if (sb) {
    console.log(`    extractStatusBarHtml: ${String(sb.length)} 字  围栏=${shape.fence || '无'}${shape.lang ? ' 语言=' + shape.lang : ''}  像整页文档=${isFullDoc(sb)}`)
  } else {
    console.log('    extractStatusBarHtml: null（卡没带状态栏皮肤）')
  }

  // ── 实测占位符命运 ──────────────────────────────────────────────────────
  // 占位符必须独占一行：卡里的 findRegex 多为 ^<StatusPlaceHolderImpl\/?>$ + 多行标志
  const msg = '开场白正文。\n<StatusPlaceHolderImpl/>\n后面的正文。'
  const applied = applyAllRegexScripts(msg, scripts, 'display')
  const placeholderSurvives = /<StatusPlaceHolderImpl\s*\/?>/i.test(applied.text)
  const becameDoc = /<!doctype\s+html|<html[\s>]/i.test(applied.text)

  console.log(`    跑完卡正则后：应用 ${applied.applied} 条  占位符残留=${placeholderSurvives}  产出整页文档=${becameDoc}`)

  if (sb && withFence) {
    // 只有占位符残留，客户端才会把带围栏的 sbHtml 插进 iframe
    if (placeholderSurvives) {
      affectedInPractice++
      console.log('    ⚠ 用户可见：占位符残留 → client.js:659 会插入**带裸围栏**的状态栏 HTML')
    } else {
      console.log('    ✓ 不可见：占位符已被卡正则替换掉 → client.js:659 不匹配，sbHtml 是死数据；')
      console.log('      实际走 renderFencedHtml(result)（它能正确剥掉裸围栏，已由 verify-visual.mjs 实测）')
    }
  }
  console.log('')
}

console.log('=== 汇总 ===')
console.log(`  extractStatusBarHtml 返回值带围栏的卡：${affectedByLatentFence} 张（潜在缺陷面）`)
console.log(`  其中占位符会残留、用户真能看到的卡：${affectedInPractice} 张（实际影响面）`)

check('真卡正则确实被读到了（防空循环假绿）', totalScripts >= 20, `只读到 ${totalScripts} 条正则`)
check('实际影响面 = 0（若 >0 则 BLOCKER 1 是真实用户可见缺陷）',
  affectedInPractice === 0,
  `实际有 ${affectedInPractice} 张卡的用户能看到裸围栏`)

console.log(`\n=== 断言: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
