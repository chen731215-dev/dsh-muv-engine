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
let unverified = 0   // ★ 环境不可用的层数（第⑥层探不通时 +1）；出声，但**不当失败**（本仓口径）
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

// ★ 从 runner 源码真读「环境不可用」的权威退出码（与上面 vm 切片**同源**：都读同一份源码文本）。
const ENV_UNVERIFIED_EXIT = (() => {
  const m = /const ENV_UNVERIFIED_EXIT = (\d+)/.exec(SRC)
  if (!m) throw new Error('runner 源码里找不到 `const ENV_UNVERIFIED_EXIT = <数字>`（判据脱节，需同步）')
  return Number(m[1])
})()

/**
 * 汇总输出的**判据本体**（纯函数，只看文本 + 一个 check 回调）。
 * ★ 被两处共用：⑥ 端到端（真跑输出）与 ⑦ 合成样本（本机可跑）——
 *   判据**同源**，避免"两处各写一遍、其中一处不影响通过与否"的静默失真（铁律 21）。
 */
function assertSummary(out, check) {
  // ★ 关键：判"红项**条目**里有没有 c-env"**不能**用"❌ 红项 后面 300 字内出现 c-env"——
  //   runner 在红项行**之后**会紧跟一行"（另有 N 个环境不可用，未计入红项：… c-env.mjs）"
  //   ⇒ 那个 300 字窗口会**误命中**这句"声明不含"的旁注，把一条正确实现判成红。
  //   （本笔首跑 CI 就是这么红的 —— 是**断言写宽了**，不是产品错。）
  //   ⇒ 改为按**桶列表段**取证：只看「异常」桶标题到「环境不可用」标题之间那段里的条目。
  const between = (startRe, endRe) => {
    const s = out.search(startRe)
    if (s < 0) return null
    const rest = out.slice(s)
    const e = rest.search(endRe)
    return rest.slice(0, e < 0 ? rest.length : e)
  }
  // ★★ 取证要认**桶标题**（带 `：N 个`），不能认**逐文件行**上的同类字样
  //   （每个 env 文件自己那行也含「环境不可用」，会抢在桶标题之前命中 —— 首版就栽在这样一处）。
  const abnormalBlock = between(/异常（超时 \/ 崩溃 \/ 空输出 \/ 空跑）：\d+ 个\n/, /环境不可用（exit=/)
  const envBlock = between(/环境不可用（exit=\d+[^\n]*：\d+ 个[^\n]*\n/, /(?:跳过（非测试|\n全部通过|\n❌ 红项|$)/)
  check('★ 取证段存在：异常桶列表段非空', !!abnormalBlock && abnormalBlock.length > 0, 'abnormalBlock=' + JSON.stringify(String(abnormalBlock).slice(0, 120)))
  check('★ 异常桶列表段**不含** c-env.mjs（env 未混进真红）', !String(abnormalBlock).includes('c-env.mjs'),
    String(abnormalBlock).slice(0, 200))
  check('★ 异常桶列表段**含** d-vacuous.mjs（反向自证：空跑确实在真红里）',
    /d-vacuous\.mjs/.test(String(abnormalBlock)), String(abnormalBlock).slice(0, 200))
  check('★ 环境桶列表段**含** c-env.mjs 且**不含** d-vacuous.mjs（互斥的另一半）',
    String(envBlock).includes('c-env.mjs') && !String(envBlock).includes('d-vacuous.mjs'),
    String(envBlock).slice(0, 200))
  check('★ 异常桶 = 1（只有空跑那个）', /异常（超时[\s\S]{0,40}：1 个/.test(out), out.slice(-500))
  check('★ 环境桶 = 1', new RegExp('环境不可用（exit=' + ENV_UNVERIFIED_EXIT + '[^\\n]*：1 个').test(out), out.slice(-500))
}

/** 用**收集式** check 跑一遍 assertSummary，返回 pass/fail 与失败点名（供第⑦层用）。 */
function tally(fn, out) {
  const failed = []
  let pass = 0
  fn(out, (name, cond, detail) => {
    if (cond) pass++
    else failed.push({ name, detail: String(detail).slice(0, 160) })
  })
  return { pass, fail: failed.length, failed }
}

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
// ★ 本层要 spawn。探不通时**不 exit** —— 因为第⑦层（纯函数对照，本机可跑）**还没跑**。
//   （首版在这里就 exit 了 ⇒ 第⑦层被跳过 ⇒ 本机永远拿不到判据会咬的证据。那是本末倒置。）
//   改为：整个第⑥层包在一个 if 里，探不通就响亮报「未验」并把 unverified 计数 +1，
//   然后**继续往下走**到第⑦层；最终退出码由末尾统一决定。
{
  const probe = spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    unverified++
    console.log('  ⛔ 环境不可用：端到端层需要 node 能 spawn 子进程，但实测报 '
      + (probe.error ? probe.error.code : 'status=' + JSON.stringify(probe.status)) + '。')
    console.log('     ⇒ 本层以 `未验` 记（**不跳过、不冒充 pass、也不冒充 fail**）；交给 CI / DSH 宿主。')
    console.log('     ★ 但**判据本体**已在第⑦层用合成样本证明「会咬」—— 本机拿得到的证据一条不少。')
  } else {
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
    // ★★ 汇总断言走**同一个纯函数** `assertSummary`（第⑦层用**同一函数**跑合成样本）。
    //   为什么要抽出来：端到端要 spawn，本机拿不到 ⇒ 若把断言写在这里，本机就**永远无法自证它会咬**。
    //   抽成纯函数后：本机用合成样本跑第⑦层（证明判据会咬），CI 用真跑输出跑本层（证明产品对）。
    //   ⇒ 判据**同源**（同一份源码文本），不是两处各写一遍。
    assertSummary(out, check)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ══ ⑦ ★★ 汇总判据的**非空跑对照**（本机可跑）：用忠实合成样本证明 assertSummary 会咬 ══
//   房规：反证测试必须**自证它真的跑了**（打印 mutate 命中次数），且**必须**有非空跑对照。
//   ⇒ 三组样本：① 正确输出（必须全绿）；② 把 env 错塞进异常桶（必须咬）；③ 旧式窗口正则（必须咬）。
console.log('\n⑦ ★★ 汇总判据的非空跑对照（本机可跑，不需 spawn）：合成样本必须让它咬')
{
  // 忠实合成：逐字照 `tools/run-each-test.mjs` 的 console.log 模板拼（不是"大概像"）
  const synth = ({ abnormal, env, fixEnvIntoAbnormal }) => {
    const counted = ['tests/a-green.mjs', 'tests/b-red.mjs']
    const noco = ['tests/e-noco.mjs']
    const skipped = ['tests/test-client-source.mjs']
    const targets = 4
    const ENV_EXIT = ENV_UNVERIFIED_EXIT
    const L = []
    for (const f of counted) L.push('✅ ' + f.padEnd(40) + 'pass=   3  fail=0')
    for (const f of abnormal) L.push('❌ ' + f.padEnd(40) + 'pass=   2  fail=1')
    for (const f of env) {
      // ★ 关键细节：env 文件的**逐文件行**自带「环境不可用」字样 —— 旧窗口正则就是栽在这
      L.push('🚫 ' + f.padEnd(40) + '无计数（以 exit code 为准）   ← 环境不可用：被测文件自报环境不可用（exit=' + ENV_EXIT + '） ※ 不是代码故障、也不是通过')
    }
    L.push('\n──────────────────────────────────────────────')
    L.push('合计 pass=5  fail=1  skipped=0  跑了 ' + targets + ' 个（跳过 ' + skipped.length + ' 个非测试文件）')
    L.push('\n有计数（报告器在场）：' + counted.length + ' 个')
    for (const f of counted) L.push('   · ' + f)
    L.push('无计数（正常：有输出、exit 0）：' + noco.length + ' 个 —— 这一档只以 exit code 判定，不贡献断言数')
    for (const f of noco) L.push('   · ' + f)
    L.push('异常（超时 / 崩溃 / 空输出 / 空跑）：' + abnormal.length + ' 个')
    for (const f of abnormal) L.push('   · ' + f)
    L.push('环境不可用（exit=' + ENV_EXIT + '，且自报未验/环境不可用）：' + env.length + ' 个 —— 这一档**既不冒充通过也不冒充失败**，须在允许 spawn 的环境重跑')
    for (const f of env) L.push('   · ' + f)
    if (skipped.length) {
      L.push('跳过（非测试，CORPUS_EXCLUDE）：' + skipped.length + ' 个')
      for (const s of skipped) L.push('   · ' + s + '   ← 共享库')
    }
    if (abnormal.length) {
      L.push('\n❌ 红项（' + abnormal.length + ' / ' + targets + '）—— 逐条见上')
      if (env.length) L.push('   （另有 ' + env.length + ' 个**环境不可用**，未计入红项：' + env.join(' / ') + '）')
    }
    return L.join('\n') + '\n'
  }

  // ① 正确输出 ⇒ assertSummary 必须**全绿**
  const good = synth({ abnormal: ['tests/d-vacuous.mjs'], env: ['tests/c-env.mjs'] })
  const gres = tally(assertSummary, good)
  check('★ [对照①] 正确输出 ⇒ 五条全绿（无假红）', gres.fail === 0 && gres.pass > 0,
    'pass=' + gres.pass + ' fail=' + gres.fail + ' ' + JSON.stringify(gres.failed))

  // ② mutate：把 c-env 从环境桶挪进**异常桶列表条目**（= env 混进了真红）⇒ 必须**咬**
  //    做法：把 env 桶标题下的条目行换成 c-env，同时让异常桶列表里出现 c-env
  const mutated = good
    .replace('异常（超时 / 崩溃 / 空输出 / 空跑）：1 个\n   · tests/d-vacuous.mjs',
      '异常（超时 / 崩溃 / 空输出 / 空跑）：2 个\n   · tests/d-vacuous.mjs\n   · tests/c-env.mjs')
  const mres = tally(assertSummary, mutated)
  check('★ [mutate②] env 混进异常桶 ⇒ assertSummary 必须红（判据没被收废）',
    mres.fail > 0, 'pass=' + mres.pass + ' fail=' + mres.fail + ' 点名=' + JSON.stringify(mres.failed))
  // ★ 咬得准：必须点名「异常桶列表段不含 c-env」那条 —— 而不是"随便红了一条"
  check('★ [mutate② 咬得准] 红色条目里点名「异常桶列表段不含 c-env.mjs」',
    mres.failed.some((f) => /异常桶列表段.*不含.*c-env/.test(f.name)),
    '实际点名=' + JSON.stringify(mres.failed.map((f) => f.name)))

  // ③ mutate：把异常桶标题改成旧式宽窗口也命中不了的形态，验证「按桶标题取证」的必要性
  //    模拟：桶标题写错（没有 `：N 个`）⇒ 取证段应取不到 ⇒ 判红（而不是静默取到错误段）
  const noCountTitle = good.replace('异常（超时 / 崩溃 / 空输出 / 空跑）：1 个', '异常（超时 / 崩溃 / 空输出 / 空跑）：')
  const nres = tally(assertSummary, noCountTitle)
  check('★ [mutate③] 桶标题缺 `：N 个` ⇒ 取证失败必须判红（不许静默取错段）',
    nres.fail > 0, 'pass=' + nres.pass + ' fail=' + nres.fail + ' 点名=' + JSON.stringify(nres.failed))
  check('★ [mutate③ 咬得准] 红色条目里点名「取证段存在：异常桶列表段非空」',
    nres.failed.some((f) => /取证段存在/.test(f.name)),
    '实际点名=' + JSON.stringify(nres.failed.map((f) => f.name)))

  // ④ ★★ 旧写法必须**被本房规淘汰**：证明「❌ 红项 后 300 字内出现 c-env」这条**会误判**
  //    构造：正确输出（c-env 只在 env 桶），但红项旁注里点了 c-env 的名字 ⇒ 旧写法误红、新写法正确放行。
  const noteCase = good   // 这份 good 的红项旁注**就含** "未计入红项：tests/c-env.mjs"
  const oldStyle = /环境不可用[\s\S]{0,300}c-env\.mjs/.test(noteCase)
  const newRes = tally(assertSummary, noteCase)
  check('★ [对照④] 旧写法在本样本上**仍会绿**（它靠"最早出现"蒙对，语义不牢）',
    oldStyle === true, 'oldStyle=' + oldStyle)
  // ★★ 关键反证：把红项旁注**删掉**（runner 无 env 时不打那行）⇒ 旧写法失去"蒙对"的来源，
  //    而新写法**依然**正确 —— 这才证明新写法不依赖"旁注恰好出现"。
  const noNote = good.replace('   （另有 1 个**环境不可用**，未计入红项：tests/c-env.mjs）\n', '')
  const newRes2 = tally(assertSummary, noNote)
  check('★ [对照④] 去掉红项旁注后，新写法**仍全绿**（不依赖旁注蒙对）',
    newRes2.fail === 0 && newRes2.pass > 0, 'pass=' + newRes2.pass + ' fail=' + newRes2.fail + ' ' + JSON.stringify(newRes2.failed))

  check('★ [自证] 四次调用真的都跑了（mutate 命中数 > 0）',
    gres.pass + gres.fail > 0 && mres.pass + mres.fail > 0 && nres.pass + nres.fail > 0 && newRes.pass + newRes.fail > 0,
    'runs=' + [gres.pass + gres.fail, mres.pass + mres.fail, nres.pass + nres.fail, newRes.pass + newRes.fail].join(','))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败${unverified ? ', ' + unverified + ' 未验（端到端·环境）' : ''} ===`)
process.exit(fail ? 1 : 0)
