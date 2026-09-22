// 临时探针 2：把「剥掉引导脚本后逐字相等」这条断言拆开，看真正的注入物有几段。
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
const artifacts = buildFrom(SRC,
  ['muvCardCompatScript', 'muvFrameBootstrap', 'muvCardResetCss', 'muvCardCompatSeed', 'muvCompatKey', 'muvHostViewportHeight'],
  { MUV_CARD_SANDBOX: sandboxOf(SRC) }, 'JSON.stringify({shim:muvCardCompatScript(),boot:muvFrameBootstrap(),reset:muvCardResetCss(),seed:muvCardCompatSeed(muvCompatKey("x"),0)})')
const ART = JSON.parse(artifacts)

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

console.log('宿主视口高相关常量: shim len=' + ART.shim.length + ' boot len=' + ART.boot.length + ' resetCss len=' + ART.reset.length)

const find = (hay, needle) => hay.indexOf(needle)
for (const file of fs.readdirSync(CARD_DIR).filter((f) => f.toLowerCase().endsWith('.png'))) {
  let card
  try { card = readPngCard(path.join(CARD_DIR, file)) } catch (_) { continue }
  for (const s of regexScriptsOf(card)) {
    const rep = String(s?.replaceString || '')
    if (rep.indexOf('```') === -1) continue
    const body = fenceBodyOf(rep)
    if (!body || !looksLikeDoc(body)) continue
    const out = render(rep)
    const sc = srcdocOf(out)
    if (!sc) continue
    const raw = unescapeAttr(sc.raw)
    const tag = (file.replace(/\.png$/i, '') + ' / ' + String(s.scriptName)).padEnd(46)
    console.log('\n' + tag + ' 正文=' + body.length + ' raw=' + raw.length + ' 差=' + (raw.length - body.length))
    console.log('  @42  raw  = ' + JSON.stringify(raw.slice(30, 90)))
    console.log('  @42  body = ' + JSON.stringify(body.slice(30, 90)))
    // 注入物是否都能在 raw 里逐字找到
    const probes = [
      ['shim 脚本体', ART.shim],
      ['bootstrap 脚本体', ART.boot],
      ['reset CSS', ART.reset],
      ['seed 片段', ART.seed],
    ]
    for (const [k, v] of probes) if (v) console.log('  含 ' + k.padEnd(18) + ' → ' + (find(raw, v) >= 0 ? 'Y @' + find(raw, v) : 'n'))
    // 逐段剥掉：shim 脚本 + reset style + bootstrap 脚本，再看是否逐字相等
    let cur = raw
    const cut = (s, needle) => {
      const at = s.indexOf(needle)
      if (at < 0) return { s, n: 0 }
      // 向前找到最近的 <script / <style 开标签
      const candidates = ['<script', '<style'].map((t) => s.lastIndexOf(t, at)).filter((x) => x >= 0)
      const open = Math.max(...candidates)
      const closer = (s[open + 1] === 's' && s.slice(open, open + 7) === '<script') ? '</script>' : '</style>'
      const close = s.indexOf(closer, at)
      if (open < 0 || close < 0) return { s, n: 0 }
      return { s: s.slice(0, open) + s.slice(close + closer.length), n: close + closer.length - open }
    }
    for (const [label, needle] of [['shim', ART.shim], ['bootstrap', ART.boot], ['reset', ART.reset]]) {
      const r = cut(cur, needle)
      if (r.n) { console.log('  剥掉 ' + label.padEnd(10) + ' ' + String(r.n).padStart(6) + ' 字 → 剩 ' + r.s.length); cur = r.s }
    }
    const n = Math.min(cur.length, body.length)
    let d = n
    for (let i = 0; i < n; i++) if (cur[i] !== body[i]) { d = i; break }
    console.log('  剥掉三段注入物后: 剩=' + cur.length + ' 正文=' + body.length + ' 相等=' + (cur === body) + ' 首处不同@' + d)
    if (cur !== body) console.log('    @diff cur =' + JSON.stringify(cur.slice(Math.max(0, d - 20), d + 60)) + '\n    @diff body=' + JSON.stringify(body.slice(Math.max(0, d - 20), d + 60)))
  }
}
