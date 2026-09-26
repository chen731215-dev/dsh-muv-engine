// Repro helper (keep): where do the real card's fenced-HTLM fences sit in the
// message text? renderFencedHtml is being tightened to real markdown semantics
// (opening fence must start its own line), so this checks the assumption against
// the 3 large HTML regexes of _足控天堂2 instead of assuming.
//
// Run: node repro-card-fence-shape.mjs
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const FILE = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'
const card = readPngCard(FILE)
const data = card.data && typeof card.data === 'object' ? card.data : card
const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []
console.log(`regex_scripts: ${scripts.length}`)

for (const s of scripts) {
  const rep = String(s?.replaceString || '')
  if (rep.indexOf('```') === -1) continue
  // every fence run in the replacement text
  const runs = [...rep.matchAll(/`{3,}/g)]
  console.log(`\n--- ${JSON.stringify(s.scriptName)}  replaceString=${rep.length}字  围栏段=${runs.length} ---`)
  for (const r of runs) {
    const at = r.index
    const before = rep.slice(Math.max(0, at - 30), at)
    const atLineStart = /(^|\n)[ \t]{0,3}$/.test(before)
    const runLen = r[0].length
    const prevLineStart = rep.lastIndexOf('\n', at - 1) + 1
    console.log(`  位置${at} 长度${runLen} 行首=${atLineStart} 行内偏移=${at - prevLineStart} 前文=${JSON.stringify(before.slice(-24))}`)
  }
  // how many ``` appear inside the document body itself (why a 4-backtick fence matters)
  const first = rep.indexOf('```')
  const last = rep.lastIndexOf('```')
  if (first >= 0 && last > first) {
    const inner = rep.slice(first + 3, last)
    console.log(`  正文内部还有 ${(inner.match(/`{3,}/g) || []).length} 段反引号`)
  }
}
