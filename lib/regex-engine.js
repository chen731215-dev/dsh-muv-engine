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
    let regex = null
    // Check if it's a JS regex literal (starts and ends with /)
    if (findRegex.startsWith('/')) {
      const lastSlash = findRegex.lastIndexOf('/')
      if (lastSlash > 0) {
        regex = new RegExp(findRegex.slice(1, lastSlash), findRegex.slice(lastSlash + 1))
      }
    }
    // Simple string replacement
    if (!regex) regex = new RegExp(escapeRegex(findRegex), 'gi')

    // ★★ 用**函数式替换**，语义照抄 ST 的 `runRegexScript`
    // （`SillyTavern/public/scripts/extensions/regex/engine.js:419-442`）：
    //
    //     rawString.replace(findRegex, function (match) {
    //         const replaceString = regexScript.replaceString.replace(/{{match}}/gi, '$0');
    //         const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, …);
    //         return substituteParams(replaceWithGroups);
    //     })
    //
    // 为什么**必须**是函数而不是字符串替换（这条踩得很贵，别再改回去）：
    //   `String.replace(re, str)` 会把替换串里的 `$'`、`$&`、`` $` ``、`$$` 当成特殊引用。
    //   而卡的正则替换串经常就是**一整页 HTML**（`_足控天堂2` 的 [2]「ERA 状态栏」= 210KB 文档），
    //   文档里的卡 JS 写着 `key.charAt(0)==='$'` —— `$'` 被解释为"匹配之后的文本"，
    //   于是那行变成 `==='<StatusPlaceHolderImpl/>'`（字符串被塞进占位符、**引号错位**），
    //   整段卡脚本当场 `SyntaxError: Invalid or unexpected token`。
    //   后果是**卡的 JS 全废**：tab 切不动、数据不渲染、按钮无反应 ——
    //   而 HTML/CSS 照常显示，所以看起来像"渲染对了但功能没了"，极难定位。
    //   实测证据：真消息走完这条链，srcdoc 第 4102 行 `==='$'` → `==='<StatusPlaceHolderImpl/>'`。
    //   ST 用函数式替换，所以它同一份卡不出事 —— 我们照做。
    // 只展开 `$1`…`$99` 与 `$<name>`（ST 也是这两条），其余 `$` 一律字面量。
    const tpl = String(replaceString).replace(/\{\{match\}\}/gi, '$0')
    return text.replace(regex, function () {
      const args = Array.prototype.slice.call(arguments)
      const last = args[args.length - 1]
      const hasNamed = last && typeof last === 'object'
      const expanded = tpl.replace(/\$(\d+)|\$<([^>]+)>/g, function (whole, num, groupName) {
        if (num !== undefined) {
          const m = args[Number(num)]
          return m === undefined || m === null ? '' : String(m)
        }
        if (groupName !== undefined) {
          if (!hasNamed) return ''
          const v = last[groupName]
          return v === undefined || v === null ? '' : String(v)
        }
        return whole
      })
      return expanded
    })
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
 * Placement rule, aligned with SillyTavern.
 *
 * ST decides placement in exactly one place — `getRegexedString`,
 * `SillyTavern/public/scripts/extensions/regex/engine.js:348-355`:
 *
 *     (script.markdownOnly && isMarkdown) ||
 *     (script.promptOnly  && isPrompt)   ||
 *     (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
 *
 * So a flag means "this script belongs to that side", NOT "this script is
 * excluded from the other side".
 *
 * The previous rule here was `promptOnly !== true` for the display side, which
 * silently dropped every script carrying **both** flags. Real MUV cards mark
 * their blanking rules that way: `_足控天堂2` [3][4][5][8] are
 * `markdownOnly:true + promptOnly:true`, so the `<VariableInsert>{…}` payload
 * they are supposed to delete stayed on screen as ~2.9 KB of raw text.
 * Measured before the fix: the real greeting through the real endpoint came
 * back `applied = 1`, and `[3]` alone takes that same text 2928 → 10 chars.
 *
 * ★ One deliberate deviation from ST, in the third row below: a script with
 *   **neither** flag. ST excludes it from the display pass because it already
 *   ran on the raw source — its own comment says so:
 *     "Script applies to all cases when neither 'only's are true, but there's no
 *      need to do it when `isMarkdown`, the as source (chat history) should
 *      already be changed beforehand"
 *   This engine has **no raw stage**: rendering a message is the only place any
 *   script ever runs. Skipping them here would mean such a script never applies
 *   at all, which is further from ST's user-visible result than applying it.
 *   So "neither" runs on both sides.
 * @param {object} script
 * @param {boolean} isMarkdown - rendering a message
 * @param {boolean} isPrompt - building the outgoing prompt
 * @returns {boolean}
 */
function placementAllows(script, isMarkdown, isPrompt) {
  const md = script.markdownOnly === true
  const po = script.promptOnly === true
  // 两个都开（两边都跑）或两个都没开（单阶段引擎按"原始阶段"处理）→ 任意一侧都跑
  if (md === po) return true
  return md ? isMarkdown : isPrompt
}

/**
 * ST's depth gate (`engine.js:361-372`), same thresholds.
 *
 * Depth counts **backwards from the newest message**: depth 0 is the message
 * being rendered right now, 1 is the previous one, and so on. ST computes it as
 * `usableMessages.length - indexOf - 1` over the non-system chat
 * (`public/script.js:1806`, `isMarkdown: true`) and renders the greeting with
 * an explicit `0` (`public/scripts/welcome-screen.js:277`).
 *
 * This is not optional polish: `_足控天堂2` [8] carries `minDepth: 7` ("hide
 * everything above the 6th floor except the summary") and replaces the whole
 * message with an empty string. Measured, [8] applied alone to that card's
 * greeting collapses it to **0 chars** — so opening the display side without a
 * depth gate trades "raw JSON tail" for "the entire message disappears".
 *
 * Enforced only when a depth is actually known (`typeof depth === 'number'`),
 * exactly like ST. `minDepth: null` is not a depth of 0 — it means "no minimum",
 * so it is checked explicitly (and `undefined` fails `isNaN` as in ST too).
 * @param {object} script
 * @param {number|undefined} depth
 * @returns {boolean}
 */
function depthAllows(script, depth) {
  if (typeof depth !== 'number') return true
  const min = script.minDepth
  if (!isNaN(min) && min !== null && min >= -1 && depth < min) return false
  const max = script.maxDepth
  if (!isNaN(max) && max !== null && max >= 0 && depth > max) return false
  return true
}

/**
 * Whether a script participates in the given application mode.
 *
 *   'display' -> isMarkdown = true,  isPrompt = false  (the message on screen)
 *   'prompt'  -> isMarkdown = false, isPrompt = true   (the outgoing prompt)
 *   'all'     -> no placement filter (historical unfiltered behaviour)
 *
 * Depth: a rendered message defaults to `0` because it IS the newest message,
 * which is what ST passes for the greeting and derives for chat messages. Pass
 * `options.depth` to say otherwise — the prompt side has no sensible default,
 * so `'prompt'` without an explicit depth does no depth filtering at all
 * (again matching ST, whose gate is a no-op when `depth` is not a number).
 * @param {object} script
 * @param {'display'|'prompt'|'all'} mode
 * @param {{depth?: number}} [options]
 * @returns {boolean}
 */
export function matchesMode(script, mode, options = {}) {
  if (!script) return false
  if (mode === 'all') return depthAllows(script, options.depth)
  const isMarkdown = mode !== 'prompt'
  const isPrompt = mode === 'prompt'
  if (!placementAllows(script, isMarkdown, isPrompt)) return false
  const depth = typeof options.depth === 'number'
    ? options.depth
    : (isMarkdown ? 0 : undefined)
  return depthAllows(script, depth)
}

/**
 * Display-side selection for the status-bar HTML (see `extractStatusBarHtml`).
 *
 * Deliberately a **superset** of the old `promptOnly !== true` rule: a script
 * ST runs on the display side (`markdownOnly`) is accepted even when it also
 * carries `promptOnly`, and nothing the old rule accepted is dropped — so this
 * cannot regress a card whose status script is `markdownOnly:false`.
 * @param {object} script
 * @returns {boolean}
 */
function scriptRunsOnDisplay(script) {
  return script.markdownOnly === true || script.promptOnly !== true
}

/**
 * Apply a card's regex scripts to text for one side of the conversation.
 * @param {string} text - LLM output text
 * @param {object[]} scripts - Array of regex_scripts from the card
 * @param {'display'|'prompt'|'all'} [mode='display'] - which placement side to run
 * @param {{depth?: number}} [options] - depth of the text being processed.
 *   Defaults to 0 for the display side (the message being rendered IS the
 *   newest one); omit for `'prompt'` to skip the depth gate.
 * @returns {{ text: string, applied: number }} Transformed text and count
 */
export function applyCardScripts(text, scripts, mode = 'display', options = {}) {
  if (!scripts || !Array.isArray(scripts)) return { text, applied: 0 }
  let result = text
  let applied = 0

  for (const script of scripts) {
    if (!script || script.disabled) continue
    if (!matchesMode(script, mode, options)) continue
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
 * @param {{depth?: number}} [options] - forwarded to `matchesMode`
 * @returns {{ text: string, applied: number }} Transformed text and count
 */
export function applyAllRegexScripts(text, scripts, mode = 'display', options = {}) {
  return applyCardScripts(text, scripts, mode, options)
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
 *   - a script that never runs on the display side is not a source either
 *     (see `scriptRunsOnDisplay`);
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
    scriptRunsOnDisplay(script) &&
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
