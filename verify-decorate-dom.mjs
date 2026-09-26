// 装饰链路门禁：在**真浏览器**里跑**真实模块 + 真实 DOM + 真实 `_decorateOne`**。
//
// 为什么必须这样测：`_decorateOne` 是「读 DOM → 变换 → 写回 DOM」的破坏性操作，
// 它的行为**只由真实的 DOM 语义决定**（`innerText` 返回渲染后文本、`closest()`、
// `innerHTML` 解析规则），字符串断言和 Node 里的假 DOM 都测不到。
//
// 两条被测消息，对应两类标记（逐类迁移，一类一条）：
//   A_choices —— 纯 `<choices>` 消息（第一类）
//   B_header  —— 带 `『📅…|⏰…|📍…』` 表头 + `<StatusPlaceHolderImpl/>`（第二类）
//
// 对每条消息的判据都是两件事**同时**成立：
//   ① markdown 存活：`<strong>` / `<h2>` / `<pre><code>` / `<li>` 仍在
//   ② 该渲染的东西真的渲染了：A 要 `.muv-choice-btn`，B 要 `.muv-statusbar-wrap`
// 只满足② = 用户看到的正文全变纯文字（实测：真实消息里 `**` 有 352/604/792 处）；
// 只满足① = 选项/状态栏没了（用户最初的抱怨）。**两个方向都必须钉住。**
//
// 做法：`lib/client.js` 是 `window.__ModuleLoader__.load({ factory })` 形态，而
// `exports.apply` 是**零参**函数（不需要 Cordis 上下文），所以整个模块可以在页面里
// 原样加载并启动。之后调真实的 `window.MuvEngine.decorateMessage(el)`。
// `fetch` 打桩成失败：这样 `beautifyMuv` 的卡片分支被跳过，走的是**本地路径**
// —— 也正是我们要测的那条。
//
// 运行：$env:MUV_EDGE="...\msedge.exe"; node verify-decorate-dom.mjs
// 对照：$env:MUV_CLIENT_SRC="<另一份 client.js>" 可指向任意版本做修复前后对比。

import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
// ★ 第 35 轮：文本级状态栏的客户端侧只需要「判据 + 落点手术」，**折叠块的内容**仍然
// 交给服务端既有的 loose 级联渲染。夹具里没有服务端，所以这里用**真模块**在 node 侧
// 预先算好那份响应，再由页面里的 fetch 桩返回 —— 桩给的是真服务端会给的答案，
// 不是手写的 HTML（手写就等于把被测对象抄一遍）。
import { renderStatusFromText } from './lib/status-cascade.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 可以指向任意一份源码：用来做「修复前 vs 修复后」的对照。
// **必须做对照** —— 只看"现在通过了"无法区分「修复生效」和「这条判据本来就测不到东西」。
const SRC_PATH = process.env.MUV_CLIENT_SRC || path.join(__dirname, 'lib', 'client.js')
const CLIENT = readFileSync(SRC_PATH, 'utf8')
const OUT = path.join(os.tmpdir(), 'muv-visual-main')
mkdirSync(OUT, { recursive: true })

const MARKDOWN = `
<h2>午后 · 遗迹入口</h2>
<p>这是 <strong>粗体</strong>、<em>斜体</em>、<code>内联代码</code>。</p>
<pre><code>const a = 1</code></pre>
<ul><li>列表项一</li><li>列表项二</li></ul>`

// 一段"整页 HTML 源码"（转义后当 <pre> 的文本内容）。`NAKEDDOC` 是探针字符串：
// 它还出现在 innerText 里 = 源码块没被藏住（用户看到裸文本）。
const NAKED_DOC = '&lt;!DOCTYPE html&gt;\n&lt;html&gt;\n&lt;head&gt;&lt;title&gt;卡&lt;/title&gt;&lt;/head&gt;\n&lt;body&gt;\n' +
  Array.from({ length: 6 }, () => '&lt;div class="w-full"&gt;NAKEDDOC 状态栏字段&lt;/div&gt;').join('\n') +
  '\n&lt;/body&gt;\n&lt;/html&gt;'

const MESSAGES = {
  A_choices: `${MARKDOWN}
<p>安柏压低声音：「这里的风不对劲。」</p>
<p>&lt;choices&gt;
A. 悄悄摸进遗迹
B. 先在入口扎营
&lt;/choices&gt;</p>`,
  B_header: `<p>『📅2026年8月26日|⏰10:00|📍遗迹入口』</p>${MARKDOWN}
<p>安柏压低声音：「这里的风不对劲。」</p>
<p>&lt;StatusPlaceHolderImpl/&gt;</p>`,
  // 目标里明确要求「插画与视频」，但此前只在字符串层验过。
  // 这条给出**浏览器实测**的基线：DSH 原生路径目前对媒体标签一个渲染器都没有
  // （`renderMediaTags` 唯一调用点挂在酒馆路径的 `_tavernRenderTags` 上）。
  C_media: `${MARKDOWN}
<p>&lt;插图&gt;海边日落&lt;/插图&gt;</p>
<p>&lt;video src="https://example.invalid/a.mp4"&gt;&lt;/video&gt;</p>
<p>&lt;audio src="https://example.invalid/b.mp3"&gt;&lt;/audio&gt;</p>`,
  // 媒体渲染把**模型/卡提供的标签文本**变成真实元素。如果直接 innerHTML，
  // 就等于把 `onerror=` 请进 DSH 自己的页面（同源执行）。
  // 这条消息专门带 `on*`，用来**独立验证**「属性白名单 + 丢弃 on*」这条安全声明
  // —— 安全声明不能采信，只能实测（我在 allow-same-origin 上吃过这个亏）。
  D_xss: `${MARKDOWN}
<p>&lt;video src="https://example.invalid/x.mp4" onerror="window.__pwned=1"&gt;&lt;/video&gt;</p>
<p>&lt;audio controls onerror="window.__pwned=2"&gt;&lt;/audio&gt;</p>
<p>&lt;插图&gt;&lt;img src=x onerror="window.__pwned=3"&gt;&lt;/插图&gt;</p>`,
  // 第三类：原生路径缺渲染器 → **标签外泄成裸文本**（不是丢 markdown，是用户直接看到标签）。
  // E = 变量块/摘要块（泄的是 JSON，最刺眼）；F = speech/char 这类样式标签。
  E_variable: `${MARKDOWN}
<p>&lt;UpdateVariable&gt;{"时间":{"日期":"05-20"},"地点":"遗迹入口"}&lt;/UpdateVariable&gt;</p>
<p>&lt;Abstract&gt;安柏在遗迹入口发现了异常的魔力波动。&lt;/Abstract&gt;</p>`,
  F_tags: `${MARKDOWN}
<p>&lt;speech&gt;「这里的风不对劲。」她压低了声音。&lt;/speech&gt;</p>
<p>&lt;dialogue&gt;「你跟紧我。」&lt;/dialogue&gt;</p>
<p>&lt;char&gt;安柏&lt;/char&gt;握紧了弓。</p>
<p>&lt;location&gt;遗迹入口&lt;/location&gt;</p>`,
  // 卡牌专属的「游戏标签」：酒馆路径按字段渲染信息卡（带独立配色），
  // 原生路径此前**没有**渲染器 ⇒ 整块标签外泄成裸文本。
  // 用 <br> 分行：真实 DSH 把模型的行分隔渲染成块/换行，直接写裸换行会被 HTML 折成空格。
  G_gamecard: `${MARKDOWN}
<p>&lt;赏令接取&gt;<br>委托名称：清除遗迹外围的史莱姆<br>委托人：西风骑士团<br>奖励：2000 摩拉<br>期限：明日黄昏前<br>&lt;/赏令接取&gt;</p>`,
  // H：与 iframe 内容**重复**的整页源码块（ST 给残留 <pre><code> 加 hidden! 的那一条）。
  // 卡的正则没产出整页文档时，这一大段源码会露成裸文本 —— 用户看到的就是"没渲染"。
  // 同时带一个普通 ``` 代码块：它**必须活着**（判据的第二面，防"无差别隐藏"）。
  H_source: `${MARKDOWN}
<pre><code>${NAKED_DOC}</code></pre>
<pre><code>const keep = 1  // 普通代码块：一个字符都不许动</code></pre>`,
}

// ── 第 35 轮：文本级状态栏（无占位符的卡）─────────────────────────────────────
//
// 夹具逐字取自用户实测（川上富江，`regex_scripts: 0`）：
//   ① 消息**开头**的 7 个连续裸方括号键值对（其中 `[时间:5月14日|星期三]` 的值里
//      还带一个 `|`）；
//   ② 正文里夹着的 `<details><summary>[角色状态]</summary>```…```</details>`。
//
// ⚠ 夹具里这两段必须是**字面文本**（`&lt;details&gt;`），不是真元素 —— 这是本仓库
// 反复取证过的事实：DSH 把模型写的 HTML 标签当文本铺在消息里（HANDOFF §30 的
// "标签外泄成裸文本"就是这一类）。`_decorateOne` 读的 `innerText` 因此能看到
// `<details>` 这些字面量，判据也建立在这一点上。
const TS_PREFIX = '[时间:5月14日|星期三][季节:初夏][天气:夜间大雨][时间段:晚上20:41]'
  + '[地点:暮川市·旧片区·富江的独宅·厨房][环境布置:镜子前的木凳空了…]'
  + '[怪谈女性角色:川上富江(高中水手制服…)]'
const TS_DETAILS = '<details><summary>[角色状态]</summary> '
  + '```- 😃 川上富江的状态 - 🏃 当前行动：退开半步```</details>'
/** 客户端会发给 /render-status 的那段**块体**（summary 之后、`</details>` 之前）。 */
const TS_DETAILS_BODY = TS_DETAILS.slice(
  TS_DETAILS.indexOf('</summary>') + '</summary>'.length,
  TS_DETAILS.lastIndexOf('</details>'))
const TS_RENDERED = renderStatusFromText(TS_DETAILS_BODY)
const TS_RESP = TS_RENDERED
  ? { ok: true, stage: TS_RENDERED.source, html: TS_RENDERED.html }
  : { ok: true, stage: null, html: null }
console.log('=== 文本级状态栏夹具（第 35 轮）===')
console.log('  折叠块体 = ' + JSON.stringify(TS_DETAILS_BODY))
console.log('  服务端（真模块）渲染 = stage=' + (TS_RENDERED && TS_RENDERED.source) +
  '  html=' + (TS_RENDERED ? TS_RENDERED.html.length : 0) + ' 字')
if (!TS_RENDERED || !TS_RENDERED.html) {
  console.log('  ⚠ 真模块对这个块体都没渲染出东西 —— 夹具不成立（门禁会红）')
}

/** 把一段字面文本转义成 HTML 文本节点（模拟 DSH 把标签当文本铺出来）。 */
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Object.assign(MESSAGES, {
  // I：用户实测形态（前缀 + 折叠块 + 正常 markdown 正文）
  I_textstatus: `<p>${TS_PREFIX}</p>
${MARKDOWN}
<p>她把他从自己腿间推开的时候，指尖还沾着水。</p>
<p>${escText(TS_DETAILS)}</p>`,
  // J：**对照臂** —— 正常行文里的单个 `[时间:…]`（**1 对而已**）+ `[1]` 引用 + `[注:…]`。
  //    判据只要放宽一点（比如「≥1 对就认」），这条就会长出状态栏、方括号被吞 ⇒ 本臂变红。
  //    ★ 第一版把这里写成 `[注:…]` 打头 —— 那样只测到"键不在词表"，**测不到"≥2 对"**
  //      那条判据（把 ≥2 改成 ≥1 时它照样绿）。所以这里必须用**已知键**、且只有 1 对。
  J_notstatus: `<p>[时间:昨天下午] 他推门进来，屋里只剩[1]一盏灯。[注:这条是译者注]</p>
${MARKDOWN}
<p>他叹了口气，没有再说什么。</p>`,
})

// ── 2026-09-24：MVU JSONPatch 块（真实夹具，session-7347d5f7 实锤）──────────────
// K = 转义文本形态（多行真实块）；L = **元素形态**（DSH 把标签渲染成真元素，
// 字面标签文本不在任何文本节点里 —— 泄漏实锤的那一种，HEAD 上 analysisLeak/patchLeak 双 1）。
const REAL_UV_BLOCK = `<UpdateVariable>
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
Object.assign(MESSAGES, {
  K_jsonpatch: `${MARKDOWN}
<p>门被推开之后，时间来到了 11:42。</p>
<p>${escText(REAL_UV_BLOCK)}</p>`,
  L_jsonpatch_elem: `${MARKDOWN}
<p>门被推开之后，时间来到了 11:42。</p>
<p>${REAL_UV_BLOCK}</p>`,
})

// 每条消息「该渲染出来的东西」——**两个方向都要钉**：markdown 不能丢，功能也不能丢。
const NEEDS = {
  A_choices: ['choiceBtns'],
  B_header: ['statusBars'],
  C_media: ['videos', 'illustrations'],
  D_xss: ['videos', 'illustrations'],
  E_variable: ['variableBlocks', 'abstracts'],
  F_tags: ['speechBlocks', 'dialogueBlocks', 'charNames', 'locations'],
  G_gamecard: ['gameCards'],
  // srcHidden = 被藏起来的整页源码块；preVisible = 仍然可见的 <pre>（普通代码块 + markdown 的 pre）
  H_source: ['srcHidden', 'preVisible'],
  // ★ 第 35 轮：文本级状态栏 + 折叠 UI
  I_textstatus: ['tsBars', 'sbDetails'],
  J_notstatus: [],
}
// ★ 2026-09-24：K/L（MVU JSONPatch 真实块）—— 两条形态都要求折叠卡成型
NEEDS.K_jsonpatch = ['variableBlocks']
NEEDS.L_jsonpatch_elem = ['variableBlocks']

/**
 * 生成一页夹具（客户端源码 + 消息集 + state 标签）。
 *
 * 第 35 轮起要跑**两页**：
 *   · `after` 页（开关默认开）—— 正常判据；
 *   · `off`  页（把 `MUV_TEXT_STATUS` 逐字改成 `false`）—— 要求「关掉开关 = 无占位符的卡
 *     恢复裸文本」的**对照臂**。它必须变红（状态栏不再出现、裸方括号仍在），否则
 *     「开关可关」这句话就是空话。
 */
function buildPage(clientSrc, stateLabel, keys) {
  // 内联进 <script> 时必须打断 `</script`，否则会把宿主页面当场截断
  const inlined = String(clientSrc).replace(/<\/script/gi, '<\\/script')
  // 预置响应里的 `</` 同样要打断（它会被塞进 <script> 里的 JSON 字面量）
  const tsRespJson = JSON.stringify(TS_RESP).replace(/<\//g, '<\\/')
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>decorate-dom</title>
<style>
  html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:14px/1.7 "Microsoft YaHei",system-ui,sans-serif}
  body{padding:14px}.wrap{max-width:760px;margin:0 auto}
  .cap{font:12px monospace;color:#8b93a1;margin:14px 0 6px}
  .host{border:1px dashed #3a4048;border-radius:6px;padding:10px}
</style></head>
<body>
<div class="wrap">
  <div class="cap">装饰链路门禁：真实模块 + 真实 _decorateOne + 真实 DOM（state=${stateLabel}）</div>
${keys.map((k) => `  <div class="cap">${k}</div>\n  <div class="host"><div id="msg_${k}" class="_markdown_abc123_7">${MESSAGES[k]}</div></div>`).join('\n')}
</div>

<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${inlined}</script>
<script>
(function () {
  var KEYS = ${JSON.stringify(keys)};
  // ★ 第 35 轮：折叠块的内容由**服务端真模块**渲染，夹具里没有服务端 ⇒ 用 node 侧
  //   预先算好的那份响应（生成夹具时打印过它的 stage/长度，不是手写 HTML）。
  var TS_RESP = ${tsRespJson};
  var notes = [];
  function msg(k) { return document.getElementById('msg_' + k) }
  function count(k, sel) { var m = msg(k); return m ? m.querySelectorAll(sel).length : -1 }
  // 仍然**看得见**的 <pre> 数量（display:none 的不算）—— 判据第二面：不许无差别隐藏
  function visiblePre(k) {
    var m = msg(k); if (!m) return -1;
    var ps = m.querySelectorAll('pre'), n = 0;
    for (var i = 0; i < ps.length; i++) { if (getComputedStyle(ps[i]).display !== 'none') n++ }
    return n;
  }
  function emit(state) {
    // 文本级状态栏的落点手术失败原因（有就留痕，方便一眼看出"为什么 markdown 变平了"）
    for (var j = 0; j < KEYS.length; j++) {
      var mj = msg(KEYS[j]);
      var wj = mj && mj.getAttribute && mj.getAttribute('data-muv-ts-fallback');
      if (wj) notes.push('tsFallback(' + KEYS[j] + ')=' + wj);
    }
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], m = msg(k), txt = m ? m.innerText : '';
      var v = 'VERDICT msg=' + k + ' state=' + state
        + ' strong=' + count(k, 'strong') + ' h2=' + count(k, 'h2')
        + ' pre=' + count(k, 'pre') + ' li=' + count(k, 'li')
        + ' choiceBtns=' + count(k, '.muv-choice-btn')
        + ' statusBars=' + count(k, '.muv-statusbar-wrap')
        + ' iframes=' + count(k, 'iframe')
        + ' videos=' + count(k, 'video') + ' audios=' + count(k, 'audio')
        + ' imgs=' + count(k, 'img') + ' illustrations=' + count(k, '.muv-illustration')
        + ' variableBlocks=' + count(k, '.muv-varedit') + ' abstracts=' + count(k, '.muv-abstract')
        + ' jsonpatch=' + count(k, '.muv-jsonpatch')
        + ' speechBlocks=' + count(k, '.muv-speech') + ' charNames=' + count(k, '.muv-char-name')
        + ' dialogueBlocks=' + count(k, '.muv-dialogue') + ' locations=' + count(k, '.muv-location')
        + ' gameCards=' + count(k, '.muv-game-card') + ' cardFields=' + count(k, '.muv-card-field')
        + ' srcHidden=' + count(k, '[data-muv-src-hidden]')
        + ' preVisible=' + visiblePre(k)
        // ★ 第 35 轮：文本级状态栏（.muv-statusbar-wrap 上带 data-muv-ts 的那些）、
        //   折叠 UI、以及"用户到底还看不看得到裸方括号/裸围栏"。
        //   围栏那三个字符用 String.fromCharCode 拼 —— 这段脚本在模板字符串里，
        //   直接写反引号会把夹具页面截断（本文件上面有同样的坑记录）。
        + ' tsBars=' + count(k, '[data-muv-ts]')
        + ' sbDetails=' + count(k, 'details.muv-sb-details')
        + ' rawBrackets=' + (txt.indexOf('[时间:') >= 0 ? 1 : 0)
        + ' keepBracket=' + (txt.indexOf('[注:') >= 0 ? 1 : 0)
        + ' nakedFence=' + (txt.indexOf(String.fromCharCode(96, 96, 96)) >= 0 ? 1 : 0)
        + ' tsReqHasName=' + (String(window.__tsReq || '').indexOf('川上富江') >= 0 ? 1 : 0)
        + ' tsFallback=' + ((m && m.getAttribute && m.getAttribute('data-muv-ts-fallback')) ? 1 : 0)
        + ' srcLeak=' + (txt.indexOf('NAKEDDOC') >= 0 ? 1 : 0)
        // 第三类真正的用户可见症状：**标签外泄成裸文本**（不是丢 markdown）。
        // 用字符串查找而不是正则字面量：这段代码在模板字符串里，正则的转义斜杠会被
        // 模板字符串先吃掉一层，于是正则在中途的斜杠处提前结束、整段脚本语法错误
        // —— 实测踩过，生成页里连 VERDICT 都没有。
        // （同理：这段注释里也不能出现反引号，它会终止外层的模板字符串。）
        + ' rawTags=' + (['<UpdateVariable>', '<Abstract>', '<speech>', '</speech>', '<char>', '</char>']
            .some(function (s) { return txt.indexOf(s) >= 0 }) ? 1 : 0)
        // ★ 2026-09-24：MVU JSONPatch 的用户可见症状 —— Analysis 英文行 / JSON 数组裸露
        + ' jpLeak=' + ((txt.indexOf('time passed') >= 0 || txt.indexOf('"op"') >= 0) ? 1 : 0)
        + ' pwned=' + (typeof window.__pwned === 'undefined' ? 0 : window.__pwned)
        + ' literalStars=' + (/\\*\\*/.test(txt) ? 1 : 0);
      var pre = document.createElement('pre');
      pre.className = 'verdict';
      pre.textContent = v;
      pre.style.cssText = 'position:fixed;left:0;bottom:' + (i * 22) + 'px;z-index:2147483647;background:#000;color:#0f0;font:11px monospace;padding:2px 4px;margin:0;white-space:nowrap;max-width:100%;overflow:hidden';
      document.body.appendChild(pre);
    }
    var n = document.createElement('pre');
    n.id = 'notes';
    n.textContent = 'NOTES ' + notes.join('|');
    n.style.cssText = 'position:fixed;right:0;bottom:0;z-index:2147483647;background:#111;color:#8b93a1;font:10px monospace;padding:2px;margin:0';
    document.body.appendChild(n);
  }
  window.addEventListener('error', function (e) { notes.push('onerror:' + e.message); });

  try {
    // ★ 只放行文本级状态栏要用的那一个端点（并记下客户端**实际发来的块体**，
    //   好让门禁核对"判据真的把 summary 之后那段体交出去了"）；其余一律拒绝 ——
    //   A~H 那批用例走的仍是"没有服务端"的本地路径，行为与本轮之前一致。
    window.fetch = function (url, opts) {
      var u = String(url || '');
      if (u.indexOf('/api/muv-engine/render-status') >= 0) {
        var req = {};
        try { req = JSON.parse((opts && opts.body) || '{}') } catch (e) {}
        window.__tsReq = String((req && req.body) || '');
        return Promise.resolve({ json: function () { return Promise.resolve(TS_RESP) } });
      }
      return Promise.reject(new Error('stub: no server in fixture'));
    };
    var exports = window.__mod.factory(function () { return {} });
    notes.push('factory=ok');
    if (exports && typeof exports.apply === 'function') { exports.apply(); notes.push('apply=ok') }
    else notes.push('apply=MISSING');
  } catch (e) { notes.push('boot=THROW:' + e.message) }

  // 先记录**装饰前**的状态：这是"markdown 本来是好的"的证据
  setTimeout(function () {
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      notes.push('before(' + k + ':strong=' + count(k, 'strong') + ',h2=' + count(k, 'h2') + ',pre=' + count(k, 'pre') + ',li=' + count(k, 'li') + ')');
      try {
        if (window.MuvEngine && typeof window.MuvEngine.decorateMessage === 'function') {
          window.MuvEngine.decorateMessage(msg(k));
          notes.push('decorate(' + k + ')=called');
        } else { notes.push('decorate=MISSING(window.MuvEngine)') }
      } catch (e) { notes.push('decorate(' + k + ')=THROW:' + e.message) }
    }
    notes.push('tsReq=' + String(window.__tsReq || '').slice(0, 50));
  }, 80);

  setTimeout(function () { emit('${stateLabel}') }, 1400);
})();
<\/script>
</body></html>`
}

const MAIN_KEYS = Object.keys(MESSAGES)
const page = buildPage(CLIENT, 'after', MAIN_KEYS)
const file = path.join(OUT, 'decorate-dom.html')
writeFileSync(file, page, 'utf8')

// ── 关闸页（第 35 轮要求的对照臂）：`var MUV_TEXT_STATUS = true` → `false` ──────
//
// 只放两条文本级用例：其余用例与这个开关无关（跑第二遍没有信息量）。
// 替换**必须**真的发生 —— 没换到就等于两页一样，那样「关得掉」这条断言会以
// "状态栏还在"的形式变红（所以这个自检是双保险，不是唯一的保护）。
const OFF_CLIENT = CLIENT.replace(/(\n\s*var MUV_TEXT_STATUS\s*=\s*)true(\s*\n)/, '$1false$2')
const offChanged = OFF_CLIENT !== CLIENT
const OFF_KEYS = ['I_textstatus', 'J_notstatus']
const offFile = path.join(OUT, 'decorate-dom-off.html')
writeFileSync(offFile, buildPage(OFF_CLIENT, 'off', OFF_KEYS), 'utf8')

console.log('=== fixture 已生成 ===')
console.log('  源码: ' + SRC_PATH)
console.log('  ' + file + '（内联了真实 lib/client.js，' + CLIENT.length + ' 字符）')
console.log('  ' + offFile + '（MUV_TEXT_STATUS 已改写为 false：' + (offChanged ? '是' : '**否（替换没命中！）**') + '）')

const EDGE = process.env.MUV_EDGE
if (!EDGE) {
  console.log('\n设 MUV_EDGE 指向 msedge.exe 可自动跑：')
  console.log('  $env:MUV_EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"; node verify-decorate-dom.mjs')
  process.exit(0)
}

const domFile = path.join(OUT, 'decorate-dom.dom.html')
const profDir = path.join(OUT, 'prof-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=6000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'decorate-dom.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const verdicts = [...dom.matchAll(/VERDICT msg=[\w]+ state=after[^<\n]*/g)].map((m) => m[0].trim())

// ── 关闸页（对照臂）：同一份夹具、同一份源码，只把 MUV_TEXT_STATUS 改成 false ──
const offDomFile = path.join(OUT, 'decorate-dom-off.dom.html')
const offProfDir = path.join(OUT, 'prof-off-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=6000',
  '--user-data-dir=' + offProfDir, '--dump-dom', 'file:///' + offFile.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(offDomFile, 'w'), openSync(path.join(OUT, 'decorate-dom-off.err.txt'), 'w')] })
const offDom = readFileSync(offDomFile, 'utf8')
const offVerdicts = [...offDom.matchAll(/VERDICT msg=[\w]+ state=off[^<\n]*/g)].map((m) => m[0].trim())

console.log('\n=== 浏览器实测 ===')
if (!verdicts.length) {
  console.log('  没拿到 VERDICT —— 装饰链路没跑起来（fixture 有问题，不是产品结论）')
  const note = dom.match(/NOTES[^<\n]*/)
  if (note) console.log('  ' + note[0].replace(/&gt;/g, '>'))
  process.exit(1)
}

const clean = (s) => s.replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
let bad = 0
const check = (name, cond, detail) => {
  console.log('  ' + (cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '  -> ' + detail))
  if (!cond) bad++
}
const seen = new Set()
for (const raw of verdicts) {
  const v = clean(raw)
  const key = (/msg=([\w]+)/.exec(v) || [])[1]
  seen.add(key)
  const num = (k) => Number((new RegExp('\\b' + k + '=(\\d+)').exec(v) || [])[1] || 0)
  const markdownKept = num('strong') >= 1 && num('h2') >= 1 && num('pre') >= 1 && num('li') >= 1
  const needs = NEEDS[key] || ['choiceBtns']
  const featureOk = needs.every((n) => num(n) >= 1)
  // 第三类的用户可见症状是「标签外泄成裸文本」——它和 markdown 是两件事，必须单独钉
  const needsNoRawTags = key === 'E_variable' || key === 'F_tags' || key === 'K_jsonpatch' || key === 'L_jsonpatch_elem'
  const rawTagsOk = !needsNoRawTags || num('rawTags') === 0
  // ★ 2026-09-24：K/L（MVU JSONPatch 真实块）—— Analysis 英文行与 JSON 数组不许裸露
  const needsNoJpLeak = key === 'K_jsonpatch' || key === 'L_jsonpatch_elem'
  const jpLeakOk = !needsNoJpLeak || num('jpLeak') === 0
  // H：源码块藏住了 **且** 普通代码块还在（只钉一面会放过"无差别隐藏"）
  const needsNoSrcLeak = key === 'H_source'
  const srcLeakOk = !needsNoSrcLeak || num('srcLeak') === 0
  // ★ 第 35 轮：文本级状态栏的两条判据。I 是**正例**（状态栏 + 折叠 UI 都要出现，
  //   且裸方括号 / 裸围栏必须消失）；J 是**对照臂**（正常行文不许被认成状态栏 ——
  //   一个状态栏都不能有，方括号必须原样留着）。
  let tsOk = true, tsWhy = ''
  if (key === 'I_textstatus') {
    const parts = [
      [num('tsBars') >= 2, '文本级状态栏条数=' + num('tsBars') + '（前缀 + 折叠块各 1）'],
      [num('sbDetails') >= 1, '折叠 UI 数=' + num('sbDetails')],
      [num('rawBrackets') === 0, '正文里仍有裸方括号（用户最初的抱怨）'],
      [num('nakedFence') === 0, '正文里仍有裸 ``` 围栏'],
      [num('tsReqHasName') === 1, '交给服务端的折叠块体里没有角色名（判据抠错了段）'],
      [num('tsBars') >= 1 && num('statusBars') >= 1, '状态栏容器不是 .muv-statusbar-wrap'],
    ]
    const bad0 = parts.filter((x) => !x[0]).map((x) => x[1])
    if (bad0.length) { tsOk = false; tsWhy = bad0.join(' / ') }
  } else if (key === 'J_notstatus') {
    const bad0 = []
    if (num('tsBars') !== 0) bad0.push('正常行文被误认成状态栏（tsBars=' + num('tsBars') + '）')
    if (num('keepBracket') !== 1) bad0.push('正文里的 [注:…] 被吞掉了')
    if (num('rawBrackets') !== 1) bad0.push('正文里的单个 [时间:…] 被吞掉了')
    if (bad0.length) { tsOk = false; tsWhy = bad0.join(' / ') }
  }
  const ok = markdownKept && featureOk && rawTagsOk && srcLeakOk && jpLeakOk && tsOk
  if (!ok) bad++
  console.log(`\n  [${key}] ${ok ? 'PASS' : 'FAIL'}`)
  console.log('    ' + v)
  console.log('    markdown 存活=' + (markdownKept ? '是' : '**否**') +
    '   ' + needs.map((n) => n + '=' + num(n)).join(' ') +
    (needsNoRawTags ? '   裸标签残留=' + (rawTagsOk ? '无' : '**有**') : '') +
    (needsNoJpLeak ? '   Analysis/JSON裸露=' + (jpLeakOk ? '无' : '**有**') : '') +
    (needsNoSrcLeak ? '   裸源码残留=' + (srcLeakOk ? '无' : '**有**') : '') +
    (tsOk ? '' : '   ★ ' + tsWhy))
}
// 防空循环：每条消息都必须有结果
for (const k of Object.keys(MESSAGES)) {
  if (!seen.has(k)) { console.log(`\n  [${k}] FAIL 没有实测结果（fixture 没跑到这条）`); bad++ }
}

// ── ★ 第 35 轮的两条对照臂 ───────────────────────────────────────────────────
//
// ① 关闸臂（同一份夹具、同一份源码，只把 `MUV_TEXT_STATUS` 改成 false）：
//    I 必须退回**裸文本**（状态栏消失、裸方括号回来）。它变红 = 「关得掉」。② 判据臂：
//    J 在**开闸**页必须完全没有状态栏 —— 判据一旦放宽（比如"≥1 对就认"），
//    `[注:…]` 那一对就会命中，J 立刻变红。两条合起来才说明「这个开关管用」+
//    「这个判据不误伤」，缺一条都只是"跑过了"。
console.log('\n=== 文本级状态栏的两条对照臂（第 35 轮）===')
{
  const offSeen = new Map()
  for (const raw of offVerdicts) {
    const v = clean(raw)
    offSeen.set((/msg=([\w]+)/.exec(v) || [])[1], v)
  }
  const offI = offSeen.get('I_textstatus') || ''
  const offJ = offSeen.get('J_notstatus') || ''
  const n = (v, k) => Number((new RegExp('\\b' + k + '=(\\d+)').exec(v) || [])[1] || 0)
  check('关闸页真的跑起来了（拿到 I/J 两条结果）', !!offI && !!offJ,
    'offI=' + (offI ? '有' : '**无**') + ' offJ=' + (offJ ? '有' : '**无**'))
  check('关闸页的源码替换真的发生了（否则两页一样，本条会以"状态栏还在"变红）', offChanged)
  console.log('    off I: ' + offI)
  check('★ 关闸 ⇒ I 不再有文本级状态栏（tsBars=0）', n(offI, 'tsBars') === 0,
    'tsBars=' + n(offI, 'tsBars'))
  check('★ 关闸 ⇒ I 的裸方括号原样留着（rawBrackets=1）—— 「关掉 = 恢复裸文本」',
    n(offI, 'rawBrackets') === 1, 'rawBrackets=' + n(offI, 'rawBrackets'))
  check('★ 关闸 ⇒ I 不请求渲染折叠块（tsReqHasName=0）', n(offI, 'tsReqHasName') === 0)
  check('★ 关闸不影响 markdown（说明"没动"是原样交回，不是把消息改坏）',
    n(offI, 'strong') >= 1 && n(offI, 'h2') >= 1 && n(offI, 'pre') >= 1 && n(offI, 'li') >= 1)
  check('★ 关闸页的 J（对照臂）同样没有状态栏、方括号仍在',
    n(offJ, 'tsBars') === 0 && n(offJ, 'keepBracket') === 1)
}

// ── 注入安全：独立验证「属性白名单 + 丢弃 on*」这条声明 ─────────────────────
// `D_xss` 里的标签带 `onerror="window.__pwned=N"`。src 指向不存在的域名 ⇒ 必然触发 error ⇒
// 只要处理器活着，`window.__pwned` 就会被赋值。不看实现、只看这个可观测事实。
console.log('\n=== 注入安全（on* 是否被丢弃）===')
{
  const pwned = verdicts.map((v) => Number((/pwned=(\d+)/.exec(clean(v)) || [])[1] || 0))
  const worst = Math.max(0, ...pwned)
  check('没有任何注入的 on* 处理器被执行（window.__pwned 未被赋值）', worst === 0,
    'window.__pwned = ' + worst + ' —— 模型/卡提供的属性被执行了')
  // 同时确认「元素确实被建出来了」：否则上面那条会因为"什么都没渲染"而假绿
  const dVerdict = clean(verdicts.find((v) => v.indexOf('msg=D_xss') >= 0) || '')
  const vids = Number((/videos=(\d+)/.exec(dVerdict) || [])[1] || 0)
  check('D_xss 的媒体元素确实被建出来了（防止上一条假绿）', vids >= 1, 'videos=' + vids)
}
console.log(bad ? `\n=== 装饰链路门禁: ${bad} 项未通过 ===` : '\n=== 装饰链路门禁: 全部通过 ===')
process.exit(bad ? 1 : 0)
