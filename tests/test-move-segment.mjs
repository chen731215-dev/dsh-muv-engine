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

const SELF = fileURLToPath(import.meta.url)
const HERE = path.dirname(SELF)
const REPO = path.resolve(HERE, '..')
const NODE = process.execPath
const MIN_ASSERTIONS = 10
let pass = 0, fail = 0
const cleaned = []

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

function makeSandbox(tag) {
  const dir = path.join(os.tmpdir(), 'muv-move-' + tag + '-' + Date.now())
  fs.rmSync(dir, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: REPO, stdio: 'ignore' })
  return dir
}
function dropSandbox(dir) {
  try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ }
  fs.rmSync(dir, { recursive: true, force: true })
  try { execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore' }) } catch { /* 忽略 */ }
  cleaned.push(dir)
}
const runGen = (dir, env = {}) => spawnSync(NODE, [
  'tools/move-segment.mjs', '--fn', 'ensureStatusCss', '--module', 'mod-status-css.js',
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
  check('打印的 parts 顺序里含新片', /mod-status-css\.js/.test(String(r.stdout || '')), fullOut(r))
  for (const f of ['--check', '--levels', '--uniqueness', '--ledger']) {
    const j = judge(d, f)
    check('  ' + f + ' exit=0', j.status === 0, fullOut(j))
  }
  const art = fs.readFileSync(path.join(d, 'lib', 'client.js'), 'utf8')
  check('★ 无损：函数在产物里**恰好 1 次**（多重集合口径）',
    art.split('function ensureStatusCss').length - 1 === 1,
    '次数=' + (art.split('function ensureStatusCss').length - 1))
  check('★ 无损：承载片里原函数**已消失**（不是复制）',
    fs.readFileSync(path.join(d, 'src', 'client', 'part-02.js'), 'utf8').split('function ensureStatusCss').length - 1 === 0)
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
    !fs.existsSync(path.join(d, 'src', 'client', 'mod-status-css.js')))
  dropSandbox(d)
}

console.log('\n⑤ ★ B1：搬了**不删原文**（copy 而非 move）⇒ 必须由 `--uniqueness` 红并点名')
{
  const d = makeSandbox('b1')
  const r = runGen(d, { MUV_MOVE_NO_DELETE: '1' })
  if (assertInjectionBanner(r, 'NO_DELETE')) {
    const j = judge(d, '--uniqueness')
    const o = String(j.stderr || '') + String(j.stdout || '')
    check('★ B1 生效后 `--uniqueness` 红并点名', j.status !== 0 && /ensureStatusCss|声明/.test(o),
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
