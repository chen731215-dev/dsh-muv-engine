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

/** 文件名列宽按实际清单算（写死的宽度会让长路径和计数黏在一起，读起来像另一个数） */
const W = Math.min(58, Math.max(38, ...targets.map((t) => t.length)))

let totalPass = 0
let totalFail = 0
let totalSkip = 0
const counted = []        // 有计数
const noCounterOK = []    // 无计数但正常（有输出、exit 0）
const abnormal = []       // 异常：超时 / 崩溃 / 空输出 / 空跑
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
  const c = parseCounts(text)
  totalPass += c.pass
  totalFail += c.fail
  totalSkip += c.skipped

  // ★ 超时判定：spawnSync 超时的真实字段是 status=null **但 error.code==='ETIMEDOUT'**
  //   （或 signal 非空）—— 旧写法 `status===null && !error` 在这台机器上永远为假，
  //   于是 ⌛ 档与它的诊断分支成了死代码。
  const timedOut = !!(out.error && out.error.code === 'ETIMEDOUT') || out.signal != null
  const emptyOut = text.trim().length === 0
  // ★ 空跑防护（两档都要判）：
  //   a) 报告器在场却一条断言都没跑（文件被清空 / 断言被注释 / 子进程没起来）
  //   b) **根本没有报告器 + 静默退出**（0 字节输出）—— 这正是"免费绿灯"那一档
  const vacuous = (c.counterSeen && c.pass === 0 && c.fail === 0 && c.skipped === 0) ||
    (!c.counterSeen && emptyOut && !timedOut && out.status === 0)
  const crash = !timedOut && out.status !== 0
  const ok = !timedOut && !crash && out.status === 0 && c.fail === 0 && !vacuous

  if (timedOut || crash || vacuous) abnormal.push(rel)
  else if (c.counterSeen) counted.push(rel)
  else noCounterOK.push(rel)

  const tag = timedOut ? '⌛ ' : crash ? '❌ ' : vacuous ? '❔ ' : '✅ '
  const counts = c.counterSeen
    ? 'pass=' + String(c.pass).padStart(4) + '  fail=' + c.fail + (c.skipped ? '  skip=' + c.skipped : '')
    : '无计数（以 exit code 为准）'
  console.log(tag + rel.padEnd(W) + counts +
    (timedOut && out.signal ? '   ← signal=' + out.signal : '') +
    (vacuous ? (emptyOut ? '   ← 无报告器且 0 字节输出（空跑，判失败）' : '   ← 报告器在场但 0 项断言（空跑，判失败）') : '') +
    (timedOut ? '   ← 超时 ' + TIMEOUT + 'ms 被杀（error=' + (out.error && out.error.code) + '）' : ''))

  if (!ok) {
    if (vacuous || timedOut || emptyOut) {
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

// 三桶分开列：混在一起就分不清"本来不产计数"和"跑挂了"
console.log('\n有计数（报告器在场）：' + counted.length + ' 个')
for (const f of counted) console.log('   · ' + f)
console.log('无计数（正常：有输出、exit 0）：' + noCounterOK.length + ' 个 —— 这一档只以 exit code 判定，不贡献断言数')
for (const f of noCounterOK) console.log('   · ' + f)
console.log('异常（超时 / 崩溃 / 空输出 / 空跑）：' + abnormal.length + ' 个')
for (const f of abnormal) console.log('   · ' + f)
if (skipped.length) {
  console.log('跳过（非测试，CORPUS_EXCLUDE）：' + skipped.length + ' 个')
  for (const s of skipped) console.log('   · ' + s + '   ← ' + CORPUS_EXCLUDE.get(s))
}

if (abnormal.length) {
  console.error('\n❌ 红项（' + abnormal.length + ' / ' + targets.length + '）—— 逐条见上，异常桶里允许"本来就跑不动"，但必须在材料里逐个说明')
  process.exit(1)
}
console.log('\n全部通过 ✅')
