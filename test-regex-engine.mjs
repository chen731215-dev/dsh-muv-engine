// Regression: server-side card-script helpers (`lib/regex-engine.js`).
//
// Run: node test-regex-engine.mjs
//
// 目前聚焦 `extractStatusBarHtml()` 的围栏剥离：
//   · 卡的状态栏脚本用围栏包着整页 HTML，而**语言标记常常不写**（`_足控天堂2` 就是这样）；
//   · 老实现只认 ```html，于是把裸围栏一起当 HTML 返回（210,219 字的返回值里带着首尾 ```），
//     调用方把它塞进 iframe，卡页面上就多出两行反引号文本；
//   · 裸围栏有歧义（普通代码块也长这样），所以只在「围栏包住整串 + 剥出来确实是整页文档」
//     时才剥一层。
import { extractStatusBarHtml, applyAllRegexScripts } from './lib/regex-engine.js'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { findCard } from './../dsh-muv-table/test-cards.mjs'
import fs from 'node:fs'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const DOC = '<!DOCTYPE html>\n<html><body><p>x</p></body></html>'
const statusScript = (replaceString, extra = {}) => ([{
  scriptName: '状态栏',
  findRegex: '/<StatusPlaceHolderImpl\\/>/gsi',
  replaceString,
  disabled: false,
  ...extra,
}])

console.log('=== extractStatusBarHtml 围栏剥离 ===\n')

check('```html 围栏（老行为）照样剥',
  extractStatusBarHtml(statusScript('```html\n' + DOC + '\n```')) === DOC,
  extractStatusBarHtml(statusScript('```html\n' + DOC + '\n```')).slice(0, 40))
check('★ 无语言标记的裸围栏也剥（本次修复）',
  extractStatusBarHtml(statusScript('```\n' + DOC + '\n```')) === DOC,
  JSON.stringify(extractStatusBarHtml(statusScript('```\n' + DOC + '\n```')).slice(0, 40)))
check('★ 四反引号裸围栏也剥',
  extractStatusBarHtml(statusScript('````\n' + DOC + '\n````')) === DOC)
check('CRLF 换行也剥',
  extractStatusBarHtml(statusScript('```\r\n' + DOC + '\r\n```')) === DOC)
check('裸 HTML 不折腾（本来就没有围栏）',
  extractStatusBarHtml(statusScript(DOC)) === DOC)
check('<html> 开头（没有 doctype）也认',
  extractStatusBarHtml(statusScript('```\n<html><body>y</body></html>\n```')) === '<html><body>y</body></html>')

// 反向：不该剥的一律不剥
const jsBlock = '```js\nconst a = 1;\n```'
check('★ 普通代码块不剥（裸围栏有歧义）',
  extractStatusBarHtml(statusScript(jsBlock)) === jsBlock, extractStatusBarHtml(statusScript(jsBlock)))
const fragment = '```\n<p>只是片段</p>\n```'
check('★ 围栏里不是整页文档时不剥',
  extractStatusBarHtml(statusScript(fragment)) === fragment, extractStatusBarHtml(statusScript(fragment)))
const mixed = '前缀\n```\n' + DOC + '\n```\n后缀'
check('★ 围栏没包住整串时不剥',
  extractStatusBarHtml(statusScript(mixed)) === mixed, extractStatusBarHtml(statusScript(mixed)))
check('只有一个开围栏时不剥',
  extractStatusBarHtml(statusScript('```\n' + DOC)) === '```\n' + DOC)

// 选择规则不能回归
check('disabled 的脚本不作来源',
  extractStatusBarHtml(statusScript(DOC, { disabled: true })) === null)
check('promptOnly 的脚本不作来源',
  extractStatusBarHtml(statusScript(DOC, { promptOnly: true })) === null)
check('空 replaceString 的占位守卫不作来源',
  extractStatusBarHtml(statusScript('')) === null)
check('非数组/空脚本不抛异常',
  extractStatusBarHtml(null) === null && extractStatusBarHtml([]) === null)
check('最长替换串胜出（较短的皮肤不遮蔽真皮肤）', (() => {
  const short = statusScript('```\n<html><body>短</body></html>\n```')
  const long = statusScript(DOC + '<!-- padded -->')
  return extractStatusBarHtml([short[0], long[0]]) === DOC + '<!-- padded -->'
})())

console.log('\n=== 真实卡 ===')
const CARDS = ['_足控天堂2', '异世界农场', '涩涩提瓦特', '食人世界', '苍玄界']
for (const nm of CARDS) {
  const file = findCard(nm)
  if (!file) { console.log('  SKIP ' + nm + '（本机没这张卡）'); continue }
  let card
  try { card = file.endsWith('.png') ? readPngCard(file) : JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { continue }
  const data = card.data && typeof card.data === 'object' ? card.data : card
  const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []
  const html = extractStatusBarHtml(scripts)
  if (!html) { console.log('  SKIP ' + nm + '（没有状态栏皮肤）'); continue }
  const fenced = /^\s*`{3,}/.test(html) || /`{3,}\s*$/.test(html)
  console.log('  ' + nm + ': ' + html.length + ' 字；首尾还有围栏=' + fenced)
  check('★ 「' + nm + '」返回值里没有残留围栏', !fenced, JSON.stringify(html.slice(0, 40)))
  check('「' + nm + '」返回值是整页文档', /^\s*(<!doctype|<html)/i.test(html), JSON.stringify(html.slice(0, 40)))
}

console.log('\n=== ★ 替换串里的 $ 序列：必须字面量入文（照 ST 的函数式替换） ===')
// 这条钉的是一个**很贵**的坑（2026-09-22 实测）：
//   `String.replace(re, str)` 会把替换串里的 `$'` / `$&` / `` $` `` / `$$` 当特殊引用；
//   而卡的正则替换串经常就是一整页 HTML（`_足控天堂2` [2]「ERA 状态栏」= 210KB 文档），
//   文档里的卡 JS 写着 `key.charAt(0)==='$'` —— `$'` 被解释成"匹配之后的文本"，
//   于是那行变成 `==='<StatusPlaceHolderImpl/>'`（引号错位）⇒ 整段卡脚本 SyntaxError
//   ⇒ **卡的 JS 全废**（tab 切不动 / 数据不渲染 / 按钮无反应），而 HTML/CSS 照常显示。
//   修法 = 照抄 ST `regex/engine.js:419-442` 的**函数式替换**，只展开 `$1`…`$99` 与 `$<name>`。
const dollarScript = [{ scriptName: 'doc', findRegex: '/<PH\\/>/g', replaceString: "var k='<PH/>'; function f(){return k&&k.charAt(0)==='$'}", disabled: false }]
const dollarOut = applyAllRegexScripts('x<PH/>y', dollarScript).text
const dollarWant = "xvar k='<PH/>'; function f(){return k&&k.charAt(0)==='$'}y"
check('★ 替换串逐字入文（$\' / $& / $` 都不被解释）', dollarOut === dollarWant,
  dollarOut === dollarWant ? '' : '得到=' + JSON.stringify(dollarOut))
const greedyScript = [{ scriptName: 'd', findRegex: '/A(\\d+)B/g', replaceString: 'pre$&mid$$tail', disabled: false }]
const greedyOut = applyAllRegexScripts('A7B', greedyScript).text
check('★ $& 与 $$ 也保持字面量（只有 $1 展开）', greedyOut === 'pre$&mid$$tail', JSON.stringify(greedyOut))
const groupScript = [{ scriptName: 'g', findRegex: '/<img>(.*?)<\\/img>/gi', replaceString: '<img src="cdn/$1.webp" alt="$1">', disabled: false }]
check('★ $1 仍然按捕获组展开（既有行为不能丢）',
  applyAllRegexScripts('<img>猫/笑1</img>', groupScript).text === '<img src="cdn/猫/笑1.webp" alt="猫/笑1">',
  applyAllRegexScripts('<img>猫/笑1</img>', groupScript).text)
const namedScript = [{ scriptName: 'n', findRegex: '/a(?<x>\\d+)b/g', replaceString: '[${x}]'.replace('${x}', '$<x>'), disabled: false }]
check('★ $<name> 具名组展开（与 ST 同一口径）', applyAllRegexScripts('a9b', namedScript).text === '[9]',
  applyAllRegexScripts('a9b', namedScript).text)
const matchMacro = [{ scriptName: 'm', findRegex: '/猫/g', replaceString: '〈{{match}}〉', disabled: false }]
check('★ {{match}} → 整段匹配（ST 的宏）', applyAllRegexScripts('猫', matchMacro).text === '〈猫〉',
  applyAllRegexScripts('猫', matchMacro).text)

console.log('\n=== applyAllRegexScripts 冒烟（别把选择逻辑改坏） ===')
const sample = [{ scriptName: 'r', findRegex: '/猫/g', replaceString: '喵', disabled: false }]
check('display 模式能替换', applyAllRegexScripts('一只猫', sample).text === '一只喵',
  applyAllRegexScripts('一只猫', sample).text)
check('disabled 的脚本不参与', applyAllRegexScripts('一只猫', [{ ...sample[0], disabled: true }]).text === '一只猫')

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
