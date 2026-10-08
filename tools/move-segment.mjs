#!/usr/bin/env node
// ★ `tools/move-segment.mjs` —— 把"搬一段"做成**一次原子操作**（task-16 骨架段的关键缺口）
//
// ─────────────────────────────────────────────────────────────────────────────
// ★★ 长期约束（**挪目录之前先读这句**）：本文件**必须留在 `tools/` 根**。
//   理由：runner 的语料根是 `ALL_DIRS = ['tests', 'tools/verify', 'tools/repro']` —— `tools/` 根**不在**语料里，
//   所以 `--all` 不会收它。但**它会写仓库**（承载片 / 新模块片 / `tools/build-client.mjs` 的 EXPECTED_PARTS /
//   MANIFEST / 并 `execFileSync(build-client)`）⇒ 一旦有人把它挪进 `tools/verify/` 或 `tools/repro/`，
//   `--all` 就会**把一个会写仓库的脚本当测试执行**（这正是 `verify-guard-samples.gen.mjs` 进
//   `CORPUS_EXCLUDE` 的那条理由）。⇒ **挪目录必须同时加 `CORPUS_EXCLUDE` 条目**。
// ─────────────────────────────────────────────────────────────────────────────
//
// 当前状态（★ 下面每句都**可自证**，不含任何"未经核查的可用性断言"）：
//   · 经**沙盒**正/反证：`tests/test-move-segment.mjs`（正对照 + 一条真反证 + 脏树拒绝 + 自证清理）；
//   · **真搬迁尚未发生**（本工具至今只被用于 `%TEMP%` 沙盒，主仓产物未被动过）；
//   · 本工具**会写仓库** ⇒ 它**不自行宣告"可用"**。
//   · 那个 bug 是它**自己的正向跑**抓出来的：产物 557532 → 557250、`--check` exit=1（分片数 19≠20）、
//     `--ledger` exit=1。根因：`build-client` 按 MANIFEST 里**已有的 `parts` 数组**拼装（**不枚举目录**），
//     而当时那版只写了模块**文件**、**没把新片插进 `parts`** ⇒ 函数被移除却没被拼回。
//   · 修法「重切分」由本工具**显式做**；**不许**改成"按目录枚举"（那会让新增/删除分片静默跟随目录，
//     与 S2/S5 的"清单声明制 + 禁止静默重生成"冲突）。
//
//
// 四步原子操作（漏一步就留下"清单与分片不一致"，而它**看起来只是判据红了**）：
//   ① 改分片：把函数从承载片移除、生成模块片，并**把新片插入 `parts` 数组**（含 startLine/endLine/深度）
//   ② 跑 build-client 重生成（**非静默**：刷新 bytes/sha256 与 artifact.sha256）
//   ③ 补 `MANIFEST.modules` 账本条目（preMoveScope + preMoveScopeEvidence:**live** + wiring）
//   ④ 显式 bump `EXPECTED_PARTS`
//
// 形态约定（本工具**统一产出**）：
//   · 接线块必须是 `/* wiring */` 或 `const __wiring = { … }`，**且必须位于片的末尾**
//   · 接线项一律**访问器**（`x: () => MUV_X`）；值捕获会被 `moduleWiringCaptureReport` 判红（S8/P3）
//
// 用法：
//   node tools/move-segment.mjs --fn <函数名> --module mod-x.js --scope "<搬前作用域归属>" \
//     [--wiring k=IDENT]… [--dry]
// 故障注入（**仅供常驻反证使用**，见 `tests/test-move-segment.mjs`）：
//   MUV_MOVE_SKIP_PARTS_INSERT=1 ⇒ 故意**跳过 `parts` 插入** ⇒ 必须红（--check 分片数 / --ledger 模块片不存在）
//      ★ 这一支**已由常驻测试覆盖**（红并点名 + 命中次数自证 + 正对照）。
//   ★ 已删除的候选：早先还有 `MUV_MOVE_BAD_INSERT_INDEX=1`（"把新片插到第 0 位"）——
//     它**永远不会红**：分片模型只要求 `concat(parts) === 产物`，**任何顺序都满足它**
//     （元数据按同一顺序重算 ⇒ 自洽；函数声明靠提升可见 ⇒ 纯重排不改语义）。
//     ⇒ 那是**恒不绿的坏样本**（与"恒不报红"是同一族的另一面）⇒ 已撤下，
//       不要在源码里断言它存在（**悬空引用比缺反证更糟一格**）。
//   ★ B 族（语义真实、待补，每条**先证明会红**再写进测试）：
//     B1 `搬了不删原文`（copy 而非 move）⇒ 应由 `--uniqueness` 红并点名
//     B2 `不 bump EXPECTED_PARTS` ⇒ 应由 `--check`（分片数不符）红并点名
//     B3 `接线写成值捕获`（`x: MUV_X`）⇒ 应由 `moduleWiringCaptureReport` 红并点名
//     ※ B 族验的是**判据**；若某支不红，结论应是"**缺判据**，得补判据"，**不许换个坏样本绕过去**。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { tokenize } from './client-scope.mjs'
import { loadFromDisk, EXPECTED_PARTS } from './build-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const PARTS_DIR = path.join(REPO, 'src', 'client')
const BUILD = path.join(HERE, 'build-client.mjs')

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const allOf = (n) => argv.reduce((a, v, i) => (v === '--' + n ? a.concat([argv[i + 1]]) : a), [])
const FN = arg('fn'); const MOD = arg('module'); const SCOPE = arg('scope'); const DRY = argv.includes('--dry')
const SKIP_PARTS = !!process.env.MUV_MOVE_SKIP_PARTS_INSERT
// ★ 原来这里还有一个 `BAD_INDEX = !!process.env.MUV_MOVE_BAD_INSERT_INDEX`（"把新片插到第 0 位"）
//   —— **已删除**（Lead 裁定 A）：它与"**禁死代码**/判据的分支必须被真跑一次"冲突，且它产的
//   "全绿但产物被重排"**永远不会红**、**无任何测试覆盖** ⇒ 留着就是一句活的误导。
//   若将来要 B4（"不重算该片元数据"⇒ 连续性/行数和必破 ⇒ 必然红），**按新语义重加，并先证明会红**。

function fail(msg) { console.error('❌ move-segment：' + msg); process.exit(1) }
const WIRING = allOf('wiring').map((s) => {
  const m = /^([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)$/.exec(s)
  if (!m) fail('--wiring 格式必须是 `<接线键>=<标识符>`：' + s)
  return { key: m[1], target: m[2] }
})

// ── (c) fail-closed 前置守卫 ──
if (!FN || !MOD || !SCOPE) fail('用法：--fn <函数名> --module <mod-*.js> --scope "<搬前作用域归属>" [--wiring k=IDENT]…')
if (!/^mod-[^/]+\.js$/.test(MOD)) fail('模块名必须形如 mod-*.js（四条模块判据按这个名字识别）')
{
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim()
  if (st) fail('工作树不干净 —— 搬一段是原子操作，请先提交或还原：\n' + st)
}
const { artifact, manifest } = loadFromDisk()
const modPath = 'src/client/' + MOD
if (manifest.parts.some((p) => p.path === modPath)) fail('该模块片已在 parts 里：' + modPath)
if (fs.existsSync(path.join(PARTS_DIR, MOD))) fail('模块文件已存在：' + MOD)
if (manifest.modules && manifest.modules[modPath]) fail('modules 账本里已有该模块：' + modPath)

// ── 定位函数 + 承载片 ──
const toks = tokenize(artifact)
let s0 = -1, e0 = -1
for (let i = 0; i < toks.length; i++) {
  if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
  const idt = toks[i + 1]
  if (!idt || idt.value !== FN) continue
  let d = 0, close = -1
  for (let k = i + 2; k < toks.length; k++) { const q = toks[k]; if (q.type !== 'punct') continue
    if (q.value === '{') d++; else if (q.value === '}') { d--; if (d === 0) { close = k; break } } }
  s0 = toks[i].start; e0 = toks[close].end; break
}
if (s0 < 0) fail('产物里找不到函数 ' + FN)
const fnText = artifact.slice(s0, e0)
const lineOf = (off) => artifact.slice(0, off).split('\n').length
const sLine = lineOf(s0), eLine = lineOf(e0)
const hostIdx = manifest.parts.findIndex((p) => p.startLine <= sLine && eLine <= p.endLine)
if (hostIdx < 0) fail('找不到承载该函数的分片（行 ' + sLine + '-' + eLine + '）')
const host = manifest.parts[hostIdx]
const hostText = fs.readFileSync(path.join(REPO, host.path), 'utf8')
if (!hostText.includes(fnText)) fail('承载片里没有该函数的**逐字**原文 ⇒ 分片与产物不一致，请先修好')

// ── 生成模块正文（统一产出接线形态）──
const indent = (fnText.match(/^\s*/) || [''])[0]
let body = fnText
for (const w of WIRING) {
  const re = new RegExp('\\b' + w.target.replace(/[$]/g, '\\$&') + '\\b', 'g')
  if (!(body.match(re) || []).length) fail('函数体里没有出现 ' + w.target + ' ⇒ 这条接线是多余的（不许声明用不到的接线）')
  body = body.replace(re, '__wiring.' + w.key + '()')
}
const modText = [
  indent + '// ── ' + MOD.replace(/\.js$/, '') + '：' + FN + '（档 B：**显式接线**；由 move-segment 生成）──',
  indent + '/* wiring */',
  indent + 'const __wiring = {',
  ...WIRING.map((w) => indent + '  ' + w.key + ': () => ' + w.target + ','),
  indent + '}',
  ...body.split('\n'),
].join('\n') + '\n'
if (!/const\s+__wiring\s*=\s*\{[\s\S]*?\n\s*\}\s*$/.test(modText)) fail('生成的接线块不在**片末**（现有判据要求块在片末）')
const newHostText = hostText.replace(fnText + '\n', '')
if (newHostText === hostText) fail('从承载片里移除函数失败（逐字匹配没命中）')

// ── ★ 重切分：新 parts 顺序 + 逐片元数据（**显式职责**）──
const baseParts = manifest.parts.map((p) => ({ ...p }))
const newEntry = { path: modPath, startLine: 0, endLine: 0, lines: 0, bytes: 0, sha256: '', depthAtStart: 0, depthAtEnd: 0 }
// ★ 插入位置恒为「承载片之后」—— 原来这里读过 `BAD_INDEX`（可插到第 0 位）的分支**已删除**，
//   因为那个分支**永远不会红**（`concat(parts) === 产物` 对任何顺序都成立）且无测试覆盖。
const insertAt = hostIdx + 1
const ordered = SKIP_PARTS
  ? baseParts
  : [...baseParts.slice(0, insertAt), newEntry, ...baseParts.slice(insertAt)]
const textOf = (p) => (p.path === modPath ? modText : (p.path === host.path ? newHostText : fs.readFileSync(path.join(REPO, p.path), 'utf8')))
{
  const full = ordered.map((p) => textOf(p)).join('')
  const tk = tokenize(full)
  // 深度：按"行首偏移 -> 当前深度"建表
  const depthAt = new Map()
  { let d = 0, ti = 0, cur = 0
    while (cur <= full.length) {
      depthAt.set(cur, d)
      const nl = full.indexOf('\n', cur)
      if (nl < 0) break
      while (ti < tk.length && tk[ti].start < nl) { const q = tk[ti]; if (q.type === 'punct') { if (q.value === '{') d++; else if (q.value === '}') d-- } ti++ }
      cur = nl + 1
    } }
  let off = 0, cursor = 0
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]
    const t = textOf(p)
    p.startLine = cursor + 1
    p.lines = t.split('\n').length - (t.endsWith('\n') ? 1 : 0)
    p.endLine = cursor + p.lines
    p.bytes = Buffer.byteLength(t, 'utf8')
    p.depthAtStart = depthAt.get(off) || 0
    // ★ `depthAtEnd` 必须等于**下一片的 `depthAtStart`**（分片是连续行区间 ⇒ 构造性连续）。
    //   先前写成"查该片最后一个换行处的深度"⇒ 那个偏移**不在** map 的键集里 ⇒ `.get()` 得 undefined
    //   ⇒ 回退成 0 ⇒ `--check` 报"边界深度不连续"（实测 part-01 结束深度 0 ≠ mod-text 起始深度 2）。
    p.depthAtEnd = null
    off += t.length; cursor += p.lines
  }
  for (let i = 0; i + 1 < ordered.length; i++) ordered[i].depthAtEnd = ordered[i + 1].depthAtStart
  {
    const last = ordered[ordered.length - 1]
    const lt = textOf(last)
    last.depthAtEnd = depthAt.get(off - lt.length + lt.length - 1) ?? (last.depthAtStart || 0)
  }
}

console.log('① 分片：' + host.path + ' 移除 ' + fnText.split('\n').length + ' 行；新增 ' + modPath
  + '（' + modText.split('\n').length + ' 行）' + (SKIP_PARTS ? '   ★★ 故障注入：**跳过 parts 插入**' : ''))
console.log('   parts 顺序：' + ordered.map((p) => p.path.replace('src/client/', '')).join(' , '))
console.log('② EXPECTED_PARTS ' + EXPECTED_PARTS + ' → ' + (EXPECTED_PARTS + 1))
console.log('③ modules 账本：' + modPath + '（preMoveScopeEvidence = **live**）')
console.log('④ 产物：build-client 重生成（非静默）')
if (DRY) { console.log('--dry：到此为止'); process.exit(0) }

fs.writeFileSync(path.join(REPO, host.path), newHostText)
fs.writeFileSync(path.join(PARTS_DIR, MOD), modText)
{
  const bt0 = fs.readFileSync(BUILD, 'utf8')
  const before = 'export const EXPECTED_PARTS = ' + EXPECTED_PARTS
  if (!bt0.includes(before)) fail('build-client.mjs 里找不到 `' + before + '`')
  fs.writeFileSync(BUILD, bt0.replace(before, 'export const EXPECTED_PARTS = ' + (EXPECTED_PARTS + 1)))
}
{
  const mp = path.join(PARTS_DIR, 'MANIFEST.json')
  const mf = JSON.parse(fs.readFileSync(mp, 'utf8'))
  const keep = new Map(mf.parts.map((p) => [p.path, p]))
  mf.parts = ordered.map((p) => ({ ...p, sha256: keep.get(p.path) ? keep.get(p.path).sha256 : '' }))
  mf.modules[modPath] = {
    // ★ 账本必须由本工具**自己算好**（build-client 只刷新 parts/artifact，**不刷 functions 账本**）
    //   形态与既有条目同构：函数名 -> sha256(归一化后的函数文本)
    functions: { [FN]: createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex') },
    preMoveScope: SCOPE,
    preMoveScopeEvidence: 'live',
    wiring: Object.fromEntries(WIRING.map((w) => [w.key, { kind: 'accessor', target: w.target }])),
  }
  fs.writeFileSync(mp, JSON.stringify(mf, null, 2) + '\n')
}
execFileSync(process.execPath, [BUILD], { cwd: REPO, stdio: 'inherit' })

// ── (d) 搬移无损证据（多重集合口径）──
console.log('')
console.log('=== 搬移无损证据（多重集合口径，不按位置配对）===')
{
  const after = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  const count = (h, n) => h.split(n).length - 1
  const bodyCount = count(after, body)
  const hostLeft = count(fs.readFileSync(path.join(REPO, host.path), 'utf8'), fnText)
  console.log('  函数体（接线化后）在产物里出现次数 = ' + bodyCount + (bodyCount === 1 ? '  ✓（恰好 1 次）' : '  ✗（应为 1）'))
  console.log('  承载片里原函数原文出现次数 = ' + hostLeft + (hostLeft === 0 ? '  ✓（确实已移走，不是复制）' : '  ✗（应为 0）'))
  console.log('  产物字节数 = ' + Buffer.byteLength(after, 'utf8'))
}
console.log('')
console.log('=== 自查（exit code + 各桶）===')
let bad = 0
for (const flag of ['--check', '--levels', '--uniqueness', '--ledger']) {
  const r = spawnSync(process.execPath, [BUILD, flag], { cwd: REPO, encoding: 'utf8' })
  // ★ 修（原为 `.pop()` 取最后一行）：它**区分不了**两种情况 ——
  //   「命令**没有任何输出**」vs「命令成功但**内容不在最后一行**」（原写法两者都显示"(无输出)"，
  //   而 --check 的摘要其实在 stdout 里、只是不在末尾一条）。⇒ 打印 **exit code + 原始输出长度 + 前后几行**。
  const raw = String(r.stdout || '') + String(r.stderr || '')
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  const head = lines.slice(0, 2).join(' ｜ ')
  const last = lines.length > 2 ? lines[lines.length - 1] : ''
  if (r.status !== 0) bad++
  console.log('  ' + flag.padEnd(13) + ' exit=' + r.status + ' ｜ 输出 ' + raw.trim().length + ' 字节'
    + (lines.length === 0 ? ' ｜ **真的没有任何输出**' : ' ｜ 首: ' + head + (last ? ' ｜ 末: ' + last : '')))
}
process.exit(bad ? 1 : 0)
