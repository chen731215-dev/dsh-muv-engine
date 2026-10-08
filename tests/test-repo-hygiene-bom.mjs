// task-18 笔3：卫生门禁「UTF-8 BOM」判据的**非空跑对照测试**（"用坏样本必须报错"）。
//
// 为什么单独一个文件、而不是塞进门禁里：本仓明令（自检三件套那一节）
//   "每个工具都必须自带「用坏样本必须报错」的非空跑对照测试 —— 否则等于没有护栏"。
//   笔1（8ff8e17）只改了门禁、没带测试 ⇒ 被判"无条件 REJECT 的唯一阻塞项"就是这个。
//
// ★ 为什么必须在**临时 git 仓库**里跑，而不是直接对着本仓跑：
//   门禁的 `REPO` 由**它自身的位置**推导（`path.resolve(dirname(import.meta.url), '..')`）
//   ⇒ 要让它检查别的目录，就必须把门禁**复制进那个仓库**再执行。
// ★ 形状照本会话已定的规矩：**反证必须自证它真的跑了**（打印 mutate 命中次数）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const GATE_SRC = path.join(REPO, 'tools', 'check-repo-hygiene.mjs')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/** 建一个临时夹具仓库：把门禁复制进去（连同它 import 的相对路径），再放若干文件。 */
function makeFixture(tag, { bomFile = true, extra = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-hyg-fixture-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.copyFileSync(GATE_SRC, path.join(dir, 'tools', 'check-repo-hygiene.mjs'))
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n', 'utf8')
  let bomHits = 0
  if (bomFile) {
    fs.writeFileSync(path.join(dir, 'probe_with_bom.txt'), '\uFEFFhello\n', 'utf8')
    bomHits++
  }
  for (let i = 0; i < extra; i++) fs.writeFileSync(path.join(dir, 'plain' + i + '.txt'), 'plain ' + i + '\n', 'utf8')
  execFileSync('git', ['init', '--quiet', '.'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return { dir, bomHits }
}

function runGate(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'check-repo-hygiene.mjs')], {
    cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

console.log('① ★ 反证：带 BOM 的**已跟踪**文件 ⇒ 必须 exit=1 且**点名该路径**')
{
  const { dir, bomHits } = makeFixture('bom')
  check('mutate 自证：夹具里确实写入了 1 个带 BOM 的文件（命中次数 = 1）', bomHits === 1, '命中 ' + bomHits + ' 次')
  const raw = fs.readFileSync(path.join(dir, 'probe_with_bom.txt'))
  check('★ mutate 自证：该文件首 3 字节 = 239,187,191（BOM 真的写进去了）',
    [...raw.subarray(0, 3)].join(',') === '239,187,191', [...raw.subarray(0, 3)].join(','))
  const ls = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' })
  check('★ 该文件**已被跟踪**（在 git ls-files 里）', ls.includes('probe_with_bom.txt'))
  const r = runGate(dir)
  check('★ exit=1（坏样本必须报错）', r.code === 1, 'exit=' + r.code)
  check('★ 输出**点名** probe_with_bom.txt', r.out.includes('probe_with_bom.txt'), r.out.slice(0, 200))
  check('★ 输出给出 kind = form/utf8-bom', r.out.includes('form/utf8-bom'))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('\n② ★ 非空跑下限：小仓库 ⇒ 必须因"只检查了 N 个 blob 头"报红（不许安静通过）')
{
  const { dir } = makeFixture('floor', { bomFile: false })   // 只有 2 个文件，远小于下限 50
  const r = runGate(dir)
  check('★ exit=1（下限未达 ⇒ 不许"没报 BOM"当通过）', r.code === 1, 'exit=' + r.code)
  check('★ 输出点名 `(非空跑下限)` 并报出实际检查数', r.out.includes('(非空跑下限)') && /只检查了 \d+ 个 blob 头/.test(r.out), r.out.slice(0, 240))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('\n③ ★ 反向：足够的文件 + 无 BOM ⇒ 既不误报 BOM、也不触下限（判据没被收废）')
{
  const { dir } = makeFixture('clean', { bomFile: false, extra: 60 })
  const r = runGate(dir)
  check('★ exit=0（62 个文件 ≥ 下限 50，且无 BOM）', r.code === 0, 'exit=' + r.code + '  out=' + r.out.slice(0, 240))
  check('★ 输出里**没有** form/utf8-bom（不误报）', !r.out.includes('form/utf8-bom'))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('\n④ ★ 判别力：同一个夹具里"去掉 BOM"后，**不再点名**探针文件（证明命中是特异的，不是凡文件都报）')
{
  const { dir } = makeFixture('strip', { bomFile: false, extra: 60 })
  // 造带 BOM 的，再逐字去掉 → 用 mutate 命中计数自证改写生效
  const p = path.join(dir, 'probe2.txt')
  fs.writeFileSync(p, '\uFEFFx\n', 'utf8')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  let before = runGate(dir)
  check('★ 加 BOM 后：报红并点名 probe2.txt', before.code === 1 && before.out.includes('probe2.txt'))
  const buf = fs.readFileSync(p)
  const hits = (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) ? 1 : 0
  check('mutate 自证：待去掉的 BOM 命中次数 = 1', hits === 1, '命中 ' + hits + ' 次')
  fs.writeFileSync(p, buf.subarray(3))
  execFileSync('git', ['add', '-A'], { cwd: dir })
  const after = runGate(dir)
  check('★ 去掉 BOM 后：exit=0 且**不再**点名 probe2.txt', after.code === 0 && !after.out.includes('probe2.txt'),
    'exit=' + after.code + '  out=' + after.out.slice(0, 200))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
