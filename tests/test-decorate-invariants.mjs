// 装饰链的**四条不变量** —— muv-S4① 安全网。
//
// 为什么要有这个文件：`lib/client.js` 的装饰链（消息取样 → 会话可见性 → 权威楼号 →
// depth → 单条装饰）是"看起来接上了其实没接上"的高发区。本项目已经栽过一次原型：
// `messageRootOf` **曾经根本不存在**，只有 `messageTargets()` 里那一处调用，
// 而那个调用点在 `try { … } catch (_) {}` 里 ⇒ 每次抛 `ReferenceError` 被静默吞掉、
// `messageTargets()` **恒返回空数组**。**所有既有门禁都绿**（它们只看"调了没抛"），
// 真实页面上只是"要多刷新一次才会被装饰"。
// ⇒ 所以这里不写"源码里有这行字吗"式的形状断言（那种断言对"接线断了"是盲的），
//   而是**把函数体原样提出来真的执行**，用可观测的行为把不变量钉住。
//
// ★ 四条不变量，每条都配一个**坏样本必须报红**的反证：
//   反证用的是 `mutateOnce`（要求 needle **恰好命中一次**）——
//   变异没生效就当场抛错。否则"坏样本照样绿"会被误读成"断言很强"，
//   那比没有反证更糟：它给的是假信心。
//
// 运行：node tests/test-decorate-invariants.mjs

import { clientSource } from './test-client-source.mjs'
import { extractFunction, lf, mutateOnce, scopeReport, tokenize, wiringReport } from '../tools/client-scope.mjs'

// ★ 读源码一律走**收口点** `clientSource()`：它内部做归一化行尾（S2 ① 把归一化上收到读口）。
//   本仓 core.autocrlf=true 且无 .gitattributes ⇒ 同一提交在不同检出形态下行尾不同：
//   CI 检出 LF、Windows 普通 clone 检出 CRLF。见本文件【⑥】。
const SRC = clientSource()

/**
 * ★ **非空跑下限**：本文件断言的是"这么多个函数被真的提取并执行了"。
 *
 * 为什么必须有它：如果提取器哪天因为词法/解析改动而**静默返回空**，
 * 那么所有"……不含错误"式的断言都会**空转通过** —— 那正是本文件头注批判的"免费绿灯"。
 * 下限值取自实测量级（提了 8 个、最短函数体 182 字符），留了余量但**远高于 0**，
 * 所以它能抓住"什么都没分析到"，又不会因为正常的代码搬动而误红。
 * （按本仓口径：**数字写进测试、不写进文档** —— 文档里的数字必漂。）
 */
const MIN_LIFTED = 8          // 实测 8 个不同函数
const MIN_FN_CHARS = 120      // 实测最短 182 字符
const MIN_TOKENS = 20000      // 实测 38547 个 token

const liftedNames = new Set()
/** 提取 + 记账。提取到的函数体短到不像真代码 ⇒ 当场抛（不给"空提取"留后门）。 */
function lift(srcText, name) {
  const text = extractFunction(srcText, name)
  if (!text || text.length < MIN_FN_CHARS) {
    throw new Error('提取到的函数体过短，像是空抽取：' + name + '（' + String(text && text.length) + ' 字符）')
  }
  if (srcText === SRC) liftedNames.add(name)
  return text
}

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
/** 反证：坏样本下这条断言**必须**不成立。成立说明反证没成立（断言可能本来就假）。 */
function checkRed(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   [反证] ' + name) }
  else { fail++; console.log('  FAIL [反证] ' + name + (detail ? '  -> ' + detail : '')) }
}

/** 从源码里**逐字**取一个单行声明（`var NAME = …`）—— 不许在测试里抄一份副本。 */
function verbatimDecl(srcText, name) {
  const re = new RegExp('^[ \\t]*(?:var|let|const)[ \\t]+' + name + '[ \\t]*=[ \\t]*[^;\\n]+;?[ \\t]*$', 'm')
  const m = re.exec(srcText)
  if (!m) throw new Error('源码里找不到单行声明，不能逐字取（不许在测试里抄副本）：' + name)
  if (m[0].indexOf('\n') >= 0) throw new Error('声明跨行，逐字取不可靠：' + name)
  return m[0].trim()
}

// ── 假元素 ───────────────────────────────────────────────────────────────

/**
 * 一个够用的元素桩。只实现被装饰链真正读到的成员：
 * `className` / `getAttribute` / `getBoundingClientRect` / `closest` / `querySelector` / `parentElement`。
 */
function el(o = {}) {
  const attrs = o.attrs || {}
  return {
    className: o.cls === undefined ? '' : o.cls,
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null },
    getBoundingClientRect: () => o.rect || { width: 600, height: 40 },
    closest: () => (o.closestHit ? {} : null),
    querySelector: () => (o.hasBlock === false ? null : {}),
    matches: () => false,
    parentElement: o.parent || null,
    children: new Array(o.children === undefined ? 1 : o.children).fill(0),
  }
}

/** 只装饰**当前可见会话**的取样桩：一条可见、一条 0×0（不可见）、一条 data-streaming。 */
function threeBodies() {
  return [
    el({ cls: '_markdown_abc123_7' }),                                    // 可见，应被取
    el({ cls: '_markdown_abc123_7', rect: { width: 0, height: 0 } }),      // 不可见（0×0），应被剔
    el({ cls: '_markdown_abc123_7', attrs: { 'data-streaming': '1' } }),   // 流式中，应被剔
  ]
}

// ── 不变量 ①：`muvKvKeyOf` 必须带会话栅栏 ────────────────────────────────

function buildKvKeyOf(srcText) {
  const body = lift(srcText, 'muvKvKeyOf')
  const make = new Function('currentSessionId', body + '\nreturn muvKvKeyOf')
  return (impl) => make(impl)
}

console.log('\n① muvKvKeyOf：KV 命名空间必须带会话栅栏 <卡键>@<会话 id>')
{
  const build = buildKvKeyOf(SRC)
  const sidA = build(() => 'sess-A')
  const sidB = build(() => 'sess-B')

  check('会话已知 ⇒ 键 = <卡键>@<会话 id>', sidA('zkt2') === 'zkt2@sess-A', JSON.stringify(sidA('zkt2')))
  check('会话栅栏用的是 `@` 分隔（不是别的分隔符）', sidA('zkt2').indexOf('@') === 4)
  check('跨会话隔离：同一张卡在两个会话里拿到两个互不可见的命名空间',
    sidA('zkt2') !== sidB('zkt2'), sidA('zkt2') + ' vs ' + sidB('zkt2'))
  check('认不出会话 ⇒ 不加栅栏（保持旧行为，返回裸卡键）',
    build(() => '')('zkt2') === 'zkt2')
  check('currentSessionId 抛错 ⇒ 退化为裸卡键，异常不外泄',
    build(() => { throw new Error('x') })('zkt2') === 'zkt2')
  check('空/缺卡键不抛错', sidA(null) === '@sess-A' || sidA(null) === '', JSON.stringify(sidA(null)))

  // 反证：把栅栏摘掉
  const bad = buildKvKeyOf(mutateOnce(SRC, "k + '@' + sid", 'k'))
  checkRed('摘掉会话栅栏后，"键 = 卡键@会话" 必须报红',
    bad(() => 'sess-A')('zkt2') !== 'zkt2@sess-A', JSON.stringify(bad(() => 'sess-A')('zkt2')))
  checkRed('摘掉栅栏后，跨会话隔离也必须报红',
    bad(() => 'sess-A')('zkt2') === bad(() => 'sess-B')('zkt2'))
}

// ── 不变量 ②：`messageTargets` 必须只取当前可见会话（真的调 `muvIsVisibleInDom`）──

function buildMessageTargets(srcText, doc) {
  const code = ['muvIsVisibleInDom', 'messageRootOf', 'messageTargets']
    .map((n) => lift(srcText, n)).join('\n\n')
  // MSG_BODY_RE 是外层绑定：**逐字从源码取**，不在测试里抄一份会漂的正则
  const re = verbatimDecl(srcText, 'MSG_BODY_RE')
  const make = new Function('document', re + '\n' + code + '\nreturn messageTargets')
  return make(doc)
}

console.log('\n② messageTargets：把别的会话留在 DOM 里的隐藏消息剔掉（会话串台的护栏）')
{
  const bodies = threeBodies()
  const doc = { querySelectorAll: () => bodies }
  const targets = buildMessageTargets(SRC, doc)()

  check('不可见（0×0）的消息被剔掉', targets.length === 1, 'len=' + targets.length)
  check('留下的正是那条可见的', targets.length === 1 && targets[0].body === bodies[0])
  check('每条目标都带上消息根节点（root）', targets.length === 1 && targets[0].root === bodies[0])
  check('data-streaming 的消息也被剔掉（不装饰正在流入的那条）',
    !targets.some((t) => t.body === bodies[2]))

  // 静态侧：确认这是**调用**而不是"两个名字碰巧都在文件里"
  const rep = scopeReport({ src: SRC, name: 'messageTargets' })
  check('自由标识符里确实含 muvIsVisibleInDom（是调用关系）',
    rep.buckets.enclosing.includes('muvIsVisibleInDom'), rep.buckets.enclosing.join(','))
  const wr = wiringReport({
    src: SRC,
    entries: ['messageTargets'],
    provided: new Set(['MSG_BODY_RE', 'messageRootOf', 'muvIsVisibleInDom']),
  })
  check('把它当成一次搬迁并全部接线后：不漏名字（missing 为空）',
    wr.missing.length === 0, wr.missing.join(','))
  check('这条搬迁把可见性护栏算成**必须接线**的依赖（外层绑定不会自己跟过去）',
    wiringReport({ src: SRC, entries: ['messageTargets'], provided: new Set(['MSG_BODY_RE']) })
      .missing.includes('muvIsVisibleInDom'))

  // 反证：把可见性护栏摘掉
  const badDoc = { querySelectorAll: () => threeBodies() }
  const bad = buildMessageTargets(mutateOnce(SRC, 'if (!muvIsVisibleInDom(body)) continue', ''), badDoc)()
  checkRed('摘掉可见性护栏后，"只留 1 条" 必须报红（坏样本会取到 3 条）',
    bad.length !== 1, 'bad len=' + bad.length)
}

// ── 不变量 ③：depth 优先用权威楼号 `data-chat-turn`，拿不到才退回数渲染窗口 ──

/** `__DSH_TAVERN_CTX__` 桩：`turnOutline` 给有序楼表，`sessionStats` 给总楼数。 */
function ctxStub(total, first) {
  return {
    get(kind) {
      if (kind !== 'sessions') return null
      return {
        list: { getSnapshot: () => ({ current: 'sess-1' }) },
        manager: {
          get: () => ({
            projections: {
              rows: {
                get: (k) => k === 'turnOutline'
                  ? { value: Array.from({ length: total }, (_, i) => ({ turn: first + i })) }
                  : { value: { turns: total } },
              },
            },
          }),
        },
      }
    },
  }
}

function buildDecorator(srcText, o) {
  const code = ['muvDepthFromLaterCount', 'muvTurnOfEl', 'muvSessionTurnsNow', 'decorateMessages']
    .map((n) => lift(srcText, n)).join('\n\n')
  const make = new Function(
    'document', 'window', 'messageTargets', '_decorateOne',
    'var _decorating = false\n' + code + '\n' +
    'return { decorateMessages: decorateMessages,' +
    '  isDecorating: function () { return _decorating },' +
    '  setDecorating: function (v) { _decorating = v } }',
  )
  return make(o.document, o.window, o.messageTargets, o._decorateOne)
}

/** 楼号链条：把 `data-chat-turn` 放在**第 n 个祖先**上（n=0 就是元素自己）。 */
function chainWithTurnAt(n, turn) {
  let node = el({ attrs: { 'data-chat-turn': String(turn) } })
  for (let i = 1; i <= n; i++) node = el({ parent: node })
  return node
}

console.log('\n③ depth：优先「总楼数 − 本楼楼号」，拿不到权威来源才退回「数渲染窗口」')
{
  const roots = [chainWithTurnAt(0, 16), chainWithTurnAt(0, 15), chainWithTurnAt(0, 13)]

  const calls = []
  const d = buildDecorator(SRC, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: () => roots.map((r) => ({ body: r, root: r })),
    _decorateOne: async (t, depth, oldest) => { calls.push({ depth, oldest }) },
  })
  await d.decorateMessages()

  // 旧口径（数渲染窗口）= 2,1,0；权威口径 = 0,1,3 —— 两者在第 0 条上就分得开
  check('权威口径生效：depth = 总楼数 − 本楼楼号（16→0 / 15→1 / 13→3）',
    calls.length === 3 && calls[0].depth === 0 && calls[1].depth === 1 && calls[2].depth === 3,
    JSON.stringify(calls.map((c) => c.depth)))
  check('首楼判据也来自权威楼号（turn===first ⇒ 最旧那楼，而不是 i===0）',
    calls.length === 3 && calls[0].oldest === false && calls[2].oldest === true,
    JSON.stringify(calls.map((c) => c.oldest)))
  check('装饰条数不变（护栏只改 depth，不改取几条）', calls.length === 3)

  // 退回口径
  const fb = []
  const d2 = buildDecorator(SRC, {
    window: {},
    messageTargets: () => roots.map((r) => ({ body: r, root: r })),
    _decorateOne: async (t, depth, oldest) => { fb.push({ depth, oldest }) },
  })
  await d2.decorateMessages()
  check('拿不到 __DSH_TAVERN_CTX__ ⇒ 退回旧口径 2,1,0 且不报错',
    fb.length === 3 && fb.map((c) => c.depth).join(',') === '2,1,0',
    fb.map((c) => c.depth).join(','))
  check('退回口径时 oldest 也退回 i===0', fb[0].oldest === true && fb[2].oldest === false)

  // `muvTurnOfEl` 的向上查找与 8 跳上限
  const up = lift(SRC, 'muvTurnOfEl')
  const turnOf = new Function(up + '\nreturn muvTurnOfEl')()
  check('楼号从元素自己身上读到', turnOf(chainWithTurnAt(0, 13)) === 13)
  check('楼号能从祖先身上读到', turnOf(chainWithTurnAt(4, 42)) === 42)
  check('上限之内（第 7 个祖先）仍能读到', turnOf(chainWithTurnAt(7, 7)) === 7)
  check('超过上限（第 8 个祖先）读不到 ⇒ 返回 null，调用方据此退回旧口径',
    turnOf(chainWithTurnAt(8, 8)) === null)
  check('整条链上都没有 data-chat-turn ⇒ null', turnOf(el({ parent: el() })) === null)

  // 反证：把权威分支关掉
  const badD = buildDecorator(mutateOnce(SRC, 'if (turns && turn !== null) {', 'if (false) {'), {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: () => roots.map((r) => ({ body: r, root: r })),
    _decorateOne: async (t, depth, oldest) => { calls.length = 0; calls.push({ depth, oldest }) },
  })
  await badD.decorateMessages()
  checkRed('关掉权威分支后，depth 会退回 2,1,0 ⇒ "权威口径" 那条必须报红',
    calls.map((c) => c.depth).join(',') !== '0,1,3', calls.map((c) => c.depth).join(','))
}

// ── 不变量 ④：`_decorating` 置位/复位**成对**，重入被拦住 ────────────────

console.log('\n④ _decorating：置位/复位成对（含抛错路径），重入被拦住')
{
  const roots = [chainWithTurnAt(0, 16), chainWithTurnAt(0, 15), chainWithTurnAt(0, 13)]
  const targets = () => roots.map((r) => ({ body: r, root: r }))

  let duringFlags = []
  let nestedDone = 0
  let d
  d = buildDecorator(SRC, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: targets,
    _decorateOne: async () => {
      duringFlags.push(d.isDecorating())
      await d.decorateMessages()      // 重入：必须立刻返回，不许再装饰一遍
      nestedDone++
    },
  })
  await d.decorateMessages()

  check('装饰期间 _decorating 恒为 true（置位真的生效）',
    duringFlags.length === 3 && duringFlags.every(Boolean), JSON.stringify(duringFlags))
  check('装饰结束后复位为 false', d.isDecorating() === false, String(d.isDecorating()))
  check('重入被拦住：外层 3 条各自只装饰一次，重入那一路一条都没装饰',
    nestedDone === 3 && duringFlags.length === 3, 'nestedDone=' + nestedDone)

  // 抛错路径：finally 必须仍然复位
  let t2
  t2 = buildDecorator(SRC, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: targets,
    _decorateOne: async () => { throw new Error('boom') },
  })
  let threw = false
  try { await t2.decorateMessages() } catch (_) { threw = true }
  check('_decorateOne 抛错 ⇒ 异常照常外泄（不吞）', threw)
  check('_decorateOne 抛错 ⇒ finally 仍复位（否则整条装饰链从此卡死）',
    t2.isDecorating() === false, String(t2.isDecorating()))

  // 抛错之后还能不能再来一轮 —— 这一条要**真的 await**，不能只断言"返回了个 Promise"
  let secondRoundRan = false
  t2 = buildDecorator(SRC, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: targets,
    _decorateOne: async () => { secondRoundRan = true },
  })
  await t2.decorateMessages()
  check('抛错路径之后仍能正常装饰（复位是真的，不是假象）',
    secondRoundRan && t2.isDecorating() === false)

  // 反证：把 finally 里的复位摘掉。
  // ★ needle 必须**连 `} finally {` 一起写**：单独的 `_decorating = false` 在本文件里命中 2 次
  //   （L7857 的声明 + L8052 的复位）—— 只改声明的变异会让反证"看起来生效"却测错地方。
  // ★ 替换文本必须**保留 `try/finally` 结构**：整块删掉会变成 `try {}` 无 catch/finally，
  //   那是 `SyntaxError`（构建期就炸，测不到"复位缺失"这个行为），不是我们要的坏样本。
  const noReset = mutateOnce(SRC,
    '} finally {\n            _decorating = false\n          }',
    '} finally {\n            void 0\n          }')
  let t3
  t3 = buildDecorator(noReset, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: targets,
    _decorateOne: async () => {},
  })
  await t3.decorateMessages()
  checkRed('摘掉复位后，"结束后复位为 false" 必须报红（_decorating 会黏在 true）',
    t3.isDecorating() === true, String(t3.isDecorating()))

  let t4
  t4 = buildDecorator(noReset, {
    window: { __DSH_TAVERN_CTX__: ctxStub(16, 13) },
    messageTargets: targets,
    _decorateOne: async () => { throw new Error('boom') },
  })
  try { await t4.decorateMessages() } catch (_) {}
  checkRed('摘掉复位后，抛错路径也必须报红', t4.isDecorating() === true, String(t4.isDecorating()))
}

// ── 非空跑下限：证明上面那些"不含错误"的断言**真的在看东西** ──────────────

console.log('\n⑤ 非空跑下限（否则"没问题"可能只是"什么都没分析到"）')
{
  check('本次真的提取并执行了 ≥' + MIN_LIFTED + ' 个 client.js 函数',
    liftedNames.size >= MIN_LIFTED, 'lifted=' + liftedNames.size + ' [' + [...liftedNames].sort().join(',') + ']')
  check('tokenize 在整份 client.js 上规模正常（≥' + MIN_TOKENS + ' token）',
    tokenize(SRC).length >= MIN_TOKENS, String(tokenize(SRC).length))

  // 生成了跨会话键、且两个会话的键**确实不同**（不是两个空串在比相等）
  const k1 = buildKvKeyOf(SRC)(() => 'sess-A')('zkt2')
  const k2 = buildKvKeyOf(SRC)(() => 'sess-B')('zkt2')
  check('跨会话样本非空且真的不同（防"空 vs 空"式假绿）',
    k1.length > 0 && k2.length > 0 && k1 !== k2, k1 + ' | ' + k2)

  // 反证：喂空串 ⇒ 分析器必须**直接失败**，不许"空输入 ⇒ 空结果 ⇒ 全绿"
  let emptyThrew = false
  try { lift('', 'muvKvKeyOf') } catch (_) { emptyThrew = true }
  checkRed('喂空源码 ⇒ 提取器直接失败（所以上面的下限不是空转）', emptyThrew)

  let reportThrew = false
  try { scopeReport({ src: '', name: 'muvKvKeyOf' }) } catch (_) { reportThrew = true }
  checkRed('喂空源码 ⇒ scopeReport 直接失败（不许静默返回空集合）', reportThrew)

  const emptyWiring = wiringReport({ src: '', entries: ['muvTurnOfEl'], provided: new Set() })
  checkRed('喂空源码 ⇒ wiringReport **点名**它找不到入口（而不是 missing=[] 的空绿）',
    emptyWiring.missing.includes('muvTurnOfEl'), JSON.stringify(emptyWiring.missing))
}

// ── ⑥ 两种 EOL 形态：判据必须在"默认 clone（CRLF）"下也跑得起来 ────────────

console.log('\n⑥ 两种 EOL 形态（CI 是 LF、Windows 普通 clone 是 CRLF —— 不许只在一种形态下绿）')
{
  // 拿真实源码造一份 CRLF 形态的等價样本（只改行尾，不改任何字符）
  const CRLF = SRC.replace(/\n/g, '\r\n')
  check('CRLF 样本确实与 SRC 不同、且只差 \\r（换算正确）',
    CRLF !== SRC && CRLF.length === SRC.length + SRC.split('\n').length - 1,
    SRC.length + ' -> ' + CRLF.length)

  // ★ 归一化真的在起作用（不是空操作）：同一颗 needle 在 CRLF 原文里**命中 0 次**，
  //   归一化之后必须命中。如果哪天有人把 lf() 去掉，这一对断言立刻报红。
  const needle = '} finally {\n            _decorating = false\n          }'
  const rawHits = CRLF.split(needle).length - 1
  const lfHits = lf(CRLF).split(needle).length - 1
  check('CRLF 原文里该 needle 命中 0 次（所以"不归一化"这条是**真的会红**）',
    rawHits === 0, 'rawHits=' + rawHits)
  check('归一化之后命中 1 次（归一化是有效变换，不是空操作）', lfHits === 1, 'lfHits=' + lfHits)

  // 走过完整判据链：CRLF 输入下，四条不变量的入口都必须照常工作
  const kv = buildKvKeyOf(CRLF)(() => 'sess-A')
  check('CRLF 形态下 muvKvKeyOf 照常提取并工作', kv('zkt2') === 'zkt2@sess-A', JSON.stringify(kv('zkt2')))

  const reps = scopeReport({ src: CRLF, name: 'muvTurnOfEl' })
  check('CRLF 形态下 scopeReport 照常给出结论（不是空集合）', reps.freeNames.length > 0,
    JSON.stringify(reps.freeNames))

  const wr = wiringReport({
    src: CRLF, entries: ['muvKvKeyOf'], provided: new Set(['currentSessionId']),
  })
  check('CRLF 形态下 wiringReport 照常判绿（missing 为空）', wr.missing.length === 0, wr.missing.join(','))

  // ★ 最要紧的一处：带 `\n` + 缩进的 needle 在 CRLF 形态下必须仍能命中
  const mutated = mutateOnce(CRLF, 'if (!muvIsVisibleInDom(body)) continue', '')
  check('CRLF 形态下 mutateOnce 仍能命中（这是"默认 clone 红"的那个原始故障点）',
    mutated.indexOf('muvIsVisibleInDom(body)') < 0)

  // 整条不变量②在 CRLF 形态下走一遍
  const bodies = threeBodies()
  const targetsCrlf = buildMessageTargets(CRLF, { querySelectorAll: () => bodies })()
  check('CRLF 形态下不变量②照常成立（只留 1 条可见）', targetsCrlf.length === 1, 'len=' + targetsCrlf.length)
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
