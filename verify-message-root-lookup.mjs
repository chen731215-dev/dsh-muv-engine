// Gate: `messageTargets()` 里的消息根查找是不是**活**的。
//
// 背景（本项目反复栽的那一类：看起来接上了，其实没接上）：
//   `messageTargets()` 里有一行 `out.push({ body: body, root: messageRootOf(body) })`，
//   而 `messageRootOf` **在整个 client.js 里没有定义**。那一行在
//   `try { … } catch (_) {}` 里面，所以每次调用都抛 `ReferenceError`、每次被静默吞掉：
//     · `messageTargets()` **恒返回空数组** ⇒ `decorateMessages()` 一条消息都不装饰；
//     · 更要紧的是紧跟其后的 `_decorateOneHook = _decorateOne` 那两行**确实执行了**
//       ⇒ 酒馆面板那条 `MuvEngine.decorateMessage(el)` **不抛错也什么都不做**。
//   于是所有既有门禁都是绿的（它们只看"调了 decorateMessage 没抛"），
//   真实页面上要靠 MutationObserver 再触发一次才可能被装饰。
//
// 三个臂：
//   after    现盘 lib/client.js
//   broken   只把 `messageRootOf` 的函数定义删掉（回到"悬空引用"那一版）
//   before   `324b751:lib/client.js`（那一版也是悬空引用，本门禁就是把它量出来）
//
// 判据分两层，缺一层就会假绿：
//   ① 静态：源码里 `messageRootOf` 有定义、且调用点只有 1 处；
//   ② 真浏览器：`scheduleDecorate()` 之后，页面上的消息体**真的**被打上
//      `data-muv-decorated` —— 这才是用户屏幕上那条路径。
//      只做 ① 会漏掉"定义了但没接上"；只做 ② 会漏掉"这次恰好触发到了"。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-message-root-lookup.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(os.tmpdir(), 'muv-msg-root')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OLD_REV = '324b751'

let bad = 0
const check = (name, ok, detail) => {
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail === undefined ? '' : '  -> ' + String(detail)))
  if (!ok) bad++
}

// ── 静态层（对每一条臂都跑）────────────────────────────────────────────────
const DEF_RE = /(?:^|[\s;])function\s+messageRootOf\s*\(|(?:var|let|const)\s+messageRootOf\s*=/

function staticChecks(src, label) {
  console.log('\n=== 静态：' + label + ' ===')
  const calls = (src.match(/\bmessageRootOf\b/g) || []).length
  const hasDef = DEF_RE.test(src)
  console.log('   出现次数 = ' + calls + '，有定义 = ' + hasDef)
  return { calls, hasDef }
}

// ── 真浏览器层 ────────────────────────────────────────────────────────────
function fixturePage(clientSrc, label) {
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>msg-root-${label}</title></head><body>
<div class="wrap">
  <div class="host"><div id="msg_1" class="_markdown_abc123_1"><p>BEAUTIFY_ONE &lt;StatusPlaceHolderImpl/&gt;</p></div></div>
  <div class="host"><div id="msg_2" class="_markdown_abc123_2"><p>BEAUTIFY_TWO &lt;StatusPlaceHolderImpl/&gt;</p></div></div>
  <div class="host"><div id="msg_3" class="_markdown_abc123_3"><p>BEAUTIFY_THREE &lt;StatusPlaceHolderImpl/&gt;</p></div></div>
</div>
<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${clientSrc.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function () {
  var NOTES = [];
  var SID = 'session-11111111-2222-3333-4444-555555555555';
  window.__DSH_TAVERN_SESSIONS__ = { list: { getSnapshot: function () { return { current: SID } } } };
  window.__DSH_TAVERN_CTX__ = { get: function (n) { return n === 'sessions' ? window.__DSH_TAVERN_SESSIONS__ : null } };
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/tavern/current-session') === 0)
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, presetId: 'preset-probe' }) } });
    if (u.indexOf('/api/muv-table/tavern-card') === 0)
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, name: 'probe', data: { extensions: { regex_scripts: [
        { scriptName: 'mark', disabled: false, findRegex: '/<StatusPlaceHolderImpl\\\\s*\\\\/>/g', replaceString: 'DECORATED_MARK<h2>H</h2><p>P</p>', placement: [1,2], markdownOnly: true, promptOnly: false }
      ] } } }) } });
    if (u.indexOf('/api/muv-engine/apply-regex-card') === 0) {
      var body = JSON.parse(opts.body);
      var scr = (body.cardJson && body.cardJson.regexScripts) || [];
      NOTES.push('apply-regex-card scripts=' + scr.length + ' depth=' + JSON.stringify(body.depth));
      var re = new RegExp(scr[0].findRegex.replace(/^\\//, '').replace(/\\/g$/, ''), 'g');
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, text: String(body.text).replace(re, scr[0].replaceString), applied: 1, statusBarHtml: '' }) } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: false }) } });
  };
  try {
    var ex = window.__mod.factory(function () { return {} });
    NOTES.push('factory=ok');
    if (ex && typeof ex.apply === 'function') { ex.apply(); NOTES.push('apply=ok') } else NOTES.push('apply=MISSING');
  } catch (e) { NOTES.push('boot=THROW:' + e.message) }
  window.addEventListener('error', function (e) { NOTES.push('onerror:' + e.message) });
  window.__muvProbe = function () {
    var ids = ['msg_1', 'msg_2', 'msg_3'];
    var out = { notes: NOTES, decorated: {}, hasMark: {} };
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      out.decorated[ids[i]] = el ? el.getAttribute('data-muv-decorated') : null;
      out.hasMark[ids[i]] = el ? (el.innerHTML.indexOf('DECORATED_MARK') >= 0) : false;
    }
    return out;
  };
})();
<\/script>
</body></html>`
}

/**
 * 跑一条臂：**用 CDP 驱动真浏览器、按真实时间轮询**，不用 `--virtual-time-budget`。
 *
 * 为什么不用 dump-dom + 定时器：装饰链是 async 的（取卡 → 写回 DOM），而
 * `--virtual-time-budget` 会把虚拟时间瞬间推到预算尽头 —— 夹具里那个"等落定再报告"
 * 的 `setInterval` 会在真实 fetch 还没回来时就跑满计数，于是**同一份代码**一次报
 * "3/3 装饰上"、一次报 "0/3"（实测踩到）。门禁里这种抖动最难查，因为它看起来像产品在抖。
 * 改成 Node 侧按真实时间轮询 `window.__muvProbe()` 之后，结论就稳定了。
 */
async function runArm(label, clientSrc) {
  const { launchEdge, sleep } = await import('./verify-shared.mjs')
  const file = path.join(OUT, 'msg-root-' + label + '.html')
  writeFileSync(file, fixturePage(clientSrc, label), 'utf8')
  const { proc, cdp, browserVersion } = await launchEdge(EDGE, 'about:blank')
  try {
    const t = await cdp.send('Target.getTargets')
    const page = t.result.targetInfos.find((x) => x.type === 'page')
    const at = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    const sid = at.result.sessionId
    await cdp.send('Runtime.enable', {}, sid)
    await cdp.send('Page.enable', {}, sid)
    await cdp.send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') + '?v=' + Date.now() }, sid)
    await sleep(600)
    const rd = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails
        return { err: (d.exception && d.exception.description) || d.text }
      }
      return r.result && r.result.result && r.result.result.value
    }
    // 真实时间轮询，最多 20 秒
    let last = null
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const v = await rd('JSON.stringify(window.__muvProbe ? window.__muvProbe() : null)')
      if (typeof v === 'string' && v !== 'null') {
        last = JSON.parse(v)
        const n = Object.values(last.decorated).filter((x) => x === '1').length
        if (n === 3) break
      }
      await sleep(300)
    }
    return last || { failed: true, dom: file, browserVersion }
  } finally {
    try { proc.kill() } catch (_) {}
    cdp.close()
  }
}

const CUR = readFileSync(path.join(__dirname, 'lib', 'client.js'), 'utf8')
function breakDropDef(src) {
  const start = src.indexOf('        function messageRootOf(bodyEl) {')
  if (start < 0) throw new Error('对照臂 broken 的记号找不到（messageRootOf 的定义？）')
  let i = src.indexOf('{', start), depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(0, start) + '        /* broken: messageRootOf 的定义被删掉 */\n' + src.slice(i)
}
let oldSrc = ''
try {
  const r = spawnSync('git', ['show', OLD_REV + ':lib/client.js'], { cwd: __dirname, maxBuffer: 1 << 27, encoding: 'utf8' })
  if (r.status === 0 && r.stdout) oldSrc = r.stdout
} catch (_) {}

const arms = [
  { label: 'after', src: CUR },
  { label: 'broken', src: breakDropDef(CUR) },
]
if (oldSrc) arms.push({ label: 'before-' + OLD_REV, src: oldSrc })
else console.log('\n[警告] 取不到 ' + OLD_REV + ' 的源码，跳过 before 臂（不影响 after/broken 的判定）')

if (!existsSync(EDGE)) throw new Error('找不到浏览器：' + EDGE + '（设 MUV_EDGE）')

console.log('源码: ' + path.join(__dirname, 'lib', 'client.js'))
const statics = {}
for (const arm of arms) statics[arm.label] = staticChecks(arm.src, arm.label)

const results = {}
for (const arm of arms) {
  console.log('\n=== 真浏览器：' + arm.label + ' ===')
  const r = await runArm(arm.label, arm.src)
  results[arm.label] = r
  if (r.failed) { console.log('  （夹具没跑起来：' + r.dom + '）'); continue }
  console.log('  NOTES(' + (r.notes || []).length + '):')
  ;(r.notes || []).forEach(function (n, i) { console.log('    [' + i + '] ' + n) })
  console.log('  data-muv-decorated: ' + JSON.stringify(r.decorated))
  console.log('  产物里出现美化标记  : ' + JSON.stringify(r.hasMark))
}

console.log('\n=== 汇总（能红证据）===')
const a = results['after'] || {}
const aDec = Object.values(a.decorated || {}).filter((v) => v === '1').length
// 从 NOTES 里抠出每一次 apply-regex-card 的 depth（真浏览器里算出来的层号）。
// ★ 必须**先过滤再取**：`NOTES` 里还混着 `factory=ok` / `apply=ok` 这些前置记录，
//   直接 `.map()` 会把它们变成 `null` 混进结果里 —— 那样断言看到的是
//   `[null,null,"2","1","0"]`，报出来像"算错了三层"，其实是解析写错（踩过一次）。
const depthsAfter = (a.notes || [])
  .map((n) => /apply-regex-card .* depth=(.*)$/.exec(String(n)))
  .filter(Boolean)
  .map((m) => m[1])
check('★ 静态：现盘源码里 `messageRootOf` **有定义**', statics['after'].hasDef, '定义=' + statics['after'].hasDef)
check('★ 静态：`messageRootOf` 恰好出现 2 次（1 处定义 + 1 处调用）',
  statics['after'].calls === 2, '出现 ' + statics['after'].calls + ' 次')
check('★ 真浏览器：scheduleDecorate() 之后三条消息体**全部**被打上装饰标记（messageTargets 不再恒空）',
  aDec === 3, JSON.stringify(a.decorated))
check('★★ 真浏览器：三层的 depth 各自算对（最新一条 = 0，越旧越大）',
  JSON.stringify(depthsAfter) === JSON.stringify(['2', '1', '0']),
  '实际 = ' + JSON.stringify(depthsAfter) + '  期望 = ["2","1","0"]')

const b = results['broken'] || {}
const bDec = Object.values(b.decorated || {}).filter((v) => v === '1').length
check('★★ 能红：broken 臂（删掉定义）⇒ 静态断言变红', statics['broken'].hasDef === false, '定义=' + statics['broken'].hasDef)
check('★★ 能红：broken 臂（删掉定义）⇒ 一条消息都装饰不上（messageTargets 恒返回空）',
  bDec === 0, '被装饰条数=' + bDec)

if (oldSrc) {
  const o = results['before-' + OLD_REV] || {}
  const oDec = Object.values(o.decorated || {}).filter((v) => v === '1').length
  check('  before（' + OLD_REV + '）同样是悬空引用、同样装饰不上（对照臂如实变红）',
    statics['before-' + OLD_REV].hasDef === false && oDec === 0,
    '定义=' + statics['before-' + OLD_REV].hasDef + ' 被装饰条数=' + oDec)
}

const verdict = {
  ok: bad === 0,
  statics,
  after: { decorated: a.decorated, hasMark: a.hasMark },
  broken: { decorated: b.decorated },
}
writeFileSync(path.join(__dirname, '.tmp-message-root-report.json'), JSON.stringify(verdict, null, 2), 'utf8')
console.log('\n  结论: ' + (verdict.ok ? '绿灯（after 全绿；broken 臂在静态与真浏览器两层都是红的）' : '红：见上 ' + bad + ' 条'))
process.exit(verdict.ok ? 0 : 1)
