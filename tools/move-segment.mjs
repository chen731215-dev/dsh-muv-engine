#!/usr/bin/env node
// ★ `tools/move-segment.mjs` —— **把"搬一段"做成一次原子操作**（task-16 骨架段的关键缺口）
//
// 为什么需要它（来自 task-16 的 dry run 读数）：手工搬一段需要**四个步骤** ——
//   ① 改分片 ② 跑生成器重生成 ③ 补 `MANIFEST.modules` 账本条目 ④ 显式 bump `EXPECTED_PARTS`
// 任何一步漏掉，都会留下"清单与分片不一致"的状态，而它**看起来只是判据红了**（我 dry run 里那 7 条就是）。
// 本工具把四步合成一次调用，并在最后**自查**（跑四条模块判据 + 打印 exit code 与各桶）。
//
// ★ 形态约定（写进 §44.14；本工具**统一产出**该形态，省掉手工往返）：
//   · 接线块必须是 `/* wiring */` 或 `const __wiring = { … }`
//   · ★ 且**必须位于片的末尾**（现有判据要求块在片末；位置不对会 fail-loud，这是有意的）
//   · 接线项一律**访问器**（`x: () => MUV_X`），值捕获会被 `moduleWiringCaptureReport` 判红（P3/S8）
//
// 用法：
//   node tools/move-segment.mjs --fn ensureStatusCss --module mod-status-css.js \
//     --scope "<箭头函数@行4>" --wiring "sbCss=MUV_SB_CSS" [--dry]
//   `--wiring` 可重复；格式 `<接线键>=<目标标识符>`（目标会被自动写成访问器 `() => <标识符>`）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tokenize } from './client-scope.mjs'
import { loadFromDisk, EXPECTED_PARTS } from './build-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const PARTS_DIR = path.join(REPO, 'src', 'client')
const BUILD = path.join(HERE, 'build-client.mjs')

// ── 参数 ──
const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : dflt
}
const allOf = (name) => argv.reduce((acc, v, i) => (v === '--' + name ? acc.concat([argv[i + 1]]) : acc), [])
const FN = arg('fn')
const MOD = arg('module')
const SCOPE = arg('scope')
const DRY = argv.includes('--dry')
const WIRING = allOf('wiring').map((s) => {
  const m = /^([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)$/.exec(s)
  if (!m) throw new Error('--wiring 格式必须是 `<接线键>=<标识符>`：' + s)
  return { key: m[1], target: m[2] }
})
if (!FN || !MOD || !SCOPE) throw new Error('用法：--fn <函数名> --module <mod-*.js> --scope "<搬前作用域归属>" [--wiring k=IDENT]…')

const fail = (msg) => { console.error('❌ move-segment：' + msg); process.exit(1) }

// ── 0. 前置：工作树必须干净（否则"原子操作"会把别人的改动卷进来）──
{
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim()
  if (st) fail('工作树不干净 —— 搬一段是原子操作，请先提交或还原：\n' + st)
}

// ── 1. 读现状 ──
const { parts, artifact, manifest } = loadFromDisk()
const modPath = 'src/client/' + MOD
if (!/^mod-[^/]+\.js$/.test(MOD)) fail('模块名必须形如 mod-*.js（四条模块判据按这个名字识别）')
if (manifest.parts.some((p) => p.path === modPath)) fail('该模块片已存在：' + modPath)

// ── 2. 在产物里定位函数（词法配平）──
const toks = tokenize(artifact)
let s0 = -1, e0 = -1
for (let i = 0; i < toks.length; i++) {
  if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
  const idt = toks[i + 1]
  if (!idt || idt.value !== FN) continue
  let d = 0, close = -1
  for (let k = i + 2; k < toks.length; k++) {
    const q = toks[k]
    if (q.type !== 'punct') continue
    if (q.value === '{') d++
    else if (q.value === '}') { d--; if (d === 0) { close = k; break } }
  }
  s0 = toks[i].start; e0 = toks[close].end; break
}
if (s0 < 0) fail('产物里找不到函数 ' + FN)
const fnText = artifact.slice(s0, e0)

// 承载分片：按行区间找
const lineOf = (off) => artifact.slice(0, off).split('\n').length
const sLine = lineOf(s0), eLine = lineOf(e0)
const host = manifest.parts.find((p) => p.startLine <= sLine && eLine <= p.endLine)
if (!host) fail('找不到承载该函数的分片（行 ' + sLine + '-' + eLine + '）')

// ── 3. 生成模块正文（★ 统一产出接线形态：块在**片末**、接线一律访问器）──
const hostText = fs.readFileSync(path.join(REPO, host.path), 'utf8')
if (!hostText.includes(fnText)) fail('承载分片里没有该函数**逐字**原文 ⇒ 分片与产物不一致，请先修好')
const indent = (fnText.match(/^\s*/) || [''])[0]
let body = fnText
for (const w of WIRING) {
  const re = new RegExp('\\b' + w.target.replace(/[$]/g, '\\$&') + '\\b', 'g')
  const n = (body.match(re) || []).length
  if (n === 0) fail('函数体里没有出现 ' + w.target + ' ⇒ 这条接线是多余的（不许声明用不到的接线）')
  body = body.replace(re, `__wiring.${w.key}()`)
}
const modLines = [
  indent + '// ── ' + MOD.replace(/\.js$/, '') + '：' + FN + '（档 B：**显式接线**；由 move-segment 生成）──',
  indent + '/* wiring */',
  indent + 'const __wiring = {',
  ...WIRING.map((w) => indent + '  ' + w.key + ': () => ' + w.target + ','),
  indent + '}',
  ...body.split('\n'),
]
const modText = modLines.join('\n') + '\n'
if (!/const\s+__wiring\s*=\s*\{[\s\S]*?\n\s*\}\s*$/.test(modText)) {
  fail('生成的接线块不在**片末**（现有判据要求块在片末）—— 这是本工具的形态约定，不该发生')
}

// ── 4. 四步原子操作 ──
const newHostText = hostText.replace(fnText + '\n', '')
if (newHostText === hostText) fail('从分片里移除函数失败')
const newExpected = EXPECTED_PARTS + 1
console.log('① 分片：' + host.path + ' 移除 ' + fnText.split('\n').length + ' 行；新增 ' + modPath + '（' + modLines.length + ' 行）')
console.log('② EXPECTED_PARTS ' + EXPECTED_PARTS + ' → ' + newExpected)
console.log('③ modules 账本：写入 ' + modPath + '（preMoveScopeEvidence = **live**，因为这是"落地那一笔"）')
console.log('④ 产物：由 `build-client` 重生成（**非静默** —— 它会刷新 bytes/sha256 与 artifact.sha256）')
if (DRY) { console.log('--dry：到此为止，不写盘'); process.exit(0) }

fs.writeFileSync(path.join(REPO, host.path), newHostText)
fs.writeFileSync(path.join(PARTS_DIR, MOD), modText)
{
  const bp = BUILD
  let bt = fs.readFileSync(bp, 'utf8')
  const before = 'export const EXPECTED_PARTS = ' + EXPECTED_PARTS
  if (!bt.includes(before)) fail('build-client.mjs 里找不到 `' + before + '`')
  fs.writeFileSync(bp, bt.replace(before, 'export const EXPECTED_PARTS = ' + newExpected))
}
{
  const mp = path.join(PARTS_DIR, 'MANIFEST.json')
  const mf = JSON.parse(fs.readFileSync(mp, 'utf8'))
  mf.modules[modPath] = {
    functions: {},
    preMoveScope: SCOPE,
    preMoveScopeEvidence: 'live',        // ★ 档 B 段在**落地那一笔**里必须写 live（S-口径 ①）
    wiring: Object.fromEntries(WIRING.map((w) => [w.key, { kind: 'accessor', target: w.target }])),
  }
  fs.writeFileSync(mp, JSON.stringify(mf, null, 2) + '\n')
}
execFileSync(process.execPath, [BUILD], { cwd: REPO, stdio: 'inherit' })

// ── 5. 自查：四条模块判据 + 打印 exit code 与各桶 ──
console.log('')
console.log('=== 自查（exit code + 各桶）===')
for (const flag of ['--check', '--levels', '--uniqueness', '--ledger']) {
  const r = spawnSync(process.execPath, [BUILD, flag], { cwd: REPO, encoding: 'utf8' })
  const tail = String(r.stdout || '').trim().split('\n').pop()
  console.log('  ' + flag.padEnd(13) + ' exit=' + r.status + '  ｜ ' + (tail || '(无输出)'))
}
console.log('')
console.log('★ 下一步（本工具**不做**的部分，必须人工补）：')
console.log('  · 跑 `node tests/test-client-parts.mjs` 与全套，并交 S7 五件证据')
console.log('  · S4 行为差分（本段若碰 DOM ⇒ 需无头浏览器宿主）')
console.log('  · 该模块的 functions 账本会在下一次生成时由 build-client 刷新（初始为空是预期的）')
