// 发布验证门禁 —— 抓住两类「看起来成功了」的失败。
//
// 为什么需要：这个项目踩过两次发布相关的陷阱，两次都是**静默**的：
//   ① `npm publish` 打印成功（退出码 0）但 registry 还没传播完 —— 只看退出码会以为发好了；
//   ② `npm publish` 打包的是**工作区文件**，不是 git 提交 —— 工作区里有半成品时，
//      会把一个从未验证过的版本发出去，而 npm 照样打印成功（HANDOFF PC-0）。
// 另外还抓第三类：包里**少了关键文件**（`files` 字段写漏），装上去才发现。
//
// 用法：
//   node verify-release.mjs pre                      # 发布前：工作区干净 + HEAD + 包内容
//   node verify-release.mjs pre --expect <sha>       # 追加校验 HEAD 必须等于已验过的提交
//   node verify-release.mjs post 0.3.8 0.2.11 2.4.2  # 发布后：registry 真的能取到、包内容对
//
// 退出码非 0 = 门禁未通过。**pre 必须全绿才允许 publish。**

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REPOS = [
  { dir: 'C:\\dsh-muv-engine', pkg: 'dsh-muv-engine', must: ['lib/client.js', 'lib/index.js', 'lib/regex-engine.js', 'lib/status-cascade.js'] },
  { dir: 'C:\\dsh-muv-table', pkg: 'dsh-muv-table', must: ['lib/index.js', 'lib/muv-parser.js', 'lib/png-card.js', 'lib/initvar-parser.js'] },
  { dir: 'C:\\dsh-tavern-v2', pkg: 'dsh-tavern', must: ['lib/index.js', 'lib/client.manager.bundle.js'] },
]

const TMP = path.join(os.tmpdir(), 'muv-release-check')
mkdirSync(TMP, { recursive: true })

/**
 * 跑一条命令并把 stdout 收进文件（用 fd 重定向而不是管道：孙进程也能继承）。
 *
 * ⚠ Windows 坑：`execFileSync('npm.cmd', …)` **不能**直接执行 —— `.cmd`/`.bat` 必须
 * 经过 `cmd.exe /c`，否则 spawn 就失败，而且失败时 `e.status` 是 undefined、
 * 输出文件是空的，看起来像「命令跑了但没有输出」。第一版就是这样，
 * 14 条断言全红而错误信息一个字都没有。所以这里显式包一层，并把 `e.message` 也带上。
 */
function run(cmd, args, opts = {}) {
  const tag = (opts.tag || 'cmd') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
  const outFile = path.join(TMP, tag + '.out')
  const errFile = path.join(TMP, tag + '.err')
  const isWinScript = /\.(cmd|bat)$/i.test(cmd)
  const realCmd = isWinScript ? (process.env.ComSpec || 'cmd.exe') : cmd
  const realArgs = isWinScript ? ['/c', cmd, ...args] : args
  let code = 0
  let spawnError = ''
  try {
    execFileSync(realCmd, realArgs, {
      cwd: opts.cwd,
      stdio: ['ignore', openSync(outFile, 'w'), openSync(errFile, 'w')],
    })
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1
    spawnError = e.message || String(e)
  }
  const out = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
  const err = (existsSync(errFile) ? readFileSync(errFile, 'utf8') : '') + (spawnError ? '\n[spawn] ' + spawnError : '')
  return { code, out, err }
}

const git = (dir, args) => run('git', ['-C', dir, ...args], { tag: 'git' })

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const mode = process.argv[2]
if (mode === 'pre') {
  const expectIdx = process.argv.indexOf('--expect')
  const expect = expectIdx > 0 ? process.argv[expectIdx + 1] : null

  console.log('=== 发布前（pre） ===')
  for (const r of REPOS) {
    console.log('\n--- ' + r.pkg + ' ---')
    if (!existsSync(r.dir)) { check(r.pkg + ': 目录存在', false, r.dir); continue }

    const st = git(r.dir, ['status', '--porcelain'])
    const dirty = st.out.trim()
    // PC-0：npm publish 打包的是工作区，不是提交。工作区脏 = 可能把半成品发出去。
    check(r.pkg + ': 工作区干净（PC-0）', dirty === '', dirty.split('\n').slice(0, 4).join(' | '))

    const head = git(r.dir, ['rev-parse', 'HEAD']).out.trim()
    console.log('       HEAD = ' + head.slice(0, 8))
    if (expect) check(r.pkg + ': HEAD == 已验证的提交', head.startsWith(expect), '期望 ' + expect + ' 实际 ' + head.slice(0, 8))

    const unpushed = git(r.dir, ['log', '--oneline', 'origin/master..HEAD']).out.trim()
    check(r.pkg + ': 没有未推送的提交（换机可恢复）', unpushed === '', unpushed.split('\n').length + ' 笔未推送')

    // 包内容：dry-run 打包并核对关键文件在不在
    const pk = run('npm.cmd', ['pack', '--dry-run', '--json'], { cwd: r.dir, tag: 'pack' })
    let files = []
    let version = '?'
    try {
      const json = JSON.parse(pk.out.slice(pk.out.indexOf('[')))
      files = (json[0] && json[0].files || []).map((f) => f.path)
      version = json[0] && json[0].version
    } catch (_) { /* 解析失败下面会报 */ }
    console.log('       version = ' + version + '  文件数 = ' + files.length)
    check(r.pkg + ': npm pack 能解析出文件清单', files.length > 0, pk.err.slice(0, 200))
    for (const m of r.must) {
      check(r.pkg + ': 包内含 ' + m, files.includes(m))
    }
  }
  console.log(`\n=== pre 门禁: ${pass} 通过, ${fail} 失败 ===`)
  console.log(fail ? '**不允许发布** —— 先修到全绿。' : '可以发布。')
  process.exit(fail ? 1 : 0)
}

if (mode === 'post') {
  const versions = {
    'dsh-muv-engine': process.argv[3],
    'dsh-muv-table': process.argv[4],
    'dsh-tavern': process.argv[5],
  }
  console.log('=== 发布后（post） ===')
  const work = path.join(TMP, 'install-' + Date.now().toString(36))
  mkdirSync(work, { recursive: true })
  for (const r of REPOS) {
    const want = versions[r.pkg]
    console.log('\n--- ' + r.pkg + '@' + want + ' ---')
    if (!want) { check(r.pkg + ': 给了期望版本号', false, '缺少参数'); continue }

    // ⚠ 判存在性**不要**用 `npm view` / `npm pack <pkg>@<ver>`：它们读的是 packument，
    //    而 packument 在发布后**会返回旧缓存**。实测（2026-09-20）：publish 明明成功，
    //    `npm view <pkg> versions` 的列表里却没有新版本（它还自己打印 `cache revalidated`），
    //    `npm pack <pkg>@<ver>` 直接报 ETARGET —— 只看这两条会得出「发布失败」的**错误结论**。
    //    第二次 publish 才暴露真相：registry 回「cannot publish over the previously published
    //    versions: <ver>」，即版本其实已经在上面了。
    //    权威判据是**直接取 tarball**：URL 由包名 + 版本唯一决定，没有 packument 那层缓存。
    const url = 'https://registry.npmjs.org/' + r.pkg + '/-/' + r.pkg + '-' + want + '.tgz'
    const head = run('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '40', url], { tag: 'curl' })
    const httpCode = head.out.trim()
    check(`${r.pkg}@${want}: tarball 可直接取到（HTTP 200）`, httpCode === '200',
      'HTTP ' + httpCode + ' ' + head.err.slice(0, 120))

    const tgz = path.join(work, r.pkg + '-' + want + '.tgz')
    run('curl.exe', ['-s', '-L', '--max-time', '90', '-o', tgz, url], { tag: 'get' })
    const size = existsSync(tgz) ? readFileSync(tgz).length : 0
    check(`${r.pkg}@${want}: tarball 下载成功`, size > 1000, size + ' 字节')

    // ⚠ Windows 的 tar 会把 `C:\...` 当成远程主机名（"Cannot connect to C: resolve failed"），
    //    因此凡是传绝对路径都必须加 --force-local。
    const list = run('tar.exe', ['-tzf', tgz, '--force-local'], { tag: 'tar' })
    const files = list.out.split('\n').map((s) => s.trim().replace(/^package\//, '')).filter(Boolean)
    check(`${r.pkg}@${want}: tarball 可解出文件列表`, files.length > 0, list.err.slice(0, 160))
    for (const m of r.must) {
      check(`${r.pkg}@${want}: 发布出来的包内含 ${m}`, files.includes(m))
    }
  }
  try { rmSync(work, { recursive: true, force: true }) } catch (_) {}
  console.log(`\n=== post 门禁: ${pass} 通过, ${fail} 失败 ===`)
  process.exit(fail ? 1 : 0)
}

console.log('用法: node verify-release.mjs pre [--expect <sha>]  |  node verify-release.mjs post <engineVer> <tableVer> <tavernVer>')
process.exit(2)
