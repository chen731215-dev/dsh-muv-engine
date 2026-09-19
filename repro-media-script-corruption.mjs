// Repro (keep): what does renderMediaTags do to the card's own <script>?
//
// The card's HTML regex produces a whole page *including* a <script>, and this pass
// runs over the message. Inside that script the same tags appear as **code**:
//
//   const AUDIO_RE = /<audio>(.*?)<\/audio>/g;      ← regex literal
//   /* 替换为：<audio id="audio-element" …> */       ← example in a comment
//   html += '<video class="…" src="'+thumbUrl+'" …>' ← tag built from strings
//
// The old pass had no idea about <script> boundaries, so it rewrote those too.
// This script takes the OLD implementation straight out of git HEAD and the current
// one, runs both over the real card's regex replacements, and reports what changed.
//
// Run: node repro-media-script-corruption.mjs
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const FILE = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters\\_足控天堂2.png'
const SRC_NEW = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
const SRC_OLD = execFileSync('git', ['show', 'HEAD:lib/client.js'], { cwd: new URL('.', import.meta.url).pathname.replace(/^\//, ''), encoding: 'utf8' })

function extractFunction(src, name) {
  const start = src.indexOf('    function ' + name + '(')
  if (start < 0) throw new Error('not found: ' + name)
  let i = src.indexOf('{', start)
  let depth = 0, state = 'code'
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue }
      if (c === '/' && n === '*') { state = 'block'; i++; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; continue }
      if (c === '/') { state = 'regex'; continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
    } else if (state === 'regex') {
      if (c === '\\') { i++; continue }
      if (c === '/') state = 'code'
    } else if (state === 'line') { if (c === '\n') state = 'code' }
    else if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++ } }
    else { if (c === '\\') { i++; continue } if (c === state) state = 'code' }
  }
  throw new Error('unbalanced: ' + name)
}

function build(src, names) {
  const code = names.map(n => extractFunction(src, n)).join('\n\n')
  return new Function('MUV_CARD_SANDBOX', code + '\nreturn { renderMediaTags }')( 'allow-scripts')
}

const oldImpl = build(SRC_OLD, ['escHtmlBasic', 'renderMediaTags']).renderMediaTags
const newImpl = build(SRC_NEW, ['escHtmlBasic', 'attrValue', 'dropAttr', 'readStartTag', 'renderMediaTags']).renderMediaTags

const card = readPngCard(FILE)
const d = card.data
const scriptBodies = r => [...r.matchAll(/<script\b[\s\S]*?<\/script\s*>/gi)].map(m => m[0]).join('\n@@@\n')

let markers = 0
for (const s of d.extensions.regex_scripts) {
  const r = String(s.replaceString || '')
  if (!/(audio|video)/i.test(r)) continue
  const o = oldImpl(r), n = newImpl(r)
  const sameScriptsNew = scriptBodies(r) === scriptBodies(n)
  const sameScriptsOld = scriptBodies(r) === scriptBodies(o)
  console.log('\n=== ' + s.scriptName + ' (' + r.length + ' 字) ===')
  console.log('  <script> 内容未被改动: 旧=' + sameScriptsOld + '  新=' + sameScriptsNew)
  console.log('  长度: 原=' + r.length + ' 旧=' + o.length + ' 新=' + n.length)
  if (!sameScriptsOld) {
    // line-level diff of the script region, so every touched line is visible
    const before = scriptBodies(r).split('\n'), after = scriptBodies(o).split('\n')
    const touched = []
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (before[i] !== after[i]) touched.push([i, before[i], after[i]])
    }
    console.log('  ★ 旧实现改动卡内 <script> 的 ' + touched.length + ' 处（新实现 0 处）：')
    for (const [i, b, a] of touched.slice(0, 12)) {
      console.log('     行' + i + ' 原: ' + JSON.stringify(String(b).slice(0, 120)))
      console.log('     行' + i + ' 旧: ' + JSON.stringify(String(a).slice(0, 120)))
    }
    markers++
  }
  // the card's own class must survive (the old pass emitted a second class attribute)
  const clsBefore = (r.match(/class="(cg-[a-z-]+)"/g) || []).length
  const clsAfterNew = (n.match(/class="(cg-[a-z-]+)"/g) || []).length
  const clsAfterOld = (o.match(/class="(cg-[a-z-]+)"/g) || []).length
  if (clsBefore) {
    console.log('  卡自带 class="cg-…" 的数量: 原=' + clsBefore + ' 旧=' + clsAfterOld + ' 新=' + clsAfterNew)
  }
  // placeholders created out of real markup (not out of js) — should be 0 for this card
  const ph = (n.match(/class="muv-(audio|video-ph)"/g) || []).length
  console.log('  新实现把多少真实标记降级成了占位: ' + ph)
  console.log('  新实现是否保住 carVid 元素: ' + (n.includes('id="carVid"') === r.includes('id="carVid"') ? '是（未动）' : '否（被改）'))
  if (r.includes('id="carVid"')) {
    // `<video id="carVid" …></video>` is real markup with no src — the card's JS fills
    // it in later, so turning it into a <div> breaks getElementById('carVid').
    console.log('  carVid 元素存活: 旧=' + o.includes('id="carVid"') + '  新=' + n.includes('id="carVid"'))
  }
}
console.log('\n旧实现改坏卡内 JS 的正则数: ' + markers)
