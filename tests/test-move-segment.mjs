// ★ `tests/test-move-segment.mjs` —— `tools/move-segment.mjs` 的**常驻反证**
//
// 为什么必须常驻：工具头曾**断言**本文件存在，而当时它**并不存在** ⇒ 后人读注释会以为有护栏。
//   **悬空引用比缺反证更糟一格**（本会话同一族第 N 次：**检查要检查它声称检查的那个东西**）。
//
// ★★ 本文件里有一处**防复发**（见 `assertImportPresent`）：凡"判断某个 import/声明是否已存在"，
//   一律**只看声明区的那一行**，**不许全文 `Contains`**。
//   来由：我三次栽在同一族 —— `Contains('moduleRegistryReport')` 因**测试正文里有这个词**而假 True；
//   探针把结论写死在输出里；这一次 `Contains('pathToFileURL')` 因**我刚写的新代码含该词**而假 True
//   ⇒ import 补写被静默跳过 ⇒ `node --check` 查不出（只查语法）⇒ 直到运行才 `ReferenceError`。
//
// 断言构成：
//   ① **正对照**：正常跑 ⇒ 生成器 exit=0、四条模块判据全绿、函数在产物里**恰好 1 次**（多重集合口径）
//   ② **真反证**：`MUV_MOVE_SKIP_PARTS_INSERT=1`（跳过 `parts` 插入）⇒ 必须**非零**且判据**点名**
//   ③ **fail-closed 守卫**：脏工作树 ⇒ **拒绝运行**，且**不留下半成品**
//   ⑤⑥⑦ **B 族三条语义真实的注入**（B1 copy 而非 move / B2 不 bump / B3 值捕获）
//   ④ **非空跑下限** + **自证清理**（hermetic）
//
// ★ 失败时**必须打印子进程全量输出**（含 exit code）—— 否则"注入横幅没出现"与"判据没红"分不开。
// ★ 为什么必须在 `%TEMP%` 的 `git worktree` 里跑：`move-segment` 的 `REPO` 由**自身位置**推导，
//   且它会**写仓库**。worktree 在 HEAD 上 ⇒ 天然含**已提交**的工具（**不要**从工作树拷 —— 那会让沙盒变脏、触发守卫）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tokenize, functionScopes, scopeGroupReport } from '../tools/client-scope.mjs'

const SELF = fileURLToPath(import.meta.url)
const HERE = path.dirname(SELF)
const REPO = path.resolve(HERE, '..')
const NODE = process.execPath
// ★ 下限口径：**先测量再写死**。2026-10-08 本笔落地时实测 pass+fail = 26
//   （复算：node tests/test-move-segment.mjs | tail -1）。本笔新增 ⑨/⑨-正对照/同作用域组 共 6 条 ⇒ 10 → 20。
//   ★ task-32 再新增 ⑪ 段（真算 + 两条反证 + 输入敏感性）共 11 条 ⇒ 20 → 31。
const MIN_ASSERTIONS = 31

// ★ 搬迁目标（**参数化**：换目标只改这一处）。
//   目标刻意保留 = **笔 B 要真搬走的那个函数**（ensureStatusCss）⇒ 本测试 = 真搬迁的**同形预演**。
//   ★ 连带（写给笔 B）：笔 B 落地时必须**在同一笔里**把这里的 TARGET 换成另一个仍未搬的函数，
//     否则下面的 assertTargetStillInArtifact() 会（**正确地**）把语料判红。
const TARGET = { fn: 'ensureStatusCss', module: 'mod-status-css.js', wiring: 'sbCss=MUV_SB_CSS' }
const FN_DECL = 'function ' + TARGET.fn
let pass = 0, fail = 0
const cleaned = []
/** ★ 尚未清理的沙盒（用于**崩溃路径**兜底，见 cleanupAll）。 */
const live = []

/**
 * ★★ **崩溃路径的 `finally`**（Lead 要求）：`try/finally` 在"进程被异常打断"时**不一定**执行到，
 *   所以这里用 `process.on('exit')` 作兜底 —— 它在本进程**任何**退出路径上都会跑（含未捕获异常）。
 *   那正是先前泄漏的形态：B3 崩溃 ⇒ 跳过 dropSandbox ⇒ 留下一个 worktree（被"自证清理"断言抓到）。
 * ★ 职责分开（Lead 要求）：**清理**在 finally/exit 里做并**打印被删路径**；
 *   **后置断言**（"自建条目都不在了"）在 ④ 里单独做 —— 两者不混。
 */
function cleanupAll() {
  for (const d of live.slice()) {
    try { execFileSync('git', ['worktree', 'remove', '--force', d], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ }
    fs.rmSync(d, { recursive: true, force: true })
    console.log('  （兜底清理）已移除：' + d)
  }
  if (live.length) { try { execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ } }
}
process.on('exit', cleanupAll)

/** ★ 防复发：判断 import 是否已存在时，**只看 import 那一行**（不许全文 Contains）。 */
function assertImportPresent(file, needle) {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('import') && l.includes('node:url'))
  if (!line || !line.includes(needle)) {
    throw new Error('自查失败：' + path.basename(file) + ' 的 import 行里没有 ' + needle + '（行 = ' + JSON.stringify(line) + '）')
  }
  return line
}
assertImportPresent(SELF, 'pathToFileURL')

const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 900) : '')) }
}
/** 失败时把**子进程全量输出**附上（含 exit code）—— 这是"横幅没出现"能被区分出来的前提。 */
const fullOut = (r) => 'exit=' + r.status + '  ---stdout---\n' + String(r.stdout || '') + '\n---stderr---\n' + String(r.stderr || '')

// ── ★ 诊断①：本测试的搬迁目标必须**还在产物里**（已被真搬迁 ⇒ 明确失败并点名 + 下一步；不许静默换目标）──
function assertTargetStillInArtifact(repoDir = REPO) {
  const art = fs.readFileSync(path.join(repoDir, 'lib', 'client.js'), 'utf8')
  const n = art.split(FN_DECL).length - 1
  if (n !== 1) {
    throw new Error('诊断：搬迁目标 `' + TARGET.fn + '` 在产物里出现 ' + n + ' 次（应为 1）。'
      + ' ⇒ 很可能它**已经被真搬迁过** ⇒ 下一步：把 TARGET 换成**另一个仍未搬**的函数（并同步本文件的夹具）。'
      + ' ★ 这是**明确失败**，不是跳过（本仓禁止静默）。')
  }
}

/** ★ 诊断②：承载片**动态推导**（不再写死 part-02.js）——按 MANIFEST 行区间取包含该函数首行的那一片；
 *  并在**原承载片里**校验该原文**恰好 1 次**（≠1 ⇒ 明确失败并点名 + 下一步）。 */
function hostPartOf(repoDir = REPO) {
  const art = fs.readFileSync(path.join(repoDir, 'lib', 'client.js'), 'utf8')
  const toks = tokenize(art)
  let s = -1
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
    const idt = toks[i + 1]
    if (!idt || idt.value !== TARGET.fn) continue
    s = art.slice(0, toks[i].start).split('\n').length
    break
  }
  if (s < 0) throw new Error('诊断：产物里找不到 `function ' + TARGET.fn + '` ⇒ 下一步：确认 TARGET.fn 是否已被改名/搬走。')
  const mf = JSON.parse(fs.readFileSync(path.join(repoDir, 'src', 'client', 'MANIFEST.json'), 'utf8'))
  const p = mf.parts.find((x) => x.startLine <= s && s <= x.endLine)
  if (!p) throw new Error('诊断：找不到承载 ' + TARGET.fn + '（产物行 ' + s + '）的分片 ⇒ 下一步：核对 MANIFEST 行区间。')
  const rel = p.path.replace('src/client/', '')
  const inPart = fs.readFileSync(path.join(repoDir, 'src', 'client', rel), 'utf8').split(FN_DECL).length - 1
  if (inPart !== 1) throw new Error('诊断：原承载片 ' + rel + ' 里 `' + FN_DECL + '` 出现 ' + inPart + ' 次（应为 1）'
    + ' ⇒ 下一步：确认它是否已被复制（重复副本）或半搬运；本测试不许静默继续。')
  return rel.replace(/\.js$/, '.js')
}
assertTargetStillInArtifact()
const HOST = hostPartOf()
console.log('（本测试目标 = ' + TARGET.fn + '，接线 ' + TARGET.wiring + '，承载片 = ' + HOST + '）')

// ── ★★ 环境预检（必须在任何断言之前）：本测试**依赖 node 能 spawn 子进程** ──────
//   为什么要有这一段：本测试用 `spawnSync(NODE, …)` 驱动生成器与四条判据，用 `execFileSync('git', …)`
//   建 worktree。若**宿主环境禁止 node spawn 子进程**（实测本机 WorkBuddy 沙箱：任何
//   `spawnSync`/`execFileSync` 一律 `EBUSY`），则每条断言都会拿到 `exit=null` ⇒ **18 条断言全红**，
//   而那**不是代码坏了**，是环境不可用。★ 这正是本会话反复踩的"判据自己会骗人"家族：
//   **环境故障被伪装成代码故障**（与"恒不绿的坏样本""SKIP 被当 pass"同一族）。
//   ⇒ 口径：检测到 spawn 不可用 ⇒ **显式报"环境不可用"并以非零退出**，
//     且**不谎称**"断言 ×N 失败"。反之若 spawn 可用而本测试报红 ⇒ 那才是**真红**。
{
  const probe = spawnSync(NODE, ['-e', '0'], { encoding: 'utf8' })
  if (probe.error) {
    console.error('\n⛔ 环境不可用：本测试需要 node 能 spawn 子进程，但实测 `spawnSync(node,-e,0)` 报 '
      + probe.error.code + '。')
    console.error('   ⇒ 这不是代码故障：请换到允许 spawn 的环境重跑（本仓 CI / DSH 宿主），'
      + '或在本机用 `npm test` 的 runner。★ 按纪律：**不跳过、不冒充 pass、也不冒充 fail**。')
    process.exit(2)   // ★ 专用退出码 2 = 环境不可用（与"断言失败 = 1"区分 ⇒ 读数可判别）
  }
}

function makeSandbox(tag) {
  const dir = path.join(os.tmpdir(), 'muv-move-' + tag + '-' + Date.now())
  fs.rmSync(dir, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: REPO, stdio: 'ignore' })
  live.push(dir)                      // ★ 先登记再返回 ⇒ 之后任何异常/崩溃都能被兜底清理
  return dir
}function dropSandbox(dir) {
  try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ }
  fs.rmSync(dir, { recursive: true, force: true })
  try { execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ }
  const i = live.indexOf(dir); if (i >= 0) live.splice(i, 1)
  cleaned.push(dir)
}
const runGen = (dir, env = {}) => spawnSync(NODE, [
  'tools/move-segment.mjs', '--fn', TARGET.fn, '--module', TARGET.module,
  '--scope', '<箭头函数@行4>', '--wiring', 'sbCss=MUV_SB_CSS',
], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } })
const judge = (dir, flag) => spawnSync(NODE, ['tools/build-client.mjs', flag], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 })

/** ★ 把"注入横幅是否出现"单独判成一条**可区分**的断言（不与"判据没红"混在一起）。 */
function assertInjectionBanner(r, token) {
  const out = String(r.stdout || '') + String(r.stderr || '')
  const hits = (out.match(new RegExp('注入生效：[^\\n]*' + token, 'g')) || []).length
  check('★ 注入横幅含 ' + token + '，恰好 1 次（证明注入真的生效）', hits === 1, '命中 ' + hits + ' 次。\n' + fullOut(r))
  return hits === 1
}

console.log('① ★ 正对照：正常搬一段 ⇒ 生成器 exit=0 且四条模块判据全绿')
{
  const d = makeSandbox('pos')
  const r = runGen(d)
  check('生成器 exit=0', r.status === 0, fullOut(r))
  check('打印的 parts 顺序里含新片', new RegExp(TARGET.module.replace('.', '\\.')).test(String(r.stdout || '')), fullOut(r))
  for (const f of ['--check', '--levels', '--uniqueness', '--ledger']) {
    const j = judge(d, f)
    check('  ' + f + ' exit=0', j.status === 0, fullOut(j))
  }
  const art = fs.readFileSync(path.join(d, 'lib', 'client.js'), 'utf8')
  check('★ 无损：函数在产物里**恰好 1 次**（多重集合口径）',
    art.split(FN_DECL).length - 1 === 1,
    '次数=' + (art.split(FN_DECL).length - 1))
  check('★ 无损：承载片（动态推导 = ' + HOST + '）里原函数**已消失**（不是复制）',
    fs.readFileSync(path.join(d, 'src', 'client', HOST), 'utf8').split(FN_DECL).length - 1 === 0, '承载片 = ' + HOST)
  dropSandbox(d)
}

console.log('\n② ★ 真反证：跳过 `parts` 插入 ⇒ 必须非零且**点名**')
{
  const d = makeSandbox('skip')
  const r = runGen(d, { MUV_MOVE_SKIP_PARTS_INSERT: '1' })
  assertInjectionBanner(r, 'SKIP_PARTS')
  check('生成器 exit≠0', r.status !== 0, fullOut(r))
  const jc = judge(d, '--check'), jl = judge(d, '--ledger')
  const all = String(jc.stderr || '') + String(jc.stdout || '') + String(jl.stderr || '') + String(jl.stdout || '')
  check('★ 判据红，且**点名**（分片数 ≠ 期望 / 模块片不存在）',
    jc.status !== 0 && /分片数.*≠.*期望|不存在/.test(all), all.slice(0, 300))
  dropSandbox(d)
}

console.log('\n③ fail-closed 守卫：脏工作树 ⇒ **拒绝运行**（不是只打印），且不留半成品')
{
  const d = makeSandbox('dirty')
  const gm = path.join(d, 'tools', 'move-segment.mjs')
  fs.writeFileSync(gm, fs.readFileSync(gm, 'utf8') + '\n')
  const r = runGen(d)
  check('★ exit≠0 且给出"工作树不干净"的拒绝理由',
    r.status !== 0 && /工作树不干净/.test(String(r.stderr || '')), fullOut(r))
  check('★ 被拒后**没有**新模块片（不产出半成品）',
    !fs.existsSync(path.join(d, 'src', 'client', TARGET.module)))
  dropSandbox(d)
}

console.log('\n⑤ ★ B1：搬了**不删原文**（copy 而非 move）⇒ 必须由 `--uniqueness` 红并点名')
{
  const d = makeSandbox('b1')
  const r = runGen(d, { MUV_MOVE_NO_DELETE: '1' })
  if (assertInjectionBanner(r, 'NO_DELETE')) {
    const j = judge(d, '--uniqueness')
    const o = String(j.stderr || '') + String(j.stdout || '')
    check('★ B1 生效后 `--uniqueness` 红并点名', j.status !== 0 && new RegExp(TARGET.fn + '|声明').test(o),
      'exit=' + j.status + '  ' + o.slice(0, 400))
  } else {
    check('★ B1 生效后 `--uniqueness` 红并点名（**因注入未生效 ⇒ 无法判定**）', false,
      '横幅未出现 ⇒ 生成器可能在打印横幅前就退出（全量输出见上一条）')
  }
  dropSandbox(d)
}

console.log('\n⑥ ★ B2：**不 bump `EXPECTED_PARTS`** ⇒ 必须由 `--check`（分片数不符）红并点名')
{
  const d = makeSandbox('b2')
  const r = runGen(d, { MUV_MOVE_NO_BUMP: '1' })
  if (assertInjectionBanner(r, 'NO_BUMP')) {
    const j = judge(d, '--check')
    const o = String(j.stderr || '') + String(j.stdout || '')
    check('★ B2 生效后 `--check` 红（分片数 ≠ 期望）并点名',
      j.status !== 0 && /分片数.*≠.*期望|EXPECTED_PARTS/.test(o), 'exit=' + j.status + '  ' + o.slice(0, 400))
  } else {
    check('★ B2 生效后 `--check` 红并点名（**因注入未生效 ⇒ 无法判定**）', false, '横幅未出现')
  }
  dropSandbox(d)
}

console.log('\n⑦ ★ B3：接线写成**值捕获**（`x: MUV_X`）⇒ 必须由 `moduleWiringCaptureReport` 红并点名')
{
  const d = makeSandbox('b3')
  const r = runGen(d, { MUV_MOVE_VALUE_CAPTURE: '1' })
  if (assertInjectionBanner(r, 'VALUE_CAPTURE')) {
    const bc = await import(pathToFileURL(path.join(d, 'tools', 'build-client.mjs')).href)
    const loaded = bc.loadFromDisk()
    const w = bc.moduleWiringCaptureReport({ parts: loaded.parts, manifest: loaded.manifest })
    check('★ B3 生效后判据红（值捕获/顶层求值）并点名该模块',
      w.ok === false && w.problems.some((p) => /值捕获|顶层求值/.test(p)), JSON.stringify(w.problems).slice(0, 400))
  } else {
    check('★ B3 生效后判据红并点名（**因注入未生效 ⇒ 无法判定**）', false, '横幅未出现')
  }
  dropSandbox(d)
}

console.log('\n⑧ ★ 守卫仍会响（加严后的反证）：把待查文本改坏 ⇒ 工具必须 fail 并点名')
{
  const d = makeSandbox('tamper')
  const r = runGen(d, { MUV_MOVE_TAMPER_LOOKUP: '1' })
  // ★ 这一支**不能**要求"注入横幅出现"：TAMPER 的**本意**就是让守卫在**打印横幅之前** fail-closed
  //   （计数守卫在 ① 横幅之前）⇒ 横幅缺席是**预期结果**，不是失败。
  //   "注入真的生效"的证据在这里是**守卫报的那句话本身**（"出现 0 次"）。
  const o = String(r.stderr || '') + String(r.stdout || '')
  check('★ 注入自证：守卫按 TAMPER 后的计数报错（出现 0 次）', /出现 0 次/.test(o), fullOut(r))
  check('★ 守卫红并点名（该函数原文出现 0 次 / 找不到逐字原文）',
    r.status !== 0 && /恰好 1 次|找不到该函数的逐字原文/.test(o), fullOut(r))
  check('★ 被拒后没有产出半成品（不写新模块片）', !fs.existsSync(path.join(d, 'src', 'client', TARGET.module)))
  dropSandbox(d)
}

console.log('\n⑨ ★ 计数守卫的另一侧（**出现 2 次**）：必须 fail-closed 并**点名那个数**')
{
  const d = makeSandbox('dup')
  const r = runGen(d, { MUV_MOVE_DUP_TARGET: '1' })
  const o = String(r.stderr || '') + String(r.stdout || '')
  // ★ 两件：① **点名「出现 2 次」那个数** —— 只判 exit≠0 的话，别的守卫先红也会"通过"；
  //   ② **夹具自证**：夹具自己打印它造了几份，守卫报出的计数必须与之一致。
  // ★ 这里**不要求注入横幅**：DUP 的本意就是让守卫在打印横幅**之前** fail-closed
  //   ⇒ 横幅缺席是**预期结果**（与 ⑧/TAMPER 同型）。
  check('★ 夹具自证：夹具自报「已制造 1 份重复副本（该原文共 2 份）」', /夹具：已制造 1 份重复副本（该原文共 2 份）/.test(o), fullOut(r))
  check('★ 点名那个数：守卫报「出现 2 次」（= 原始 1 份 + 夹具追加 1 份）', /出现\s*2\s*次/.test(o), fullOut(r))
  check('★ 红（fail-closed，不是只打印）', r.status !== 0, fullOut(r))
  check('★ 被拒后没有产出半成品（不写新模块片）', !fs.existsSync(path.join(d, 'src', 'client', TARGET.module)))
  dropSandbox(d)
}

console.log('\n⑨-正对照：同一夹具**不设** DUP 开关 ⇒ 守卫不响（证明上面的红确实来自"重复副本"）')
{
  const d = makeSandbox('dupctl')
  const r = runGen(d)
  const o = String(r.stderr || '') + String(r.stdout || '')
  check('★ 正对照：exit=0、不报「出现 2 次」、且仍打印无损证据 1/0',
    r.status === 0 && !/出现\s*2\s*次/.test(o) && /函数体（接线化后）在产物里出现次数 = 1/.test(o)
      && /承载片里原函数原文出现次数 = 0/.test(o), fullOut(r))
  dropSandbox(d)
}

// ★ 同作用域组：名单**自推导**（不硬编码）——用 functionScopes 取包含该函数的最小分组，
//   再按 token 收该组内的 function 声明名；断言 scopeGroupReport 该组 ok=true（+ 空分组反证）。
console.log('\n⑩ ★ 搬迁目标的同作用域组必须 ok=true（名单自推导，不硬编码）')
{
  const cs = await import(pathToFileURL(path.join(REPO, 'tools', 'client-scope.mjs')).href)
  const srcNow = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  const toks = cs.tokenize(srcNow)
  let start = -1
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
    const idt = toks[i + 1]
    if (!idt || idt.value !== TARGET.fn) continue
    start = toks[i].start
    break
  }
  if (start < 0) throw new Error('诊断：找不到 ' + TARGET.fn + ' 的声明位置')
  // ★ 名单自推导（不硬编码）：候选取**承载片里的**函数（同片 ⇒ 天然是近邻），
  //   再按 scopeGroupReport 报出的 scope **逐个核对**，只留下与目标同 scope 的那些。
  //   先用"最紧的包含分组"收窄成 195 个（整个工厂）是错的 —— 那正是 scopeGroupReport 会判
  //   "跨作用域"的那种名单；这里改成"按 scope 字段逐个筛"。
  const scopeOf = (nm) => {
    const g = cs.scopeGroupReport({ src: srcNow, names: [nm] })
    return g.members[0] ? g.members[0].scope : null
  }
  const myScope = scopeOf(TARGET.fn)
  if (!myScope) throw new Error('诊断：拿不到 ' + TARGET.fn + ' 的 scope ⇒ 下一步：核对 scopeGroupReport().members[0].scope 的形态。')
  const partText = fs.readFileSync(path.join(REPO, 'src', 'client', HOST), 'utf8')
  const partToks = cs.tokenize(partText)
  const cand = []
  for (let i = 0; i < partToks.length; i++) {
    if (partToks[i].type !== 'ident' || partToks[i].value !== 'function') continue
    const idt = partToks[i + 1]
    if (idt && idt.type === 'ident') cand.push(idt.value)
  }
  const uniq = [...new Set(cand)].filter((nm) => scopeOf(nm) === myScope)
  const grp = cs.scopeGroupReport({ src: srcNow, names: uniq })
  console.log('    目标 scope = ' + myScope)
  console.log('    推导出的同作用域名单（' + uniq.length + ' 个，取自承载片 ' + HOST + '）：' + uniq.join(', '))
  check('★ 同作用域组 ok=true 且 members ≥ 1（防空分组假绿）', grp.ok === true && grp.members.length >= 1 && grp.members.length === uniq.length,
    JSON.stringify({ ok: grp.ok, members: grp.members.length, names: uniq.length, problems: grp.problems }).slice(0, 400))
  check('★ 反证：空分组 ⇒ ok=false（这条断言**会红**）', cs.scopeGroupReport({ src: srcNow, names: [] }).ok === false)
}

console.log('\n⑪ ★ task-32：`preMoveScopeEvidence` 必须**真算**（不许写死）+ 两条反证')
{
  const cs = await import(pathToFileURL(path.join(REPO, 'tools', 'client-scope.mjs')).href)
  const srcNow = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')

  // ⑪-a 正对照：正常搬 ⇒ 账本写 `live`，且同一条 console 里**打印出真算读数**
  {
    const d = makeSandbox('scope-ok')
    const r = runGen(d)
    const o = String(r.stdout || '') + String(r.stderr || '')
    check('★ ⑪-a 正对照：exit=0', r.status === 0, fullOut(r))
    check('★ ⑪-a 正对照：打印 preMoveScopeEvidence = **live**（值来自读数）',
      /preMoveScopeEvidence = \*\*live\*\*/.test(o) && /真算：scope=/.test(o), fullOut(r))
    // 账本落盘值 = live（读沙盒里的 MANIFEST，不读主仓）
    let ev = null
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(d, 'src', 'client', 'MANIFEST.json'), 'utf8'))
      ev = mf.modules['src/client/' + TARGET.module] && mf.modules['src/client/' + TARGET.module].preMoveScopeEvidence
    } catch { /* 诊断在下一条 */ }
    check('★ ⑪-a 正对照：账本 `preMoveScopeEvidence` === "live"', ev === 'live', '实际 = ' + JSON.stringify(ev))
    dropSandbox(d)
  }

  // ⑪-b 反证一：**代码层** —— 把"算不出"注入（`MUV_MOVE_SCOPE_UNRESOLVED=1`）⇒ 必须非零 + 点名 + 不落盘
  {
    const d = makeSandbox('scope-bad')
    const r = runGen(d, { MUV_MOVE_SCOPE_UNRESOLVED: '1' })
    const o = String(r.stderr || '') + String(r.stdout || '')
    check('★ ⑪-b 反证：exit≠0（fail-closed，不是静默降级）', r.status !== 0, fullOut(r))
    check('★ ⑪-b 反证：报错**点名**"算不出来"+ 点名该函数', /算不出来/.test(o) && new RegExp(TARGET.fn).test(o), fullOut(r))
    check('★ ⑪-b 反证：**没有**产出新模块片（不落半成品）',
      !fs.existsSync(path.join(d, 'src', 'client', TARGET.module)), TARGET.module + ' 竟然存在')
    dropSandbox(d)
  }

  // ⑪-c 反证二：**判据层** —— `scopeGroupReport` 的两条"必然算不出"输入 ⇒ ok=false（证明判据会咬）
  {
    const gEmpty = cs.scopeGroupReport({ src: srcNow, names: [] })
    check('★ ⑪-c 反证二：空名单 ⇒ ok=false', gEmpty.ok === false, JSON.stringify(gEmpty.problems))
    const gGhost = cs.scopeGroupReport({ src: srcNow, names: ['__task32_no_such_fn__'] })
    check('★ ⑪-c 反证二：不存在的函数名 ⇒ ok=false 且点名"找不到函数"',
      gGhost.ok === false && (gGhost.problems || []).some((p) => /找不到函数/.test(p)), JSON.stringify(gGhost.problems))
    // 正对照（同一判据的"能算出"侧）：目标函数 ⇒ ok=true 且成员 ≥ 1
    const gOk = cs.scopeGroupReport({ src: srcNow, names: [TARGET.fn] })
    check('★ ⑪-c 正对照：目标函数 ⇒ ok=true 且成员 ≥ 1（判据不是永假）',
      gOk.ok === true && gOk.members.filter((m) => m.name === TARGET.fn).length >= 1, JSON.stringify(gOk.problems))
  }

  // ⑪-d 输入敏感性：换成**另一个作用域**的函数 ⇒ scope 读数必须**不同**（否则"真算"≈"写死"）
  {
    const a = cs.scopeGroupReport({ src: srcNow, names: [TARGET.fn] })
    const other = (() => {
      const toks = cs.tokenize(srcNow)
      for (let i = 0; i < toks.length; i++) {
        if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
        const idt = toks[i + 1]
        if (idt && idt.type === 'ident' && idt.value !== TARGET.fn) {
          const g = cs.scopeGroupReport({ src: srcNow, names: [idt.value] })
          if (g.ok && g.scope && g.scope !== a.scope) return g
        }
      }
      return null
    })()
    check('★ ⑪-d 输入敏感性：存在另一个**不同作用域**的目标 ⇒ scope 读数不同（非恒同值）',
      other !== null && other.scope !== a.scope,
      'a.scope=' + JSON.stringify(a.scope) + ' other=' + JSON.stringify(other && other.scope))
  }
}

console.log('\n④ 非空跑下限 + 自证清理（hermetic）')
check('★ 断言数 ≥ ' + MIN_ASSERTIONS + '（否则"全部通过"可能只是"什么都没跑"）', pass + fail >= MIN_ASSERTIONS,
  '实际 ' + (pass + fail))
{
  const left = cleaned.filter((p) => fs.existsSync(p))
  console.log('  本测试创建并清理的路径（' + cleaned.length + ' 个）：')
  for (const p of cleaned) console.log('    ' + p)
  check('★ 自证清理：以上路径**都已不存在**', left.length === 0, JSON.stringify(left))
  const wt = execFileSync('git', ['worktree', 'list'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n')
  const mine = wt.filter((l) => /muv-move-/.test(l))
  check('★ 自证清理：worktree 记录里**没有**本测试创建的条目', mine.length === 0, mine.join(' | '))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
