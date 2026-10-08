// **作用域完备性**的常驻测试 —— muv-S2（拆 client.js）的接线判据。
//
// ── 为什么必须有这个文件（真实翻车，同栈刚发生的）────────────────────────
// `dsh-tavern-v2` 把路由搬进新模块时写的"静态契约"是
// **解构名集合 == 调用点键集合** —— 它比的是**自己枚举的两份清单**。
// 于是有个名字（`json`，被用了 105 处）**两侧都没有写**，契约恒等地看不见它，
// 一路全绿，跑到冒烟才炸 `ReferenceError: json is not defined`。
// ⇒ 教训：**"自己枚举清单去比对"的契约，对"清单本身漏了"这件事是盲的。**
//
// 所以这里的判据是**反过来的**：从**函数体**里枚举自由标识符，逐个要求能解析到
// （形参 / 区内局部 / 组内一起搬走的函数 / 真全局 / 显式接线）；
// **任何无法分类的名字 ⇒ 直接失败并点名**，不许静默丢弃。
//
// 本文件测的是**判据本身**，因此除了"现在的代码是干净的"，还必须证明它**真的会红**：
//   ① 删掉一个接线名 ⇒ 判据报红**并点名那个标识符**（三类破坏之①）；
//   ② 注入一个不可分类的名字 ⇒ 判据**直接失败**（三类破坏之②）；
//   ③ 判据**落在 tests/ 且被 `npm test` 扫到**（三类破坏之③ —— "判据只活在 %TEMP% 里"
//      与"契约比的是自己枚举的清单"是同一种失效）；
//   ④ 遮蔽（内层 `var x` 不得顶掉外层的自由 `x`）—— 这是判据自己最容易静默蒙混的地方。
//
// 运行：node tests/test-client-scope-completeness.mjs

import { readFileSync } from 'node:fs'
import { clientSource } from './test-client-source.mjs'
import {
  extractFunction, findFunctions, functionScopes, landingReport, lf, mutateOnce,
  scopeGroupReport, scopeReport, targetBindings, tokenize, wiringReport,
} from '../tools/client-scope.mjs'

// ★ 读源码一律走**收口点** `clientSource()`：它内部做归一化行尾（S2 ① 把归一化上收到读口）。
//   本仓 core.autocrlf=true 且无 .gitattributes ⇒ 同一提交在不同检出形态下行尾不同：
//   CI 检出 LF、Windows 普通 clone 检出 CRLF。见本文件【十三】。
const SRC = clientSource()

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const sameSet = (a, b) => a.length === b.length && a.slice().sort().join('\u0000') === b.slice().sort().join('\u0000')

/**
 * 待迁移的分组。
 *
 * `entries` = **会被一起搬走**的函数（组内互相引用算 local，不需要额外接线）。
 * `required` = **从函数体反推的**必须接线清单 —— 这个清单有测试盯着：
 *   若被搬的代码新增了一个依赖而没人接线，下面的"反推 == 声明"那条会当场报红。
 *   ⇒ 这就是"不许誊抄清单"：声明必须与反推结果逐字一致。
 */
const MIGRATION_SETS = [
  {
    label: '① KV 命名空间（会话栅栏）',
    entries: ['muvKvKeyOf'],
    required: ['currentSessionId'],
    live: [],
  },
  {
    label: '② 消息取样 + 可见性护栏',
    entries: ['messageRootOf', 'muvIsVisibleInDom', 'messageTargets'],
    required: ['MSG_BODY_RE'],
    live: [],
  },
  {
    label: '③ 权威楼号',
    entries: ['muvTurnOfEl', 'muvSessionTurnsNow'],
    required: [],
    live: [],
  },
  {
    label: '④ 装饰主循环',
    entries: ['muvDepthFromLaterCount', 'muvTurnOfEl', 'muvSessionTurnsNow', 'decorateMessages'],
    // `_decorating` 是**活变量**（会被回写）⇒ 必须走访问器，不能当只读快照接线
    required: ['messageTargets', '_decorateOne', '_decorating'],
    live: ['_decorating'],
  },
]

console.log('\n【一】现在的代码：每个分组的自由标识符都已被分类（missing 为空）')
for (const s of MIGRATION_SETS) {
  const r = wiringReport({ src: SRC, entries: s.entries, provided: new Set(s.required) })
  check(s.label + '：不漏名字（missing 为空）', r.missing.length === 0, r.missing.join(', '))
}

console.log('\n【二】反推 == 声明（不许誊抄清单；新增依赖而没接线 ⇒ 当场报红）')
for (const s of MIGRATION_SETS) {
  const derived = wiringReport({ src: SRC, entries: s.entries, provided: new Set() }).missing
  check(s.label + '：从函数体反推出的必需清单 == 声明的清单',
    sameSet(derived, s.required), '反推=' + JSON.stringify(derived) + ' 声明=' + JSON.stringify(s.required))
}

console.log('\n【三】三类破坏之①：删掉任意一个接线名 ⇒ 报红**并点名那个标识符**')
let deletions = 0
for (const s of MIGRATION_SETS) {
  for (const name of s.required) {
    const without = new Set(s.required)
    without.delete(name)
    const r = wiringReport({ src: SRC, entries: s.entries, provided: without })
    deletions++
    check(s.label + '：删掉接线「' + name + '」⇒ 报红且点名 ' + name,
      r.missing.includes(name), 'missing=' + JSON.stringify(r.missing))
    // 顺带证明它给得出诊断位置（"只报不通过、不点名"视为不达标）
    const hint = r.where.get(name)
    check(s.label + '：对「' + name + '」给出可诊断的位置说明',
      typeof hint === 'string' && hint.length > 0, String(hint))
  }
}

console.log('\n【四】三类破坏之②：不可分类的名字 ⇒ 工具**直接失败**（不许静默丢弃）')
{
  // 既不是形参/区内局部，也不是模块级绑定，也不是真全局 —— 就是一根断线
  const SYNTH = [
    'window.__ModuleLoader__.load({',
    '  factory: (require) => {',
    '    function alpha() {',
    '      return beta() + ghostName',
    '    }',
    '    function beta() { return 1 }',
    '    return {}',
    '  }',
    '})',
  ].join('\n')
  const rep = scopeReport({ src: SYNTH, name: 'alpha' })
  check('悬空名被**点名**（不是被丢掉）', rep.unresolved.includes('ghostName'), JSON.stringify(rep.buckets))
  check('区内/外层的合法名字没有被误伤', rep.buckets.local.includes('beta') || rep.buckets.enclosing.includes('beta'),
    JSON.stringify(rep.buckets))
  const wr = wiringReport({ src: SYNTH, entries: ['alpha'], provided: new Set() })
  check('搬迁判据同样点名它', wr.missing.includes('ghostName'), JSON.stringify(wr.missing))
  check('并说明"前源码里也找不到"（真悬空）', /真·悬空|找不到/.test(String(wr.where.get('ghostName'))),
    String(wr.where.get('ghostName')))

  // 反向：把它接上线之后必须转绿 —— 证明上面那条红是"因为没接线"，不是判据抽风
  const wired = wiringReport({ src: SYNTH, entries: ['alpha'], provided: new Set(['ghostName', 'beta']) })
  check('把它接上线之后转绿（红的确实是"没接线"）', wired.missing.length === 0, wired.missing.join(','))
}

console.log('\n【五】遮蔽：内层 var 不得顶掉外层的自由名（判据自己最易静默蒙混处）')
{
  const MASK = [
    '(function () {',
    '  function outer() {',
    '    function inner() { var shadow = 2; return shadow }',
    '    return inner() + shadow',
    '  }',
    '})()',
  ].join('\n')
  const rep = scopeReport({ src: MASK, name: 'outer' })
  // ★ 判据按**引用**判、不按名字去重，所以"内层是局部 / 外层是自由"会同时成立 ——
  //   这正是我们要的：内层那处不能把外层那处顶掉。按名字去重的实现会在这一格静默蒙混。
  check('内层 `var shadow` 那一处被认成 inner 的局部',
    rep.free.some((r) => r.name === 'shadow' && r.local === true), JSON.stringify(rep.free))
  check('★ outer 里的 `shadow` 那一处是**自由名**，必须进 unresolved（遮蔽不许顶掉它）',
    rep.free.some((r) => r.name === 'shadow' && r.local === false) && rep.unresolved.includes('shadow'),
    JSON.stringify(rep.buckets))
  const wr = wiringReport({ src: MASK, entries: ['outer'], provided: new Set() })
  check('搬迁判据同样点名外层的 shadow', wr.missing.includes('shadow'), JSON.stringify(wr.missing))
}

console.log('\n【六】词法：字符串/注释里的"同名函数"和括号不许骗过提取器')
{
  // 本仓真实存在的形态：引导脚本是**写在字符串里的 JavaScript**（`'function m(){try{'`）
  const SNEAKY = [
    'window.__ModuleLoader__.load({',
    '  factory: (require) => {',
    "    var guide = 'function realFn(){ try{' + '}}}'",
    '    // function realFn(  ← 注释里也来一个',
    '    function realFn(a) { return a + 1 }',
    '    return {}',
    '  }',
    '})',
  ].join('\n')
  check('字符串/注释里的同名函数**不产生**幻影候选（词法已经排掉）',
    findFunctions(SNEAKY, 'realFn').length === 1, String(findFunctions(SNEAKY, 'realFn').length))
  check('字符串里的 `{` 不会把函数从中截断（提取结果能被解析）',
    (() => {
      try { new Function(findFunctions(SNEAKY, 'realFn')[0].source); return true } catch (_) { return false }
    })())
  const rep = scopeReport({ src: SNEAKY, name: 'realFn' })
  check('其自由标识符分类正确（a 是形参）', rep.buckets.local.includes('a'), JSON.stringify(rep.buckets))
}

console.log('\n【七】提取器对"重名"必须失败（重名会让"提取成功"失去意义）')
{
  const DUP = [
    '(function () {',
    '  function dupFn() { return 1 }',
    '  function dupFn() { return 2 }',
    '})()',
  ].join('\n')
  let msg = ''
  try { scopeReport({ src: DUP, name: 'dupFn' }) } catch (e) { msg = e.message }
  check('重名 ⇒ 直接失败，且说明是重名', /重名/.test(msg), msg)
}

console.log('\n【八】真全局白名单是**窄**的（新全局必须显式表态，不许被默默放过）')
{
  const GLOB = [
    '(function () {',
    '  function g() { return someUnlistedGlobalThing + document.title }',
    '})()',
  ].join('\n')
  const rep = scopeReport({ src: GLOB, name: 'g' })
  check('白名单外的全局名 ⇒ unresolved（强制显式表态）',
    rep.unresolved.includes('someUnlistedGlobalThing'), JSON.stringify(rep.buckets))
  check('白名单内的真全局 `document` 正常归类', rep.buckets.global.includes('document'))
  const withExtra = scopeReport({ src: GLOB, name: 'g', extraGlobals: ['someUnlistedGlobalThing'] })
  check('显式加进白名单后转绿（"表态"这条路是通的）', withExtra.unresolved.length === 0, withExtra.unresolved.join(','))
}

console.log('\n【九】活变量：必须**从函数体反推**出来（不许誊抄清单）')
{
  for (const s of MIGRATION_SETS) {
    const r = wiringReport({ src: SRC, entries: s.entries, provided: new Set(s.required) })
    check(s.label + '：活变量集合 == 声明（' + (s.live.join(',') || '无') + '）',
      sameSet(r.liveVariables, s.live), '反推=' + JSON.stringify(r.liveVariables))
  }
  // 反向：把**两处**回写都改成只读，活变量应当**消失**
  // （证明它是从函数体反推的，不是写死的。只去掉一处是不够的 —— `_decorating` 有 `= true`
  //   和 finally 里的 `= false` 两处写点，少改一处它照样是活变量。）
  const READ_ONLY = mutateOnce(
    mutateOnce(SRC, '_decorating = true', 'var _everTrue = true'),
    '} finally {\n            _decorating = false\n          }',
    '} finally {\n            void 0\n          }')
  const rRo = wiringReport({
    src: READ_ONLY,
    entries: MIGRATION_SETS[3].entries,
    provided: new Set(['messageTargets', '_decorateOne', '_decorating']),
  })
  check('把两处回写都改成只读后，`_decorating` 不再是活变量（说明它是反推的、不是写死的）',
    !rRo.liveVariables.includes('_decorating'), JSON.stringify(rRo.liveVariables))
  check('把回写改成只读后，它仍是一条必须接线的依赖（读也要接线）',
    wiringReport({ src: READ_ONLY, entries: MIGRATION_SETS[3].entries, provided: new Set(['messageTargets', '_decorateOne']) })
      .missing.includes('_decorating'))
}

console.log('\n【十】判据自己是常驻测试（三类破坏之③）')
{
  const self = lf(readFileSync(new URL(import.meta.url), 'utf8'))
  check('本判据位于 tests/ 下（会被 `node tools/run-each-test.mjs` 扫到）',
    /[\\/]tests[\\/]test-client-scope-completeness\.mjs$/.test(new URL(import.meta.url).pathname))
  check('本判据在**默认运行路径**上就会跑反证（没有藏在开关/环境变量后面）',
    !/if\s*\(\s*process\.env\.MUV_/.test(self) && /【三】|【四】|【五】/.test(self))
  check('tokenize 对整份 client.js 不抛错（判据能在真实规模上跑）', tokenize(SRC).length > 10000)
  check('反证覆盖数 > 0（确实逐名删过接线）', deletions > 0, String(deletions))
}

console.log('\n【十一】非空跑下限（否则"missing 为空"可能只是"什么都没分析到"）')
{
  // ★ 值由**实测**量级定，留余量但远高于 0：抓"静默空分析"，又不因正常搬动误红。
  //   按本仓口径：数字写在测试里，**不写进文档**（文档里的数字必漂）。
  const MIN_FREE_NAMES = 50      // 实测 84
  const MIN_MISSING = 3          // 实测 5
  const MIN_FUNCS = 8            // 实测 8 个不同函数
  const MIN_TOKENS = 20000       // 实测 38547
  const MIN_FN_CHARS = 120       // 实测最短函数体 182 字符

  let freeNameTotal = 0
  let missingTotal = 0
  const fnNames = new Set()
  for (const s of MIGRATION_SETS) {
    missingTotal += wiringReport({ src: SRC, entries: s.entries, provided: new Set() }).missing.length
    for (const e of s.entries) {
      fnNames.add(e)
      freeNameTotal += scopeReport({ src: SRC, name: e }).freeNames.length
      const cands = findFunctions(SRC, e)
      if (cands.length !== 1) { check('入口 ' + e + ' 必须唯一可提取', false, '候选=' + cands.length); continue }
      check('入口 ' + e + ' 的函数体长度 ≥ ' + MIN_FN_CHARS, cands[0].source.length >= MIN_FN_CHARS,
        String(cands[0].source.length))
    }
  }

  check('分析到的自由标识符总数 ≥ ' + MIN_FREE_NAMES, freeNameTotal >= MIN_FREE_NAMES, String(freeNameTotal))
  check('必须有"真的需要接线"的名字 ≥ ' + MIN_MISSING + '（全是 0 就说明判据没在看前提）',
    missingTotal >= MIN_MISSING, String(missingTotal))
  check('覆盖到的入口函数数 ≥ ' + MIN_FUNCS, fnNames.size >= MIN_FUNCS, String(fnNames.size))
  check('tokenize 在整份 client.js 上规模正常（≥ ' + MIN_TOKENS + ' token）',
    tokenize(SRC).length >= MIN_TOKENS, String(tokenize(SRC).length))

  // 反证：喂空串 ⇒ 三个入口都必须**直接失败 / 点名**，不许"空输入 ⇒ 空结果 ⇒ 全绿"
  let threw = false
  try { scopeReport({ src: '', name: 'muvKvKeyOf' }) } catch (_) { threw = true }
  check('空源码 ⇒ scopeReport 直接失败（不许静默返回空集合）', threw)

  const emptyWiring = wiringReport({ src: '', entries: MIGRATION_SETS[0].entries, provided: new Set() })
  check('空源码 ⇒ wiringReport **点名**找不到入口（而不是 missing=[] 的空绿）',
    emptyWiring.missing.length > 0, JSON.stringify(emptyWiring.missing))

  const emptyDerived = wiringReport({ src: SRC, entries: MIGRATION_SETS[3].entries, provided: new Set() }).missing
  check('非空输入下反推清单非空（与上面的空输入对照，证明"下限"两边都看得见东西）',
    emptyDerived.length > 0, JSON.stringify(emptyDerived))
}

console.log('\n【十二】★ 右端校验：`provided` 里的名字，在新模块里**真的落地**了吗')
{
  // 为什么单独立这一节：`wiringReport` 只能答"必须接线什么"——`provided` 是**调用方的声明**，
  // 没有任何东西核对过它。于是"写了但没落地"（与 tavern 那次"两侧都没写"互为镜像）
  // 会让判据照样全绿。搬迁时每次都要经过 provided，一次手滑就把闸门变成装饰。

  // ① import 说明符的本地名认得对
  const imports = [
    "import def from './a.js'",
    "import { one, two as alias } from './b.js'",
    "import * as ns from './c.js'",
    "import './side-effect.js'",
    'var up = import.meta.url',
  ].join('\n')
  const tb = targetBindings(imports)
  check('默认导入的本地名被认下', tb.has('def'))
  check('具名导入认原名', tb.has('one'))
  check('`as` 认的是**本地名**，不是导出名', tb.has('alias') && !tb.has('two'), JSON.stringify([...tb]))
  check('命名空间导入认 `ns`', tb.has('ns'))
  check('四种导入形态的本地名齐全（def/one/alias/ns + 顶层 var up）',
    tb.size === 5, JSON.stringify([...tb].sort()))
  // 边界：纯副作用导入与 import.meta 本身都**不该**凭空造出绑定
  check('纯副作用导入不产生绑定（边界）', targetBindings("import './side-effect.js'").size === 0,
    JSON.stringify([...targetBindings("import './side-effect.js'")]))
  check('`import.meta` 本身不产生绑定（只有 `var u` 那一个）',
    targetBindings('var u = import.meta.url').size === 1 &&
    !targetBindings('var u = import.meta.url').has('meta'),
    JSON.stringify([...targetBindings('var u = import.meta.url')]))

  // ② 只在**嵌套**函数里绑定的名字不算落地 —— 收宽了就是静默蒙混
  const deepOnly = ['function wrapper() {', '  let nestedOnly = false', '}'].join('\n')
  check('★ 只在嵌套函数里绑定的名字 **不算** 模块级落地',
    targetBindings(deepOnly).has('nestedOnly') === false, JSON.stringify([...targetBindings(deepOnly)]))

  // ③ 拿真实的搬迁组做两端联合判定（目标模块用真函数体 + 真 import 拼出来）
  const group = MIGRATION_SETS[3]
  const targetSrc = [
    "import { messageTargets } from './sampling.js'",
    "import { _decorateOne } from './decorate-one.js'",
    'let _decorating = false',
    ...group.entries.map((e) => extractFunction(SRC, e)),
    'export { decorateMessages, muvTurnOfEl, muvSessionTurnsNow, muvDepthFromLaterCount }',
  ].join('\n')

  const land = landingReport({
    src: SRC, entries: group.entries, provided: new Set(group.required), targetSrc,
  })
  check('两端联合判定：左端不漏名字 + 右端全部落地 ⇒ ok',
    land.ok, JSON.stringify({ missing: land.missing, unlanded: land.unlanded }))
  check('右端认下了这三个接线名',
    ['messageTargets', '_decorateOne', '_decorating'].every((n) => land.landedBindings.includes(n)),
    JSON.stringify(land.landedBindings))
  check('右端没把 import 的**导出名**误当本地名', !land.landedBindings.includes('sampling'))

  // ④ ★ 审核方点名的反证：从新模块的 import 里删掉一个名字 ⇒ 必须报红并点名
  const noImport = mutateOnce(targetSrc, "import { messageTargets } from './sampling.js'\n", '')
  const badImport = landingReport({
    src: SRC, entries: group.entries, provided: new Set(group.required), targetSrc: noImport,
  })
  check('反证：删掉新模块里那条 import ⇒ 报红', badImport.ok === false)
  check('反证：并**点名** messageTargets（不是只说"不通过"）',
    badImport.unlanded.includes('messageTargets'), JSON.stringify(badImport.unlanded))
  check('反证：左端此刻仍是绿的（证明红**只**来自右端，两端确实各管一段）',
    badImport.missing.length === 0, JSON.stringify(badImport.missing))

  // ⑤ 同一条反证换 `_decorating`（活变量在右端漏落地时同样必须报红）
  const noLive = mutateOnce(targetSrc, 'let _decorating = false\n', '')
  const badLive = landingReport({
    src: SRC, entries: group.entries, provided: new Set(group.required), targetSrc: noLive,
  })
  check('反证：活变量 `_decorating` 没在新模块里落地 ⇒ 报红并点名',
    badLive.unlanded.includes('_decorating'), JSON.stringify(badLive.unlanded))

  // ⑥ 空目标模块 ⇒ 所有 provided 都必须被点名为"没落地"（防"空目标 ⇒ 空 unlanded ⇒ 假绿"）
  const emptyTarget = landingReport({
    src: SRC, entries: group.entries, provided: new Set(group.required), targetSrc: '',
  })
  check('★ 空目标模块 ⇒ 每个接线名都被点名为未落地（不许空绿）',
    emptyTarget.unlanded.length === group.required.length && emptyTarget.ok === false,
    JSON.stringify(emptyTarget.unlanded))
}

console.log('\n【十三】两种 EOL 形态（CI 是 LF、Windows 普通 clone 是 CRLF —— 不许只在一种形态下绿）')
{
  // ★ 为什么单独立这一节：本仓 `core.autocrlf = true` 且无 `.gitattributes` ⇒
  //   CI 的工作流关掉了 autocrlf（检出 LF），而 Windows 上普通 `git clone` 检出 CRLF（实测 8831 个 CRLF）。
  //   原先 `mutateOnce` 的 needle 含 `\n` + 12 空格缩进 ⇒ **CRLF 检出下原样命中 0 次** ⇒ 判据直接抛错，
  //   表现是"CI 绿、默认 clone 红"，而且看起来像真失败。这是 tavern 那次"本机绿、CI 红"的镜像。
  const CRLF = SRC.replace(/\n/g, '\r\n')
  check('CRLF 样本只差 \\r、字符内容完全相同',
    CRLF !== SRC && CRLF.length === SRC.length + SRC.split('\n').length - 1,
    SRC.length + ' -> ' + CRLF.length)

  // ★ 归一化是**有效变换**，不是空操作 —— 否则"修好了"是假的
  const needle = '} finally {\n            _decorating = false\n          }'
  check('CRLF 原文里该 needle 命中 0 次（⇒ 不归一化真的会红）',
    CRLF.split(needle).length - 1 === 0)
  check('归一化之后命中 1 次（⇒ 归一化真的在做事）',
    lf(CRLF).split(needle).length - 1 === 1)

  // 判据链在 CRLF 输入下必须给出一致结论
  const freeLf = scopeReport({ src: SRC, name: 'muvKvKeyOf' }).freeNames
  const freeCrlf = scopeReport({ src: CRLF, name: 'muvKvKeyOf' }).freeNames
  check('CRLF 与 LF 两种形态下 scopeReport 结论一致（且非空）',
    freeCrlf.length > 0 && freeLf.join(',') === freeCrlf.join(','), JSON.stringify(freeCrlf))

  const groups = [MIGRATION_SETS[0], MIGRATION_SETS[3]]
  for (const s of groups) {
    const w = wiringReport({ src: CRLF, entries: s.entries, provided: new Set(s.required) })
    check('CRLF 形态下 ' + s.label + ' 照常判绿', w.missing.length === 0, w.missing.join(','))
  }

  // 右端校验也要在 CRLF 下工作
  const grp = MIGRATION_SETS[3]
  const tgt = [
    "import { messageTargets } from './sampling.js'",
    "import { _decorateOne } from './one.js'",
    'let _decorating = false',
  ].join('\r\n')
  const land = landingReport({
    src: CRLF, entries: grp.entries, provided: new Set(grp.required), targetSrc: tgt,
  })
  check('CRLF 形态下两端联合判定照常 ok（左端 + 右端都归一化了）', land.ok,
    JSON.stringify({ missing: land.missing, unlanded: land.unlanded }))
  check('CRLF 形态下 targetBindings 照常认出绑定',
    ['messageTargets', '_decorateOne', '_decorating'].every((n) => targetBindings(tgt).has(n)),
    JSON.stringify([...targetBindings(tgt)].sort()))

  // 最要紧的一处：在 CRLF 形态的目标模块上做一次受控变异，右端判据必须跟着变
  const mut = mutateOnce(tgt, "import { messageTargets } from './sampling.js'", '')
  check('CRLF 形态下 mutateOnce 仍能命中（原始故障点）', mut.indexOf('sampling.js') < 0, mut.slice(0, 60))
  check('CRLF 形态下删掉落地后右端照常报红并点名',
    landingReport({ src: CRLF, entries: grp.entries, provided: new Set(grp.required), targetSrc: mut })
      .unlanded.includes('messageTargets'))
}

console.log('\n【十四】搬迁前置检查：一个**提议的分组**是否共享同一个 enclosing scope')
{
  // 为什么它在这里而不在"产物判据"里：它是**搬前**性质（搬完恒真）⇒ 进仓做常驻判据无从复查。
  // 但它**可以被判**：给一个提议的分组，问"它们同作用域吗"。
  const SAME = ['sizeFrame', 'insertIntoInput', 'messageRootOf', 'muvIsVisibleInDom']
  const r1 = scopeGroupReport({ src: SRC, names: SAME })
  check('★ 段3 实际搬的那 4 个：同一作用域 ⇒ ok', r1.ok, r1.problems.join(' | '))
  check('并给出作用域名字与每个成员（可审阅）',
    typeof r1.scope === 'string' && r1.members.length === 4 && r1.members.every((m) => m.scope === r1.scope),
    JSON.stringify(r1.members))

  // ★ 反证 A（Lead 点名要的那类）：**同深度但不同作用域** ⇒ 必须红并点名两个作用域
  const r2 = scopeGroupReport({ src: SRC, names: ['muvSimpleBlock', 'fenceInlineBlank'] })
  check('★ 反证：**同深度但不同作用域** ⇒ 红，并点名"跨作用域"',
    r2.ok === false && r2.problems.some((p) => p.includes('跨作用域')),
    JSON.stringify(r2.members) + ' | ' + r2.problems.join(' '))
  check('反证：两个成员被分到**不同** scope（证明它不是"深度"的复述）',
    new Set(r2.members.map((m) => m.scope)).size === 2, JSON.stringify(r2.members.map((m) => m.scope)))

  // 反证 B：在同作用域分组里**混入**一个异作用域的 ⇒ 也要红
  const r3 = scopeGroupReport({ src: SRC, names: [...SAME, 'fenceInlineBlank'] })
  check('反证：混入一个异作用域的 ⇒ 红', r3.ok === false, JSON.stringify(r3.members.map((m) => m.name + '@' + m.scope)))

  // 反证 C：空分组 ⇒ 不许空绿
  check('反证：空分组 ⇒ 红（不许"没得判"当绿）', scopeGroupReport({ src: SRC, names: [] }).ok === false)

  // 反向自证：单个函数 ⇒ ok（判据没被收废）
  check('反向自证：单个函数恒 ok', scopeGroupReport({ src: SRC, names: ['sizeFrame'] }).ok === true)

  // ★ 匿名/箭头必须被算进作用域：否则绝大多数函数会被判成"顶层"，判据就退化成空话
  check('★ 作用域归属不是"(顶层)"（说明匿名函数表达式/箭头被算进来了）',
    scopeGroupReport({ src: SRC, names: ['sizeFrame'] }).members[0].scope !== '(顶层)',
    scopeGroupReport({ src: SRC, names: ['sizeFrame'] }).members[0].scope)
  check('functionScopes 收集到的作用域数量足够多（实测 300+）',
    functionScopes(SRC).length > 200, String(functionScopes(SRC).length))
  check('且其中确实包含匿名函数表达式与箭头函数（两类都被收）',
    functionScopes(SRC).some((s) => s.name.startsWith('<匿名函数表达式>'))
    && functionScopes(SRC).some((s) => s.name.startsWith('<箭头函数')),
    JSON.stringify(functionScopes(SRC).slice(0, 3).map((s) => s.name)))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
