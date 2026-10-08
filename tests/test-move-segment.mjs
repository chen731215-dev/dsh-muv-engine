// ★ `tests/test-move-segment.mjs` —— `tools/move-segment.mjs` 的**常驻反证**
//
// 为什么必须常驻：工具头曾**断言**本文件存在，而当时它**并不存在** ⇒ 后人读注释会以为有护栏。
//   **悬空引用比缺反证更糟一格**（本会话同一族第 N 次：**检查要检查它声称检查的那个东西**）。
//
// 本文件只保留**真反证**。★ 一条被否掉的候选留在这里当教材：
//   早先还有一支 `MUV_MOVE_BAD_INSERT_INDEX`（"把新片插到第 0 位"）—— **实测永远不会红**：
//   分片模型只要求 `concat(parts) === 产物`，而**任何顺序都满足它**（元数据按同一顺序重算 ⇒ 自洽）
//   ⇒ 那是**假反证**（恒不报红的坏样本 = 空跑），已删除。真语义应是"**不重算该片元数据**"
//   （连续性 / 行数和必破）—— 留作后续单独一笔，并**先证明它真的会红**再写进来。
//
// 断言构成：
//   ① **正对照**：正常跑 ⇒ 生成器 exit=0、四条模块判据全绿、函数在产物里**恰好 1 次**（多重集合口径）
//   ② **真反证**：`MUV_MOVE_SKIP_PARTS_INSERT=1`（跳过 `parts` 插入）⇒ 必须**非零**且判据**点名**
//      + **命中次数自证**（注入横幅恰好 1 次 —— 否则"没红"可能只是"没注入"）
//   ③ **fail-closed 守卫**：脏工作树 ⇒ **拒绝运行**，且**不留下半成品**
//   ④ **非空跑下限** + **自证清理**（hermetic：只在 `%TEMP%` 的 worktree 里跑，跑完自清并打印删了哪些路径）
//
// ★ 为什么必须在 `%TEMP%` 的 `git worktree` 里跑：`move-segment` 的 `REPO` 由**自身位置**推导，
//   且它会**写仓库**；在主树上跑会污染工作树。worktree 在 HEAD 上 ⇒ 天然含已提交的工具与分片。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const NODE = process.execPath
const MIN_ASSERTIONS = 10          // ★ 非空跑下限：少于这个数说明本文件没在做事
let pass = 0, fail = 0
const cleaned = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + String(detail).slice(0, 300) : '')) }
}

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
  cleaned.push(dir)                        // 自证清理：记下来，最后打印 + 断言真的没了
}
const runGen = (dir, env = {}) => spawnSync(NODE, [
  'tools/move-segment.mjs', '--fn', 'ensureStatusCss', '--module', 'mod-status-css.js',
  '--scope', '<箭头函数@行4>', '--wiring', 'sbCss=MUV_SB_CSS',
], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } })
const judge = (dir, flag) => spawnSync(NODE, ['tools/build-client.mjs', flag], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 })

console.log('① ★ 正对照：正常搬一段 ⇒ 生成器 exit=0 且四条模块判据全绿')
{
  const d = makeSandbox('pos')
  const r = runGen(d)
  check('生成器 exit=0', r.status === 0, 'exit=' + r.status + '  ' + (r.stderr || '').slice(0, 200))
  check('打印的 parts 顺序里含新片', /mod-status-css\.js/.test(String(r.stdout || '')))
  for (const f of ['--check', '--levels', '--uniqueness', '--ledger']) {
    const j = judge(d, f)
    check('  ' + f + ' exit=0', j.status === 0, (j.stderr || j.stdout || '').slice(0, 200))
  }
  const art = fs.readFileSync(path.join(d, 'lib', 'client.js'), 'utf8')
  check('★ 无损：函数在产物里**恰好 1 次**（多重集合口径）',
    art.split('function ensureStatusCss').length - 1 === 1,
    '次数=' + (art.split('function ensureStatusCss').length - 1))
  check('★ 无损：承载片里原函数**已消失**（不是复制）',
    fs.readFileSync(path.join(d, 'src', 'client', 'part-02.js'), 'utf8').split('function ensureStatusCss').length - 1 === 0)
  dropSandbox(d)
}

console.log('\n② ★ 真反证：跳过 `parts` 插入 ⇒ 必须非零且**点名**（+ 命中次数自证）')
{
  const d = makeSandbox('skip')
  const r = runGen(d, { MUV_MOVE_SKIP_PARTS_INSERT: '1' })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const hits = (out.match(/跳过 parts 插入/g) || []).length
  check('★ 命中次数自证：注入横幅恰好出现 **1** 次（否则"没红"可能只是"没注入"）', hits === 1, '命中 ' + hits + ' 次')
  check('生成器 exit≠0', r.status !== 0, 'exit=' + r.status)
  const jc = judge(d, '--check'), jl = judge(d, '--ledger')
  const all = String(jc.stderr || '') + String(jc.stdout || '') + String(jl.stderr || '') + String(jl.stdout || '')
  check('★ 判据红，且**点名**（分片数 ≠ 期望 / 模块片不存在）',
    jc.status !== 0 && /分片数.*≠.*期望|不存在/.test(all), all.slice(0, 220))
  dropSandbox(d)
}

console.log('\n③ fail-closed 守卫：脏工作树 ⇒ **拒绝运行**（不是只打印），且不留半成品')
{
  const d = makeSandbox('dirty')
  const gm = path.join(d, 'tools', 'move-segment.mjs')
  fs.writeFileSync(gm, fs.readFileSync(gm, 'utf8') + '\n')
  const r = runGen(d)
  check('★ exit≠0 且给出"工作树不干净"的拒绝理由',
    r.status !== 0 && /工作树不干净/.test(String(r.stderr || '')), 'exit=' + r.status)
  check('★ 被拒后**没有**新模块片（不产出半成品）',
    !fs.existsSync(path.join(d, 'src', 'client', 'mod-status-css.js')))
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
  // ★ 口径收窄：断言"**本测试自己创建的** worktree 记录都已消失"（按自己的命名前缀），
  //   而不是"全机只剩主树" —— 后者会在**别的成员/别的机器**上因别人的 worktree 误报。
  //   （这条收窄是被实测逼出来的：最初那版"只剩主树"当场抓到我**上一轮遗留的** muv-gen3 ——
  //    那是真遗留、已清；但判据本身的口径仍然该收窄。）
  const wt = execFileSync('git', ['worktree', 'list'], { cwd: REPO, encoding: 'utf8' }).trim().split('\n')
  const mine = wt.filter((l) => /muv-move-/.test(l))
  check('★ 自证清理：worktree 记录里**没有**本测试创建的条目', mine.length === 0, mine.join(' | '))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
