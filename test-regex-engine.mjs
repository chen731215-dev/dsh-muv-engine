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

console.log('\n=== applyAllRegexScripts 冒烟（别把选择逻辑改坏） ===')
const sample = [{ scriptName: 'r', findRegex: '/猫/g', replaceString: '喵', disabled: false }]
check('display 模式能替换', applyAllRegexScripts('一只猫', sample).text === '一只喵',
  applyAllRegexScripts('一只猫', sample).text)
check('disabled 的脚本不参与', applyAllRegexScripts('一只猫', [{ ...sample[0], disabled: true }]).text === '一只猫')

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
