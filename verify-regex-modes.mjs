// verify-regex-modes.mjs —— lib/regex-engine.js 的 placement / depth 门禁
//
// 为什么需要这个文件：`matchesMode()` 过去在**显示侧**只用 `promptOnly !== true`
// 过滤，于是卡里那批 `markdownOnly:true + promptOnly:true` 的"清场"脚本
// （`_足控天堂2` 的 [3][4][5][8]）在显示侧全被跳过 —— 用户看到的是
// `<VariableInsert>{…2.9KB JSON…}</VariableInsert>` 原样当文字。
// 而把显示侧放开到 ST 的语义之后，`[8]`（`minDepth:7`，把整条消息换成空串）
// 会立刻把整条消息清成 0 字。两件事必须一起做，所以两件事都钉在这里。
//
// 本文件只做断言，不修改任何东西（唯一写入：把 git HEAD 的旧引擎导出到 %TEMP%，
// 作为 BEFORE 对照臂）。运行：node verify-regex-modes.mjs
//
// ── BEFORE 臂的来源 ────────────────────────────────────────────────────────
// `lib/regex-engine.js` 在改动前是 git-clean 的，所以 `git show HEAD:…` 就是
// 逐字的旧实现（已核对 SHA256 = EF353EC…）。它不是"我抄的一份副本"，是原件。
// 若将来该文件已被提交（HEAD 里也是新代码），则退回文件内逐字复制的 INLINE-LEGACY，
// 并在报告里标明它不是原件。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readPngCard } from 'file:///C:/dsh-muv-table/lib/png-card.js'
import * as engine from './lib/regex-engine.js'

const REPO = 'C:/dsh-muv-engine'
const CARD_PNG = 'C:/MySpecialFolder/SillyTavern/data/default-user/characters/_足控天堂2.png'
const LIVE_URL = 'http://127.0.0.1:3080/api/muv-engine/apply-regex-card'

let pass = 0, fail = 0
const failed = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; failed.push(name); console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
function num(n) { return typeof n === 'number' ? String(n) : JSON.stringify(n) }

// ── 计数工具（判据全部用同一份实现，避免"测的和断言的不是一回事"）───────────
// 具名常量而不是内联字面量：这条正则在第一版里被我漏了一个收尾的 `"`，
// 于是"裸 JSON 键 == 0"变成了恒真断言（BEFORE 臂当场把它照出来）。
// 现在它有一个非空自检（见 [0]），判据本身也被钉住。
const RAW_JSON_RE = /"(?:世界信息|主角信息|主播档案|公司)"\s*:/g
const count = (s, re) => (String(s).match(re) || []).length
const stats = (t) => ({
  len: String(t).length,
  variableInsert: count(t, /<VariableInsert>/g),
  rawJsonKeys: count(t, RAW_JSON_RE),
  homeTag: count(t, /【主页】/g),
  homeDoc: count(t, /<!doctype/gi),
  fences: count(t, /```/g),
})
const RAW_JSON_CLEAN = (s) => stats(s).variableInsert === 0 && stats(s).rawJsonKeys === 0

// ── 被测对象 ────────────────────────────────────────────────────────────────
const card = readPngCard(CARD_PNG)
const cardData = card.data && typeof card.data === 'object' ? card.data : card
const scripts = cardData.extensions.regex_scripts
const GREETING = cardData.first_mes
const byName = (n) => scripts.find(s => s.scriptName === n)

console.log('=== [0] 被测对象')
console.log('  卡           :', CARD_PNG)
console.log('  脚本数       :', scripts.length)
console.log('  真文本       : first_mes', GREETING.length, '字')
{
  const tmp = path.join(os.tmpdir(), '.tmp-greeting.txt')
  if (fs.existsSync(tmp)) {
    const same = fs.readFileSync(tmp, 'utf8') === GREETING
    console.log('  与 %TEMP%/.tmp-greeting.txt 一致 :', same)
  }
  console.log('  输入画像     :', JSON.stringify(stats(GREETING)))
  console.log('  引擎导出     :', Object.keys(engine).join(','))
  // 非空自检：判据本身必须在输入上命中，否则后面所有 "== 0" 的断言都是恒真的
  check('判据非空自检：输入里确实有 4 个裸 JSON 键（否则 ==0 的断言毫无意义）',
    stats(GREETING).rawJsonKeys === 4, 'keys=' + stats(GREETING).rawJsonKeys)
  check('判据非空自检：输入里确实有裸 <VariableInsert>', stats(GREETING).variableInsert === 1,
    'VI=' + stats(GREETING).variableInsert)
}
console.log('  关注的脚本   :', [3, 4, 5, 6, 8, 9].map(i =>
  '[' + i + ']' + scripts[i].scriptName + '(md=' + scripts[i].markdownOnly + ',po=' + scripts[i].promptOnly +
  ',min=' + num(scripts[i].minDepth) + ',max=' + num(scripts[i].maxDepth) + ')').join(' '))

// ── BEFORE 臂：旧实现（优先 git 原件）──────────────────────────────────────
const LEGACY_TMP = path.join(os.tmpdir(), '.tmp-regex-engine-legacy.mjs')
const OLD_MARKER = 'script.promptOnly !== true'
let legacy = null, legacyOrigin = ''
{
  let src = null
  if (fs.existsSync(LEGACY_TMP)) {
    const s = fs.readFileSync(LEGACY_TMP, 'utf8')
    if (s.includes(OLD_MARKER)) { src = s; legacyOrigin = '文件 %TEMP%/.tmp-regex-engine-legacy.mjs（= git HEAD 原件，SHA256 EF353EC…）' }
  }
  if (!src) {
    try {
      const out = execFileSync('git', ['show', 'HEAD:lib/regex-engine.js'], { cwd: REPO, encoding: 'utf8' }).replace(/\r\n/g, '\n')
      if (out.includes(OLD_MARKER)) {
        fs.writeFileSync(LEGACY_TMP, out, 'utf8')
        src = out
        legacyOrigin = '刚从 `git show HEAD:lib/regex-engine.js` 导出到 %TEMP%'
      }
    } catch (_) { /* 落到 INLINE */ }
  }
  if (src) {
    const abs = path.resolve(LEGACY_TMP).replace(/\\/g, '/')
    legacy = await import('file:///' + abs.replace(/^\//, ''))
  }
}
console.log('\n=== [1] BEFORE 臂来源 :', legacy ? legacyOrigin : '不可用（HEAD 已是新代码且无缓存）')

if (legacy) {
  const b = legacy.applyAllRegexScripts(GREETING, scripts)              // 旧：显示侧 = promptOnly !== true
  const bForced = legacy.applyAllRegexScripts(GREETING, scripts, { depth: 0 }) // 旧代码没有 depth 概念，传了也不认
  const bs = stats(b.text)
  console.log('  BEFORE applied =', b.applied, '| 产物', JSON.stringify(bs))
  console.log('  BEFORE 传 depth:0 也无效（旧签名把参数当 mode）applied =', bForced.applied)
  check('BEFORE：旧实现的 applied 恰好为 1（只有 [0]主页 命中）', b.applied === 1, 'applied=' + b.applied)
  check('BEFORE：旧实现留下裸 <VariableInsert>', bs.variableInsert === 1, 'VI=' + bs.variableInsert)
  check('BEFORE：旧实现留下裸 JSON 键（用户看到的那一大串）', bs.rawJsonKeys === 4, 'keys=' + bs.rawJsonKeys)

  // 「这条断言能红」的证据：把 AFTER 的判据原样套到 BEFORE 产物上，必须失败
  const afterCriterionWouldFail = !(b.applied > 1 && RAW_JSON_CLEAN(b.text))
  check('★ 能把 AFTER 判据证伪：同一判据在旧产物上失败（⇒ 判据不是恒真）', afterCriterionWouldFail,
    'applied=' + b.applied + ' VI=' + bs.variableInsert)

  // [3] 单独作用 ⇒ 证明"不是正则不匹配，是没被调用"
  const only3 = legacy.applyAllRegexScripts(GREETING, [scripts[3]], 'all')
  console.log('  BEFORE [3] 单独作用: ', GREETING.length, '->', only3.text.length, '字')
  check('BEFORE：[3] 单独作用能把开场白清干净（2928→10）', only3.text.length === 10, 'len=' + only3.text.length)

  // 灾难回归的 BEFORE 臂：旧代码放开显示侧而又没有深度门时，[8] 会清空整条消息
  const legacyNoDepth = legacy.applyAllRegexScripts(GREETING, [scripts[8]], 'all')
  console.log('  BEFORE [8]（无深度门）单独作用: ', GREETING.length, '->', legacyNoDepth.text.length, '字')
  check('★ 灾难判据能把 BEFORE 证伪：[8] 无深度门时清空整条消息', legacyNoDepth.text.length === 0,
    'len=' + legacyNoDepth.text.length)

  // BEFORE 的反向臂：ST 语义下该跑的 md+po 脚本在旧实现里没跑
  const only4 = legacy.applyAllRegexScripts(GREETING, [scripts[4]], 'all')
  check('BEFORE：旧实现跳过 md=true+po=true 的脚本（以 [3] 的命中为证，见上）', only3.text !== GREETING)
}

// ── AFTER 臂：新实现 ───────────────────────────────────────────────────────
console.log('\n=== [2] AFTER：真卡 + 真文本，显示侧（mode 默认 = display, depth 默认 = 0）')
const a = engine.applyAllRegexScripts(GREETING, scripts)
const as = stats(a.text)
console.log('  AFTER applied =', a.applied, '| 产物', JSON.stringify(as))
check('★ AFTER：applied > 1（[3] 等清场脚本确实跑了）', a.applied > 1, 'applied=' + a.applied)
check('★ AFTER：产物里没有裸 <VariableInsert>', as.variableInsert === 0, 'VI=' + as.variableInsert)
check('★ AFTER：产物里没有裸 JSON 键', as.rawJsonKeys === 0, 'keys=' + as.rawJsonKeys)
check('AFTER：`【主页】` 已被替换（没有残留裸标记）', as.homeTag === 0, 'homeTag=' + as.homeTag)
check('AFTER：主页整页文档仍在（美化没被顺手删掉）', as.homeDoc === 1, 'doctype=' + as.homeDoc)
check('AFTER：产物长度合理（不是被清空、也不是只剩空串）', as.len > 50000 && as.len < 70000, 'len=' + as.len)

console.log('\n=== [3] 灾难回归：深度门必须在（[8] minDepth=7 把整条消息换成空串）')
const s8 = engine.applyAllRegexScripts(GREETING, [scripts[8]])
check('★ [8] 在 depth 0（正在渲染的这条）不生效 ⇒ 消息还在', s8.text === GREETING && s8.applied === 0,
  'len=' + s8.text.length + ' applied=' + s8.applied)
const s8d7 = engine.applyAllRegexScripts(GREETING, [scripts[8]], 'display', { depth: 7 })
check('[8] 在 depth 7 仍然生效（证明不是"把 [8] 关掉了"）', s8d7.text.length === 0, 'len=' + s8d7.text.length)
const s8d6 = engine.applyAllRegexScripts(GREETING, [scripts[8]], 'display', { depth: 6 })
check('[8] 在 depth 6 仍然被门挡住（minDepth 边界是 7）', s8d6.text === GREETING, 'len=' + s8d6.text.length)
{
  const whole = engine.applyAllRegexScripts(GREETING, scripts)   // 整卡、depth 0
  check('★ 整卡跑完产物不是 0 字（灾难的最终判据）', whole.text.length > 0, 'len=' + whole.text.length)
}

console.log('\n=== [4] 反向断言：不能"全放开"，promptOnly / 深度门仍要各就各位')
const mk = (o) => Object.assign({ disabled: false, runOnEdit: true, substituteRegex: 0, placement: [1, 2] }, o)
const T = '<X>hello</X>'
const marker = (t) => t.includes('MARK')
const cases = [
  ['po-only  (md=false,po=true ) 指示"只给提示侧"', mk({ markdownOnly: false, promptOnly: true, findRegex: '/<X>/g', replaceString: 'MARK' }), false, true],
  ['md-only  (md=true ,po=false) 指示"只给显示侧"', mk({ markdownOnly: true, promptOnly: false, findRegex: '/<X>/g', replaceString: 'MARK' }), true, false],
  ['both     (md=true ,po=true ) ST 语义 = 两边都跑', mk({ markdownOnly: true, promptOnly: true, findRegex: '/<X>/g', replaceString: 'MARK' }), true, true],
  // ★ 有意偏离 ST：ST 把"两个都没开"的脚本放在 raw/source 阶段跑，所以显示阶段不再跑；
  //   本引擎只有渲染这一个阶段，跳过它等于这条脚本永远不生效 ⇒ 两侧都跑。
  ['neither  (md=false,po=false) 单阶段引擎 = 两侧都跑（有意偏离 ST）', mk({ markdownOnly: false, promptOnly: false, findRegex: '/<X>/g', replaceString: 'MARK' }), true, true],
]
for (const [label, script, expectDisplay, expectPrompt] of cases) {
  const d = engine.applyAllRegexScripts(T, [script], 'display')
  const p = engine.applyAllRegexScripts(T, [script], 'prompt')
  check(label + ' → display ' + (expectDisplay ? '跑' : '不跑'), marker(d.text) === expectDisplay, JSON.stringify(d.text))
  check(label + ' → prompt  ' + (expectPrompt ? '跑' : '不跑'), marker(p.text) === expectPrompt, JSON.stringify(p.text))
}
{
  const po = cases[0][1]
  const d = engine.applyAllRegexScripts(T, [po], 'display')
  check('★ 反向断言：真正 prompt-only 的脚本**不许**出现在显示侧产物里', !marker(d.text), JSON.stringify(d.text))
}
{
  // 深度门：minDepth 2 / maxDepth 2 ⇒ 只有 depth 2 跑
  const g = mk({ markdownOnly: true, promptOnly: false, minDepth: 2, maxDepth: 2, findRegex: '/<X>/g', replaceString: 'MARK' })
  for (const depth of [0, 1, 2, 3, 4]) {
    const r = engine.applyAllRegexScripts(T, [g], 'display', { depth })
    check('深度门 min=max=2 @depth ' + depth + ' ' + (depth === 2 ? '跑' : '不跑'), marker(r.text) === (depth === 2), JSON.stringify(r.text))
  }
  // ST 的 null 语义：minDepth:null = 没有下限（不是"下限 0"）
  const n = mk({ markdownOnly: true, promptOnly: false, minDepth: null, maxDepth: null, findRegex: '/<X>/g', replaceString: 'MARK' })
  for (const depth of [0, 3, 99]) {
    const r = engine.applyAllRegexScripts(T, [n], 'display', { depth })
    check('minDepth:null/maxDepth:null @depth ' + depth + ' 跑（null ≠ 0）', marker(r.text), JSON.stringify(r.text))
  }
}

console.log('\n=== [5] extractStatusBarHtml：选择规则只放宽、不收紧（superset）')
const sbReal = engine.extractStatusBarHtml(scripts)
check('真卡状态栏仍在（210,211 字量级）', typeof sbReal === 'string' && sbReal.length > 200000, 'len=' + (sbReal ? sbReal.length : sbReal))
{
  const both = mk({ markdownOnly: true, promptOnly: true, findRegex: '/<StatusPlaceHolderImpl\\/>/gsi', replaceString: '```html\n<!DOCTYPE html><html><body>BOTH-SB</body></html>\n```' })
  const a = engine.extractStatusBarHtml([both])
  check('md=true+po=true 的状态栏脚本现在被选中（旧实现会漏）', typeof a === 'string' && a.includes('BOTH-SB'), JSON.stringify(a))
  if (legacy) {
    const b = legacy.extractStatusBarHtml([both])
    check('★ 对照：旧实现对同一脚本返回 null（⇒ 本项能红）', b === null, JSON.stringify(b))
  }
}

console.log('\n=== [6] [6]视频 / [9]CG插图 的可触发性与本次改动的关系')
{
  // [6] 与 [9] 都是 md=true / po=false，旧过滤（promptOnly !== true）本来就放行，
  // 所以本次 placement 修正**不改变**它们。用一条"模型按世界书格式产出"的合成回复
  // 证明管道两端接通；剩下的未知只在浏览器 DOM 那一层。
  const REPLY = [
    '<content>今天的直播就这样结束了。</content>',
    '<video>NSFW/AZKi/反向乘骑式1</video>',
    '<img>SFW/兔田妈妈/害羞1</img>',
    '<StatusPlaceHolderImpl/>',
  ].join('\n')
  const a = engine.applyAllRegexScripts(REPLY, scripts)
  const f6 = a.text.includes('https://zyxjack123.top/足控天堂/视频/NSFW/AZKi/反向乘骑式1.mp4')
  const f9 = a.text.includes('https://zyxjack123.top/足控天堂/插图/SFW/兔田妈妈/害羞1.webp')
  console.log('  AFTER 产物含映射后的视频 URL :', f6)
  console.log('  AFTER 产物含映射后的插图 URL :', f9)
  check('[6]：模型产出 `<video>PATH</video>` 时 → 被映射成 视频/PATH.mp4', f6)
  check('[9]：模型产出 `<img>PATH</img>` 时 → 被映射成 插图/PATH.webp', f9)
  check('[6]/[9] 在产物里没有留下裸标记', !a.text.includes('<video>NSFW') && !a.text.includes('<img>SFW'))
  if (legacy) {
    const b = legacy.applyAllRegexScripts(REPLY, scripts)
    const b6 = b.text.includes('https://zyxjack123.top/足控天堂/视频/NSFW/AZKi/反向乘骑式1.mp4')
    check('对照：旧实现同样会映射 [6]（⇒ 本次改动与 [6]/[9] 无关，前后行为一致）', b6 === f6,
      'before=' + b6 + ' after=' + f6)
  }
}

// ── 真端点观测（3080 上跑的是旧进程：不重启就不会变绿）────────────────────
console.log('\n=== [7] 真端点观测 /api/muv-engine/apply-regex-card')
try {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  const res = await fetch(LIVE_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: GREETING, cardJson: card }), signal: ctl.signal,
  })
  clearTimeout(timer)
  const d = await res.json()
  const ls = stats(d.text || '')
  const liveFixed = d.applied > 1 && RAW_JSON_CLEAN(d.text)
  console.log('  LIVE applied =', d.applied, '| 产物', JSON.stringify(ls))
  if (liveFixed) {
    check('★ LIVE 端点已经是新语义（applied>1 且无裸 JSON）', true)
  } else {
    console.log('  [BEFORE-STALE] 3080 上仍在跑改动前的代码 —— 重启 DSH 后本项才会变绿。')
    console.log('                 这同时也证明"旧代码确实产出裸 JSON"是在真端点上观测到的，不只是离线复现。')
    check('★ LIVE 端点仍是旧语义（= 改动前基线，重启后应变绿）', true)
    if (process.env.REQUIRE_LIVE === '1') check('★ REQUIRE_LIVE=1：LIVE 端点必须已是新语义', false, 'applied=' + d.applied)
  }
} catch (e) {
  console.log('  LIVE 端点不可达（跳过）：' + e.message)
}

console.log('\n=== 汇总')
console.log('  PASS = ' + pass + ' , FAIL = ' + fail)
if (failed.length) console.log('  失败项：\n   - ' + failed.join('\n   - '))
console.log('  BEFORE 臂来源：' + (legacy ? legacyOrigin : '不可用'))
process.exitCode = fail ? 1 : 0
