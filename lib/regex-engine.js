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
 * Apply all regex scripts from a character card to text.
 * Scripts are ordered by placement (promptOnly vs markdownOnly).
 * @param {string} text - LLM output text
 * @param {object[]} scripts - Array of regex_scripts from card
 * @returns {{ text: string, applied: number }} Transformed text and count
 */
export function applyAllRegexScripts(text, scripts) {
  if (!scripts || !Array.isArray(scripts)) return { text, applied: 0 }
  let result = text
  let applied = 0

  for (const script of scripts) {
    if (script.disabled) continue
    if (script.markdownOnly === false && script.promptOnly === false) continue
    const before = result
    result = applyRegexScript(result, script)
    if (result !== before) applied++
  }

  return { text: result, applied }
}

/**
 * Extract the status bar HTML from regex scripts.
 * The status bar script replaces <StatusPlaceHolderImpl/> with full HTML/CSS.
 * @param {object[]} scripts
 * @returns {string|null} HTML string or null
 */
export function extractStatusBarHtml(scripts) {
  if (!scripts || !Array.isArray(scripts)) return null
  for (const script of scripts) {
    if (script.scriptName && script.scriptName.includes('状态栏') && script.findRegex === '<StatusPlaceHolderImpl/>') {
      const html = script.replaceString
      // Extract HTML from markdown code block if present
      const m = html.match(/```html\s*([\s\S]*?)```/i)
      return m ? m[1] : html
    }
  }
  return null
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}