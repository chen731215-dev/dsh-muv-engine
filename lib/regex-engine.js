// dsh-muv-engine: Regex Engine
// Parses MUV card regex_scripts and applies them to LLM output text.
// Handles both simple string replacement and regex patterns.

/**
 * Apply a single regex script to text.
 * @param {string} text - Input text
 * @param {object} script - Regex script from character card
 * @param {string} script.findRegex - Pattern to find
 * @param {string} script.replaceString - Replacement string
 * @returns {string} Transformed text
 */
function applyRegexScript(text, script) {
  const findRegex = script.findRegex
  const replaceString = script.replaceString || ''
  if (!findRegex) return text

  try {
    // Check if it's a JS regex literal (starts and ends with /)
    if (findRegex.startsWith('/')) {
      const lastSlash = findRegex.lastIndexOf('/')
      if (lastSlash > 0) {
        const pattern = findRegex.slice(1, lastSlash)
        const flags = findRegex.slice(lastSlash + 1)
        const regex = new RegExp(pattern, flags)
        return text.replace(regex, replaceString)
      }
    }
    // Simple string replacement
    const escaped = escapeRegex(findRegex)
    return text.replace(new RegExp(escaped, 'gi'), replaceString)
  } catch (e) {
    return text
  }
}

/**
 * Read a card's regex scripts in whatever shape the producer used.
 *
 * The engine is fed from several places (the muv-table card API, a raw card
 * JSON posted by a client, a preset's own `muv-tables/card.json`), and they do
 * not agree on where the scripts live. Accepting both shapes keeps one missing
 * key from silently disabling every beautification rule.
 * @param {object|null} card - a card or a card-derived payload
 * @returns {object[]} the scripts, or an empty array
 */
export function regexScriptsOf(card) {
  if (!card || typeof card !== 'object') return []
  const direct = card.regexScripts
  if (Array.isArray(direct)) return direct
  const nested = card?.data?.extensions?.regex_scripts
  if (Array.isArray(nested)) return nested
  // A raw card posted as the body itself, or nested under `cardJson`.
  const inner = card.cardJson
  if (inner && inner !== card) return regexScriptsOf(inner)
  return []
}

/**
 * Normalize a card's `findRegex` for structural comparison.
 *
 * Real cards write the same target in many shapes:
 *   `<StatusPlaceHolderImpl/>`
 *   `<StatusPlaceHolderImpl />`
 *   `/<StatusPlaceHolderImpl\/>/`
 *   `/<StatusPlaceHolderImpl\/>/gi`
 * Strip a `/.../flags` literal shell, drop regex escapes, and collapse
 * whitespace so all of the above compare equal.
 * @param {string} findRegex
 * @returns {string} normalized pattern
 */
function normalizeFindRegex(findRegex) {
  if (typeof findRegex !== 'string') return ''
  let pattern = findRegex.trim()
  if (pattern.startsWith('/')) {
    const lastSlash = pattern.lastIndexOf('/')
    if (lastSlash > 0) pattern = pattern.slice(1, lastSlash)
  }
  return pattern.replace(/\\/g, '').replace(/\s+/g, '')
}

/**
 * Whether a script targets the MUV status-bar placeholder.
 *
 * Matching on the placeholder (not on a Chinese script name) is what lets an
 * arbitrary imported card work: the name is free-form across the ecosystem,
 * but the placeholder tag is the contract.
 * @param {object} script
 * @returns {boolean}
 */
export function isStatusPlaceholderScript(script) {
  if (!script) return false
  return /^<StatusPlaceHolderImpl\/?>$/i.test(normalizeFindRegex(script.findRegex))
}

/**
 * Whether a script participates in the given application mode.
 *
 * Cards (and SillyTavern) mark each script with a placement pair:
 *   markdownOnly: true            -> the rendered message
 *   promptOnly: true              -> the prompt sent to the model
 * A renderer must never run a promptOnly script on the message: those scripts
 * routinely blank things out on purpose ("对 AI 隐藏状态栏" replaces the
 * status placeholder with an empty string), so running them on the display
 * silently deletes the very content we are trying to render.
 * @param {object} script
 * @param {'display'|'prompt'|'all'} mode
 * @returns {boolean}
 */
function matchesMode(script, mode) {
  if (mode === 'all') return true
  if (mode === 'prompt') return script.markdownOnly !== true
  return script.promptOnly !== true
}

/**
 * Apply a card's regex scripts to text for one side of the conversation.
 * @param {string} text - LLM output text
 * @param {object[]} scripts - Array of regex_scripts from the card
 * @param {'display'|'prompt'|'all'} [mode='display'] - which placement side to run
 * @returns {{ text: string, applied: number }} Transformed text and count
 */
export function applyCardScripts(text, scripts, mode = 'display') {
  if (!scripts || !Array.isArray(scripts)) return { text, applied: 0 }
  let result = text
  let applied = 0

  for (const script of scripts) {
    if (!script || script.disabled) continue
    if (!matchesMode(script, mode)) continue
    const before = result
    result = applyRegexScript(result, script)
    if (result !== before) applied++
  }

  return { text: result, applied }
}

/**
 * Apply all regex scripts from a character card to text.
 *
 * Defaults to the display side, which is what a renderer wants. Pass
 * `mode: 'all'` to reproduce the historical unfiltered behaviour.
 * @param {string} text - LLM output text
 * @param {object[]} scripts - Array of regex_scripts from card
 * @param {'display'|'prompt'|'all'} [mode='display']
 * @returns {{ text: string, applied: number }} Transformed text and count
 */
export function applyAllRegexScripts(text, scripts, mode = 'display') {
  return applyCardScripts(text, scripts, mode)
}

/**
 * 这段文本是不是**一整个 HTML 文档**（而不是片段/普通代码）？
 *
 * 用来决定「要不要剥掉首尾围栏」：裸 ``` 围栏本身有歧义（普通代码块也长这样），
 * 只有剥出来确实是个整页文档时才敢剥。
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeFullDocument(s) {
  return /^\s*<!doctype/i.test(s) || /^\s*<html[\s>]/i.test(s)
}

/**
 * Extract the status bar HTML from a card's regex scripts.
 *
 * The status bar script replaces `<StatusPlaceHolderImpl/>` with full
 * HTML/CSS. Selection is deliberate rather than "first match wins":
 *   - a disabled script is never a source of live HTML;
 *   - a promptOnly script belongs to the prompt, not the message;
 *   - an empty `replaceString` is a placeholder-guard stub, not the card's
 *     skin, and must not shadow a sibling script that does carry the HTML;
 * so the longest surviving replacement wins.
 * @param {object[]} scripts
 * @returns {string|null} HTML string or null when the card ships none
 */
export function extractStatusBarHtml(scripts) {
  if (!scripts || !Array.isArray(scripts)) return null

  const hits = scripts.filter(script => (
    script &&
    !script.disabled &&
    script.promptOnly !== true &&
    isStatusPlaceholderScript(script) &&
    typeof script.replaceString === 'string' &&
    script.replaceString.trim() !== ''
  ))
  if (hits.length === 0) return null

  hits.sort((a, b) => b.replaceString.length - a.replaceString.length)
  const raw = hits[0].replaceString

  // ① 显式 ```html 围栏（老实现只认这一种）
  const tagged = raw.match(/```html\s*([\s\S]*?)```/i)
  if (tagged) return tagged[1].trim()

  // ② **没有语言标记**的围栏：卡写的是
  //        ```
  //        <!DOCTYPE html>
  //        …
  //        ```
  //    老实现只认 ```html，于是把裸围栏一起返回 —— `_足控天堂2` 的状态栏就是这样，
  //    返回值 210,219 字里带着首尾 ```，交给调用方去 iframe 就会在卡页面上多出两行
  //    反引号文本。
  //    只在「围栏包住整串、且剥出来确实是整页文档」时才剥一层：裸 ``` 有歧义，
  //    无条件剥离会误伤普通代码块与「片段 + 围栏」的混合内容。
  const bare = /^\s*`{3,}[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*`{3,}\s*$/.exec(raw)
  if (bare && looksLikeFullDocument(bare[1])) return bare[1].trim()

  return raw.trim()
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
