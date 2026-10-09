#!/usr/bin/env node
/**
 * 逐文件跑测试（**这就是 `npm test`**），最后给一张汇总表。
 *
 * 口径照抄 dsh-tavern-v2 的 tools/run-each-test.mjs，按本仓现实做了四处适配
 * （每一处都是实测踩出来的，见下方标注）：
 *   ① 本仓这批脚本**绝大多数不是 node:test**，而是自带的 `check()` 报告器
 *      （`  OK   <名>` / `  FAIL <名>`，收尾打 `=== 结果: N 通过, M 失败 ===` 或 `=== 断言: … ===`）。
 *      所以这里**直接 `node <文件>`**（不是 `node --test`），**以 exit code 为准**，
 *      并同时认三种计数：`# pass N` / `ℹ pass N` / 本仓原生摘要。
 *   ② **空跑即失败**（`❔`）：报告器在场却一条断言都没跑；**或者**根本没有报告器、
 *      进程静默退出（0 字节输出）—— 后者等于"免费绿灯"，必须与"合法无计数"分开。
 *   ③ **语料要排除共享库与生成器**（见 CORPUS_EXCLUDE）：前者不是测试，后者会**回写仓库文件**。
 *   ④ 计数分三桶报：**有计数** / **无计数（正常）** / **异常（超时·崩溃·空输出）**，
 *      这样"本来就不产计数"和"跑挂了"不会混在一张清单里。
 *   ⑤ ★★ **「环境不可用」不许与「真红」混在一个桶里**（task-29）：
 *      本仓口径规定「环境不可用 ⇒ 退出码 **2**」（见 `tools/verify/verify-unverified.mjs`
 *      与 `tests/test-move-segment.mjs` 的环境预检：spawn 被禁 ⇒ `exit(2)`）。
 *      但 runner 原来把 `status !== 0` 一律塞进 `abnormal` 桶，而 `abnormal` 又是**唯一**的红项判据
 *      ⇒ 于是「本机沙箱禁止 node spawn」这种**环境故障**会被读成「测试跑挂了」，
 *      与「断言真的失败」**在读数上不可区分** —— 这正是本仓反复治的
 *      「环境故障伪装成代码故障」家族（见铁律 19）。
 *      ⇒ 现在拆成两个互斥的桶：
 *        · `envUnavailable`（exit=2）：**响亮单列**，并附「怎么补上」指引；
 *        · `abnormal`（超时 / 崩溃（非 2 的非法退出）/ 空输出 / 空跑）：**真红**。
 *      ★ 退出码：真红 ⇒ **1**；**只有**环境不可用而没有真红 ⇒ **2**
 *        （与仓库既有约定一致，且让调用方能判别"这批到底跑没跑"）。
 *
 * 用法：
 *   node tools/run-each-test.mjs              # tests/（= npm test）
 *   node tools/run-each-test.mjs --all        # tests/ + tools/verify/ + tools/repro/（= npm run test:all）
 *   node tools/run-each-test.mjs --list       # 只列会跑的文件（含被排除的）
 *   node tools/run-each-test.mjs frame        # 只跑文件名含 frame 的
 *   node tools/run-each-test.mjs --timeout 600000   # 单文件超时（默认 180s，超时算红）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

/**
 * ★ 环境不可用的专用退出码（与 `tools/verify/verify-unverified.mjs::UNVERIFIED_EXIT` 同值）。
 * 本仓约定：**2 = 环境不可用**、**1 = 断言失败** ⇒ 两者不许混（见文件头 ⑤）。
 * 这里**不 import** 那个模块：runner 要能在"被跑的那批里包含它"的情况下工作，
 * 且一个常量不值得引入模块加载顺序的耦合；用断言把两个值钉在一起（见下方自检）。
 */
const ENV_UNVERIFIED_EXIT = 2

/** 默认语料 = tests/；`--all` 追加门禁与复现目录。 */
const ALL_DIRS = ['tests', 'tools/verify', 'tools/repro']

/**
 * ★ 不是测试、不该被 runner 当测试跑的文件。
 * 清单要短、每条都要有**具体**理由，且下面的自检只认「存在」不认「存在与否都能过」——
 * 名单里写了一个不存在的文件同样判失败（防它悄悄烂掉）。
 */
const CORPUS_EXCLUDE = new Map([
  ['tools/verify/verify-shared.mjs', '共享库（导出 launchEdge / sleep / extractFunction / readEngineSource …）：无断言、无输出，跑了也只是一次 import'],
  ['tests/test-client-source.mjs', '共享库（导出 clientSource / extractFunction / loadClientRenderers …）：同上'],
  ['tools/verify/verify-guard-samples.gen.mjs', '生成器：会 fs.writeFileSync 回写 verify-guard-samples.json —— 当测试跑会**改仓库文件**'],
  // ★ 与上面第一条同性质（共享库），只是随 task-21 新增。不排除它的后果很讽刺：
  //   在 `--all` 这类会把 tools/verify/*.mjs 纳入语料的模式下，它会被当"测试"跑 ⇒
  //   **0 断言 0 失败 ⇒ 空跑 ⇒ 判红** —— 与它自己要治的"退出码被读错"是同族问题。
  ['tools/verify/verify-unverified.mjs', '共享库（导出 UNVERIFIED_EXIT / unverified）：无断言、无输出，跑了也只是一次 import'],
])

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const runAll = argv.includes('--all')
const onlyList = argv.includes('--list')
const TIMEOUT = Number(flag('timeout', 180000))
const filter = argv.find((a) => !a.startsWith('--') && a !== flag('timeout', null)) || ''

const dirs = runAll ? ALL_DIRS : ['tests']

const targets = []
const skipped = []
for (const d of dirs) {
  const abs = path.join(REPO, d)
  if (!fs.existsSync(abs)) {
    console.error('❌ 语料目录不存在：' + d + '（判据自己写错了，不是"没有测试"）')
    process.exit(1)
  }
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.mjs')) continue
    const rel = d.replace(/\\/g, '/') + '/' + f
    if (CORPUS_EXCLUDE.has(rel)) { skipped.push(rel); continue }
    if (filter && !f.includes(filter)) continue
    targets.push(rel)
  }
}
targets.sort()

// 排除名单自检：名单里的文件必须真的存在（否则它已经烂了，却还会继续"看起来生效"）
for (const rel of CORPUS_EXCLUDE.keys()) {
  if (!fs.existsSync(path.join(REPO, rel))) {
    console.error('❌ CORPUS_EXCLUDE 里的文件不存在，名单已过期：' + rel + '（' + CORPUS_EXCLUDE.get(rel) + '）')
    process.exit(1)
  }
}

// ★★ task-29 自检：`ENV_UNVERIFIED_EXIT` 必须与**权威定义**（verify-unverified.mjs）同值。
//   为什么要有这一条：这里为了不与模块加载耦合而**本地重写了一次**这个常量 —— 而"同一事实写两遍"
//   正是本仓第 17/24 条铁律点名会**静默漂移**的形态（一处改了、另一处照旧，且两边都不报红）。
//   ⇒ 用一个**从权威文件真读**的断言把它钉住（读了才发现不一致 ⇒ 响亮报红，不许静默）。
//   ★ 只在权威文件存在时检查：`--all` 之外它也在语料里，但语料目录可能被裁剪。
{
  const authRel = 'tools/verify/verify-unverified.mjs'
  const authAbs = path.join(REPO, authRel)
  if (!fs.existsSync(authAbs)) {
    console.error('❌ 找不到 ENV_UNVERIFIED_EXIT 的权威定义文件：' + authRel + '（判据自己写错了，不是"没有定义"）')
    process.exit(1)
  }
  const m = /UNVERIFIED_EXIT\s*=\s*(\d+)/.exec(fs.readFileSync(authAbs, 'utf8'))
  if (!m) {
    console.error('❌ 在 ' + authRel + ' 里找不到 `UNVERIFIED_EXIT = <数字>` —— 权威定义改了名/改了形态，本 runner 的判据已脱节')
    process.exit(1)
  }
  if (Number(m[1]) !== ENV_UNVERIFIED_EXIT) {
    console.error('❌ ENV_UNVERIFIED_EXIT 漂移：runner 写的是 ' + ENV_UNVERIFIED_EXIT
      + '，而权威定义（' + authRel + '）是 ' + m[1] + ' ⇒ 两处必须同源')
    process.exit(1)
  }
}

if (!targets.length) {
  console.error('没找到测试文件（目录=' + dirs.join('+') + ' filter=' + JSON.stringify(filter) + '）')
  process.exit(1)
}
if (onlyList) {
  for (const t of targets) console.log('跑   ' + t)
  for (const s of skipped) console.log('跳过 ' + s + '   ← ' + CORPUS_EXCLUDE.get(s))
  console.log('共跑 ' + targets.length + ' 个，跳过 ' + skipped.length + ' 个')
  process.exit(0)
}

// ★★ task-29 · 前置自检：本 runner **必须能 spawn 子进程**，否则它跑的是空气。
//   为什么要有这一步（本机实测）：宿主若禁止 node 派生子进程（本机 WorkBuddy 沙箱：
//   一切 `spawnSync`/`execFileSync` 报 `EBUSY`），那么**每个**被跑文件都会拿到
//   `status=null / error=EBUSY / 0 字节输出`，12 个文件会一起落进"崩溃/空输出"桶
//   ⇒ 读数看起来像"全仓测试全挂"，而事实是**一条断言都没跑过**。
//   ⇒ 口径：**开跑前**先探一次；探不通就**立刻**判「环境不可用」并以 2 退出，
//     绝不用一批"全是红的"结果去冒充"测试结果"。
{
  const probe = spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    console.error('\n⛔ 环境不可用：runner 无法 spawn 子进程'
      + '（`spawnSync(node,-e,0)` ⇒ error=' + (probe.error && probe.error.code) + ', status=' + JSON.stringify(probe.status) + '）。')
    console.error('   ⇒ 本批 ' + targets.length + ' 个文件**一个都没被执行**：下面**不会**输出任何"pass/fail"读数，')
    console.error('     因为那会是一批假读数。这是**环境故障**，不是代码故障。')
    console.error('   ⇒ 换到允许 spawn 的环境重跑（本仓 CI / DSH 宿主；本机沙箱禁止 node 派生进程）。')
    process.exit(ENV_UNVERIFIED_EXIT)
  }
}

/** 三种计数格式：node:test tap / node:test spec / 本仓原生摘要（`=== 结果|断言: N 通过, M 失败[, K 跳过] ===`） */
function parseCounts(text) {
  const spec = (k) => new RegExp('^(?:ℹ|#) ' + k + ' (\\d+)\\s*$', 'm').exec(text)
  // ★ 「跳过」也要解析：本仓有脚本会打印 `=== 结果: 0 通过, 0 失败, 7 跳过 ===`
  //   （环境不具备时整批 SKIP，例如网络不通的 verify-handoff-restore）。
  //   旧写法把原生分支的 skipped 硬编码成 0 ⇒ 那种情况会撞上「报告器在场 0 断言」的空跑判据被标 ❔，
  //   违反本仓自己的口径「skipped>0 不算空跑」（那条原先只在 node:test 分支有效）。
  const native = /(?:结果|断言)\s*[:：]\s*(\d+)\s*通过\s*[,，/]\s*(\d+)\s*失败(?:\s*[,，/]\s*(\d+)\s*跳过)?/.exec(text)
  const p = spec('pass'), f = spec('fail'), s = spec('skipped')
  if (native) {
    return {
      counterSeen: true,
      pass: Number(native[1]),
      fail: Number(native[2]),
      skipped: Number(native[3] || 0),
    }
  }
  if (p || f || s) {
    return {
      counterSeen: true,
      pass: Number(p ? p[1] : 0),
      fail: Number(f ? f[1] : 0),
      skipped: Number(s ? s[1] : 0),
    }
  }
  return { counterSeen: false, pass: 0, fail: 0, skipped: 0 }
}

/**
 * ★★ task-29 · **分桶判定**（纯函数，导出以便单测 —— 这是本文件里最容易出错的一段，必须能被独立驱动）。
 *
 * 输入一次子进程的原始观测，输出它属于哪一个桶：
 *   · `env`     —— **环境不可用**（宿主禁止 spawn / 被测文件自报未验·环境不可用）。**不是通过、也不是失败**。
 *   · `abnormal`—— **真红**（超时 / 崩溃（非 0 非环境）/ 空输出 / 空跑）。
 *   · `counted` —— 正常且产了计数。
 *   · `noco`    —— 正常、无计数（以 exit code 为准）。
 *   · `ok`      —— 是否算通过（仅 `counted` / `noco` 为真）。
 *
 * ★ 两条**互斥**纪律（本笔的主目标）：
 *   ① 「环境不可用」**绝不**落进 `abnormal`（否则环境故障会被读成代码故障 —— 铁律 19）。
 *   ② 「环境不可用」**也算** `ok=false`（它既不通过、也不失败；调用方必须单独看环境桶）。
 *
 * @param {{status:number|null, stderr?:string, stdout?:string, errorCode?:string|null, signal?:string|null, timedOut?:boolean}} obs
 * @returns {{bucket:'env'|'abnormal'|'counted'|'noco', ok:boolean, why:string, counts:{counterSeen:boolean,pass:number,fail:number,skipped:number}}}
 */
export function classifyRun(obs) {
  const text = String(obs.stdout || '') + String(obs.stderr || '')
  const c = parseCounts(text)
  const timedOut = !!obs.timedOut || obs.signal != null
  const emptyOut = text.trim().length === 0
  // 支 A · runner 自己 spawn 不动（宿主禁止 node 派生子进程）：EBUSY，status=null，0 字节输出
  const spawnBlocked = !timedOut && obs.errorCode === 'EBUSY'
  // 支 B · 被测文件自报环境不可用：退出码恰为 2，且输出带本仓「未验 / 环境不可用」措辞
  //   ★ 用「恰为 2 + 措辞」双重条件，而不是仅"非 0"：避免把"恰好以 2 收尾的真断言脚本"误归环境桶
  //     （**宁可判红，不可把真红误当环境**）。
  const ENV_HINTS = /未验（缺 |环境不可用|退出码 2（非零）|「未验」与「失败」/
  const envSelfReport = !timedOut && !spawnBlocked && obs.status === ENV_UNVERIFIED_EXIT && ENV_HINTS.test(text)
  if (spawnBlocked || envSelfReport) {
    return {
      bucket: 'env', ok: false,
      why: spawnBlocked ? 'runner 无法 spawn 子进程（' + obs.errorCode + '）' : '被测文件自报环境不可用（exit=' + obs.status + '）',
      counts: c,
    }
  }
  // 空跑：报告器在场却 0 项断言，或根本没报告器 + 静默退出（0 字节输出）
  const vacuous = (c.counterSeen && c.pass === 0 && c.fail === 0 && c.skipped === 0) ||
    (!c.counterSeen && emptyOut && !timedOut && obs.status === 0)
  const crash = !timedOut && obs.status !== 0
  if (timedOut) return { bucket: 'abnormal', ok: false, why: '超时', counts: c }
  if (crash) return { bucket: 'abnormal', ok: false, why: '崩溃（exit=' + obs.status + '）', counts: c }
  if (vacuous) return { bucket: 'abnormal', ok: false, why: emptyOut ? '无报告器且 0 字节输出（空跑）' : '报告器在场但 0 项断言（空跑）', counts: c }
  if (c.fail > 0) return { bucket: 'abnormal', ok: false, why: '断言失败 fail=' + c.fail, counts: c }
  return { bucket: c.counterSeen ? 'counted' : 'noco', ok: true, why: '', counts: c }
}

/** 文件名列宽按实际清单算（写死的宽度会让长路径和计数黏在一起，读起来像另一个数） */
const W = Math.min(58, Math.max(38, ...targets.map((t) => t.length)))

let totalPass = 0
let totalFail = 0
let totalSkip = 0
const counted = []        // 有计数
const noCounterOK = []    // 无计数但正常（有输出、exit 0）
const abnormal = []       // 异常：超时 / 崩溃 / 空输出 / 空跑（= 真红）
const envUnavailable = [] // ★ task-29：环境不可用（exit=2 且自报未验/环境不可用）
console.log('逐个跑 ' + targets.length + ' 个文件（' + dirs.join(' + ') + '，超时 ' + Math.round(TIMEOUT / 1000) + 's）…\n')

for (const rel of targets) {
  const out = spawnSync(process.execPath, [rel], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env },       // 保留 MUV_* / DSH_* 等对照臂开关
    timeout: TIMEOUT,
    maxBuffer: 128 * 1024 * 1024,
  })
  const text = String(out.stdout || '') + String(out.stderr || '')
  // ★ 分桶判定走**纯函数**（`classifyRun`，见上）—— 它被 `tests/test-runner-buckets.mjs` 直接单测，
  //   这样这段最容易错的逻辑**不必依赖本能真跑**就能被驱动（本机沙箱禁止 node spawn ⇒ 本文件跑不了，
  //   但 classifyRun 是纯的 ⇒ 照样能验）。
  const obs = {
    status: out.status,
    stdout: out.stdout, stderr: out.stderr,
    errorCode: out.error ? out.error.code : null,
    signal: out.signal,
    timedOut: !!(out.error && out.error.code === 'ETIMEDOUT') || out.signal != null,
  }
  const v = classifyRun(obs)
  const c = v.counts
  totalPass += c.pass
  totalFail += c.fail
  totalSkip += c.skipped

  const timedOut = obs.timedOut
  const emptyOut = text.trim().length === 0
  const spawnBlocked = v.bucket === 'env' && obs.errorCode === 'EBUSY'
  const envUnavail = v.bucket === 'env'
  const vacuous = v.bucket === 'abnormal' && v.why.includes('空跑')

  if (envUnavail) envUnavailable.push(rel)
  else if (v.bucket === 'abnormal') abnormal.push(rel)
  else if (v.bucket === 'counted') counted.push(rel)
  else noCounterOK.push(rel)

  const tag = envUnavail ? '🚫 ' : v.bucket === 'abnormal'
    ? (timedOut ? '⌛ ' : vacuous ? '❔ ' : '❌ ') : '✅ '
  const counts = c.counterSeen
    ? 'pass=' + String(c.pass).padStart(4) + '  fail=' + c.fail + (c.skipped ? '  skip=' + c.skipped : '')
    : '无计数（以 exit code 为准）'
  const envWhy = envUnavail
    ? '   ← 环境不可用：' + v.why + ' ※ 不是代码故障、也不是通过'
    : ''
  console.log(tag + rel.padEnd(W) + counts + envWhy +
    (timedOut && out.signal ? '   ← signal=' + out.signal : '') +
    (vacuous ? (emptyOut ? '   ← 无报告器且 0 字节输出（空跑，判失败）' : '   ← 报告器在场但 0 项断言（空跑，判失败）') : '') +
    (timedOut ? '   ← 超时 ' + TIMEOUT + 'ms 被杀（error=' + (out.error && out.error.code) + '）' : ''))

  if (!v.ok) {
    if (envUnavail) {
      // 环境不可用：把子进程（若有输出）或 runner 侧的成因写清楚，别让人以为"跑挂了"
      if (spawnBlocked) {
        console.log('     ↓ runner 侧成因：本宿主禁止 node 派生子进程（' + obs.errorCode
          + '）⇒ 本文件**没有被执行**，本行不代表它的断言结果')
      } else {
        console.log('     ↓ 该文件自报的环境不可用原因：')
        for (const l of text.split('\n').filter((l) => l.trim()).slice(-4)) console.log('       ' + l.trim().slice(0, 160))
      }
    } else if (vacuous || timedOut || emptyOut) {
      // 崩溃 / 超时 / 真空跑：「最后几行」才是诊断信息（错误在结尾，不在 ✖ 行里）
      console.log('     ↓ 子进程输出末尾（判断是崩溃还是真的没跑）:')
      for (const l of text.split('\n').filter((l) => l.trim()).slice(-5)) console.log('       ' + l.trim().slice(0, 160))
    } else {
      const lines = text.split('\n')
        .filter((l) => /FAIL|✖|AssertionError|Error:|错误|失败/.test(l))
        .slice(0, 6)
      for (const l of lines) console.log('     ' + l.trim().slice(0, 160))
    }
  }
}

console.log('\n──────────────────────────────────────────────')
console.log('合计 pass=' + totalPass + '  fail=' + totalFail + '  skipped=' + totalSkip + '  跑了 ' + targets.length + ' 个（跳过 ' + skipped.length + ' 个非测试文件）')

// 四桶分开列：混在一起就分不清"本来不产计数"、"跑挂了"和"环境跑不动"
console.log('\n有计数（报告器在场）：' + counted.length + ' 个')
for (const f of counted) console.log('   · ' + f)
console.log('无计数（正常：有输出、exit 0）：' + noCounterOK.length + ' 个 —— 这一档只以 exit code 判定，不贡献断言数')
for (const f of noCounterOK) console.log('   · ' + f)
console.log('异常（超时 / 崩溃 / 空输出 / 空跑）：' + abnormal.length + ' 个')
for (const f of abnormal) console.log('   · ' + f)
console.log('环境不可用（exit=' + ENV_UNVERIFIED_EXIT + '，且自报未验/环境不可用）：' + envUnavailable.length + ' 个 —— 这一档**既不冒充通过也不冒充失败**，须在允许 spawn 的环境重跑')
for (const f of envUnavailable) console.log('   · ' + f)
if (skipped.length) {
  console.log('跳过（非测试，CORPUS_EXCLUDE）：' + skipped.length + ' 个')
  for (const s of skipped) console.log('   · ' + s + '   ← ' + CORPUS_EXCLUDE.get(s))
}

// ★★ task-29 退出码语义（可判别）：
//   真红 ⇒ 1（最高优先级 —— 有真红就报真红，环境桶不掩盖它）
//   只有环境不可用、无真红 ⇒ 2（= 本仓"环境不可用"约定，与 1 区分）
//   两者皆无 ⇒ 0
if (abnormal.length) {
  console.error('\n❌ 红项（' + abnormal.length + ' / ' + targets.length + '）—— 逐条见上')
  if (envUnavailable.length) {
    console.error('   （另有 ' + envUnavailable.length + ' 个**环境不可用**，未计入红项：'
      + envUnavailable.join(' / ') + '）')
  }
  process.exit(1)
}
if (envUnavailable.length) {
  console.error('\n⛔ 环境不可用（' + envUnavailable.length + ' / ' + targets.length + '，退出码 '
    + ENV_UNVERIFIED_EXIT + '）—— 这些文件**没有跑完**，不是通过、也不是失败：')
  for (const f of envUnavailable) console.error('   · ' + f)
  console.error('   ⇒ 换到允许 spawn 的环境重跑（本仓 CI / DSH 宿主）；本机沙箱禁止 node spawn 子进程。')
  process.exit(ENV_UNVERIFIED_EXIT)
}
console.log('\n全部通过 ✅')
