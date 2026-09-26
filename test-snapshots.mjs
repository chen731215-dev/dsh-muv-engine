// 门禁：按楼快照 + 时间旅行（2026-09-22 新增）。
//
// 覆盖五件容易写错的事（每件都配**能真的变红**的对照臂）：
//   ① 快照必须存"应用该消息之后"的树 —— 对照臂：若实现存的是"当前状态"的活引用，
//      旧楼的快照会被后续楼层改写（好感度跟着涨到最新值）；
//   ② 每会话 200 条上限，超限淘汰**楼层最旧**（键里的毫秒时间戳，不是到达序）；
//   ③ 单条快照 200KB 口径：超大的存占位（data:null），不把内存吃爆；
//   ④ GET 两个查询参数的响应形状（snapshots=1 / messageKey=，含 404）；
//   ⑤ 无参 GET 的形状**不变**（面板与卡都在用；响应里不许多出 snapshots 字段）。
//
// HTTP 形状直接挂真实路由测：用桩 `ctx.webServer.register` 捕获 `lib/index.js` 的路由表，
// 调的是**真实 handler**（不是复刻一份逻辑 —— 复刻会测出假绿）。
//
// Run: node test-snapshots.mjs
import { apply } from './lib/index.js'
import { applyVariableMessage, getSnapshots, getSnapshot } from './lib/var-tracker.js'

let fail = 0
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS ' + name)
  else { fail++; console.log('  FAIL ' + name + (detail ? '\n        → ' + detail : '')) }
}
const pick = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)

// ───────────────────────── 1. 快照按"应用该消息之后"取样 ─────────────────────────
console.log('\n[1] 快照按"应用该消息之后"取样（不是当前状态的活引用）')
{
  const SID = 'snap-1-' + Date.now()
  const msg = (key, epoch, 好感度) => ({
    key, epoch,
    ops: [{ kind: 'variableedit', data: { 主播档案: { 超天酱: { 数值: { 好感度 } } } } }],
  })
  applyVariableMessage(SID, msg('era_mk_1000_s1', 1000, 10))
  applyVariableMessage(SID, msg('era_mk_2000_s1', 2000, 55))
  applyVariableMessage(SID, msg('era_mk_3000_s1', 3000, 100))
  const s1 = getSnapshot(SID, 'era_mk_1000_s1')
  const s2 = getSnapshot(SID, 'era_mk_2000_s1')
  const s3 = getSnapshot(SID, 'era_mk_3000_s1')
  check('★ 一楼快照停在当时的数值（好感度=10，不是 100）',
    s1 && pick(s1.data, '主播档案.超天酱.数值.好感度') === 10,
    JSON.stringify(s1))
  check('二楼快照停在二楼（好感度=55）',
    s2 && pick(s2.data, '主播档案.超天酱.数值.好感度') === 55,
    JSON.stringify(s2))
  check('三楼快照是三楼（好感度=100）',
    s3 && pick(s3.data, '主播档案.超天酱.数值.好感度') === 100,
    JSON.stringify(s3))
  // ★ 对照臂（能红）：快照若是当前状态的活引用，一楼会被三楼改写成 100 —— 上面三条全红。
  //   这里再钉一条别名纪律：改快照树不得影响别的快照（存的是独立副本）。
  const before = JSON.stringify(getSnapshot(SID, 'era_mk_2000_s1').data)
  s3.data.主播档案.超天酱.数值.好感度 = 999
  check('★ 快照是独立副本（改一棵不影响另一棵）',
    JSON.stringify(getSnapshot(SID, 'era_mk_2000_s1').data) === before)
  // 乱序晚到：旧楼晚到时，它自己的快照按"键序 ≤ 该楼"定向重放 —— 不掺进未来的数值
  const SID2 = 'snap-1b-' + Date.now()
  applyVariableMessage(SID2, msg('era_mk_3000_s1b', 3000, 100)) // 新楼先到
  applyVariableMessage(SID2, msg('era_mk_1000_s1b', 1000, 10))  // 旧楼晚到
  const late = getSnapshot(SID2, 'era_mk_1000_s1b')
  check('★ 乱序晚到的旧楼：快照取在"键序 ≤ 该楼"（好感度=10，不被三楼的 100 污染）',
    late && pick(late.data, '主播档案.超天酱.数值.好感度') === 10,
    JSON.stringify(late))
  // 无键消息不产生快照（时间旅行只对有键的楼有意义）
  const SID3 = 'snap-1c-' + Date.now()
  applyVariableMessage(SID3, { key: null, ops: [{ kind: 'variableedit', data: { x: 1 } }] })
  check('★ 无键消息不产生快照', getSnapshots(SID3).length === 0, JSON.stringify(getSnapshots(SID3)))
  // 快照按取样时间正序列出
  check('快照清单按时间正序（键序 1000→2000→3000）',
    getSnapshots(SID).map((s) => s.key).join(',') === 'era_mk_1000_s1,era_mk_2000_s1,era_mk_3000_s1',
    JSON.stringify(getSnapshots(SID).map((s) => s.key)))
  check('快照形状带 key/at/data 三键',
    getSnapshots(SID).every((s) => typeof s.key === 'string' && typeof s.at === 'number' && 'data' in s),
    JSON.stringify(getSnapshots(SID).map((s) => Object.keys(s))))
}

// ───────────────────────── 2. 200 条上限：淘汰楼层最旧 ─────────────────────────
console.log('\n[2] 每会话 200 条上限，超限淘汰楼层最旧的')
{
  const SID = 'snap-2-' + Date.now()
  const mkKey = (epoch) => 'era_mk_' + epoch + '_evict'
  // 199 条：全都在
  for (let i = 1; i <= 199; i++) {
    applyVariableMessage(SID, { key: mkKey(i * 1000), epoch: i * 1000, ops: [{ kind: 'set', path: 'v' + i, value: i }] })
  }
  check('★ 对照臂：199 条时一条不丢（上限没被误触）', getSnapshots(SID).length === 199,
    String(getSnapshots(SID).length))
  // 再来 2 条：201 条 → 淘汰楼层最旧的 1 条
  for (let i = 200; i <= 201; i++) {
    applyVariableMessage(SID, { key: mkKey(i * 1000), epoch: i * 1000, ops: [{ kind: 'set', path: 'v' + i, value: i }] })
  }
  const keys = new Set(getSnapshots(SID).map((s) => s.key))
  check('★ 超限后恰好 200 条', getSnapshots(SID).length === 200, String(getSnapshots(SID).length))
  check('★ 淘汰的是楼层最旧的（era_mk_1000 没了）', !keys.has(mkKey(1000)), JSON.stringify([...keys].slice(0, 3)))
  check('★ 最新的楼还在（era_mk_201000 在）', keys.has(mkKey(201000)))
  // 乱序到达时也按楼层时间淘汰：新楼先到，挤掉的是更老的楼而不是后到的旧楼
  const SID2 = 'snap-2b-' + Date.now()
  applyVariableMessage(SID2, { key: mkKey(500000), epoch: 500000, ops: [{ kind: 'set', path: 'a', value: 1 }] })
  for (let i = 2; i <= 200; i++) {
    applyVariableMessage(SID2, { key: mkKey(500000 + i * 1000), epoch: 500000 + i * 1000, ops: [{ kind: 'set', path: 'b', value: 1 }] })
  }
  applyVariableMessage(SID2, { key: mkKey(1000), epoch: 1000, ops: [{ kind: 'set', path: 'old', value: 1 }] }) // 旧楼最后到
  const keys2 = new Set(getSnapshots(SID2).map((s) => s.key))
  check('★ 乱序到达时淘汰的仍是楼层最旧的（era_mk_1000 被挤出，era_mk_502000/503000 保住）',
    !keys2.has(mkKey(1000)) && keys2.has(mkKey(502000)) && keys2.has(mkKey(503000)),
    JSON.stringify([...keys2].slice(0, 3)))
}

// ───────────────────────── 3. 单条 200KB 口径：超大存占位 ─────────────────────────
console.log('\n[3] 单条快照超大（>200KB）存占位（data:null），键与时间仍可查')
{
  const SID = 'snap-3-' + Date.now()
  // 先存一条正常快照做对照臂
  applyVariableMessage(SID, { key: 'era_mk_1000_big', epoch: 1000, ops: [{ kind: 'set', path: '正常.字段', value: 1 }] })
  const big = 'x'.repeat(250 * 1024) // 250KB 的字符串值 ⇒ 应用后的树必然 > 200KB
  applyVariableMessage(SID, { key: 'era_mk_2000_big', epoch: 2000, ops: [{ kind: 'set', path: '巨型.载荷', value: big }] })
  const normal = getSnapshot(SID, 'era_mk_1000_big')
  const huge = getSnapshot(SID, 'era_mk_2000_big')
  check('★ 对照臂：正常快照有树（data 非 null）', !!normal && normal.data !== null && normal.data['正常']['字段'] === 1,
    JSON.stringify(normal))
  check('★ 超大快照存占位（data 恰为 null）', !!huge && huge.data === null, JSON.stringify(huge))
  check('★ 占位仍带键与时间（key/at 齐全）', typeof huge.key === 'string' && typeof huge.at === 'number',
    JSON.stringify({ key: huge.key, at: typeof huge.at }))
  check('★ 占位计入清单（snapshots=1 能看到它）', getSnapshots(SID).some((s) => s.key === 'era_mk_2000_big'))
}

// ───────────────────────── 4. HTTP 形状：真实路由 + 真实 handler ─────────────────────────
console.log('\n[4] GET /api/muv-engine/state 的三个口径（真实 handler，不是复刻逻辑）')
// 桩捕获路由表 → 调真实 handler。这是防"复刻一份逻辑测出假绿"的关键。
const routes = []
apply({ webServer: { register: (r) => routes.push(r) } })
const stateRoute = routes.find((r) => r.path === '/api/muv-engine/state')
if (!stateRoute) {
  check('路由表里有 /api/muv-engine/state', false, '注册了 ' + routes.length + ' 条路由')
} else {
  const callGet = async (qs) => {
    let status = null
    let body = null
    const res = {
      writeHead(s) { status = s },
      end(b) { body = JSON.parse(b) },
    }
    await stateRoute.handler({ method: 'GET', url: '/api/muv-engine/state' + qs }, res)
    return { status, body }
  }
  const SID = 'snap-http-' + Date.now()
  const msg = (key, epoch, v) => ({ key, epoch, ops: [{ kind: 'set', path: '数值', value: v }] })
  applyVariableMessage(SID, msg('era_mk_1000_http', 1000, 10))
  applyVariableMessage(SID, msg('era_mk_2000_http', 2000, 55))

  // ⑤ 无参 GET：形状不变（面板与卡的既有口径）
  const plain = await callGet('?sessionId=' + SID)
  check('★ 无参 GET：状态码 200', plain.status === 200, String(plain.status))
  check('★ 无参 GET：{ ok, state:{ data, updatedAt } }（不多不少）',
    plain.body.ok === true && typeof plain.body.state === 'object' && plain.body.state !== null
    && 'data' in plain.body.state && 'updatedAt' in plain.body.state
    && Object.keys(plain.body.state).length === 2,
    JSON.stringify(Object.keys(plain.body)))
  check('★ 无参 GET：响应顶层没有 snapshots 字段（形状不许变）', !('snapshots' in plain.body),
    JSON.stringify(Object.keys(plain.body)))
  check('★ 无参 GET：data 是当前树（数值=55）', pick(plain.body.state.data, '数值') === 55,
    JSON.stringify(plain.body.state.data))
  // ★ 对照臂（能红）：查询一个不存在的会话，state 为 null —— 无参形状对空会话也成立
  const empty = await callGet('?sessionId=snap-none-' + Date.now())
  check('★ 对照臂：空会话无参 GET 仍是 { ok, state:null }',
    empty.status === 200 && empty.body.ok === true && empty.body.state === null, JSON.stringify(empty.body))

  // ④a snapshots=1：{ ok, snapshots:[…] }，时间正序
  const list = await callGet('?sessionId=' + SID + '&snapshots=1')
  check('★ snapshots=1：状态码 200 且 ok', list.status === 200 && list.body.ok === true, JSON.stringify(list.body).slice(0, 120))
  check('★ snapshots=1：顶层数组字段名恰为 snapshots，条目形状 { key, at, data }',
    Array.isArray(list.body.snapshots) && list.body.snapshots.length === 2
    && list.body.snapshots.every((s) => typeof s.key === 'string' && typeof s.at === 'number' && 'data' in s && Object.keys(s).length === 3),
    JSON.stringify(list.body))
  check('★ snapshots=1：按时间正序',
    list.body.snapshots.map((s) => s.key).join(',') === 'era_mk_1000_http,era_mk_2000_http',
    JSON.stringify(list.body.snapshots.map((s) => s.key)))
  const listEmpty = await callGet('?sessionId=snap-none-' + Date.now() + '&snapshots=1')
  check('★ 对照臂：空会话 snapshots=1 → 空数组（不是 undefined/error）',
    listEmpty.status === 200 && Array.isArray(listEmpty.body.snapshots) && listEmpty.body.snapshots.length === 0,
    JSON.stringify(listEmpty.body))

  // ④b messageKey= 命中：形状与普通 GET 完全一致（面板不用改解析）
  const hit = await callGet('?sessionId=' + SID + '&messageKey=era_mk_1000_http')
  check('★ messageKey= 命中：状态码 200', hit.status === 200, String(hit.status))
  check('★ messageKey= 命中：{ ok, state:{ data, updatedAt } } —— 与普通 GET 同形',
    hit.body.ok === true && typeof hit.body.state === 'object' && hit.body.state !== null
    && 'data' in hit.body.state && 'updatedAt' in hit.body.state
    && Object.keys(hit.body.state).length === 2,
    JSON.stringify(Object.keys(hit.body)))
  check('★ messageKey= 命中：data 是**该楼**的树（数值=10，不是当前的 55）',
    pick(hit.body.state.data, '数值') === 10, JSON.stringify(hit.body.state.data))
  // 超大占位楼：messageKey 命中但 data 为 null（200 语义，不是 404 —— 键存在）
  const SIDbig = 'snap-http-big-' + Date.now()
  applyVariableMessage(SIDbig, { key: 'era_mk_2000_big', epoch: 2000, ops: [{ kind: 'set', path: '巨型', value: 'x'.repeat(250 * 1024) }] })
  const hitBig = await callGet('?sessionId=' + SIDbig + '&messageKey=era_mk_2000_big')
  check('★ 超大占位楼：键存在 → 200 + data:null（不是 404）',
    hitBig.status === 200 && hitBig.body.ok === true && hitBig.body.state.data === null, JSON.stringify(hitBig.body).slice(0, 120))
  // ④c messageKey= 未命中：404 语义
  const miss = await callGet('?sessionId=' + SID + '&messageKey=era_mk_9999_absent')
  check('★ messageKey= 未命中：404 + { ok:false, error:"snapshot-not-found" }',
    miss.status === 404 && miss.body.ok === false && miss.body.error === 'snapshot-not-found',
    JSON.stringify({ status: miss.status, body: miss.body }))
}

console.log('\n=== 结果: ' + (fail ? fail + ' 项失败' : '全部通过') + ' ===')
process.exit(fail ? 1 : 0)
