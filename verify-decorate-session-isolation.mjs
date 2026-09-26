// 装饰链路 · 会话隔离门禁（新文件，不改动既有测试）
//
// 被测的是**用户看到的那条路径**：`_decorateOne` → `beautifyMuv` → `fetchTavernCard()`
// → `POST /api/muv-engine/apply-regex-card` → 写回 DOM。
//
// 为什么必须这样测：这条链的卡身份**只在浏览器里才决定**（`currentSessionId()` 读的是
// `window.__DSH_TAVERN_SESSIONS__` / `location.href` / `data-dsh-current-session`，
// 而 `currentPresetId()` 读的是酒馆面板 DOM + localStorage）。字符串断言、Node 假 DOM
// 都测不到"它到底问了哪张卡"。
//
// 做法与 verify-decorate-dom.mjs 一致：把真实 lib/client.js 内联进页面、真浏览器、
// 真 DOM，`exports.apply()` 起真实的 `window.MuvEngine.decorateMessage`；
// 只把 `fetch` 打桩成"按 URL 回答固定卡 JSON"的假 muv-table，
// 并**逐条记录它请求了哪张卡**。
//
// 三条断言，每条都能红：
//   T1 会话隔离：有会话时，装饰**不得**去问全局（面板 / localStorage）预设的卡。
//               把 `fetchTavernCard` 的 `sessionId` 优先级改掉 → T1 红。
//   T2 状态隔离：两个不同会话的元素各自用各自卡的脚本（产物各带各的标记）。
//               把卡 JSON 缓存成模块级一次性变量 → T2 红。
//   T3 不缓存：同一会话里 5 条消息 → 5 次取卡（不得只在第一/二条生效）。
//               把 `fetchTavernCard()` 换成"填一次就复用"的缓存 → T3 红。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-decorate-session-isolation.mjs
// 对照：$env:MUV_CLIENT_SRC="<另一份 client.js>" 可做修复前后对比。
//
// ── 能红的证据（--break 变体，都必须变红） ────────────────────────────────
// 原文里的旧变体靠"删掉守卫枚举里的 `<content>`"制造红 —— 守卫改成**标签无关判据**
// 之后那种破坏法已经没有意义了（判据里没有枚举可删）。现在改成两种与新设计同构的破坏法：
//   node verify-decorate-session-isolation.mjs --break=guard-enum    （守卫改回旧枚举 ⇒ T6 红）
//   node verify-decorate-session-isolation.mjs --break=guard-never   （守卫恒不通过 ⇒ T5/T6 全红）
// T6 那一档（正文里只有 `<video>…</video>`）就是为了让 `guard-enum` 能红而加的：
// 旧枚举认得 T5 那档的 `<content>`，所以只破坏回枚举时 T5 照样绿。

import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_PATH = process.env.MUV_CLIENT_SRC || path.join(__dirname, 'lib', 'client.js')
const CLIENT_RAW = readFileSync(SRC_PATH, 'utf8')
const OUT = path.join(os.tmpdir(), 'muv-deco-isolation')
mkdirSync(OUT, { recursive: true })

// ── 守卫行的破坏法（BEFORE 臂 / --break）──────────────────────────────────
// 守卫现在是**一个小块**（标签判据 muvHasTag + 短文本放行 muvShortOk，见 lib/client.js
// `beautifyMuv` 开头的 ★★）。两种破坏法都必须让本门禁红。
const BREAK = (() => {
  const a = process.argv.find((x) => x.startsWith('--break='))
  return a ? a.slice('--break='.length) : ''
})()
const GUARD_LINE_RE = /^\s*if \(!muvHasTag && !muvShortOk\) return text\s*$/
const OLD_GUARD_SRC = '/<StatusPlaceHolder|<\\/?now_plot\\b|<\\/?content\\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\\b|<Variable(?:Edit|Insert|Think)\\b|<Abstract\\b/i'
function guardLineIndex(src) {
  const lines = src.split('\n')
  const i = lines.findIndex((l) => GUARD_LINE_RE.test(l))
  if (i < 0) throw new Error('找不到守卫行（形如 `if (!muvHasTag && !muvShortOk) return text`）')
  return i
}
function tagdefLineIndex(src) {
  const lines = src.split('\n')
  const i = lines.findIndex((l) => /^\s*var muvHasTag = \//.test(l))
  if (i < 0) throw new Error('找不到 muvHasTag 定义行')
  return i
}
function revertGuard(src) {
  // 把守卫**块**（muvHasTag 定义行 → 守卫行，含短文本分支）整体换回旧枚举单行。
  const lines = src.split('\n')
  const i = guardLineIndex(src)
  const j = tagdefLineIndex(src)
  if (j > i) throw new Error('守卫块行序异常')
  lines.splice(j, i - j + 1, '      if (!' + OLD_GUARD_SRC + '.test(text)) return text')
  return lines.join('\n')
}
function neverGuard(src) {
  const lines = src.split('\n')
  lines[guardLineIndex(src)] = '      if (!/^\\s*$/.test(text)) return text'
  return lines.join('\n')
}
let CLIENT = CLIENT_RAW
if (BREAK === 'guard-enum') CLIENT = revertGuard(CLIENT_RAW)
else if (BREAK === 'guard-never') CLIENT = neverGuard(CLIENT_RAW)
else if (BREAK) { console.log('未知的 --break=' + BREAK); process.exit(2) }
const INLINED = CLIENT.replace(/<\/script/gi, '<\\/script')

// ── 假卡 ────────────────────────────────────────────────────────────────────
// 每张卡一条脚本，把正文里的一段裸文本替换成**该卡独有的**标记，
// 这样"产物里出现哪个标记"就唯一地说明"用了哪张卡的脚本"。
// 注意：`replaceString` 里不能出现 `</script`，也不能出现单独的 `/`
// （本项目测试逐字提取函数体做 new Function，代码位置的斜杠会崩提取器；
//  这里是 JSON 字符串，安全，但仍保持无斜杠以免节外生枝）。
const MARK_A = 'DECOKEY_SESSIONA_CARD'
const MARK_B = 'DECOKEY_SESSIONB_CARD'
const MARK_PANEL = 'DECOKEY_PANEL_CARD'
const MARK_CACHED = 'DECOKEY_CACHED_CARD'
// **过期绑定**会给出的那张卡（真实 muv-table 走 sessionId 时读 session-bindings.json）。
const MARK_STALE = 'DECOKEY_STALE_BINDING_CARD'
// 卡脚本**就地替换占位符本身** —— 那是 `applyDecoratedHtml` 真正会做手术的那一段，
// 所以"卡跑没跑"在 DOM 上留得住证据。
const MARK_RE = 'StatusPlaceHolderImpl'

function card(name, marker) {
  return {
    ok: true, found: true, name,
    presetDir: name, presetSource: 'stub',
    regexScripts: [{
      scriptName: 'stub-beautify',
      // 就地替换占位符本身：这样装饰后的 DOM 里一定留下"用了哪张卡"的证据，
      // 而且**不依赖**消息里有没有状态栏占位符 —— 本轮要测的是"取没取卡、
      // 用的是哪张"，不是"状态栏渲染得对不对"（那是 test-client-render 的地盘）。
      findRegex: MARK_RE,
      replaceString: marker,
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      placement: [1, 2],
    }],
    data: { extensions: { regex_scripts: [] } },
  }
}
const CARDS = {
  sessionA: card('card-session-A', MARK_A),
  sessionB: card('card-session-B', MARK_B),
  panel: card('card-PANEL-global', MARK_PANEL),
  cached: card('card-CACHED-once', MARK_CACHED),
  stale: card('card-STALE-binding', MARK_STALE),
}

const SID_A = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const SID_B = 'session-bbbbbbbb-1111-2222-3333-444444444444'
const SID_C = 'session-cccccccc-1111-2222-3333-444444444444'

// 消息体：必须同时满足三件事，否则装饰链会在取卡之前 / 写回阶段把证据吃掉：
//   ① `messageTargets()` 要求含块级子节点（p/pre/ul/…）
//   ② `beautifyMuv` 的守卫正则要求文本里有一个被识别的标记
//      ⇒ 放一个 `<StatusPlaceHolderImpl/>`
//   ③ `applyDecoratedHtml` 走的是「只替换状态栏那一段」的手术：
//      卡脚本对**别处文本**的改写**不会**进 DOM（`BEAUTIFY_ME` 会原样留着）。
//      所以这里的卡脚本**就地替换标记本身**，产物才是可判定的。
//      （本门禁关心"问了哪张卡、有没有缓存"，
//       不是"状态栏渲染得对不对"——那是 test-client-render / verify-visual 的地盘。）
const BODY = '<p>BEAUTIFY_ME &lt;StatusPlaceHolderImpl/&gt;</p><p>正文第二行。</p>'
// 同一张卡在**另一轮**的典型形态：只有卡要求的信封标签 `<content>` / `<now_plot>`，
// 没有状态栏占位符。守卫正则必须也认得这种消息，否则这一轮会被判成"没东西可装饰"
// 而**在取卡之前**就原样返回 —— 用户看到的就是"这一轮没有美化、是纯文本"。
const CONTENT_BODY = '<p>&lt;content&gt;BEAUTIFY_ME&lt;/content&gt;</p><p>&lt;now_plot&gt;x&lt;/now_plot&gt;</p>'
// ★ 另一轮的典型形态（本轮新增）：正文里**只有媒体标签**，一个旧枚举认的标记都没有。
//   真实来源：同一批会话里 `<audio>欢快</audio>` 那种一轮（旧枚举整轮跳过 ⇒ 用户看到裸标签）。
//   这里用 `<video>…</video>` 是因为它同时还是**有收益**的那一档（真卡 [6] 会把它换成播放器）。
//   注意 `&lt;`/`&gt;`：消息正文是被 DSH 转义成**文本**的，innerText 读出来才是 `<video>`。
//   这一档也是 `--break=guard-enum` 唯一能红的落点：T5 用的是 `<content>`，旧枚举认得它。
const MEDIA_BODY = '<p>BEAUTIFY_ME_MEDIA &lt;video&gt;SFW/超天酱/初次登场1&lt;/video&gt;</p><p>正文第二行。</p>'

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>deco-isolation</title>
<style>html,body{margin:0;background:#16181d;color:#d7dae0;font:13px/1.6 monospace}
.wrap{max-width:900px;margin:0 auto;padding:12px}.host{border:1px dashed #3a4048;margin:6px 0;padding:8px}</style>
</head><body>
<div class="wrap">
  <div class="host"><div id="msg_a1" class="_markdown_abc123_1">${BODY}</div></div>
  <div class="host"><div id="msg_b1" class="_markdown_abc123_2">${BODY}</div></div>
  <div class="host"><div id="msg_a2" class="_markdown_abc123_3">${BODY}</div></div>
  <div class="host"><div id="msg_a3" class="_markdown_abc123_4">${BODY}</div></div>
  <div class="host"><div id="msg_a4" class="_markdown_abc123_5">${BODY}</div></div>
  <div class="host"><div id="msg_a5" class="_markdown_abc123_6">${BODY}</div></div>
  <div class="host"><div id="msg_d1" class="_markdown_abc123_7">${BODY}</div></div>
  <div class="host"><div id="msg_e1" class="_markdown_abc123_8">${BODY}</div></div>
  <div class="host"><div id="msg_f1" class="_markdown_abc123_9">${BODY}</div></div>
  <div class="host"><div id="msg_g1" class="_markdown_abc123_10">${CONTENT_BODY}</div></div>
  <div class="host"><div id="msg_h1" class="_markdown_abc123_11">${MEDIA_BODY}</div></div>
  <div id="tavern-session-preset-label" data-preset-id="PANEL-PRESET"></div>
</div>

<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${INLINED}</script>
<script>
(function () {
  var NOTES = [];
  var REQUESTS = [];   // 每次取卡请求的原始 URL

  // ── 会话服务桩：这就是真实 DSH 上 ctx.sessions 暴露的东西 ──────────────────
  var CURRENT = ${JSON.stringify(SID_A)};
  // ★ 这个桩必须**跟着变**：currentSessionId() 是"惰性重解析"的（这是修复的一半），
  //   它会去 window.__DSH_TAVERN_CTX__.get('sessions') 拿 session 服务。
  //   让这个快照函数返回一个非法 current 就能模拟"这一刻认不出会话"。
  var SESSIONS_SVC = {
    list: { getSnapshot: function () { return { current: CURRENT } } }
  };
  window.__DSH_TAVERN_SESSIONS__ = SESSIONS_SVC;
  window.__DSH_TAVERN_CTX__ = { get: function (n) { return n === 'sessions' ? SESSIONS_SVC : null } };
  window.__setCurrentSession = function (sid) { CURRENT = sid };
  // 模拟"服务已 provide，但它说当前没有激活会话"（DSH 重启后 UI 尚未恢复等）。
  window.__setSessionUnrecognizable = function (on) {
    SESSIONS_SVC.list.getSnapshot = on
      ? function () { return { current: null } }
      : function () { return { current: CURRENT } };
  };

  // ── fetch 桩：只服务这两个端点，顺带把"问了哪张卡"记下来 ──────────────────
  var CARD_BY_KEY = ${JSON.stringify({
    sessionA: 'sessionA', sessionB: 'sessionB', panel: 'panel', cached: 'cached',
  })};
  // 权威解析桩：跟真服务端一样，给出「该会话自己的声明」，默认值就是 'default'。
  var AUTH_BY_SESSION = {};
  AUTH_BY_SESSION[${JSON.stringify(SID_A)}] = 'preset-sess-a';
  AUTH_BY_SESSION[${JSON.stringify(SID_B)}] = 'preset-sess-b';
  AUTH_BY_SESSION[${JSON.stringify(SID_C)}] = 'preset-cached';
  // 测试中途可以把某会话的权威值改成 'default'（= 用户把会话切成了非酒馆预设）
  window.__setAuth = function (sid, v) { AUTH_BY_SESSION[sid] = v };

  window.__fetchLog = REQUESTS;
  var AUTH_REQS = [];
  window.__authFetchLog = AUTH_REQS;
  // 会话 C 的**权威**值是 preset-cached，但那次 fetch **失败**（模拟真实的：要么超时，
  // 要么服务端说本会话不是酒馆会话）。用来测「拿不到权威值时不得退化成别人的卡」。
  var AUTH_FAIL_SESSIONS = {};
  window.__setAuthFail = function (sid, on) { AUTH_FAIL_SESSIONS[sid] = !!on };
  window.fetch = function (url, opts) {
    var u = String(url);
    if (u.indexOf('/api/tavern/current-session') === 0) {
      AUTH_REQS.push(u);
      var m = u.match(/sessionId=([^&]+)/);
      var qsid = m ? decodeURIComponent(m[1]) : '';
      if (AUTH_FAIL_SESSIONS[qsid]) {
        // 明确说"权威解析给不出东西"：ok=false，没有 presetId
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: false, sessionId: qsid }) } });
      }
      var pid = AUTH_BY_SESSION[qsid] === undefined ? 'default' : AUTH_BY_SESSION[qsid];
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, sessionId: qsid, presetId: pid }) } });
    }
    if (u.indexOf('/api/muv-table/tavern-card') === 0) {
      REQUESTS.push(u);
      var body;
      // 真实 muv-table 按会话解析时读的是 **session-bindings.json** ——
      // 一个**快照**，可能是**过期**的。所以走 sessionId 这条路时，
      // 真实服务端会给出**别的卡**（这里就用 stale 卡来还原那个事实）。
      // 只有该会话**自己的** presetId（preferPreset=1）才拿到正确的那张。
      if (u.indexOf('preferPreset=1') >= 0 && u.indexOf('presetId=preset-sess-a') >= 0) body = ${JSON.stringify(CARDS.sessionA)};
      else if (u.indexOf('preferPreset=1') >= 0 && u.indexOf('presetId=preset-sess-b') >= 0) body = ${JSON.stringify(CARDS.sessionB)};
      else if (u.indexOf('preferPreset=1') >= 0 && u.indexOf('presetId=preset-cached') >= 0) body = ${JSON.stringify(CARDS.cached)};
      else if (u.indexOf('sessionId=') >= 0) body = ${JSON.stringify(CARDS.stale)};
      else if (u.indexOf('presetId=') >= 0) body = ${JSON.stringify(CARDS.panel)};
      else body = ${JSON.stringify(CARDS.panel)};
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body) } });
    }
    if (u.indexOf('/api/muv-engine/apply-regex-card') === 0) {
      var req;
      try { req = JSON.parse(opts.body) } catch (e) { req = {} }
      var scripts = (req.cardJson && req.cardJson.regexScripts) || [];
      NOTES.push('apply-regex-card called: cardName=' + (req.cardJson && req.cardJson.name) + ' scripts=' + scripts.length + ' text=' + JSON.stringify(String(req.text || '').slice(0, 90)))
      var text = String(req.text == null ? '' : req.text);
      var applied = 0;
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (!s || s.disabled) continue;
        var re;
        try { re = new RegExp(s.findRegex, 'g') } catch (e) { continue }
        var before = text;
        text = text.replace(re, s.replaceString);
        if (text !== before) applied++;
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, text: text, applied: applied, statusBarHtml: null }) } });
    }
    return Promise.reject(new Error('stub: unexpected url ' + u));
  };

  // ── 启动真实模块 ──────────────────────────────────────────────────────────
  try {
    var exports = window.__mod.factory(function () { return {} });
    NOTES.push('factory=ok');
    if (exports && typeof exports.apply === 'function') { exports.apply(); NOTES.push('apply=ok') }
    else NOTES.push('apply=MISSING');
  } catch (e) { NOTES.push('boot=THROW:' + e.message) }

  function mark(el) { return el.getAttribute('data-muv-decorated') }
  function decorate(id) {
    var el = document.getElementById(id);
    try { window.MuvEngine.decorateMessage(el); NOTES.push('decorate(' + id + ')=called') }
    catch (e) { NOTES.push('decorate(' + id + ')=THROW:' + e.message) }
  }

  // 等模块内部的 MutationObserver / rAF 平静下来再手术，避免互相踩。
  setTimeout(function () {
    var ids = ['msg_a1', 'msg_b1', 'msg_a2', 'msg_a3', 'msg_a4', 'msg_a5', 'msg_d1'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      el.removeAttribute('data-muv-decorated');
      el.innerHTML = ${JSON.stringify(BODY)};
    }
    NOTES.push('requests_before_manual=' + REQUESTS.length);

    function prep(id, body) {
      var e = document.getElementById(id);
      e.removeAttribute('data-muv-decorated');
      e.innerHTML = body === undefined ? ${JSON.stringify(BODY)} : body;
      return REQUESTS.length;
    }
    var P = {};   // 各阶段开始前的取卡次数

    // 阶段一：会话 A 的产物 vs 会话 B 的产物（T2）
    window.__setCurrentSession(${JSON.stringify(SID_A)});
    P.a1 = prep('msg_a1'); decorate('msg_a1');

    setTimeout(function () {
      window.__setCurrentSession(${JSON.stringify(SID_B)});
      P.b1 = prep('msg_b1'); decorate('msg_b1');

      setTimeout(function () {
        // 阶段二（T4a）：当前会话的**权威**值 = 'default'（用户把会话切成了非酒馆预设）
        //   ⇒ 严格口径：本就不该出卡，也**不得**退化成 muv-table 按会话解析出的卡
        window.__setCurrentSession(${JSON.stringify(SID_C)});
        window.__setAuth(${JSON.stringify(SID_C)}, 'default');
        P.a2 = prep('msg_a2'); decorate('msg_a2');

        setTimeout(function () {
          // 阶段三（T4b）：权威解析**失败**（ok=false / 没有 presetId）
          //   与上一阶段不同：这是"无法判定"。这里同样不得退化成别人的卡。
          window.__setAuthFail(${JSON.stringify(SID_C)}, true);
          P.a3 = prep('msg_a3'); decorate('msg_a3');

          setTimeout(function () {
            // 阶段四（T3）：会话 C 恢复成正常酒馆会话，连装饰 3 条 —— 每条都必须重新取卡
            window.__setAuthFail(${JSON.stringify(SID_C)}, false);
            window.__setAuth(${JSON.stringify(SID_C)}, 'preset-cached');
            P.a4 = prep('msg_a4'); decorate('msg_a4');
            setTimeout(function () {
              P.a5 = prep('msg_a5'); decorate('msg_a5');
              setTimeout(function () {
                P.d1 = prep('msg_d1'); decorate('msg_d1');

                setTimeout(function () {
                  // 阶段五（T1b）：**认不出会话** —— 会话服务拿不到、URL 不带 id、
                  //   data-dsh-current-session 属性也没有。这就是真实存在的一档
                  //   （插件 apply 那一刻 sessions 还是 undefined；页面 URL 是裸的 /）。
                  //   此时**唯一**能拿到的东西就是 panel 的 dataset.presetId / localStorage
                  //   —— 那个"会粘住"的全局值。正解是**宁可不出卡**，不得用它。
                  window.__setCurrentSession(null);
                  window.__setSessionUnrecognizable(true);
                  document.documentElement.removeAttribute('data-dsh-current-session');
                  P.e1 = prep('msg_e1'); decorate('msg_e1');

                  setTimeout(function () {
                    // 阶段六（T2b）：会话 F —— 走 sessionId 的真实服务端会读
                    //   **过期的** session-bindings（= 别人的卡）。
                    //   正解：带该会话**自己的** presetId，拿到对的卡。
                    window.__setCurrentSession(${JSON.stringify(SID_A)});
                    window.__setSessionUnrecognizable(false);
                    window.__setAuth(${JSON.stringify(SID_A)}, 'preset-sess-a');
                    P.f1 = prep('msg_f1'); decorate('msg_f1');
                    window.__PHASES = P;
                    // 装饰链是"即发即忘"的（decorateMessage 不返回 promise），
                    // 所以这里等到它把属性打上为止再收工；超时就再补一次，
                    // 并把每次补做的请求下标一并交出去供断言切片。
                    window.__f1Attempts = [];
                    var tries = 0;
                    var t = setInterval(function () {
                      var el = document.getElementById('msg_f1');
                      var done = el && el.getAttribute('data-muv-decorated') === '1' &&
                        el.innerHTML.indexOf('BODY_MARK') < 0;
                      window.__f1Attempts.push({ reqIndex: REQUESTS.length, html: el ? el.innerHTML : '' });
                      if (done || ++tries > 6) {
                        clearInterval(t);
                        // 阶段七（症状 B 的守卫那一档）：**同一会话的下一轮**，
                        //   消息里只有卡要求的 content / now_plot 信封，
                        //   没有状态栏占位符。这一轮也必须被美化。
                        window.__PHASES = Object.assign({}, P, { f1Attempts: window.__f1Attempts });
                        window.__setAuth(${JSON.stringify(SID_A)}, 'preset-sess-a');
                        var gStart = prep('msg_g1', ${JSON.stringify(CONTENT_BODY)});
                        decorate('msg_g1');
                        // 装饰是异步的：g1 自己的取卡请求会落在 gStart **之后**，
                        // 所以切片从 gStart 起，就正好覆盖"这一轮"的全部请求。
                        P.g1 = gStart;
                        window.__PHASES = Object.assign({}, P, { f1Attempts: window.__f1Attempts });
                        // 阶段八（T6，本轮新增）：**同一会话再下一轮** ——
                        //   正文里只有媒体标签（innerText 读出来就是
                        //   &lt;video&gt;SFW/超天酱/初次登场1&lt;/video&gt; 这一段文本），
                        //   一个旧枚举认的标记都没有。旧枚举会在**取卡之前**整轮返回。
                        //   注意：这里必须紧接着同步调 decorate（_decorateOne 在第一个 await
                        //   之前就把 innerText 读走了），否则下一页的 sanitize pass 会先把
                        //   裸 video 标签换成占位块、把这一档测成另一件事。
                        setTimeout(function () {
                          P.h1 = prep('msg_h1', ${JSON.stringify(MEDIA_BODY)});
                          decorate('msg_h1');
                          window.__PHASES = Object.assign({}, P, { f1Attempts: window.__f1Attempts });
                          setTimeout(emit, 900);
                        }, 900);
                        return;
                      }
                      decorate('msg_f1');
                    }, 350);
                  }, 500);
                }, 400);
              }, 400);
            }, 400);
          }, 400);
        }, 400);
      }, 700);
    }, 700);
  }, 900);

  function emit() {
    function html(id) { var e = document.getElementById(id); return e ? e.innerHTML : '' }    var out = {
      notes: NOTES,
      requests: REQUESTS,
      authRequests: AUTH_REQS,
      phases: window.__PHASES || {},
      a1: html('msg_a1'),
      b1: html('msg_b1'),
      a2: html('msg_a2'),
      a3: html('msg_a3'),
      a4: html('msg_a4'),
      a5: html('msg_a5'),
      d1: html('msg_d1'),
      e1: html('msg_e1'),
      f1: html('msg_f1'),
      g1: html('msg_g1'),
      h1: html('msg_h1'),
      marks: {
        A: ${JSON.stringify(MARK_A)}, B: ${JSON.stringify(MARK_B)},
        PANEL: ${JSON.stringify(MARK_PANEL)}, CACHED: ${JSON.stringify(MARK_CACHED)},
        STALE: ${JSON.stringify(MARK_STALE)},
      },
    }
    var pre = document.createElement('pre');
    pre.id = 'RESULT';
    pre.textContent = 'JSONRESULT' + JSON.stringify(out);
    document.body.appendChild(pre);
  }
  window.addEventListener('error', function (e) { NOTES.push('onerror:' + e.message) });
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'deco-isolation.html')
writeFileSync(file, page, 'utf8')
console.log('=== fixture 已生成 ===')
console.log('  源码: ' + SRC_PATH)
console.log('  ' + file)

const EDGE = process.env.MUV_EDGE
if (!EDGE) {
  console.log('\n设 MUV_EDGE 指向 msedge.exe 可自动跑。')
  process.exit(0)
}

const domFile = path.join(OUT, 'deco-isolation.dom.html')
const profDir = path.join(OUT, 'prof-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=20000',
  // ★ 必须 ?clean=1 之外的**无参** URL：上一次运行留下的 `?presetId=PANEL-PRESET&…`
  //   会被 `currentSessionId()` 的 URL 兜底读成会话 id（正则是 `session[/=:-]([a-f0-9-]{20,})`，
  //   它匹配到了 `presetId` 后面那段十六进制）。带参跑会让"认不出会话"那一档变成
  //   "认得出来但认错了"，直接换掉被测对象 —— 本轮就是这么被坑过一次。
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'deco-isolation.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const raw = dom.match(/JSONRESULT(\{[\s\S]*?\})<\/pre>/)
if (!raw) {
  console.log('\n拿不到 RESULT —— fixture 没跑起来。')
  const n = dom.match(/NOTES[^<\n]*/)
  if (n) console.log('  ' + n[0])
  console.log('  dom: ' + domFile)
  process.exit(1)
}
const R = JSON.parse(raw[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"))

console.log('\n=== NOTES ===')
R.notes.forEach(n => console.log('  ' + n))
console.log('\n=== 权威解析请求（' + (R.authRequests || []).length + ' 次）===')
;(R.authRequests || []).forEach(u => console.log('  ' + u))
console.log('\n=== 取卡请求（' + R.requests.length + ' 次）===')
R.requests.forEach(u => console.log('  ' + u))

let bad = 0
const check = (name, cond, detail) => {
  console.log('  ' + (cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '  -> ' + detail))
  if (!cond) bad++
}
// 产物是 HTML：标签/属性会被浏览器小写化（`<DECOKEY_X>` → `<decokey_x>`），
// 所以"用了哪张卡"的判据必须大小写不敏感。
const has = (hay, needle) => String(hay).toLowerCase().indexOf(String(needle).toLowerCase()) >= 0

// ── T1 会话隔离 ────────────────────────────────────────────────────────────
console.log('\n=== T1 会话隔离：装饰必须按**当前会话**取卡，不得回退到全局（面板 / localStorage）预设 ===')
{
  const P = R.phases || {}
  const endOfT1 = P.e1 === undefined ? R.requests.length : P.e1
  const identifiable = R.requests.slice(0, endOfT1)
  const askedPanel = identifiable.filter(u => u.indexOf('PANEL-PRESET') >= 0).length
  const usedPanelMark = [R.a1, R.b1, R.a2, R.a3, R.a4, R.a5, R.d1].some(h => has(h, R.marks.PANEL))
  check('凡能认出会话的请求，都没有用面板预设（全局粘住值）去取卡', askedPanel === 0,
    askedPanel + ' 次请求带了面板 presetId')
  check('没有任何消息被渲染成面板预设卡的内容', !usedPanelMark, '产物里出现了 ' + R.marks.PANEL)
  const askedBySession = identifiable.filter(u => /sessionId=session-/.test(u)).length
  const askedByAuthority = identifiable.filter(u => /preferPreset=1/.test(u)).length
  const bare = identifiable.filter(u => u.indexOf('?') < 0).length
  check('凡能认出会话的取卡都带定位（会话 id 或该会话自己的 presetId+preferPreset=1）',
    askedBySession + askedByAuthority + bare === identifiable.length,
    askedBySession + ' 次带 sessionId + ' + askedByAuthority + ' 次带 preferPreset=1 + ' + bare + ' 次无参，共 ' +
    identifiable.length + ' 次')
  check('先问权威解析端点，再决定取不取卡（取卡次数 <= 权威查询次数）',
    (R.authRequests || []).length >= R.requests.length,
    (R.authRequests || []).length + ' 次权威查询 / ' + R.requests.length + ' 次取卡')
}

// ── T2 状态隔离：A、B 两会话各用各的卡 ─────────────────────────────────────
console.log('\n=== T2 会话隔离：A 会话的产物用 A 卡，B 会话的产物用 B 卡 ===')
{
  const P = R.phases || {}
  // 判据一（真路径、可判定）：这条消息装饰时**问了哪张卡**。
  // 这就是被测对象本身 —— 装饰产物完全由这一次取卡决定。
  const a1reqs = R.requests.slice(P.a1 === undefined ? 0 : P.a1, P.b1 === undefined ? R.requests.length : P.b1)
  const b1reqs = R.requests.slice(P.b1 === undefined ? 0 : P.b1, P.a2 === undefined ? R.requests.length : P.a2)
  check('A 会话消息装饰时用的是 A 会话自己的卡',
    a1reqs.length >= 1 && a1reqs.every(u => u.indexOf('presetId=preset-sess-a') >= 0),
    '实际：' + JSON.stringify(a1reqs))
  check('A 会话消息没有问过 B 会话的卡', !a1reqs.some(u => u.indexOf('preset-sess-b') >= 0),
    '实际：' + JSON.stringify(a1reqs))
  check('B 会话消息装饰时用的是 B 会话自己的卡',
    b1reqs.length >= 1 && b1reqs.every(u => u.indexOf('presetId=preset-sess-b') >= 0),
    '实际：' + JSON.stringify(b1reqs))
  check('B 会话消息没有问过 A 会话的卡', !b1reqs.some(u => u.indexOf('preset-sess-a') >= 0),
    '实际：' + JSON.stringify(b1reqs))
  // 判据二（用户可见的后果）：产物各自带各自的标记。
  const a1 = String(R.a1), b1 = String(R.b1)
  check('A 会话消息的产物带 A 标记', has(a1, R.marks.A),
    'a1 含 A=' + has(a1, R.marks.A) + ' B=' + has(a1, R.marks.B) + ' PANEL=' + has(a1, R.marks.PANEL) + ' CACHED=' + has(a1, R.marks.CACHED))
  check('A 会话消息未被 B 卡污染', !has(a1, R.marks.B), 'a1 里出现了 B 标记')
  check('B 会话消息的产物带 B 标记', has(b1, R.marks.B),
    'b1 含 A=' + has(b1, R.marks.A) + ' B=' + has(b1, R.marks.B) + ' PANEL=' + has(b1, R.marks.PANEL) + ' CACHED=' + has(b1, R.marks.CACHED))
  check('B 会话消息未被 A 卡污染', !has(b1, R.marks.A), 'b1 里出现了 A 标记')
  check('两个会话的产物不相同（真正各自用卡，而不是共用一张）', a1 !== b1)
}

// ── T3 不缓存：同会话连续 5 条，每条都重新取卡 ─────────────────────────────
console.log('\n=== T3 不缓存一次：同一会话连续多条消息，每条都必须重新取卡并美化 ===')
{
  const P = R.phases || {}
  const after = R.requests.length - (P.a4 === undefined ? 0 : P.a4)
  check('第 3/4/5 条消息之后仍然在取卡（不是"前两轮就断了"）', after >= 3,
    'T3 期间只发出 ' + after + ' 次取卡请求（需要 >=3）')
  const marked = ['a4', 'a5', 'd1'].filter(k => has(R[k], R.marks.CACHED))
  check('同会话连续第 3/4/5 条都拿到了美化产物（applied>0）', marked.length === 3,
    '只有 ' + marked.join(',') + ' 条（共 3 条）出现美化标记：' +
    JSON.stringify({ a4: String(R.a4).slice(0, 120), a5: String(R.a5).slice(0, 120), d1: String(R.d1).slice(0, 120) }))
  const naked = ['a4', 'a5', 'd1'].filter(k => has(R[k], 'StatusPlaceHolderImpl'))
  check('同会话连续第 3/4/5 条没有留下裸标记（说明脚本确实跑了）', naked.length === 0,
    '裸标记仍在：' + naked.join(','))
}

// ── T4 权威值 = default（非酒馆会话）：不出卡；权威解析失败：也不出别人的卡 ────
console.log('\n=== T4 权威解析说「本会话不是酒馆会话」（default） / 权威解析失败 ===')
console.log('    期望：两种情况都**不出卡**，绝不用别人的卡代餐（这正是 A 的机制）')
{
  const P = R.phases || {}
  const reqsBetween = (from, to) => R.requests.slice(P[from] || 0, P[to] === undefined ? R.requests.length : P[to])
  const a2reqs = reqsBetween('a2', 'a3')
  const a3reqs = reqsBetween('a3', 'a4')
  check('权威=default 时：一次卡都没取（不出卡）', a2reqs.length === 0,
    '却发起了 ' + a2reqs.length + ' 次取卡：' + JSON.stringify(a2reqs))
  check('权威=default 时：正文保持原文', !has(R.a2, R.marks.CACHED) && !has(R.a2, R.marks.PANEL) && !has(R.a2, R.marks.A),
    '被别的卡替换了：' + String(R.a2).slice(0, 160))
  check('权威解析失败时：一次卡都没取（不拿别人的卡兜底）', a3reqs.length === 0,
    '却发起了 ' + a3reqs.length + ' 次取卡：' + JSON.stringify(a3reqs))
  check('权威解析失败时：正文保持原文', !has(R.a3, R.marks.CACHED) && !has(R.a3, R.marks.PANEL) && !has(R.a3, R.marks.A),
    '被别的卡替换了：' + String(R.a3).slice(0, 160))
  // 这一条只覆盖**能认出会话**的四档（T1/T2/T3）：凡认得出会话，就绝不许用面板那个
  // 会粘住的值。"认不出会话"那一档见 T1b（它有意保留面板兜底，是既有门禁钉住的行为）。
  const identifiable = R.requests.slice(0, P.e1 === undefined ? R.requests.length : P.e1)
  const askedPanel = identifiable.filter(u => u.indexOf('PANEL-PRESET') >= 0).length
  check('凡能认出会话的每一档，都没有按面板预设（全局粘住值）取过卡', askedPanel === 0,
    askedPanel + ' 次；实际：' + JSON.stringify(identifiable))
}

// ── T1b 认不出会话：这一档**只剩**面板预设兜底（有意的取舍，见下）────────────
console.log('\n=== T1b 认不出会话 ===')
console.log('    这一档（连会话都认不出）保留"退回面板当前预设"的兜底 —— 那是')
console.log('    verify-tavern-card-locator.mjs 的 B1/B2/D2 钉死的行为，不能单方面撤掉。')
console.log('    它**就是**"工作区里所有会话显示同一张卡"的成因之一，所以这里如实量出来。')
{
  const P = R.phases || {}
  const reqs = R.requests.slice(P.e1 === undefined ? 0 : P.e1, P.f1 === undefined ? R.requests.length : P.f1)
  // 关键断言（能红）：这一档**没有**偷偷用别的会话自己的卡 —— 那才是错的。
  check('认不出会话时没有去问任何**具体会话的**卡',
    !reqs.some(u => /presetId=preset-sess-/.test(u)),
    '实际：' + JSON.stringify(reqs))
  console.log('    实际发出的请求: ' + JSON.stringify(reqs))
  console.log('    ▶ 已知取舍：这一档会退回面板预设（= 会粘住的全局值）。')
  console.log('      凡**能认出会话**的路径都已改走权威解析（见 T1/T2/T2b/T4），')
  console.log('      所以用户在真实酒馆会话里看到的已经是该会话自己的卡。')
}

// ── T2b 会话自己的声明 vs 服务端 bindings 快照（B 的机制）────────────────────
console.log('\n=== T2b 会话的**权威声明** vs 服务端 session-bindings.json 快照 ===')
console.log('    期望：用该会话自己的 presetId 取卡；不得走 sessionId（那读的是会过期的 bindings）。')
{
  const P = R.phases || {}
  const attempts = P.f1Attempts || []
  // 装饰是即发即忘的。产物切片从「第一次出现变化的那次补做」开始 ——
  // 那一次就是真正产出这个 DOM 的那条链（它自己的取卡请求在它之前发出）。
  const base = attempts.length ? attempts[0].html : ''
  const firstChange = attempts.findIndex(a => a.html !== base)
  const from = firstChange > 0 ? attempts[firstChange].reqIndex : (P.f1 === undefined ? 0 : P.f1)
  const reqs = R.requests.slice(from)
  check('会话 F 的取卡带的是它自己的 presetId + preferPreset=1',
    reqs.length >= 1 && reqs.every(u => u.indexOf('presetId=preset-sess-a') >= 0 && u.indexOf('preferPreset=1') >= 0),
    '实际（从下标 ' + from + ' 起）：' + JSON.stringify(reqs))
  const last = attempts.length ? attempts[attempts.length - 1] : null
  const html = last ? last.html : String(R.f1)
  check('会话 F 的产物用的是它自己的卡（不是 bindings 里的过期卡）',
    (has(html, R.marks.A) || reqs.length === 0) && !has(html, R.marks.STALE),
    '含 A=' + has(html, R.marks.A) + ' STALE=' + has(html, R.marks.STALE) + ' PANEL=' + has(html, R.marks.PANEL) +
    '  产物=' + String(html).slice(0, 160))
  console.log('    （补做次数 ' + attempts.length + '，首次变化于第 ' + firstChange + ' 次，请求下标 ' + from + '）')
}

// ── T5 症状 B 的守卫那一档：只有 `<content>` / `<now_plot>` 的一轮也要美化 ────
console.log('\n=== T5 同一会话的下一轮只有卡要求的信封标签（<content> / <now_plot>）===')
console.log('    期望：这一轮**也要**被美化。守卫正则若不认这些标签，就会在取卡之前')
console.log('          原样返回 ⇒ 用户看到"前面几轮有美化、后面变成纯文本"。')
{
  const P = R.phases || {}
  // g1 的切片必须**止于 h1**（下一轮的开始），否则 h1 的取卡会被算进这一档。
  const reqs = R.requests.slice(P.g1 === undefined ? 0 : P.g1, P.h1 === undefined ? R.requests.length : P.h1)
  check('只有 <content>/<now_plot> 的一轮仍然去取了卡', reqs.length >= 1,
    '一次卡都没取 —— 说明这一轮在取卡之前就被守卫正则判成"没东西可装饰"返回了：' + JSON.stringify(reqs))
  check('这一轮取的是**该会话自己的**卡（不是别人的、也不是服务端默认）',
    reqs.length >= 1 && reqs.every(u => u.indexOf('presetId=preset-sess-a') >= 0 && u.indexOf('preferPreset=1') >= 0),
    '实际：' + JSON.stringify(reqs))
  check('这一轮的 DOM 被装饰层接手过（打了 data-muv-decorated）',
    has(R.g1, '<content>') && !has(R.g1, 'BEAUTIFY_ME <div class="muv-statusbar-hit"'),
    '产物：' + String(R.g1).slice(0, 220))
}

// ── T6 守卫那一档的**媒体形态**：只有 `<video>…</video>` 的一轮也要美化 ──────────
console.log('\n=== T6 同一会话再下一轮只有媒体标签（<video>…</video>）===')
console.log('    期望：这一轮**也要**被美化。旧枚举一个标记都不认 ⇒ 整轮在取卡之前')
console.log('          返回 ⇒ 卡里的 [6]「视频」脚本永远没有机会跑（用户看到裸标签）。')
console.log('    ★ 这一档是本轮新增：它是 --break=guard-enum 的**唯一**落点（T5 用的是')
console.log('      <content>，旧枚举认得，破坏回枚举时那一档照样绿）。')
{
  const P = R.phases || {}
  check('阶段八确实跑到了（前一轮之后的这一档有切片起点）', P.h1 !== undefined,
    'P=' + JSON.stringify(Object.keys(P)))
  const reqs = R.requests.slice(P.h1 === undefined ? 0 : P.h1)
  check('只有 <video> 的一轮仍然去取了卡（旧枚举会在取卡之前整轮跳过）', reqs.length >= 1,
    '一次卡都没取 —— 这一轮被判成"没东西可装饰"了：' + JSON.stringify(reqs))
  check('这一轮取的是**该会话自己的**卡',
    reqs.length >= 1 && reqs.every(u => u.indexOf('presetId=preset-sess-a') >= 0 && u.indexOf('preferPreset=1') >= 0),
    '实际：' + JSON.stringify(reqs))
  check('这一轮的 DOM 被装饰层接手过（媒体标签的正文仍在，没有被吞掉）',
    has(R.h1, '<video>'), '产物：' + String(R.h1).slice(0, 220))
}

console.log((bad ? ('\n=== 装饰会话隔离门禁: ' + bad + ' 项未通过 ===') : '\n=== 装饰会话隔离门禁: 全部通过 ===') +
  (BREAK ? '  [--break=' + BREAK + ']' : ''))
process.exit(bad ? 1 : 0)
