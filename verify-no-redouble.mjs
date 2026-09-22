// 门禁：绝不把自己的装饰产物当成原文再跑一遍（重复装饰）
//
// 为什么单独立门禁：这条链路的输入是 **DOM 的 `innerText`**，而我们的产物本身就长在
// 那个 DOM 里。一旦重复装饰，卡正则照旧能匹配 `<content>`（字面量还在），但
// `<Abstract>` 的标签已被换成 `<div class="muv-abstract">` ⇒ card [7]
// 「对玩家隐藏摘要」（`/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`，大小写敏感 + 行锚）
// 必然落空 ⇒ 摘要正文（时间/地点/摘要内容）永久露在正文里，我们自己的
// 📖 / 💭 变量推演 / 酒馆的 ✏️ 也一并变成"正文"。
//
// 本门禁跑**真实的 `_decorateOne`**（从 lib/client.js 逐字提取），三档夹具：
//   A 干净正文      ⇒ 必须被装饰（证明守卫不是"把整条链掐死"）
//   B 已含我们产物  ⇒ 必须**一个字符都不动**
//   C 面板（无正文容器）⇒ 必须不碰（实测 DSH 的 `_paneBody_*` 曾被吃掉内容）
// 并跑 before 臂（`git show <BEFORE_REV>:lib/client.js`）：B 档在旧实现下**必须被处理** ——
// 否则判据只是"永远为真"，证明不了任何事。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { openPage, evalJson, sleep } from './verify-shared.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = fs.readFileSync(path.join(HERE, 'lib/client.js'), 'utf8')

// before 臂钉在"修复前"的那个提交上（本文件写下时的 HEAD）。
// 若该提交不可得，或它已经含守卫，则**如实报 SKIP**，不伪造对照。
const BEFORE_REV = process.env.MUV_BEFORE_REV || 'a7031dc'

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')) }
}

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const m = re.exec(src)
  if (!m) return null
  let i = m.index + m[0].length, depth = 1
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === "'" || c === '"' || c === '`') {
      const q = c; i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
    } else if (c === '/') {
      const nx = src[i + 1]
      if (nx === '/') { while (i < src.length && src[i] !== '\n') i++ }
      else if (nx === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++ }
    }
    i++
  }
  return src.slice(m.index, i)
}

const SEL = /var MUV_OWN_SEL = '([^']*)'/.exec(SRC)[1]
const BODY_RE = /var MSG_BODY_RE = (\/[^\n]*)/.exec(SRC)[1]

/** 生成一页夹具：真实守卫三件套 + 真实的 `_decorateOne`（或旧版） */
function buildPage(decorateSrc, tag) {
  const guard = [
    extractFunction(SRC, 'muvHasOwnArtifacts'),
    extractFunction(SRC, 'muvMessageBodyOf'),
    extractFunction(SRC, 'muvRawTextOf'),
  ].join('\n')
  const JUNK = '<div class="muv-statusbar-wrap"><iframe class="muv-iframe" srcdoc="x"></iframe></div>' +
    '<div class="muv-abstract"><span class="muv-abstract-icon">📖</span> 时间：2026年.08月.26日 10:00 ~ 10:15 摘要内容 主角在办公室核算现金</div>' +
    '<details class="muv-varthink"><summary>💭 变量推演</summary><div>意图分析</div></details>' +
    '<button>✏️</button>'
  return '<!DOCTYPE html><html><body style="background:#fff">' +
    '<div id="a" class="_markdown_aa_1"><p>### 正文</p><p>&lt;content&gt;干净的正文&lt;/content&gt;</p></div>' +
    '<div id="b" class="_markdown_bb_2">' + JUNK + '<p>看起来好好的正文</p></div>' +
    '<div id="c" class="_paneBody_17p4l_478">空面板✏️</div>' +
    '<script>\n' +
    'var MUV_OWN_SEL = ' + JSON.stringify(SEL) + ';\n' +
    'var MSG_BODY_RE = ' + BODY_RE + ';\n' +
    'var DECORATED_ATTR = "data-muv-decorated";\n' +
    'window.__calls = [];\n' +
    'var beautifyMuv = function (raw) { window.__calls.push({ fn: "beautifyMuv", raw: String(raw).slice(0, 60) }); return "<p>DECORATED</p>" };\n' +
    'var applyDecoratedHtml = function (body, html) { window.__calls.push({ fn: "apply", html: String(html).slice(0, 40) }); body.innerHTML = html };\n' +
    'var muvPushChatLog = function () {};\n' +
    'var muvFeedVariables = function () {};\n' +
    'var muvSanitizeNode = function () {};\n' +
    'var muvDepthFromLaterCount = function (n) { return n };\n' +
    guard + '\n' +
    decorateSrc + '\n' +
    'window.__run = async function (id) {\n' +
    '  var el = document.getElementById(id);\n' +
    '  var before = el.innerHTML;\n' +
    '  window.__calls = [];\n' +
    '  try { await _decorateOne(el, 0) } catch (e) { return JSON.stringify({ err: String(e).slice(0, 90) }) }\n' +
    '  return JSON.stringify({ calls: window.__calls.length, changed: el.innerHTML !== before, marked: el.getAttribute("data-muv-decorated"), rawSeen: window.__calls.length ? window.__calls[0].raw : null, head: String(el.innerText || "").replace(/\\s+/g, " ").slice(0, 70) })\n' +
    '};\n' +
    '<\/script></body></html>'
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-redouble-'))
const rt = await openPage(EDGE, { url: 'about:blank', outDir: tmpDir, windowSize: '1200,900' })
try {
  async function arm(decorateSrc, label, expectCleanDecorated) {
    console.log('\n=== ' + label + ' ===')
    const file = path.join(tmpDir, 'arm-' + label.replace(/[^\w]/g, '_') + '.html')
    fs.writeFileSync(file, buildPage(decorateSrc, label), 'utf8')
    await rt.cdp.send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') }, rt.pageSession)
    await sleep(1200)
    const a = await evalJson(rt.cdp, 'window.__run("a")', rt.pageSession)
    const b = await evalJson(rt.cdp, 'window.__run("b")', rt.pageSession)
    const c = await evalJson(rt.cdp, 'window.__run("c")', rt.pageSession)
    const pa = typeof a === 'string' ? JSON.parse(a) : a
    const pb = typeof b === 'string' ? JSON.parse(b) : b
    const pc = typeof c === 'string' ? JSON.parse(c) : c
    console.log('  A 干净正文       : ' + JSON.stringify(pa))
    console.log('  B 已含我们产物   : ' + JSON.stringify(pb))
    console.log('  C 面板           : ' + JSON.stringify(pc))
    if (expectCleanDecorated === null) return { pa, pb, pc }
    // beautifyMuv + applyDecoratedHtml 两次调用 —— 判据是"动了没动"，不是次数
    check('A 干净正文被装饰（守卫不是把链路掐死）', pa.calls >= 1 && pa.changed === true, JSON.stringify(pa))
    check('★ A 档取到的是正文（含我们藏掉按钮后的原文）', !!pa.rawSeen, String(pa.rawSeen))
    check('★★ B 档（已含 iframe/📖 摘要框/💭 变量推演/✏️）一个字符都没动',
      pb.calls === 0 && pb.changed === false, JSON.stringify(pb))
    check('★★ C 档（面板，无正文容器）没被碰', pc.calls === 0 && pc.changed === false, JSON.stringify(pc))
    return { pa, pb, pc }
  }

  await arm(extractFunction(SRC, '_decorateOne'), 'after（当前实现）', true)

  // ── before 臂：真实旧实现（git 历史里那个提交）──────────────────────
  let oldSrc = null
  try { oldSrc = execFileSync('git', ['-C', HERE, 'show', BEFORE_REV + ':lib/client.js'], { encoding: 'utf8', maxBuffer: 1 << 28 }) } catch (_) { oldSrc = null }
  if (!oldSrc) {
    console.log('\n=== before 臂 SKIP：取不到 ' + BEFORE_REV + ':lib/client.js ===')
  } else {
    const oldFn = extractFunction(oldSrc, '_decorateOne')
    if (!oldFn) {
      console.log('\n=== before 臂 SKIP：旧源码里没有 _decorateOne ===')
    } else if (oldFn.includes('muvHasOwnArtifacts')) {
      console.log('\n=== before 臂 SKIP：' + BEFORE_REV + ' 已经含守卫（钉错版本了）===')
    } else {
      const r = await arm(oldFn, 'before（' + BEFORE_REV + '，修复前）', null)
      check('★★ 对照臂成立：修复前，B 档（已含我们产物）**确实被再装饰一次** —— 这正是线上那条 bug',
        r.pb.calls >= 1 && r.pb.changed === true, JSON.stringify(r.pb))
      check('★ 对照臂：修复前 B 档读到的"原文"里带着我们自己的标签文字（📖/💭/✏️）',
        /📖|💭|✏️/.test(String(r.pb.rawSeen || '')), String(r.pb.rawSeen))
    }
  }
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===')
process.exit(fail ? 1 : 0)
