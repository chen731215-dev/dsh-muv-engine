// muv-engine 诊断工具 — 一条命令查完所有常见故障点。
//
// 为什么要有它：排查这套插件时，几乎每次都要重复做同样几件事——确认服务器
// 有没有加载新代码、看当前预设绑的是哪张卡、卡是从哪个文件读到的、正则脚本
// 有几个、API 到底返回了什么。以前每次现写一个临时脚本、用完删掉，下次遇到
// 同类问题又得重写。这里固化成一条命令。
//
// 用法：
//   node diag.mjs                  全量体检
//   node diag.mjs --preset <id>    聚焦某个预设
//   node diag.mjs --msg "文本"      把一段文本过一遍渲染管线
//   node diag.mjs --msg-file a.txt 同上，从文件读
//   node diag.mjs --tests          附带跑回归测试
//   node diag.mjs --json           机器可读输出

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENGINE_DIR = __dirname
const TABLE_DIR = path.join(path.dirname(__dirname), 'dsh-muv-table')

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PRESETS_ROOT = path.join(DSH_HOME, '.agent-presets')
const SESSION_BINDINGS = path.join(PRESETS_ROOT, 'session-bindings.json')
const SESSIONS_DIR = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const PORT = Number(process.env.DSH_PORT || 3080)
const BASE = `http://127.0.0.1:${PORT}`

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : ''
}
const FOCUS_PRESET = opt('--preset')
const MSG = opt('--msg')
const MSG_FILE = opt('--msg-file')
const AS_JSON = flag('--json')

const out = []
const say = (s = '') => { out.push(s); if (!AS_JSON) console.log(s) }
const head = (t) => { say(); say('── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))) }

const report = {}

// ── 1. 服务器与代码新鲜度 ───────────────────────────────────────────────────
function checkFreshness() {
  head('服务器 / 代码新鲜度')
  const r = { port: PORT, listening: false, pid: 0, startedAt: null, newestSource: null, restartNeeded: null }

  // 找监听进程：优先 netstat，避免依赖 PowerShell 的 Get-NetTCPConnection
  let pid = 0
  try {
    const lines = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 8000 }).split('\n')
    for (const l of lines) {
      if (l.includes(`:${PORT}`) && /LISTENING/i.test(l)) {
        const parts = l.trim().split(/\s+/)
        pid = Number(parts[parts.length - 1]) || 0
        if (pid) break
      }
    }
  } catch (_) {}

  if (pid) {
    r.listening = true
    r.pid = pid
    try {
      const ps = execFileSync('powershell', ['-NoProfile', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToString('o')`],
        { encoding: 'utf8', timeout: 8000 }).trim()
      if (ps) r.startedAt = ps
    } catch (_) {}
  }

  // 最新源码修改时间
  let newest = 0, newestFile = ''
  for (const dir of [ENGINE_DIR, TABLE_DIR]) {
    const stack = [path.join(dir, 'lib')]
    while (stack.length) {
      const d = stack.pop()
      let ents = []
      try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const e of ents) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) { stack.push(f); continue }
        if (!e.name.endsWith('.js')) continue
        try {
          const m = fs.statSync(f).mtimeMs
          if (m > newest) { newest = m; newestFile = f }
        } catch (_) {}
      }
    }
  }
  r.newestSource = newestFile ? { file: newestFile, at: new Date(newest).toISOString() } : null

  if (r.startedAt && newest) {
    const started = Date.parse(r.startedAt)
    r.restartNeeded = newest > started
  }

  // 统一按本地时间显示：混用 UTC（ISO）与本地（进程启动）会让时间差看不出所以然。
  const local = (v) => {
    const d = v instanceof Date ? v : new Date(v)
    if (isNaN(d.getTime())) return String(v)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  say(`  端口 ${PORT}: ${r.listening ? '监听中 (PID ' + r.pid + ')' : '未监听'}`)
  if (r.startedAt) say(`  启动时间  : ${local(r.startedAt)}`)
  if (r.newestSource) say(`  最新源码  : ${path.basename(r.newestSource.file)} @ ${local(r.newestSource.at)}`)
  if (r.restartNeeded === true) {
    const lag = Math.round((newest - Date.parse(r.startedAt)) / 60000)
    say(`  ⚠ 需要重启：源码比进程新 ${lag} 分钟，改动尚未加载（Node 启动时缓存 ES 模块）`)
  } else if (r.restartNeeded === false) {
    say('  ✓ 代码已是最新（进程启动晚于最后一次修改）')
  } else {
    say('  ? 无法判定（拿不到进程启动时间或源码时间）')
  }
  return r
}

// ── 2. 预设与卡 ─────────────────────────────────────────────────────────────
function readJsonSafe(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

/** 最近写入的会话所绑定的预设（服务端 activePresetId 的同一套判据） */
function activePresetId() {
  const bind = readJsonSafe(SESSION_BINDINGS)
  if (!bind || !fs.existsSync(SESSIONS_DIR)) return ''
  let files = []
  try {
    files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.startsWith('session-') && f.endsWith('.json'))
      .map(f => {
        let m = 0
        try { m = fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs } catch (_) {}
        return { id: f.replace(/\.json$/, ''), mtime: m }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch (_) { return '' }
  for (const s of files) {
    const p = bind[s.id]
    if (p && p !== 'default' && fs.existsSync(path.join(PRESETS_ROOT, p))) return p
  }
  return ''
}

function sillyTavernCardDirs() {
  const roots = [process.env.DSH_SILLYTAVERN_DIR, 'C:/MySpecialFolder/SillyTavern',
    path.join(os.homedir(), 'SillyTavern'), path.join(os.homedir(), 'Documents', 'SillyTavern')].filter(Boolean)
  const found = []
  for (const root of roots) {
    const dataDir = path.join(root, 'data')
    if (!fs.existsSync(dataDir)) continue
    let users = []
    try { users = fs.readdirSync(dataDir) } catch { continue }
    for (const u of users) {
      const c = path.join(dataDir, u, 'characters')
      if (fs.existsSync(c)) found.push(c)
    }
  }
  return found
}

function scanPresets() {
  head('预设与卡')
  const rows = []
  let dirs = []
  try { dirs = fs.readdirSync(PRESETS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch (_) {}

  for (const name of dirs.sort()) {
    const dir = path.join(PRESETS_ROOT, name)
    const row = { preset: name, cardName: '', managedName: '', managedKB: 0, mismatch: false, pngName: '', pngKB: 0 }

    const arr = readJsonSafe(path.join(dir, 'characters.json'))
    if (Array.isArray(arr)) {
      const on = arr.find(c => c && c.enabled) || arr[0]
      row.cardName = on ? String(on.name || '') : ''
    }
    const managed = path.join(dir, 'muv-tables', 'card.json')
    if (fs.existsSync(managed)) {
      try { row.managedKB = Math.round(fs.statSync(managed).size / 1024) } catch (_) {}
      const j = readJsonSafe(managed)
      row.managedName = String(j?.data?.name || j?.name || '')
      const a = row.managedName.toLowerCase(), b = row.cardName.toLowerCase()
      row.mismatch = !!(a && b && !a.includes(b) && !b.includes(a))
    }
    // 预设目录里直接放的 PNG
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.png')) continue
        row.pngName = f
        try { row.pngKB = Math.round(fs.statSync(path.join(dir, f)).size / 1024) } catch (_) {}
        break
      }
    } catch (_) {}

    if (row.cardName || row.managedName || row.pngName) rows.push(row)
  }

  // ★ 注意（2026-09）：activePresetId() 是**按会话文件 mtime 猜**出来的
  //   「最近写入的会话所绑的预设」，**不是**"当前会话的权威预设"。
  //   权威值在 DSH 会话日志的事件流里（`agent-preset/selected` / header 的 `agentPreset`），
  //   由酒馆的 `GET /api/tavern/current-session?sessionId=` 解析。
  //   所以下面的 ▶ 只表示「这个预设最近被酒馆写过」，**别当成"你现在正在用的卡"**。
  const active = activePresetId()
  for (const r of rows) {
    const mark = r.preset === active ? '▶' : ' '
    const bits = []
    if (r.cardName) bits.push('卡=' + r.cardName)
    if (r.managedName) bits.push('managed=' + r.managedName + (r.managedKB ? `(${r.managedKB}KB)` : ''))
    if (r.pngName) bits.push('png=' + r.pngName)
    say(`  ${mark} ${r.preset.padEnd(26)} ${bits.join('  ')}`)
    if (r.mismatch) say(`      ⚠ managed 卡名与 characters.json 不一致 → 已忽略该 managed 副本`)
  }
  if (active) say(`\n  当前活跃预设（按最近写入会话）: ${active}`)
  else say('\n  ⚠ 无法判定活跃预设')

  // 预设是「每个会话各自绑定」的，所以「哪个预设是当前的」本身就有歧义：取决于
  // 用户在看哪个会话。把最近几个会话连各自绑定的预设列出来，歧义才看得见——
  // 否则很容易拿另一个会话的预设去判断当前这张卡。
  const bind = readJsonSafe(SESSION_BINDINGS)
  if (bind && fs.existsSync(SESSIONS_DIR)) {
    let sess = []
    try {
      sess = fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.startsWith('session-') && f.endsWith('.json'))
        .map(f => {
          let m = 0
          try { m = fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs } catch (_) {}
          const id = f.replace(/\.json$/, '')
          return { id, mtime: m, preset: bind[id] || '' }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 5)
    } catch (_) {}
    if (sess.length) {
      say('\n  最近会话 → 绑定预设:')
      for (const s of sess) {
        const when = new Date(s.mtime)
        const p = (n) => String(n).padStart(2, '0')
        say(`    ${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}:${p(when.getMinutes())}  ${s.id.slice(0, 22)}…  → ${s.preset || '(未绑定)'}`)
      }
    }
  }
  return { rows, active }
}

// ── 3. PNG 卡库 ─────────────────────────────────────────────────────────────
async function scanPngCards() {
  head('SillyTavern PNG 卡库')
  let readPngCard = null
  try {
    // A Windows drive path is not a valid import specifier; it must be a file URL.
    ({ readPngCard } = await import(pathToFileURL(path.join(TABLE_DIR, 'lib', 'png-card.js')).href))
  } catch (e) {
    say(`  ⚠ 无法加载 muv-table/lib/png-card.js: ${e.message}`)
  }
  if (!readPngCard) return []
  const dirs = sillyTavernCardDirs()
  if (!dirs.length) { say('  未找到 SillyTavern 卡库目录'); return [] }
  const cards = []
  for (const d of dirs) {
    say(`  ${d}`)
    let files = []
    try { files = fs.readdirSync(d) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.png')) continue
      const p = path.join(d, f)
      let kb = 0
      try { kb = Math.round(fs.statSync(p).size / 1024) } catch (_) {}
      const card = readPngCard(p)
      if (!card) { say(`      ${f.padEnd(26)} ${String(kb).padStart(6)}KB  (无 chara 数据)`); continue }
      const dd = card.data || {}
      const rs = (dd.extensions?.regex_scripts || []).length
      const wb = (dd.character_book?.entries || []).length
      const th = (dd.extensions?.tavern_helper?.scripts || []).length
      cards.push({ file: f, dir: d, name: dd.name || '', kb, regex: rs, world: wb, helper: th })
      say(`      ${f.padEnd(26)} ${String(kb).padStart(6)}KB  名=${dd.name || '?'}  正则=${rs}  世界书=${wb}  helper=${th}`)
    }
  }
  return cards
}

// ── 4. 实时 API ─────────────────────────────────────────────────────────────
async function probeApi() {
  head('实时 API')
  const r = { reachable: false, activePreset: null, noParam: null, perPreset: [] }
  try {
    const res = await getJson(`${BASE}/api/muv-table/active-preset`)
    if (!res.ok) {
      say(`  ✗ /active-preset 返回非 JSON (HTTP ${res.status}, ${res.contentType})`)
      say(`     ${res.snippet}${res.hint}`)
      return r
    }
    r.reachable = true
    r.activePreset = res.body
    say(`  /active-preset        → ${JSON.stringify(res.body)}`)
  } catch (e) {
    say(`  ✗ 服务器不可达: ${e.message}`)
    return r
  }

  try {
    const res = await getJson(`${BASE}/api/muv-table/tavern-card`)
    if (!res.ok) { say(`  ✗ tavern-card 返回非 JSON: ${res.snippet}${res.hint}`); return r }
    const j = res.body
    r.noParam = { cardName: j.cardName, name: j.name, source: j.cardSource, file: j.fileName, regex: (j.regexScripts || []).length }
    say(`  /tavern-card (无参)   → 卡=${j.cardName}  来源=${j.cardSource}  正则=${(j.regexScripts || []).length}  文件=${j.fileName}`)
    // ★ 语义已变（2026-09）：无参**不再**回落到「最近写入的会话」猜测，而是稳定返回
    //   酒馆默认预设（tavern-lite）并标 presetSource='default'。所以这一行**不再**能用来
    //   判断"sessionId / presetId 没传对" —— 它只会稳定地拿到默认卡。
    //   要验证某个会话/预设的定位，请**显式带参数**：
    //     ?sessionId=<id>                 → 按会话解析（服务端查 bindings → 默认）
    //     ?presetId=<id>&preferPreset=1    → 强制按该预设解析（诊断/卡库检查）
    //     ?preferActive=1                  → 这才启用「最近写入的会话」猜测
    say(`     ↳ presetSource=${j.presetSource || '(无)'}；无参恒为稳定默认，**不**代表定位正确`)
    say(`       要验证定位请显式带 ?sessionId= / ?presetId=&preferPreset=1`)
  } catch (e) {
    say(`  ✗ tavern-card 失败: ${e.message}`)
  }
  return r
}

async function probePreset(presetId) {
  try {
    const res = await getJson(`${BASE}/api/muv-table/tavern-card?presetId=${encodeURIComponent(presetId)}`)
    if (!res.ok) return { preset: presetId, error: res.snippet, hint: res.hint }
    const j = res.body
    const imgRule = (j.regexScripts || []).some(x => /img/i.test(String(x.findRegex || '')))
    return { preset: presetId, card: j.cardName, name: j.name, source: j.cardSource, regex: (j.regexScripts || []).length, hasImgRule: imgRule, dirs: (j.schemas || []).length }
  } catch (e) {
    return { preset: presetId, error: e.message }
  }
}

// ── 5. 消息过管线 ───────────────────────────────────────────────────────────
/**
 * 取一个 JSON 接口，并把非 JSON 的响应说清楚。
 *
 * 直接 `r.json()` 在服务端返回 HTML 错误页或纯文本时会抛一句无用的
 * "Unexpected token"。而这里最可能撞上的失败是**打错了端口**——例如把
 * SillyTavern 的 8000 当成 DSH 的 3080。SillyTavern 对不带 `x-csrf-token`
 * 的 POST 直接回 "Invalid CSRF token"；把原文带出来，才能一眼看出是打错了服务，
 * 而不是插件坏了。
 */
async function getJson(url, init) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), ...(init || {}) })
  const text = await r.text()
  try {
    return { ok: true, status: r.status, body: JSON.parse(text) }
  } catch (_) {
    let hint = ''
    if (/csrf/i.test(text)) hint = '  ← SillyTavern 的 CSRF 保护，说明这个端口是酒馆不是 DSH'
    else if (/<!doctype|<html/i.test(text)) hint = '  ← 返回 HTML，多半不是 DSH 接口'
    return {
      ok: false, status: r.status,
      contentType: r.headers.get('content-type') || '',
      snippet: text.slice(0, 220).replace(/\s+/g, ' '),
      hint,
    }
  }
}

/**
 * 探活一个外链图片。
 *
 * 不能只用 Node 的 `fetch`：它不读 Windows 系统代理设置，而本机跑着本地代理
 * （注册表 Internet Settings 里的 ProxyServer），于是 Node 直连被 ECONNRESET，
 * PowerShell 却能拿到 200。那会报出「图片挂了」的假警报，把真正的 bug 掩盖掉。
 * 所以先试 Node，失败再退回 PowerShell（它遵循系统代理）。
 */
async function probeUrl(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) })
    return { ok: true, status: r.status, type: r.headers.get('content-type') || '?', via: 'node' }
  } catch (_) {}
  try {
    const ps = execFileSync('powershell', ['-NoProfile', '-Command',
      `try { $r = Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -UseBasicParsing -TimeoutSec 20 -Method Head; ` +
      `Write-Output ($r.StatusCode.ToString() + ' ' + $r.Headers['Content-Type']) } ` +
      `catch { $c = $_.Exception.Response.StatusCode.value__; Write-Output ("FAIL " + $c) }`],
      { encoding: 'utf8', timeout: 30000 }).trim()
    if (ps && !ps.startsWith('FAIL')) {
      const [status, type] = ps.split(' ')
      return { ok: true, status: Number(status), type: type || '?', via: 'powershell' }
    }
    return { ok: false, error: ps || 'unknown', via: 'powershell' }
  } catch (e) {
    return { ok: false, error: e.message, via: 'none' }
  }
}

async function runMessage(text) {
  head('消息渲染管线')
  // 必须用「用户真正在玩的那张卡」来测。无参请求拿到的卡取决于服务端的活跃
  // 预设判据（最近写入的会话），而那可能是另一个会话——用错卡时所有正则都不
  // 匹配，看到的假象就是「满屏原始标签」，与真正的 bug 混在一起分不清。
  const preset = FOCUS_PRESET || presets.active || ''
  let card = null
  try {
    const url = preset
      ? `${BASE}/api/muv-table/tavern-card?presetId=${encodeURIComponent(preset)}`
      : `${BASE}/api/muv-table/tavern-card`
    const res = await getJson(url)
    if (!res.ok) { say(`  ✗ 拿不到角色卡: ${res.snippet}${res.hint}`); return }
    card = res.body
  } catch (e) { say(`  ✗ 拿不到角色卡: ${e.message}`); return }
  if (!card || !card.ok) { say('  ✗ 拿不到角色卡，无法过管线'); return }

  say(`  使用卡: ${card.cardName} (${(card.regexScripts || []).length} 个正则)` +
    (preset ? `  [预设 ${preset}]` : '  [无参 → 活跃预设]'))
  if (!preset) say('     ↳ 提示: 加 --preset <id> 才能测到你真正在玩的那张卡')

  // 客户端会先过 apply-regex-card
  try {
    const res = await getJson(`${BASE}/api/muv-engine/apply-regex-card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, cardJson: card }),
    })
    if (!res.ok) { say(`  ✗ apply-regex-card 返回非 JSON: ${res.snippet}${res.hint}`); return }
    const d = res.body
    const after = d.text || text
    say(`  apply-regex-card: ok=${d.ok}  变化=${after !== text}`)
    const tags = ['<Status_block>', '<UpdateVariable>', '<VariableEdit>', '<VariableInsert>', '<JSONPatch>', '<Analysis>', '<img>', '<choices>']
    const leftover = tags.filter(t => after.includes(t))
    say(`  残留原始标签: ${leftover.length ? leftover.join(' ') : '无'}`)
    const imgs = [...after.matchAll(/<img[^>]*>/gi)].map(m => m[0].slice(0, 120))
    if (imgs.length) { say('  生成的 <img>:'); imgs.forEach(s => say('      ' + s)) }
    // 若有外链图片，顺手探活
    for (const u of [...new Set((after.match(/https?:\/\/[^\s"'>]+\.(?:png|jpg|jpeg|webp|gif)/gi) || []))].slice(0, 5)) {
      const p = await probeUrl(u)
      if (p.ok) say(`      [${p.status}] ${p.type}  ${u}`)
      else say(`      [不可达 ${p.error}] ${u}`)
    }
    report.message = { card: card.cardName, changed: after !== text, leftover, images: imgs }
  } catch (e) {
    say(`  ✗ apply-regex-card 失败: ${e.message}`)
  }
}

// ── 6. 回归测试 ─────────────────────────────────────────────────────────────
function runTests() {
  head('回归测试')
  const suites = [
    [path.join(ENGINE_DIR, 'test-status-cascade.mjs'), 'muv-engine 状态栏级联'],
    [path.join(TABLE_DIR, 'test-png-card.mjs'), 'muv-table PNG 卡解析'],
  ]
  for (const [file, label] of suites) {
    if (!fs.existsSync(file)) { say(`  ${label}: 测试文件不存在`); continue }
    try {
      const o = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 120000 })
      const last = o.trim().split('\n').filter(l => l.includes('结果')).pop() || o.trim().split('\n').pop()
      say(`  ${label}: ${String(last).trim()}`)
    } catch (e) {
      const o = (e.stdout || '') + (e.stderr || '')
      const last = o.trim().split('\n').filter(l => l.includes('结果')).pop() || '(失败)'
      say(`  ${label}: ${String(last).trim()}`)
    }
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
report.freshness = checkFreshness()
const presets = scanPresets()
report.presets = presets
report.pngCards = await scanPngCards()
report.api = await probeApi()

const focus = FOCUS_PRESET || (presets.active || '')
if (focus) {
  head('聚焦预设: ' + focus)
  const p = await probePreset(focus)
  say('  ' + JSON.stringify(p))
  report.focus = p
}

const msgText = MSG || (MSG_FILE && fs.existsSync(MSG_FILE) ? fs.readFileSync(MSG_FILE, 'utf8') : '')
if (msgText) await runMessage(msgText)

if (flag('--tests')) runTests()

head('结论')
const todo = []
if (report.freshness.restartNeeded) todo.push('重启 DSH（源码比进程新，改动未加载）')
if (presets.rows.some(r => r.mismatch)) todo.push('有预设的 managed 副本卡名不一致（已自动忽略，可清理）')
if (!presets.active) todo.push('无法判定活跃预设')
if (!report.api.reachable) todo.push(`服务器 ${BASE} 不可达`)
if (todo.length) todo.forEach(t => say('  • ' + t))
else say('  ✓ 未发现明显问题')

say()
if (AS_JSON) console.log(JSON.stringify(report, null, 2))
