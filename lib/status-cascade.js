// dsh-muv-engine: Status bar cascade
//
// Goal: an arbitrary imported character card should still produce a status bar.
//
// Cards in the wild encode the status area in mutually incompatible ways, so no
// single parser can cover them. This module tries a chain of strategies, most
// faithful first, and each stage simply declines (returns null) when it does not
// recognise the input:
//
//   1. card   — the card ships its own HTML next to a placeholder (highest fidelity)
//   2. yaml   — `状态栏:` + 日期和时间/地点/用户列表 (the 瑟瑟提瓦特-style block)
//   3. free   — `👤`-prefixed free format
//   4. loose  — dashed/emoji lines, 『』 header, [角色状态] sections (any shape)
//   5. vars   — built-in template driven by _.set / _.add assignments
//
// Stage 5 lives in the client (`buildDefaultStatusBar`); stages 1-4 are pure
// text -> HTML and are unit-testable here.

/** Escape a value for HTML text position. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escape for an attribute value. */
export function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;')
}

/** Strip a leading pictographic char (and any space after it) from a value. */
function stripLeadingEmoji(s) {
  return String(s == null ? '' : s)
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, '')
    .trim()
}

/** Collapse runs of whitespace; used on extracted one-line values. */
function squeeze(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
}

/** Strip wrapping quotes/backticks the model likes to add around values. */
function unq(s) {
  const v = squeeze(s)
  if (v.length >= 2 && /^["'“”「」『』`]/.test(v) && /["'“”「」『』`]$/.test(v)) return v.slice(1, -1).trim()
  return v
}

/**
 * Pull the header line (`📅 日期 … | ⏰ 时间 … | 📍 位置 …`) out of a status body.
 * Accepts the values however the model laid them out — newlines inside the
 * `『』` wrapper, `|` or `┃` separators, or one field per line.
 * @param {string} body
 * @returns {{date:string, time:string, location:string, weather:string}}
 */
export function extractHeaderFields(body) {
  const out = { date: '', time: '', location: '', weather: '' }
  if (!body) return out
  // Work on a copy with the corner-bracket wrapper flattened.
  const flat = String(body).replace(/『([\s\S]*?)』/g, (_, inner) => ' ' + squeeze(inner) + ' ')

  // Read every `label: value` pair once, so a label that contains another
  // (`日期和时间` vs `时间`) cannot satisfy both fields from the same text.
  const pairs = []
  const pairRe = /(日期和时间|日期|时间|位置|地点|天气|date|time|location|place|weather)\s*[:：]\s*([^|｜\n\r]+)/gi
  let m
  while ((m = pairRe.exec(flat)) !== null) {
    pairs.push({ label: m[1].toLowerCase(), value: stripLeadingEmoji(unq(m[2])).replace(/[』」]+$/, '').trim() })
  }
  const take = (labels, skipLabels) => {
    for (const p of pairs) {
      if (skipLabels && skipLabels.includes(p.label)) continue
      if (labels.includes(p.label) && p.value) return p.value
    }
    return ''
  }
  out.date = take(['日期和时间', '日期', 'date'], ['时间', 'time'])
  out.time = take(['时间', 'time'], ['日期和时间', '日期', 'date'])
  // A combined label carries both; if only it matched, use it for each field
  // that is still empty rather than inventing a second value.
  if (!out.date || !out.time) {
    const combined = take(['日期和时间'], [])
    if (combined) { if (!out.date) out.date = combined; if (!out.time) out.time = '' }
  }
  out.location = take(['位置', '地点', 'location', 'place'])
  out.weather = take(['天气', 'weather'])
  return out
}

/** Remove the header fields from a body so they are not repeated as fields. */
/**
 * Emoji that introduce a header line (date/time/place/weather).
 *
 * Written with `\p{Extended_Pictographic}` rather than a literal class like
 * `[📅⏰📍🌤🌡]`: JS treats those as surrogate halves, so such a class silently
 * also matches unrelated emoji that share a high surrogate (🏃 U+1F3C3 shares
 * D83C with 🌤). That deleted whole field lines like `🏃 当前行动： …` whenever
 * they had no leading dash.
 */
const HEADER_EMOJI_RE = /^\s*(?:\p{Extended_Pictographic})/u

/** Characters that introduce a header line, restricted to the header set. */
const HEADER_FIELD_LABELS = /^\s*(?:📅|⏰|📍|🌤|🌡|🕒|🗓|🕐|🧭)\s*/u

function stripHeaderFields(body) {
  return String(body || '')
    .replace(/『[\s\S]*?』/g, '')
    // Header lines only — see HEADER_FIELD_LABELS above for why a literal
    // emoji character class is unsafe here.
    .replace(/^[^\n]*(?:📅|⏰|📍|🌤|🌡|🕒|🗓|🕐|🧭)[^\n]*$/gmu, '')
    .replace(/^\s*(?:日期和时间|日期|时间|位置|地点|天气)\s*[:：][^\n]*$/gm, '')
}

// ────────────────────────────── stage 2: YAML ──────────────────────────────

/**
 * 瑟瑟提瓦特-style block:
 *   状态栏:
 *     日期和时间: "⏰ ..."
 *     地点: "📍 ..."
 *     用户列表:
 *       - 用户: 安柏 名字: "👤 安柏" 行动: "📝 ..." 内心: "💭 ..." 衣着: ...
 *     环境: 氛围: "..." 风: "..."
 *     行动选项:
 *       - "🏆 ..."
 * @param {string} body
 * @returns {{html:string, source:string}|null}
 */
export function parseYamlStatusBlock(body) {
  if (!body || body.indexOf('状态栏') === -1) return null
  // Require at least one structured field, otherwise this is prose that merely
  // mentions the word.
  if (!/(日期和时间|用户列表|名字|行动|内心|衣着)\s*[:：]/.test(body)) return null

  const fields = extractHeaderFields(body)
  const meta = {}
  const headMatch = body.match(/状态栏[:：]\s*日期和时间[:：]\s*["“]([^"”]*)["”]\s*地点[:：]\s*["“]([^"”]*)["”]/)
  if (headMatch) { meta.time = headMatch[1]; meta.loc = headMatch[2] }
  else {
    const tm = body.match(/日期和时间[:：]\s*["“]([^"”]*)["”]/); if (tm) meta.time = tm[1]
    const lm = body.match(/地点[:：]\s*["“]([^"”]*)["”]/); if (lm) meta.loc = lm[1]
  }
  if (!meta.time && fields.date) meta.time = [fields.date, fields.time].filter(Boolean).join(' ')
  if (!meta.loc && fields.location) meta.loc = fields.location

  const environment = []
  const envMatch = body.match(/环境[:：]\s*氛围[:：]\s*["“]([^"”]*)["”]\s*风[:：]\s*["“]([^"”]*)["”]/)
  if (envMatch) { environment.push(envMatch[1], envMatch[2]) }
  else if (/环境[:：]/.test(body)) {
    const envRe = /环境[:：]([\s\S]*?)(?=行动选项|$)/.exec(body)
    if (envRe) {
      const envText = envRe[1]
        .replace(/氛围[:：]\s*["“]([^"”]*)["”]/g, (_, v) => { environment.push(v); return '' })
        .replace(/风[:：]\s*["“]([^"”]*)["”]/g, (_, v) => { environment.push(v); return '' })
        .trim()
      if (envText) environment.push(envText)
    }
  }

  // ── 角色条目 ──────────────────────────────────────────────────────────────
  //
  // 这个格式里，条目**不一定从行首开始**：
  //   用户列表: - 用户: 名字: "🎀 安柏" 行动: "…" 内心: "…"
  // 第一个 `- 用户:` 前面还挂着 `用户列表:` 前缀，而旧实现要求行首刚好是
  // `- 用户:`，于是第一条角色被整条丢掉。
  //
  // 字段也**不能写死**：旧实现只取 名字/行动/内心/衣着 四个，而卡片实际会给
  // 穿搭、小穴、胸部、肛门、阳具、最近性行为……写死的列表会把它们全部丢掉。
  // 现在按 `标签: "值"` 通用提取，标签是什么就渲染什么。
  const ENTRY_MARK_RE = /-\s*(?:用户|角色|NPC|npc|人物)\s*[:：]/g
  const FIELD_RE = /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_ ]{0,9})\s*[:：]\s*["“]([^"”]*)["”]/g

  // 选项区先切出去，否则最后一个角色的字段会把整段选项吞进去。
  const optMatch = /(?:行动选项|可选行动|行动选择|选项|options?|choices?)\s*[:：]\s*([\s\S]*)$/i.exec(String(body))
  const bodyMain = optMatch ? String(body).slice(0, optMatch.index) : String(body)

  const chars = []
  const marks = []
  ENTRY_MARK_RE.lastIndex = 0
  let em
  while ((em = ENTRY_MARK_RE.exec(bodyMain)) !== null) marks.push(em.index)
  for (let i = 0; i < marks.length; i++) {
    const seg = bodyMain.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : bodyMain.length)
    const fields = []
    FIELD_RE.lastIndex = 0
    let f
    while ((f = FIELD_RE.exec(seg)) !== null) {
      const label = squeeze(f[1])
      const value = String(f[2]).trim()
      if (!label || !value) continue
      fields.push({ label, value })
    }
    if (!fields.length) continue
    // 名字优先取 `名字:` 字段，否则用第一个字段的值（有些卡直接写 `- 用户: "安柏"`）。
    const nameField = fields.find(x => /^名字$/.test(x.label))
    const name = nameField ? nameField.value : (fields[0] ? fields[0].value : '')
    const rest = fields.filter(x => x !== nameField)
    chars.push({ name, fields: rest })
  }

  const options = []
  if (optMatch) {
    let tail = optMatch[1]
    // 选项区里常先重复一次持有者：`行动选项: 名字: "🍆 柊木" 选项: - "1.…"`。
    // 从 `选项:` 起才真正是选项；不加这一步会把这个名字当成第一个选项。
    const inner = /(?:选项|可选|choices?|options?)\s*[:：]\s*([\s\S]*)$/i.exec(tail)
    if (inner) tail = inner[1]
    else tail = tail.replace(/[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_ ]{0,9}\s*[:：]\s*["“][^"”]*["”]/g, '')

    // 选项可能挤在一行：`- "1.最佳选项: …" - "2.…"`，所以按引号项切。
    const quoted = []
    const Q = /["“]([^"”]+)["”]/g
    let q
    while ((q = Q.exec(tail)) !== null) quoted.push(q[1])
    if (quoted.length > 1) {
      for (const qv of quoted) {
        const opt = unq(stripOptionMarker(qv)).trim()
        if (opt && options.indexOf(opt) === -1) options.push(opt)
      }
    } else {
      // Accept every marker a model uses — bullet, `1.`, `A.`, or a bare line.
      // Matching only `-`/`•` quietly discarded a whole lettered options list.
      for (const rawLine of tail.split('\n')) {
        const line = rawLine.trim()
        if (!line || !isOptionLine(line)) continue
        const opt = unq(stripOptionMarker(line))
        if (opt && options.indexOf(opt) === -1) options.push(opt)
      }
    }
  }

  if (!meta.time && !meta.loc && !chars.length && !environment.length) return null

  const parts = ['<div class="muv-sb">']
  const head = []
  if (meta.time) head.push('⏰ ' + esc(stripLeadingEmoji(meta.time)))
  if (meta.loc) head.push('📍 ' + esc(stripLeadingEmoji(meta.loc)))
  if (head.length) parts.push('<div class="muv-sb-hd">' + head.map(h => '<span>' + h + '</span>').join('') + '</div>')
  if (environment.length) {
    parts.push('<div class="muv-sb-bd">' + environment.map(e => '<span class="muv-sb-chip">' + esc(e) + '</span>').join('') + '</div>')
  }
  if (chars.length) {
    parts.push('<div class="muv-sb-sub">')
    for (const c of chars) {
      parts.push('<div class="muv-sb-row"><span class="muv-sb-name">👤 ' + esc(stripLeadingEmoji(c.name)) + '</span></div>')
      // 通用字段渲染：标签是什么就写什么。值里通常自带 emoji（`行动: "🛏️ …"`），
      // 只有作者没写 emoji 时才补一个。
      for (const f of c.fields) {
        const hasIcon = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(f.value)
        parts.push('<div class="muv-sb-line"><b>' + esc(stripLeadingEmoji(f.label)) + '</b>' +
          esc(hasIcon ? f.value : '・' + f.value) + '</div>')
      }
    }
    parts.push('</div>')
  }
  parts.push('</div>')
  const optionsHtml = options.length ? renderOptions(options) : ''
  return { html: parts.join('') + optionsHtml, source: 'yaml' }
}

// ─────────────────────────────── stage 3: free ──────────────────────────────

/**
 * `👤`-prefixed free format:
 *   ⏰ 时间：...
 *   📍 地点：...
 *   👤 名字 😊 状态描述
 *   （following lines become that character's notes）
 *   行动选项
 *   - 选项一
 * @param {string} body
 * @returns {{html:string, source:string}|null}
 */
export function parseFreeStatusBlock(body) {
  if (!body) return null
  let metaItems = []
  const chars = []
  const options = []
  const dialogue = []
  let inOptions = false
  let current = null

  for (const rawLine of String(body).split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (current) { chars.push(current); current = null }
      continue
    }
    const optLabel = optionsLabel(line)
    if (optLabel !== null) {
      if (current) { chars.push(current); current = null }
      inOptions = true
      // `行动选项：A. 走过去搭话` packs the first option onto the label line.
      if (optLabel) {
        const first = stripOptionMarker(optLabel)
        if (first) options.push(first)
      }
      continue
    }
    if (inOptions && isOptionLine(line)) {
      const opt = stripOptionMarker(line)
      if (opt) options.push(opt)
      continue
    }
    if (/^👤/u.test(line)) {
      if (current) chars.push(current)
      current = { name: '', expression: '', state: '', notes: [] }
      const rest = line.replace(/^👤\s*/u, '').trim()
      const em = rest.match(/^(.+?)(\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\s*(.*)$/u)
      if (em) {
        current.name = em[1].trim()
        current.expression = em[2].trim()
        current.state = em[3].trim()
      } else current.name = rest
      continue
    }
    if (current) { current.notes.push(line); continue }
    if (!inOptions) {
      // Header-ish lines become meta chips; anything else is body text.
      if (HEADER_FIELD_LABELS.test(line)) metaItems.push(line)
      else dialogue.push(line)
    }
  }
  if (current) chars.push(current)

  // `👤` is this stage's signature. Without it we collected nothing but free
  // prose, and claiming the message here would stop the looser stage (which
  // does understand dashed/emoji shapes) from ever running.
  if (!chars.length) return null

  // Replace the raw header lines (already picked up above as emoji-leading)
  // with the parsed one-line form, so the date/time/location are not shown
  // twice and the corner-bracket residue is dropped.
  var cleanedMeta = metaItems.filter(function (m) { return !HEADER_FIELD_LABELS.test(m) })
  var hdr = extractHeaderFields(body)
  var headLine = []
  if (hdr.date || hdr.time) headLine.push('📅 ' + [hdr.date, hdr.time].filter(Boolean).join(' '))
  if (hdr.location) headLine.push('📍 ' + hdr.location)
  metaItems = headLine.concat(cleanedMeta)

  const parts = ['<div class="muv-sb">']
  if (metaItems.length) {
    parts.push('<div class="muv-sb-hd">' + metaItems.map(m => '<span>' + esc(m) + '</span>').join('') + '</div>')
  }
  if (chars.length) {
    parts.push('<div class="muv-sb-sub">')
    for (const c of chars) {
      parts.push('<div class="muv-sb-row"><span class="muv-sb-name">👤 ' + esc(c.name) + '</span>'
        + (c.expression ? '<span class="muv-sb-chip">' + esc(c.expression + ' ' + c.state) + '</span>' : '') + '</div>')
      for (const n of c.notes) parts.push('<div class="muv-sb-line">' + esc(n) + '</div>')
    }
    parts.push('</div>')
  }
  if (dialogue.length) {
    parts.push('<div class="muv-sb-bd">' + dialogue.map(d => '<div class="muv-sb-line">' + esc(d) + '</div>').join('') + '</div>')
  }
  parts.push('</div>')
  const optionsHtml = options.length ? renderOptions(options) : ''
  return { html: parts.join('') + optionsHtml, source: 'free' }
}

// ─────────────────────────────── stage 4: loose ─────────────────────────────

/**
 * Last structural resort: anything that still clearly reads as a status list.
 * Covers the shapes models actually emit when they ignore the card's format —
 * dashed entries with a leading emoji, `[角色状态]` sections, and a bare
 * `- 😋 名字` heading followed by indented `- 🚶 当前行动：…` fields.
 * @param {string} body
 * @returns {{html:string, source:string}|null}
 */
export function parseLooseStatusBlock(body) {
  if (!body) return null
  const cleaned = stripHeaderFields(body)

  /**
   * Strip the presentational wrapper models add around a status area.
   *
   * Models do not keep these on their own lines: the common real shape is
   * `<details><summary>[角色状态]</summary> \`\`\`` — summary and the opening
   * fence on the SAME line. Matching line-by-line left `角色状态]</summary> \`\`\``
   * behind as visible debris, so this is deliberately tolerant about position.
   * @returns {{text:string, section:string}}
   */
  const unwrapLine = (line) => {
    let s = String(line).trim()
    if (!s) return { text: '', section: '' }

    let section = ''
    const sum = s.match(/<summary\b[^>]*>\s*([\s\S]*?)\s*<\/summary>/i)
    if (sum) {
      section = sum[1].replace(/^\[|\]$/g, '').trim()
      s = s.replace(sum[0], ' ').trim()
    }
    // Drop the wrapper tags wherever they sit on the line.
    s = s.replace(/<\/?(?:details|summary)\b[^>]*>/gi, ' ').trim()
    // Code fences may appear midline (```) or alone; drop them everywhere.
    s = s.replace(/`{3,}\s*[a-zA-Z]*/g, ' ').trim()
    // A bare `[角色状态]` marker is a plain-text section label.
    if (!section) {
      const bare = s.match(/^\[([^\]]{1,20})\]$/)
      if (bare) section = bare[1].trim()
    }
    s = squeeze(s)
    // Return the section AND whatever text shared its line. Models routinely
    // put the character on the same line as the summary:
    //   `<details><summary>[角色状态]</summary> ``` - 😃 川上富江的状态 -`
    // Dropping the remainder here cost the entire character block.
    return { text: section ? s : s, section, remainder: section ? s : '' }
  }

  const isFieldLine = (line) => /^[-•*]\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(line)

  /**
   * `- 😃 名字的状态` / `- 😋 名字`.
   *
   * The discriminator is structural: a field carries `label：value`, a name
   * never has a colon. An earlier version instead rejected names containing
   * 状态/行动/… — which discarded exactly the ecosystem's most common shape,
   * `- 😃 <名字>的状态`, leaving the whole character block unrendered.
   */
  const asNameLine = (line) => {
    // Models bracket the name with dashes (`- 😃 名字的状态 -`); a bare trailing
    // dash otherwise survives into the name and defeats the 的状态 strip.
    const trimmed = line.replace(/[\s\-–—]+$/, '').trim()
    if (/[:：]/.test(trimmed)) return null
    const m = trimmed.match(/^[-•*]?\s*([\p{Emoji_Presentation}\p{Extended_Pictographic}]+)\s*([^：:\n]{1,28})$/u)
    if (!m) return null
    const name = squeeze(m[2]).replace(/的状态$/, '').replace(/状态$/, '').replace(/[\s\-–—]+$/, '').trim()
    if (!name) return null
    return { emoji: m[1], name }
  }

  // Ordered output: sections and character blocks are emitted in the order the
  // model wrote them. Keeping two separate arrays (sections, characters) and
  // rendering them one after the other scrambled the card — fields that
  // appeared before the first name landed in the section area, so a character
  // ended up rendered *below* their own fields.
  const blocks = []
  let current = null
  // Options section state: `行动选项:` (or a bare `- 行动选项`) switches the
  // following lines from "fields of the current character" to "choices".
  let inOptions = false
  const options = []
  // Section labels that arrived while a character was still collecting fields.
  // Models routinely stamp the *next* section marker one block early —
  //   `<details><summary>[NPC状态]</summary> 🌸 下体状况：… - 🥩 肉质：… - 😃 森田`
  // — so closing the character on the marker orphans those fields and they
  // render as loose lines under the wrong heading. Hold the label instead and
  // release it once we know where the character boundary really is.
  const pendingSections = []

  // A single source line often packs several things together, e.g.
  //   `🌸 下体状况：… - 🥩 肉质：… - 😃 森田的状态 -`
  // Treating that as one field loses two fields *and* hides a character name,
  // which then renders inside the wrong section. Split it at ` - ` boundaries
  // that are followed by an emoji, and classify each segment on its own.
  // A trailing ` -` with no emoji after it is part of the value, not a break.
  const SEGMENT_SPLIT = /\s+[-–—]\s+(?=[\p{Emoji_Presentation}\p{Extended_Pictographic}])/u

  const closeChar = () => {
    if (!current) return
    blocks.push(current)
    current = null
    // The held label belongs after the character we just closed.
    while (pendingSections.length) blocks.push({ kind: 'section', text: pendingSections.shift() })
  }

  const emit = (piece) => {
    if (piece.section) {
      // An options heading is a section in appearance but an option list in
      // purpose: `行动选项` followed by `- 走过去搭话`. Treating it as an
      // ordinary section rendered the label and the options as dead text.
      if (optionsLabel(piece.section) !== null || isOptionsHeading(piece.section)) { inOptions = true; return }
      if (current) pendingSections.push(piece.section)
      else blocks.push({ kind: 'section', text: piece.section })
      return
    }
    const text = piece.text
    if (inOptions && isOptionLine(text)) {
      const opt = stripOptionMarker(text)
      if (opt) { options.push(opt); return }
    }
    // A plain-text `行动选项:` line (no section wrapper around it, and no
    // value after the colon). `optionsLabel` already peeked past the label;
    // an empty capture means the label stood alone, so the rest of the list
    // follows on subsequent lines.
    if (isOptionsHeading(text)) {
      inOptions = true
      return
    }
    const nameHit = asNameLine(text)
    if (nameHit) {
      inOptions = false
      closeChar()
      current = { kind: 'char', emoji: nameHit.emoji, name: nameHit.name, fields: [] }
      return
    }
    const looksLikeField = isFieldLine(text)
      || (/[:：]/.test(text) && /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text))
    if (looksLikeField) {
      const t = text.replace(/^[-•*]\s*/, '').trim()
      if (current) { current.fields.push(t); return }
      while (pendingSections.length) blocks.push({ kind: 'section', text: pendingSections.shift() })
      blocks.push({ kind: 'line', text: t })
      return
    }
    if (current) { current.fields.push(text); return }
    // A bracketed label that we already emitted as a section must not also
    // appear as a bare line (`[Character Status]` was rendered twice).
    const asSect = String(text).replace(/^\[|\]$/g, '').trim()
    if (blocks.some(b => b.kind === 'section' && String(b.text).replace(/^\[|\]$/g, '').trim() === asSect)) return
    while (pendingSections.length) blocks.push({ kind: 'section', text: pendingSections.shift() })
    blocks.push({ kind: 'line', text })
  }

  for (const rawLine of String(cleaned).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const unwrapped = unwrapLine(line)

    // One source line may carry a section label, content, or both.
    const pieces = []
    if (unwrapped.section) pieces.push({ section: unwrapped.section })
    if (unwrapped.text) {
      for (const seg of unwrapped.text.split(SEGMENT_SPLIT)) {
        const s = seg.trim()
        if (s) pieces.push({ text: s })
      }
    }
    for (const piece of pieces) emit(piece)
  }
  closeChar()
  while (pendingSections.length) blocks.push({ kind: 'section', text: pendingSections.shift() })

  const chars = blocks.filter(b => b.kind === 'char')
  if (!blocks.length) return null

  // A recognised header alone is already worth rendering: the model often emits
  // `『📅 … | ⏰ … | 📍 …』` plus section labels and nothing else, and showing a
  // clean header beats leaving the raw corner-bracket text on screen. But if
  // there is neither a character block nor a header, this is ordinary prose —
  // decline so stage 5 (variable template) can decide.
  const hdr = extractHeaderFields(body)
  const hasHeader = !!(hdr.date || hdr.time || hdr.location)
  if (!chars.length && !hasHeader) return null

  const parts = ['<div class="muv-sb">']
  if (hasHeader) {
    const head = []
    if (hdr.date || hdr.time) head.push('📅 ' + esc([hdr.date, hdr.time].filter(Boolean).join(' ')))
    if (hdr.location) head.push('📍 ' + esc(hdr.location))
    if (hdr.weather) head.push('🌤 ' + esc(hdr.weather))
    parts.push('<div class="muv-sb-hd">' + head.map(h => '<span>' + h + '</span>').join('') + '</div>')
  }

  parts.push('<div class="muv-sb-body">')
  for (const b of blocks) {
    if (b.kind === 'section') {
      parts.push('<div class="muv-sb-sect">' + esc(String(b.text).replace(/^#{1,6}\s*/, '')) + '</div>')
    } else if (b.kind === 'line') {
      parts.push('<div class="muv-sb-line">' + esc(b.text) + '</div>')
    } else {
      // Character: name on its own row, then every field on its own line so a
      // long value can never sit beside another field.
      parts.push('<div class="muv-sb-char">')
      parts.push('<div class="muv-sb-char-name">' + esc(b.emoji + ' ' + b.name) + '</div>')
      for (const f of b.fields) {
        const m = f.match(/^([^：:]{1,12})\s*[：:]\s*([\s\S]*)$/)
        if (m) parts.push('<div class="muv-sb-line"><b>' + esc(m[1]) + '</b>' + esc(m[2]) + '</div>')
        else parts.push('<div class="muv-sb-line">' + esc(f) + '</div>')
      }
      parts.push('</div>')
    }
  }
  parts.push('</div></div>')
  if (options.length) parts.push(renderOptions(options))
  return { html: parts.join(''), source: 'loose' }
}

// ──────────────────────────────── shared ────────────────────────────────────

/**
 * Render a field value with its icon, avoiding a doubled prefix when the value
 * already starts with one (cards commonly write `行动: "📝 …"`).
 * @param {string} value
 * @param {string} icon
 * @returns {string} HTML
 */
function fieldWithIcon(value, icon) {
  const v = String(value == null ? '' : value).trim()
  const hasIcon = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(v)
  return esc(hasIcon ? v : icon + ' ' + v)
}

/**
 * Does this line open an options section?
 *
 * Models label it in several ways (`行动选项:`, `可选行动`, `请选择`, `选项：`),
 * and the label frequently carries the first option on the same line
 * (`行动选项：A. 走过去搭话`), so callers also read the captured tail.
 * @param {string} line
 * @returns {string|null} the text after the label, '' when nothing follows
 */
const OPTIONS_LABEL_RE = /^(?:行动选项|可选行动|行动选择|请选择|选择行动|选项|选择|行动|options?|choices?|actions?|select(?:\s+an?\s+option)?)\s*[:：]?\s*([\s\S]*)$/i
function optionsLabel(line) {
  // Models decorate this heading ("## 行动选项", "**行动选项**", "- 行动选项"),
  // and markdown DSH rendered may already have turned it into a heading element.
  // Unwrapping first keeps the label recognisable instead of losing the list.
  const t = String(line || '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^__(.*?)__$/, '$1')
    .trim()
  const m = OPTIONS_LABEL_RE.exec(t)
  return m ? m[1].trim() : null
}

/** True when the line is *only* an options heading (nothing follows the colon). */
function isOptionsHeading(line) {
  const t = String(line || '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\*\*(.*?)\*\*$/, '$1')
    .replace(/^__(.*?)__$/, '$1')
    .trim()
  return /^(?:行动选项|可选行动|行动选择|请选择|选择行动|选项|选择|行动|options?|choices?|actions?|select(?:\s+an?\s+option)?)\s*[:：]?\s*$/i.test(t)
}

/**
 * Strip the marker that introduces an option, leaving its text.
 *
 * Every shape a model uses for "this is one option": a bullet, a number
 * (`1.` `2、` `3)`), or a letter (`A.` `B、` `C)`), plus full-width variants.
 * Letters matter as much as numbers here — a card that writes
 * `行动选项:\nA. 搭话\nB. 离开` previously lost the whole section, because the
 * free parser only accepted `1.`-style items.
 * @param {string} line
 * @returns {string} the option text ('' when the line was only a marker)
 */
function stripOptionMarker(line) {
  return String(line || '')
    .trim()
    .replace(/^[-•*·–—]\s*/, '')
    .replace(/^[（(]?\s*(?:\d{1,2}|[A-Za-z]|[一二三四五六七八九十])\s*[)）.、．:：]\s*/, '')
    .replace(/^[（(]\s*(?:\d{1,2}|[A-Za-z]|[一二三四五六七八九十])\s*[)）]\s*/, '')
    .trim()
}

/**
 * Is this line a plausible option once an options section is open?
 *
 * Anything that is not plainly a *different* heading counts, so a lettered,
 * numbered, bulleted or bare `走过去搭话` all qualify. The exclusions matter:
 * a character name (`😃 森田`) or another labelled field must end the section
 * rather than be swallowed as a choice.
 * @param {string} line
 */
function isOptionLine(line) {
  const t = String(line || '').trim()
  if (!t) return false
  // A character heading ends the options list.
  if (/^👤/u.test(t)) return false
  if (/^[-•*]?\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*[^：:\n]{1,28}$/u.test(t.replace(/[\s\-–—]+$/, ''))) return false
  // A labelled field (`当前行动：…`) or a second options heading ends it too.
  if (/^[^：:\n]{1,12}\s*[:：]\s*\S/.test(t) && optionsLabel(t) === null) return false
  if (t !== '行动选项' && optionsLabel(t) !== null) return false
  return true
}

/** Clickable option buttons (the tavern client wires the click handler). */
function renderOptions(options) {
  const items = options.map(o => '<button type="button" class="muv-sb-opt">' + esc(o) + '</button>').join('')
  return '<div class="muv-sb-opts"><div class="muv-sb-opts-title">行动选项</div>' + items + '</div>'
}

/** The status body inside `<Status_block>…</Status_block>` (or `<状况>`). */export function extractStatusBody(text) {
  if (!text) return ''
  const m = String(text).match(/<\s*Status_block\s*>([\s\S]*?)<\s*\/\s*Status_block\s*>/i)
    || String(text).match(/<\s*状况\s*>([\s\S]*?)<\s*\/\s*状况\s*>/i)
  if (m) return m[1]
  // Escaped form (&lt;Status_block&gt;…)
  const e = String(text).match(/&lt;\s*Status_block\s*&gt;([\s\S]*?)&lt;\s*\/\s*Status_block\s*&gt;/i)
  return e ? e[1] : ''
}

/**
 * Run stages 2-4 over a status body.
 * Stage 1 (the card's own HTML) and stage 5 (variables) are handled by the
 * caller, which owns the card and the variable text.
 * @param {string} body
 * @returns {{html:string, source:string}|null}
 */
export function renderStatusFromText(body) {
  if (!body || !body.trim()) return null
  const decoded = String(body)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return parseYamlStatusBlock(decoded)
    || parseFreeStatusBlock(decoded)
    || parseLooseStatusBlock(decoded)
    || null
}
