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
  { name: 'dsh-muv-engine', branch: 'master', test: ['test-status-cascade.mjs', 'test-client-render.mjs'] },
  { name: 'dsh-muv-table', branch: 'master', test: ['test-png-card.mjs', 'test-muv-parser.mjs', 'test-preset-resolve.mjs'] },
  { name: 'dsh-tavern-v2', branch: 'main', test: [] },
]

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

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
    git(['clone', '--quiet', '--branch', r.branch, '--depth', '1',
      `https://github.com/chen731215-dev/${r.name}.git`, dir], root)
    const head = git(['rev-parse', '--short', 'HEAD'], dir).trim()
    check(`克隆 ${r.name}`, fs.existsSync(path.join(dir, 'package.json')), '缺少 package.json')
    console.log(`       HEAD ${head}  分支 ${r.branch}`)
  } catch (e) {
    check(`克隆 ${r.name}`, false, String(e.message).slice(0, 140))
  }
}

console.log('\n[2] 克隆出来的内容是否够跑（HANDOFF 承诺的关键文件）')
const need = [
  ['dsh-muv-engine', ['lib/index.js', 'lib/client.js', 'lib/status-cascade.js', 'diag.mjs', 'HANDOFF.md', 'test-status-cascade.mjs', 'test-client-render.mjs']],
  ['dsh-muv-table', ['lib/index.js', 'lib/muv-parser.js', 'lib/png-card.js', 'lib/panel.html', 'test-png-card.mjs']],
  ['dsh-tavern-v2', ['lib/index.js', 'lib/client.manager.bundle.js', 'cordis.patch.yml']],
]
for (const [repo, files] of need) {
  const dir = path.join(root, repo)
  if (!fs.existsSync(dir)) { check(repo + ' 文件清单', false, '仓库未克隆成功'); continue }
  const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)))
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
    const f = path.join(dir, t)
    if (!fs.existsSync(f)) { check(`${r.name}/${t}`, false, '测试文件不在仓库里'); continue }
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
  if (fs.existsSync(path.join(dir, 'diag.mjs'))) {
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

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
if (fail) console.log('HANDOFF 的恢复步骤存在未验证通过的部分，请据此修正文档。')
process.exit(fail ? 1 : 0)
