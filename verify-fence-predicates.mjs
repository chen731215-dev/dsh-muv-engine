// Gate: 围栏吞并三条谓词的单测（真卡产物形状 + 边界 + 反例）。
//
// 三条谓词现在**内联在 `wrapLoneDocuments` 里面**（为了能被"按名字抽函数"的既有门禁
// 单独跑起来，见那个函数的 ★ 注释），所以这里逐字抽出来、拼在同一个作用域里跑。
//
// 为什么单测之外还要有 `verify-fence-residue.mjs`：单测证明"判据的形状对"，
// 那一份证明"真卡 + 真回复下用户屏幕上真的没有反引号了"。两层缺一不可 ——
// 只做单测会漏掉"判据对了但没接到链上"，只做端到端会漏掉"边界一改就破"。
//
// 运行：node verify-fence-predicates.mjs        （不需要浏览器）
// Unit tests for the fence-swallowing predicates.
// They now live INSIDE `wrapLoneDocuments` (inlined so name-based extractors can run it
// standalone — see that function's ★ comment), so we extract them verbatim and rebuild
// them in one scope.
import fs from 'node:fs'
const SRC_PATH = process.env.MUV_CLIENT_SRC || 'C:/dsh-muv-engine/lib/client.js'
const SRC = fs.readFileSync(SRC_PATH, 'utf8').replace(/\r\n/g, '\n')
const T = String.fromCharCode(96)
const BT3 = T + T + T

function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('no ' + name)
  let i = SRC.indexOf('{', start), depth = 0, prev = ''
  for (; i < SRC.length; i++) {
    const c = SRC[i], d = SRC[i + 1]
    if (c === '/' && d === '/') { const e = SRC.indexOf('\n', i); i = e < 0 ? SRC.length : e; prev = '\n'; continue }
    if (c === '/' && d === '*') { const e = SRC.indexOf('*/', i + 2); i = e < 0 ? SRC.length : e + 1; continue }
    if (c === "'" || c === '"' || c === '`') { for (i++; i < SRC.length; i++) { if (SRC[i] === '\\') { i++; continue } if (SRC[i] === c) break } prev = c; continue }
    if (c === '/' && !/[A-Za-z0-9_$)\]'"`]/.test(prev)) {
      let inClass = false
      for (i++; i < SRC.length; i++) { const e = SRC[i]; if (e === '\\') { i++; continue } if (e === '\n') break; if (e === '[') inClass = true; else if (e === ']') inClass = false; else if (e === '/' && !inClass) break }
      prev = '/'; continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) }
    if (!/\s/.test(c)) prev = c
  }
  throw new Error('unbalanced ' + name)
}

const code = [
  extractFn('fenceBlank'),
  extractFn('fenceInlineBlank'),
  extractFn('fenceOpenAt'),
  extractFn('fenceCloseFrom'),
  extractFn('fenceTrimTrailingOrphan'),
  'return { open: fenceOpenAt, close: fenceCloseFrom, orphan: fenceTrimTrailingOrphan }',
].join('\n')
const api = new Function(code)()

let bad = 0
const eq = (name, got, want) => {
  const ok = got === want
  console.log('  ' + (ok ? 'OK   ' : 'FAIL ') + name + '  got=' + got + ' want=' + want)
  if (!ok) bad++
}
const docBody = 'x'.repeat(600)

console.log('=== fenceOpenAt（开围栏） ===')
let s
s = '正文 ' + BT3 + 'html\n<!DOCTYPE html><html>' + docBody + '</html>'
eq('★ 真机 V2 形态：标题与围栏同行', api.open(s, s.indexOf('<!DOCTYPE')), s.indexOf(BT3 + 'html'))
eq('  └ 吞的位置让前缀 `正文 ` 保留', s.slice(0, api.open(s, s.indexOf('<!DOCTYPE'))), '正文 ')

s = BT3 + 'html\n<!DOCTYPE html><html>' + docBody + '</html>'
eq('行首开围栏 ```html', api.open(s, s.indexOf('<!DOCTYPE')), 0)

s = BT3 + '\n<!DOCTYPE html><html>' + docBody
eq('裸围栏 ``` 换行后紧跟文档', api.open(s, s.indexOf('<!DOCTYPE')), 0)

s = 'x ' + BT3 + 'html   \n<!DOCTYPE html><html>' + docBody
eq('信息串与换行之间夹空格', api.open(s, s.indexOf('<!DOCTYPE')), 2)

s = 'x ' + BT3 + 'html\r\n<!DOCTYPE html><html>' + docBody
eq('CRLF 行尾的开围栏也认', api.open(s, s.indexOf('<!DOCTYPE')), 2)

s = '   ' + BT3 + 'html\n<!DOCTYPE html><html>' + docBody
eq('缩进围栏：连缩进一起吞（返回行首 0）', api.open(s, s.indexOf('<!DOCTYPE')), 0)

s = 'x ' + BT3 + 'js foo\n<!DOCTYPE html><html>' + docBody
eq('坏围栏（信息串含空格）也吞掉围栏标记本身', api.open(s, s.indexOf('<!DOCTYPE')), 2)

eq('只有 2 个反引号 -> -1', api.open('abc ' + T + T + '\n<!DOCTYPE html>', 8), -1)
eq('end<=0 -> -1', api.open('abc', 0), -1)
eq('文档前面压根没有围栏 -> -1', api.open('<html>' + docBody + '</html>', 0), -1)
eq('文档前一行的正文不是围栏 -> -1',
  api.open('正文就是这三个字\n<!DOCTYPE html><html>' + docBody, ('正文就是这三个字\n<!DOCTYPE html><html>' + docBody).indexOf('<!DOCTYPE')), -1)

console.log('\n=== fenceCloseFrom（收围栏） ===')
const B = '<html></html>'.length
eq('收围栏独占一行（后面还有正文）', api.close('<html></html>\n' + BT3 + '\nnext', B), ('<html></html>\n' + BT3 + '\n').length)
eq('收围栏在文末无换行', api.close('<html></html>\n' + BT3, B), ('<html></html>\n' + BT3).length)
eq('★ 折行形态：收围栏同一行后面还跟着 </response>（真机 V4）',
  api.close('<html></html>\n' + BT3 + ' </response>', B), ('<html></html>\n' + BT3 + ' ').length)
eq('只有 2 个反引号 -> 不是围栏', api.close('<html></html>\n' + T + T + '\nnext', B), B)
eq('没有围栏 -> 原样返回', api.close('<html></html>\n</response>', B), B)
eq('行内代码 ' + T + 'x' + T + ' 不被吞', api.close('<html></html>\n' + T + 'x' + T + '\nrest', B), B)

console.log('\n=== fenceTrimTrailingOrphan（段尾孤立开围栏） ===')
eq('段尾孤立的开围栏被吞', api.orphan('</content>\n\n' + BT3 + '\n'), '</content>\n\n')
eq('段尾孤立的带信息串开围栏被吞', api.orphan('</content>\n' + BT3 + 'html\n'), '</content>\n')
eq('行内代码结尾 -> 不动', api.orphan('</content> 行内 ' + T + 'x' + T), '</content> 行内 ' + T + 'x' + T)
eq('带前缀的段尾反引号 -> 不动（前缀是正文）', api.orphan('</content> 正文' + BT3), '</content> 正文' + BT3)
eq('正常代码块的收尾围栏（前面不是行首空白）-> 不动', api.orphan('code' + BT3 + '\n'), 'code' + BT3 + '\n')

console.log('\n=== 端到端形状（真卡 [1] 产物） ===')
const real = '正文 ' + BT3 + 'html\n<!DOCTYPE html><html>' + docBody + '</html>\n' + BT3 + '\n</response>\n</content>\n'
const openAt = api.open(real, real.indexOf('<!DOCTYPE'))
const htmlEnd = real.indexOf('</html>') + '</html>'.length
const after = api.close(real, htmlEnd)
const rebuilt = real.slice(0, openAt) + 'IFRAME' + real.slice(after)
console.log('  in  : ' + JSON.stringify(real.slice(0, 16)) + ' … ' + JSON.stringify(real.slice(htmlEnd, htmlEnd + 12)))
console.log('  out : ' + JSON.stringify(rebuilt.slice(0, 16)) + ' … ' + JSON.stringify(rebuilt.slice(rebuilt.indexOf('IFRAME') + 6, rebuilt.indexOf('IFRAME') + 20)))
eq('★ 重建结果里一个反引号都不剩', /\u0060/.test(rebuilt), false)
eq('重建结果保留了前缀正文', rebuilt.indexOf('正文 ') === 0, true)
eq('重建结果保留了尾部的 </response>/</content>',
  rebuilt.indexOf('</response>') > 0 && rebuilt.indexOf('</content>') > 0, true)

console.log(bad ? '\n=== 围栏吞并单测: ' + bad + ' 项未通过 ===' : '\n=== 围栏吞并单测: 全部通过 ===')
process.exit(bad ? 1 : 0)
