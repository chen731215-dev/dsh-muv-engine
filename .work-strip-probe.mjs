// 临时探针（不属于门禁）：看 verify-visual.mjs 的 stripBootstrap 到底剥掉了哪一段。
// 用 --marker=full 复现「改用完整标记 window.__muvH=1」的行为，用来量 before/after。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'
import { regexScriptsOf } from './lib/regex-engine.js'
import { buildFrom, sandboxOf, fenceBodyOf, looksLikeDoc } from './verify-shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
const CARD_DIR = process.env.MUV_CARD_DIR || 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

const render = buildFrom(SRC, ['renderFencedHtml'], { MUV_CARD_SANDBOX: sandboxOf(SRC) }, 'renderFencedHtml')
const unescapeAttr = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
function srcdocOf(out) {
  const at = out.indexOf(' srcdoc="')
  if (at < 0) return null
  const from = at + ' srcdoc="'.length
  const end = out.indexOf('"', from)
  if (end < 0) return null
  const gt = out.indexOf('>', end)
  return { raw: out.slice(from, end), before: out.slice(0, at), after: gt < 0 ? '' : out.slice(gt + 1) }
}

const stripSub = (s, marker) => {
  const at = String(s).indexOf(marker)
  if (at < 0) return { out: s, at: -1 }
  const open = s.lastIndexOf('<script', at)
  const close = s.indexOf('</script>', at)
  if (open < 0 || close < 0) return { out: s, at, open, close }
  return { out: s.slice(0, open) + s.slice(close + 9), at, open, close, removed: s.slice(open, close + 9) }
}

const targets = []
for (const file of fs.readdirSync(CARD_DIR).filter((f) => f.toLowerCase().endsWith('.png'))) {
  let card
  try { card = readPngCard(path.join(CARD_DIR, file)) } catch (_) { continue }
  for (const s of regexScriptsOf(card)) {
    const rep = String(s?.replaceString || '')
    if (rep.indexOf('```') === -1) continue
    const body = fenceBodyOf(rep)
    if (!body || !looksLikeDoc(body)) continue
    targets.push({ card: file.replace(/\.png$/i, ''), script: String(s.scriptName), body, rep })
  }
}

console.log('=== 每个目标：__muvH 子串定位 vs window.__muvH=1 完整标记定位 ===')
for (const t of targets) {
  const out = render(t.rep)
  const sc = srcdocOf(out)
  if (!sc) { console.log('  ' + t.card + '/' + t.script + ': 没有 srcdoc'); continue }
  const raw = unescapeAttr(sc.raw)
  const a = stripSub(raw, '__muvH')
  const b = stripSub(raw, 'window.__muvH=1')
  const tag = (t.card + ' / ' + t.script).padEnd(46)
  console.log('  ' + tag + ' 正文=' + t.body.length)
  console.log('    [子串 __muvH]     命中@' + a.at + '  剥掉' + (a.removed ? a.removed.length : 0) + '字 → 剥后=' + a.out.length +
    '  相等=' + (a.out === t.body) + '  首处不同@' + (() => { const n = Math.min(a.out.length, t.body.length); for (let i = 0; i < n; i++) if (a.out[i] !== t.body[i]) return i; return n })())
  console.log('    [完整 window.__muvH=1] 命中@' + b.at + '  剥掉' + (b.removed ? b.removed.length : 0) + '字 → 剥后=' + b.out.length +
    '  相等=' + (b.out === t.body) + '  首处不同@' + (() => { const n = Math.min(b.out.length, t.body.length); for (let i = 0; i < n; i++) if (b.out[i] !== t.body[i]) return i; return n })())
  // 被剥掉的那一段长什么样（头 160 字）
  const head = (x) => (x || '').replace(/\s+/g, ' ').slice(0, 170)
  console.log('    子串剥掉的内容: ' + head(a.removed))
  console.log('    完整剥掉的内容: ' + head(b.removed))
  // 独立核对：文档里两个脚本各自的位置
  const all = []
  const re = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
  let m
  while ((m = re.exec(raw))) all.push({ i: m.index, len: m[0].length, hasKvSeed: m[0].includes('__muvKvSeed'), hasHello: m[0].includes('__muvHello'), hasH1: m[0].includes('window.__muvH=1'), hasHFit: m[0].includes('__muvHFit'), hasFH: m[0].includes('__muvFrameHeight') })
  console.log('    文档里的 <script> 段（前 6）:')
  for (const s of all.slice(0, 6)) {
    console.log('      @' + String(s.i).padStart(7) + ' len=' + String(s.len).padStart(6) +
      ' KvSeed=' + (s.hasKvSeed ? 'Y' : '.') + ' Hello=' + (s.hasHello ? 'Y' : '.') + ' __muvH=1=' + (s.hasH1 ? 'Y' : '.') +
      ' HFit=' + (s.hasHFit ? 'Y' : '.') + ' FrameHeight=' + (s.hasFH ? 'Y' : '.'))
  }
  const h1count = (raw.match(/window\.__muvH=1/g) || []).length
  const fit = (raw.match(/__muvHFit/g) || []).length
  const fh = (raw.match(/__muvFrameHeight/g) || []).length
  console.log('    计数: window.__muvH=1 ×' + h1count + '  __muvHFit ×' + fit + '  __muvFrameHeight ×' + fh)
}
