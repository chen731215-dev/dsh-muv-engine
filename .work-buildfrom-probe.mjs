// 临时探针：buildFrom 的「自动发现常量」为什么会拼出语法错。
import fs from 'node:fs'
import { extractFunction, moduleVarStatements, buildFrom } from './verify-shared.mjs'

const src = fs.readFileSync('lib/client.js', 'utf8')
const POOL = moduleVarStatements(src)
console.log('pool 键数 = ' + Object.keys(POOL).length)
for (const k of ['head', 'html', 'frame', 'muvKv', 'key', 'n']) {
  console.log('--- pool[' + k + '] ---')
  console.log(JSON.stringify(POOL[k]))
}
// 逐个单测：每一条自己能不能解析
for (const [k, v] of Object.entries(POOL)) {
  try { new Function('return 0; var __x=1; ' + v) } catch (e) { console.log('BAD-STMT ' + k + ' -> ' + e.message + ' :: ' + JSON.stringify(v.slice(0, 160))) }
}
try {
  buildFrom(src, ['cardHtmlIframe', 'rewriteVhMinHeight'], { MUV_CARD_SANDBOX: 'allow-scripts', window: {}, document: {} }, '{cardHtmlIframe,rewriteVhMinHeight}')
  console.log('buildFrom OK')
} catch (e) {
  console.log('buildFrom 崩: ' + String(e.message).split('\n')[0])
  console.log('  已注入常量: ' + (/已注入常量: ([^\n]*)/.exec(String(e.message)) || [])[1])
  // 复现拼接，逐段二分
  const names = ['cardHtmlIframe', 'rewriteVhMinHeight']
  const have = new Set(); const queue = [...names]; let out = ''
  while (queue.length) {
    const n = queue.shift(); if (have.has(n)) continue; have.add(n)
    const body = extractFunction(src, n); out += body + '\n'
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const id = m[1]; if (have.has(id)) continue
      if (new RegExp('\\n[ \\t]+function\\s+' + id + '\\s*\\(').test(src)) queue.push(id)
    }
  }
  console.log('  函数体片段能单独解析吗:')
  for (const n of have) {
    const b = extractFunction(src, n)
    try { new Function('var window={},document={};' + b) } catch (e2) { console.log('    FUNC-BAD ' + n + ' -> ' + e2.message) }
  }
  const isDeclaredIn = (code, name) => new RegExp('(?:var|let|const|function)\\s+' + name + '\\b').test(code)
  const need = []
  for (const [k, v] of Object.entries(POOL)) {
    if (isDeclaredIn(out, k)) continue
    if (!new RegExp('\\b' + k + '\\b').test(out)) continue
    need.push(k)
  }
  console.log('  会被注入的常量: ' + need.join(', '))
  // 增量：一条一条加，找出哪条让它崩
  let acc = ''
  const okNames = []
  for (const k of need) {
    const cand = acc + POOL[k] + '\n'
    try { new Function('var window={},document={};' + cand + out + '\nreturn 0'); acc = cand; okNames.push(k) }
    catch (e3) { console.log('  加 ' + k + ' 后崩: ' + e3.message + '\n     语句=' + JSON.stringify(POOL[k].slice(0, 240))) }
  }
  console.log('  能安全注入的: ' + okNames.join(', '))
}
