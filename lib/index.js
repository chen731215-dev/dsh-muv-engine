// dsh-muv-engine server: API for regex engine, variable tracking, and status bar rendering.
import { applyAllRegexScripts, extractStatusBarHtml, regexScriptsOf } from './regex-engine.js'
import { loadGlobalScripts, importGlobalScripts, deleteGlobalScript, setGlobalScriptDisabled, extractGlobalScripts } from './global-regex.js'
import { renderStatusFromText, extractStatusBody } from './status-cascade.js'
import { getState, setState, mergeState, parseLatestInitvar, generateBlock, extractInitvarBlocks, parseVariableOps, applyVariableMessage, appliedMessageKeys, getSnapshots, getSnapshot } from './var-tracker.js'
import { parseMuvCard } from 'dsh-muv-table/lib/muv-parser.js'
import { applyEditsAndGenerate } from 'dsh-muv-table/lib/block-generator.js'
import fs from 'node:fs'
import { listCardScripts, bindCardScriptPaths } from './card-scripts.js'

export const name = 'muv-engine'
export const inject = ['webServer']

const MAX_BODY = 5 * 1024 * 1024

/**
 * Which placement side a regex request is asking for.
 *
 * Both endpoints below are **display-side** by default: they render a message
 * for the screen, i.e. `isMarkdown = true, isPrompt = false` in SillyTavern's
 * terms (`public/script.js:1809` passes exactly that pair). There is no
 * prompt-side caller today — the tavern owns prompt assembly — so `'prompt'`
 * is accepted but never assumed; anything unrecognised falls back to display
 * rather than silently running the wrong side.
 * @param {unknown} mode
 * @returns {'display'|'prompt'|'all'}
 */
function pickPlacement(mode) {
  return mode === 'prompt' || mode === 'all' ? mode : 'display'
}

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
          const { text, cardPath, mode, depth } = await readBody(req)
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })
          let scripts = []
          if (cardPath && fs.existsSync(cardPath)) {
            try {
              const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'))
              scripts = regexScriptsOf(card)
            } catch (_) {}
          }
          // 显示侧（isMarkdown=true / isPrompt=false）；depth 省略时按 0 处理，
          // 即「正在渲染的这一条」—— 与 SillyTavern 同口径（见 regex-engine.js）。
          const result = applyAllRegexScripts(text, scripts, pickPlacement(mode), { depth })
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
          const cardScripts = regexScriptsOf(cardJson)
          // ★ 生效脚本集 = **全局（先）+ 卡级（后）**（§28）。
          //   顺序即优先级：卡级脚本是卡作者针对这张卡调的，比用户装的全局宽泛替换
          //   更具体 —— 后跑的压过先跑的（后者作用在全局脚本的产出上）。
          //   全局脚本走的是同一条 applyAllRegexScripts 管道，placement（markdownOnly/
          //   promptOnly）、depth、disabled 过滤**全部复用既有语义**（matchesMode），
          //   不另造一套。
          //   status bar HTML 仍只从**卡级**提取：`<StatusPlaceHolderImpl/>` 是卡的
          //   契约，卡级皮肤不该被用户的全局脚本抢走（保守选择）。
          const scripts = [...loadGlobalScripts(), ...cardScripts]
          // 同上：显示侧 + depth 默认 0。`mode`/`depth` 可由调用方显式覆盖。
          const result = applyAllRegexScripts(text, scripts, pickPlacement(body.mode), { depth: body.depth })
          const statusBarHtml = extractStatusBarHtml(cardScripts)
          json(res, 200, { ok: true, text: result.text, applied: result.applied, statusBarHtml })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // GET/POST /api/muv-engine/state — get or update variable state
    //
    // GET 的三个口径（前两个是按楼快照/时间旅行的查询扩展，2026-09-22）：
    //   ① 无参（面板与卡的既有口径，形状**不变**）：
    //        GET /api/muv-engine/state?sessionId=…
    //        → 200 { ok:true, state:{ data, updatedAt } }   （无状态时 state 为 null）
    //   ② 快照清单（按取样时间正序）：
    //        GET /api/muv-engine/state?sessionId=…&snapshots=1
    //        → 200 { ok:true, snapshots:[ { key, at, data|null }, … ] }
    //      data 为 null 是"超大占位"（单条快照复用单消息 200KB 口径，超大的只记键与时间）。
    //   ③ 单楼快照（时间旅行：滚回旧楼看当时的数值）：
    //        GET /api/muv-engine/state?sessionId=…&messageKey=era_mk_xxx
    //        → 200 { ok:true, state:{ data:<该楼应用后的变量树>, updatedAt:<取样时刻> } }
    //        键不存在 → 404 { ok:false, error:'snapshot-not-found' }
    //      ③ 的响应形状与 ① 完全一致（state.data 就是变量树），面板不用改解析。
    //   两个参数同时给时 messageKey 优先（更具体的查询赢；保守选择，两个都不会静默失效）。
    //
    // POST 的两个口径（卡里的写 API 走这条）：
    //   - `{merge:true}`  ⇒ 深合并（`insertOrAssignVariables` / `Mvu.replaceMvuData` 的落点）
    //   - 其余            ⇒ 整树替换（`replaceVariables` 的落点）
    // data 一律在 `setState`/`mergeState` 里过 `normalizeStatData`：`{stat_data:…}` 与
    // ST 存储形态 `{chat:{…variables:{stat_data:…}}}` 都归一成"我们的变量树"（顶层键 = stat_data），
    // 平铺树原样不动。
    {
      kind: 'exact',
      path: '/api/muv-engine/state',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') || 'default'
          const messageKey = url.searchParams.get('messageKey')
          if (messageKey) {
            const snap = getSnapshot(sessionId, messageKey)
            if (!snap) return json(res, 404, { ok: false, error: 'snapshot-not-found' })
            // 形状与普通 GET 完全一致：state.data 就是该楼应用后的变量树（超大占位时为 null）
            return json(res, 200, { ok: true, state: { data: snap.data, updatedAt: snap.at } })
          }
          const wantSnapshots = url.searchParams.get('snapshots')
          if (wantSnapshots === '1' || wantSnapshots === 'true') {
            return json(res, 200, { ok: true, snapshots: getSnapshots(sessionId) })
          }
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
          if (parsed) mergeState(sid, parsed)
          // ★ 社区卡（TavernHelper ERA 变量框架）的**每楼增量**：`<VariableEdit>` 这类块里
          //   是部分变量树的 JSON。模型的真值只在这里（卡的声明式 initvar 里那些字段是空串），
          //   不接它就表现为「选项空白 / 数值不动 / CG 视频锁着」。
          //   记账按消息键时序重放 ⇒ 装饰乱序或重复送达都不会把状态弄回退。
          // ★ 同一趟里还收 ③ 命令式写入（`_.set('a.b', 值)` / `_.add('a.b', 1)`）与
          //   ④ `stat_data` 归一（`chat[i].variables.stat_data` 形态 ⇒ `{stat_data:…}`）——
          //   三种来源共用一套顺序语义（见 var-tracker.js 的 parseVariableOps 注释）。
          const vp = parseVariableOps(text)
          const applied = vp.ops.length > 0
            ? applyVariableMessage(sid, { key: vp.key, epoch: vp.epoch, ops: vp.ops })
            : null
          const state = getState(sid)
          const block = parsed ? generateBlock(sid) : null
          json(res, 200, {
            ok: true,
            parsed,
            block,
            blocks: parsed ? extractInitvarBlocks(text) : [],
            variableOps: vp.ops.length,
            commandOps: vp.commands,
            badCommandOps: vp.badCommands,
            badVariableBlocks: vp.bad,
            messageKey: vp.key,
            appliedKeys: appliedMessageKeys(sid).length,
            state: state ? state.data : null
          })
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
    // POST /api/muv-engine/render-status — cascade a status area out of raw text
    {
      kind: 'exact',
      path: '/api/muv-engine/render-status',
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const body = await readBody(req)
          const text = body.text || ''
          const cardJson = body.cardJson || null
          // ★ 第 35 轮：显式 `body` 入口 —— 客户端（`muvRenderLooseStatusBody`）判定的
          //   「状态折叠块」正文，**没有** `<Status_block>` 包裹，`extractStatusBody`
          //   对它必然返回空串。它和 `text` 的分工是明确的：
          //     · `text`  = 整条消息，服务端自己找 `<Status_block>` 再级联（既有口径，不变）；
          //     · `body`  = 调用方**已经判定过**的状态体，直接跑结构级联（yaml/free/loose）。
          //   为什么不做成"没有 Status_block 就把整条 text 当 body"：那等于让 loose/yaml
          //   解析器去读任意散文（`『』` 表头、`xx：yy` 行到处都是），误伤面不可接受。
          //   所以入口必须显式，判据留在调用方。体积上限照客户端那侧的口径再收一层。
          const rawBody = typeof body.body === 'string' ? body.body.slice(0, 20000) : ''
          if (rawBody) {
            const rendered = renderStatusFromText(rawBody)
            if (rendered) return json(res, 200, { ok: true, stage: rendered.source, html: rendered.html })
            return json(res, 200, { ok: true, stage: null, html: null })
          }
          if (!text) return json(res, 400, { ok: false, error: 'missing text' })

          const scripts = regexScriptsOf(cardJson)
          // Stage 1: the card's own HTML wins outright.
          const cardHtml = extractStatusBarHtml(scripts)
          if (cardHtml) return json(res, 200, { ok: true, stage: 'card', html: cardHtml })

          // Stages 2-4: structural parsers over the status body.
          const statusBody = extractStatusBody(text)
          const rendered = renderStatusFromText(statusBody)
          if (rendered) return json(res, 200, { ok: true, stage: rendered.source, html: rendered.html })

          // Stage 5 (built-in variable template) belongs to the client, which
          // also owns its CSS; report "no structural match" and let it decide.
          return json(res, 200, { ok: true, stage: null, html: null, hadBody: !!statusBody })
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
          const scripts = regexScriptsOf(cardJson)
          const html = extractStatusBarHtml(scripts)
          json(res, 200, { ok: true, html, scriptCount: scripts.length })
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // ── 全局正则脚本库（§28）───────────────────────────────────────────────
    // ST 生态的"全局正则扩展"承接层：用户装的、独立于卡的美化/净化脚本。
    // 存储与解析见 lib/global-regex.js；生效顺序 = 全局（先）+ 卡级（后），
    // 合并发生在 /api/muv-engine/apply-regex-card（上面）。
    //
    // GET /api/muv-engine/global-regex
    //   → 200 { ok:true, scripts:[ { id, scriptName, findRegex, … } ] }（落库原序）
    //
    // POST /api/muv-engine/global-regex   —— 导入（body 即 ST 导出件本身）
    //   body 宽容解析四种形态：裸数组 / {scripts:[…]} /
    //   {data:{extensions:{regex_scripts:[…]}}} / 外面再包一层 {compatibility:…}。
    //   mode 两档：`?mode=append`（或 body.mode:'append'）同名同式跳过；
    //   默认 upsert：同名同式（scriptName+findRegex 逐字相等）覆盖为新版。
    //   → 200 { ok:true, added, replaced, skipped, invalid, total, reasons }
    //     非法条目（缺/坏 findRegex、字段超 256KB）跳过并计数，不整批失败；
    //   → 400 { ok:false, error:'capacity-exceeded…' }  入库总量将超 200 条时整批拒绝；
    //   → 400 { ok:false, error:'no-scripts-found' }    四种形态都没认出来。
    //
    // DELETE /api/muv-engine/global-regex?id=<id>
    //   或 POST { action:'delete', id }（两者等价，客户端 fetch DELETE 不便时用后者）
    //   → 200 { ok:true, deleted:<id> }
    //   → 404 { ok:false, error:'not-found' }  id 不存在（id 可由 GET 拿到）
    {
      kind: 'exact',
      path: '/api/muv-engine/global-regex',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET') {
          return json(res, 200, { ok: true, scripts: loadGlobalScripts() })
        }
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id')
          if (!id) return json(res, 400, { ok: false, error: 'missing id' })
          if (!deleteGlobalScript(id)) return json(res, 404, { ok: false, error: 'not-found' })
          return json(res, 200, { ok: true, deleted: id })
        }
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const body = await readBody(req)
          // POST 兼容两个口径：{action:'delete', id} 与直接把 ST 导出件当 body。
          if (body && body.action === 'delete') {
            const id = body.id
            if (!id) return json(res, 400, { ok: false, error: 'missing id' })
            if (!deleteGlobalScript(id)) return json(res, 404, { ok: false, error: 'not-found' })
            return json(res, 200, { ok: true, deleted: id })
          }
          // 面板启停开关：{action:'set-disabled', id, disabled:boolean}
          if (body && body.action === 'set-disabled') {
            const id = body.id
            if (!id) return json(res, 400, { ok: false, error: 'missing id' })
            const hit = setGlobalScriptDisabled(id, body.disabled === true)
            if (!hit) return json(res, 404, { ok: false, error: 'not-found' })
            return json(res, 200, { ok: true, id, disabled: hit.disabled })
          }
          const list = extractGlobalScripts(body)
          if (!list.length) return json(res, 400, { ok: false, error: 'no-scripts-found' })
          const mode = url.searchParams.get('mode') || body.mode
          const stats = importGlobalScripts(list, { mode: mode === 'append' ? 'append' : 'upsert' })
          json(res, 200, { ok: true, ...stats })
        } catch (e) {
          if (e.code === 'CAPACITY') return json(res, 400, { ok: false, error: e.message })
          json(res, 400, { ok: false, error: e.message })
        }
      }
    },
    // GET /api/muv-engine/card-scripts — 角色卡自带的 TavernHelper（酒馆助手）脚本。
    //
    // ST 里这类脚本由「酒馆助手」插件执行；MVU 的状态栏 HUD、各类运行时 UI 都是它们画的
    // （真卡实测：`魔法少女MVU测试` 的状态栏正则 replaceString 是**空串**，HUD 全靠
    // `data.extensions.tavern_helper.scripts[0]` 那行 `import '…/bundle.js'` 拉起来）。
    // 前端在 `cardHtmlIframe` 里把它们按序注成 `<script type="module">` —— 但先要有个源。
    //
    // 查询参数是 `cardName`（卡名，必填）与 `presetDir`（预设目录名，可选，用于走
    // 预设内的托管副本这条快车道）。两个值都先消毒，`presettDir` 参与 `path.join`，
    // `cardName` 只用于名字比对 —— 都不允许出现路径分隔符、`..`。
    // 返回形状：`{ok:true, scripts:[{name,id,content}], total, enabled, source, fileName, reason}`
    //   · 找不到卡 ⇒ `scripts: []` + `reason`（不是 HTTP 错误：没有脚本是卡的正常形态，
    //     HTTP 错误会让前端每次渲染都在控制台报错）；
    //   · `total` = 卡里全部脚本条数，`enabled` = 返回条数 —— 两者的差就是被作者在 ST 里
    //     关掉的那几条（前端**不注入**它们，与 ST 一致）。
    {
      kind: 'exact',
      path: '/api/muv-engine/card-scripts',
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const url = new URL(req.url, 'http://localhost')
          const query = {
            cardName: url.searchParams.get('cardName') || '',
            presetDir: url.searchParams.get('presetDir') || ''
          }
          json(res, 200, listCardScripts(query))
        } catch (e) {
          json(res, 400, { ok: false, error: e.message })
        }
      }
    }
  ]

  bindCardScriptPaths(ctx)

  for (const route of routes) {
    ctx.webServer.register(route)
  }
}