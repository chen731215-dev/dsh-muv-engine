import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const src = fs.readFileSync('verify-card-compat.mjs', 'utf8')
const re = /await ([ab])\('((?:[^'\\]|\\.)*)'\)/g
let m
let n = 0
const out = []
while ((m = re.exec(src))) {
  n++
  const t = m[2]
  try { new Function('a', 'b', 'return ' + t + ';'); continue } catch (_) { /* 坏 */ }
  out.push({ n, t })
}
for (const { n: idx, t } of out) {
  const f = '.work-badexpr-' + idx + '.mjs'
  fs.writeFileSync(f, 'export const x = ' + t + '\n', 'utf8')
  let msg = ''
  try { execFileSync(process.execPath, ['--check', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { msg = String(e.stdout || '') + String(e.stderr || '') }
  console.log('=== #' + idx + ' ===')
  console.log(msg.split('\n').slice(0, 9).join('\n'))
}
