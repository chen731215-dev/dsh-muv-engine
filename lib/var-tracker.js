// dsh-muv-engine: Variable State Tracker
// Extracts, validates, and stores MUV variable state per session.
import { parseInitvar, serializeInitvar } from 'dsh-muv-table/lib/initvar-parser.js'

const stateStore = new Map() // sessionId → { data, schema, updatedAt }

/**
 * Extract <UpdateVariable><initvar> blocks from text.
 * @param {string} text
 * @returns {string[]} Array of raw initvar text blocks
 */
export function extractInitvarBlocks(text) {
  const blocks = []
  const regex = /<initvar>([\s\S]*?)<\/initvar>/gi
  let m
  while ((m = regex.exec(text)) !== null) {
    blocks.push(m[1].trim())
  }
  return blocks
}

/**
 * Parse the latest initvar block from text and return parsed data.
 * @param {string} text
 * @returns {object|null} Parsed variable data or null
 */
export function parseLatestInitvar(text) {
  const blocks = extractInitvarBlocks(text)
  if (blocks.length === 0) return null
  try {
    return parseInitvar(blocks[blocks.length - 1])
  } catch {
    return null
  }
}

/**
 * Get stored variable state for a session.
 * @param {string} sessionId
 * @returns {{ data: object, updatedAt: number }|null}
 */
export function getState(sessionId) {
  return stateStore.get(sessionId) || null
}

/**
 * Update variable state for a session.
 * @param {string} sessionId
 * @param {object} data - New variable data
 */
export function setState(sessionId, data) {
  stateStore.set(sessionId, {
    data,
    updatedAt: Date.now()
  })
}

/**
 * Merge new variable data into existing state.
 * @param {string} sessionId
 * @param {object} newData - New variable data to merge
 * @returns {object} Merged data
 */
export function mergeState(sessionId, newData) {
  const existing = stateStore.get(sessionId)
  const merged = existing ? deepMerge(existing.data, newData) : newData
  stateStore.set(sessionId, {
    data: merged,
    updatedAt: Date.now()
  })
  return merged
}

/**
 * Generate a complete <UpdateVariable> block from stored state.
 * @param {string} sessionId
 * @returns {string|null}
 */
export function generateBlock(sessionId) {
  const state = stateStore.get(sessionId)
  if (!state || !state.data) return null
  const inner = serializeInitvar(state.data)
  return `<UpdateVariable>\n<initvar>\n${inner}</initvar>\n</UpdateVariable>`
}

/**
 * Deep merge two objects.
 */
function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}