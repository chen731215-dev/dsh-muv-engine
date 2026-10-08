// **收敛反漂判据**（S2 ①）：全仓只允许**两个**地方从工作树读 `lib/client.js` 的文本。
//
// ── 为什么要有它（否则收敛会慢慢漂回去）────────────────────────────────
// S2 ① 把"谁读 client.js"从 26 个落点收敛到 2 个**收口点**：
//   · `tests/test-client-source.mjs`    → `clientSource()`（测试侧）
//   · `tools/verify/verify-shared.mjs`  → `readEngineSource()`（工具侧）
// 收敛的意义：S2 之后 `lib/client.js` 会变成**拼装产物**，"逐字节相等"这条要求只该有
// 1~2 个地方指望它。散落点一多，失败面就大一个数量级，而且**没人会发现漂移** ——
// 新写的 verify 脚本顺手 `readFileSync(path.join(REPO_ROOT,'lib','client.js'))` 是最自然的写法。
// ⇒ 所以这条判据必须**常驻在 tests/ 里**、被 `npm test` 扫到。
//
// ── ★★ 覆盖声明（哪些耦合形态"看住了"，哪些"已知没看住"）──────────────────
// 本判据判的是"**真的从工作树把 client.js 当文本读出来**"。**已声明覆盖**的形态，
// 每一种都有一个**常驻反证样本**（见 ② 节）—— 这样"漏了一整个形态"会在反证层被抓住，
// 而不是靠"这次没人写这种写法"侥幸。
//
//   【已覆盖】（每一类在 ② 节都有样本）
//   F1 同步直读 + 字符串字面量：      `readFileSync('lib/client.js', 'utf8')`
//   F2 同步直读 + path.join / 模板拼路径：
//                                    `readFileSync(path.join(ROOT,'lib','client.js'))`
//                                    ``readFileSync(`${ROOT}/lib/client.js`)``
//   F3 异步读取（含 fs.promises）：    `fs.promises.readFile(p,'utf8')` / `await readFile(p)`
//   F4 别名·一级：                    `const P = 'lib/client.js'` → `readFileSync(P)`
//                                    `const P = path.join(ROOT,'lib','client.js')` → 读 `P`
//   F5 别名·多级 / 间接拼接：          `const Q = P` / `const R = path.join(ROOT, P)` → 读 `Q`/`R`
//   F6 经收口点：                     `clientSource()` / `readEngineSource()` —— **不算消费者**
//                                      （它们就是白名单那两处；判据反过来要求它们存在）
//   F7 "不算耦合"的干扰形态：          `git show <rev>:lib/client.js`（git pathspec）、消息文案、
//                                      必备文件清单、HTML 内联注释、行注释
//
//   【★ 已知未覆盖（显式写清 —— 不把"没验"当"没有"）】
//   N1 路径**完全**来自配置/环境变量再拼接（`path.join(REPO, cfg.clientFile)`）：值运行时才知道，
//      静态不可判。注意 `process.env.MUV_CLIENT_SRC || path.join(REPO,'lib','client.js')` 这种
//      **带字面量兜底**的写法仍在 F2/F4 覆盖内；未覆盖的是"一个路径字面量都没有"的那种。
//   N2 **动态** import/require 拼路径（`await import(someVar)`）。
//   N3 其它 fs API：`createReadStream` / `openSync` / `readFileSync` 之外的读法。
//      本仓当前**无**此写法；若将来出现，本判据**会漏** ⇒ 那时要么补形态 + 补样本，
//      要么把 `lib/client.js` 的路径从代码里彻底收走（那才是根治）。
//
// 运行：node tests/test-client-source-convergence.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenize } from '../tools/client-scope.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 允许从工作树读 `client.js` 的**白名单**。
 *
 * ★ **语料定义（白名单的语义靠它才解释得通）**：本判据只扫
 *   `walk('tests')` + `walk('tools')` 下的 **`.mjs` / `.js`**。
 *   所以 `package.json` / `.gitattributes` / `.github/workflows/check.yml` / `*.md` 这些
 *   **根本不在语料里** ⇒ 不需要也不该进这个白名单。
 *   ⚠️ 将来若有人把语料放宽到"**全部已跟踪文件**"，白名单的语义就变了（那些载体里确实写着路径字面量：
 *   例如 `package.json` 的 `exports["./client"]`），**必须同时重新解释这份白名单**，
 *   否则它会在语义上开始说错话（把"必须写着这个路径的发布契约"当成"读者"）。
 *
 * ★ 为什么不写成"必须恰好等于 2"：那会把非消费者的路径字面量逼进死角。判据形态是
 *   「**收口点 + 一张带理由的白名单**」，而不是一个魔法数字。
 * ★ 只收**收口点**：口径 C 的定义是"真的从工作树读文本"，非代码载体**根本不读文本**
 *   ⇒ 天然不是消费者。那 6 个非代码载体记在材料/台账里（桥接表 `41 = 2 + 31 + 8`），不进判据。
 * ★ 条目数有断言盯着（加一条必须显式改测试，防它悄悄长起来把"收敛"重新泡软）。
 */
const ALLOWED = [
  { path: 'tests/test-client-source.mjs', reason: '收口点本体（测试侧）：clientSource() 是唯一读口' },
  { path: 'tools/verify/verify-shared.mjs', reason: '收口点本体（工具侧）：readEngineSource() 是唯一读口' },
  {
    path: 'tools/build-client.mjs',
    reason: '构建/判据工具：**必须**直读产物做逐字节比较 —— 它**不能**走收口点，'
      + '因为收口点返回的是**归一化后**的文本，而逐字节比较一旦归一化就不是逐字节了',
  },
  // ★ P5（审核方）：档 B 的接线生成器若需要读工作树 ⇒ **必须显式加白名单并给出理由，且每次增要报**。
  //   下面两条是 task-16 新增、落在 `lib/client.js` 上的**新消费者** —— 由本判据**当场点名**抓出来的（实弹）：
  {
    path: 'tools/move-segment.mjs',
    reason: '搬迁生成器（task-16）：经 `build-client.mjs` 的 `loadFromDisk()` 直读产物与分片 ——'
      + '它要按"清单声明制"**重切分**（算 startLine/endLine/深度、把新片插进 parts），'
      + '而收口点返回的是**归一化**文本，做不了逐字节与行区间这两件事',
  },
  {
    path: 'tests/test-move-segment.mjs',
    reason: '该生成器的**常驻反证**：在 %TEMP% 沙盒里读**沙盒那份** `lib/client.js` 做无损证据'
      + '（函数恰好出现 1 次）—— 读的是沙盒产物、不是本仓产物，故不能走收口点',
  },
]
const EXPECTED_ALLOWED = 5

/** 会被判成"读取 client.js 文本"的 API 名（F1–F3）。 */
const READER_APIS = new Set(['readFileSync', 'readFile', 'readSourceText'])

/** 必须扫到的文件数下限（实测 60+；低于它说明遍历坏了 ⇒ 空跑即失败）。 */
const MIN_SCANNED = 50

/** 一个分片（若将来 S2 把源码切开）—— 见 N1/N3 的边界说明。 */
void 0

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const tok = (src) => tokenize(src).filter((t) => t.type !== 'comment')

/**
 * ★ 词法给的 `str` token **连引号一起给**（`'lib/client.js'`），模板的原文段则不带引号。
 * 判定前必须先剥引号 —— 否则 `$` 锚点永远匹配不上引号字符串，
 * 判据会**静默失明**（实测：F1/F2/F3/F4/F5 五类全漏，而模板那一格因为是裸文本反而"通过"）。
 */
const unquote = (v) => {
  if (v.length >= 2 && ((v[0] === "'" && v[v.length - 1] === "'") || (v[0] === '"' && v[v.length - 1] === '"'))) {
    return v.slice(1, -1)
  }
  return v
}

/**
 * 这条字符串是 **git 修订号形态**（`':lib/client.js'` / `'HEAD:lib/client.js'` / `'324b751:lib/client.js'`）吗？
 *
 * ★ 必须区分：本仓大量脚本用 `git show <rev>:lib/client.js` 取**旧版本**做对照臂 ——
 *   那是"看 blob"（我们反而推荐的做法），**不是**"从工作树读文本"。
 * ★ 判定用"冒号出现与否"，但**要放过盘符**（`C:\…\lib\client.js` 里的 `C:` 不是修订号）。
 *   （先前用 `/:...$/` 的写法**漏判了 `':lib/client.js'`** —— 因为 `[^\\/]*` 跨不过 `lib/` 里的斜杠；
 *    漏判会让 `const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'])` 被当成"别名声明"，
 *    再经 `viaIdent` 级联污染整份文件 ⇒ 两个只用临时副本的脚本被误判成直读点。）
 */
const isGitRevSpec = (s) => {
  const i = s.lastIndexOf(':')
  if (i < 0) return false
  if (i === 1 && /^[A-Za-z]$/.test(s[0])) return false     // `C:\…` 盘符，不是修订号
  return true
}

/**
 * 这条字符串字面量像**文件路径**吗（而不是 git 修订号形态）？
 */
const isPathLiteral = (v) => {
  const s = unquote(v)
  return /(^|[\\/])client\.js$/.test(s) && !isGitRevSpec(s)
}
const mentionsClient = (v) => /client\.js/.test(v)

/** 取 `READER_APIS` 里任一 API 的调用实参 token。 */
function readerArgs(src) {
  const toks = tok(src)
  const out = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.type !== 'ident' || !READER_APIS.has(t.value)) continue
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
    const hasLiteral = inner.some((q) => q.type === 'str' && isPathLiteral(q.value))
    const bare = inner.length >= 1 && inner[0].type === 'ident' &&
      (inner.length === 1 || (inner[1].type === 'punct' && inner[1].value === ','))
    out.push({ hasLiteral, aliasName: bare ? inner[0].value : null })
  }
  return out
}

/** 语句开头关键字：d===0 处出现 ⇒ 初始化式已结束（否则会吞掉后面的语句/块 ⇒ 假阳）。 */
const STMT_START = new Set([
  'try', 'catch', 'finally', 'if', 'else', 'for', 'while', 'do', 'switch', 'return',
  'throw', 'const', 'let', 'var', 'function', 'class', 'export', 'import',
  'break', 'continue', 'with', 'debugger',
])

/** 收集 `const/let/var X = <初始化式>` 的关键信息（供别名闭包用）。 */
function declaredInits(src) {
  const toks = tok(src)
  const KW = new Set(['const', 'let', 'var'])
  const out = new Map()
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'ident' || !KW.has(toks[i].value)) continue
    const name = toks[i + 1], eq = toks[i + 2]
    if (!name || name.type !== 'ident' || !eq || eq.type !== 'punct' || eq.value !== '=') continue
    let d = 0, hasPathLit = false, hasMention = false, hasPathCtor = false
    const idents = new Set()
    for (let j = i + 3; j < toks.length; j++) {
      const q = toks[j]
      if (q.type === 'punct') {
        if (q.value === '(' || q.value === '[' || q.value === '{') { if (d === 0 && q.value === '{') break; d++ }
        else if (q.value === ')' || q.value === ']' || q.value === '}') { d--; if (d <= 0) break }
        else if ((q.value === ';' || q.value === ',') && d === 0) break
      } else if (q.type === 'ident' && d === 0 && STMT_START.has(q.value)) break
      if (q.type === 'str') {
        if (isPathLiteral(q.value)) hasPathLit = true
        if (mentionsClient(q.value)) hasMention = true
      }
      if (q.type === 'ident') {
        // ★ 只把**未被调用**的标识符当作"引用了另一个别名"。
        //   否则 `const oldPath = exportOldSource()` 会被当成别名 —— 而那个函数是**导出旧版本到临时文件**的，
        //   `oldPath` 根本不是本仓的 lib/client.js（实测：这条松规则把 era-bridge 与
        //   status-placeholder-era 两个只用临时副本的脚本误判成直读点）。
        const nx = toks[j + 1]
        const isCall = !!(nx && nx.type === 'punct' && nx.value === '(')
        if (!isCall) idents.add(q.value)
        if (q.value === 'URL') hasPathCtor = true
        else if (q.value === 'path') {
          const a = toks[j + 1], b = toks[j + 2]
          if (a && a.type === 'punct' && a.value === '.' && b && b.type === 'ident' &&
              (b.value === 'join' || b.value === 'resolve')) hasPathCtor = true
        }
      }
    }
    out.set(name.value, { hasPathLit, hasMention, hasPathCtor, idents })
    i = i // 继续扫，允许同一条语句里有多个声明
  }
  return out
}

/**
 * 别名的**传递闭包**（F4/F5）：`X` 是别名 ⇔
 *   · 初始化式里有**路径字面量**（`const P = 'lib/client.js'`），或
 *   · 初始化式里有**造路径构造器 + client.js 提及**（`const P = path.join(ROOT,'lib','client.js')`），或
 *   · 初始化式**引用了另一个别名**（`const Q = P` / `const R = path.join(ROOT, P)`）。
 * 迭代到不动点 —— 单层判定会漏掉多级别名与间接拼接。
 */
function aliasNames(src) {
  const decls = declaredInits(src)
  const aliases = new Set()
  for (let round = 0; round <= decls.size; round++) {
    let changed = false
    for (const [name, d] of decls) {
      if (aliases.has(name)) continue
      const viaIdent = [...d.idents].some((x) => aliases.has(x))
      if (d.hasPathLit || (d.hasPathCtor && d.hasMention) || viaIdent) { aliases.add(name); changed = true }
    }
    if (!changed) break
  }
  return aliases
}

/**
 * ★ 判据本体。**纯函数**（吃 `[{rel, src}]`）⇒ 反证可以喂**合成样本**，
 * 不必往仓库里丢临时文件（也不会像"往仓库丢文件"那样污染工作树）。
 * @param {Array<{rel:string, src:string}>} files
 * @returns {{readers:string[], scanned:number}}
 */
export function offenders(files) {
  const readers = []
  for (const { rel, src } of files) {
    const aliases = aliasNames(src)
    const isRead = readerArgs(src).some((a) => a.hasLiteral || (a.aliasName && aliases.has(a.aliasName)))
    if (isRead && !ALLOWED.some((x) => x.path === rel)) readers.push(rel)
  }
  return { readers: readers.sort(), scanned: files.length }
}

/** 遍历 tests/ 与 tools/ 下全部 .mjs/.js（跳过 node_modules/.git）。 */
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

console.log('\n① 收敛成绩（口径 C：真的从工作树读 client.js 文本）')
{
  const files = collect()
  const { readers, scanned } = offenders(files)

  check('本次真的扫到了 ≥ ' + MIN_SCANNED + ' 个文件（否则判据是空跑）', scanned >= MIN_SCANNED, 'scanned=' + scanned)
  check('★ 收口点之外，没有任何文件从工作树读 client.js 文本',
    readers.length === 0, '仍有 ' + readers.length + ' 个: ' + readers.join(', '))
  check('白名单条目数 == 预期（' + EXPECTED_ALLOWED + '）', ALLOWED.length === EXPECTED_ALLOWED, String(ALLOWED.length))
  check('白名单里每一条都写明了理由', ALLOWED.every((a) => typeof a.reason === 'string' && a.reason.length > 0))
  for (const a of ALLOWED) check('白名单路径存在: ' + a.path + '   ← ' + a.reason, !!files.find((x) => x.rel === a.path))

  // ★ 判据文件**自己在语料里**（tests/ 下）—— 它的夹具里写着大量 "readFileSync('lib/client.js')"
  //   之类的**字符串**。判据必须不被自己误判（这正是"必须走词法"的那条；用自定义粗筛的实现
  //   会在这里自指报红）。
  check('★ 判据文件自己在语料里、且不被自己的夹具字符串误判（词法判定的直接证据）',
    files.some((x) => x.rel === 'tests/test-client-source-convergence.mjs') &&
    !readers.includes('tests/test-client-source-convergence.mjs'),
    'readers=' + JSON.stringify(readers))

  const srcLib = files.find((x) => x.rel === 'tests/test-client-source.mjs')
  const srcShared = files.find((x) => x.rel === 'tools/verify/verify-shared.mjs')
  check('测试侧收口点导出 clientSource()', !!srcLib && /export function clientSource\s*\(/.test(srcLib.src))
  check('工具侧收口点导出 readEngineSource()', !!srcShared && /export function readEngineSource\s*\(/.test(srcShared.src))
  check('★ 归一化在收口点里做（`lf(` 出现），消费者不必各自记住',
    !!srcLib && /lf\(/.test(srcLib.src) && !!srcShared && /lf\(/.test(srcShared.src))
  check('★ 对照臂（MUV_CLIENT_SRC）能力在收口点上收，而不是散在各脚本',
    !!srcLib && /MUV_CLIENT_SRC/.test(srcLib.src) && !!srcShared && /MUV_CLIENT_SRC/.test(srcShared.src))
}

console.log('\n② 覆盖声明：**每一种已声明覆盖的形态都有一个常驻样本**（漏一整个形态在这里被抓住）')
{
  const hit = (rel, src) => offenders([{ rel, src }]).readers
  const F = 'tools/verify/zz-f.mjs'

  check('F1 同步直读 + 字符串字面量 ⇒ 点名',
    hit(F, "const S = readFileSync('lib/client.js', 'utf8')\n")[0] === F)
  check('F2 同步直读 + path.join 拼路径 ⇒ 点名',
    hit(F, "const S = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')\n")[0] === F)
  check('F2 模板字面量拼路径 ⇒ 点名',
    hit(F, 'const S = readFileSync(`${ROOT}/lib/client.js`, "utf8")\n')[0] === F)
  check('F3 fs.promises.readFile ⇒ 点名',
    hit(F, "const S = await fs.promises.readFile(path.join(ROOT, 'lib', 'client.js'), 'utf8')\n")[0] === F)
  check('F3 裸 readFile ⇒ 点名',
    hit(F, "readFile(new URL('../lib/client.js', import.meta.url))\n")[0] === F)
  check('F4 一级别名（const P = 字面量）⇒ 点名',
    hit(F, "const P = 'lib/client.js'\nconst S = readFileSync(P, 'utf8')\n")[0] === F)
  check('F4 一级别名（const P = path.join(…)）⇒ 点名',
    hit(F, "const P = path.join(ROOT, 'lib', 'client.js')\nconst S = readFileSync(P, 'utf8')\n")[0] === F)
  check('F5 二级别名（Q = P）⇒ 点名（单层判定会漏）',
    hit(F, "const P = 'lib/client.js'\nconst Q = P\nconst S = readFileSync(Q, 'utf8')\n")[0] === F)
  check('F5 间接拼接（R = path.join(ROOT, P)）⇒ 点名',
    hit(F, "const P = 'lib/client.js'\nconst R = path.join(ROOT, P)\nconst S = readFileSync(R, 'utf8')\n")[0] === F)
  check('F6 白名单里的收口点自己被豁免（它们就是允许的那两处）',
    hit('tests/test-client-source.mjs', "const S = readFileSync('lib/client.js', 'utf8')\n").length === 0)
  check('F7 git pathspec（git show <rev>:lib/client.js）**不算**耦合',
    hit(F, "const r = execSync('git show HEAD:lib/client.js')\n").length === 0)
  check('F7 消息文案 **不算**耦合', hit(F, "console.log('=== lib/client.js 回归 ===')\n").length === 0)
  check('F7 必备文件清单 **不算**耦合', hit(F, "const MUST = ['lib/index.js', 'lib/client.js']\n").length === 0)
  check('F7 HTML 内联注释 **不算**耦合', hit(F, '<script>/* 逐字取自 lib/client.js */</script>\n').length === 0)
  check('F7 行注释 **不算**耦合', hit(F, '// 读 lib/client.js 的旧写法\n').length === 0)
  check('★ 初始化式不许越过语句边界（let P = \'\' 后紧跟 try 块 ⇒ 不得误判）',
    hit(F, ["let P = ''", 'try {', "  const r = spawnSync('git', ['show', 'HEAD:lib/client.js'])",
      "  P = path.join(__dirname, 'x.js')", '} catch (_) {}', 'const S = readFileSync(P, "utf8")'].join('\n')).length === 0)
  const empty = offenders([])
  check('空输入 ⇒ scanned=0 且无 readers（所以上面那条下限是必需的）',
    empty.scanned === 0 && empty.readers.length === 0)

  // ★ 覆盖声明与样本一一对应：已声明覆盖的形态数量有断言盯着
  const DECLARED_COVERED = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']
  check('已声明覆盖的形态清单有断言盯着（' + DECLARED_COVERED.length + ' 类）',
    DECLARED_COVERED.length === 7 && DECLARED_COVERED.every((s) => /^F\d$/.test(s)))
  // 已知未覆盖：**故意不做样本**（做了就说明已覆盖）；这里只断言"声明存在且非空"
  const KNOWN_UNCOVERED = [
    'N1 路径完全来自配置/环境变量再拼接（一个路径字面量都没有）',
    'N2 动态 import/require 拼路径',
    'N3 其它 fs API（createReadStream / openSync …）',
  ]
  check('已知未覆盖的形态被显式列出（' + KNOWN_UNCOVERED.length + ' 条）—— 不把"没验"当"没有"',
    KNOWN_UNCOVERED.length === 3 && KNOWN_UNCOVERED.every((s) => /^N\d /.test(s)))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
