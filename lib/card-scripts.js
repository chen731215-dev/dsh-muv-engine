// 卡脚本读取器：把「角色卡自带的 TavernHelper（酒馆助手）脚本」取出来给前端注入。
//
// ── 为什么必须有这个文件 ────────────────────────────────────────────────
// ST 的「酒馆助手」插件会执行卡里注册的脚本。真卡实测（`魔法少女MVU测试.png`）：
// 卡 `data.extensions.tavern_helper.scripts[0]` 的内容就是一行
//   import '…/MagVarUpdate@master/artifact/bundle.js'
// MagVarUpdate（MVU）框架就是靠这一行被拉起来，并由它
//   · 在 `eventOn('mag_variable_update_ended')` 上刷新界面；
//   · 渲染**状态栏 HUD**（那块棕色条）。
// 而同一张卡的正则 `[2]③ 隐藏状态栏占位符 · 显示` 的 replaceString 是**空串**
// —— 也就是说 HUD **不是**卡的正则产物，是脚本在运行时画的。
// DSH 不执行卡脚本 ⇒ bundle 不跑 ⇒ HUD 缺失（用户实测缺口）。本模块专职把脚本取出来。
//
// ── 字段名是实测的，不是猜的 ────────────────────────────────────────────
// 路径：`<卡 JSON>.data.extensions.tavern_helper.scripts`（数组）
// 元素形状：`{type:'script', enabled:true|false, name:'…', id:'…', content:'…',
//              info:'…', button:'…', data:{…}, export_with:…}`
// 实测两卡：
//   魔法少女MVU测试 → 8 条，6 条 enabled（含纯 import、也有 100~190KB 的 IIFE）；
//   _足控天堂2      → 3 条，全 enabled，全是一行的 `import 'https://…'`。
// （取证脚本见 `verify-tavernhelper-scripts.mjs` 顶部注释记的路径。）
//
// ── 为什么要自己找一遍卡文件（而不是向 dsh-muv-table 要）────────────────
// `/api/muv-table/tavern-card` 只返回变量/zod/initvar 那一层，**不含** script。
// 本轮只准改 dsh-muv-engine（muv-table 一动不动），所以这里按同一套口径自己定位卡：
//   ① `<预设目录>/muv-tables/card.json`（托管副本，与 muv-table 的 fast lane 同名）；
//   ② `<预设目录>/*.png`；
//   ③ 外部卡库目录（含 ST 的 characters 目录）——真卡就住在那里。
// 与 muv-table 的差别只有一处（有意）：外部目录先按**文件名**预判，只在没命中时
// 再限量（20 个）按内容读一张 —— 避免每次渲染都把整个 Download/Desktop 扫一遍。
//
// 安全口径：**只读**。查询参数不进文件系统路径 —— `presetDir` / `cardName` 都先消毒
// （不许带路径分隔符、`..`），找不到就返回空数组并给 `reason`（失败要说得出来，不猜、
// 不抛堆栈给前端）。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readPngCard } from 'dsh-muv-table/lib/png-card.js'

/** 单张脚本的条数上限（防畸形卡；真卡最多见过 8 条）。 */
const MAX_SCRIPTS = 20
/** 单条脚本内容的字符上限（2MB）——真卡最大单条 185KB。 */
const MAX_CONTENT = 2 * 1024 * 1024
/** 外部目录里"文件名没命中"时，最多再读几张卡的内容比对。 */
const MAX_CONTENT_PROBE = 20
/** 结果缓存条目上限（LRU 记账，防止历史卡常驻）。 */
const MAX_CACHE = 16

const cache = new Map()

let DSH_HOME = ''
let PRESETS_ROOT = ''
let CARD_DIRS = null

/**
 * 路径参数的消毒：只允许可见的安全字符，**不许**出现分隔符与 `..`。
 * 这些值来自 HTTP 查询串，绝不能直接拼进 `path.join`。
 * @param {string} v
 * @returns {string}
 */
function safeName(v) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (/[\\/]/.test(s)) return ''
  if (/^[.]/.test(s) || s.indexOf('..') >= 0) return ''
  if (s.length > 160) return ''
  return /^[A-Za-z0-9\u4e00-\u9fa5_\-. ]+$/.test(s) ? s : ''
}

/** 名字匹配口径与 muv-table 一致：双向包含、大小写无关。 */
function nameAgrees(a, b) {
  const x = String(a || '').toLowerCase()
  const y = String(b || '').toLowerCase()
  if (!x || !y) return false
  return x.includes(y) || y.includes(x)
}

/**
 * 绑定 DSH home（优先用宿主提供的 `dshHomePath`，退回 `$DSH_HOME` / `~/.dsh`）。
 * 与 `dsh-muv-table/lib/index.js:bindDshPaths` 同一套口径，两边必须指向同一个位置。
 * @param {object} [ctx]
 * @returns {void}
 */
export function bindCardScriptPaths(ctx) {
  let home = ''
  try {
    const fn = ctx && typeof ctx.get === 'function' ? ctx.get('dshHomePath') : undefined
    if (typeof fn === 'function') home = String(fn() || '')
  } catch (_) {}
  if (!home) {
    const env = process.env.DSH_HOME
    if (typeof env === 'string' && env.trim()) home = path.resolve(env.trim())
  }
  if (!home) home = path.join(os.homedir(), '.dsh')
  DSH_HOME = home
  PRESETS_ROOT = path.join(home, '.agent-presets')
  CARD_DIRS = null
}

function presetsRoot() {
  if (!PRESETS_ROOT) bindCardScriptPaths()
  return PRESETS_ROOT
}

/**
 * 外部卡库目录列表（顺序即优先级，去重）。
 * 与 muv-table 的 `MUV_CARD_DIRS` 同口径：`DSH_MUV_CARD_DIRS` 里的显式项在前，
 * 然后是 ST 的 characters 目录（用户**原卡**真正在的地方），最后 Downloads/Desktop。
 * @returns {string[]}
 */
function cardDirs() {
  if (CARD_DIRS) return CARD_DIRS
  const roots = []
  for (const d of (process.env.DSH_MUV_CARD_DIRS || '').split(path.delimiter)) {
    const t = String(d || '').trim()
    if (t) roots.push(t)
  }
  const st = process.env.DSH_SILLYTAVERN_DIR
  if (st) roots.push(st)
  roots.push('C:/MySpecialFolder/SillyTavern')
  roots.push(path.join(os.homedir(), 'SillyTavern'))
  roots.push(path.join(os.homedir(), 'Documents', 'SillyTavern'))
  const out = []
  for (const root of roots) {
    try {
      const dataDir = path.join(root, 'data')
      if (!fs.existsSync(dataDir)) continue
      for (const user of fs.readdirSync(dataDir)) {
        const chars = path.join(dataDir, user, 'characters')
        if (fs.existsSync(chars)) out.push(chars)
      }
    } catch (_) {}
  }
  out.push(path.join(os.homedir(), 'Downloads'))
  out.push(path.join(os.homedir(), 'Desktop'))
  CARD_DIRS = out.filter((d, i, all) => all.indexOf(d) === i)
  return CARD_DIRS
}

/** 读一张卡 JSON（`.json` 卡）或 PNG 卡（tEXt 'chara'）。 */
function readCardFile(file) {
  try {
    if (/\.json$/i.test(file)) {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      return (json && typeof json === 'object') ? json : null
    }
    if (/\.png$/i.test(file)) return readPngCard(file)
  } catch (_) {}
  return null
}

/**
 * 在一个目录里找名字对得上的卡。
 *
 * 两轮：① 文件名（去扩展名）与卡名对得上 —— 真卡文件名就是卡名，这一步几乎必中；
 *      ② 文件名全不匹配时，按 mtime 倒序最多试 `MAX_CONTENT_PROBE` 个文件内容。
 *         第二轮是有界的：不加限制意味着每次渲染都可能把下载目录里几十个 MB 的 PNG
 *         逐个读完（每个都要 base64 解码），那才是真正的性能坑。
 * @param {string} dir
 * @param {string} cardName
 * @returns {{json: object, fileName: string}|null}
 */
function findCardInDir(dir, cardName) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (_) {
    return null
  }
  const files = entries
    .filter((e) => e.isFile() && /\.(png|json)$/i.test(e.name))
    .map((e) => ({ name: e.name, file: path.join(dir, e.name) }))
  const base = (n) => n.replace(/\.(png|json)$/i, '')
  // ① 文件名预判
  const byName = files.filter((f) => nameAgrees(base(f.name), cardName))
  for (const f of byName) {
    const json = readCardFile(f.file)
    if (json && nameAgrees(String((json.data && json.data.name) || json.name || ''), cardName)) {
      return { json, fileName: f.name }
    }
  }
  // ② 限量兜底（mtime 倒序）
  let rest = files.filter((f) => byName.indexOf(f) === -1)
  try {
    rest = rest
      .map((f) => ({ ...f, t: fs.statSync(f.file).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, MAX_CONTENT_PROBE)
  } catch (_) {}
  for (const f of rest) {
    const json = readCardFile(f.file)
    if (json && nameAgrees(String((json.data && json.data.name) || json.name || ''), cardName)) {
      return { json, fileName: f.name }
    }
  }
  return null
}

/**
 * 取卡里所有 **enabled** 的脚本。
 *
 * 只认路径 `data.extensions.tavern_helper.scripts`（顶层扁平的老卡形态退到 `extensions`）。
 * `enabled` 的判定：**显式 false 才算关**（真卡里每份都带这个字段；缺省按 ST 面板
 * 的默认「启用」处理，比起一刀切丢掉整张卡的脚本更保守）。
 * @param {object} json 卡 JSON
 * @returns {object[]} `[{name, id, content}]`
 */
export function enabledScriptsOf(json) {
  const out = []
  if (!json || typeof json !== 'object') return out
  const data = (json.data && typeof json.data === 'object') ? json.data : json
  const ext = (data.extensions && typeof data.extensions === 'object') ? data.extensions : {}
  const th = ext.tavern_helper || ext.TavernHelper || null
  const list = (th && Array.isArray(th.scripts)) ? th.scripts : []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    if (s.enabled === false) continue
    if (out.length >= MAX_SCRIPTS) break
    const content = typeof s.content === 'string' ? s.content : ''
    if (!content) continue
    if (content.length > MAX_CONTENT) continue
    out.push({ name: String(s.name || ''), id: String(s.id || ''), content: content })
  }
  return out
}

/**
 * 取一张卡的 enabled 脚本（带缓存）。
 * @param {{presetDir?: string, cardName?: string}} query
 * @returns {{ok: true, scripts: object[], total: number, enabled: number, source: string, fileName: string, reason?: string}}
 */
export function listCardScripts(query) {
  const q = query || {}
  const presetDirName = safeName(q.presetDir)
  const cardName = String(q.cardName == null ? '' : q.cardName).trim().slice(0, 160)
  const empty = { ok: true, scripts: [], total: 0, enabled: 0, source: '', fileName: '', reason: '' }
  if (!cardName) return { ...empty, reason: 'missing-card-name' }

  const key = presetDirName + '|' + cardName
  if (cache.has(key)) {
    const hit = cache.get(key)
    // LRU：命中就挪到最新（Map 保持插入序）
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }

  let result = { ...empty }
  try {
    let hit = null
    if (presetDirName) {
      const dir = path.join(presetsRoot(), presetDirName)
      // ① 托管副本（完整卡 JSON，含 extensions ⇒ 有脚本）
      const managed = path.join(dir, 'muv-tables', 'card.json')
      try {
        if (fs.existsSync(managed)) {
          const json = readCardFile(managed)
          if (json && nameAgrees(String((json.data && json.data.name) || json.name || ''), cardName)) {
            hit = { json, fileName: presetDirName + '/muv-tables/card.json', source: 'preset-card.json' }
          }
        }
      } catch (_) {}
      // ② 预设目录里躺着一张 PNG 原卡
      if (!hit) {
        const png = findCardInDir(dir, cardName)
        if (png) hit = { json: png.json, fileName: presetDirName + '/' + png.fileName, source: 'preset-png' }
      }
    }
    // ③ 外部卡库（ST 的 characters 目录等）
    if (!hit) {
      for (const dir of cardDirs()) {
        const found = findCardInDir(dir, cardName)
        if (found) { hit = { json: found.json, fileName: found.fileName, source: 'library' }; break }
      }
    }
    if (!hit) result = { ...empty, reason: 'card-not-found' }
    else {
      const data = (hit.json.data && typeof hit.json.data === 'object') ? hit.json.data : hit.json
      const ext = (data.extensions && typeof data.extensions === 'object') ? data.extensions : {}
      const all = (ext.tavern_helper && Array.isArray(ext.tavern_helper.scripts)) ? ext.tavern_helper.scripts : []
      const scripts = enabledScriptsOf(hit.json)
      result = {
        ok: true,
        scripts: scripts,
        total: all.length,
        enabled: scripts.length,
        source: hit.source,
        fileName: hit.fileName,
        reason: ''
      }
    }
  } catch (e) {
    result = { ...empty, reason: 'read-error' }
  }

  cache.set(key, result)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  return result
}

/** 供测试隔离：清掉缓存与路径绑定。 */
export function resetCardScriptCache() {
  cache.clear()
  CARD_DIRS = null
}

export { MAX_SCRIPTS, MAX_CONTENT }
