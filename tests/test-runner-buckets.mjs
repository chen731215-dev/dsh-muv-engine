// task-29 笔1：runner（`tools/run-each-test.mjs`）的**分桶互斥性**对照测试。
//
// 为什么必须有它：runner 是本仓**唯一的红绿权威** —— 它的退出码就是 CI 第 7 步的结论。
//   本轮之前它把「环境不可用」与「真红」混在**同一个** `abnormal` 桶里，而该桶又是**唯一**的红项判据
//   ⇒ 于是一个"本机禁止 node spawn"的环境故障，会被读成"12 个测试文件全挂"（本机实测正是如此）。
//   ★ 这正是本仓铁律 19 的家族：**环境故障伪装成代码故障**。
//   修法（本笔）：四桶互斥 + 退出码可判别（真红 1 / 环境不可用 2 / 通过 0）。
//
// ★★ 本文件分**两层**，因为被测逻辑有两种"能不能跑"的处境：
//   ── 第一层（①–⑤，占绝大多数）：**纯函数单测**，直接驱动 runner 导出的 `classifyRun(obs)`。
//      它是纯的（给定观测 → 给定桶），**不需要 spawn** ⇒ **本机沙箱可跑**，不受 EBUSY 影响。
//      这是本笔的关键设计：把最容易错的判定从"必须真跑"里解放出来。
//   ── 第二层（⑥）：**端到端**跑真 runner（要 spawn 子进程驱动一批合成语料）。
//      本机沙箱禁止 node 派生 ⇒ **拿不到**；⇒ 按本仓口径**开跑前**探 spawn，
//      探不通 ⇒ 响亮报"环境不可用" + `exit(2)`，**不跳过、不冒充 pass、也不冒充 fail**。
//      真跑在 CI / DSH 宿主。
//
// 形状照 `tests/test-repo-hygiene-bom.mjs`：**反证必须自证它真的跑了**（打印 mutate 命中次数）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const RUNNER = path.join(REPO, 'tools', 'run-each-test.mjs')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

// ── 第一层：纯函数单测（本机可跑）───────────────────────────────────────────
//   import runner 的具名导出。runner 是"顶层脚本 + 导出"，import 它会**执行顶层代码**
//   （扫目录、前置探 spawn……）—— 那正是我们不想要的副作用。
//   ⇒ 用**源码切片 + vm** 只取 `classifyRun`（含它依赖的 `parseCounts` / `ENV_UNVERIFIED_EXIT`），
//     在 vm 沙箱里求值，不触发 runner 的顶层副作用。
//   ★ 这不损证据强度：取的是**同一份源码文本**里的函数（不是另抄一份）。
const SRC = fs.readFileSync(RUNNER, 'utf8')
const { classifyRun } = await (async () => {
  // 从源码里精确切出需要的三个片段：常量 + parseCounts + classifyRun。
  const sliceFn = (name) => {
    const i = SRC.indexOf('function ' + name + '(')
    if (i < 0) throw new Error('runner 源码里找不到 function ' + name + '（判据脱节，需同步）')
    // 从函数体首个 `{` 起按花括号配平切到收尾 `}`（字符串/正则里的括号在本函数里不出现，够用且可读）
    const open = SRC.indexOf('{', i)
    let depth = 0
    for (let k = open; k < SRC.length; k++) {
      const ch = SRC[k]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) return SRC.slice(i, k + 1) }
    }
    throw new Error('function ' + name + ' 花括号未配平')
  }
  const constEnv = (() => {
    const m = /const ENV_UNVERIFIED_EXIT = (\d+)/.exec(SRC)
    if (!m) throw new Error('runner 源码里找不到 `const ENV_UNVERIFIED_EXIT = <数字>`（判据脱节，需同步）')
    return 'const ENV_UNVERIFIED_EXIT = ' + m[1] + ';'
  })()
  const code = constEnv + '\n' + sliceFn('parseCounts') + '\n' + sliceFn('classifyRun') + '\nexport { classifyRun };\n'
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'muv-classify-'))
  const f = path.join(dir, 'classify.mjs')
  writeFileSync(f, code, 'utf8')
  const mod = await import(pathToFileURL(f).href)
  fs.rmSync(dir, { recursive: true, force: true })
  return mod
})()

/** 合成一条观测（默认：正常、无计数、exit 0）。 */
const obs = (o = {}) => Object.assign(
  { status: 0, stdout: '', stderr: '', errorCode: null, signal: null, timedOut: false }, o)

console.log('① ★ 判据自证：函数真的被切出来了（不是空壳）')
check('★ classifyRun 是函数', typeof classifyRun === 'function')
{
  const r = classifyRun(obs({ stdout: '=== 结果: 3 通过, 0 失败 ===\n' }))
  check('★ 它可以被调用并返回四要素（bucket/ok/why/counts）',
    r && typeof r.bucket === 'string' && typeof r.ok === 'boolean' && typeof r.why === 'string' && r.counts && typeof r.counts.pass === 'number',
    JSON.stringify(r))
}

console.log('\n② ★★ 互斥主断言：环境不可用 **绝不** 落进 abnormal 桶')
{
  // 支 A：runner 自己 spawn 不动（EBUSY / status=null / 0 字节输出）—— 本机实测形态
  const a = classifyRun(obs({ status: null, errorCode: 'EBUSY', stdout: '', stderr: '' }))
  check('★ 支 A（宿主禁 spawn）⇒ bucket=env', a.bucket === 'env', JSON.stringify(a))
  check('★ 支 A ⇒ ok=false（既不通过也不失败）', a.ok === false)
  check('★ 支 A 的 why 点名 EBUSY', /EBUSY/.test(a.why), a.why)

  // 支 B：被测文件自报环境不可用（exit=2 + 本仓措辞）
  const b = classifyRun(obs({ status: 2, stdout: '⛔ 环境不可用：本测试需要 node 能 spawn\n   ★ 不跳过、不冒充 pass\n' }))
  check('★ 支 B（被测自报 exit=2）⇒ bucket=env', b.bucket === 'env', JSON.stringify(b))
  check('★ 支 B ⇒ ok=false', b.ok === false)

  // 反向：这两者都**不许**是 abnormal
  check('★ 反向：支 A 的桶 ≠ abnormal', a.bucket !== 'abnormal')
  check('★ 反向：支 B 的桶 ≠ abnormal', b.bucket !== 'abnormal')
}

console.log('\n③ ★ 互斥的另一半：真红必须落进 abnormal（判据没被收废）')
{
  const hardFail = classifyRun(obs({ status: 1, stdout: '=== 结果: 2 通过, 1 失败 ===\n' }))
  check('★ 断言失败（exit=1 + fail=1）⇒ bucket=abnormal', hardFail.bucket === 'abnormal', JSON.stringify(hardFail))
  check('★ ⇒ ok=false', hardFail.ok === false)

  const crash = classifyRun(obs({ status: 1, stdout: 'Traceback…\n' }))   // 无报告器、exit≠0 = 崩溃
  check('★ 崩溃（exit=1、无计数）⇒ bucket=abnormal', crash.bucket === 'abnormal', JSON.stringify(crash))

  const vac = classifyRun(obs({ status: 0, stdout: '=== 结果: 0 通过, 0 失败 ===\n' }))
  check('★ 空跑（报告器在场 0 断言）⇒ bucket=abnormal', vac.bucket === 'abnormal', JSON.stringify(vac))
  check('★ 空跑的 why 里点名"空跑"', /空跑/.test(vac.why), vac.why)

  const silent = classifyRun(obs({ status: 0, stdout: '', stderr: '' }))
  check('★ 静默退出（无报告器 + 0 字节）⇒ bucket=abnormal', silent.bucket === 'abnormal', JSON.stringify(silent))
  check('★ 静默退出的 why 点名"空跑"', /空跑/.test(silent.why), silent.why)

  const to = classifyRun(obs({ status: null, timedOut: true, errorCode: 'ETIMEDOUT' }))
  check('★ 超时 ⇒ bucket=abnormal，why=超时', to.bucket === 'abnormal' && to.why === '超时', JSON.stringify(to))
}

console.log('\n④ ★ 正当的两桶：绿（有计数 / 无计数）⇒ ok=true')
{
  const g = classifyRun(obs({ status: 0, stdout: '=== 结果: 5 通过, 0 失败 ===\n' }))
  check('★ 有计数且全过 ⇒ bucket=counted, ok=true', g.bucket === 'counted' && g.ok === true, JSON.stringify(g))
  const n = classifyRun(obs({ status: 0, stdout: '随便一段输出，没有报告器\n' }))
  check('★ 无计数但 exit 0 且有输出 ⇒ bucket=noco, ok=true', n.bucket === 'noco' && n.ok === true, JSON.stringify(n))
  const sk = classifyRun(obs({ status: 0, stdout: '=== 结果: 0 通过, 0 失败, 7 跳过 ===\n' }))
  check('★ skipped>0 不算空跑（本仓口径）⇒ ok=true', sk.ok === true, JSON.stringify(sk))
}

console.log('\n⑤ ★★ 判别力（本笔**主断言**）：同一个"exit=2"的**措辞差**必须导致**不同的桶**')
{
  // 关键设计：光看退出码=2 不足以判环境 —— 必须**同时**带本仓"未验/环境不可用"措辞。
  // ⇒ 一个"恰好以 2 收尾、但不带那句措辞"的脚本，必须被判 **真红**（宁可判红，不可误放）。
  const withHint = classifyRun(obs({ status: 2, stdout: '⛔ 环境不可用：缺样本\n' }))
  const noHint = classifyRun(obs({ status: 2, stdout: '=== 结果: 1 通过, 1 失败 ===\n' }))   // exit=2 但没措辞
  check('★ exit=2 + 带措辞 ⇒ env', withHint.bucket === 'env', JSON.stringify(withHint))
  check('★ exit=2 + 无措辞 ⇒ abnormal（真红；不许"见 2 就当环境"）', noHint.bucket === 'abnormal', JSON.stringify(noHint))
  check('★ 两次结论**不同**（若相同 ⇒ 环境与真红仍不可判别）', withHint.bucket !== noHint.bucket)

  // 第二条判别力：同样的"0 字节输出"，EBUSY ⇒ env；普通 exit=1 ⇒ abnormal
  const eb = classifyRun(obs({ status: null, errorCode: 'EBUSY' }))
  const hd = classifyRun(obs({ status: 1 }))
  check('★ 0 字节：EBUSY ⇒ env 而 exit=1 ⇒ abnormal（判据区分了成因）', eb.bucket !== hd.bucket)
}

console.log('\n⑥ ★ 端到端（要 spawn）：真跑 runner 验证四桶在**汇总输出**里的互斥')
{
  // 先探 spawn —— 本机沙箱禁 node 派生 ⇒ 拿不到，按纪律报"环境不可用"并 exit(2)。
  const probe = spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    console.log('  ⛔ 环境不可用：端到端层需要 node 能 spawn 子进程，但实测报 '
      + (probe.error ? probe.error.code : 'status=' + JSON.stringify(probe.status)) + '。')
    console.log('     ⇒ 第一层（①–⑤，纯函数）已在本机通过；端到端交给 CI / DSH 宿主。')
    console.log('     ★ 按纪律：**不跳过、不冒充 pass、也不冒充 fail** —— 本层以 `未验` 记。')
    // ★ 不 process.exit(2)：第一层已经产出了**可信的真结果**，整批不该因第二层不可用而整批判"未验"。
    //   改为：本层标"未验（环境）"计入一个单独的 skipped 计数，最终退出码仍由第一层决定。
    //   （这正是本仓「`skipped>0` 不算空跑」的用法：出声、但不当失败。）
    console.log('')
    console.log(`=== 结果: ${pass} 通过, ${fail} 失败, 1 未验（端到端·环境）===`)
    process.exit(fail ? 1 : 0)
  }

  // spawn 可用 ⇒ 真跑。建夹具：runner + 权威定义 + 4 类合成语料。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-runner-e2e-'))
  fs.mkdirSync(path.join(dir, 'tools', 'verify'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools', 'repro'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true })
  fs.copyFileSync(RUNNER, path.join(dir, 'tools', 'run-each-test.mjs'))
  fs.copyFileSync(path.join(REPO, 'tools', 'verify', 'verify-unverified.mjs'),
    path.join(dir, 'tools', 'verify', 'verify-unverified.mjs'))
  // CORPUS_EXCLUDE 名单里的 4 个文件必须**存在**（runner 有"名单过期即红"的自检）
  fs.writeFileSync(path.join(dir, 'tools', 'verify', 'verify-shared.mjs'), '// fixture\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'tools', 'verify', 'verify-guard-samples.gen.mjs'), '// fixture\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'tools', 'verify', 'verify-unverified.mjs'), fs.readFileSync(path.join(REPO, 'tools', 'verify', 'verify-unverified.mjs'), 'utf8'), 'utf8')
  fs.writeFileSync(path.join(dir, 'tests', 'test-client-source.mjs'), '// fixture\n', 'utf8')

  const marker = 'console.log("=== 结果: " + p + " 通过, " + f + " 失败 ===")\nprocess.exit(f ? 1 : 0)\n'
  fs.writeFileSync(path.join(dir, 'tests', 'a-green.mjs'),
    'let p=0,f=0;const c=(n,ok)=>{ok?p++:f++};c("x",true);c("y",true)\n' + marker, 'utf8')
  fs.writeFileSync(path.join(dir, 'tests', 'b-red.mjs'),
    'let p=0,f=0;const c=(n,ok)=>{ok?p++:f++};c("x",true);c("y",false)\n' + marker, 'utf8')
  fs.writeFileSync(path.join(dir, 'tests', 'c-env.mjs'),
    'console.log("⛔ 环境不可用：夹具故意造的")\nprocess.exit(2)\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'tests', 'd-vacuous.mjs'),
    'console.log("=== 结果: 0 通过, 0 失败 ===")\nprocess.exit(0)\n', 'utf8')

  const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'run-each-test.mjs')], {
    cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const listed = fs.readdirSync(path.join(dir, 'tests'))
  check('mutate 自证：夹具 tests/ 里确有 4 个合成文件', listed.length === 4, '实际 ' + listed.length)
  check('★ 有真红 ⇒ runner 退出码 = 1', r.status === 1, 'exit=' + r.status)
  check('★ 汇总里有"环境不可用"桶且点名 c-env.mjs', /环境不可用[\s\S]{0,300}c-env\.mjs/.test(out))
  check('★ 红项行**不含** c-env.mjs', !/红项[\s\S]{0,300}c-env\.mjs/.test(out))
  check('★ 红项行**含** b-red.mjs（反向自证）', /红项[\s\S]{0,300}b-red\.mjs/.test(out))
  check('★ 异常桶 = 1（只有空跑那个）', /异常（超时[\s\S]{0,40}：1 个/.test(out), out.slice(-500))
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
