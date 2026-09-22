// dsh-muv-engine: Variable State Tracker
// Extracts, validates, and stores MUV variable state per session.
//
// 数据源有**四种**，别只认一种：
//   ① `<UpdateVariable><initvar>…</initvar></UpdateVariable>` —— MUV 原生的 YAML 初始化块；
//   ② `<VariableInsert|VariableEdit|VariableDelete>{ …JSON… }</VariableInsert|…>`
//      —— 社区卡（TavernHelper「ERA 变量框架」）**模型每楼实际发出的**增量 JSON。
//   ③ 命令式写入 `_.set('路径', 值)` / `_.add('路径', 增量)`
//      —— MVU 生态里把变量改动写成**可读语句**的那种块（也是模型最容易写对的形态）。
//   ④ `stat_data` 容器语义 —— MVU 把变量树放在 `chat[i].variables.stat_data`，
//      卡里按 `stat_data.xxx` 寻址（见 `normalizeStatData`）。
//
// ★ 为什么 ② 必须实现（2026-09-22 实测定位）：`_足控天堂2` 的整条 UI 都靠它——
//   卡里写的是 `<span class="choice-text" data-era="剧情选项.选项1">`，而 `剧情选项` 在卡的
//   声明式初始变量里是**空串**；真值只在 ② 的 JSON 里（实测那条 AI 消息的
//   `<VariableEdit>` 里就有 `"剧情选项":{"选项1":"继续品尝她的脚。",…}`）。
//   不解析 ② ⇒ 选项空白、好感度停在初值 ⇒ 连 CG 画廊的 NSFW 视频都锁着
//   （卡源码：`/* NSFW 视频需好感度 100 才可解锁 */`）。三件事同一个根因。
// ★ 为什么 ③④ 要一起做（2026-09-22 新卡实测）：新导入的 MVU 卡依赖计数是
//   `stat_data × 105`、`Mvu. × 53`、`_.set( × 39`、`getVariables( × 17`。
//   注意实测到的 `_.set(` 有**两种**：卡自己带的 lodash 写法 `_.set(对象, 路径数组, 值)`
//   （不是变量命令，首参不是字符串字面量 ⇒ 本解析器会把它计成 `bad` 并跳过，**不会**误写），
//   以及我们要认的**字符串路径**命令形态 `_.set('a.b.c', 值)`。
import { parseInitvar, serializeInitvar } from 'dsh-muv-table/lib/initvar-parser.js'


const stateStore = new Map() // sessionId → { data, updatedAt }

/**
 * ★ 按楼快照（"时间旅行"的数据底座，2026-09-22 新增）。
 *
 * 结构：sessionId → Map<msgKey, { key, at, data|null }>。Map 的插入序 = 到达序，
 * 同键重复送达会**保留原位置**只刷新值（Map.set 对已存在键不改变顺序）。
 *
 * ⚠ 持久化策略：这是**会话级 LRU，重启即失** —— 与现有状态容器（`stateStore`/`baseStore`/
 * `opLedger`，全部内存态）同一命运，**没有为此引入任何新的存储依赖**。
 * 会话被 LRU 淘汰（见 `touchSession`）时快照一并丢弃。
 */
const snapshotStore = new Map() // sessionId → Map<msgKey, {key, at, data|null}>

/**
 * ① 的贡献（`<initvar>` / `setState`）与 ② 的编辑账本分开存，最终状态 = ① ⊕ ②。
 *
 * 为什么不让 ② 直接 merge 进 `stateStore`：② 需要**按消息时序**重放（见下），
 * 若它把结果直接写进最终状态，就无法在"旧消息晚到"时重算。
 */
const baseStore = new Map() // sessionId → object（① 的贡献）
const opLedger = new Map() // sessionId → { keyed: Map<msgKey,{epoch,ops}>, unkeyed: [{sig,ops}] }

const MAX_SESSIONS = 64
const MAX_KEYED = 500
const MAX_OPS_BYTES = 200 * 1024
/** 每会话快照上限：超限淘汰**楼层最旧**的（见 `recordSnapshot` 的淘汰判据）。 */
const MAX_SNAPSHOTS = 200
/**
 * 单条快照的体积口径：与单消息 ops 的 `MAX_OPS_BYTES`（200KB）**同一个口径**。
 * 超大的快照不存树，只存一条占位（`data: null`）——别让一条巨型消息把内存吃爆。
 */
const MAX_SNAPSHOT_BYTES = 200 * 1024

/** 会话级账本的 LRU 上限：状态是内存态，不设上限会随会话数无界增长。 */
function touchSession(sessionId) {
  // ★ 顺序要紧：先取出旧账本**再** delete（LRU 重排）。写成"先 delete 后 get"就等于
  //   每次调用都新建一个空账本 —— 账本没了，重放自然只剩最后一条消息的效果。
  //   （这个 bug 是被 `_qa-era-ops` 的"倒序送达结果必须一致"那条断言当场抓出来的。）
  const existing = opLedger.get(sessionId)
  if (existing) opLedger.delete(sessionId)
  opLedger.set(sessionId, existing || { keyed: new Map(), unkeyed: [] })
  while (opLedger.size > MAX_SESSIONS) {
    const oldest = opLedger.keys().next().value
    opLedger.delete(oldest)
    baseStore.delete(oldest)
    stateStore.delete(oldest)
    // 快照与状态同一命运：会话被 LRU 淘汰时一并丢弃（会话级，不持久）
    snapshotStore.delete(oldest)
  }
  if (!baseStore.has(sessionId)) baseStore.set(sessionId, {})
  return opLedger.get(sessionId)
}

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

// ───────────────────────── ② ERA 增量块（VariableInsert / Edit / Delete） ─────────────────────────

const VAR_BLOCK_RE = /<(VariableInsert|VariableEdit|VariableDelete)>([\s\S]*?)<\/\1>/gi
const THINK_BLOCK_RE = /<VariableThink\b[\s\S]*?<\/VariableThink>/gi
const KEY_INNER_RE = /era-message-key["'\s=]{1,4}(era_mk_[A-Za-z0-9_]+)/

/**
 * 从一条消息的原文里取出**消息键**（ERA 框架给每楼的索引）。
 *
 * 形状是实测出来的（`_足控天堂2` 的真聊天文件）：
 *   `<era_data>{"era-message-key"="era_mk_1789928712211_a6czp6","era-message-type"="assistant"}</era_data>`
 * 注意里面用的是 `=` 而**不是** `:`，所以不能当 JSON 解 —— 用正则抓。
 * 键里的第一段是毫秒时间戳 ⇒ **天然可排序**，这就是"按楼重放"的依据。
 * @param {string} text
 * @returns {{key:string, epoch:number}|null}
 */
export function parseEraMessageKey(text) {
  const block = /<era_data[^>]*>([\s\S]*?)<\/era_data>/i.exec(String(text || ''))
  const m = block ? KEY_INNER_RE.exec(block[1]) : null
  if (!m) return null
  const key = m[1]
  const epoch = Number((/^era_mk_(\d+)_/.exec(key) || [])[1] || 0)
  return { key, epoch }
}

// ───────────────────────── ③ 命令式写入（`_.set` / `_.add`）+ ④ `stat_data` 归一 ─────────────────────────

/**
 * ③ 命令式写入的入口正则。
 *
 * 为什么要求「`_` 前面不是标识符字符」：实测新卡里同时存在两种 `_.set(` ——
 * 卡自带 lodash 的 `_.set(ctx.data, v.parts, 值)`（对象/数组首参）与我们要认的
 * 字符串路径命令。前者首参不是字符串字面量 ⇒ 由 `readCall` 判失败、计入 `bad`。
 * 而 `foo_.set(` 这种（前缀是标识符字符）**一律不认** —— 那是别的对象的成员，不是这个约定。
 */
const CMD_CALL_RE = /(?:^|[^A-Za-z0-9_$])_\.(set|add)\s*\(/g

/** 跳过空白（含换行）。 */
function skipWs(src, i) {
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') { i++; continue }
    break
  }
  return i
}

/**
 * 读一个字符串字面量（`'` / `"` / 反引号）。
 *
 * 反引号里出现 `${` 直接判失败 —— **不做模板求值**：求值等于在服务端执行卡/模型的文本，
 * 那是这个项目绝不做的事（宁可少写一个变量，也不引入执行面）。
 * 未知转义按「原样保留下一个字符」处理（保守：不猜转义表）。
 */
function readStringLiteral(src, start, quote) {
  let i = start + 1
  let out = ''
  while (i < src.length) {
    const c = src[i]
    if (quote === '`' && c === '$' && src[i + 1] === '{') return null
    if (c === '\\') {
      const n = src[i + 1]
      if (n === undefined) return null
      if (n === 'n') out += '\n'
      else if (n === 't') out += '\t'
      else if (n === 'r') out += '\r'
      else if (n === '0') out += '\0'
      else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue }
      else if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)); i += 4; continue }
      else out += n
      i += 2
      continue
    }
    if (c === quote) return { value: out, next: i + 1 }
    out += c
    i++
  }
  return null
}

/** 从 `{` / `[` 配平到对应收尾（字符串与注释感知）。返回收尾之后的下标，失败 -1。 */
function skipBalanced(src, start) {
  let depth = 0
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const s = readStringLiteral(src, i, c)
      if (!s) return -1
      i = s.next
      continue
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return -1
}

/** 从 `,`（或任意位置）扫到**本层**配对的 `)`，返回其后的下标；失败 -1。 */
function skipToCloseParen(src, from) {
  let depth = 0
  let i = from
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const s = readStringLiteral(src, i, c)
      if (!s) return -1
      i = s.next
      continue
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === '(') depth++
    else if (c === ')') { if (depth === 0) return i + 1; depth-- }
    i++
  }
  return -1
}

/**
 * 读一个**字面量**参数：字符串 / 数字 / 布尔 / null / JSON 对象或数组。
 *
 * 明确**不支持**（一律判失败、计入 `bad`）：
 *   - 变量引用（`_.set('a', someVar)`）—— 服务端求值不了，猜就是编数据；
 *   - 模板插值（反引号 + `${}`）；
 *   - 非 JSON 的对象字面量（`{b:1}` 单引号/裸键）—— 需要 `JSON.parse`，键必须双引号。
 * @returns {{value:*, next:number}|null}
 */
function readLiteral(src, i) {
  const c = src[i]
  if (c === undefined) return null
  if (c === "'" || c === '"' || c === '`') return readStringLiteral(src, i, c)
  if (c === '{' || c === '[') {
    const end = skipBalanced(src, i)
    if (end < 0) return null
    try { return { value: JSON.parse(src.slice(i, end)), next: end } } catch (_) { return null }
  }
  if (c === '-' || (c >= '0' && c <= '9')) {
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
    if (!m) return null
    const v = Number(m[0])
    if (!isFinite(v)) return null
    return { value: v, next: i + m[0].length }
  }
  const kw = /^(true|false|null)\b/.exec(src.slice(i))
  if (kw) return { value: kw[1] === 'null' ? null : kw[1] === 'true', next: i + kw[1].length }
  return null
}

/**
 * 读一次调用：`( 字面量 , 字面量 [, 其余参数…] )`。
 *
 * 为什么允许多余参数：实测/常见形态里有 `_.set('a.b', v, {scope:'chat'})` 这种第三参。
 * 第三参及之后**不解析其内容**（只配平括号跳过）—— 解析它会因为单引号键而整条判失败，
 * 而第三个参数对本约定没有语义。
 * @returns {{args:Array<*>, end:number}|null}
 */
function readCall(src, open) {
  if (src.charAt(open) !== '(') return null
  let i = skipWs(src, open + 1)
  const a1 = readLiteral(src, i)
  if (!a1) return null
  i = skipWs(src, a1.next)
  if (src.charAt(i) !== ',') return null
  i = skipWs(src, i + 1)
  const a2 = readLiteral(src, i)
  if (!a2) return null
  i = skipWs(src, a2.next)
  if (src.charAt(i) === ')') return { args: [a1.value, a2.value], end: i + 1 }
  if (src.charAt(i) === ',') {
    const end = skipToCloseParen(src, i)
    if (end < 0) return null
    return { args: [a1.value, a2.value], end }
  }
  return null
}

/**
 * 解析文本里的 ③ 命令式写入。
 *
 * 语义（与 ② 的块**同族**：都是"对变量树的一次改动"）：
 *   - `_.set('a.b.c', 值)` —— 按**点分路径**写值（中间层不存在就建出来）；
 *   - `_.add('a.b', 数字)` —— 数值累加；当前值不是有限数字时**从 0 起算**。
 *
 * 顺序：返回的 ops **按在文本里出现的先后**排列（`at` 只在合并排序时用，不随 ops 出去）。
 * 失败（首参不是字符串、值不是字面量、`add` 的增量不是数字、括号不配平等）**跳过并计数**，
 * 绝不抛 —— 一个坏调用不该让整条消息的变量全丢（与 ② 的 `bad` 同一口径）。
 *
 * @param {string} text
 * @returns {{ops:Array<{kind:string,path:string,value?:*,delta?:number,at:number}>, bad:number, bytes:number}}
 */
export function parseCommandOps(text) {
  const ops = []
  let bad = 0
  let bytes = 0
  const src = String(text || '')
  if (!src || src.length > 600000) return { ops, bad, bytes }
  CMD_CALL_RE.lastIndex = 0
  let m
  while ((m = CMD_CALL_RE.exec(src)) !== null) {
    const name = m[1].toLowerCase()
    // ★ 匹配串**以 `(` 收尾**（前缀那个字符也算在 `m[0]` 里）⇒ 开括号在 `m[0]` 的最后一个字符上。
    //   写成 `m.index + m[0].length` 会指向 `(` **之后**，于是每次调用都从值的中间开始读、
    //   整批判失败（实测：6 条命令全进 bad、ops=0 —— 表现是"一个命令都没认出来"）。
    const open = m.index + m[0].length - 1
    const call = readCall(src, open)
    if (!call) { bad++; continue }
    bytes += call.end - m.index
    const path = call.args[0]
    if (typeof path !== 'string' || !path || /[\[\]]/.test(path)) { bad++; continue }
    if (name === 'set') {
      ops.push({ kind: 'set', path, value: call.args[1], at: m.index })
    } else {
      const n = call.args[1]
      if (typeof n !== 'number' || !isFinite(n)) { bad++; continue }
      ops.push({ kind: 'add', path, delta: n, at: m.index })
    }
  }
  return { ops, bad, bytes }
}

/**
 * ④ `stat_data` 归一层：把**MVU 形态**的载荷按"我们的变量树"口径认出来。
 *
 * 映射关系（写在注释与文档里，别靠猜）：
 *   - `{ stat_data: {…} }`                ⇒ **原样**（顶层键 = `stat_data`；卡里 `stat_data.xxx` 直接对上）
 *   - `{ chat: { "0": { variables: { stat_data: {…} } } } }`
 *     （ST 的**存储形态**，即 `chat[i].variables.stat_data`）
 *     ⇒ `{ stat_data: {…} }`（只取第一份能认出来的 stat_data）
 *   - 其它形态（`{世界信息:…}` 这类平铺树） ⇒ **原样返回**
 *
 * ★ 为什么第三种**不**包一层：平铺树在 ERA / MUV 卡里是根（`data-era="世界信息.时间"`），
 *   无差别包成 `{stat_data:…}` 会让那些卡的路径**全部对不上** —— 这是"看起来只像个别字段空"
 *   的那类静默失效。只有能**确认**是 MVU 形态的才归一，其余一律不动。
 * @param {*} data
 * @returns {*} 归一后的对象（非对象一律原样返回）
 */
export function normalizeStatData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const sd = data.stat_data
  if (sd && typeof sd === 'object' && !Array.isArray(sd)) return data
  const chat = data.chat
  if (chat && typeof chat === 'object' && !Array.isArray(chat)) {
    const keys = Object.keys(chat)
    for (const k of keys) {
      const v = chat[k]
      if (!v || typeof v !== 'object') continue
      const vars = v.variables
      if (!vars || typeof vars !== 'object') continue
      if (vars.stat_data && typeof vars.stat_data === 'object' && !Array.isArray(vars.stat_data)) {
        return { stat_data: vars.stat_data }
      }
    }
  }
  return data
}

/** 按点分路径取值。 */
function getPathValue(root, path) {
  const parts = String(path).split('.')
  let cur = root
  for (let i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[parts[i]]
  }
  return cur
}

/**
 * 按点分路径写值（**不改原对象**：路径上每一层都拷一份）。
 * 中间层缺失、或中间层是标量/数组时，都换成新对象继续往下建。
 */
function setPathValue(root, path, value) {
  const parts = String(path || '').split('.')
  if (!parts.length || !parts[0]) return root
  const out = (root && typeof root === 'object' && !Array.isArray(root)) ? { ...root } : {}
  let cur = out
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    const v = cur[k]
    const next = (v && typeof v === 'object') ? (Array.isArray(v) ? v.slice() : { ...v }) : {}
    cur[k] = next
    cur = next
  }
  cur[parts[parts.length - 1]] = value
  return out
}

/**
 * 解析一条消息里的 ② 类块。
 *
 * 语义（按 TavernHelper「ERA 变量框架」的实际用法）：
 *   - `<VariableInsert>` / `<VariableEdit>` 的载荷是**一棵部分变量树**，按**深合并**落到状态上
 *     （实测：`{"世界信息":{"时间":{…}},"剧情选项":{"选项1":"…"}}`，只带变化的分支）；
 *   - `<VariableDelete>` 的载荷是要删的键（对象树或路径数组）。
 *
 * ★ 两个真实世界的坑（都是实测踩出来的，不是想出来的）：
 *   ① 模型会在 `<VariableThink>` 里**引用标签名**（"生成一个 `<VariableEdit>` 块来更新…"）。
 *      如果直接扫 `<VariableEdit>…</VariableEdit>`，第一次匹配会从这句"提及"开始，
 *      一路吃到**真正那块**的收尾标签 ⇒ 中间夹着说明文字 ⇒ JSON 必然解析失败。
 *      实测：10 条真实消息里 3 条全踩（`Unexpected token '`'`）。所以先整块剔掉 VariableThink。
 *   ② 剔完仍可能残留"提及"（模型在正文里也写过标签名）。判据用**内容是不是 JSON**
 *      （以 `{` / `[` 开头）：不是就说明这一对被错配了，把扫描位置退回开标签之后重来，
 *      而不是把这一对算成"坏块"后跳过 —— 跳过会把后面那块真的也一起漏掉。
 * 解析失败的块**跳过并计数**，不抛 —— 一个坏块不该让整条消息的变量全丢。
 *
 * ★ ③ 命令式写入（`_.set` / `_.add`）与 ② 的块**合并成同一条消息的 ops**，并**按在文本里
 *   出现的先后排序**（`at` 只在排序时用）。理由：两者都是"对变量树的一次改动"，同一个
 *   消息里先块后命令（或反过来）**结果不同**，分两趟收就会把顺序弄反。
 *   顺序语义与 ② 完全一致：拿得到 `era_data` 消息键就走**键序重放**，拿不到就按**到达顺序**
 *   追加（`applyVariableMessage` 里的 unkeyed 账本）。这是**降级**，不是等价 —— 见那里的注释。
 * ★ ④ 归一：每个块的载荷过一遍 `normalizeStatData`（`chat[i].variables.stat_data` 形态 ⇒
 *   `{stat_data:…}`），使卡里 `stat_data.xxx` 的路径能对上。
 *
 * @param {string} text
 * @returns {{ops: Array<{kind:string,data?:any,path?:string,value?:*,delta?:number}>, bad:number,
 *            skipped:number, key:string|null, epoch:number, bytes:number, commands:number, badCommands:number}}
 */
export function parseVariableOps(text) {
  const ops = []
  let bad = 0
  let skipped = 0
  let bytes = 0
  let commands = 0
  let badCommands = 0
  let src = String(text || '')
  if (!src || src.length > 600000) return { ops, bad, skipped, key: null, epoch: 0, bytes, commands, badCommands }
  // ① 先剔思考块（见上）
  src = src.replace(THINK_BLOCK_RE, '')
  /** 先按出现位置收集，最后统一排序（见函数头 ★ 那段）。 */
  const collected = []
  VAR_BLOCK_RE.lastIndex = 0
  let m
  while ((m = VAR_BLOCK_RE.exec(src)) !== null) {
    const kind = m[1].toLowerCase()
    const inner = String(m[2] || '').trim()
    const head = inner.charAt(0)
    if (head !== '{' && head !== '[') {
      // ② "提及"错配：退回开标签之后重扫（见上）
      skipped++
      VAR_BLOCK_RE.lastIndex = m.index + m[0].indexOf('>') + 1
      continue
    }
    bytes += inner.length
    if (bytes > MAX_OPS_BYTES) break
    let data
    try {
      data = JSON.parse(inner)
    } catch (_) {
      bad++
      VAR_BLOCK_RE.lastIndex = m.index + m[0].indexOf('>') + 1
      continue
    }
    if (!data || typeof data !== 'object') {
      bad++
      VAR_BLOCK_RE.lastIndex = m.index + m[0].indexOf('>') + 1
      continue
    }
    collected.push({ at: m.index, op: { kind, data: normalizeStatData(data) } })
  }
  // ③ 命令式写入：与②同一条消息、同一套顺序/重放（见函数头 ★）
  const cmd = parseCommandOps(src)
  badCommands = cmd.bad
  bad += cmd.bad
  bytes += cmd.bytes
  for (const c of cmd.ops) {
    commands++
    collected.push({
      at: c.at,
      op: c.kind === 'set' ? { kind: 'set', path: c.path, value: c.value } : { kind: 'add', path: c.path, delta: c.delta },
    })
  }
  collected.sort((a, b) => a.at - b.at)
  for (const it of collected) ops.push(it.op)
  const k = parseEraMessageKey(src)
  return { ops, bad, skipped, key: k ? k.key : null, epoch: k ? k.epoch : 0, bytes, commands, badCommands }
}


/** 深删：`data` 是对象树（删对应键）或路径数组（`["a.b.c"]`）。 */
function deepDelete(target, data) {
  if (Array.isArray(data)) {
    for (const p of data) {
      const parts = String(p).split('.')
      let cur = target
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur || typeof cur !== 'object') { cur = null; break }
        cur = cur[parts[i]]
      }
      if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]]
    }
    return target
  }
  for (const key of Object.keys(data)) {
    const v = data[key]
    if (v && typeof v === 'object' && !Array.isArray(v) && target[key] && typeof target[key] === 'object') {
      deepDelete(target[key], v)
    } else {
      delete target[key]
    }
  }
  return target
}

/**
 * 按序应用一组 op（不改原对象）。
 *
 * op 的四种形态：
 *   - `{kind:'variableinsert'|'variableedit', data}` ⇒ 深合并（② 的块，载荷是部分树）
 *   - `{kind:'variabledelete', data}`               ⇒ 深删
 *   - `{kind:'set', path, value}`                   ⇒ 按点分路径写值（③ `_.set`）
 *   - `{kind:'add', path, delta}`                   ⇒ 按点分路径数值累加（③ `_.add`）
 */
function applyOps(base, ops) {
  let out = base
  for (const op of ops) {
    if (op.kind === 'variabledelete') out = deepDelete({ ...out }, op.data)
    else if (op.kind === 'set') out = setPathValue(out, op.path, op.value)
    else if (op.kind === 'add') {
      const cur = getPathValue(out, op.path)
      const n = (typeof cur === 'number' && isFinite(cur)) ? cur : 0
      out = setPathValue(out, op.path, n + op.delta)
    } else out = deepMerge(out, op.data || {})
  }
  return out
}

/** 没有消息键时的内容指纹（djb2）：同一条消息重复送达要能被认出来。 */
function sigOfOps(ops) {
  const s = JSON.stringify(ops)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return s.length + '-' + h.toString(36)
}

/** 键里的毫秒时间戳（`era_mk_<epochms>_<rand>`）。解析不出按 0 计。 */
function epochOfKey(key) {
  return Number((/^era_mk_(\d+)_/.exec(String(key || '')) || [])[1] || 0)
}

/**
 * "按键序只重放到某个楼层"的定向重放：base ⊕ 所有 epoch ≤ 该楼的带键账本。
 *
 * 为什么不用 `rebuildState` 的现成结果当快照：乱序晚到时（旧楼在晚于新楼到达），
 * `rebuildState` 会把**更晚楼层的效果也算进去**，把那份"未来"存进旧楼的快照，
 * 时间旅行滚回去就会看到还没发生的数值。定向重放保证每楼快照 = "键序在该楼为止"的树。
 * （unkeyed 的 op 没有楼层归属，**不参与**楼层快照 —— 它们没有"当时"可言。）
 */
function stateAsOfEpoch(sessionId, epoch) {
  const ledger = opLedger.get(sessionId)
  let state = baseStore.get(sessionId) || {}
  if (ledger) {
    const upto = [...ledger.keyed.values()].filter((e) => e.epoch <= epoch).sort((a, b) => a.epoch - b.epoch)
    for (const e of upto) state = applyOps(state, e.ops)
  }
  return state
}

/**
 * 记一条**按楼快照**：该消息键应用完 ops **之后**的完整变量树。
 *
 * ★ 取样时点：快照存的是"该消息**到达并应用后**"的树，不是"按键序最终历史"的树。
 *   近似说明：装饰是异步乱序的，一条**晚到**且按键序应排在更早位置的消息会在重放时
 *   改写历史（最终状态被重算），但**已存的快照不回溯重算** —— 滚回旧楼看到的数值
 *   是"当时到达后"的取样，不是"按完整历史重演"的精确值。接受这个近似：
 *   真实场景里晚到的是少数，而为每个后续楼层重算快照的成本与复杂度不成比例。
 *
 * 容量纪律：
 *   - 每会话最多 `MAX_SNAPSHOTS`（200）条，超限淘汰**楼层最旧**的 ——
 *     判据是键里的毫秒时间戳（`era_mk_<epochms>_<rand>`，天然可排序），不是到达序：
 *     乱序到达时先到的新楼不该把后到的旧楼挤出去（时间旅行滚的是旧楼）。
 *     键解析不出时间戳的按 0 计（最先被淘汰）；同时间戳按插入序（先存先淘汰）。
 *   - 单条快照超 `MAX_SNAPSHOT_BYTES`（200KB，与单消息口径一致）不存树，存占位
 *     `{key, at, data: null}` —— 键与时间仍可查，树不可得。
 */
function recordSnapshot(sessionId, key, data) {
  let snaps = snapshotStore.get(sessionId)
  if (!snaps) {
    snaps = new Map()
    snapshotStore.set(sessionId, snaps)
  }
  const at = Date.now()
  // 先序列化：一来量体积，二来反序列化出一棵**独立副本**，杜绝与账本/状态树的别名共享
  //（账本里的 ops 载荷、baseStore 的树都可能被后续重放引用，快照必须自持）。
  const json = JSON.stringify(data)
  const entry = json.length > MAX_SNAPSHOT_BYTES
    ? { key, at, data: null }
    : { key, at, data: JSON.parse(json) }
  snaps.set(key, entry) // 同键重复送达：保留原位置、刷新取样（Map 语义）
  while (snaps.size > MAX_SNAPSHOTS) {
    // 淘汰"楼层最旧"：遍历找 epoch 最小者。≤200 条的线性扫，淘汰又不频繁，不值得维护堆。
    let oldestKey = null
    let oldestEpoch = Infinity
    for (const [k] of snaps) {
      const ep = epochOfKey(k)
      if (ep < oldestEpoch) { oldestEpoch = ep; oldestKey = k }
    }
    if (oldestKey === null) break
    snaps.delete(oldestKey)
  }
}

/**
 * 已记的按楼快照，按取样时间**正序**。
 * @param {string} sessionId
 * @returns {Array<{key:string, at:number, data:object|null}>}
 */
export function getSnapshots(sessionId) {
  const snaps = snapshotStore.get(sessionId)
  if (!snaps) return []
  return [...snaps.values()].sort((a, b) => a.at - b.at)
}

/**
 * 取某一条按楼快照（时间旅行：滚回旧楼看当时的数值）。
 * @param {string} sessionId
 * @param {string} messageKey
 * @returns {{key:string, at:number, data:object|null}|null} 不存在返回 null
 */
export function getSnapshot(sessionId, messageKey) {
  const snaps = snapshotStore.get(sessionId)
  if (!snaps) return null
  return snaps.get(messageKey) || null
}

/**
 * 记下一条消息的 ② 类编辑，并**重算**该会话的最终状态。
 *
 * ★ 为什么要"记账 + 重算"而不是"到场即合并"：装饰是**异步且可能乱序**的
 *   （页面滚动、消息重渲染都会让旧消息在后到达）。而模型的每楼 JSON 带的是**绝对值**，
 *   一旦把旧编辑合并在新编辑之后，被它覆盖的字段就会**回退到旧值**（好感度倒着走）。
 *   账本按**消息键的时间戳**升序重放 ⇒ 与送达顺序无关、重复送达无副作用。
 *   没有消息键的（老格式）按到达顺序追加在后面 —— 如实记录为已知限制，不假装等价。
 *   ★ ③ 的命令式写入（`_.set`/`_.add`）走**同一条账本**：一条消息里带 `era_data` 就按键序重放
 *   （与 ② 的块混在一起、按文本先后执行）；不带键就连同这条消息的所有 op 一起按**到达顺序**
 *   追加 —— 这是降级：装饰是异步乱序的，到达顺序可能与楼序不同（同 ② 的已知限制）。
 * ★ 按楼快照：消息带键时，把**应用后**的完整变量树记进会话级快照表（见 `recordSnapshot`）；
 *   不带键的消息不产生快照（时间旅行只对有键的楼有意义）。
 * @param {string} sessionId
 * @param {{key?:string|null, epoch?:number, sig?:string, ops:Array<{kind:string,data:any}>}} msg
 * @returns {object} 重算后的状态
 */
export function applyVariableMessage(sessionId, msg) {
  const ledger = touchSession(sessionId)
  const ops = (msg && Array.isArray(msg.ops)) ? msg.ops : []
  if (ops.length) {
    if (msg.key) {
      if (!ledger.keyed.has(msg.key)) {
        ledger.keyed.set(msg.key, { epoch: Number(msg.epoch) || 0, ops })
        while (ledger.keyed.size > MAX_KEYED) {
          // 丢最旧的那条（按 epoch），保证内存有界
          let oldestKey = null
          let oldestEpoch = Infinity
          for (const [k, v] of ledger.keyed) if (v.epoch < oldestEpoch) { oldestEpoch = v.epoch; oldestKey = k }
          if (oldestKey === null) break
          ledger.keyed.delete(oldestKey)
        }
      }
    } else {
      const sig = msg.sig || sigOfOps(ops)
      if (!ledger.unkeyed.some((u) => u.sig === sig)) {
        ledger.unkeyed.push({ sig, ops })
        while (ledger.unkeyed.length > MAX_KEYED) ledger.unkeyed.shift()
      }
    }
  }
  const state = rebuildState(sessionId)
  if (msg && msg.key) {
    // 快照取样时点见 recordSnapshot / stateAsOfEpoch 的注释：
    //   顺序到达 ⇒ 与"应用后重建"完全一致（更晚的楼层还没到，定向重放 = 全量重放）；
    //   乱序晚到 ⇒ 定向重放把树取在"键序 ≤ 该楼"，不给旧楼掺进未来的数值。
    //   epoch 缺省时从键字符串里取（同一段毫秒时间戳）。
    recordSnapshot(sessionId, msg.key, stateAsOfEpoch(sessionId, Number(msg.epoch) || epochOfKey(msg.key)))
  }
  return state
}

/** ① ⊕ ② ⇒ 最终状态。② 按 epoch 升序重放。 */
function rebuildState(sessionId) {
  const ledger = opLedger.get(sessionId)
  let state = baseStore.get(sessionId) || {}
  if (ledger) {
    const ordered = [...ledger.keyed.values()].sort((a, b) => a.epoch - b.epoch)
    for (const e of ordered) state = applyOps(state, e.ops)
    for (const e of ledger.unkeyed) state = applyOps(state, e.ops)
  }
  const out = deepMerge({}, state)
  stateStore.set(sessionId, { data: out, updatedAt: Date.now() })
  return out
}

/**
 * 已记账的消息键（升序）。留给"按楼快照/回看历史数值"这类功能用。
 * @param {string} sessionId
 * @returns {string[]}
 */
export function appliedMessageKeys(sessionId) {
  const ledger = opLedger.get(sessionId)
  if (!ledger) return []
  return [...ledger.keyed.entries()].sort((a, b) => a[1].epoch - b[1].epoch).map(([k]) => k)
}

// ─────────────────────────────────── 状态读写 ───────────────────────────────────

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
 *
 * 入口统一过一遍 `normalizeStatData`（④）：这样 `POST /api/muv-engine/state` 无论收到
 * `{stat_data:…}`、还是 ST 存储形态 `{chat:{…variables:{stat_data:…}}}`，落库口径都一样，
 * 卡的 `stat_data.xxx` 路径都能对上。平铺树不受影响（见该函数的注释）。
 * @param {string} sessionId
 * @param {object} data - New variable data
 */
export function setState(sessionId, data) {
  touchSession(sessionId)
  const d = normalizeStatData(data)
  baseStore.set(sessionId, d && typeof d === 'object' ? d : {})
  return rebuildState(sessionId)
}

/**
 * Merge new variable data into existing state.
 * @param {string} sessionId
 * @param {object} newData - New variable data to merge
 * @returns {object} Merged data
 */
export function mergeState(sessionId, newData) {
  touchSession(sessionId)
  const d = normalizeStatData(newData)
  baseStore.set(sessionId, deepMerge(baseStore.get(sessionId) || {}, d || {}))
  return rebuildState(sessionId)
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