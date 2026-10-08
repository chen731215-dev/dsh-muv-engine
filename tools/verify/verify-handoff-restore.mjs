// 验证交接文档里的「换机恢复」步骤是否真的可行。
//
// 为什么要有这个：本项目的核心约束是「用户要换电脑」，HANDOFF.md 里写了一套
// 从 GitHub 克隆 + 重建 junction + 跑测试的恢复流程 —— 但那套流程**从来没有被
// 实际执行过**。没验证过的恢复步骤等于没有恢复步骤。
//
// 做法：克隆到全新临时目录（不碰现有开发树），照文档跑，报告每一步的真实结果。
// 运行：node verify-handoff-restore.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPOS = [
  { name: 'dsh-muv-engine', branch: 'master', test: ['tests/test-status-cascade.mjs', 'tests/test-client-render.mjs'] },
  // ★ 钉死 sha（与 CI 同一个值）：跟随默认分支 tip 会让「同伴仓一改名就红」，那不是本仓的问题。
  //   升级同伴仓 sha 是**显式动作**，见 HANDOFF.md 的「升级同伴仓 sha」一节。
  { name: 'dsh-muv-table', branch: 'master', sha: '8be6643754237867c7e28bef7e69213932a0f21b', test: ['test-png-card.mjs', 'test-muv-parser.mjs', 'test-preset-resolve.mjs'] },
  { name: 'dsh-tavern-v2', branch: 'main', test: [] },
]

let pass = 0, fail = 0, skip = 0
const skips = []
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
/**
 * ★ 「响亮跳过」：环境不具备（例如 GitHub 不可达）时**不能判红** —— 否则本门禁会因为
 *   「远端还没推 / 今天网不好」而永远红，属**错误的红**，比不跑更坏。但它必须**响亮**：
 *   逐条打印 `SKIP <项> ← 原因`，收尾汇总报 skip 数（skip>0 时不得打印"全绿"）。
 */
const SKIP = (name, why) => { skip++; skips.push(name + ' ← ' + why); console.log('  SKIP ' + name + '  ← ' + why) }

/**
 * ★ 布局无关：分家后测试住在 `tests/`，分家前在仓根。两种位置都认 ——
 *   这样本文件在「远端已推新布局」与「远端仍是旧布局」时都能给出正确结论，
 *   而不是因为搬运顺序把自己变成一条**错误的红**。
 */
function resolveIn(dir, rel) {
  const cands = rel.includes('/') ? [rel, rel.split('/').pop()] : [rel]
  for (const c of cands) {
    const p = path.join(dir, c)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 克隆失败：环境不可达 → SKIP；文档真的写错（分支/仓库/sha 不存在）→ FAIL。 */
const NETWORK_ISH = /could not resolve host|unable to access|failed to connect|timed out|timeout|RPC failed|early EOF|Connection (?:was )?reset|network|ETIMEDOUT|proxy|Failed to connect/i
// ★ `not our ref` / `upload-pack` 必须在这里：**钉死的 sha 不存在**时 git 报的是
//   `fatal: remote error: upload-pack: not our ref <sha>`。原先这条不在列表里 ⇒ 会被归成
//   「原因不明 ⇒ SKIP」= **半空绿**，而 task-10 要的恰恰是"钉错 sha 必须红"。
//   （实测抓到：我一度把这条误判成"会走判红分支"，因为我探针脚本最后一行是**写死的结论**、
//     与自己算出来的 DOC_BUG=false 相矛盾 —— 探针该只说事实，不该替数据下结论。）
const DOC_BUG = /Remote branch|not found|couldn't find remote ref|does not exist|Repository not found|not our ref|upload-pack/i

const root = path.join(os.tmpdir(), 'dsh-restore-check-' + Date.now())
fs.mkdirSync(root, { recursive: true })
console.log('恢复目标目录: ' + root + '\n')

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] })
}

console.log('[1] 从 GitHub 克隆（照 HANDOFF 第 2 节 方式 A）')
for (const r of REPOS) {
  const dir = path.join(root, r.name)
  try {
    // ★ 有 `sha` 就**钉死到那个 sha**（fetch 那一个提交 + detach），而不是跟随默认分支 tip。
    //   理由与 CI 那步一致：跟随 tip ⇒ 同伴仓一改名就红，那不是本仓的问题。
    //   钉死的 sha 若**不存在** ⇒ fetch 失败 ⇒ 异常 ⇒ 走下面的分支（不会静默回退到 tip）。
    if (r.sha) {
      // ★ 目录必须先建：`git clone` 会自己建目录，而 `git init` **不会** ——
      //   不建就会 `spawnSync git ENOENT`（cwd 不存在），而且会被下面的 catch 归成
      //   「环境问题 ⇒ SKIP」⇒ 半空绿。（这是本笔一度引入的 bug，实测抓到后修掉。）
      fs.mkdirSync(dir, { recursive: true })
      try {
        git(['init', '--quiet', '.'], dir)
        git(['remote', 'add', 'origin', `https://github.com/chen731215-dev/${r.name}.git`], dir)
        git(['fetch', '--quiet', '--depth', '1', 'origin', r.sha], dir)
        git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], dir)
      } catch (e) {
        // ★ 失败时**把刚建的空目录删掉**：否则 [2] 会看到"目录在、文件缺"，
        //   把「没克隆成功（应 SKIP）」误判成「关键文件缺失（FAIL）」——
        //   而那是一条**假红**（网络不通不是本仓的问题）。实测抓到。
        //   （与 `git clone` 路径的行为对齐：失败 ⇒ 目录不存在 ⇒ [2] SKIP。）
        fs.rmSync(dir, { recursive: true, force: true })
        throw e
      }
    } else {
      git(['clone', '--quiet', '--branch', r.branch, '--depth', '1',
        `https://github.com/chen731215-dev/${r.name}.git`, dir], root)
    }
    const head = git(['rev-parse', '--short', 'HEAD'], dir).trim()
    check(`克隆 ${r.name}`, fs.existsSync(path.join(dir, 'package.json')), '缺少 package.json')
    if (r.sha) {
      check(`克隆 ${r.name} 钉到了 ${r.sha.slice(0, 12)}…`,
        head.startsWith(r.sha.slice(0, head.length)), `实际 ${head}`)
    }
    console.log(`       HEAD ${head}  ${r.sha ? '钉死 sha ' + r.sha.slice(0, 12) + '…' : '分支 ' + r.branch}`)
  } catch (e) {
    const msg = String(e.message || e).slice(0, 200)
    // 环境不可达 ⇒ 响亮跳过（不判红）；分支/仓库不存在 ⇒ 文档真写错了，判红
    if (DOC_BUG.test(msg)) check(`克隆 ${r.name}`, false, msg)
    else if (NETWORK_ISH.test(msg)) SKIP(`克隆 ${r.name}`, '远端不可达：' + msg)
    else SKIP(`克隆 ${r.name}`, '克隆失败（原因不明，按环境问题跳过）：' + msg)
  }
}

console.log('\n[2] 克隆出来的内容是否够跑（HANDOFF 承诺的关键文件）')
const need = [
  ['dsh-muv-engine', ['lib/index.js', 'lib/client.js', 'lib/status-cascade.js', 'diag.mjs', 'HANDOFF.md', 'tests/test-status-cascade.mjs', 'tests/test-client-render.mjs']],
  ['dsh-muv-table', ['lib/index.js', 'lib/muv-parser.js', 'lib/png-card.js', 'lib/panel.html', 'test-png-card.mjs']],
  ['dsh-tavern-v2', ['lib/index.js', 'lib/client.manager.bundle.js', 'cordis.patch.yml']],
]
for (const [repo, files] of need) {
  const dir = path.join(root, repo)
  if (!fs.existsSync(dir)) { SKIP(repo + ' 文件清单', '仓库未克隆成功（见上）'); continue }
  const missing = files.filter((f) => !resolveIn(dir, f))   // ★ 布局无关：新位置与仓根旧位置都认
  check(`${repo} 关键文件齐全（${files.length} 个）`, missing.length === 0, '缺: ' + missing.join(', '))
}

console.log('\n[3] node_modules 是否被误克隆进来（.gitignore 是否生效）')
for (const r of REPOS) {
  const dir = path.join(root, r.name)
  if (!fs.existsSync(dir)) continue
  check(`${r.name} 不含 node_modules`, !fs.existsSync(path.join(dir, 'node_modules')))
}

console.log('\n[4] 在克隆出来的树上跑测试（不依赖任何本机开发树）')
for (const r of REPOS) {
  const dir = path.join(root, r.name)
  if (!fs.existsSync(dir)) continue
  for (const t of r.test) {
    const f = resolveIn(dir, t)   // ★ 布局无关：`tests/x.mjs` 与仓根 `x.mjs` 都认
    if (!f) { SKIP(`${r.name}/${t}`, '测试文件不在克隆出来的仓库里（两种布局都没找到）'); continue }
    try {
      const out = execFileSync(process.execPath, [f], { cwd: dir, encoding: 'utf8', timeout: 300000 })
      const line = out.trim().split('\n').filter((l) => /结果|通过/.test(l)).pop() || '(无结果行)'
      check(`${r.name}/${t}`, !/失败/.test(line) || /0 失败/.test(line), line)
      console.log('       ' + line.trim())
    } catch (e) {
      const out = ((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-3).join(' | ')
      check(`${r.name}/${t}`, false, out.slice(0, 200))
    }
  }
}

console.log('\n[5] diag.mjs 在克隆出来的树上能否运行（它要能找到 dsh-muv-table）')
{
  const dir = path.join(root, 'dsh-muv-engine')
  if (!fs.existsSync(dir)) {
    SKIP('diag.mjs 可运行', '仓库未克隆成功（见上）')
  } else if (fs.existsSync(path.join(dir, 'diag.mjs'))) {
    try {
      execFileSync(process.execPath, ['diag.mjs'], { cwd: dir, encoding: 'utf8', timeout: 180000 })
      check('diag.mjs 可运行', true)
    } catch (e) {
      const out = ((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-4).join(' | ')
      // 单项失败不算致命（比如服务器没起），但必须能跑到输出
      const ran = /服务器|预设|结论/.test(e.stdout || '')
      check('diag.mjs 可运行（至少产出报告）', ran, out.slice(0, 220))
    }
  } else {
    check('diag.mjs 在仓库里', false)
  }
}

console.log('\n[6] 清理')
try { fs.rmSync(root, { recursive: true, force: true }); console.log('  已删除 ' + root) }
catch (e) { console.log('  清理失败（可手动删）: ' + root) }

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败${skip ? ', ' + skip + ' 跳过' : ''} ===`)
if (skip) {
  console.log('跳过的项（环境不具备，不是通过也不是失败）：')
  for (const s of skips) console.log('   SKIP ' + s)
}
if (fail) console.log('HANDOFF 的恢复步骤存在未验证通过的部分，请据此修正文档。')
else if (skip) console.log('有项被跳过 ⇒ 本轮**不能**当作"恢复步骤已验证通过"，请看上面的 SKIP 原因。')
process.exit(fail ? 1 : 0)
