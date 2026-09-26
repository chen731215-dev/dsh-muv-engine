// ★ 断死 P1-3 回归：**认不出会话时，必须带上 `presetId` 兜底**。
//
// 为什么必须有这条门禁（实测，`node .tmp-live-ab.mjs`，真实运行中的 3080）：
//   `?sessionId=…`      ⇒ presetSource=session  ⇒ 剧本 >0 ⇒ 正文改写
//   `?presetId=…`       ⇒ presetSource=explicit ⇒ 剧本 >0 ⇒ 正文改写
//   无任何参数          ⇒ presetSource=default  ⇒ **剧本 0 条 ⇒ applied=0 ⇒ 正文原样吐回**
//                          （`<content>`/`<now_plot>`/`<Abstract>`/3 个 `<img>` 全部裸奔）
// 最后那行就是用户截图那个"整段没渲染"的签名。P1-3 第一版把兜底删了 ⇒ 认不出会话就必红。
//
// ── ★★ 契约变更（2026-09-20，装饰串台那一轮；父代理裁定落地）────────────────
//
// **旧契约**（本文件 A 段原来钉的）：有会话时"只带 sessionId"。
//   它建立在"`muv-table` 会按会话查出**该会话自己的**卡"这个假设上 —— 那个假设**不成立**：
//   `?sessionId=…` 走的是 `muv-table` 的 `fromSession()`，它**只读 `session-bindings.json`
//   这个快照**（会过期），从不看会话日志里最新那条 `agent-preset/selected`。
//   实测（`session-c98dfb13-…`，改数据**之前**）：
//     bindings        = preset-mt4pv17b-9qzo89 → 魔法少女MVU测试 / 8 条脚本
//     会话自己的声明  = preset-mt5ip9cc-t6josi → _足控天堂2     / 10 条脚本
//   装饰链当时读到的是 bindings 那张 ⇒ 用**别的卡**的剧本去改写本卡正文 ⇒
//   该卡的标记没人认领 ⇒ 正文原样吐回（"后面全是纯文本"），
//   以及"工作区里会话互相串用美化"。
//
// **新契约**：有会话时先问**权威来源** `/api/tavern/current-session`（读会话日志），
//   再带 `presetId=<该会话自己的>&preferPreset=1` 取卡（= 酒馆状态栏那条链已经在做的同一套）。
//   所以 A 段的形状断言相应改成"带该会话自己的 presetId + preferPreset=1，且**不带** sessionId"。
//   ★ 这不是放宽断言：旧形状在新代码下**根本不会出现**，继续钉它等于钉一个不存在的东西；
//     新断言对"身份是否来自该会话自己的声明"的约束**更强**（旧形状允许服务端去查过期 bindings）。
//
//   B 段的"认不出会话 ⇒ 面板 presetId 兜底"**保留**（它防的是更糟的"整条裸奔"），
//   但代价必须写明：那个值来自面板 `dataset.presetId` / localStorage，**切换会话后可能仍粘着
//   上一个会话的预设**。所以只要**能认出会话**，就绝不走它。
//
// 本门禁**不走网络**：逐字提取 `fetchTavernCard` 与 `muvEraLocator`，用桩替换
// `currentSessionId` / `currentPresetId` / `fetch`，只看**发出去的 URL**。
// 这样它测的是"客户端到底送了什么定位依据"，与端点是否可达无关。
//
// 能红的证据（三种破坏法，任一都必须让本门禁红）：
//   ① 把 `else { var pid = currentPresetId() … }` 整段删掉（= P1-3 第一版）
//   ② 把 `currentPresetId()` 换成 `return ''` 的桩
//   ③ 把 `muvEraLocator` 的 `presetId` 兜底单独删掉（只修一半）
// 跑法：node verify-tavern-card-locator.mjs
//       node verify-tavern-card-locator.mjs --break=fallback      （期望红）
//       node verify-tavern-card-locator.mjs --break=pid-empty     （期望红）
//       node verify-tavern-card-locator.mjs --break=era-half      （期望红）
import { readFileSync } from 'node:fs'
import { extractFunction } from './test-client-source.mjs'
import { moduleVarStatements } from './verify-shared.mjs'

const SRC = readFileSync(process.env.MUV_CLIENT_SRC || './lib/client.js', 'utf8')

const BREAK = (() => {
  const a = process.argv.find((x) => x.startsWith('--break='))
  return a ? a.slice('--break='.length) : ''
})()

let src = SRC
if (BREAK === 'fallback') {
  // ① 删掉 `fetchTavernCard` 里的 presetId 兜底（还原成 P1-3 第一版）
  const before = src
  src = src.replace(
    /\r?\n[ \t]*var pid = currentPresetId\(\)\r?\n[ \t]*if \(pid\) params\.push\('presetId=' \+ encodeURIComponent\(pid\)\)/,
    '\n          /*break:fallback*/')
  if (src === before) { console.log('⚠ --break=fallback 没命中源码，门禁自身失效'); process.exit(2) }
} else if (BREAK === 'pid-empty') {
  // ② 让 currentPresetId 永远回空
  const a = src.indexOf('function currentPresetId() {')
  const b = src.indexOf('\n    }', a)
  src = src.slice(0, a) + 'function currentPresetId() { return \'\'\n' + src.slice(b + 1)
} else if (BREAK === 'era-half') {
  // ③ 只删 muvEraLocator 的兜底（只修一半）
  const before = src
  src = src.replace(
    /\r?\n[ \t]*var pid = ''\r?\n[ \t]*try \{ pid = currentPresetId\(\) \} catch \(_\) \{ pid = '' \}\r?\n[ \t]*if \(pid\) return 'presetId=' \+ encodeURIComponent\(pid\)/,
    "\n      /*break:era-half*/")
  if (src === before) { console.log('⚠ --break=era-half 没命中源码，门禁自身失效'); process.exit(2) }
}

const parts = [
  Object.values(moduleVarStatements(src)).join('\n'),
  extractFunction(src, 'currentSessionId'),
  extractFunction(src, 'currentPresetId'),
  extractFunction(src, 'fetchAuthoritativePresetId'),
  extractFunction(src, 'fetchTavernCard'),
  extractFunction(src, 'muvEraLocator'),
  'return { fetchTavernCard: fetchTavernCard, muvEraLocator: muvEraLocator }',
].join('\n')

let pass = 0
let fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name) } else {
    fail++; fails.push(name + '  -> ' + detail); console.log('  ❌ ' + name + '  -> ' + detail)
  }
}

async function build(sid, pid, opts) {
  const seen = []
  const warns = []
  const debugs = []
  const win = { __DSH_TAVERN_SESSIONS__: undefined }
  const document = {
    documentElement: { getAttribute: () => null },
    getElementById: () => null,
    querySelector: () => null,
  }
  const localStorage = { getItem: () => (pid || null) }
  // `currentSessionId()` 的三条路：会话服务 → URL → DOM 属性。
  // 这里走 URL 那条（最贴近真实：DSH 的会话 id 就在地址里）。
  // 注意 `currentSessionId` 的正则是 /session[/=:-]([a-f0-9-]{20,})/i，
  // 所以 href 里要写成 `?session=session-<uuid>` 这种形态才命中。
  const location = { href: sid ? 'http://127.0.0.1:3080/?session=' + sid : 'http://127.0.0.1:3080/' }
  // ★ 契约变更后必须打桩的第二种请求：**权威解析**。
  //   装饰链现在第一步是 `fetchAuthoritativePresetId(sessionId)`（`lib/client.js`），
  //   它读 `/api/tavern/current-session`。原来的桩对**所有** URL 都回 `{ok:true}`，
  //   于是权威解析拿到"没有 presetId" ⇒ 代码判定"无法判定" ⇒ 本次不取卡 ⇒
  //   一个请求都不发 ⇒ A 段拿到的 URL 是空串（红的原因全是缺桩，不是行为退化）。
  const fetchStub = (u) => {
    const url = String(u)
    seen.push(url)
    if (url.indexOf('/api/tavern/current-session') === 0) {
      // 该会话的权威声明 = 面板上那个 presetId（让两者一致，好做形状断言）
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, sessionId: sid, presetId: pid || 'default' }) })
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
  }
  const cons = { debug: (m) => debugs.push(String(m)), warn: (m) => warns.push(String(m)), log() {} }
  const factory = new Function(
    'window', 'document', 'localStorage', 'location', 'fetch', 'console',
    parts)
  const api = factory(win, document, localStorage, location, fetchStub, cons)
  return { api, seen, warns, debugs }
}

console.log('=== A.（新契约）有会话：先问权威解析，再带**该会话自己的** presetId + preferPreset=1 ===')
{
  const SID = 'session-aaaaaaaa-1111-2222-3333-444444444444'
  const PID = 'preset-sess-own'
  const { api, seen, debugs } = await build(SID, PID)
  await api.fetchTavernCard()
  const auth = seen[0] || ''
  const u = seen[1] || ''
  check('A0 第 1 次请求是权威解析（带 sessionId）',
    auth.indexOf('/api/tavern/current-session') === 0 && auth.indexOf('sessionId=' + SID) >= 0, auth || '(空)')
  check('A1 请求带**该会话自己的** presetId（不是服务端去查 bindings 得到的）',
    /[?&]presetId=preset-sess-own/.test(u), u || '(空 URL)')
  check('A2 请求带 preferPreset=1（"我就是要它，别管会话"的显式声明）',
    /[?&]preferPreset=1/.test(u), u || '(空 URL)')
  check('A3 请求**不**带 sessionId（不把两个定位依据都送出去）', !/[?&]sessionId=/.test(u), u || '(空 URL)')
  check('A4 定位有留痕（console.debug）', debugs.some((w) => /presetId=/.test(w)), JSON.stringify(debugs))
}

console.log('\n=== B. ★ 无 sessionId、有 presetId：必须带上 presetId 兜底（P1-3 回归就在这里）===')
console.log('    代价说明：这个值是面板 dataset.presetId / localStorage，**切换会话后可能仍粘着')
console.log('    上一个会话**。所以只要能认出会话就绝不走它（见 A 段）；这里只保证"认不出会话时')
console.log('    不落成空参请求"—— 空参会让服务端落到 default ⇒ 0 条剧本 ⇒ 整条消息裸奔（比串台更糟）。')
{
  const { api, seen } = await build('', 'preset-mt5ip9cc-t6josi')
  await api.fetchTavernCard()
  const u = seen[0] || ''
  check('B1 ★ 认不出会话时请求带上了 presetId 兜底', /[?&]presetId=preset-mt5ip9cc-t6josi/.test(u), u || '(空 URL)')
  check('B2 兜底生效时请求参数不为空（空参 ⇒ 服务端 default ⇒ 剧本 0 条 ⇒ 正文裸奔）',
    /\?/.test(u), u || '(空 URL)')
}

console.log('\n=== C. 两个都没有：空参数（维持现状），但必须留痕 ===')
{
  const { api, seen, warns } = await build('', '')
  await api.fetchTavernCard()
  check('C1 两个 id 都没有时是空参数请求', seen[0] === '/api/muv-table/tavern-card', seen[0] || '(空)')
  check('C2 ★ 空参数时 console.warn 如实留痕（不许静默）',
    warns.some((w) => /认不出会话|默认预设/.test(w)), JSON.stringify(warns))
}

console.log('\n=== D. muvEraLocator 同一逻辑（别只修一半）===')
{
  const SID = 'session-bbbbbbbb-1111-2222-3333-444444444444'
  const { api } = await build(SID, 'preset-wrong')
  const loc = api.muvEraLocator()
  check('D1 有会话 ⇒ sessionId=…', loc === 'sessionId=' + SID, loc)

  const { api: api2 } = await build('', 'preset-mt5ip9cc-t6josi')
  const loc2 = api2.muvEraLocator()
  check('D2 ★ 无会话 ⇒ presetId=… 兜底（否则喂给卡的是**别的卡**的变量树）',
    loc2 === 'presetId=preset-mt5ip9cc-t6josi', loc2 || '(空串)')
}

console.log('\n断言: ' + pass + ' 通过, ' + fail + ' 失败 ===')
if (fail) { console.log('\n失败项：\n  ' + fails.join('\n  ')) }
process.exit(fail ? 1 : 0)
