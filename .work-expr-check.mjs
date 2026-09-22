// 临时：把 verify-card-compat.mjs 里那几条失败断言的表达式**原样**做语法检查，
// 判定 `{}` 是「CDP 会话失效」还是「门禁自己的表达式语法错」。
const exprs = {}
// 直接抄自 verify-card-compat.mjs（避免手抄变形，读文件里那几行）
import fs from 'node:fs'
const src = fs.readFileSync('verify-card-compat.mjs', 'utf8')
const grab = (anchor, before = 200, after = 400) => {
  const i = src.indexOf(anchor)
  if (i < 0) return null
  const seg = src.slice(Math.max(0, i - before), i + after)
  const m = /'((?:[^'\\]|\\.)*)'/.exec(seg)
  return m ? m[1] : null
}
const names = [
  ['① localStorage', 'a(\'(function(){try{localStorage.setItem("probe_key"'],
  ['② cgGetCache', '))).value, {})\n    c.check(\'② 走卡自己的入口'],
]
// 更稳的做法：把所有 `await a('...')` / `await b('...')` 的字面量抽出来逐个 check
const re = /await [ab]\('((?:[^'\\]|\\.)*)'\)/g
let m
let n = 0
while ((m = re.exec(src))) {
  n++
  const text = m[1]
  try {
    // eslint-disable-next-line no-new-func
    new Function('a', 'return (' + text + ')')
    console.log('OK    #' + n + '  ' + text.slice(0, 70).replace(/\n/g, ' '))
  } catch (e) {
    console.log('SYNERR #' + n + '  ' + e.message + '\n        ' + text.slice(0, 200))
  }
}
console.log('共 ' + n + ' 条 await a()/b() 表达式')
