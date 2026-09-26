// ★ 这是**建议给 `verify-tavern-card-locator.mjs` 的补丁草稿**，不是被测对象本身。
// 既有门禁我没动（纪律要求），但它的 A 段已经把"请求形状"钉在旧契约上，
// 而新契约多了一个前置请求（权威解析）。这里把该补丁**跑出来**，
// 让父代理能直接看到"打上补丁后 A 段会变成什么"，再决定要不要落地。
//
// 与既有门禁的差别（只有两处，都是"跟着被测对象的真实契约走"，不是放宽断言）：
//   ① harness 里 fetch 桩要按调用次序回答：第 1 次是 `/api/tavern/current-session`，
//      之后才是 `/api/muv-table/tavern-card`。
//   ② A 段的形状断言从「URL 里带 sessionId」改成「URL 里带**该会话自己的**
//      presetId + preferPreset=1（不得带别的东西）」—— 断言强度不降：
//      旧形状在新代码下**根本不会出现**，继续钉它就是钉一个不存在的东西。
//
// 跑法：node .tmp-locator-patched-preview.mjs        （在当前 client.js 上跑）
import { readFileSync } from 'node:fs'
import { extractFunction } from './test-client-source.mjs'
import { moduleVarStatements } from './verify-shared.mjs'

const SRC = readFileSync(process.env.MUV_CLIENT_SRC || './lib/client.js', 'utf8')
const parts = [
  Object.values(moduleVarStatements(SRC)).join('\n'),
  extractFunction(SRC, 'currentSessionId'),
  extractFunction(SRC, 'currentPresetId'),
  extractFunction(SRC, 'fetchAuthoritativePresetId'),
  extractFunction(SRC, 'fetchTavernCard'),
  extractFunction(SRC, 'muvEraLocator'),
  'return { fetchTavernCard: fetchTavernCard, muvEraLocator: muvEraLocator }',
].join('\n')

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name) } else {
    fail++; fails.push(name + '  -> ' + detail); console.log('  ❌ ' + name + '  -> ' + detail)
  }
}

async function build(sid, pid) {
  const seen = []
  const warns = []
  const debugs = []
  const win = { __DSH_TAVERN_SESSIONS__: undefined }
  const document = { documentElement: { getAttribute: () => null, setAttribute: () => {} }, getElementById: () => null, querySelector: () => null }
  const localStorage = { getItem: () => (pid || null) }
  const location = { href: sid ? 'http://127.0.0.1:3080/?session=' + sid : 'http://127.0.0.1:3080/' }
  // ★ 唯一的 harness 改动：按 URL 回答【权威解析】与【取卡】两种请求。
  const fetchStub = (u) => {
    const url = String(u)
    seen.push(url)
    if (url.indexOf('/api/tavern/current-session') === 0) {
      // 该会话的权威声明 = 面板上那个 presetId（这里让两者一致，好做形状断言）
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, sessionId: sid, presetId: pid || 'default' }) })
    }
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
  }
  const cons = { debug: (m) => debugs.push(String(m)), warn: (m) => warns.push(String(m)), log() {} }
  const factory = new Function('window', 'document', 'localStorage', 'location', 'fetch', 'console', parts)
  const api = factory(win, document, localStorage, location, fetchStub, cons)
  return { api, seen, warns, debugs }
}

const SID = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const PID = 'preset-mt5ip9cc-t6josi'

console.log('=== A.（新契约）有会话：必须先问权威解析，再带**该会话自己的** presetId + preferPreset=1 ===')
{
  const { api, seen } = await build(SID, PID)
  await api.fetchTavernCard()
  const auth = seen[0] || ''
  const card = seen[1] || ''
  check('A0 第 1 次请求是权威解析（带 sessionId）', auth.indexOf('/api/tavern/current-session') === 0 && auth.indexOf('sessionId=' + SID) >= 0, auth || '(空)')
  check('A1 第 2 次请求带该会话自己的 presetId', card.indexOf('presetId=' + PID) >= 0, card || '(空)')
  check('A2 第 2 次请求带 preferPreset=1（"我就是要它，别管会话"的显式声明）', card.indexOf('preferPreset=1') >= 0, card || '(空)')
  check('A3 第 2 次请求**不**带 sessionId（不把两个定位依据都送出去）', !/sessionId=/.test(card), card || '(空)')
}

console.log('\n=== B. 认不出会话：保留面板兜底（既有 B1/B2 的行为，未被本轮改动）===')
{
  const { api, seen } = await build('', PID)
  await api.fetchTavernCard()
  const u = seen[0] || ''
  check('B1 认不出会话时请求带上 presetId 兜底', u.indexOf('presetId=' + PID) >= 0, u || '(空 URL)')
  check('B2 兜底生效时请求参数不为空', /\?/.test(u), u || '(空 URL)')
}

console.log('\n=== C. 两个都没有：空参数 + 留痕 ===')
{
  const { api, seen, warns } = await build('', '')
  await api.fetchTavernCard()
  check('C1 空参数请求', seen[0] === '/api/muv-table/tavern-card', seen[0] || '(空)')
  check('C2 空参数时 console.warn 如实留痕', warns.some((w) => /认不出会话|默认预设/.test(w)), JSON.stringify(warns))
}

console.log('\n=== D. muvEraLocator 同一逻辑 ===')
{
  const { api } = await build(SID, PID)
  check('D1 有会话 ⇒ sessionId=…', api.muvEraLocator() === 'sessionId=' + SID, api.muvEraLocator())
  const { api: api2 } = await build('', PID)
  check('D2 无会话 ⇒ presetId=… 兜底', api2.muvEraLocator() === 'presetId=' + PID, api2.muvEraLocator())
}

console.log('\n断言: ' + pass + ' 通过, ' + fail + ' 失败 ===')
if (fail) console.log('\n失败项：\n  ' + fails.join('\n  '))
process.exit(fail ? 1 : 0)
