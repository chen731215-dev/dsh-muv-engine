// dsh-muv-engine server: API for regex engine, variable tracking, and status bar rendering.
import { applyAllRegexScripts, extractStatusBarHtml } from './regex-engine.js'
import { getState, setState, mergeState, parseLatestInitvar, generateBlock, extractInitvarBlocks } from './var-tracker.js'
import { parseMuvCard } from '../../muv-table/lib/muv-parser.js'
import { applyEditsAndGenerate } from '../../muv-table/lib/block-generator.js'
import fs from 'node:fs'

export const name = 'muv-engine'
export const inject = ['webServer']

const MAX_BODY = 5 * 1024 * 1024

// ★ 服务端宏展开：{[random::]}, {[pick::]}, {[roll::]}
function expandMacrosServer(text, sessionId) {
  if (!text) return text
  let result = text
  const sid = sessionId || 'default'

  // random: {[random::opt1::opt2::...]}
  result = result.replace(/\{\[random::([\s\S]*?)\]\}/g, (_, options) => {
    const opts = options.split('::').map(s => s.trim()).filter(Boolean)
    if (opts.length === 0) return ''
    return opts[Math.floor(Math.random() * opts.length)]
  })

  // pick: {[pick::cacheKey::opt1::opt2::...]}
  result = result.replace(/\{\[pick::([^:]+)::([\s\S]*?)\]\}/g, (_, key, options) => {
    const cacheKey = 'pick_' + key.trim()
    const state = getState(sid)
    if (state && state[cacheKey] !== undefined) return state[cacheKey]
    const opts = options.split('::').map(s => s.trim()).filter(Boolean)
    if (opts.length === 0) return ''
    const picked = opts[Math.floor(Math.random() * opts.length)]
    const update = {}
    update[cacheKey] = picked
    setState(sid, { ...(state || {}), ...update })
    return picked
  })

  // roll: {[roll::NdM]} or {[roll::NdM+K]}
  result = result.replace(/\{\[roll::(\d+)d(\d+)(?:([+-])\s*(\d+))?\]\}/g, (_, n, m, op, mod) => {
    const count = parseInt(n, 10) || 1
    const sides = parseInt(m, 10) || 6
    let total = 0
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1
    if (op && mod) total = op === '+' ? total + parseInt(mod, 10) : total - parseInt(mod, 10)
    return String(total)
  })

  return result
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('body-too-large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (e) { reject(new Error('invalid-json')) }
    })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const routes = [
    // POST /api/muv-engine/expand-macros — expand {[random::]}, {[pick::]}, {[roll::]}
    {
      kind: 'exact',
      path: '/api/muv-engine/expand-macros',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { text, sessionId } = await readBody(req)
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })
          const expanded = expandMacrosServer(text, sessionId)
          json(res, 200, { ok: true, text: expanded })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/reroll-pick — clear pick cache for a key
    {
      kind: 'exact',
      path: '/api/muv-engine/reroll-pick',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { key, sessionId } = await readBody(req)
          if (!key) return json(res, 400, { ok: false, error: 'missing key' })
          const sid = sessionId || 'default'
          const cacheKey = 'pick_' + key
          const state = getState(sid) || {}
          delete state[cacheKey]
          setState(sid, state)
          json(res, 200, { ok: true, cleared: key })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/apply-regex — apply card's regex scripts to text
    {
      kind: 'exact',
      path: '/api/muv-engine/apply-regex',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { text, cardPath } = await readBody(req)
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })
          let scripts = []
          if (cardPath && fs.existsSync(cardPath)) {
            try {
              const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'))
              scripts = card?.data?.extensions?.regex_scripts || []
            } catch (_) {}
          }
          const result = applyAllRegexScripts(text, scripts)
          json(res, 200, { ok: true, text: result.text, applied: result.applied })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/apply-regex-card — apply regex scripts from card JSON directly
    {
      kind: 'exact',
      path: '/api/muv-engine/apply-regex-card',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const body = await readBody(req)
          const text = body.text
          const cardJson = body.cardJson || body
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })
          const scripts = cardJson?.data?.extensions?.regex_scripts || []
          const result = applyAllRegexScripts(text, scripts)
          const statusBarHtml = extractStatusBarHtml(scripts)
          json(res, 200, { ok: true, text: result.text, applied: result.applied, statusBarHtml })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // GET/POST /api/muv-engine/state — get or update variable state
    {
      kind: 'exact',
      path: '/api/muv-engine/state',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') || 'default'
          const state = getState(sessionId)
          json(res, 200, { ok: true, state })
          return
        }
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { sessionId, data, merge } = await readBody(req)
          const sid = sessionId || 'default'
          if (merge) {
            const merged = mergeState(sid, data)
            json(res, 200, { ok: true, data: merged })
          } else {
            setState(sid, data)
            json(res, 200, { ok: true, data })
          }
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/extract — extract initvar from text, update state, generate block
    {
      kind: 'exact',
      path: '/api/muv-engine/extract',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { text, sessionId } = await readBody(req)
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })
          const sid = sessionId || 'default'
          const parsed = parseLatestInitvar(text)
          if (parsed) {
            mergeState(sid, parsed)
            const block = generateBlock(sid)
            json(res, 200, { ok: true, parsed, block, blocks: extractInitvarBlocks(text) })
          } else {
            json(res, 200, { ok: true, parsed: null, message: 'no initvar found' })
          }
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/generate — generate block from edits
    {
      kind: 'exact',
      path: '/api/muv-engine/generate',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const { originalData, edits, sessionId } = await readBody(req)
          const block = applyEditsAndGenerate(originalData || {}, edits || [])
          if (sessionId) {
            const parsed = parseLatestInitvar(block)
            if (parsed) setState(sessionId, parsed)
          }
          json(res, 200, { ok: true, block })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // POST /api/muv-engine/status-bar — extract status bar HTML from card
    {
      kind: 'exact',
      path: '/api/muv-engine/status-bar',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const body = await readBody(req)
          // Accept both { cardJson: ... } and raw card JSON
          const cardJson = body.cardJson || body
          const scripts = cardJson?.data?.extensions?.regex_scripts || []
          const html = extractStatusBarHtml(scripts)
          json(res, 200, { ok: true, html })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    }
  ]

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}