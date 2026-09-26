// Repro helper (keep): where do <audio>/<video> appear inside the card's own
// <script> — real markup, a JS string, a JS comment, or a regex literal?
// renderMediaTags is applied to the whole message, so this decides how far the
// rewrite is allowed to reach.
//
// Run: node repro-card-media-context.mjs
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const FILE = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'
const card = readPngCard(FILE)
const d = card.data

for (const script of d.extensions.regex_scripts) {
  const r = String(script.replaceString || '')
  if (!/<(audio|video)/.test(r)) continue
  console.log('\n=== ' + script.scriptName + ' ===')
  for (const needle of ['<audio', '</audio', '<\\/audio', '<video', '</video', '<\\/video']) {
    let i = -1
    while ((i = r.indexOf(needle, i + 1)) !== -1) {
      console.log('  ' + JSON.stringify(needle) + ' @' + i + ' ' + JSON.stringify(r.slice(Math.max(0, i - 50), i + 60)))
    }
  }
}
