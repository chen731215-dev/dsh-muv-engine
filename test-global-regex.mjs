// 门禁：全局正则脚本库（lib/global-regex.js + lib/index.js 的 /global-regex 三路由
//        + apply-regex-card 的"全局先卡级后"合并，§28）。
//
// Run: node test-global-regex.mjs
//
// 覆盖：
//   ① 三种（+compatibility 包裹共四种）导入形态解析
//   ② 去重统计（upsert 覆盖 / append 跳过）
//   ③ 非法 findRegex 跳过并计数（不抛、不整批失败）
//   ④ 全局先卡级后的合并顺序（含**真变红**对照臂：顺序颠倒断言必须失败）
//   ⑤ 全局关闭（disabled）不跑
//   ⑥ 全局脚本同样走 placement/depth 过滤（复用 matchesMode 语义）
//   ⑦ API 形状（GET/POST/DELETE + 405/404/400）
//   ⑧ 容量拒绝（单条 256KB 超限跳过计数 / 库总量 200 条整批 400）
//
// 数据目录走 MUV_ENGINE_DATA_DIR 指到 .tmp-gr-data（global-regex.js 在**调用时**
// 解析环境变量，所以 import 顺序无所谓），测完即删。
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractGlobalScripts, importGlobalScripts, loadGlobalScripts, canCompileFindRegex } from './lib/global-regex.js'
import { applyAllRegexScripts } from './lib/regex-engine.js'
import { apply } from './lib/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA = path.join(__dirname, '.tmp-gr-data')
process.env.MUV_ENGINE_DATA_DIR = DATA
fs.rmSync(DATA, { recursive: true, force: true })

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const mk = (scriptName, findRegex, replaceString, extra = {}) =>
  ({ scriptName, findRegex, replaceString, ...extra })

console.log('=== ① 导入形态宽容解析 ===\n')
const one = [mk('去星号', '/\\*[^*]*\\*/g', '')]
check('①a 裸数组', extractGlobalScripts(one).length === 1)
check('①b {scripts:[…]}', extractGlobalScripts({ scripts: one }).length === 1)
check('①c {data.extensions.regex_scripts}', extractGlobalScripts({ data: { extensions: { regex_scripts: one } } }).length === 1)
check('①d compatibility 包裹（scripts）', extractGlobalScripts({ compatibility: { scripts: one } }).length === 1)
check('①e compatibility 包裹（data.extensions）', extractGlobalScripts({ compatibility: { data: { extensions: { regex_scripts: one } } } }).length === 1)
check('①f 认不出 → 空数组（调用方给 no-scripts-found）', extractGlobalScripts({ hello: 1 }).length === 0)

console.log('\n=== ② 去重统计（upsert 覆盖 / append 跳过）===\n')
check('库初始为空', loadGlobalScripts().length === 0)
const s1 = importGlobalScripts([mk('A', '甲', '一'), mk('B', '乙', '二')])
check('②a 首次导入 added=2', s1.added === 2 && s1.replaced === 0, eq(s1))
check('②b total=2', s1.total === 2)
const s2 = importGlobalScripts([mk('A', '甲', '一新版'), mk('B', '乙', '二新版')])
check('②c 同名同式默认覆盖 replaced=2', s2.replaced === 2 && s2.added === 0, eq(s2))
check('②d 覆盖后 replaceString 是新版', loadGlobalScripts()[0].replaceString === '一新版')
check('②e 覆盖不改变库序/条数', loadGlobalScripts().length === 2)
const s3 = importGlobalScripts([mk('A', '甲', '又改了')], { mode: 'append' })
check('②f append 模式同名跳过 skipped=1', s3.skipped === 1 && s3.added === 0, eq(s3))
check('②g append 后内容不变', loadGlobalScripts()[0].replaceString === '一新版')
const idA = loadGlobalScripts()[0].id
importGlobalScripts([mk('A', '甲', '再改')])
check('②i 重导后 id 不变', loadGlobalScripts()[0].id === idA)

console.log('\n=== ③ 非法 findRegex 跳过并计数 ===\n')
check('③a 编译探针本身可用', canCompileFindRegex('/a/g') && canCompileFindRegex('甲') && !canCompileFindRegex('[unc'))
const bad = importGlobalScripts([mk('坏', '[unc', 'x'), mk('空', '', 'x'), mk('好', '丙', '三')])
check('③b 坏条目 invalid 计数=2', bad.invalid === 2, eq(bad))
check('③c 好条目照常入库 added=1', bad.added === 1)
check('③d reasons 有明细', Array.isArray(bad.reasons) && bad.reasons.length === 2)
check('③e 库里只有好条目', loadGlobalScripts().every(s => canCompileFindRegex(s.findRegex)))

console.log('\n=== ④ 合并顺序：全局（先）+ 卡级（后）===\n')
// 用真管道（applyCardScripts ← applyAllRegexScripts）验证，不另造语义。
// 顺序语义是**顺序作用在同一份演进文本上**（与 ST 相同）：
//   全局先跑 'A'→'B'；卡级后跑 'B'→'C'（吃全局的产出）。
//   合并序 [全局,卡级] ⇒ 'C'；颠倒 [卡级,全局] ⇒ 'B' —— 两序结果可分，对照臂才是真的。
const G = [mk('全局净化', 'A', 'B')]
const CARD = [mk('卡级专属', 'B', 'C')]
// 重新建库：只留 G（把前面测试脚本清掉，隔离本节）
fs.rmSync(DATA, { recursive: true, force: true })
importGlobalScripts(G)
const merged = [...loadGlobalScripts(), ...CARD]           // ← 与 apply-regex-card 相同的合并式
const flipped = [...CARD, ...loadGlobalScripts()]          // ← 对照臂：顺序颠倒
const outMerged = applyAllRegexScripts('A', merged).text
const outFlipped = applyAllRegexScripts('A', flipped).text
check('④a 全局先跑、卡级后跑 → 卡级压过全局', outMerged === 'C', outMerged)
check('④b ★ 对照臂（顺序颠倒）断言必须失败（红=对照有效）', outFlipped === 'B' && outFlipped !== outMerged, outFlipped)
check('④c 无全局时卡级行为不变', applyAllRegexScripts('B', CARD).text === 'C')

console.log('\n=== ⑤ 全局关闭（disabled）不跑 ===\n')
fs.rmSync(DATA, { recursive: true, force: true })
importGlobalScripts([mk('停用', 'B', '全局', { disabled: true })])
check('⑤a disabled 全局不生效（卡级独跑）', applyAllRegexScripts('B', [...loadGlobalScripts(), ...CARD]).text === 'C')

console.log('\n=== ⑥ 全局脚本走同一套 placement/depth 过滤 ===\n')
fs.rmSync(DATA, { recursive: true, force: true })
importGlobalScripts([mk('仅提示侧', 'B', '全局', { promptOnly: true })])
const withGlobal = [...loadGlobalScripts(), ...CARD]
check('⑥a promptOnly 全局不跑显示侧', applyAllRegexScripts('B', withGlobal, 'display').text === 'C')
check('⑥b promptOnly 全局跑 prompt 侧', applyAllRegexScripts('B', withGlobal, 'prompt').text === '全局')
fs.rmSync(DATA, { recursive: true, force: true })
importGlobalScripts([mk('深楼限定', 'B', '全局', { minDepth: 5 })])
const withDepth = [...loadGlobalScripts(), ...CARD]
check('⑥c minDepth=5 的全局在 depth 0 不跑', applyAllRegexScripts('B', withDepth, 'display', { depth: 0 }).text === 'C')
check('⑥d minDepth=5 的全局在 depth 6 跑', applyAllRegexScripts('B', withDepth, 'display', { depth: 6 }).text === '全局')

console.log('\n=== ⑦ API 形状（路由桩注入）===\n')
const routes = []
apply({ webServer: { register: r => routes.push(r) } })
const gr = routes.find(r => r.path === '/api/muv-engine/global-regex')
const arc = routes.find(r => r.path === '/api/muv-engine/apply-regex-card')
check('⑦a 两条路由都注册了', !!gr && !!arc)

/** 最小 req/res 桩：readBody 吃流，json() 吃 writeHead/end。 */
async function call(route, method, url, body) {
  const req = new PassThrough()
  req.method = method
  req.url = url
  let status = 0, out = null
  const res = {
    writeHead(code) { status = code },
    end(data) { out = JSON.parse(data) },
  }
  if (body !== undefined) req.end(JSON.stringify(body))
  else req.end()
  await route.handler(req, res)
  return { status, body: out }
}

fs.rmSync(DATA, { recursive: true, force: true })
let r = await call(gr, 'GET', '/api/muv-engine/global-regex')
check('⑦b GET 空库 → {ok,scripts:[]}', r.status === 200 && r.body.ok === true && eq(r.body.scripts, []), eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { scripts: [mk('A', '甲', '一'), mk('坏', '[unc', 'x')] })
check('⑦c POST 导入 → 统计形状', r.status === 200 && r.body.ok === true && r.body.added === 1 && r.body.invalid === 1 && typeof r.body.total === 'number', eq(r))
r = await call(gr, 'GET', '/api/muv-engine/global-regex')
check('⑦d GET 回读（含 id/scriptName/findRegex）', r.body.scripts.length === 1 && r.body.scripts[0].id && r.body.scripts[0].scriptName === 'A', eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex?mode=append', { scripts: [mk('A', '甲', '改')] })
check('⑦e ?mode=append 跳过同名', r.body.skipped === 1 && r.body.added === 0, eq(r))
const delId = (await call(gr, 'GET', '/api/muv-engine/global-regex')).body.scripts[0].id
r = await call(gr, 'DELETE', '/api/muv-engine/global-regex?id=' + delId)
check('⑦f DELETE by id → {ok,deleted}', r.status === 200 && r.body.deleted === delId, eq(r))
r = await call(gr, 'DELETE', '/api/muv-engine/global-regex?id=' + delId)
check('⑦g 再删同 id → 404 not-found', r.status === 404 && r.body.error === 'not-found', eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { action: 'delete', id: 'gr_nope' })
check('⑦h POST action:delete 不存在 → 404', r.status === 404, eq(r))
r = await call(gr, 'PUT', '/api/muv-engine/global-regex')
check('⑦i 其他方法 → 405', r.status === 405)
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { hello: 1 })
check('⑦j 认不出形态 → 400 no-scripts-found', r.status === 400 && r.body.error === 'no-scripts-found', eq(r))

console.log('\n=== ⑧ 容量纪律 ===\n')
// ⑧a 单条 replaceString 超 256KB → 该条跳过计数（整批不失败）
fs.rmSync(DATA, { recursive: true, force: true })
const big = 'x'.repeat(256 * 1024 + 1)
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { scripts: [mk('超大', '丁', big), mk('正常', '戊', '五')] })
check('⑧a 超限条目 skipped 计数、好条目入库', r.status === 200 && r.body.skipped === 1 && r.body.added === 1 && r.body.reasons.some(x => x.includes('256KB')), eq(r))
// ⑧b 库总量超 200 → 整批 400
fs.rmSync(DATA, { recursive: true, force: true })
const bulk = Array.from({ length: 200 }, (_, i) => mk('n' + i, '模式' + i, '值' + i))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { scripts: bulk })
check('⑧b 恰好 200 条可以入库', r.status === 200 && r.body.total === 200, eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { scripts: [mk('n200', '模式200', '值')] })
check('⑧c 第 201 条 → 400 capacity-exceeded（整批拒绝）', r.status === 400 && String(r.body.error).includes('capacity-exceeded'), eq(r))
check('⑧d 拒绝后库仍 200 条', loadGlobalScripts().length === 200)

console.log('\n=== ⑨ apply-regex-card 合并（API 层）===\n')
fs.rmSync(DATA, { recursive: true, force: true })
// 与 ④ 同一套可分序用例：全局 'B'→'全局' 先跑，卡级 'B'→'C' 后跑吃其产出？——
// 不行：卡级 findRegex 'B' 在全局产出 '全局' 上落空。API 层改用**与 ④ 相同的
// 链式对**：全局 'A'→'B'，卡级 'B'→'C'，输入 'A' ⇒ 合并序 'C'、颠倒序 'B'。
importGlobalScripts([mk('全局净化', 'A', 'B')])
const cardJson = { data: { extensions: { regex_scripts: [mk('卡级专属', 'B', 'C')] } } }
r = await call(arc, 'POST', '/api/muv-engine/apply-regex-card', { text: 'A', cardJson })
check('⑨a 全局先跑、卡级后跑（卡级吃全局产出）', r.body.text === 'C', eq(r))
check('⑨b statusBarHtml 仍只从卡级提取（全局无状态栏时为 null）', r.body.statusBarHtml === null, eq(r))
r = await call(arc, 'POST', '/api/muv-engine/apply-regex-card', { text: 'A', cardJson: { data: { extensions: { regex_scripts: [] } } } })
check('⑨c 卡无脚本时全局照常生效', r.body.text === 'B', eq(r))

// 收尾：删测试数据目录（global-regex.json 不留在工作区，data/ 也已进 .gitignore）
fs.rmSync(DATA, { recursive: true, force: true })

console.log('\n=== ⑩ set-disabled（面板启停开关的引擎侧）===\n')
// 重建一条：导入 → 关 → 再开。对照臂：id 不存在必须 404（判断据没有空转成永真）。
fs.mkdirSync(DATA, { recursive: true })
importGlobalScripts([mk('启停目标', '停我', '好的')])
const sid = loadGlobalScripts()[0].id
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { action: 'set-disabled', id: sid, disabled: true })
check('⑩a set-disabled true → 200 且落盘', r.status === 200 && r.body.disabled === true, eq(r))
check('⑩b 落盘后重读 disabled=true', loadGlobalScripts()[0].disabled === true)
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { action: 'set-disabled', id: sid, disabled: false })
check('⑩c set-disabled false → 重读为 false', r.status === 200 && loadGlobalScripts()[0].disabled === false, eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { action: 'set-disabled', id: 'gr_nope', disabled: true })
check('⑩d id 不存在 → 404（对照臂）', r.status === 404, eq(r))
r = await call(gr, 'POST', '/api/muv-engine/global-regex', { action: 'set-disabled' })
check('⑩e 缺 id → 400', r.status === 400, eq(r))
fs.rmSync(DATA, { recursive: true, force: true })

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
