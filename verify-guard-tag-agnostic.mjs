// verify-guard-tag-agnostic.mjs
//
// 守卫门禁：`beautifyMuv` 开头那条「有没有标记可装饰」的判据，必须是**标签无关**的。
//
// ── 为什么需要这个文件 ──────────────────────────────────────────────────────
// 那条判据以前是一份**手写枚举**：
//   if (!/<StatusPlaceHolder|<UpdateVariable|<Prism|<Status_?Block|<choices?\b|…/i.test(text)) return text
// 它已经漏过两次，两次症状一模一样（整轮**在取卡之前**原样返回 ⇒ 用户看到"纯文本"，
// 而且没有任何报错）：
//   第一次：漏 `<content>` / `<now_plot>`（本项目自己的输出信封）—— 上一轮补进枚举；
//   第二次：漏 `<video>` / `<img>`（本轮实测）。真实角色扮演会话
//     `session-c98dfb13-…`（卡 = `_足控天堂2`）里：
//       · 上一轮正文含 `<content>`+`<video>`+`<img>` ⇒ 旧枚举放行 ⇒ 整页文档 iframe、
//         视频、插图全都出来；
//       · 紧接着的下一轮正文里只有 `<audio>欢快</audio>` ⇒ 旧枚举一个都不认 ⇒
//         整轮跳过 ⇒ 用户看到的就是裸 `<audio>`（截图里那个）。
//   枚举注定继续漏（标记由**卡**决定，卡随时新增），所以本轮把它换成形状判据。
//
// ── 测的是什么 ─────────────────────────────────────────────────────────────
// 被测对象是**用户看到的那条链**：`_decorateOne` → `beautifyMuv`(守卫) →
// `fetchTavernCard()` → `POST /api/muv-engine/apply-regex-card` → 写回 DOM。
// 做法：真 Edge + 真 DOM + 真实 `lib/client.js` 内联 + **真实卡**（`_足控天堂2.png`
// 的 10 条正则）+ **真实助手正文**（从会话存档逐字抠出来的，见 verify-guard-samples.json）。
// `fetch` 打桩只替换三个端点，其中 `apply-regex-card` 用的是**同一个真引擎**
// （`lib/regex-engine.js` 内联进页面），不是手写等价物 —— 这样 placement/depth
// 语义（[8] 的 minDepth:7、[9] 的 maxDepth:3）与真服务端逐字一致。
//
// 真机时序也是复刻的（这一点决定了测出来的是不是真行为）：
//   ① 消息先以**半截正文**进 DOM，还带 `data-streaming` ⇒
//      sanitize pass 会在这一刻跑并给元素打上 `data-muv-sanitized`，
//      而装饰链因为 `[data-streaming]` **跳过**（`_decorateOne` 里有这一条）；
//   ② 流式结束：补全正文、去掉 `data-streaming` ⇒ 装饰链这才动手。
//   ⇒ 补全后的正文里那些标签**不会被 sanitize pass 再处理**（标记已置）。
//   这正是用户那一轮的处境：裸 `<audio>` 一路留到装饰链手上。
//
// ── 断言（每条都能红） ─────────────────────────────────────────────────────
//   S 静态臂：守卫判据的命中面 = 卡的 10 条脚本认的全部标记形态 + 媒体 + 中性文本不误命中
//   E 引擎臂：真卡 + 真正文 —— C 用例只带 `<video>`/`<img>`（无信封）时确实被映射成真 URL
//   B 浏览器臂（before/after 两跑）：
//     B1 C 用例：AFTER 出真 `<video>`/`<img>` 元素、BEFORE 不出（= 本轮的收益，带数字）
//     B2 A 用例（真实裸 <audio> 那一轮）：AFTER 取卡 + 占位符补齐后卡 [2] 命中出 ERA
//        iframe（2026-09-22 判据更新，旧"DOM 不变"判据已随占位符补齐失效，见 B2 注释）；
//        BEFORE 仍整楼跳过（对照臂）。
//     B3 D 用例（真实纯散文，1300+ 字）：两臂都不取卡、DOM 不变（反向用例：不许过度放宽）
//     B4 E 用例（`3 < 5` / `a <= b` / `1 <2` / `x <y`）：两臂都不取卡（判据不误命中）
//     B5 前置：真卡 10 条脚本进了页面；C 用例的产物 URL 与引擎臂逐字一致
//     B7 G 用例（「【主页】」，2026-09-22 新增）：AFTER 为它取卡、卡 [0] 命中（applied>=1）、
//        产出 iframe（``` 包裹的整页文档 → renderFencedHtml）；BEFORE 三项全 0（对照臂）。
//        —— 第三次漏（占位符 greeting）的修复证明；静态侧对应"决策臂"。
//
// ── 能红的证据（3 种破坏法，任一都必须让本门禁红） ─────────────────────────
//   ① 把守卫改回旧枚举      ⇒ --break=guard-enum
//   ② 把守卫改成"恒不通过"  ⇒ --break=guard-never
//   ③ 把修法做成空操作（BEFORE==AFTER）⇒ 门禁自己就会红（before 臂的期望落空）
// 跑法：$env:MUV_EDGE="…\msedge.exe"; node verify-guard-tag-agnostic.mjs
//       node verify-guard-tag-agnostic.mjs --break=guard-enum    （期望红）
//       node verify-guard-tag-agnostic.mjs --break=guard-never   （期望红）
//
// 对照臂：BEFORE = 把**当前源码**的守卫**块**（标签判据 + 短文本放行）换回旧枚举单行，
//         所以它隔离的正是"本轮守卫语义"这一个变量，不是"某个旧版本"。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyAllRegexScripts, regexScriptsOf, extractStatusBarHtml } from './lib/regex-engine.js'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_PATH = process.env.MUV_CLIENT_SRC || path.join(__dirname, 'lib', 'client.js')
const ENGINE_PATH = path.join(__dirname, 'lib', 'regex-engine.js')
const SAMPLES_PATH = path.join(__dirname, 'verify-guard-samples.json')
const CARD_PNG = process.env.MUV_GUARD_CARD
  || 'C:/MySpecialFolder/SillyTavern/data/default-user/characters/_足控天堂2.png'
const EDGE = process.env.MUV_EDGE
const OUT = path.join(os.tmpdir(), 'muv-guard-tag-agnostic')
fs.mkdirSync(OUT, { recursive: true })

const BREAK = (() => {
  const a = process.argv.find((x) => x.startsWith('--break='))
  return a ? a.slice('--break='.length) : ''
})()

// ── 旧枚举（改动前那一行，逐字）──────────────────────────────────────────
// 这一段就是"第二次漏"的那份名单：它认 `<content>`/`<now_plot>`（第一次补的），
// 但不认 `<video>`/`<img>`/`<audio>`/中文标签。BEFORE 臂与 --break=guard-enum 都用它。
const OLD_GUARD_SRC = '/<StatusPlaceHolder|<\\/?now_plot\\b|<\\/?content\\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\\b|<Variable(?:Edit|Insert|Think)\\b|<Abstract\\b/i'

let pass = 0
let fail = 0
const failed = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; failed.push(name); console.log('  FAIL ' + name + (detail === undefined ? '' : '  -> ' + detail)) }
}
const note = (s) => console.log('  NOTE ' + s)

// ── 源码变换：守卫块 ────────────────────────────────────────────────────────
// 守卫现在是**一个小块**（2026-09-22 起）：标签判据（`muvHasTag`）+ 短文本放行
// （`muvShortOk`，占位符 greeting「【主页】」那一档）+ 合成守卫行。三个提取函数都按块工作。
//
// ★ 2026-09-23（第 35 轮）合成行多了**第三项** `!muvTsShaped`（文本级状态栏形态：
//   消息开头的连续裸 `[键:值]` / 状态折叠块）。所以这里的行匹配放宽成
//   「前缀固定 + 任意多个 `&& !名字`」，**不写死项数** —— 下次再加一项时，
//   `--break=guard-enum` 的对照臂不会因为"找不到守卫行"而抛异常（抛异常会盖住真正的
//   失败项，本轮就是这么被发现漏改的）。
const GUARD_LINE_RE = /^\s*if \(!muvHasTag && !muvShortOk(?:\s*&&\s*![A-Za-z_$][\w$]*)*\) return text\s*$/

function guardLineIndex(src) {
  const lines = src.split('\n')
  const i = lines.findIndex((l) => GUARD_LINE_RE.test(l))
  if (i < 0) throw new Error('在源码里找不到守卫行（形如 `if (!muvHasTag && !muvShortOk[ && !…]) return text`）')
  return i
}

function tagdefLineIndex(src) {
  const lines = src.split('\n')
  const i = lines.findIndex((l) => /^\s*var muvHasTag = \//.test(l))
  if (i < 0) throw new Error('找不到 muvHasTag 定义行')
  return i
}

/** 取出标签判据的**字面量原文**（`/…/` 那种），用于静态臂求值。
 *
 *  ★ 从 `SRC_RAW`（未经 `--break` 改写的原文）里读，**不是**从改写后的 `SRC`：`--break=guard-enum`
 *    的 `revertGuard` 会把整个守卫块（含 `var muvHasTag = …` 那一行）换成旧枚举单行，
 *    于是从 `SRC` 里再也取不到它 —— 破坏臂会在**提取阶段**抛异常，而不是让断言变红。
 *    那正是"门禁自己也有洞"那一类（HANDOFF §22.3）：报错盖住真正的失败项。
 *    `neverGuard` 只换合成行，两种模式读原文都对。 */
function guardLiteralOf(src) {
  const line = SRC_RAW.split('\n')[tagdefLineIndex(SRC_RAW)]
  const m = /var muvHasTag = (\/[\s\S]*?\/[a-z]*)\.test\(text\)/.exec(line)
  if (!m) throw new Error('取不出守卫正则字面量：' + line.trim())
  return m[1]
}

/** 短文本放行的阈值**从源码里读**，不写死 —— 门禁判据不许复制实现里的数字。
 *  ★ 同样读 `SRC_RAW`：那两个阈值在 `revertGuard` 换掉的那一块里（原因同上）。 */
function shortBoundsOf() {
  const m = /muvTrimmedLen > (\d+) && muvTrimmedLen <= (\d+)/.exec(SRC_RAW)
  if (!m) throw new Error('取不出短文本放行阈值（muvTrimmedLen > n && <= m）')
  return { min: Number(m[1]), max: Number(m[2]) }
}

/** BEFORE 臂：把守卫**块**（muvHasTag 定义行 → 守卫行，含短文本分支）整体换回旧枚举单行，
 *  其余一个字节都不动 —— 它隔离的正是"本轮守卫语义"这一个变量。 */
function revertGuard(src) {
  const lines = src.split('\n')
  const i = guardLineIndex(src)
  const j = tagdefLineIndex(src)
  if (j > i) throw new Error('守卫块行序异常：muvHasTag 定义行不在守卫行之前')
  lines.splice(j, i - j + 1, '      if (!' + OLD_GUARD_SRC + '.test(text)) return text')
  return lines.join('\n')
}

/** 破坏法②：守卫恒不通过（判据换成"只有全空白才算没有标记" ⇒ 任何正文都被原样返回）。
 *  刻意**保留**那一行的形状（`if (!/<…>/.test(text)) return text`），这样静态臂还能把
 *  判据抠出来，红的是断言、而不是提取器抛异常 —— 报错行不会盖住真正的失败项。 */
function neverGuard(src) {
  const lines = src.split('\n')
  const i = guardLineIndex(src)
  lines[i] = '      if (!/^\\s*$/.test(text)) return text'
  return lines.join('\n')
}

const SRC_RAW = fs.readFileSync(SRC_PATH, 'utf8')
let SRC = SRC_RAW
if (BREAK === 'guard-enum') SRC = revertGuard(SRC_RAW)
else if (BREAK === 'guard-never') SRC = neverGuard(SRC_RAW)
else if (BREAK) { console.log('未知的 --break=' + BREAK); process.exit(2) }
console.log('=== 守卫门禁（标签无关判据）===' + (BREAK ? '   [--break=' + BREAK + ']' : ''))
console.log('  源码: ' + SRC_PATH + (BREAK ? '（已被 --break 改写）' : ''))

// ── 真实样本 ───────────────────────────────────────────────────────────────
const SAMPLES = JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8'))
const sha16 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16)

console.log('\n=== ① 真实样本（不是合成夹具）===')
for (const k of ['audioOnly', 'mediaEnvelope', 'proseOnly']) {
  const want = SAMPLES._provenance.sha256_16[k]
  const got = sha16(SAMPLES[k])
  check('样本 ' + k + ' 与生成器记录的哈希一致（' + SAMPLES[k].length + ' 字, sha16=' + got + '）', got === want, 'want=' + want)
}
console.log('  来源会话: ' + SAMPLES._provenance.session + '  项目: ' + SAMPLES._provenance.project)
console.log('  判据: ' + JSON.stringify(SAMPLES._provenance.criteria, null, 0))

// ── 用例正文（innerText 近似：DSH 渲染后 markdown 记号已不在文本里）────────
const innerText = (t) => t.split('\n').map((l) => l.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '')).join('\n')
const imgLine = /<img>[^<\n]*<\/img>/.exec(SAMPLES.mediaEnvelope)[0]
const videoLine = /<video>[^<\n]*<\/video>/.exec(SAMPLES.mediaEnvelope)[0]
const CASES = [
  // A：真实失败样本本体（裸 <audio>，无信封）
  { id: 'A_audio_real', full: innerText(SAMPLES.audioOnly) },
  // B：同一会话上一轮（含 <content>，旧枚举也放行）= 参照组
  { id: 'B_media_envelope', full: innerText(SAMPLES.mediaEnvelope) },
  // C：**真实散文 + 真实媒体行**，但把信封去掉 —— 旧枚举整轮跳过的那一档
  { id: 'C_media_bare', full: innerText(SAMPLES.proseOnly) + '\n\n' + imgLine + '\n\n' + videoLine },
  // D：真实纯散文（一个 < 都没有）
  { id: 'D_prose_real', full: innerText(SAMPLES.proseOnly) },
  // E：带"像小于号但不是标签"的文本
  { id: 'E_lt_notag', full: innerText(SAMPLES.proseOnly) + '\n\n账上 3 < 5，a <= b，1 <2，x <y。' },
  // F：**对照** —— 同一段 `<audio>` 正文，但一开始就是**完整**进 DOM 的（没有"半截"阶段），
  //    于是 sanitize pass 有机会在元素**还没被打标**的时候看到裸 `<audio>`。
  //    A 与 F 唯一的差别就是 sanitize 有没有机会跑，用来把"用户为什么看到裸标签"钉成事实：
  //    引擎侧**是有** `<audio>` → 🎵 这条路的（muvRenderMediaTags），只是流式那一轮没走到。
  { id: 'F_audio_fresh', full: innerText(SAMPLES.audioOnly), noRestage: true },
  // G：**占位符 greeting**（第三次漏的本体）。first_mes 只是「【主页】」这样的纯短文本，
  //    靠卡 [0]「主页」的显示层正则换成 ``` 包裹的整页 HTML（ST 的首楼就是完整卡界面）。
  //    守卫不放行它 ⇒ 首楼永远只有占位符原文、没有卡界面。
  { id: 'G_home_greeting', full: '【主页】' },
]
// F 那一档**不切片**：它模拟的是"消息一次性完整渲染"（没有流式阶段），
// 所以一开始就是完整正文，sanitize pass 有机会在元素未被打标时看到裸 `<audio>`。
for (const c of CASES) c.partial = c.noRestage ? c.full : c.full.slice(0, 120)
console.log('\n  用例: ' + CASES.map((c) => c.id + '(' + c.full.length + ')').join(', '))
console.log('  C 用例的两个媒体行逐字取自 B 那一轮: ' + JSON.stringify(imgLine) + ' / ' + JSON.stringify(videoLine))

// ── 真实卡 ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(CARD_PNG)) { console.log('\n找不到真卡：' + CARD_PNG + '（可设 MUV_GUARD_CARD）'); process.exit(2) }
const card = readPngCard(CARD_PNG)
const SCRIPTS = regexScriptsOf(card)
const CARD_JSON = { ok: true, found: true, name: path.basename(CARD_PNG, '.png'), regexScripts: SCRIPTS, data: card.data }
if (!SCRIPTS.length) { console.log('\n真卡里没有正则脚本，门禁测的是空气'); process.exit(2) }

// ── ② 静态臂：守卫判据的命中面 ─────────────────────────────────────────────
console.log('\n=== ② 静态臂：标签判据 = ' + guardLiteralOf(SRC_RAW) + ' ===')
const guardRe = new Function('return ' + guardLiteralOf(SRC_RAW))()
// 完整守卫决策（与 lib/client.js 守卫块同形状）：有 HTML 标签 → 放行；
// 无标签但去首尾空白后落在短文本区间 → 也放行（占位符 greeting 那一档）。
// 阈值从源码里提取（shortBoundsOf），不在门禁里复制数字。
const SHORTS = shortBoundsOf()
console.log('  短文本放行区间: (去空白后) > ' + SHORTS.min + ' 且 <= ' + SHORTS.max)
const guardPass = (t) => guardRe.test(t) || (() => {
  const n = String(t).trim().length
  return n > SHORTS.min && n <= SHORTS.max
})()
const POSITIVE = [
  ['卡 [6] 视频（路径形态）', '<video>SFW/超天酱/初次登场1</video>'],
  ['卡 [9] 插图（路径形态）', '<img>地图/公司办公室</img>'],
  ['卡 [6] 产物（带 src）', '<video src="https://x/y.mp4" controls preload="metadata"></video>'],
  ['卡 [9] 产物（带 src）', '<img src="https://x/y.webp" alt="a" />'],
  ['裸音频提示词（用户截图那个）', '<audio>欢快</audio>'],
  ['信封 <content>（旧枚举认得）', '<content>'],
  ['信封闭合 </now_plot>（只有闭合标签）', '</now_plot>'],
  ['状态栏占位符', '<StatusPlaceHolderImpl/>'],
  ['<Status_block>', '<Status_block>'],
  ['<choices>', '<choices>'],
  ['<Abstract>', '<Abstract>'],
  ['<VariableThink>', '<VariableThink>'],
  ['<variableinsert>（小写）', '<variableinsert>'],
  ['<VariableDelete>（卡 [3] 的第三个分支，旧枚举也漏）', '<VariableDelete>{}</VariableDelete>'],
  ['<variabledelete>（小写）', '<variabledelete>{}'],
  ['<era_data>', '<era_data>'],
  ['<JSONPatch>', '<JSONPatch>'],
  ['中文标签 <插图>', '<插图>海边</插图>'],
  ['中文标签 <赏令接取>（社区卡）', '<赏令接取>大赏</赏令接取>'],
  ['整页文档开头', '<!DOCTYPE html>'],
  ['闭合标签 </div>', '</div>'],
]
const NEGATIVE = [
  ['算术：2 < 3', '他看到 2 < 3 就想反驳。'],
  ['比较：a <= b', '条件写成 a <= b 才算对。'],
  ['数字紧跟：1 <2', '他还说了一句 1 <2。'],
  ['后面没有 `>`：x <y', '这行是 x <y 没有收尾。'],
  ['汉字前的空格：血 < 300', '血 < 300 就该报警。'],
  ['真实纯散文（整段）', innerText(SAMPLES.proseOnly)],
  ['真实散文 + 小于号冒充的比较', innerText(SAMPLES.proseOnly) + '\n账上 3 < 5 而 <= 是真的。'],
]
for (const [label, t] of POSITIVE) {
  check('标签判据放行：' + label, guardRe.test(t) === true, JSON.stringify(t.slice(0, 60)))
}
for (const [label, t] of NEGATIVE) {
  // 这里只钉**标签判据本身**不误命中；完整决策另见下面的决策臂
  //（短散文现在会被"短文本放行"分支放行，那是有意的新语义，不是误命中）。
  check('标签判据不命中：' + label, guardRe.test(t) === false, JSON.stringify(t.slice(0, 60)))
}
// ── ②b 决策臂：守卫决策的前两项（标签 ∨ 短文本）──
// 第三次漏的本体：占位符 greeting（first_mes 只是「【主页】」这类纯短文本，
// 靠卡 [0]「主页」的显示层正则换成 ``` 包裹的整页 HTML）。标签判据不认它，
// 只有"短文本放行"分支能救 —— 下面两条决策放行 + 两条决策不放行 + 对照臂。
//
// ★ 第 35 轮起合成行还有**第三项**（`!muvTsShaped`，文本级状态栏形态）。这里只重建
//   前两项（第三项是 client 侧那两个纯函数，逐字提取它们的成本不值当）。所以后面
//   显式钉一条：**只靠前两项，文本级状态栏形态是过不去的** —— 那份行为由
//   `test-client-render.mjs`[22]/[24] 与 `verify-decorate-dom.mjs` 的 I/J 承担。
console.log('  ── ②b 决策臂：守卫决策的前两项（标签 ∨ 短文本）──')
const DEC_POSITIVE = [
  ['占位符 greeting「【主页】」（纯文本、无标签）', '【主页】'],
  ['占位符 greeting「星盟契约开场白」（7 字）', '星盟契约开场白'],
  ['短正文（无标签的普通短消息）', '他推开门，风灌了进来。'],
]
const DEC_NEGATIVE = [
  ['长散文（301 字、无标签）—— 长散文不取卡，防守卫退化成全放行', '深'.repeat(301)],
  ['纯空白（没有任何可装饰的东西，不值得一次取卡）', '   \n  '],
]
for (const [label, t] of DEC_POSITIVE) {
  check('决策放行：' + label, guardPass(t) === true, JSON.stringify(t.slice(0, 40)))
}
for (const [label, t] of DEC_NEGATIVE) {
  check('决策不放行：' + label, guardPass(t) === false, JSON.stringify(t.slice(0, 40)))
}
// ★ 对照臂（能红）：同样的占位符 greeting，**只看标签**的旧决策必须拦住 ——
//   否则说明"短文本放行"分支没有承担任何工作，这条修法是空转。
check('★ 对照臂：占位符 greeting 在旧决策（只看标签）下确实被拦（判据不是空转）',
  guardRe.test('【主页】') === false && guardRe.test('星盟契约开场白') === false)
// ★ 第 35 轮：文本级状态栏形态（消息开头连续裸 `[键:值]` + 长正文，既无标签也 > 300 字）
//   必须**由第三项**放行 —— 所以"只重建前两项"的这个 decide 应当**不放行**它。
//   这条同时说明：本臂的重建是**不完整**的（如实记录），第三项的行为在别处钉。
{
  const LONG_TS = '[时间:5月14日|星期三][季节:初夏][天气:夜间大雨][时间段:晚上20:41]'
    + '[地点:暮川市·旧片区·富江的独宅·厨房]\n' + '她把他从自己腿间推开的时候…'.repeat(20)
  check('★ 对照臂：只靠「标签 ∨ 短文本」两项，文本级状态栏形态**不**放行' +
    '（第三项 !muvTsShaped 才是承担它的那一条）', guardPass(LONG_TS) === false)
  check('★ 同时：这段文本也不是纯散文形态（长度 > 300 且无标签 ⇒ 只可能由第三项救）',
    LONG_TS.indexOf('<') === -1 && LONG_TS.trim().length > 300)
}
// 如实记录的残余（不是漏，是**已知不覆盖**；写在这里是为了它不能悄悄变化）
console.log('  ── 已知不覆盖（如实记录，不作断言的地方会打印出来）──')
note('`【主页】` 这类**非标签**形态的卡标记不在判据里；命中的 `guardRe.test("【主页】")` = ' + guardRe.test('【主页】'))
{
  const oldRe = new Function('return ' + OLD_GUARD_SRC)()
  const missedByOld = [...POSITIVE, ...NEGATIVE].filter(([, t]) => !oldRe.test(t)).length
  check('对照：同样这批文本，旧枚举漏掉的条数 > 0（证明本门禁测的是真差异）', missedByOld > 0, '旧枚举漏掉 ' + missedByOld + ' 条')
  console.log('    旧枚举漏掉的用例: ' + POSITIVE.filter(([, t]) => !oldRe.test(t)).map(([l]) => l).join(' | '))
}

// ── ③ 引擎臂：真卡 + 真正文，逐用例量 applied 与映射出的 URL ───────────────
console.log('\n=== ③ 引擎臂（真引擎 + 真卡 ' + SCRIPTS.length + ' 条脚本）===')
const engineOut = {}
for (const c of CASES) {
  const r = applyAllRegexScripts(c.full, SCRIPTS, 'display', { depth: undefined })
  const urls = [...new Set(r.text.match(/https:\/\/zyxjack123\.top\/[^"'\s>]*/g) || [])]
  engineOut[c.id] = { applied: r.applied, len: r.text.length, urls }
  check('占位符前置断言（' + c.id + '）：正文里没有 <StatusPlaceHolderImpl/>，所以 statusBarHtml 的差异是惰性的',
    !/<StatusPlaceHolderImpl\s*\/>/.test(c.full))
  console.log('    ' + c.id.padEnd(18) + ' applied=' + r.applied + ' outLen=' + r.text.length + ' urls=' + JSON.stringify(urls.slice(0, 3)))
}
check('★ C 用例（只带 <video>/<img>、无信封）被真卡映射出视频 URL',
  engineOut.C_media_bare.urls.some((u) => u.indexOf('/视频/') >= 0 && u.indexOf('.mp4') > 0),
  JSON.stringify(engineOut.C_media_bare.urls))
check('★ C 用例被真卡映射出插图 URL',
  engineOut.C_media_bare.urls.some((u) => u.indexOf('/插图/') >= 0 && u.indexOf('.webp') > 0),
  JSON.stringify(engineOut.C_media_bare.urls))
check('A 用例（真实裸 <audio> 那一轮）真卡**一条脚本都不命中**（applied=0）⇒ 守卫修好也不美化它',
  engineOut.A_audio_real.applied === 0, 'applied=' + engineOut.A_audio_real.applied)
check('D/E 用例真卡 0 命中（纯散文不该被改写）',
  engineOut.D_prose_real.applied === 0 && engineOut.E_lt_notag.applied === 0,
  'D=' + engineOut.D_prose_real.applied + ' E=' + engineOut.E_lt_notag.applied)

// ── ④ 浏览器臂 ─────────────────────────────────────────────────────────────
const ENGINE_INLINE = fs.readFileSync(ENGINE_PATH, 'utf8')
  .replace(/^export /gm, '')
  .concat('\nwindow.__MUVE = { applyAllRegexScripts: applyAllRegexScripts, regexScriptsOf: regexScriptsOf, extractStatusBarHtml: extractStatusBarHtml };\n')

/** HTML 转义 + 段落成块（复刻 DSH 的 markdown 产物形态：`<p>` 块 + `<strong>`）。
 *  ★ 只转义**一次**：DSH 的 markdown 把裸 HTML 变成**文本节点**（DOM 里 `innerHTML`
 *    序列化成 `&lt;audio&gt;`，而 `innerText` 读出来是真正文 `<audio>`）。
 *    转义两次的话正文里剩的是 `&lt;audio&gt;` 那串字面量，守卫判据与卡脚本全都认不出来 ——
 *    门禁会变成"测了个假对象"（本轮第一版就是这么踩的：五个用例 0 次取卡）。 */
function toBlocks(text, esc) {
  const paras = String(text).split(/\n{2,}/)
  const one = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return paras.map((p) => {
    const lines = p.split('\n')
    if (lines.length === 1 && /^#{1,6}\s+\S/.test(lines[0])) return '<h4>' + one(lines[0].replace(/^#{1,6}\s+/, '')) + '</h4>'
    return '<p>' + lines.map(one).join('<br>') + '</p>'
  }).join('')
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fixturePage(clientSource) {
  const client = clientSource.replace(/<\/script/gi, '<\\/script')
  const engine = ENGINE_INLINE.replace(/<\/script/gi, '<\\/script')
  const cases = CASES.map((c) => ({ id: c.id, partial: c.partial, full: c.full, noRestage: !!c.noRestage }))
  const hosts = CASES.map((c, i) =>
    '<div class="host" data-streaming="1"><div id="msg_' + c.id + '" class="_markdown_abc123_' + (i + 1) + '"></div></div>'
  ).join('\n')
  const driver = (`
(function () {
  var NOTES = [], REQUESTS = [], APPLY = []
  var CASES = ${JSON.stringify(cases)}
  var CARD = ${JSON.stringify(CARD_JSON)}
  var SID = 'session-guardtest-1111-2222-3333-444444444444'
  var SVC = { list: { getSnapshot: function () { return { current: SID } } } }
  window.__DSH_TAVERN_SESSIONS__ = SVC
  window.__DSH_TAVERN_CTX__ = { get: function (n) { return n === 'sessions' ? SVC : null } }
  function ok(o) { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(o) } }) }
  window.fetch = function (url, opts) {
    var u = String(url)
    if (u.indexOf('/api/tavern/current-session') === 0) return ok({ ok: true, sessionId: SID, presetId: 'preset-guardtest' })
    if (u.indexOf('/api/muv-table/tavern-card') === 0) { REQUESTS.push(u); return ok(CARD) }
    if (u.indexOf('/api/muv-engine/apply-regex-card') === 0) {
      var req = {}
      try { req = JSON.parse(opts.body) } catch (e) {}
      var text = String(req.text == null ? '' : req.text)
      var scripts = window.__MUVE.regexScriptsOf(req.cardJson)
      var r = window.__MUVE.applyAllRegexScripts(text, scripts, 'display', { depth: req.depth })
      APPLY.push({
        head: text.slice(0, 26), len: text.length, applied: r.applied,
        urls: (String(r.text).match(/https:\\/\\/zyxjack123\\.top\\/[^"'\\s>]*/g) || []).slice(0, 4),
      })
      // statusBarHtml 有意为 null：本夹具每一条都没有占位符（门禁静态臂里断言了这一点），
      // 所以「服务端会回 210KB 状态栏皮肤」这个差异在这里是惰性的。
      return ok({ ok: true, text: r.text, applied: r.applied, statusBarHtml: null })
    }
    return Promise.reject(new Error('stub: unexpected url ' + u))
  }
  function blocks(text) { return ${toBlocks.toString()}(text, window.__escGuardFixture) }
  window.__escGuardFixture = ${esc.toString()}
  var byId = {}
  for (var i = 0; i < CASES.length; i++) byId[CASES[i].id] = CASES[i]
  // 阶段一：半截正文（= 流式中的 DOM）
  for (var k = 0; k < CASES.length; k++) {
    var el0 = document.getElementById('msg_' + CASES[k].id)
    el0.innerHTML = blocks(CASES[k].partial)
  }
  var exports = null
  try {
    exports = window.__mod.factory(function () { return {} })
    NOTES.push('factory=ok')
    if (exports && typeof exports.apply === 'function') { exports.apply(); NOTES.push('apply=ok') }
    else NOTES.push('apply=MISSING')
  } catch (e) { NOTES.push('boot=THROW:' + e.message) }
  var marked = 0
  var hosts = document.querySelectorAll('.host')
  for (var h = 0; h < hosts.length; h++) if (hosts[h].querySelector('[data-muv-sanitized]')) marked++
  NOTES.push('sanitize 已在半截正文上打标: ' + marked + '/' + hosts.length)
  NOTES.push('半截阶段已有装饰标记: ' + document.querySelectorAll('[data-muv-decorated]').length)
  // 阶段二：流式结束 —— 补全正文、去掉 data-streaming，装饰链这才动手
  setTimeout(function () {
    for (var j = 0; j < CASES.length; j++) {
      if (CASES[j].noRestage) continue   // F 那一档：一开始就是完整正文，不再重灌
      var el = document.getElementById('msg_' + CASES[j].id)
      el.removeAttribute('data-muv-decorated')
      el.innerHTML = blocks(CASES[j].full)
      var host = el.parentNode
      host.removeAttribute('data-streaming')
    }
    NOTES.push('半截→补全 已切换；此前的取卡次数=' + REQUESTS.length)
    for (var m = 0; m < CASES.length; m++) {
      var em = document.getElementById('msg_' + CASES[m].id)
      if (CASES[m].noRestage && em && em.parentNode) em.parentNode.removeAttribute('data-streaming')
      try { window.MuvEngine.decorateMessage(em) }
      catch (e) { NOTES.push('decorate(' + CASES[m].id + ')=THROW:' + e.message) }
    }
    setTimeout(emit, 2500)
  }, 600)
  function cnt(el, sel) { try { return el.querySelectorAll(sel).length } catch (e) { return -1 } }
  function snap(c) {
    var el = document.getElementById('msg_' + c.id)
    var html = el ? el.innerHTML : ''
    var txt = el ? (el.innerText || el.textContent || '') : ''
    return {
      id: c.id, decorated: el ? el.getAttribute('data-muv-decorated') : null,
      sanMarked: el ? el.hasAttribute('data-muv-sanitized') : null,
      htmlLen: html.length,
      videoEls: cnt(el, 'video'), imgEls: cnt(el, 'img'), audioEls: cnt(el, 'audio'),
      videoPh: cnt(el, '.muv-video-ph'), audioPh: cnt(el, '.muv-audio'),
      mediaCls: cnt(el, '.muv-media'), iframes: cnt(el, 'iframe'),
      strong: cnt(el, 'strong'), p: cnt(el, 'p'),
      rawVideo: txt.indexOf('<video') >= 0, rawImg: txt.indexOf('<img') >= 0, rawAudio: txt.indexOf('<audio') >= 0,
      srcs: (html.match(/https:\\/\\/zyxjack123\\.top\\/[^"'\\s>]*/g) || []).slice(0, 4),
      head: txt.slice(0, 40),
    }
  }
  function emit() {
    var out = {
      notes: NOTES, requests: REQUESTS, apply: APPLY,
      card: { scripts: (CARD.regexScripts || []).length, name: CARD.name },
      snaps: CASES.map(snap),
      marks: { imgLine: ${JSON.stringify(imgLine)}, videoLine: ${JSON.stringify(videoLine)} },
    }
    var pre = document.createElement('pre')
    pre.id = 'RESULT'
    pre.textContent = 'JSONRESULT' + JSON.stringify(out)
    document.body.appendChild(pre)
  }
  window.addEventListener('error', function (e) { NOTES.push('onerror:' + e.message) })
})();
`
    // ★ 必须给**整段**驱动脚本做 `</script` 转义：卡自己的状态栏皮肤里就带着
    //   `<script>…</script>`（真卡那份 210KB），它以 JSON 字符串的形式嵌在这里。
    //   不转义时浏览器会在卡里的那个 `</script>` 处**提前结束**我这块脚本 ——
    //   症状是夹具静默半死（消息容器全空、没有任何 RESULT），而不是抛错。
    //   本轮实测踩过：两臂都"拿不到 RESULT"，dom 里 5 个消息 div 全空。
    .replace(/<\/script/gi, '<\\/script'))
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>guard-tag-agnostic</title>
<style>html,body{margin:0;background:#16181d;color:#d7dae0;font:13px/1.6 monospace}
.wrap{max-width:900px;margin:0 auto;padding:12px}.host{border:1px dashed #3a4048;margin:6px 0;padding:8px}
img{max-width:220px}video{max-width:220px}</style>
</head><body>
<div class="wrap">
${hosts}
<div id="tavern-session-preset-label" data-preset-id="PANEL-PRESET"></div>
</div>
<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${engine}</script>
<script>${client}</script>
<script>${driver}<\/script>
</body></html>`
}

function runArm(label, clientSource) {
  const file = path.join(OUT, 'guard-' + label + '.html')
  fs.writeFileSync(file, fixturePage(clientSource), 'utf8')
  if (!EDGE) return null
  const domFile = path.join(OUT, 'guard-' + label + '.dom.html')
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--disable-background-networking',
    // 页面里的 URL 一律不许真的去解析（fetch 已打桩；这里只挡住 <img src>/<video src> 的自动加载）
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--virtual-time-budget=20000',
    '--user-data-dir=' + path.join(OUT, 'prof-' + label + '-' + Date.now().toString(36)),
    '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
  ], { stdio: ['ignore', fs.openSync(domFile, 'w'), fs.openSync(path.join(OUT, 'guard-' + label + '.err.txt'), 'w')] })
  const dom = fs.readFileSync(domFile, 'utf8')
  const raw = dom.match(/JSONRESULT(\{[\s\S]*?\})<\/pre>/)
  if (!raw) return { error: '拿不到 RESULT', domFile }
  return JSON.parse(raw[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"))
}

console.log('\n=== ④ 浏览器臂（真 Edge + 真 DOM + 真 client.js + 真卡 + 真正文）===')
if (!EDGE) {
  console.log('  设 MUV_EDGE 指向 msedge.exe 才会跑浏览器臂。fixture 已写到 ' + OUT)
  console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败（浏览器臂未跑）===' + (BREAK ? '  [--break=' + BREAK + ']' : ''))
  process.exit(fail ? 1 : 0)
}
// ★ BEFORE 臂一律从 `SRC_RAW` 生成：它代表的是**旧枚举守卫**这一固定参照。不能传 `SRC`
//   —— `--break=guard-enum` 下 `SRC` 已是改写后的那版，再 `revertGuard` 会找不到守卫行
//   而抛异常（破坏臂本来就是这样坏掉的：报错盖住真正的失败项）。
const BEFORE = runArm('before', revertGuard(SRC_RAW))
const AFTER = runArm('after', SRC)
for (const [label, R] of [['BEFORE', BEFORE], ['AFTER', AFTER]]) {
  if (!R || R.error) { console.log('  ' + label + ' 臂跑挂了: ' + (R ? R.error + ' ' + R.domFile : 'null')); continue }
  console.log('\n  ── ' + label + ' 臂 ──')
  ;(R.notes || []).forEach((n) => console.log('     · ' + n))
  console.log('     取卡次数=' + R.requests.length + '  apply-regex-card 次数=' + R.apply.length + '  卡脚本数=' + R.card.scripts)
  console.log('     apply 入参: ' + JSON.stringify((R.apply || []).map((x) => ({ len: x.len, applied: x.applied, head: x.head.slice(0, 10) }))))
  for (const s of R.snaps) {
    console.log('     [' + s.id + '] decorated=' + s.decorated + ' sanMarked=' + s.sanMarked + ' video=' + s.videoEls + ' img=' + s.imgEls +
      ' audio=' + s.audioEls + ' vPh=' + s.videoPh + ' aPh=' + s.audioPh + ' iframe=' + s.iframes +
      ' strong=' + s.strong + ' p=' + s.p + ' 裸<video>/<img>/<audio>=' + (s.rawVideo ? 'Y' : 'n') + '/' + (s.rawImg ? 'Y' : 'n') + '/' + (s.rawAudio ? 'Y' : 'n'))
    if (s.srcs.length) console.log('          srcs=' + JSON.stringify(s.srcs))
  }
}
check('两臂都产出了 RESULT（夹具跑起来了）', !!(BEFORE && !BEFORE.error && AFTER && !AFTER.error),
  JSON.stringify({ before: BEFORE && BEFORE.error, after: AFTER && AFTER.error }))
if (BEFORE && !BEFORE.error && AFTER && !AFTER.error) {
  const pick = (R, id) => (R.snaps || []).find((s) => s.id === id) || {}
  const bA = pick(BEFORE, 'A_audio_real'), aA = pick(AFTER, 'A_audio_real')
  const bC = pick(BEFORE, 'C_media_bare'), aC = pick(AFTER, 'C_media_bare')
  const bB = pick(BEFORE, 'B_media_envelope'), aB = pick(AFTER, 'B_media_envelope')
  const bD = pick(BEFORE, 'D_prose_real'), aD = pick(AFTER, 'D_prose_real')
  const bE = pick(BEFORE, 'E_lt_notag'), aE = pick(AFTER, 'E_lt_notag')
  const bF = pick(BEFORE, 'F_audio_fresh'), aF = pick(AFTER, 'F_audio_fresh')
  // ★ 归属按「期望长度最近邻」判，不再按字数 ±6：
  //   withStatusPlaceholder（占位符补齐）会把送进 apply 的正文加长一个固定尾巴（实测 +25），
  //   normalizeStatusHeader 又会把带表头的正文折短（B 实测 −151）—— 旧的字数容差已死
  //   （C 的 regText 1394 与其 full 1369 差 25 > 6，A 同理；D/E 与 C 前 1300 字完全相同，
  //   归属只能靠总长）。每条 apply 分给「|len − (full+25)| 最小」的用例，差值 ≥100 不归属：
  //   A(2403,差0)→A、C(1394,差0)→C；B(2783,对谁差都≥176)→不归属（B 的断言全走 DOM，不用 hits）；
  //   D/E 的 apply 不存在 ⇒ 恒 0（对照臂仍然有效）。A 与 F 同文，长度无法区分
  //   （F 在两臂都不取卡，见 B6）—— A 的断言不受影响。
  const PH_LEN = 25
  const lenOf = (id) => CASES.find((c) => c.id === id).full.length
  const hits = (R, id) => (R.apply || []).filter((x) => {
    let best = null
    for (const c of CASES) {
      const d = Math.abs(x.len - (c.full.length + PH_LEN))
      if (!best || d < best.d) best = { id: c.id, d }
    }
    return !!best && best.id === id && best.d < 100
  })
  const hitText = (R, id) => JSON.stringify(hits(R, id).map((x) => ({ len: x.len, applied: x.applied })))

  console.log('\n  ── B5 前置 ──')
  check('真卡的 ' + SCRIPTS.length + ' 条脚本确实进了页面',
    BEFORE.card.scripts === SCRIPTS.length && AFTER.card.scripts === SCRIPTS.length,
    'before=' + BEFORE.card.scripts + ' after=' + AFTER.card.scripts)
  const markLine = (R) => (R.notes || []).find((n) => /sanitize 已在半截正文上打标/.test(n)) || ''
  const markNums = (R) => {
    const m = /sanitize 已在半截正文上打标: (\d+)\/(\d+)/.exec(markLine(R))
    return m ? [Number(m[1]), Number(m[2])] : null
  }
  check('半截阶段：sanitize 已经给每个消息元素打标（复刻真机流式时序，' + (markNums(AFTER) || []).join('/') + '）',
    !!markNums(BEFORE) && !!markNums(AFTER) &&
    markNums(BEFORE)[0] === markNums(BEFORE)[1] && markNums(AFTER)[0] === markNums(AFTER)[1] &&
    markNums(AFTER)[0] === CASES.length,
    JSON.stringify({ before: markLine(BEFORE), after: markLine(AFTER), cases: CASES.length }))

  console.log('\n  ── B1 ★ 本轮收益：只带 <video>/<img>、不带信封的那一轮 ──')
  check('AFTER：C 用例落成真 <video> 元素（BEFORE 是 0）', aC.videoEls >= 1,
    'before.video=' + bC.videoEls + ' after.video=' + aC.videoEls)
  check('AFTER：C 用例落成真 <img> 元素（BEFORE 是 0）', aC.imgEls >= 1,
    'before.img=' + bC.imgEls + ' after.img=' + aC.imgEls)
  check('BEFORE：C 用例两样都没有（= 旧枚举把整轮跳过了）', bC.videoEls === 0 && bC.imgEls === 0,
    JSON.stringify({ video: bC.videoEls, img: bC.imgEls, rawVideo: bC.rawVideo, rawImg: bC.rawImg }))
  check('AFTER 的 src 与真卡映射出的 URL 逐字一致（视频）',
    (aC.srcs || []).some((u) => u === 'https://zyxjack123.top/足控天堂/视频/SFW/超天酱/初次登场1.mp4'),
    JSON.stringify(aC.srcs))
  check('AFTER 的 src 与真卡映射出的 URL 逐字一致（插图）',
    (aC.srcs || []).some((u) => u.indexOf('https://zyxjack123.top/足控天堂/插图/') === 0 && u.indexOf('.webp') > 0),
    JSON.stringify(aC.srcs))
  check('AFTER 里真卡脚本确实跑到了 C 用例（applied>=2）',
    hits(AFTER, 'C_media_bare').some((x) => x.applied >= 2), hitText(AFTER, 'C_media_bare'))
  check('BEFORE 里真卡脚本**没有**跑到 C 用例（该轮在取卡之前就被跳过）',
    hits(BEFORE, 'C_media_bare').length === 0, hitText(BEFORE, 'C_media_bare'))
  note('markdown 代价（如实报告，不作断言）：C 用例 AFTER 的 <strong>=' + aC.strong + ' BEFORE=' + bC.strong +
    '；<p>=' + aC.p + '/' + bC.p + '（媒体那一轮走 applyDecoratedHtml 的最后手段，正文被整条写回）')

  console.log('\n  ── B2 A 用例（真实裸 <audio> 那一轮）：放行之后的真实命运 ──')
  // ★ 2026-09-22 判据更新（漂移归因：HEAD 上旧断言已红，62 通过 5 失败里占 4 条）：
  //   withStatusPlaceholder（占位符补齐，晚于本门禁最后一次全绿加入）改变了 A 的命运 ——
  //   守卫放行 → 取卡 → 正文被补上 <StatusPlaceHolderImpl/> → 卡 [2]「ERA 状态栏」命中
  //   → A 楼也装饰出 ERA 整页 iframe。（引擎臂的 applied=0 是**不带占位符**的口径，不矛盾。）
  //   旧判据「A 的 DOM 与 BEFORE 完全相同 / 裸 <audio> 仍是裸文本」描述的是补齐加入之前
  //   的行为，已过时；按当前真实行为重写，对照臂（BEFORE 仍整楼跳过）保持。
  check('A 用例：AFTER 为它取了卡（守卫放行）',
    hits(AFTER, 'A_audio_real').length >= 1,
    'before 取卡=' + BEFORE.requests.length + ' after 取卡=' + AFTER.requests.length +
    ' after 里指向 A 的 apply=' + hitText(AFTER, 'A_audio_real'))
  check('A 用例：AFTER 跑到了卡脚本（占位符补齐后卡 [2] 命中，applied>=1）',
    hits(AFTER, 'A_audio_real').some((x) => x.applied >= 1), hitText(AFTER, 'A_audio_real'))
  check('A 用例：AFTER 产出 ERA 整页 iframe（占位符被卡 [2] 消费）',
    aA.iframes >= 1, 'before.iframe=' + bA.iframes + ' after.iframe=' + aA.iframes)
  check('★ 对照臂：BEFORE 不为它取卡（旧守卫整楼跳过）、DOM 里没有 iframe',
    hits(BEFORE, 'A_audio_real').length === 0 && bA.iframes === 0,
    hitText(BEFORE, 'A_audio_real') + ' iframe=' + bA.iframes)

  console.log('\n  ── B6 对照臂 F：同一段 <audio> 正文、sanitize 有机会跑时会长成什么样 ──')
  check('F 用例：两臂都打出了 🎵 占位块（引擎侧**确实有** 裸 <audio> → muv-audio 这条路）',
    aF.audioPh >= 1 && bF.audioPh >= 1,
    'before.audioPh=' + bF.audioPh + ' after.audioPh=' + aF.audioPh + ' 裸<audio>=' + bF.rawAudio + '/' + aF.rawAudio)
  check('F 用例：两臂的裸 <audio> 都没了（被 sanitize pass 换掉了）',
    bF.rawAudio === false && aF.rawAudio === false, JSON.stringify({ b: bF.rawAudio, a: aF.rawAudio }))
  // 注意：F 用了与 A **同一段真实正文**，所以按字数无法把"F 的取卡"与"A 的取卡"分开
  // （两者长度一样）。这一档不比取卡，比**DOM**：占位块在两臂里必须一模一样。
  check('F 用例：两臂 DOM 逐字相同（🎵 占位块在两臂里一模一样）',
    bF.htmlLen === aF.htmlLen && bF.audioPh === aF.audioPh && bF.htmlLen > 0,
    JSON.stringify({ bLen: bF.htmlLen, aLen: aF.htmlLen, bPh: bF.audioPh, aPh: aF.audioPh }))
  // ★ 2026-09-22：旧的「A vs F 差别只有 sanitize 有没有机会跑」对比断言已随占位符补齐失效
  //   （A 现在走字符串管线被装饰出 ERA iframe；F 的 <audio> 在装饰前就被 sanitize 换成
  //   🎵 占位块，装饰链读到的文本无标签且超长 ⇒ 两臂都不取卡）。如实记录，不再断言。
  note('⇒ A vs F：A 走字符串管线（占位符补齐 → 卡 [2] → ERA iframe）；F 的 <audio> 被 sanitize')
  note('   提前换成 🎵 占位块 ⇒ 装饰链读到的正文无标签且超长 ⇒ 两臂都不取卡、DOM 逐字相同。')
  note('   裸 <audio> 用户可见的机制（sanitize 对已打标元素不重跑 + 守卫整楼跳过）见 §23/§15.4。')
  check('A 与 F 都被打过 data-muv-sanitized（A 是"先打标、后补全"，F 是"一次到位"）',
    aA.sanMarked === true && aF.sanMarked === true,
    JSON.stringify({ A: aA.sanMarked, F: aF.sanMarked }))
  note('⇒ 这就是用户看到**裸** <audio> 的机制：流式那一轮 sanitize pass 先在**半截正文**上把元素打了标，')
  note('   补全以后它不会再跑（`muvSanitizeNode` 见到 data-muv-sanitized 就早退），而装饰链读了 innerText')
  note('   —— 本轮之前守卫又把这一轮整轮跳过 ⇒ 裸标签留在页面上。修守卫解决了"整轮被跳过"，')
  note('   但"sanitize pass 对已打标元素不再重跑"是**另一处**独立缺陷（建议下一轮修，本轮不动）。')

  console.log('\n  ── B3/B4 反向用例：不许过度放宽 ──')
  check('D 用例（真实纯散文）：两臂都没有为它取卡/应用脚本',
    hits(BEFORE, 'D_prose_real').length === 0 && hits(AFTER, 'D_prose_real').length === 0,
    'before=' + hitText(BEFORE, 'D_prose_real') + ' after=' + hitText(AFTER, 'D_prose_real'))
  check('D 用例：两臂 DOM 逐字相同（正文没被改写；`data-muv-decorated` 会被打上，那不是改写）',
    bD.htmlLen === aD.htmlLen && bD.htmlLen > 0, JSON.stringify({ bLen: bD.htmlLen, aLen: aD.htmlLen, bDec: bD.decorated, aDec: aD.decorated }))
  check('E 用例（`3 < 5` / `a <= b` / `1 <2` / `x <y`）：两臂都没有为它取卡',
    hits(BEFORE, 'E_lt_notag').length === 0 && hits(AFTER, 'E_lt_notag').length === 0,
    'before=' + hitText(BEFORE, 'E_lt_notag') + ' after=' + hitText(AFTER, 'E_lt_notag'))
  check('E 用例：两臂 DOM 相同', bE.htmlLen === aE.htmlLen, JSON.stringify({ bLen: bE.htmlLen, aLen: aE.htmlLen }))

  console.log('\n  ── B7 ★ 占位符 greeting（第三次漏的本体：first_mes =「【主页】」）──')
  const bG = pick(BEFORE, 'G_home_greeting'), aG = pick(AFTER, 'G_home_greeting')
  check('G 用例：AFTER 为它取了卡（守卫的短文本放行分支生效）',
    hits(AFTER, 'G_home_greeting').length >= 1,
    'after 里指向 G 的 apply=' + hitText(AFTER, 'G_home_greeting'))
  check('G 用例：AFTER 真的跑到了卡脚本（applied>=1，卡 [0]「主页」命中占位符）',
    hits(AFTER, 'G_home_greeting').some((x) => x.applied >= 1), hitText(AFTER, 'G_home_greeting'))
  check('★ G 用例：AFTER 产出 iframe（替换产物是 ``` 包裹的整页文档 → renderFencedHtml → 卡 iframe）',
    aG.iframes >= 1, 'before.iframe=' + bG.iframes + ' after.iframe=' + aG.iframes)
  check('★ 对照臂：BEFORE（旧守卫）不为它取卡（该楼在取卡之前被整楼跳过）',
    hits(BEFORE, 'G_home_greeting').length === 0, hitText(BEFORE, 'G_home_greeting'))
  check('★ 对照臂：BEFORE 的 DOM 里没有 iframe（首楼没有卡界面 = 用户报的症状）',
    bG.iframes === 0, 'before.iframe=' + bG.iframes)
  note('⇒ 这就是"魔女卡在 DSH 首楼只有正文+插图、没有契约书界面"的机制：first_mes 是纯短文本，')
  note('   旧守卫只认 HTML 标签 ⇒ greeting 楼整楼跳过 ⇒ markdownOnly 正则从未被消费。')

  console.log('\n  ── 参照组 B：含 <content> 的那一轮，两臂都该美化 ──')
  check('B 用例两臂都出了 iframe（整页文档走 renderFencedHtml）', bB.iframes >= 1 && aB.iframes >= 1,
    'before=' + bB.iframes + ' after=' + aB.iframes)
  check('B 用例两臂都映射出了媒体 URL（旧枚举本来就放行它）',
    (bB.srcs || []).some((u) => u.indexOf('.mp4') > 0) && (aB.srcs || []).some((u) => u.indexOf('.mp4') > 0),
    JSON.stringify({ before: bB.srcs, after: aB.srcs }))
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===' + (BREAK ? '  [--break=' + BREAK + ']' : ''))
if (failed.length) console.log('  失败项：\n   - ' + failed.join('\n   - '))
console.log('  fixture: ' + OUT)
process.exit(fail ? 1 : 0)
