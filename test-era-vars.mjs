// Verification (keep): ERA 增量块（`<VariableInsert|VariableEdit|VariableDelete>`）的解析与重放。
//
// 为什么单独一个门禁：这是「卡的数据区」的**唯一数据源**（社区卡的模型每楼发的是这种块，
// 而不是 MUV 的 `<initvar>`）。它挂掉的观感是「选项空白 / 数值不动 / CG 视频锁着」——
// 而控制台**毫无动静**（没有异常、没有请求），是最难查的一类。
//
// 覆盖三件容易写错的事（都是实测踩出来的）：
//   ① `VariableThink` 里会**引用标签名**（"生成一个 `<VariableEdit>` 块"）⇒ 直接扫标签会错配；
//   ② 装饰是**异步乱序**的，而每楼 JSON 带的是**绝对值** ⇒ 到场即合并会让字段回退（好感度倒着走）；
//   ③ 重复送达必须无副作用（消息重渲染/滚动都会再喂一次）。
//
// 真聊天文件在场时额外跑一遍**真数据**（取不到就 SKIP，不假装通过）。
//
// Run: node test-era-vars.mjs
import fs from 'node:fs'
import { parseVariableOps, applyVariableMessage, appliedMessageKeys, parseCommandOps, normalizeStatData } from './lib/var-tracker.js'

let fail = 0
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}
const pick = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)

// ───────────────────────── 1. 合成用例：模型在思考里"提及"标签名 ─────────────────────────
console.log('\n[1] VariableThink 里的"提及"不许把真块错配掉')
const messy = [
  '<VariableThink>',
  '  - 更新 `世界信息.时间` 至晚上 19:00。',
  '  - 生成一个 `<VariableEdit>` 块来更新 `剧情选项`。',
  '</VariableThink>',
  '<VariableEdit>',
  '{ "世界信息": { "时间": { "时间详情": "19:00" } }, "剧情选项": { "选项1": "喝茶" } }',
  '</VariableEdit>',
  '<era_data>{"era-message-key"="era_mk_1789928712211_a6czp6","era-message-type"="assistant"}</era_data>',
].join('\n')
const p1 = parseVariableOps(messy)
check('★ 恰好解析出 1 个真块（提及不算块）', p1.ops.length === 1, JSON.stringify({ ops: p1.ops.length, bad: p1.bad, skipped: p1.skipped }))
check('★ 没有把它算成"坏块"（bad=0；算 bad 会把后面真块一起漏掉）', p1.bad === 0, String(p1.bad))
check('取到消息键', p1.key === 'era_mk_1789928712211_a6czp6', String(p1.key))
check('键里的时间戳被解析成 epoch（按楼排序的依据）', p1.epoch === 1789928712211, String(p1.epoch))
check('载荷是深合并用的对象树', p1.ops[0].data['世界信息']['时间']['时间详情'] === '19:00',
  JSON.stringify(p1.ops[0].data))

// ───────────────────────── 2. 三种块 + 深删 ─────────────────────────
console.log('\n[2] Insert / Edit / Delete 三种块')
const three = '<VariableInsert>{"a":{"b":1}}</VariableInsert>' +
  '<VariableEdit>{"a":{"c":2}}</VariableEdit>' +
  '<VariableDelete>{"a":{"b":null}}</VariableDelete>' +
  '<era_data>{"era-message-key"="era_mk_1000_zz"}</era_data>'
const p2 = parseVariableOps(three)
check('三种块都认（顺序不乱）',
  p2.ops.map((o) => o.kind).join(',') === 'variableinsert,variableedit,variabledelete',
  JSON.stringify(p2.ops.map((o) => o.kind)))
const SID2 = 'synth-2-' + Date.now()
const s2 = applyVariableMessage(SID2, { key: p2.key, epoch: p2.epoch, ops: p2.ops })
check('深合并 + 深删都生效（a.c 留下、a.b 被删）',
  s2.a && s2.a.c === 2 && !('b' in s2.a), JSON.stringify(s2))

// ───────────────────────── 3. 乱序送达 / 重复送达 ─────────────────────────
console.log('\n[3] 乱序送达结果必须一致；重复送达必须无副作用')
const mk = (epoch, key, data) => ({ key, epoch, ops: [{ kind: 'variableedit', data }] })
const feed = [mk(1000, 'era_mk_1000_a', { 好感度: 10, 选项1: '甲' }),
  mk(2000, 'era_mk_2000_b', { 好感度: 55, 选项2: '乙' }),
  mk(3000, 'era_mk_3000_c', { 好感度: 100, 选项1: '丙' })]
const SA = 'synth-a-' + Date.now()
const SB = 'synth-b-' + Date.now()
let a = null
for (const f of feed) a = applyVariableMessage(SA, f)
let b = null
for (const f of [...feed].reverse()) b = applyVariableMessage(SB, f)
check('★★ 倒序送达 = 顺序送达（逐字相同）', JSON.stringify(a) === JSON.stringify(b),
  'A=' + JSON.stringify(a) + '  B=' + JSON.stringify(b))
check('★ 后一楼的绝对值覆盖前一楼（好感度=100，不是 10）', a['好感度'] === 100, String(a['好感度']))
check('★ 只被早期楼层设过的字段留着（选项2=乙）', a['选项2'] === '乙', String(a['选项2']))
check('★ 同一楼重复送达：状态不变（幂等）', JSON.stringify(applyVariableMessage(SA, feed[2])) === JSON.stringify(a))
check('账本按 epoch 升序列出消息键', appliedMessageKeys(SA).join(',') === 'era_mk_1000_a,era_mk_2000_b,era_mk_3000_c',
  appliedMessageKeys(SA).join(','))
// 无消息键的老格式：按到达顺序追加（已知限制，如实记录）
const SN = 'synth-n-' + Date.now()
const n1 = applyVariableMessage(SN, { key: null, ops: [{ kind: 'variableedit', data: { x: 1 } }] })
const n2 = applyVariableMessage(SN, { key: null, ops: [{ kind: 'variableedit', data: { y: 2 } }] })
const n3 = applyVariableMessage(SN, { key: null, ops: [{ kind: 'variableedit', data: { y: 2 } }] })
check('无键块：累计生效 + 同内容不重复计', n1.x === 1 && n2.y === 2 && JSON.stringify(n2) === JSON.stringify(n3),
  JSON.stringify(n2) + ' vs ' + JSON.stringify(n3))

// ───────────────────────── 4. ③ 命令式写入 `_.set` / `_.add`（2026-09-22 新卡实测依赖） ─────────────────────────
//
// 为什么单独立一节：新导入的 MVU 卡实测 `_.set( × 39`、`_.add( × 0`，而这一类**不是标签块**，
// 是写在正文里的语句。不认它 ⇒ 数值/开关全部停在初始值，而控制台毫无动静。
console.log('\n[4] ③ 命令式写入 _.set / _.add')
const cmdText = [
  '正文……',
  "_.set('世界信息.时间.时间详情', '10:15')",
  '_.set("公司.总现金", 12345.5)',
  "_.set('开关.自动', true)",
  '_.set(\'配置\', {"模式":"困难","层数":3})',
  "_.add('公司.总现金', -500)",
  "前一句 _.set ( 'a.b' , 1 ) 后一句",
  '<era_data>{"era-message-key"="era_mk_2000_cmd"}</era_data>',
].join('\n')
const p4 = parseVariableOps(cmdText)
check('★ 6 条命令都被认出来', p4.commands === 6,
  JSON.stringify({ commands: p4.commands, badCommands: p4.badCommands, ops: p4.ops.length }))
check('★ 命令式解析失败数为 0（形态都对）', p4.badCommands === 0, String(p4.badCommands))
check('取到消息键（命令式与 ② 共用同一套键）', p4.key === 'era_mk_2000_cmd', String(p4.key))
check('★ ops 顺序 = 文本先后（set,set,set,set,add,set）',
  p4.ops.map((o) => o.kind).join(',') === 'set,set,set,set,add,set',
  JSON.stringify(p4.ops.map((o) => o.kind)))
const SID4 = 'synth-cmd-' + Date.now()
const s4 = applyVariableMessage(SID4, { key: p4.key, epoch: p4.epoch, ops: p4.ops })
check('字符串值按点分路径落库', pick(s4, '世界信息.时间.时间详情') === '10:15', JSON.stringify(pick(s4, '世界信息.时间.时间详情')))
check('数字值原样落库', pick(s4, '公司.总现金') === 11845.5, String(pick(s4, '公司.总现金')))
check('_.add 是数值累加（12345.5 + (-500)）', pick(s4, '公司.总现金') === 11845.5, String(pick(s4, '公司.总现金')))
check('布尔值落库', pick(s4, '开关.自动') === true, JSON.stringify(pick(s4, '开关.自动')))
check('★ JSON 对象字面量值落库', pick(s4, '配置.模式') === '困难' && pick(s4, '配置.层数') === 3,
  JSON.stringify(pick(s4, '配置')))
check('带空格的变体 `_.set ( "a.b" , 1 )` 也认', pick(s4, 'a.b') === 1, JSON.stringify(pick(s4, 'a.b')))

// _.add 的起点语义：字段不存在 / 不是有限数字 ⇒ 从 0 起算
const SID4b = 'synth-cmd-b-' + Date.now()
const s4b = applyVariableMessage(SID4b, { key: null, ops: [{ kind: 'add', path: '新字段', delta: 7 }] })
check('_.add 目标不存在时从 0 起算（0 + 7）', s4b['新字段'] === 7, JSON.stringify(s4b))
const s4c = applyVariableMessage(SID4b, { key: null, ops: [{ kind: 'set', path: '文本字段', value: 'x' }, { kind: 'add', path: '文本字段', delta: 3 }] })
check('_.add 目标是字符串时也从 0 起算（不拼字符串）', s4c['文本字段'] === 3, JSON.stringify(s4c['文本字段']))

// ★ 对照组（必须能红）：三种"不该被认"的形态
const ctl1 = parseCommandOps("foo_.set('a.b', 1)")
check('★ 对照臂：`foo_.set(` 不被认（前缀不是标识符字符这条规则在做功）', ctl1.ops.length === 0,
  JSON.stringify(ctl1))
const ctl2 = parseVariableOps('_.set(ctx.data, v.parts, incoming)')
check('★ 对照臂：新卡自带 lodash 形态 `_.set(对象, 路径数组, 值)` 不被误写（计 bad、无 set op）',
  ctl2.ops.length === 0 && ctl2.badCommands >= 1,
  JSON.stringify({ ops: ctl2.ops.length, bad: ctl2.badCommands }) + '（这条卡真存在：1.txt 里 39 处 _.set( 全是这种）')
const ctl3 = parseCommandOps("_.set('a', someVariable)")
check('★ 对照臂：值是变量引用 ⇒ 判失败（服务端不求值，猜就是编数据）',
  ctl3.ops.length === 0 && ctl3.bad === 1, JSON.stringify(ctl3))
const ctl4 = parseCommandOps("_.add('a', '3')")
check('★ 对照臂：_.add 的增量是字符串 ⇒ 判失败', ctl4.ops.length === 0 && ctl4.bad === 1, JSON.stringify(ctl4))
// 一个坏调用不许吞掉同一消息里的好调用
const mixBad = "_.set('a', notALiteral)\n_.set('b', 2)"
const pm = parseCommandOps(mixBad)
check('★ 坏调用跳过但同消息里的好调用仍生效（不整条丢）',
  pm.ops.length === 1 && pm.bad === 1 && pm.ops[0].path === 'b', JSON.stringify(pm))

// ───────────────────────── 5. ★ ③ 与 ② 同一条消息：按文本先后 + 键序重放 ─────────────────────────
//
// 这是最容易写错的一条：两种来源**同一个消息里先后不同则结果不同**，分两趟收就会把顺序弄反。
console.log('\n[5] ★ ③ 与 ② 混排：顺序必须按文本先后')
const SID5a = 'synth-mix-a-' + Date.now()
const SID5b = 'synth-mix-b-' + Date.now()
const blkFirst = '<VariableEdit>{"a":{"b":1}}</VariableEdit>\n_.set("a.b", 2)'
const cmdFirst = '_.set("a.b", 2)\n<VariableEdit>{"a":{"b":1}}</VariableEdit>'
const pa5 = parseVariableOps(blkFirst)
const pb5 = parseVariableOps(cmdFirst)
const sa5 = applyVariableMessage(SID5a, { key: null, ops: pa5.ops })
const sb5 = applyVariableMessage(SID5b, { key: null, ops: pb5.ops })
check('★ 块在前、命令在后 ⇒ 命令赢（a.b=2）', pick(sa5, 'a.b') === 2, JSON.stringify(sa5))
check('★ 命令在前、块在后 ⇒ 块赢（a.b=1）', pick(sb5, 'a.b') === 1, JSON.stringify(sb5))
check('两种来源在同一条消息里共用一个 ops 序列（不是两趟）',
  pa5.ops.length === 2 && pa5.ops[1].kind === 'set', JSON.stringify(pa5.ops.map((o) => o.kind)))

// 命令式也走"按消息键重放"：倒序送达 = 顺序送达
const cmdMsg = (epoch, key, path, value) => {
  const t = '_.set("' + path + '", ' + JSON.stringify(value) + ')\n<era_data>{"era-message-key"="' + key + '"}</era_data>'
  const p = parseVariableOps(t)
  return { key: p.key, epoch: p.epoch, ops: p.ops }
}
const cmdFeed = [cmdMsg(1000, 'era_mk_1000_c', '公司.总现金', 100),
  cmdMsg(2000, 'era_mk_2000_c', '公司.总现金', 55),
  cmdMsg(3000, 'era_mk_3000_c', '公司.总现金', 100)]
const SC1 = 'synth-cmd-r1-' + Date.now()
const SC2 = 'synth-cmd-r2-' + Date.now()
let c1 = null
for (const f of cmdFeed) c1 = applyVariableMessage(SC1, f)
let c2 = null
for (const f of [...cmdFeed].reverse()) c2 = applyVariableMessage(SC2, f)
check('★★ 命令式乱序送达 = 顺序送达（逐字相同）', JSON.stringify(c1) === JSON.stringify(c2),
  'A=' + JSON.stringify(c1) + '  B=' + JSON.stringify(c2))

// ───────────────────────── 6. ④ `stat_data` 归一（MVU 变量树的顶层键） ─────────────────────────
console.log('\n[6] ④ stat_data 归一（`chat[i].variables.stat_data` ⇒ 顶层键 stat_data）')
{
  const wrapped = { stat_data: { 金钱: 100 } }
  check('已是 MVU 形态（顶层 stat_data）⇒ 原样返回',
    normalizeStatData(wrapped) === wrapped, JSON.stringify(normalizeStatData(wrapped)))
  const store = { chat: { '0': { variables: { stat_data: { 金钱: 7 } } }, '1': { variables: {} } } }
  const n1 = normalizeStatData(store)
  check('★ ST 存储形态 chat[i].variables.stat_data ⇒ {stat_data:…}',
    !!n1.stat_data && n1.stat_data.金钱 === 7 && n1.chat === undefined, JSON.stringify(n1))
  // ★ 对照臂：平铺树**不许**被包一层（包了 ERA 卡的 data-era 路径会全断）
  const flat = { 世界信息: { 时间: { 时间详情: '10:00' } } }
  check('★★ 对照臂：平铺树不被无差别包成 {stat_data:…}（否则 ERA 卡路径全断）',
    normalizeStatData(flat) === flat && normalizeStatData(flat).stat_data === undefined,
    JSON.stringify(normalizeStatData(flat)))
  const SID6 = 'synth-sd-' + Date.now()
  const p6 = parseVariableOps('_.set("stat_data.金钱", 100)\n_.set("stat_data.主角.名字", "露西")')
  const s6 = applyVariableMessage(SID6, { key: null, ops: p6.ops })
  check('★ 命令式写 stat_data.xxx ⇒ 顶层键就是 stat_data（卡里路径能对上）',
    pick(s6, 'stat_data.金钱') === 100 && pick(s6, 'stat_data.主角.名字') === '露西', JSON.stringify(s6))
  const p6b = parseVariableOps('<VariableEdit>{"chat":{"0":{"variables":{"stat_data":{"钱":7}}}}}</VariableEdit>')
  check('★ 块载荷是 ST 存储形态时也归一',
    !!p6b.ops[0].data.stat_data && p6b.ops[0].data.stat_data.钱 === 7, JSON.stringify(p6b.ops[0].data))
}

// ───────────────────────── 7. 真数据（取不到就 SKIP）─────────────────────────
console.log('\n[7] 真聊天文件（有则跑，无则 SKIP）')
const CHAT = process.env.MUV_CHAT || 'C:/MySpecialFolder/SillyTavern/data/default-user/chats/_足控天堂2/_足控天堂2 - 2026-09-20@01h18m07s166ms.jsonl'
if (!fs.existsSync(CHAT)) {
  console.log('  SKIP 找不到真聊天文件（用 MUV_CHAT 指定）')
} else {
  const msgs = fs.readFileSync(CHAT, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
  const parsed = msgs.map((m) => parseVariableOps(m.mes || '')).filter((p) => p.ops.length)
  check('★ 真消息里解析出增量块（这个卡的全部数据都靠它）', parsed.length > 0, '带块消息=' + parsed.length)
  check('★ 真数据的块没有解析失败（bad=0；踩过 VariableThink 提及错配）',
    parsed.every((p) => p.bad === 0), JSON.stringify(parsed.map((p) => p.bad)))
  const SID = 'real-' + Date.now()
  let st = null
  for (const p of parsed) st = applyVariableMessage(SID, { key: p.key, epoch: p.epoch, ops: p.ops })
  check('★ 真数据算出非空状态', st && Object.keys(st).length > 0, JSON.stringify(st).slice(0, 120))
  check('★ 卡的选项拿到了真实文本（不是空串）',
    typeof pick(st, '剧情选项.选项1') === 'string' && pick(st, '剧情选项.选项1').length > 2,
    JSON.stringify(pick(st, '剧情选项.选项1')))
  check('★ 数值被运行时值覆盖（好感度不再是卡的初值）',
    typeof pick(st, '主播档案.超天酱.数值.好感度') === 'number',
    JSON.stringify(pick(st, '主播档案.超天酱.数值.好感度')))
}

// ───────────────────────── 8. ④ MVU JSONPatch（<UpdateVariable> 内的 <JSONPatch>） ─────────────────────────
console.log('\n[8] ④ MVU JSONPatch（真实块夹具，session-7347d5f7 实锤）')
const TRACKER_SRC = fs.readFileSync(new URL('./lib/var-tracker.js', import.meta.url), 'utf8')
{
  // ★ 对照臂（结构）：识别代码被砍掉时这个标记串就不存在 ⇒ 本节全部行为断言跟着红
  check('★ 对照臂（结构）：解析器里有 JSONPatch 识别（砍掉新解析必红）',
    TRACKER_SRC.includes('JSONPATCH_TAG_RE') && TRACKER_SRC.includes("kind: 'jpadd'"))

  // 真实块（逐字取自 tools/_probe-uv.mjs 对 session-7347d5f7 的 dump，2026-09-24）
  const REAL_UV = `<UpdateVariable>
<Analysis>
- time passed: about 15 minutes since the door was pushed open (11:27 to 11:42)
- dramatic updates allowed: no, this is a first-contact scene with no major event
- variables: time initialized; race affinity for 凛原族 set to base 5 (no offense committed); personal affinity left empty since no companion agreed yet
</Analysis>
<JSONPatch>
[
  { "op": "insert", "path": "/时间", "value": { "日期": "09-12", "时刻": "11:42" } },
  { "op": "insert", "path": "/种族好感度", "value": { "凛原族": 5 } },
  { "op": "insert", "path": "/个人好感度", "value": {} }
]
</JSONPatch>
</UpdateVariable>`

  const p8 = parseVariableOps(REAL_UV)
  check('★ 真实块解析出 3 个 op（砍掉新解析 = ops 0 = 本条当场红）',
    p8.ops.length === 3, JSON.stringify({ ops: p8.ops.length, bad: p8.bad, jp: p8.jsonPatch }))
  check('★ insert 映射成 jpadd（对象路径 = 设键）',
    p8.ops.every((o) => o.kind === 'jpadd'), JSON.stringify(p8.ops.map((o) => o.kind)))
  check('★ jsonPatch 统计：blocks=1 ops=3 bad=0',
    !!p8.jsonPatch && p8.jsonPatch.blocks === 1 && p8.jsonPatch.ops === 3 && p8.jsonPatch.bad === 0,
    JSON.stringify(p8.jsonPatch))
  const SID8 = 'synth-jp-real-' + Date.now()
  const s8 = applyVariableMessage(SID8, { key: p8.key, ops: p8.ops })
  check('★ insert×3 落树正确（时间/种族好感度/个人好感度 三个顶层键）',
    pick(s8, '时间.时刻') === '11:42' && pick(s8, '种族好感度.凛原族') === 5
      && s8['个人好感度'] && Object.keys(s8['个人好感度']).length === 0,
    JSON.stringify(s8))
  check('★ <Analysis> 的思考痕迹绝不进变量（英文行一个字都不在树里）',
    JSON.stringify(s8).indexOf('time passed') < 0 && JSON.stringify(s8).indexOf('first-contact') < 0,
    JSON.stringify(s8).slice(0, 120))
  check('★ 与真消息同构：era_data 消息键照常取到（顺序语义与既有三来源一致）', (() => {
    const MSG = '<VariableThink>提及 <JSONPatch> 不算块</VariableThink>\n' + REAL_UV +
      '\n<era_data>{"era-message-key"="era_mk_1789928999999_x1","era-message-type"="assistant"}</era_data>'
    const p = parseVariableOps(MSG)
    return p.key === 'era_mk_1789928999999_x1' && p.ops.length === 3 && p.bad === 0
  })(), '...')
  check('★ 重复送达无副作用（幂等，与 ②③ 同一口径）',
    JSON.stringify(applyVariableMessage(SID8, { key: p8.key, ops: p8.ops })) === JSON.stringify(s8))

  // ops 语义矩阵：delta / 追加 / JSON Pointer 转义 / replace / move / remove
  const MIX = '<UpdateVariable><JSONPatch>[' +
    '{ "op": "insert", "path": "/文本键", "value": "abc" },' +
    '{ "op": "delta", "path": "/好感", "value": 3 },' +
    '{ "op": "delta", "path": "/文本键", "value": 1 },' +
    '{ "op": "insert", "path": "/清单", "value": ["甲"] },' +
    '{ "op": "insert", "path": "/清单", "value": "乙" },' +
    '{ "op": "insert", "path": "/排队/-", "value": "尾" },' +
    '{ "op": "replace", "path": "/a~1b~0c", "value": 7 },' +
    '{ "op": "move", "from": "/清单", "path": "/旧清单" },' +
    '{ "op": "remove", "path": "/不存在" },' +
    '{ "op": "bogus", "path": "/x" },' +
    '{ "op": "insert" }' +
    ']</JSONPatch></UpdateVariable>'
  const p8b = parseVariableOps(MIX)
  check('★ 坏 op 跳过并计数（bad=2），同数组的好 op 一个不丢',
    p8b.jsonPatch.ops === 9 && p8b.jsonPatch.bad === 2 && p8b.bad === 2,
    JSON.stringify({ jp: p8b.jsonPatch, bad: p8b.bad }))
  const s8b = applyVariableMessage('synth-jp-mix-' + Date.now(), { ops: p8b.ops })
  check('★ delta：缺失从 0 起算；**已存在**的非数字路径跳过（不是从 0 重算）',
    s8b['好感'] === 3 && s8b['文本键'] === 'abc', JSON.stringify(s8b))
  check('★ insert 到数组父层 = 追加到末尾（["甲"] 再插 "乙" ⇒ 两元素）',
    JSON.stringify(s8b['旧清单']) === JSON.stringify(['甲', '乙']), JSON.stringify(s8b['旧清单']))
  check('★ 路径以 /- 结尾 = 追加（父层缺失时建成数组）',
    JSON.stringify(s8b['排队']) === JSON.stringify(['尾']), JSON.stringify(s8b['排队']))
  check('★ JSON Pointer 转义：~1 → /、~0 → ~（replace 按保守策略缺失也设值）',
    s8b['a/b~c'] === 7 && p8b.jsonPatch.byOp.replace === 1, JSON.stringify(s8b))
  check('★ move：整树搬移（值深拷贝，源位置消失）',
    JSON.stringify(s8b['旧清单']) === JSON.stringify(['甲', '乙']) && s8b['清单'] === undefined,
    JSON.stringify(s8b))
  check('★ remove：目标不存在 = 无操作（重放幂等）', !('不存在' in s8b), JSON.stringify(s8b))

  // 坏块：跳过计数，不整批失败（后面的真块照常解析）
  const p8c = parseVariableOps('<UpdateVariable><JSONPatch>not json</JSONPatch></UpdateVariable>' + REAL_UV)
  check('★ 坏块跳过（bad≥1）且不整批失败（真块照常 3 op）',
    p8c.bad >= 1 && p8c.jsonPatch.blocks === 1 && p8c.jsonPatch.ops === 3,
    JSON.stringify({ bad: p8c.bad, jp: p8c.jsonPatch }))
  check('★ <initvar> 形态不被误计成 bad（① 的地盘不碰）', (() => {
    const p = parseVariableOps('<UpdateVariable><initvar>时间: 11:42</initvar></UpdateVariable>')
    return p.jsonPatch.blocks === 0 && p.jsonPatch.bad === 0
  })(), '...')
  check('★ Analysis 里的 JSON 形状文本不被宽容分支误吃（先剔 Analysis 再找补丁体）', (() => {
    const p = parseVariableOps('<UpdateVariable><Analysis>示例 [1,2,3] 与 {\"op\":1}</Analysis>[{"op":"delta","path":"/好感","value":2}]</UpdateVariable>')
    return p.jsonPatch.ops === 1 && p.ops[0].kind === 'jpdelta' && p.bad === 0
  })(), '...')

  // 顺序语义：带消息键按 epoch 重放（乱序送达结果一致），与 ②③ 同一套账本
  const ka = { key: 'era_mk_1000_ja', epoch: 1000, ops: [{ kind: 'jpdelta', path: '/好感', delta: 5 }] }
  const kb = { key: 'era_mk_2000_jb', epoch: 2000, ops: [{ kind: 'jpdelta', path: '/好感', delta: 3 }] }
  const JA = 'synth-jp-ord-' + Date.now()
  const JB = 'synth-jp-ord2-' + Date.now()
  let oa = null
  for (const f of [ka, kb]) oa = applyVariableMessage(JA, f)
  let ob = null
  for (const f of [kb, ka]) ob = applyVariableMessage(JB, f)
  check('★★ JSONPatch 混入键序账本：乱序送达 = 顺序送达（好感=8）',
    oa['好感'] === 8 && JSON.stringify(oa) === JSON.stringify(ob),
    'A=' + JSON.stringify(oa) + '  B=' + JSON.stringify(ob))

  // ★ 对照臂（行为）：同一消息里 ④ 与 ② 混合时各解析各的、不重复解析
  const p8d = parseVariableOps('<VariableEdit>{"来源":"era"}</VariableEdit>' + REAL_UV)
  check('★ ④ 与 ② 混合一条消息：块各归各（1 variableedit + 3 jpadd，按文中位置排序），无重复',
    p8d.ops.length === 4 &&
    p8d.ops.map((o) => o.kind).join(',') === 'variableedit,jpadd,jpadd,jpadd' && p8d.bad === 0,
    JSON.stringify(p8d.ops.map((o) => o.kind)))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
