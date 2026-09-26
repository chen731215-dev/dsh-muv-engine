// dsh-muv-engine: 全局正则脚本库（Global Regex Extension）
//
// ST 生态里除了卡级 `data.extensions.regex_scripts`，还有一层**全局正则扩展**：
// 用户自己装的、独立于卡的美化/净化脚本（"去星号注释"、全局排版美化等）。
// 本模块承接这一层：导入（宽容解析 ST 导出形态）→ 落盘持久 → 供
// `/api/muv-engine/apply-regex-card` 在卡级脚本**之前**合并进生效脚本集（见 lib/index.js）。
//
// ── 落盘路径与格式 ─────────────────────────────────────────────────────────
// 引擎此前的状态容器（var-tracker 的 stateStore/baseStore/opLedger）全部是内存态，
// 没有持久化先例；本模块是第一个，路径定为**引擎自己的数据目录**：
//
//   默认：<引擎包根>/data/global-regex.json   （开发机即 C:\dsh-muv-engine\data\global-regex.json）
//   覆盖：环境变量 MUV_ENGINE_DATA_DIR 指到别的目录（测试与多实例用）
//
// 文件格式（version 字段为格式版本，未来迁移用）：
//   { "version": 1, "savedAt": "<ISO>", "scripts": [ { id, scriptName, findRegex,
//     replaceString, disabled, markdownOnly, promptOnly, placement, runOnEdit,
//     substituteRegex, minDepth, maxDepth, importedAt }, … ] }
//
// `id` 是确定性的：`gr_` + sha1(scriptName + '\x1f' + findRegex) 前 12 位 ——
// 同名同式重新导入得到同一个 id，删除后重装也稳定，便于外部引用与去重。
//
// ── 容量纪律（超限拒绝并返回可见错误，不静默截断） ─────────────────────────
//   · 库总量最多 MAX_SCRIPTS=200 条 —— 导入将导致超限时**整批拒绝**（HTTP 400
//     capacity-exceeded），调用方必须自己分批；
//   · 单条 findRegex / replaceString 各 256*1024 字符上限 —— 超限的**该条**跳过并
//     计入 skipped（原因见返回的 reasons），其余条目照常入库 —— 与 var-tracker 的
//     bad 计数同一纪律：一条坏的不拖垮整批，但必须有数可查。
//
// ── 解析宽容度（ST 全局正则导出的真实形态不止一种） ─────────────────────────
//   ① 裸数组  [ {scriptName, findRegex, …}, … ]
//   ② { scripts: […] }                       ← 最常见
//   ③ { data: { extensions: { regex_scripts: […] } } }   ← 与卡级同构
//   ④ ②③ 外面再包一层 { compatibility: … }  ← 部分导出工具的包装
//   四种都认（④ 靠递归），认不出时返回 0 条，由调用方给 `no-scripts-found`。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_SCRIPTS = 200
const MAX_FIELD = 256 * 1024
const FORMAT_VERSION = 1

/** 引擎包根（lib/ 的上一级）。 */
const ENGINE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * 数据目录（**每次调用时解析**而不是 import 时 —— 测试要先设 MUV_ENGINE_DATA_DIR
 * 再触发读写，import 时固化会钉死到错误目录）。
 */
function dataFile() {
  const dir = process.env.MUV_ENGINE_DATA_DIR || path.join(ENGINE_ROOT, 'data')
  return path.join(dir, 'global-regex.json')
}

/** 确定性脚本 id：同名同式永远同一个 id。 */
function scriptId(scriptName, findRegex) {
  const h = createHash('sha1').update(String(scriptName) + '\x1f' + String(findRegex)).digest('hex')
  return 'gr_' + h.slice(0, 12)
}

/** 编译校验：与 regex-engine 的 applyRegexScript 同一口径 —— `/…/flags` 字面量壳或裸模式。 */
export function canCompileFindRegex(findRegex) {
  if (typeof findRegex !== 'string' || findRegex.trim() === '') return false
  try {
    if (findRegex.startsWith('/')) {
      const lastSlash = findRegex.lastIndexOf('/')
      if (lastSlash > 0) {
        new RegExp(findRegex.slice(1, lastSlash), findRegex.slice(lastSlash + 1))
        return true
      }
    }
    new RegExp(findRegex)
    return true
  } catch (_) {
    return false
  }
}

/**
 * 宽容提取脚本数组（见文件头 ①—④）。认不出 → []。
 * @param {unknown} payload
 * @returns {object[]}
 */
export function extractGlobalScripts(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  // ④ compatibility 包裹：递归进里层再走一遍 ①②③。
  if (payload.compatibility && typeof payload.compatibility === 'object') {
    const inner = extractGlobalScripts(payload.compatibility)
    if (inner.length) return inner
  }
  if (Array.isArray(payload.scripts)) return payload.scripts
  const nested = payload?.data?.extensions?.regex_scripts
  if (Array.isArray(nested)) return nested
  // 引擎自己的形状（regexScriptsOf 的 direct 分支）顺手也认 —— 导入端宽容没坏处。
  if (Array.isArray(payload.regexScripts)) return payload.regexScripts
  return []
}

/** 读整库。文件不存在/损坏 → 空库（导入会重建；损坏不抛，返回空 + stderr 提示）。 */
export function loadGlobalScripts() {
  const file = dataFile()
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.scripts)) return parsed.scripts
    return []
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // 损坏的库文件：宁可空库也不让整条渲染链挂掉 —— 但必须喊出声，别静默。
      console.error('[muv-engine] global-regex.json 读取失败（按空库处理）:', e.message)
    }
    return []
  }
}

/** 写整库（临时文件 + rename，避免写一半崩溃留下半个 JSON）。 */
function saveScripts(scripts) {
  const file = dataFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ version: FORMAT_VERSION, savedAt: new Date().toISOString(), scripts }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 导入一批全局脚本（合并发生在内存里，一次落盘）。
 *
 * 去重口径：`scriptName + findRegex` **逐字相等**视为同一条。
 *   默认（upsert）：同名同式 → 覆盖为新版（原位置、原 id 保留），计入 replaced；
 *   mode:'append' ：同名同式 → 跳过不动，计入 skipped。
 * 非法条目（缺 findRegex / 编译失败 / 字段超 256KB）→ 跳过并计数（invalid / skipped），
 * 原因明细在返回的 `reasons` 里 —— 不抛、不整批失败（var-tracker bad 计数同纪律）。
 * 只有"入库总量将超 200"是**整批拒绝**（抛 CapacityError，API 层转 400）。
 *
 * @param {object[]} rawScripts 已由 extractGlobalScripts 展开的条目
 * @param {{mode?: 'upsert'|'append'}} [opts]
 * @returns {{added:number, replaced:number, skipped:number, invalid:number, total:number, reasons:string[]}}
 */
export function importGlobalScripts(rawScripts, opts = {}) {
  const mode = opts.mode === 'append' ? 'append' : 'upsert'
  const existing = loadGlobalScripts()
  const byKey = new Map(existing.map((s, i) => [s.scriptName + '\x1f' + s.findRegex, i]))
  const stats = { added: 0, replaced: 0, skipped: 0, invalid: 0, total: existing.length, reasons: [] }
  const next = existing.slice()

  for (const item of rawScripts) {
    const label = item && typeof item === 'object'
      ? (item.scriptName || item.name || '(未命名)')
      : String(item)
    if (!item || typeof item !== 'object' || typeof item.findRegex !== 'string' || item.findRegex.trim() === '') {
      stats.invalid++
      stats.reasons.push(label + ': 缺 findRegex')
      continue
    }
    if (item.findRegex.length > MAX_FIELD || (typeof item.replaceString === 'string' && item.replaceString.length > MAX_FIELD)) {
      stats.skipped++
      stats.reasons.push(label + ': findRegex/replaceString 超 256KB 上限')
      continue
    }
    if (!canCompileFindRegex(item.findRegex)) {
      stats.invalid++
      stats.reasons.push(label + ': findRegex 无法编译')
      continue
    }
    const scriptName = String(item.scriptName ?? item.name ?? '')
    const key = scriptName + '\x1f' + item.findRegex
    if (byKey.has(key)) {
      if (mode === 'append') { stats.skipped++; stats.reasons.push(label + ': 已存在（append 模式跳过）'); continue }
      // 覆盖为新版：原位置原 id 保留（确定性 id 本来就不会变）。
      const idx = byKey.get(key)
      next[idx] = normalize(item, scriptName, next[idx].importedAt)
      stats.replaced++
      continue
    }
    if (next.length >= MAX_SCRIPTS) {
      // 容量纪律：整批拒绝，不做部分导入 —— 半批入库会让"再导一次补齐"变成盲目猜。
      const err = new Error(`capacity-exceeded: 全局脚本库上限 ${MAX_SCRIPTS} 条（现有 ${next.length}），本批 ${rawScripts.length} 条放不下`)
      err.code = 'CAPACITY'
      throw err
    }
    const entry = normalize(item, scriptName, undefined)
    byKey.set(key, next.length)
    next.push(entry)
    stats.added++
  }

  stats.total = next.length
  if (stats.added || stats.replaced) saveScripts(next)
  return stats
}

/** 落库形状：只保留管道会用的字段 + 审计字段，去掉导出工具可能带的杂项。 */
function normalize(item, scriptName, importedAt) {
  return {
    id: scriptId(scriptName, item.findRegex),
    scriptName,
    findRegex: item.findRegex,
    replaceString: typeof item.replaceString === 'string' ? item.replaceString : '',
    disabled: item.disabled === true,
    markdownOnly: item.markdownOnly === true,
    promptOnly: item.promptOnly === true,
    // ST 全局导出的 placement 是数字数组（1=用户输入 2=AI 输出…）；本引擎的
    // placement 语义是 markdownOnly/promptOnly（见 regex-engine.js placementAllows），
    // 这里原样保留只做回显/导出，不参与过滤。
    placement: Array.isArray(item.placement) ? item.placement : undefined,
    runOnEdit: item.runOnEdit === true,
    substituteRegex: item.substituteRegex ?? undefined,
    minDepth: item.minDepth ?? undefined,
    maxDepth: item.maxDepth ?? undefined,
    importedAt: importedAt || new Date().toISOString(),
  }
}

/**
 * 删除一条。口径：`DELETE /api/muv-engine/global-regex?id=…` 或
 * `POST {action:'delete', id}`（两者等价，见 lib/index.js）。
 * @returns {boolean} 是否真的删了（false = id 不存在，调用方给 404）
 */
export function deleteGlobalScript(id) {
  const existing = loadGlobalScripts()
  const next = existing.filter(s => s.id !== id)
  if (next.length === existing.length) return false
  saveScripts(next)
  return true
}

/**
 * 启停一条（面板的 ⏸/▶ 开关走这里）。
 * 口径：`POST {action:'set-disabled', id, disabled:boolean}`（lib/index.js 分发）。
 * @returns {object|null} 改后的条目；id 不存在返回 null（调用方给 404）
 */
export function setGlobalScriptDisabled(id, disabled) {
  const existing = loadGlobalScripts()
  const hit = existing.find(s => s.id === id)
  if (!hit) return null
  hit.disabled = disabled === true
  saveScripts(existing)
  return hit
}
