// **收敛反漂判据**（S2 ①）：全仓只允许**两个**地方从工作树读 `lib/client.js` 的文本。
//
// ── 为什么要有它（否则收敛会慢慢漂回去）────────────────────────────────
// S2 ① 的目标是把"谁读 client.js"从 30+ 个文件收敛到 2 个**收口点**：
//   · `tests/test-client-source.mjs` → `clientSource()`（测试侧）
//   · `tools/verify/verify-shared.mjs` → `readEngineSource()`（工具侧）
// 收敛的意义在于：S2 之后 `lib/client.js` 会变成**拼装产物**，而"逐字节相等"这条要求
// 只该有 1~2 个地方指望它。散落点一多，失败面就大一个数量级，而且**没人会发现漂移** ——
// 新写的 verify 脚本顺手 `readFileSync(path.join(REPO_ROOT,'lib','client.js'))` 是最自然的写法。
// ⇒ 所以这条判据必须**常驻在 tests/ 里**、被 `npm test` 扫到。
//
// ── 判据口径（与材料里一致）──────────────────────────────────────────
//   **"从工作树读文本"** = `readFileSync` / `readSourceText` 的**实参**里含 `client.js` 路径字面量，
//   **或** 一层别名（`const X = process.env.MUV_CLIENT_SRC || path.join(…,'client.js')` 之后读 `X`）。
//   只按 tokenizer 判 `str` token ⇒ **注释里的提及不算**（注释不构成耦合）；
//   `git show HEAD:lib/client.js`（git pathspec）、`MUST_EXIST` 清单、消息文案也**不算**。
//
// 运行：node tests/test-client-source-convergence.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenize } from '../tools/client-scope.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 允许从工作树读 client.js 的两个收口点（相对仓根，正斜杠）。 */

/** 必须扫到的文件数下限（实测 60+；低于它说明遍历坏了 ⇒ 空跑即失败）。 */
const MIN_SCANNED = 50

/**
 * 允许从工作树读 `client.js` 的**白名单**。
 *
 * ★ 为什么不写成"必须恰好等于 2"：那会把**非消费者的路径字面量**也逼进死角 ——
 *   例如 `package.json` 的 `exports` 映射（`"./client": "./lib/client.js"`）是**发布契约**，
 *   它必须写着这个路径，而且**搬不走**。所以判据的形态是
 *   「**收口点 + 一张带理由的白名单**」，而不是一个魔法数字。
 *
 * ★ 条目数有断言盯着（`ALLOWED.length === EXPECTED_ALLOWED`）：加一条必须显式改测试，
 *   防它悄悄长起来、把"收敛"重新泡软。
 */
const ALLOWED = [
  { path: 'tests/test-client-source.mjs', reason: '收口点本体（测试侧）：clientSource() 是唯一读口' },
  { path: 'tools/verify/verify-shared.mjs', reason: '收口点本体（工具侧）：readEngineSource() 是唯一读口' },
]
const EXPECTED_ALLOWED = 2

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/**
 * 取 `readFileSync(...)` / `readSourceText(...)` 的**实参 token**。
 *
 * ★ 必须**走词法**而不是正则扫原文：本判据会把"坏样本"当字符串写进自己的夹具里
 *   （`"const SRC = readFileSync('lib/client.js', …)"` 是**字符串**，不是真的读）。
 *   正则扫原文会把自己的夹具当成"又出现一个直读点"⇒ **判据自指报红**。
 *   这与 `tools/client-scope.mjs` 的"词法优先"是同一个道理：字符串里的代码不算数
 *   （client.js 里那份「引导脚本」就是写在字符串里的 JavaScript）。
 * @returns {Array<{hasLiteral:boolean, aliasName:string|null}>}
 */
function readerArgs(src) {
  const toks = tokenize(src).filter((t) => t.type !== 'comment')
  const out = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'ident' || (t.value !== 'readFileSync' && t.value !== 'readSourceText')) continue
    const open = toks[i + 1]
    if (!open || open.type !== 'punct' || open.value !== '(') continue
    const inner = []
    let d = 1
    for (let j = i + 2; j < toks.length; j++) {
      const q = toks[j]
      if (q.type === 'punct' && q.value === '(') d++
      else if (q.type === 'punct' && q.value === ')') { d--; if (d === 0) break }
      inner.push(q)
    }
    const hasLiteral = inner.some((q) => q.type === 'str' && /client\.js/.test(q.value))
    // 别名形态：实参就是一个裸标识符（`readFileSync(SRC_PATH)`）
    const bare = inner.length >= 1 && inner[0].type === 'ident' &&
      (inner.length === 1 || (inner[1].type === 'punct' && inner[1].value === ','))
    out.push({ hasLiteral, aliasName: bare ? inner[0].value : null })
  }
  return out
}

/**
 * 初始化式里**造出一条 client.js 路径**的声明名。
 *
 * ★ 两道收紧，都是为了不误报（误报会让判据自己变成噪音）：
 *   ① **词法**口径：字符串里的不算（夹具里写的坏样本是字符串，不是真的读）；
 *   ② 初始化式必须同时含 `client.js` 字符串 **且** 含**造路径的构造**
 *      （`path.join` / `path.resolve` / `new URL`）。只含字符串是不够的 ——
 *      `const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], …)` 的初始式里
 *      也有 `client.js`，但 `r` 是**子进程结果**、不是路径；把它当路径声明会误报
 *      （实测：这条松规则一口气把 5 个只用 `git show` 的脚本误判成直读点）。
 *   ③ 初始化式扫描遇到**最外层闭合括号就停**（否则会越过语句边界，把后面语句里的
 *      client.js 字符串算进这一条声明）。
 */
function aliasedNames(src) {
  const toks = tokenize(src).filter((t) => t.type !== 'comment')
  const names = new Set()
  const KW = new Set(['const', 'let', 'var'])
  // 句子开头型关键字：出现在 d===0 处就说明**初始化式已经结束**、下一条语句开始了。
  // ★ 没有这一条会出真错：`let oldPath = ''` 后面紧跟 `try { … }`，扫描会一路吞掉整个
  //   try 块，把块里的 `client.js` + `path.join` 算成 oldPath 的初始式 ⇒ 假阳性。
  const STMT_START = new Set([
    'try', 'catch', 'finally', 'if', 'else', 'for', 'while', 'do', 'switch', 'return',
    'throw', 'const', 'let', 'var', 'function', 'class', 'export', 'import',
    'break', 'continue', 'with', 'debugger',
  ])
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'ident' || !KW.has(toks[i].value)) continue
    const name = toks[i + 1]
    const eq = toks[i + 2]
    if (!name || name.type !== 'ident' || !eq || eq.type !== 'punct' || eq.value !== '=') continue
    let d = 0, hasLiteral = false, hasPathCtor = false
    for (let j = i + 3; j < toks.length; j++) {
      const q = toks[j]
      if (q.type === 'punct') {
        if (q.value === '(' || q.value === '[' || q.value === '{') { if (d === 0 && q.value === '{') break; d++ }
        else if (q.value === ')' || q.value === ']' || q.value === '}') { d--; if (d <= 0) break }
        else if ((q.value === ';' || q.value === ',') && d === 0) break
      } else if (q.type === 'ident' && d === 0 && STMT_START.has(q.value)) break
      if (q.type === 'str' && /client\.js/.test(q.value)) hasLiteral = true
      if (q.type === 'ident' && (q.value === 'path' || q.value === 'URL')) {
        const after = toks[j + 1], after2 = toks[j + 2]
        if (after && after.type === 'punct' && after.value === '.' &&
            after2 && after2.type === 'ident' && (after2.value === 'join' || after2.value === 'resolve')) hasPathCtor = true
        if (q.value === 'URL') hasPathCtor = true
      }
    }
    if (hasLiteral && hasPathCtor) names.add(name.value)
  }
  return names
}

/**
 * ★ 判据本体。**纯函数**（吃 `[{rel, src}]`），所以能对"合成坏样本"也跑一遍 ——
 * 否则判据本身无法被反证（只能对着真实仓库跑，红了也不知道是判据错了还是仓库真有问题）。
 * @param {Array<{rel:string, src:string}>} files
 * @returns {{readers:string[], scanned:number}}
 */
export function offenders(files) {
  const readers = []
  for (const { rel, src } of files) {
    const aliases = aliasedNames(src)
    const isRead = readerArgs(src).some((a) => a.hasLiteral || (a.aliasName && aliases.has(a.aliasName)))
    if (isRead && !ALLOWED.some((a) => a.path === rel)) readers.push(rel)
  }
  return { readers: readers.sort(), scanned: files.length }
}

/** 遍历 tests/ 与 tools/ 下全部 .mjs（跳过 node_modules/.git）。 */
function collect() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) {
        out.push({ rel: path.relative(REPO, p).replace(/\\/g, '/'), src: fs.readFileSync(p, 'utf8') })
      }
    }
  }
  for (const d of ['tests', 'tools']) {
    const abs = path.join(REPO, d)
    if (fs.existsSync(abs)) walk(abs)
  }
  return out
}

console.log('\n① 收敛成绩：全仓只允许两个收口点从工作树读 lib/client.js')
{
  const files = collect()
  const { readers, scanned } = offenders(files)

  // ★ 非空跑下限：遍历必须先真的扫到东西，否则下面的"readers 为空"毫无意义
  check('本次真的扫到了 ≥ ' + MIN_SCANNED + ' 个文件（否则判据是空跑）',
    scanned >= MIN_SCANNED, 'scanned=' + scanned)
  check('★ 收口点之外，没有任何文件从工作树读 client.js 文本',
    readers.length === 0, '仍有 ' + readers.length + ' 个: ' + readers.join(', '))

  // 两个收口点必须真的存在、且真的提供那个能力（否则"没有读者"可能是因为能力没了）
  // ★ 白名单形态：条目数有断言盯着（加一条必须显式改测试，防它悄悄长）
  check('白名单条目数 == 预期（' + EXPECTED_ALLOWED + '）', ALLOWED.length === EXPECTED_ALLOWED, String(ALLOWED.length))
  check('白名单里每一条都写明了理由', ALLOWED.every((a) => typeof a.reason === 'string' && a.reason.length > 0))
  for (const a of ALLOWED) {
    const f = files.find((x) => x.rel === a.path)
    check('白名单路径存在且**确实提供读口能力**: ' + a.path + '   ← ' + a.reason, !!f)
  }
  const srcLib = files.find((x) => x.rel === 'tests/test-client-source.mjs')
  const srcShared = files.find((x) => x.rel === 'tools/verify/verify-shared.mjs')
  check('测试侧收口点导出 clientSource()', !!srcLib && /export function clientSource\s*\(/.test(srcLib.src))
  check('工具侧收口点导出 readEngineSource()', !!srcShared && /export function readEngineSource\s*\(/.test(srcShared.src))
  check('★ 归一化在收口点里做（`lf(` 出现），消费者不必各自记住',
    !!srcLib && /lf\(/.test(srcLib.src) && !!srcShared && /lf\(/.test(srcShared.src))
  check('★ 对照臂（MUV_CLIENT_SRC）能力在收口点上收，而不是散在各脚本',
    !!srcLib && /MUV_CLIENT_SRC/.test(srcLib.src) && !!srcShared && /MUV_CLIENT_SRC/.test(srcShared.src))
}

console.log('\n② 反漂判据本身不许空转（合成坏样本必须报红）')
{
  // 判据是纯函数 ⇒ 可以喂合成样本。这里造的正是"后来人会顺手写的那种直读"。
  const BAD_DIRECT = "import { readFileSync } from 'node:fs'\nconst SRC = readFileSync('lib/client.js', 'utf8')\n"
  const BAD_ALIAS = "const P = process.env.X || path.join(ROOT, 'lib', 'client.js')\nconst S = readFileSync(P, 'utf8')\n"
  const GOOD_GITSHOW = "const r = execSync('git show HEAD:lib/client.js')\n"
  const GOOD_MESSAGE = "console.log('=== lib/client.js 回归 ===')\n"
  const GOOD_LIST = "const MUST = ['lib/index.js', 'lib/client.js']\n"

  check('反证：直接读的坏样本必须被点名',
    offenders([{ rel: 'tools/verify/zz-bad-direct.mjs', src: BAD_DIRECT }]).readers.join() === 'tools/verify/zz-bad-direct.mjs')
  check('反证：一层别名的坏样本也必须被点名（别名不许绕过判据）',
    offenders([{ rel: 'tools/verify/zz-bad-alias.mjs', src: BAD_ALIAS }]).readers.join() === 'tools/verify/zz-bad-alias.mjs')
  check('git pathspec 形态**不算**耦合（那正是"看 blob"的推荐做法）',
    offenders([{ rel: 'tools/verify/zz-git.mjs', src: GOOD_GITSHOW }]).readers.length === 0)
  check('消息文案里提到 client.js **不算**耦合',
    offenders([{ rel: 'tools/verify/zz-msg.mjs', src: GOOD_MESSAGE }]).readers.length === 0)
  check('必备文件清单里列出 client.js **不算**耦合',
    offenders([{ rel: 'tools/verify/zz-list.mjs', src: GOOD_LIST }]).readers.length === 0)
  check('注释里提到 client.js **不算**耦合（tokenizer 判定，注释不是 str）',
    offenders([{ rel: 'tools/verify/zz-comment.mjs', src: "// 读 lib/client.js 的旧写法\n" }]).readers.length === 0)
  // ★ 真踩过的假阳性：`let P = ''` 后面紧跟 try 块，块里有 client.js + path.join。
  //   若初始化式扫描越过语句边界，P 会被误判成"路径别名" ⇒ 假红。
  const BAD_OVERREACH = [
    "let P = ''",
    'try {',
    "  const r = spawnSync('git', ['show', 'HEAD:lib/client.js'])",
    "  P = path.join(__dirname, 'x.js')",
    '} catch (_) {}',
    'const S = readFileSync(P, "utf8")',
  ].join('\n')
  check('★ 初始化式不许越过语句边界（`let P = \'\'` 之后紧跟 try 块 ⇒ 不得误判）',
    offenders([{ rel: 'tools/verify/zz-overreach.mjs', src: BAD_OVERREACH }]).readers.length === 0)
  // 反向：真正的路径别名仍然必须被抓到（证明上面那条收紧没有把判据收废）
  const BAD_REAL_ALIAS = "let P = process.env.X || path.join(ROOT, 'lib', 'client.js')\nconst S = readFileSync(P, 'utf8')\n"
  check('反向自证：真正的路径别名依旧被点名（收紧没把判据收废）',
    offenders([{ rel: 'tools/verify/zz-real-alias.mjs', src: BAD_REAL_ALIAS }]).readers.length === 1)
  check('两个收口点自己被白名单豁免（它们就是允许的那两处）',
    offenders([{ rel: 'tests/test-client-source.mjs', src: BAD_DIRECT }]).readers.length === 0)

  // 空输入 ⇒ 不许"空绿"
  const empty = offenders([])
  check('空输入下 scanned=0（所以上面那条"≥ ' + MIN_SCANNED + '"的下限是必需的）',
    empty.scanned === 0 && empty.readers.length === 0)
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
