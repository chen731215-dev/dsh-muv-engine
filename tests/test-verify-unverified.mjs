// task-23：「未验统一出口」(`tools/verify/verify-unverified.mjs`) 的**契约单测**。
//
// 为什么必须有它：这个模块是整批真机门禁**唯一**的"缺样本出口"。task-21 的全部价值
//   都压在一句约定上：**「未验」必须非零退出（=2），而不是 `SKIP` + `exit 0`**。
//   而"约定"如果没被测试钉住，下一次有人图省事把 `process.exit(UNVERIFIED_EXIT)`
//   改成 `return`（或把退出码改成 0），**没有任何东西会红** —— 免费绿灯又会回来。
//   ⇒ 本文件把那句约定变成**可执行的契约**。
//
// ★ 本测试**不需要 spawn**（本机沙箱可跑）：`unverified()` 支持注入退出函数 `doExit`，
//   于是"退出码是多少""打了哪些字"都能在**同一进程内**逐条断言（详见 lib 里的注释）。
//   ★ 同时用一条**源码形态断言**钉住"默认仍是真退出"—— 防的正是"为了可测把默认路径也改成不退出"。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const LIB_REL = 'tools/verify/verify-unverified.mjs'
const LIB_ABS = path.join(REPO, LIB_REL)

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const mod = await import(pathToFileURL(LIB_ABS).href)
const { UNVERIFIED_EXIT, unverified, unverifiedLines } = mod

/** 捕获 console.log + 注入的退出，返回 { lines, code }（**不真的退出**）。 */
function capture(what, hints) {
  const lines = []
  const orig = console.log
  let code = null
  console.log = (...a) => { lines.push(a.join(' ')) }
  try {
    unverified(what, hints, (c) => { code = c })
  } finally {
    console.log = orig
  }
  return { lines, code }
}

console.log('① ★ 常量契约：退出码必须可判别（非 0、非 1、恰为 2）')
check('★ UNVERIFIED_EXIT === 2', UNVERIFIED_EXIT === 2, 'UNVERIFIED_EXIT=' + UNVERIFIED_EXIT)
check('★ ≠ 0（0 = 通过 ⇒ 那是"免费绿灯"原形）', UNVERIFIED_EXIT !== 0)
check('★ ≠ 1（1 = 真失败 ⇒ 两者必须可区分）', UNVERIFIED_EXIT !== 1)
check('★ 是正整数', Number.isInteger(UNVERIFIED_EXIT) && UNVERIFIED_EXIT > 0)

console.log('\n② ★★ 主契约：调用 unverified() ⇒ 进程**以 UNVERIFIED_EXIT 退出**（不是 return、不是 0）')
{
  const { code } = capture('真卡 C:\\x\\card.png', [])
  check('★ 退出码被调用、且 = UNVERIFIED_EXIT', code === UNVERIFIED_EXIT, 'code=' + JSON.stringify(code))
  check('★ 退出码非 0（"未验"绝不许冒充通过）', code !== 0)
}

console.log('\n③ ★ 措辞契约：三样必须在场（"未验" / "这不是通过" / 退出码自述）')
{
  const { lines } = capture('真卡 X', [])
  const text = lines.join('\n')
  check('★ 含「未验（缺 」', text.includes('未验（缺 '), text.slice(0, 160))
  check('★ 点名**缺的是哪一项**（what 逐字进来）', text.includes('真卡 X'), text.slice(0, 160))
  check('★ 含「这不是通过」', text.includes('这不是通过'))
  check('★ 含「都不等于「通过」」的收尾自述', /都不等于「通过」/.test(text))
  check('★ 自述里写出的退出码 = UNVERIFIED_EXIT', text.includes('退出码 ' + UNVERIFIED_EXIT + '（非零）'))
}

console.log('\n④ ★ hints 契约：逐条打印，且**空 hints 不多打**（防"永远打一行空的"）')
{
  const withHints = capture('Edge', ['设 MUV_EDGE=<路径>', '或装 Edge'])
  check('★ 两条 hints 各打印一行（各带前缀「补上这一项：」）',
    withHints.lines.filter((l) => l.includes('补上这一项：')).length === 2,
    JSON.stringify(withHints.lines))
  check('★ hint 文本逐字在场', withHints.lines.some((l) => l.includes('设 MUV_EDGE=<路径>')))
  const without = capture('Edge', [])
  check('★ 空 hints ⇒ **零**个「补上这一项：」行', without.lines.filter((l) => l.includes('补上这一项：')).length === 0,
    JSON.stringify(without.lines))
}

console.log('\n⑤ ★ 纯函数层与出口层**同源**：unverifiedLines() 与 unverified() 打的是同一批行')
{
  const viaFn = unverifiedLines('某项', ['a', 'b'])
  const { lines } = capture('某项', ['a', 'b'])
  check('★ 两者逐行相等（措辞只有一份来源，不会漂移）',
    JSON.stringify(viaFn) === JSON.stringify(lines),
    'fn=' + JSON.stringify(viaFn) + '\n    log=' + JSON.stringify(lines))
  check('★ 首行是空行（视觉上与前一段输出隔开）', viaFn[0] === '')
  check('★ 末行是退出码自述', /退出码 \d+（非零）/.test(viaFn[viaFn.length - 1]))
}

console.log('\n⑥ ★★ 反向（判据必须会咬）：坏样本必须被判红 —— 我们自己造三种坏形态 + 三条对照判据')
{
  // 坏样本 1：退出码改成 0（"未验"冒充通过）
  const badExit0 = (what, hints, doExit) => { unverifiedLines(what, hints); doExit(0) }
  let c1 = null
  badExit0('x', [], (c) => { c1 = c })
  check('★ 对照：exit=0 的坏样本 ⇒ 判据 `code === UNVERIFIED_EXIT` 为假（会红）',
    c1 !== UNVERIFIED_EXIT, 'c1=' + c1)

  // 坏样本 2：措辞被删（只剩退出码）
  const badNoWording = unverifiedLines('x', []).filter((l) => !l.includes('这不是通过'))
  check('★ 对照：删掉「这不是通过」⇒ 措辞判据为假（会红）',
    !badNoWording.join('\n').includes('这不是通过'))

  // 坏样本 3：hints 被吞（该打的不打）
  const badDropHints = unverifiedLines('x', ['h1', 'h2']).filter((l) => !l.includes('补上这一项：'))
  check('★ 对照：吞掉 hints ⇒ hints 判据为假（会红）',
    badDropHints.filter((l) => l.includes('补上这一项：')).length !== 2)
  // ★ 反证自证：这三个坏样本都确实与"好样本"不同（否则对照是空转）
  const goodText = unverifiedLines('x', ['h1', 'h2']).join('\n')
  check('★ 反证自证：三个坏样本的文本都与好样本不同（对照非空转）',
    goodText !== unverifiedLines('x', []).join('\n') &&
    goodText.includes('这不是通过') &&
    !badDropHints.join('\n').includes('补上这一项：h1'))
}

console.log('\n⑦ ★★ 默认路径形态断言：`unverified()` 默认必须**真退出**（防"为可测把默认也改成不退出"）')
{
  const src = fs.readFileSync(LIB_ABS, 'utf8')
  check('★ 签名里有 doExit 缝且默认为 process.exit',
    /export function unverified\(\s*what,\s*hints\s*=\s*\[\],\s*doExit\s*=\s*process\.exit\s*\)/.test(src),
    '（签名形态变了 ⇒ 契约单测需同步）')
  check('★ 函数体里 doExit(UNVERIFIED_EXIT) 在场（退出码取自常量，不写死）',
    /doExit\(UNVERIFIED_EXIT\)/.test(src))
  check('★ 源码里**没有**裸 `process.exit(2)` 这种写死的旁路', !/process\.exit\(\s*2\s*\)/.test(src))
  check('★ 函数体不再**直接**调 process.exit（退出已收敛到 doExit）',
    !/console\.log\(line\)[\s\S]{0,80}process\.exit\(/.test(src))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
