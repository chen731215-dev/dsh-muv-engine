// 会话识别来源门禁（新文件）：把 `currentSessionId()` 的**五级来源**逐级钉住。
//
// 为什么需要它：装饰链只有在**认出会话**时才有依据；认不出时只剩"退回面板预设"那一档，
// 而那个值是**会粘住**的全局值（`dataset.presetId` / `localStorage['dsh-tavern-active-preset']`）。
// 所以"`!sid` 到底会不会发生"必须有判据，不能靠感觉。
//
// 逐字提取真实的 `currentSessionId()`，用桩驱动它，逐级断言：
//   L1 DSH 会话服务（`__DSH_TAVERN_SESSIONS__.list.getSnapshot().current`）
//   L2 **惰性重解析**（`__DSH_TAVERN_CTX__.get('sessions')`）—— 酒馆那边早修过（
//      `client.manager.bundle.js:1198`），装饰链原先漏了；这是 `!sid` 的**主要**成因
//   L3 URL（`location.href` 里的 `session[=:-]<uuid>`）
//   L4 `document.documentElement[data-dsh-current-session]`
//   L5 全空 ⇒ 返回 ''（此时调用方才会走"面板预设"那一档）
//
// 还有一条**负载**断言：L1/L2 命中时必须把 id 写回 L4 —— 那是"一次认出来之后
// 就再也不会认不出"的机制（后续调用靠 L4 兜住），去掉它 `!sid` 会变回可重复发生。
//
// 能红的证据（3 种破坏法，任一都必须让本门禁红）：
//   ① 删掉惰性重解析（L2 整段）      ⇒ --break=lazy
//   ② 删掉写回 L4 的 setAttribute     ⇒ --break=stamp
//   ③ 删掉 L4 读取                    ⇒ --break=attr
// 跑法：node verify-session-id-sources.mjs
//       node verify-session-id-sources.mjs --break=lazy   （期望红）
import { readFileSync } from 'node:fs'
import { extractFunction } from './test-client-source.mjs'
import { moduleVarStatements } from './verify-shared.mjs'

const SRC = process.env.MUV_CLIENT_SRC || './lib/client.js'
const raw = readFileSync(SRC, 'utf8')
const BREAK = (() => {
  const a = process.argv.find(x => x.startsWith('--break='))
  return a ? a.slice('--break='.length) : ''
})()

const LF = s => s.replace(/\r\n/g, '\n')
let src = LF(raw)
const before = src
if (BREAK === 'lazy') {
  // ① 删掉惰性重解析（L2）
  src = src.replace(/if \(!svc \|\| !svc\.list \|\| typeof svc\.list\.getSnapshot !== 'function'\) \{[\s\S]*?\n        \}\n/, '')
} else if (BREAK === 'stamp') {
  // ② 删掉写回 L4
  src = src.replace(/try \{ document\.documentElement\.setAttribute\('data-dsh-current-session', sid\) \} catch \(_\) \{\}/, '')
} else if (BREAK === 'attr') {
  // ③ 删掉 L4 读取
  src = src.replace(/try \{\n\s*var cached = document\.documentElement\.getAttribute\('data-dsh-current-session'\)\n\s*if \(cached\) return cached\n\s*\} catch \(_\) \{\}/, '')
}
if (BREAK && src === before) { console.log('⚠ --break=' + BREAK + ' 没命中源码，门禁自身失效'); process.exit(2) }

const parts = [
  Object.values(moduleVarStatements(src)).join('\n'),
  extractFunction(src, 'currentSessionId'),
  'return { currentSessionId: currentSessionId }',
].join('\n')

const UUID = 'aaaaaaaa-1111-2222-3333-444444444444'
const SID = 'session-' + UUID

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅ ' + name) } else {
    fail++; fails.push(name + '  -> ' + detail); console.log('  ❌ ' + name + '  -> ' + detail)
  }
}

/**
 * @param {object} opt
 * @param {string|null} opt.snapshotCurrent  L1 快照里的 current（null = 服务说"没有激活会话"）
 * @param {boolean} opt.serviceAvailable     L1/L2 服务是否可取
 * @param {string|null} opt.ctxValue         L2 惰性重解析能否拿到服务（null = 拿不到）
 * @param {string} opt.href                  L3 URL
 * @param {string|null} opt.attr             L4 属性
 * @returns {{sid:string, sets:string[], gets:string[]}}
 */
function run({ snapshotCurrent = null, serviceAvailable = true, ctxValue = null, href = 'http://127.0.0.1:3080/', attr = null }) {
  const sets = []
  const gets = []
  const svc = serviceAvailable
    ? { list: { getSnapshot: () => ({ current: snapshotCurrent }) } }
    : undefined
  const win = {
    __DSH_TAVERN_SESSIONS__: svc,
    __DSH_TAVERN_CTX__: { get: (n) => { gets.push(n); return n === 'sessions' ? ctxValue : null } },
  }
  const document = {
    documentElement: {
      getAttribute: () => attr,
      setAttribute: (k, v) => { sets.push(k + '=' + v) },
    },
  }
  const factory = new Function('window', 'document', 'location', parts)
  const api = factory(win, document, { href })
  return { sid: api.currentSessionId(), sets, gets }
}

console.log('=== L1 DSH 会话服务命中 ===')
{
  const r = run({ snapshotCurrent: UUID, href: 'http://127.0.0.1:3080/' })
  check('L1 服务给出 current ⇒ 返回 session-<uuid>', r.sid === SID, JSON.stringify(r.sid))
  check('L1 命中时把 id 写回 documentElement（这是"以后不会再认不出"的机制）',
    r.sets.some(s => s === 'data-dsh-current-session=' + SID), JSON.stringify(r.sets))
}

console.log('\n=== L2 惰性重解析（服务当时还没 provide）===')
{
  const r = run({ serviceAvailable: false, ctxValue: { list: { getSnapshot: () => ({ current: UUID }) } } })
  check('L2 从 __DSH_TAVERN_CTX__.get(\'sessions\') 补回服务 ⇒ 仍能认出会话',
    r.sid === SID, JSON.stringify({ sid: r.sid, gets: r.gets }))
  check('L2 确实去问了 ctx.get(\'sessions\')', r.gets.indexOf('sessions') >= 0, JSON.stringify(r.gets))
}

console.log('\n=== L3 URL ===')
{
  const r = run({ serviceAvailable: false, href: 'http://127.0.0.1:3080/?session=' + SID })
  check('L3 从 URL 里认出会话', r.sid === SID, JSON.stringify(r.sid))
}

console.log('\n=== L4 属性（本会话**曾经**认出过一次之后的兜底）===')
{
  // 模拟真实序列：第一次认出会话（L1）→ 之后服务不可用，只有属性在
  const first = run({ snapshotCurrent: UUID })
  const stamped = (first.sets[0] || '').split('=').slice(1).join('=')
  const r = run({ serviceAvailable: false, attr: stamped })
  check('L4 服务不可用时靠属性仍能认出会话（这正是 L1 写回的价值）',
    r.sid === SID, JSON.stringify({ stamped, sid: r.sid }))
}

console.log('\n=== L5 三级全空 ⇒ 返回空串（此时才会走"面板预设"那一档）===')
{
  const r = run({ serviceAvailable: false, href: 'http://127.0.0.1:3080/' })
  check('L5 全空时返回空串', r.sid === '', JSON.stringify(r.sid))
  check('L5 全空时**没有**去写属性（不留假信息）', r.sets.length === 0, JSON.stringify(r.sets))
}

console.log('\n=== 非法 current 不得被当成会话 id（防止把别的十六进制串当会话）===')
{
  const r = run({ snapshotCurrent: 'preset-mt5ip9cc-t6josi', href: 'http://127.0.0.1:3080/' })
  check('L1 快照里的非法值被拒，并继续往下走（这里 L3/L4 都没有 ⇒ 空串）',
    r.sid === '', JSON.stringify(r.sid))
}

console.log('\n断言: ' + pass + ' 通过, ' + fail + ' 失败 ===' + (BREAK ? '  [--break=' + BREAK + ']' : ''))
if (fail) console.log('\n失败项：\n  ' + fails.join('\n  '))
process.exit(fail ? 1 : 0)
