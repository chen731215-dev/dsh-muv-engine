// dsh-muv-engine client: auto regex + iframe status bar rendering
window.__ModuleLoader__.load({
  id: 'dsh-muv-engine',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Cache for card data (loaded once)
    let cardCache = null

    // Observers owned by the factory scope so the returned teardown can dispose
    // them; declared here rather than inside the startup IIFE, where they were
    // unreachable from the cleanup path.
    let _vrObs = null
    let _muvMsgObs = null
    // Decoration entry points published for the tavern panel. Assigned inside
    // the startup IIFE (where the DOM helpers live) and called through here.
    let _decorateOneHook = null
    let _scheduleDecorateHook = null

    /**
     * Load card data from the MUV directory.
     * @param {string} cardName - Name of the card to load
     */
    async function loadCard(cardName) {
      if (cardCache && cardCache.name === cardName) return cardCache
      const d = await fetchTavernCard()
      if (d && d.name) {
        cardCache = d
        return d
      }
      return null
    }

    // ── 内置状态栏（角色卡没有「状态栏」正则脚本时的兜底）──────────────
    // 原先只有当卡片自带 scriptName 含「状态栏」且 findRegex 为 <StatusPlaceHolderImpl/>
    // 的正则脚本时才会渲染，否则占位符原样留着、什么都不显示。
    // 这里直接从本轮输出里的 _.set / _.add 变量赋值生成一张状态卡，
    // 所以「没写 MUV 模板的角色卡」也能有状态栏。
    var MUV_SB_CSS = '.muv-sb{margin:14px 0;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:14px;overflow:hidden;font-size:13px;line-height:1.55;background:var(--dsw-alias-bg-l1,transparent);box-shadow:0 1px 4px rgba(0,0,0,.07)}'
      + '.muv-sb-hd{display:flex;flex-wrap:wrap;gap:18px;padding:11px 16px;font-weight:600;letter-spacing:.2px;background:linear-gradient(100deg,rgba(139,92,246,.18),rgba(236,72,153,.09));border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}'
      + '.muv-sb-hd>span{display:inline-flex;align-items:center;gap:5px}'
      + '.muv-sb-bd{padding:11px 16px 4px;display:flex;flex-wrap:wrap;gap:7px}'
      + '.muv-sb-chip{padding:3px 11px;border-radius:999px;font-size:12px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.12));white-space:nowrap}'
      // Single column, and this is the selector that actually holds the field rows.
      //
      // 曾经这里（`.muv-sb-sub`）是 `repeat(auto-fit,minmax(215px,1fr))` 三列网格，
      // 结果是长字段在 245px 的列里折 3-5 行、右边一列从第 2 行才开始，同行不同列
      // 出现 行动‖内心、穿搭‖小穴 这种并排；角色名更是孤零零飘在中间（无卡片、无边框）。
      // 真浏览器实测：11 个字段行只落在 6 个行顶。
      //
      // 注意**别再改错选择器**：上一轮把单列写在 `.muv-sb-body` 上，而字段行其实在
      // `.muv-sb-sub` 里（`.muv-sb-body` 是 loose 级联的容器），于是 bug 没修掉、
      // 只是换了触发条件。现在两个容器都是单列。
      + '.muv-sb-sub{padding:6px 16px 13px;display:flex;flex-direction:column;gap:1px}'
      + '.muv-sb-row{display:flex;align-items:center;gap:9px;padding:2px 0}'
      + '.muv-sb-name{flex:none;min-width:4.5em;max-width:6.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}'
      + '.muv-sb-bar{flex:1;min-width:56px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.16));overflow:hidden}'
      + '.muv-sb-fill{display:block;height:100%;border-radius:999px;transition:width .3s ease}'
      + '.muv-sb-val{flex:none;width:2.4em;text-align:right;opacity:.62;font-size:11px;font-variant-numeric:tabular-nums}'
      + '.muv-sb-empty{padding:11px 16px;opacity:.6}'
      // Cascade-rendered layouts: one-line fields and the action options list.
      + '.muv-sb-line{padding:1px 0;opacity:.92;font-size:12.5px;line-height:1.5;word-break:break-word}'
      // 8px：值是 `📝 刚完成抽奖` 这种以 emoji 起头的形态，5px 会让「行动📝」视觉上
      // 贴成一个词。间距是给「标签 / 值」之间一个明确的呼吸。
      + '.muv-sb-line b{font-weight:600;opacity:.75;margin-right:8px}'
      // Structural layout. `.muv-sb-body` is the loose-cascade container; the field rows
      // of the yaml/free stages live in `.muv-sb-sub` (see its rule above). Both are
      // single-column on purpose — see the note there before changing either one.
      + '.muv-sb-body{padding:9px 16px 13px;display:flex;flex-direction:column;gap:2px}'
      + '.muv-sb-sect{margin:4px 0 2px;font-size:11px;letter-spacing:.6px;opacity:.5;font-weight:600}'
      + '.muv-sb-sect:first-child{margin-top:0}'
      + '.muv-sb-char{margin:5px 0 3px;padding:7px 11px;border-radius:10px;'
      + 'background:var(--dsw-alias-bg-l2,rgba(127,127,127,.055));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14))}'
      + '.muv-sb-char-name{font-weight:700;font-size:12.5px;margin-bottom:4px;opacity:.95}'
      + '.muv-sb-char .muv-sb-line{padding-left:2px}'
      + '.muv-sb-opts{padding:4px 16px 13px;display:flex;flex-direction:column;gap:6px}'
      + '.muv-sb-opts-title{font-size:11px;opacity:.55;letter-spacing:.5px;margin-bottom:2px}'
      + '.muv-sb-opt{text-align:left;font:inherit;font-size:12.5px;padding:8px 12px;border-radius:9px;cursor:pointer;'
      + 'background:var(--dsw-alias-bg-l2,rgba(127,127,127,.10));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));'
      + 'color:inherit;transition:background .15s,border-color .15s}'
      + '.muv-sb-opt:hover{border-color:var(--dsw-alias-brand-primary,#7ab8ff);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}'

    function ensureStatusCss() {
      try {
        if (document.getElementById('muv-status-css')) return
        var s = document.createElement('style')
        s.id = 'muv-status-css'
        s.textContent = MUV_SB_CSS
        document.head.appendChild(s)
      } catch (_) {}
    }

    /** 按顶层逗号切分参数（跳过引号内的逗号）。 */
    function splitArgs(src) {
      var out = [], buf = '', q = null
      for (var i = 0; i < src.length; i++) {
        var ch = src[i]
        if (q) { buf += ch; if (ch === q) q = null; continue }
        if (ch === '"' || ch === "'") { q = ch; buf += ch; continue }
        if (ch === ',') { out.push(buf); buf = ''; continue }
        buf += ch
      }
      if (buf.trim()) out.push(buf)
      return out.map(function (s) { return s.trim() })
    }

    function unquote(s) {
      s = String(s || '').trim().replace(/;$/, '')
      if (/^'.*'$/.test(s) || /^".*"$/.test(s)) return s.slice(1, -1)
      if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
      return s
    }

    /** 从文本里的 _.set/_.add 语句收集变量终值。 */
    function collectVars(text) {
      var vars = {}
      var re = /_\.(set|add)\(\s*(['"])([^'"]+)\2\s*,([\s\S]*?)\)\s*;?/g
      var m
      while ((m = re.exec(text)) !== null) {
        var op = m[1], key = m[3]
        var args = splitArgs(m[4])
        if (!args.length) continue
        if (op === 'add') {
          var cur = typeof vars[key] === 'number' ? vars[key] : 0
          vars[key] = cur + (Number(unquote(args[args.length - 1])) || 0)
        } else {
          vars[key] = unquote(args[args.length - 1])
        }
      }
      return vars
    }

    /**
     * 没有可展示数据时的空状态。
     *
     * 以前这里什么都不输出，于是 `<StatusPlaceHolderImpl/>` 会**原样留在消息里**
     * 被用户看见（卡没有状态栏正则、变量又读不到时就是这条路径）。顺带让 CSS 里
     * 那个 `.muv-sb-empty` 不再是"定义了却没人输出"的死类。
     * @returns {string}
     */
    function emptyStatusBar() {
      return '<div class="muv-sb muv-sb-empty">（暂无状态数据）</div>'
    }

    var STATUS_PH_TEST = /<StatusPlaceHolderImpl\s*\/>/i
    var STATUS_PH_ALL = /<StatusPlaceHolderImpl\s*\/>/gi

    /** 由变量生成状态栏 HTML；没有可展示的变量时返回 ''。 */
    function buildDefaultStatusBar(text) {
      var vars = collectVars(text)
      var keys = Object.keys(vars)
      if (!keys.length) return ''
      var get = function (k) { return vars[k] !== undefined ? String(vars[k]) : '' }
      var head = []
      if (get('系统.日期[0]')) head.push('📅 ' + get('系统.日期[0]'))
      if (get('系统.时间[0]')) head.push('🕒 ' + get('系统.时间[0]'))
      if (get('系统.地点[0]')) head.push('📍 ' + get('系统.地点[0]'))
      var userLoc = get('user.位置[0]'), userSt = get('user.当前状态[0]')
      var chips = []
      if (userLoc) chips.push('🧍 你 · ' + userLoc + (userSt ? ' · ' + userSt : ''))
      var affs = [], locs = []
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]
        var mm = /^(.*)\.好感度\[0\]$/.exec(k)
        if (mm) { affs.push([mm[1], Number(vars[k]) || 0]); continue }
        var m2 = /^(.*)\.位置\[0\]$/.exec(k)
        if (m2 && vars[k] && m2[1] !== 'user') locs.push(m2[1] + '·' + vars[k])
      }
      if (locs.length) chips.push('👥 ' + locs.join('  '))
      var bars = ''
      for (var j = 0; j < affs.length; j++) {
        var n = affs[j][0], v = Math.max(0, Math.min(100, affs[j][1]))
        // 好感度按区间换色：低=蓝紫，中=紫粉，高=粉红
        var grad = v >= 80 ? 'linear-gradient(90deg,#f472b6,#ef4444)'
          : v >= 50 ? 'linear-gradient(90deg,#a78bfa,#ec4899)'
            : 'linear-gradient(90deg,#60a5fa,#8b5cf6)'
        bars += '<div class="muv-sb-row"><span class="muv-sb-name">' + escHtml(n) + '</span>'
          + '<span class="muv-sb-bar"><span class="muv-sb-fill" style="width:' + v + '%;background:' + grad + '"></span></span>'
          + '<span class="muv-sb-val">' + v + '</span></div>'
      }
      if (!head.length && !chips.length && !bars) return ''
      var html = '<div class="muv-sb">'
      if (head.length) html += '<div class="muv-sb-hd">' + head.map(function (h) { return '<span>' + escHtml(h) + '</span>' }).join('') + '</div>'
      if (chips.length) html += '<div class="muv-sb-bd">' + chips.map(function (c) { return '<span class="muv-sb-chip">' + escHtml(c) + '</span>' }).join('') + '</div>'
      if (bars) html += '<div class="muv-sb-sub">' + bars + '</div>'
      return html + '</div>'
    }

    function escHtml(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    /**
     * Resolve the conversation the user is actually looking at.
     *
     * The card must follow the active preset, so the fetch needs a session id.
     * Tavern publishes the authoritative DSH session service on window; the URL
     * is the next-strongest signal (it changes when the user switches session),
     * and the cached attribute is the last resort.
     * @returns {string} session id, or '' when none can be determined
     */
    function currentSessionId() {
      try {
        var svc = window.__DSH_TAVERN_SESSIONS__
        if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
          var snap = svc.list.getSnapshot()
          var cur = snap && snap.current
          if (cur && /^(session-)?[a-f0-9-]{20,}$/i.test(String(cur))) {
            return 'session-' + String(cur).replace(/^session-/, '')
          }
        }
      } catch (_) {}
      try {
        var m = location.href.match(/session[/=:-]([a-f0-9-]{20,})/i)
        if (m && m[1]) return 'session-' + m[1].replace(/^session-/, '')
      } catch (_) {}
      try {
        var cached = document.documentElement.getAttribute('data-dsh-current-session')
        if (cached) return cached
      } catch (_) {}
      return ''
    }

    /**
     * Which preset is the tavern UI showing right now?
     *
     * Tavern publishes its selection on these DOM nodes (and mirrors it to
     * localStorage); that is the same source its own code treats as the single
     * source of truth. Reading it here matters because `currentSessionId()`
     * below can come back empty — the session service may not be exposed, the
     * URL may not carry an id, and the data attribute may be missing — and a
     * request with neither id nor session falls back to a default preset, so
     * the card's regex scripts never match and the message renders raw.
     * @returns {string}
     */
    function currentPresetId() {
      try {
        var ids = ['tavern-session-preset-label', 'tavern-session-preset-btn']
        for (var i = 0; i < ids.length; i++) {
          var el = document.getElementById(ids[i])
          var pid = el && el.dataset && el.dataset.presetId
          if (pid) return pid
        }
        var item = document.querySelector('#tavern-session-preset-panel [data-preset-id]')
        var aid = item && item.getAttribute && item.getAttribute('data-preset-id')
        if (aid) return aid
      } catch (_) {}
      try { return localStorage.getItem('dsh-tavern-active-preset') || '' } catch (_) { return '' }
    }

    /**
     * Load the active card, including its regex scripts.
     * @returns {Promise<object|null>}
     */
    async function fetchTavernCard() {
      try {
        var params = []
        var pid = currentPresetId()
        if (pid) params.push('presetId=' + encodeURIComponent(pid))
        var sid = currentSessionId()
        if (sid) params.push('sessionId=' + encodeURIComponent(sid))
        var qs = params.length ? '?' + params.join('&') : ''
        const r = await fetch('/api/muv-table/tavern-card' + qs)
        const d = await r.json()
        return d && d.ok ? d : null
      } catch (_) {
        return null
      }
    }

    /**
     * Apply regex scripts to text and render status bar iframes.
     * @param {string} text - LLM output text
     * @returns {Promise<string>} Transformed HTML
     */
    /**
     * Collapse line breaks the model inserted inside a status header.
     *
     * Presets specify the header as a single line —
     *   『📅 日期：… | ⏰ 时间：… | 📍 位置：…』
     * but models routinely break it across lines, leaving the corner brackets
     * stranded on their own lines. Downstream parsers treat each line as a
     * separate field, so the header never assembles. Rejoining the interior
     * (only inside the brackets, and only when the bracket pair actually
     * encloses a header) keeps the layout the preset asked for without
     * touching the rest of the message.
     * @param {string} text
     * @returns {string}
     */
    function normalizeStatusHeader(text) {
      if (!text || text.indexOf('『') === -1) return text
      return text.replace(/『([\s\S]*?)』/g, function (whole, inner) {
        // Only a header-like interior: it must carry at least one field marker
        // or a separator. Otherwise leave the author's text alone.
        if (!/[📅⏰📍🌤🌡|｜]/.test(inner)) return whole
        var joined = inner
          .replace(/[ \t]*\r?\n[ \t]*/g, ' ')   // newline -> space
          .replace(/\s{2,}/g, ' ')              // squeeze runs of spaces
          .replace(/\s*\|\s*/g, ' | ')          // normalise the separators
          .trim()
        return '『' + joined + '』'
      })
    }

    /**
     * Escape text for safe insertion into HTML.
     * Module-level so both `muvCleanText` and the message decorator can use it.
     * @param {string} s
     * @returns {string}
     */
    function escHtmlBasic(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    }

    /**
     * Parse the inside of a `<choices>` block into bare option strings.
     *
     * Shared by the string path (`replaceChoices`, used by the tavern renderer and by
     * the native round-trip) and by the DOM path (`muvRenderChoices`), so the two can
     * never disagree about how many options there are or what they say.
     *
     * 换行是正常分隔符，但**不保证有**：装饰器喂进来的是 `innerText`，DSH 把整块
     * 渲染进同一个 `<p>` 时换行会塌成空格（`<choices> A. 搭话 B. 离开 </choices>`），
     * 那样只会出一个按钮。所以在「空格 + 选项标记」前也断行。
     * @param {string} content
     * @returns {string[]}
     */
    function parseChoiceOptions(content) {
      var split = String(content == null ? '' : content)
        .replace(/\r/g, '')
        // 在「行首选项标记」前断行，标记集与下面剥前缀的那套保持一致
        // （`A、` `a)` `1.` `一、`…）。分隔符是 `[:：.．、)）]`，后面可以没有空格：
        // `A、搭话` 在标点后没有空白，要求空白就整条拆不开。
        .replace(/\s+(?=[A-Ha-h1-9一二三四五六七八九]\s*[、.．:：)）])/g, '\n')
        .replace(/\s+(?=[•·])\s*/g, '\n')
      var lines = split.split('\n').map(function (s) { return s.replace(/^[•·\-\*\s]+/, '').trim() }).filter(Boolean)
      var opts = []
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li]
        // 去掉 A、/ A./ 1、/ 1. 等前缀，只留选项文本（支持 A-H 与 1-9，避免第 5 个选项露出编号）
        // 分隔符要和上面**断行**那套一致：那边认全角 `）`（`2）丁` 会被断成一行），
        // 这里以前只认半角 `)`，于是 `2）丁` 断出来却剥不掉前缀、选项里留着 `2）`。
        var clean = ln.replace(/^[A-Ha-h1-9一二三四五六七八九][、.．:：)）\s]\s*/i, '').trim()
        if (!clean) continue
        // 跳过非选项行（如"请选择"、"选项："）
        if (/^(请选择|选项|行动|选择|接下来)/.test(clean)) continue
        opts.push(clean)
      }
      return opts
    }

    /**
     * Turn `<choices>…</choices>` (and the singular `<choice>`) into option
     * buttons.
     *
     * Extracted from `muvCleanText` so the message decorator can apply it to a
     * message that contains *only* an options block. `beautifyMuv` routes such
     * a message straight back out — it has no `<Status_block>` for the cascade
     * to replace — so before this was shared, a prose-plus-options reply
     * rendered no buttons at all.
     *
     * ⚠️ 这是**字符串**路径：它只有在调用方把结果整串写回 DOM 时才生效。而整串写回
     * 会吃掉 markdown（`_decorateOne` 用的是 `innerText`）。原生路径现在改走 DOM 层的
     * `muvRenderChoices()`，本函数留给酒馆渲染器与 HTML 生成用。
     * @param {string} text
     * @returns {string}
     */
    function replaceChoices(text) {
      return String(text || '').replace(/<choices?>([\s\S]*?)<\/choices?>/gi, function (_, content) {
        var opts = parseChoiceOptions(content)
        if (!opts.length) return '<div class="muv-choices">' + escHtmlBasic(content) + '</div>'
        var html = '<div class="muv-choices">'
        for (var oi = 0; oi < opts.length; oi++) {
          html += '<button class="muv-choice-btn" data-opt="' + String.fromCharCode(65 + oi) + '"><span class="muv-choice-letter">' + String.fromCharCode(65 + oi) + '</span>' + escHtmlBasic(opts[oi]) + '</button>'
        }
        html += '</div>'
        return html
      })
    }

    /**
     * 找到围栏的收尾行：**至少和开围栏一样长**的一串反引号，且独占一行。
     *
     * markdown 的规则是「收尾围栏的反引号数 ≥ 开围栏」。这一点正是 ````html 这种
     * 四反引号写法的意义所在：它允许正文里出现 ``` 而不提前结束代码块。
     *
     * 旧实现直接取「看到的下一个 ```」，于是文档里只要出现三连反引号——JS 字符串、
     * `<code>` 示例、注释里的 markdown——这里就提前收尾：iframe 拿到半截文档
     * （字符串没闭合），剩下的半截 HTML 以裸文本留在消息里。
     *
     * @param {string} source
     * @param {number} from 文档正文的起点
     * @param {number} minLen 开围栏的反引号数
     * @returns {{start: number, end: number}|null} 收尾行的位置；没找到则 null
     */
    function findClosingFence(source, from, minLen) {
      // 行首（≤3 空格缩进）+ 反引号串 + 行尾只剩空白
      var re = /^[ \t]{0,3}(`{3,})[ \t]*(?:\r?\n|$)/gm
      re.lastIndex = from
      var m
      while ((m = re.exec(source))) {
        if (m[1].length >= minLen) return { start: m.index, end: re.lastIndex }
      }
      return null
    }

    /**
     * 把「围栏里的整页 HTML」改走 iframe 渲染。
     *
     * 社区卡的「主页 / 正文美化 / ERA 状态栏」这类正则，产出的是**一整个 HTML 文档**
     * 并用 markdown 围栏包起来：
     *
     *     ```\n<!DOCTYPE html>\n<html>…几十 KB…</html>\n```
     *
     * 在 SillyTavern 里这是「把这段当 HTML 渲染」的约定，但 DSH 的 markdown 渲染器
     * 会老实把它当**代码块**——用户看到的是几十 KB 原始 HTML 文本，界面完全出不来。
     *
     * 这里只挑**确实是 HTML 文档**的围栏（以 `<!DOCTYPE` 或 `<html` 开头）下手，
     * 普通代码块（```js / ```python …）原样不动——误伤代码块比不渲染更糟。
     * 不认识的、没闭合的围栏也一样原样放行。
     *
     * 围栏按 markdown 的真实语义配对（见 findClosingFence）：开围栏必须独占一行、
     * 信息串里不能有反引号，收围栏要够长且独占一行。
     *
     * 真机卡（_足控天堂2 的 3 条大 HTML 正则，replaceString 分别 56/46/205 KB）
     * 已用 repro-card-fence-shape.mjs 实测：三个围栏都在行首、都是 3 个反引号、
     * 正文内部 0 段反引号 —— 所以「开围栏必须在行首」不会回退现在能用的卡。
     * @param {string} text
     * @returns {string}
     */
    function renderFencedHtml(text) {
      if (!text || text.indexOf('```') === -1) return text
      var source = String(text)
      var out = ''
      var pos = 0
      var open = /^[ \t]{0,3}(`{3,})([^\n`]*)\r?\n/gm
      var m
      while ((m = open.exec(source))) {
        var close = findClosingFence(source, open.lastIndex, m[1].length)
        if (!close) break
        var body = source.slice(open.lastIndex, close.start)
        var head = body.replace(/^\s+/, '').slice(0, 40).toLowerCase()
        var isDoc = head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0
        // 是文档 → 只替换围栏本身；不是 → 整块（含围栏）原样抄过去
        out += source.slice(pos, isDoc ? m.index : close.end)
        if (isDoc) {
          // 卡 HTML 的 iframe 一律从这里出去：里面带高度测量引导脚本，
          // 否则 894px / 1635px 的卡会被写死的 600px 裁掉（见 cardHtmlIframe）。
          out += '<div class="muv-statusbar-wrap">' + cardHtmlIframe(body) + '</div>'
        }
        pos = close.end
        open.lastIndex = close.end
      }
      out += source.slice(pos)
      return out
    }

    /**
     * 读一个起始标签：从 `<` 开始，扫到真正的 `>` 为止。
     *
     * **引号里的 `>` 不是标签的结束**（HTML5 属性值的规则），而旧实现用的
     * `[^>]*` 会在那里截断：`<video data-x="a>b" src="m.mp4">` 只吃到
     * `data-x="a`，于是 src 看不见、媒体被降级成文字占位。
     * @param {string} source
     * @param {number} lt `<` 的下标
     * @returns {{name: string, attrs: string, selfClosing: boolean, end: number}|null}
     */
    function readStartTag(source, lt) {
      var s = String(source)
      var i = lt + 1
      var nameStart = i
      while (i < s.length && /[a-zA-Z0-9:-]/.test(s[i])) i++
      var name = s.slice(nameStart, i)
      if (!name) return null
      var attrsStart = i
      var quote = ''
      while (i < s.length) {
        var ch = s[i]
        if (quote) {
          if (ch === quote) quote = ''
          i++
          continue
        }
        if (ch === '"' || ch === "'") { quote = ch; i++; continue }
        if (ch === '>') {
          var selfClosing = i > attrsStart && s[i - 1] === '/'
          return {
            name: name,
            attrs: s.slice(attrsStart, selfClosing ? i - 1 : i),
            selfClosing: selfClosing,
            end: i + 1
          }
        }
        i++
      }
      return null
    }

    /**
     * 取属性值：`src="…"` / `src='…'` / `src=…` 三种写法都认。
     *
     * 属性名前面必须紧跟行首或空白，否则 `data-src` 会被当成 `src`。
     * @param {string} attrs
     * @param {string} name
     * @returns {string|null} 属性值；**属性不存在**时返回 null（区别于空串）
     */
    function attrValue(attrs, name) {
      var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i')
        .exec(String(attrs || ''))
      if (!m) return null
      if (m[1] !== undefined) return m[1]
      if (m[2] !== undefined) return m[2]
      return m[3] !== undefined ? m[3] : null
    }

    /**
     * 去掉某个属性（值形式或布尔形式），用于重建标签时避免重复。
     * @param {string} attrs
     * @param {string} name
     * @returns {string}
     */
    function dropAttr(attrs, name) {
      return String(attrs || '')
        .replace(new RegExp('\\s*' + name + '\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'>]+)', 'gi'), '')
        .replace(new RegExp('\\s+' + name + '\\b(?!\\s*=)', 'gi'), '')
    }

    /**
     * 所有 `<script>…</script>` 的区间。
     *
     * 凡是把一段字符串当 HTML 处理的代码（媒体标签转换、往卡文档里注入脚本），
     * 都得先圈出这些区域：里面的 `<audio>` / `</body>` 之类是**代码或字符串**，
     * 不是标记。改它们等于改卡的程序。
     * @param {string} source
     * @returns {Array<[number, number]>} [start, end) 区间
     */
    function scriptRangesOf(source) {
      var out = []
      var re = /<script\b[\s\S]*?<\/script\s*>/gi
      var m
      while ((m = re.exec(source))) out.push([m.index, re.lastIndex])
      return out
    }

    /**
     * 位置 `i` 是否落在某个区间内。
     * @param {Array<[number, number]>} ranges
     * @param {number} i
     * @returns {boolean}
     */
    function rangesContain(ranges, i) {
      for (var k = 0; k < ranges.length; k++) {
        if (i >= ranges[k][0] && i < ranges[k][1]) return true
      }
      return false
    }

    /**
     * 媒体标签：带 src 的渲染成真实播放器，没 src 的才降级成占位。
     *
     * 卡的正则会把 `<video>名字</video>` 换成带 src 的完整标签
     * （「视频」正则产出 `<video src="…/视频/名字.mp4" controls>`）。
     * 那种标签已经是最终形态，必须原样保留成可播放元素——再加工只会破坏它。
     * 只有模型随手写的裸提示词（`<audio>轻快的BGM</audio>`，没有 src）才降级成
     * 文字占位，因为它本来就不是一个媒体源。
     *
     * `preload="metadata"` 是有意加的：卡里可能一次给多个媒体，默认 `preload=auto`
     * 会把整段媒体都预载下来，很占带宽；只取元数据足以显示时长与首帧。
     *
     * 实现上**先解析出 src 再重建标签**，而不是把属性串原样拼回去：
     *  - 自闭合（`<video src="a.mp4" />`）和没有收尾标签的媒体现在也会补上
     *    `controls` / `preload`，旧实现要求必须存在 `</video>` 才动手，于是这两种
     *    形态原样漏过去、浏览器里什么都没有；
     *  - 属性含 `>` 时不再截断（见 readStartTag）；
     *  - `class` 会合并进 `muv-media` 而不是写出第二个 class 属性。
     * src 的值按**原样**搬运、不再转义：它本来就在属性引号里，原样保留才与浏览器
     * 解析出的地址逐字节一致（再转义一次会把 `&amp;` 变成 `&amp;amp;`，查表串就废了）。
     *
     * 两条**不碰**的红线，都是真机卡（_足控天堂2）实测逼出来的：
     *
     *  1. `<script>…</script>` 里的 `<audio>` / `<video>` 一律不动。卡自带页面里同一
     *     批标签以**代码形态**出现：正则字面量 `/<audio>(.*?)<\/audio>/g`、注释里的
     *     示例、以及 `'<video … src="'+thumbUrl+'" …>'` 这种拼接出来的标签。
     *     旧实现没有 script 边界的概念，会把正则字面量里的 `<audio>` 当成"无 src
     *     的裸提示词"，从那里一直吃到后面某个 `</audio>`，把卡自己的 JS 挖掉一大块
     *     （见 repro-media-script-corruption.mjs 的实测差异）。
     *  2. **有属性、但没 src** 的媒体元素不动。`<video id="carVid" playsinline
     *     preload="metadata"></video>` 是「先占位、稍后由卡的 JS 赋 src」的写法，
     *     降级成 `<div>` 会让卡里的 `getElementById('carVid')` 找不到元素。
     *     只有**一个属性都没有**的裸提示词（`<audio>轻快的BGM</audio>`）才降级成占位。
     *
     * 单独抽成函数是为了能被测试直接跑——它是纯字符串变换，回归测试从本文件取
     * 源码执行（见 test-client-render.mjs；它按名字抓 readStartTag / attrValue /
     * dropAttr / renderFencedHtml / findClosingFence / renderMediaTags，改名会当场报错）。
     * @param {string} text
     * @returns {string}
     */
    function renderMediaTags(text) {
      if (!text) return text
      var source = String(text)
      // 先圈出 <script> 的范围，落在里面的标签一概不处理（见上面第 1 条红线）。
      var scriptRanges = scriptRangesOf(source)
      var inScript = function (i) { return rangesContain(scriptRanges, i) }
      var out = ''
      var pos = 0
      var re = /<(audio|video)\b/gi
      var m
      while ((m = re.exec(source))) {
        if (inScript(m.index)) continue
        var tag = m[1].toLowerCase()
        var start = readStartTag(source, m.index)
        // 名字对不上（`<video-foo>`）时不动它——宁可漏渲染，不要改坏别人的标签
        if (!start || start.name.toLowerCase() !== tag) continue
        var srcValue = attrValue(start.attrs, 'src')
        // 有属性但没 src：多半是脚本待填的元素，原样放行（见上面第 2 条红线）
        if (srcValue === null && /\S/.test(start.attrs)) continue
        var closeRe = new RegExp('</' + tag + '\\s*>', 'i')
        closeRe.lastIndex = start.end
        var cm = closeRe.exec(source)
        var inner = cm ? source.slice(start.end, cm.index) : ''
        var end = cm ? cm.index + cm[0].length : start.end
        out += source.slice(pos, m.index)
        if (srcValue === null) {
          var cls = tag === 'video' ? 'muv-video-ph' : 'muv-audio'
          out += '<div class="' + cls + '">' + (tag === 'video' ? '🎬 ' : '🎵 ') +
            escHtmlBasic(String(inner).trim()) + '</div>'
        } else {
          var extraClass = attrValue(start.attrs, 'class')
          var rest = start.attrs
          rest = dropAttr(rest, 'src')
          rest = dropAttr(rest, 'class')
          rest = dropAttr(rest, 'controls')
          rest = dropAttr(rest, 'preload')
          out += '<' + tag + ' class="muv-media' + (extraClass ? ' ' + extraClass : '') +
            '" src="' + srcValue + '" controls preload="metadata"' + rest + '>' +
            inner + '</' + tag + '>'
        }
        pos = end
        re.lastIndex = end
      }
      out += source.slice(pos)
      return out
    }

    /**
     * Sandbox 属性：承载角色卡自带 HTML 时用。
     *
     * ⚠️ 这里是 `allow-scripts`，**不要**顺手加上 `allow-same-origin`。
     *
     * 曾经加过，理由是「卡的 HTML 要以 ES module 从 CDN 拉 Vue/Pinia，还要读写
     * localStorage，不透明来源下会失败」。**这个理由是错的**，实测推翻了它：
     * 那张真机卡 210219 字节的状态栏 HTML 里 `jsdelivr` 只出现在**内联脚本的字符串
     * 文本**里，不是外部 script src，也没有 `import`；URL 只有图片与视频。
     * 而且本页面**没有任何 CSP** 兜底。
     *
     * 真正的危险在于：`allow-scripts` + `allow-same-origin` 同时给出，srcdoc 文档会
     * **继承父页面的来源**，于是 `window.parent.document` 变成 DSH 的真实父文档。而
     * 卡自己的代码**正好就在探测它**：
     *
     *     if (window.parent && window.parent !== window) parentDocs.push(window.parent.document)
     *     if (window.opener) parentDocs.push(window.opener.document)
     *     if (window.parent.parent && …) parentDocs.push(window.parent.parent.document)
     *
     * 旧沙箱（不透明来源）下这三行全走 catch、等于空转；加 allow-same-origin 后立刻
     * 生效——卡里的 JS 就能读写 DSH 页面 DOM、带登录凭据打 `/api/*`、读
     * `parent.location`（若凭据在 URL 上则一并被读走）。
     *
     * 「SillyTavern 也不沙箱」不能用来论证：ST 的卡跑在 ST 自己的 origin 里，受害面是
     * ST 自己；DSH 里同一个 iframe 与前端**同源**，受害面是 DSH。
     *
     * 安全与功能的取舍：现在仍是 `allow-scripts`——卡里的 JS 照常运行（内联脚本、
     * 同源无关的逻辑都能跑），只是拿不到父文档与本站存储。确实需要同源能力的卡，
     * 请做成**显式 opt-in**（全局开关或按卡白名单），而不是改这里的默认值。
     * 状态栏的**结构化**渲染不走 iframe，完全不受影响。
     * @type {string}
     */
    var MUV_CARD_SANDBOX = 'allow-scripts'

    // ── 卡 HTML iframe 的高度：不再写死 600px ──────────────────────────────
    //
    // 实测（无头 Edge，把探针脚本拼进卡文档内部、把 scrollHeight 画在左上角）：
    //   ERA 状态栏 = 894px、主页 = 1635px
    // 而 iframe 写死 height:600px → 分别裁掉 294px(33%) / 1035px(63%)，
    // 主页那张 "Profile." 卡片是从中间切断的。
    //
    // 常规做法是父页读 `iframe.contentDocument.scrollHeight`，但那要求
    // `allow-same-origin`——而这条已经被安全原因明确撤掉（见上面 MUV_CARD_SANDBOX 的
    // 长注释：卡内代码会探测 `window.parent.document` 找输入框）。所以走**跨源
    // postMessage**：子文档自己量、只回一个数字，父页只改高度。
    var MUV_FRAME_H_MIN = 160
    var MUV_FRAME_H_MAX = 2400

    /**
     * 高度夹取范围：恶意/畸形卡最多把 iframe 撑到 2400px，最小不低于 160px。
     *
     * 故意做成**函数**而不是闭包常量：回归测试（test-client-render.mjs /
     * test-client-source.mjs）是「从源码里逐字提取函数体再执行」的，闭包变量不在
     * 函数体里，提取出来就是 ReferenceError。这一片的每个 helper 都保持自足，
     * 测试才测得到真实代码，而不是一份副本。
     * @returns {{min: number, max: number}}
     */
    function muvFrameHeightLimits() {
      return { min: 160, max: 2400 }
    }

    /**
     * 注入到每个卡 HTML iframe 尾部的引导脚本。
     *
     * 两条硬约束都是踩过的坑：
     *  - **不含反引号**，且**字符串里不出现裸的 `</script>`**：插件客户端代码可能被
     *    宿主内联进 `<script>` 标签，那样的字面量会当场把标签截断、整个插件报废。
     *    收尾标签用 `'</' + 'script>'` 拼出来。
     *  - **只发一个数字**，不发 HTML、不发卡内任何内容——父页因此永远不需要相信
     *    卡里的东西，收到多少都只是"多高"。
     *
     * ★ 量什么：**内容包围盒**，不是 `scrollHeight`。
     * 这些卡普遍写着 `html,body{height:100%}`，实测 `documentElement.scrollHeight` 与
     * `body.scrollHeight` **都等于视口高**（也就是 iframe 当前高度）。拿它当结果报回去
     * 是个**不动点**：起始 600 报 600、起始 900 报 900。实测「正文美化」的内容只有
     * ~241px，却被永远留在起始值上（起始 600/900/1500 → 报 600/900/1500，逐行相等）。
     * 所以这里遍历 body 后代算 `top + max(height, scrollHeight)` 的最大值：
     *  - 排除 `fixed` / `sticky`（视口相关，会把视口高算成内容高）；
     *  - 排除 display:none / visibility:hidden / 零尺寸元素；
     *  - 每个元素取 `max(rect.height, el.scrollHeight)`，这样被父级 `overflow` 裁掉的
     *    静态子元素也被算进去（这正是当初想用 `body.scrollHeight` 兜的那一类）。
     * 只有包围盒量不出来（0）时才退回 `body.scrollHeight` 兜底。
     * 起始高度 600/900/1500 三档实测收敛到同一值，见 verify-frame-height.mjs。
     *
     * 遍历放在 150ms 去抖后的 setTimeout 里（不在 ResizeObserver 回调里同步跑），
     * 卡再大也不会把滚动/改高的那帧拖住。
     * @returns {string}
     */
    function muvFrameBootstrap() {
      return '<script>(function(){' +
        'if(window.__muvH)return;window.__muvH=1;' +
        'var t=0;' +
        'function extent(){' +
        'var body=document.body;if(!body)return 0;' +
        'var all=body.getElementsByTagName("*"),y=window.scrollY||0,maxB=0;' +
        'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el);' +
        'if(cs.position==="fixed"||cs.position==="sticky")continue;' +
        'if(cs.display==="none"||cs.visibility==="hidden")continue;' +
        'var r=el.getBoundingClientRect();' +
        'if(r.height===0&&r.width===0)continue;' +
        'var b=r.top+y+Math.max(r.height,el.scrollHeight||0);' +
        'if(b>maxB)maxB=b}' +
        'return Math.ceil(maxB)}' +
        'function m(){try{var e=extent();' +
        'var h=e>0?e:(document.body?document.body.scrollHeight:0);' +
        'if(h>0)window.parent.postMessage({__muvFrameHeight:h},"*")' +
        '}catch(err){}}' +
        'function s(){if(t)clearTimeout(t);t=setTimeout(m,150)}' +
        'window.addEventListener("load",function(){m();s()});' +
        'document.addEventListener("DOMContentLoaded",s);' +
        'try{if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)}catch(e){}' +
        'setTimeout(m,700);setTimeout(m,1600);' +
        '})();</' + 'script>'
    }

    /**
     * 把引导脚本插到**不在任何 `<script>` 里的最后一个** `</body>` 之前；
     * 没有这样的 body 就接在末尾。
     *
     * 两个"只做末尾追加、绝不改卡内内容"的约束：
     *  - 绝不去改卡自己的 `<script>` —— 那正是 renderMediaTags 踩过的坑
     *    （正则改写卡内 JS → `&#39;&#39;` → 语法错误 → 整页脚本报废）；
     *  - 注入点也只认**不在 `<script>` 范围内**的 `</body>`：卡自己的 JS 里完全可能
     *    写着 `document.write('</body>')` 这样的字符串，插进去就把卡的代码切断了。
     * @param {string} html
     * @returns {string}
     */
    function withFrameHeightBootstrap(html) {
      var s = String(html == null ? '' : html)
      if (s.indexOf('__muvH') !== -1) return s
      var ranges = scriptRangesOf(s)
      var re = /<\/body\s*>/gi
      var m, last = null
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) last = m
      }
      if (!last) return s + muvFrameBootstrap()
      return s.slice(0, last.index) + muvFrameBootstrap() + s.slice(last.index)
    }

    /**
     * 安装父页监听。全局只装一次；装饰器重跑、反复建 iframe 都无害。
     *
     * 幂等标记挂在 `window` 上（而不是闭包变量），理由同 muvFrameHeightLimits()：
     * 这个函数会被回归测试从源码里提取执行，闭包变量在提取物里不存在。
     * @returns {void}
     */
    function ensureFrameHeightListener() {
      try {
        if (typeof window === 'undefined' || !window.addEventListener) return
        if (window.__muvFrameHListener) return
        window.addEventListener('message', onMuvFrameHeightMessage, false)
        window.__muvFrameHListener = true
      } catch (_) {}
    }

    /**
     * 父页收到子文档报来的高度后，只做一件事：改那个 iframe 的高度。
     *
     * 安全约束（红队会照这几条打）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃；
     *    伪造的、别的窗口/扩展发的消息都进不来（不查 origin：沙箱是不透明来源，
     *    它的 origin 恒为 "null"，拿它当凭据没有意义）；
     *  - 只接受有限正数，并夹到 [160, 2400]，恶意卡不能把页面撑到不可用；
     *  - **不 eval、不插入内容、不转发、不读卡内任何东西**。
     * @param {MessageEvent} ev
     * @returns {void}
     */
    function onMuvFrameHeightMessage(ev) {
      var data = ev && ev.data
      if (!data || typeof data !== 'object' || data.__muvFrameHeight === undefined) return
      var n = Number(data.__muvFrameHeight)
      if (!isFinite(n) || n <= 0) return
      var frames
      try { frames = document.querySelectorAll('iframe.muv-iframe') } catch (_) { return }
      var frame = null
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === ev.source) { frame = frames[i]; break }
      }
      if (!frame) return
      var lim = muvFrameHeightLimits()
      var h = Math.round(n)
      if (h < lim.min) h = lim.min
      if (h > lim.max) h = lim.max
      // 差值阈值：亚像素抖动、卡内动画的 ±几像素不该引发连续改高 + 重排。
      // 只有真的差了一个可感知的量才动。
      var cur = parseFloat(frame.style.height)
      if (isFinite(cur) && Math.abs(cur - h) < 8) return
      try { frame.style.height = h + 'px' } catch (_) {}
    }

    /**
     * 构造承载「卡自带整页 HTML」的 iframe —— 所有这类 iframe 的唯一出口。
     *
     * 统一成一个出口的好处：沙箱常量只有一处（MUV_CARD_SANDBOX）、高度测量只有一处
     * 注入点、默认尺寸只有一处。默认高度仍是 600px，只在收到子文档报数之前生效；
     * 子文档没报数（脚本被卡里别的错误挡住等）就维持 600px，**不会比修之前更差**。
     * @param {string} html 卡自带的整页 HTML
     * @returns {string}
     */
    function cardHtmlIframe(html) {
      ensureFrameHeightListener()
      return '<iframe class="muv-iframe" srcdoc="' + escAttr(withFrameHeightBootstrap(html)) +
        '" sandbox="' + MUV_CARD_SANDBOX +
        '" style="width:100%;height:600px;border:none;border-radius:8px;background:transparent"></iframe>'
    }

    async function beautifyMuv(text) {
      if (!text) return text
      // MUV / tavern markers. `Status_?Block` accepts both the documented
      // `<Status_block>` spelling and the `<StatusBlock>` variant cards use.
      //
      // `<choices>` belongs in this list even though it is not a status marker:
      // a large share of community cards answer with prose plus an options
      // block and no status bar at all. Leaving it out sent those messages past
      // this function entirely, so their options never rendered — the failure
      // was silent, which is why it looked like "选项没了".
      if (!/<StatusPlaceHolder|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i.test(text)) return text

      const normalized = normalizeStatusHeader(text)

      try {
        // Get card data for regex scripts
        const cardJson = await fetchTavernCard()

        if (cardJson) {
          // Apply regex scripts
          const r = await fetch('/api/muv-engine/apply-regex-card', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: normalized, cardJson })
          })
          const d = await r.json()
          if (d.ok) {
            let result = d.text
            // ★ 状态栏级联：卡片自带 HTML → 结构化解析（YAML/👤/自由形态）→ 变量模板
            //   第 1 级（card）与第 2~4 级（yaml/free/loose）都在服务端算；
            //   第 5 级（变量模板）留在本地，因为它和 CSS 在一起。
            let sbHtml = d.statusBarHtml
            if (!sbHtml && STATUS_PH_TEST.test(result)) sbHtml = buildDefaultStatusBar(normalized)
            // 占位符还在才构造：卡自己的正则往往已经把占位符换掉了，那时下一页
            // 210 KB 的 escAttr 会被下面的 replace 直接丢掉——纯浪费。
            // 占位符在、但没有任何数据可展示时给个空状态：绝不把 `<StatusPlaceHolderImpl/>`
            // 原文露给用户。
            if (STATUS_PH_TEST.test(result)) {
              ensureStatusCss()
              const builtin = /^\s*<div class="muv-sb"/.test(sbHtml || '')
              const frame = builtin ? sbHtml : (sbHtml ? cardHtmlIframe(sbHtml) : emptyStatusBar())
              result = result.replace(STATUS_PH_ALL,
                '<div class="muv-statusbar-wrap">' + frame + '</div>')
            }
            // 卡片用 <Status_block> 而非占位符时走结构化级联
            result = await cascadeStatusBlock(result, cardJson)
            // 卡里「主页 / 正文美化」这类正则产出的是被 markdown 围栏包住的整页 HTML，
            // 必须在这里换成 iframe，否则 DSH 会把它当代码块渲染成几十 KB 文本。
            return renderFencedHtml(result)
          }
        }
      } catch (_) {}

      // 拿不到卡片数据（没装 muv-table / 角色卡不是 MUV 格式）时，
      // 仍然用内置模板把状态栏渲染出来 —— 只要求输出里有占位符和变量赋值即可
      try {
        if (STATUS_PH_TEST.test(normalized)) {
          // 有变量就渲染出来；一个变量都没有也要给空状态，不能把占位符原文留在消息里。
          const sb = buildDefaultStatusBar(normalized) || emptyStatusBar()
          ensureStatusCss()
          return renderFencedHtml(normalized.replace(STATUS_PH_ALL,
            '<div class="muv-statusbar-wrap">' + sb + '</div>'))
        }
        // 没有卡片数据也要能出状态栏：级联不依赖卡片，只要能解析出结构
        const cascaded = await cascadeStatusBlock(normalized, null)
        if (cascaded !== normalized) return renderFencedHtml(cascaded)
      } catch (_) {}

      // 即使没渲染出任何卡片，也把折叠好的表头交回去：模型拆行的问题不值得
      // 让用户看到散落的『 』。
      //
      // ★ `<choices>` 不再在这里转成 HTML。
      //
      // 走到这一行说明：没有状态栏占位符、没有 `<Status_block>` 级联、没有围栏文档 ——
      // 唯一可能要做的只有 `<choices>`。而以前这里是
      //     return renderFencedHtml(replaceChoices(normalized))
      // 一旦它和原文不同，`_decorateOne` 就会 `body.innerHTML = html` **整条替换**，
      // 而那次替换的输入是 `innerText`（`**粗体**` 读出来是 `粗体`、`## 标题` 读出来是
      // `标题`、``` 代码块读出来只剩裸代码）—— **markdown 被永久抹掉**，且没有任何
      // 东西能再解析它。选项本来就不需要这条路：`muvRenderChoices()` 已经在 DOM 层
      // 把它们渲染成按钮了（挂在 muvSanitizeNode 上，独立于本函数）。
      //
      // 所以：文本没被 normalizeStatusHeader 改过时**原样返回**（html === raw ⇒ 调用方
      // 不做任何替换 ⇒ markdown 完好、选项照旧出现）。
      // 文本被改过（『📅…|⏰…|📍…』表头被折成一行）时仍然必须交回新文本 —— 那是
      // 状态栏那一路，属于下一类要处理的迁移，本次不动。
      if (normalized === text) return normalized
      return renderFencedHtml(replaceChoices(normalized))
    }

    /**
     * Replace a `<Status_block>…</Status_block>` with the card rendered by the
     * server-side cascade (stages 1-4 of the status strategy).
     *
     * Kept as a separate step because it is orthogonal to regex application:
     * the scripts decide *what text survives*, this decides *how the status
     * area looks*. Returns the input untouched when nothing matched, so a card
     * we do not understand is never silently blanked.
     * @param {string} text
     * @param {object|null} cardJson
     * @returns {Promise<string>}
     */
    async function cascadeStatusBlock(text, cardJson) {
      if (!text || !/<\s*Status_block\s*>/i.test(text)) return text
      try {
        const r = await fetch('/api/muv-engine/render-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, cardJson })
        })
        const d = await r.json()
        if (!d || !d.ok || !d.html) return text
        ensureStatusCss()
        // The card's own HTML is a self-contained document (styles + markup), so
        // it goes into a sandboxed iframe; our structural renders are inline.
        // 卡的整页 HTML 一律走 cardHtmlIframe（带高度测量引导脚本）。
        const isCardHtml = d.stage === 'card'
        const frame = isCardHtml ? cardHtmlIframe(d.html) : d.html
        return text.replace(/<\s*Status_block\s*>[\s\S]*?<\s*\/\s*Status_block\s*>/gi,
          '<div class="muv-statusbar-wrap">' + frame + '</div>')
      } catch (_) {
        return text
      }
    }

    function escAttr(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }

    // ★ 客户端宏展开：{[random::]} / {[pick::]} / {[roll::]}
    var _pickCache = {};
    function _expandMacros(text) {
      if (!text) return text;
      var result = text;
      // random: {[random::opt1::opt2::...]}
      result = result.replace(/\{\[random::([\s\S]*?)\]\}/g, function(_, options) {
        var opts = options.split('::').map(function(s) { return s.trim(); }).filter(Boolean);
        if (opts.length === 0) return '';
        return opts[Math.floor(Math.random() * opts.length)];
      });
      // pick: {[pick::cacheKey::opt1::opt2::...]}
      result = result.replace(/\{\[pick::([^:]+)::([\s\S]*?)\]\}/g, function(_, key, options) {
        var cacheKey = 'pick_' + key.trim();
        if (_pickCache.hasOwnProperty(cacheKey)) return _pickCache[cacheKey];
        var opts = options.split('::').map(function(s) { return s.trim(); }).filter(Boolean);
        if (opts.length === 0) return '';
        var picked = opts[Math.floor(Math.random() * opts.length)];
        _pickCache[cacheKey] = picked;
        return picked;
      });
      // roll: {[roll::NdM]} 或 {[roll::NdM+K]}
      result = result.replace(/\{\[roll::(\d+)d(\d+)(?:([+-])\s*(\d+))?\]\}/g, function(_, n, m, op, mod) {
        var count = parseInt(n, 10) || 1;
        var sides = parseInt(m, 10) || 6;
        var total = 0;
        for (var i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
        if (op && mod) {
          total = op === '+' ? total + parseInt(mod,10) : total - parseInt(mod,10);
        }
        return String(total);
      });
      return result;
    }
    // 全局暴露：reroll pick
    window._tavernRerollPick = function(key) {
      var cacheKey = 'pick_' + key;
      delete _pickCache[cacheKey];
    };
    window._tavernListPicks = function() {
      var entries = [];
      for (var k in _pickCache) {
        if (_pickCache.hasOwnProperty(k) && k.indexOf('pick_') === 0) {
          entries.push({ key: k.replace(/^pick_/, ''), value: _pickCache[k] });
        }
      }
      return entries;
    };
    window._tavernExpandMacros = _expandMacros;

    // Expose beautify function globally for the tavern renderer to use
    if (typeof window !== 'undefined') {
      window.MuvEngine = {
        beautify: beautifyMuv,
        expandMacros: _expandMacros,
        // hooks the tavern panel calls to hand decoration over to this plugin
        decorateMessage: function (el) {
          try { if (_decorateOneHook) _decorateOneHook(el) } catch (_) {}
        },
        scheduleDecorate: function () {
          try { if (_scheduleDecorateHook) _scheduleDecorateHook() } catch (_) {}
        },
      }

      // ★ 轻量 LaTeX 渲染
      if (!window._tavernLatexInstalled) {
        window._tavernLatexInstalled = true
        window._tavernRenderLatex = function(text) {
          if (!text || text.indexOf('\\(') === -1) return text
          return text.replace(/\\\(([\s\S]*?)\\\)/g, function(_, latex) {
            var html = latex
              .replace(/\\scalebox\{[^}]*\}\{/g, '').replace(/\}\s*$/g, '')
              .replace(/\\begin\{array\}\{[^}]*\}/g, '').replace(/\\end\{array\}/g, '')
              .replace(/\\fcolorbox\{([^}]*)\}\{([^}]*)\}\{/g, function(_, border, bg) {
                return '<div style="border:2px solid '+border+';background:'+bg+';border-radius:6px;padding:8px 10px;margin:6px 0">'
              })
              .replace(/\\colorbox\{([^}]*)\}\{([^}]*)\}/g, function(_, color, content) {
                return '<span style="background:'+color+';padding:2px 8px;border-radius:4px;display:inline-block">'+content+'</span>'
              })
              .replace(/\\textcolor\{([^}]*)\}\{([^}]*)\}/g, function(_, color, content) {
                return '<span style="color:'+color+'">'+content+'</span>'
              })
              .replace(/\\rule\{([^}]*)\}\{([^}]*)\}/g, function(_, w, h) {
                return '<span style="display:inline-block;width:'+w+';height:'+h+';background:currentColor;border-radius:2px;vertical-align:middle"></span>'
              })
              .replace(/\\overline\{[^}]*\}/g, '<hr style="border:none;border-top:1px solid #c9a45c;margin:4px 0">')
              .replace(/\\Large\s/g, '<span style="font-size:18px">').replace(/\\large\s/g, '<span style="font-size:16px">').replace(/\\footnotesize\s/g, '<span style="font-size:11px">')
              .replace(/\\quad/g, ' &nbsp; ').replace(/\\textbf\{([^}]*)\}/g, '<b>$1</b>').replace(/\\bullet/g, '•')
              .replace(/\\\\/g, '<br>').replace(/[\{\}]/g, '')
            var opens = (html.match(/<div/g)||[]).length - (html.match(/<\/div>/g)||[]).length
            var openSp = (html.match(/<span/g)||[]).length - (html.match(/<\/span>/g)||[]).length
            while (opens-- > 0) html += '</div>'
            while (openSp-- > 0) html += '</span>'
            return '<div class="muv-latex-block">'+html+'</div>'
          })
        }

        // ★ 通用标签渲染器：纯字符串替换，零性能开销
        window._tavernRenderTags = function(text) {
          if (!text) return text
          // 首先展开宏（{[random::]}, {[pick::]}, {[roll::]}）
          var result = _expandMacros(text)
          // 兼容转义形态：&lt;标签&gt; → <标签>（仅标签形态，DSH 可能转义 LLM 输出的 XML 标签）
          result = result.replace(/&lt;(\/?)([a-zA-Z\u4e00-\u9fa5][^&>]*?)&gt;/g, '<$1$2>')
          // ★ 围栏里的整页 HTML → iframe。
          //
          // 这条以前只有 DSH 原生路径（beautifyMuv → renderFencedHtml）有，酒馆面板走的是
          // 这个渲染器，所以卡产出的整页文档在酒馆路径上**没有被转成 iframe**：
          // 9 条真卡文档里 8 条原样带着 ``` 围栏与裸 <!DOCTYPE html> 进了 `contentEl.innerHTML`。
          // 后果不是"不好看"——卡文档里的 <style> 是**全局生效**的，`html,body{height:100%}`
          // 与一堆绝对定位元素会泄漏进整个聊天 DOM（状态栏只剩一个头 / 满屏代码文本 /
          // 内容列被压扁，都是这个机制）。
          //
          // 位置说明（为什么在这里）：
          //  - 必须在**转义还原之后**：DSH 可能把标签转义成 `&lt;!DOCTYPE html&gt;`，
          //    那样 renderFencedHtml 认不出这是整页文档（它只看裸的 `<!doctype`/`<html`）。
          //  - 必须在**其它标签替换之前**：放进 srcdoc 后卡自己的标记都被转义了，
          //    后面那些正则（媒体、speech、char…）就再也不会去改写卡页面内部的东西 ——
          //    否则 renderMediaTags 会去动卡自己的 `<video>`，正是上一轮修掉的那类事故。
          result = renderFencedHtml(result)
          // <插图> → 图片占位（CG 画廊）
          result = result.replace(/<插图>([\s\S]*?)<\/插图>/gi, function(_, name) {
            return '<div class="muv-illustration"><span class="muv-illustration-icon">🖼️</span> '+escHtml(name.trim())+'</div>'
          })
          // <JSONPatch> → 折叠变量更新
          result = result.replace(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi, function(_, content) {
            return '<details class="muv-jsonpatch"><summary>🔧 变量补丁</summary><pre>'+escHtml(content.trim())+'</pre></details>'
          })
          // <speech> / <dialogue> → 对话样式
          result = result.replace(/<speech>([\s\S]*?)<\/speech>/gi, '<div class="muv-speech">$1</div>')
          result = result.replace(/<dialogue>([\s\S]*?)<\/dialogue>/gi, '<div class="muv-dialogue">$1</div>')
          // <rule_check> / <rule_*> → 隐藏
          result = result.replace(/<rule_check>[\s\S]*?<\/rule_check>/gi, '')
          result = result.replace(/<rule_\w+>[\s\S]*?<\/rule_\w+>/gi, '')
          // <dungeon_engine> → 隐藏
          result = result.replace(/<dungeon_engine>[\s\S]*?<\/dungeon_engine>/gi, '')
          // <user_setting> → 隐藏
          result = result.replace(/<user_setting>[\s\S]*?<\/user_setting>/gi, '')
          // <status_current_variable> → 隐藏（变量状态在 MUV 面板里看）
          result = result.replace(/<status_current_variable>[\s\S]*?<\/status_current_variable>/gi, '')
          // <system> / <system_prompt> → 隐藏
          result = result.replace(/<system_prompt>[\s\S]*?<\/system_prompt>/gi, '')
          // <引用> / <quote> → 引用块
          result = result.replace(/<引用>([\s\S]*?)<\/引用>/gi, '<blockquote class="muv-quote">$1</blockquote>')
          result = result.replace(/<quote>([\s\S]*?)<\/quote>/gi, '<blockquote class="muv-quote">$1</blockquote>')
          // <char> / <character> → 角色名高亮
          result = result.replace(/<char>([\s\S]*?)<\/char>/gi, '<b class="muv-char-name">$1</b>')
          result = result.replace(/<character>([\s\S]*?)<\/character>/gi, '<b class="muv-char-name">$1</b>')
          // ★ 媒体元素：带 src 的渲染成真实播放器，没 src 的才降级成占位
          //   实现见模块级 renderMediaTags()（抽出去是为了能被测试直接跑）
          result = renderMediaTags(result)
          // <sep> / <hr> → 分割线
          result = result.replace(/<sep\s*\/?>/gi, '<hr class="muv-sep">')
          result = result.replace(/<hr\s*\/?>/gi, '<hr class="muv-sep">')
          // ★ 变量编辑块（社区卡的通用形态，模型也常自行改写标签名）
          //
          //   <VariableInsert>{ …JSON… }</VariableInsert>   卡里定义的那份
          //   <VariableEdit>{ …JSON… }</VariableEdit>       模型实际发出的
          //   <UpdateVariable><initvar>…</initvar></UpdateVariable>   MUV 原生
          //
          // 这些块是给变量面板吃的，不是给用户读的正文：以前整块原样显示，
          // 于是 JSON 与标签糊满屏幕。收进折叠卡片，需要时展开看原始数据。
          result = result.replace(/<(VariableEdit|VariableInsert|UpdateVariable)>([\s\S]*?)<\/\1>/gi, function (_, tag, inner) {
            var raw = String(inner || '').trim()
            var pretty = raw
            try { pretty = JSON.stringify(JSON.parse(raw), null, 2) } catch (_) {}
            return '<details class="muv-varedit"><summary>🔧 变量更新</summary><pre>' + escHtml(pretty) + '</pre></details>'
          })
          // ★ 模型自创的思考/摘要外壳：折叠或转成摘要，避免原始标签外泄
          result = result.replace(/<VariableThink>([\s\S]*?)<\/VariableThink>/gi, function (_, inner) {
            return '<details class="muv-varthink"><summary>💭 变量推演</summary><div>' + escHtml(String(inner).trim()) + '</div></details>'
          })
          result = result.replace(/<Abstract>([\s\S]*?)<\/Abstract>/gi, function (_, inner) {
            return '<div class="muv-abstract"><span class="muv-abstract-icon">📖</span> ' + escHtml(String(inner).trim()) + '</div>'
          })
          // <img src="..."> → 图片渲染
          result = result.replace(/<img\s+src="([^"]+)"[^>]*>/gi, function(_, src) {
            return '<img src="'+src+'" class="muv-img" style="max-width:100%;border-radius:8px;margin:6px 0" loading="lazy">'
          })
          // ★ 苍玄界游戏标签 → 信息卡片（独立配色 + 通用字段解析）
          var gameTags = ['赏令接取','赏令完成','拍卖购入','盲盒开启','道友收录','飞剑回信','自由开局']
          var cardColors = {
            赏令接取: { icon:'📜', border:'rgba(212,168,67,0.55)', bg:'rgba(212,168,67,0.08)', title:'#d4a843' },
            赏令完成: { icon:'✅', border:'rgba(74,222,128,0.45)', bg:'rgba(74,222,128,0.06)', title:'#4ade80' },
            拍卖购入: { icon:'💰', border:'rgba(34,211,160,0.45)', bg:'rgba(34,211,160,0.06)', title:'#22d3a0' },
            盲盒开启: { icon:'🎁', border:'rgba(168,85,247,0.50)', bg:'rgba(168,85,247,0.07)', title:'#a855f7' },
            道友收录: { icon:'👥', border:'rgba(96,165,250,0.45)', bg:'rgba(96,165,250,0.06)', title:'#60a5fa' },
            飞剑回信: { icon:'📨', border:'rgba(45,212,191,0.45)', bg:'rgba(45,212,191,0.06)', title:'#2dd4bf' },
            自由开局: { icon:'🎲', border:'rgba(251,146,60,0.50)', bg:'rgba(251,146,60,0.07)', title:'#fb923c' }
          }
          for (var t = 0; t < gameTags.length; t++) {
            var tag = gameTags[t]
            var re = new RegExp('<'+tag+'>(?:(?:(?!<\\/'+tag+'>)[\\s\\S])*?([^：:\\r\\n]+)[：:]\\s*([^\\r\\n]+))*[\\s\\S]*?<\\/'+tag+'>', 'gi')
            var cc = cardColors[tag] || { icon:'📋', border:'rgba(122,184,255,0.15)', bg:'rgba(122,184,255,0.04)', title:'var(--dsw-alias-brand-primary)' }
            result = result.replace(re, function(match) {
              var fields = ''
              var fieldRe = /([^：:\r\n]+)[：:]\s*([^\r\n]+)/g
              var fm
              while ((fm = fieldRe.exec(match)) !== null) {
                fields += '<div class="muv-card-field"><b>'+escHtml(fm[1].trim())+'</b> '+escHtml(fm[2].trim())+'</div>'
              }
              return '<div class="muv-game-card" data-card="'+tag+'" style="border-color:'+cc.border+';background:'+cc.bg+'"><div class="muv-game-card-title" style="color:'+cc.title+'">'+cc.icon+' '+tag+'</div>'+fields+'</div>'
            })
          }
          // <inner> → 内嵌内容（保留）
          result = result.replace(/<inner>([\s\S]*?)<\/inner>/gi, '<div class="muv-inner">$1</div>')
          // ★ <Drama> → 戏剧/舞台卡片（世界书常用）
          result = result.replace(/<Drama>([\s\S]*?)<\/Drama>/gi, '<div class="muv-drama">$1</div>')
          // ★ <choices> → 选项列表（交互式选择；宽松解析：按行分割，支持 A、/1、/•/无前缀）
          //   标签名兼容单复数：不少角色卡写的是 <choice>…</choice>，此前只认 <choices> 会漏渲染
          result = replaceChoices(result)
          // ★ 剥离 <style> 块（世界书格式模板，不应展示给用户）
          result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          // <Analysis> → 隐藏
          result = result.replace(/<Analysis>[\s\S]*?<\/Analysis>/gi, '')
          // ★ 通用社区标签
          // <CG> → CG 画廊图片
          result = result.replace(/<CG>([\s\S]*?)<\/CG>/gi, '<div class="muv-cg"><span class="muv-cg-icon">🎨</span> '+escHtml('$1'.trim())+'</div>')
          // <story> / <narrative> → 正文
          result = result.replace(/<story>([\s\S]*?)<\/story>/gi, '<div class="muv-story">$1</div>')
          result = result.replace(/<narrative>([\s\S]*?)<\/narrative>/gi, '<div class="muv-narrative">$1</div>')
          // <action> → 动作描述
          result = result.replace(/<action>([\s\S]*?)<\/action>/gi, '<div class="muv-action">$1</div>')
          // <thought> / <thinking> → 内心独白
          result = result.replace(/<thought>([\s\S]*?)<\/thought>/gi, '<div class="muv-thought">💭 $1</div>')
          result = result.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, '<div class="muv-thought">💭 $1</div>')
          // <feeling> / <emotion> → 情感状态
          result = result.replace(/<feeling>([\s\S]*?)<\/feeling>/gi, '<span class="muv-feeling">$1</span>')
          result = result.replace(/<emotion>([\s\S]*?)<\/emotion>/gi, '<span class="muv-feeling">$1</span>')
          // <expression> → 表情
          result = result.replace(/<expression>([\s\S]*?)<\/expression>/gi, '<span class="muv-expression">$1</span>')
          // <pose> / <posture> → 姿势
          result = result.replace(/<pose>([\s\S]*?)<\/pose>/gi, '<span class="muv-pose">$1</span>')
          result = result.replace(/<posture>([\s\S]*?)<\/posture>/gi, '<span class="muv-pose">$1</span>')
          // <location> / <scene> → 场景
          result = result.replace(/<location>([\s\S]*?)<\/location>/gi, '<div class="muv-location">📍 $1</div>')
          result = result.replace(/<scene>([\s\S]*?)<\/scene>/gi, '<div class="muv-location">📍 $1</div>')
          // <time> → 时间
          result = result.replace(/<time>([\s\S]*?)<\/time>/gi, '<span class="muv-time">⏰ $1</span>')
          // <weather> → 天气
          result = result.replace(/<weather>([\s\S]*?)<\/weather>/gi, '<span class="muv-weather">🌤️ $1</span>')
          // <inventory> / <背包> → 背包
          result = result.replace(/<inventory>([\s\S]*?)<\/inventory>/gi, '<details class="muv-inventory"><summary>🎒 背包</summary><div>$1</div></details>')
          result = result.replace(/<背包>([\s\S]*?)<\/背包>/gi, '<details class="muv-inventory"><summary>🎒 背包</summary><div>$1</div></details>')
          // <skill> / <技能> → 技能面板
          result = result.replace(/<skill>([\s\S]*?)<\/skill>/gi, '<details class="muv-skill"><summary>⚔️ 技能</summary><div>$1</div></details>')
          result = result.replace(/<技能>([\s\S]*?)<\/技能>/gi, '<details class="muv-skill"><summary>⚔️ 技能</summary><div>$1</div></details>')
          return result
        }
        function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
      }
    }

    exports.inject = []
    exports.apply = function () {
      const style = document.createElement('style')
      style.textContent = '.muv-statusbar-wrap{margin:10px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.muv-iframe{display:block}'+
        '.muv-latex-block{margin:8px 0}.muv-illustration{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(122,184,255,.06);border:1px solid rgba(122,184,255,.2);border-radius:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}.muv-illustration-icon{font-size:20px}'+
        '.muv-jsonpatch{background:rgba(197,160,101,.06);border:1px solid rgba(197,160,101,.2);border-radius:8px;margin:8px 0;overflow:hidden}.muv-jsonpatch summary{font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;color:#c5a065}.muv-jsonpatch pre{font-size:11px;padding:6px 12px;margin:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:200px;overflow:auto}'+
        '.muv-speech{display:block;padding:4px 8px;font-style:italic;color:var(--dsw-alias-label-secondary)}.muv-dialogue{display:block;padding:4px 0;line-height:1.6;border-left:3px solid #72a8ff;padding-left:10px}'+
        '.muv-quote{border-left:3px solid var(--dsw-alias-brand-primary);padding:6px 12px;margin:6px 0;color:var(--dsw-alias-label-secondary);font-style:italic}'+
        // `.muv-video-ph` 是「没有 src 的视频提示词」的占位：它和音频占位长得一样，但
// 不该共用 `muv-audio` 这个类名——否则样式与语义上都被当成音频。
'.muv-char-name{display:inline-block;font-weight:700;color:#ffdd99}.muv-audio,.muv-video-ph{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(122,184,255,.06);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}'+
        '.muv-sep{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:8px 0}.muv-img{max-width:100%;border-radius:8px;margin:6px 0}'+
        '.muv-game-card{border-radius:10px;padding:10px 14px;margin:8px 0;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.45)}.muv-game-card-title{font-weight:700;margin-bottom:6px;font-size:14px}.muv-card-field{margin:2px 0;color:var(--dsw-alias-label-secondary)}.muv-card-field b{color:var(--dsw-alias-label-primary);font-weight:500}.muv-inner{padding:4px 0}'+
        '.muv-cg{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(233,69,96,.06);border:1px dashed rgba(233,69,96,.2);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}.muv-cg-icon{font-size:16px}'+
        '.muv-story,.muv-narrative{line-height:1.8;padding:4px 0}.muv-action{display:block;color:#9dd898;font-style:italic;padding:2px 0}.muv-thought{display:block;color:#c49ce8;font-style:italic;padding:2px 0;font-size:12px}'+
        '.muv-drama{display:block;margin:10px 0;padding:12px 16px;background:linear-gradient(135deg,rgba(233,69,96,0.06),rgba(168,85,247,0.06));border:1px solid rgba(233,69,96,0.25);border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.35)}.muv-drama details{font-size:13px}.muv-drama summary{font-weight:700;font-size:14px;color:var(--dsw-alias-label-accent,#e94560);cursor:pointer;padding:4px 0}.muv-drama .mys{background:#2a1a1a;color:#f0d9d0;padding:16px;border-radius:8px}'+
        '.muv-choices{display:flex;flex-direction:column;gap:6px;margin:10px 0}.muv-choice-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,#2a2a3e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s}.muv-choice-btn:hover{background:var(--dsw-alias-bg-layer-2,#3a3a5e);border-color:var(--dsw-alias-brand-primary,#7ab8ff)}.muv-choice-letter{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-brand-primary,#7ab8ff);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}'+
        '.muv-varedit,.muv-varthink{background:rgba(197,160,101,.06);border:1px solid rgba(197,160,101,.22);border-radius:8px;margin:8px 0;overflow:hidden}.muv-varedit summary,.muv-varthink summary{font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;color:#c5a065}.muv-varedit pre{font-size:11px;line-height:1.55;padding:8px 12px;margin:0;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto}.muv-varthink div{font-size:12px;line-height:1.7;padding:8px 12px;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap}.muv-abstract{display:flex;gap:8px;padding:8px 12px;margin:8px 0;background:rgba(122,184,255,.05);border-left:3px solid rgba(122,184,255,.45);border-radius:6px;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,#bbb)}.muv-abstract-icon{flex-shrink:0}'+
        '.muv-feeling{display:inline-block;color:#ff9eaa;font-size:12px}.muv-expression{display:inline-block;color:#ff9eaa;font-size:12px}.muv-pose{display:inline-block;color:#94d2e8;font-size:12px}.muv-location{display:block;padding:6px 8px;background:rgba(60,55,80,0.45);border-radius:6px;color:var(--dsw-alias-label-secondary)}.muv-time{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}.muv-weather{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}'+
        '.muv-inventory,.muv-skill{background:rgba(122,184,255,.04);border:1px solid rgba(122,184,255,.12);border-radius:6px;margin:6px 0;padding:6px 10px;font-size:12px}.muv-inventory summary,.muv-skill summary{cursor:pointer;font-weight:600;color:var(--dsw-alias-brand-primary)}'+
        // 游戏卡片独立配色（data-card 属性）
        '[data-card="赏令接取"]{border:1px solid rgba(212,168,67,0.55)!important;background:rgba(212,168,67,0.08)!important}[data-card="赏令接取"] .muv-game-card-title{color:#d4a843!important}'+
        '[data-card="赏令完成"]{border:1px solid rgba(74,222,128,0.45)!important;background:rgba(74,222,128,0.06)!important}[data-card="赏令完成"] .muv-game-card-title{color:#4ade80!important}'+
        '[data-card="拍卖购入"]{border:1px solid rgba(34,211,160,0.45)!important;background:rgba(34,211,160,0.06)!important}[data-card="拍卖购入"] .muv-game-card-title{color:#22d3a0!important}'+
        '[data-card="盲盒开启"]{border:1px solid rgba(168,85,247,0.50)!important;background:rgba(168,85,247,0.07)!important}[data-card="盲盒开启"] .muv-game-card-title{color:#a855f7!important}'+
        '[data-card="道友收录"]{border:1px solid rgba(96,165,250,0.45)!important;background:rgba(96,165,250,0.06)!important}[data-card="道友收录"] .muv-game-card-title{color:#60a5fa!important}'+
        '[data-card="飞剑回信"]{border:1px solid rgba(45,212,191,0.45)!important;background:rgba(45,212,191,0.06)!important}[data-card="飞剑回信"] .muv-game-card-title{color:#2dd4bf!important}'+
        '[data-card="自由开局"]{border:1px solid rgba(251,146,60,0.50)!important;background:rgba(251,146,60,0.07)!important}[data-card="自由开局"] .muv-game-card-title{color:#fb923c!important}'+
        '.tavern-options{display:flex;flex-direction:column;gap:6px;margin:10px 0}.tavern-option-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,#2a2a3e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s;width:100%}.tavern-option-btn:hover{background:var(--dsw-alias-bg-layer-2,#3a3a5e);border-color:var(--dsw-alias-brand-primary,#7ab8ff)}.tavern-option-btn::before{content:attr(data-opt-letter);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-brand-primary,#7ab8ff);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}'
      document.head.appendChild(style)
      // ★ 全局点击委托：muv-choice-btn 点击发送选项文本
      document.addEventListener('click', function(e) {
        var btn = e.target.closest('.muv-choice-btn, .tavern-option-btn')
        if (!btn) return
        var text = btn.textContent.replace(/^[A-D]\s*/, '').trim()
        if (!text) return
        // 找到聊天输入框并填入
        var textarea = document.querySelector('textarea[data-muv-macro-hooked]') || document.querySelector('textarea[placeholder*="消息"], textarea[placeholder*="Message"], textarea[placeholder*="输入"]')
        if (!textarea) {
          var allTextareas = document.querySelectorAll('textarea')
          for (var ti = 0; ti < allTextareas.length; ti++) {
            if (allTextareas[ti].offsetParent !== null && !allTextareas[ti].readOnly && allTextareas[ti].rows >= 2) {
              textarea = allTextareas[ti]; break
            }
          }
        }
        if (textarea) {
          var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
          nativeSetter.call(textarea, text)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          textarea.focus()
          // 尝试触发 Enter 发送
          setTimeout(function() {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
          }, 50)
        }
      })
      // ★ 输入拦截器：在用户发送消息前展开宏
      var _macroInputObserver = null
      function _expandTextareaMacros(textarea) {
        var val = textarea.value
        if (val && (val.indexOf('{[') !== -1)) {
          var expanded = _expandMacros(val)
          if (expanded !== val) {
            // 用原生 setter 绕过框架的 value 绑定
            var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
            nativeSetter.call(textarea, expanded)
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
          }
        }
      }
      function _installMacroInputHook() {
        // 查找聊天输入框（DSH WebUI 的 textarea）
        var textarea = document.querySelector('textarea[placeholder*="消息"], textarea[placeholder*="Message"], textarea[placeholder*="输入"], textarea.chat-input, [data-testid="chat-input"] textarea, .chat-input-area textarea, [role="textbox"]')
        if (!textarea) {
          // 退而求其次：找页面中唯一的 textarea（常见于简单聊天 UI）
          var allTextareas = document.querySelectorAll('textarea')
          for (var ti = 0; ti < allTextareas.length; ti++) {
            var ta = allTextareas[ti]
            // 跳过隐藏的、只读的、很小的 textarea
            if (ta.offsetParent === null) continue
            if (ta.readOnly) continue
            if (ta.rows < 2) continue
            textarea = ta
            break
          }
        }
        if (!textarea || textarea.dataset.muvMacroHooked) return
        textarea.dataset.muvMacroHooked = '1'
        // 拦截 Enter 发送（无 Shift）
        textarea.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            _expandTextareaMacros(textarea)
          }
        }, true) // capture phase: 在 DSH 自己的处理器之前运行
        // 拦截所属 form 的 submit（处理点击发送按钮）
        var form = textarea.closest('form')
        if (form && !form.dataset.muvMacroHooked) {
          form.dataset.muvMacroHooked = '1'
          form.addEventListener('submit', function() {
            _expandTextareaMacros(textarea)
          }, true)
        }
        console.log('[muv-engine] 宏展开输入拦截器已安装（textarea:', (textarea.placeholder || textarea.className || textarea.id || '(无标识)') + '）')
      }
      // 立即尝试安装
      _installMacroInputHook()
      // 如果 DOM 还没渲染完，用 MutationObserver 等待
      if (!document.querySelector('textarea[data-muv-macro-hooked]')) {
        _macroInputObserver = new MutationObserver(function() {
          _installMacroInputHook()
          var hooked = document.querySelector('textarea[data-muv-macro-hooked]')
          if (hooked && _macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
        })
        _macroInputObserver.observe(document.body, { childList: true, subtree: true })
      }
      // ★ 酒馆代码清理 + 字段换行 + 选项按钮（从 dsh-visual-render 整合）
      var MUV_SAN_MARK = 'data-muv-sanitized'
      var RE_TOOLCALL = /<tool_call>[\s\S]*?<\/tool_call>|<\/?tool_call>/gi
      var RE_IFBLOCK = /\{\{if\s+[^}]*\}\}[\s\S]*?\{\{\/if\}\}/gi
      var RE_SETBLOCK = /\{\{(?:set|update|var|variable)\s+[^}]*\}\}/gi
      var RE_COMMENT = /\/\*[\s\S]*?\*\//g
      var RE_REVERSE = /\{\{reverse\}\}[\s\S]*?\{\{\/reverse\}\}/gi
      var RE_ANYMACRO = /\{\{[^}]+\}\}/g
      var RE_LEGACY = /\[\[[^\]]+\]\]/g
      var RE_MARKER = /<START(?::[^>]*)?>|\[End of turn\]|\[Initiative\]|\[End of sequence\]|\[End of scene\]/gi
      var RE_FIELD = /([^\n])\s*([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}])\s*(当前行动|当前动作|当前穿搭|当前衣着|当前身份|当前状态|下体状态|下体状况|当前内心|当前心情|当前好感|当前关系|待办事项?|日期|时间|位置|天气|心情|好感度|关系|身份|动作|衣着|穿搭|状态|内心)[：:]/gu

      function muvCleanText(root) {
        try { root.querySelectorAll('tool_call, tool-call').forEach(function(e){e.remove()}) } catch(e){}
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), arr = [], nd
        while ((nd = w.nextNode())) { if (!nd.parentElement || !nd.parentElement.closest('.dshv-root')) arr.push(nd) }
        for (var i = 0; i < arr.length; i++) {
          var node = arr[i]
          if (!node.parentNode) continue
          var t = node.textContent
          if (!t) continue
          var nt = t.replace(RE_TOOLCALL,'').replace(RE_IFBLOCK,'').replace(RE_SETBLOCK,'').replace(RE_COMMENT,'').replace(RE_REVERSE,'').replace(RE_ANYMACRO,'').replace(RE_LEGACY,'').replace(RE_MARKER,'')
          if (RE_FIELD.test(nt)) {
            var frag = document.createDocumentFragment(), last = 0, re = new RegExp(RE_FIELD.source,'gu'), m
            while ((m = re.exec(nt)) !== null) {
              if (m.index + m[1].length > last) frag.appendChild(document.createTextNode(nt.slice(last, m.index + m[1].length)))
              frag.appendChild(document.createElement('br'))
              frag.appendChild(document.createTextNode(m[2] + ' ' + m[3] + '：'))
              last = m.index + m[0].length
            }
            if (last < nt.length) frag.appendChild(document.createTextNode(nt.slice(last)))
            node.parentNode.replaceChild(frag, node)
          } else if (nt !== t) {
            node.textContent = nt
          }
        }
      }

      function muvStripOpt(s) {
        s = String(s||'').trim().replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,'')
        s = s.replace(/^[\u{1F170}-\u{1F17E}]\s*/u,'').replace(/^[A-Za-z][.、)）]\s*/,'').replace(/^\d+[.、)）]\s*/,'')
        return s.trim()
      }

      function muvBuildChoices(opts) {
        var box = document.createElement('div')
        box.className = 'muv-choices'
        for (var i = 0; i < opts.length; i++) {
          (function(text, idx){
            var btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'muv-choice-btn'
            btn.setAttribute('data-opt', String.fromCharCode(65+idx))
            // textContent 而不是 innerHTML：选项文本可能来自模型（DOM 路径直接吃消息文本），
            // 拼进 innerHTML 就等于给它一次注入机会；字符串路径那边本来也是转义的，
            // 这样两条路径的转义口径也一致。
            var letter = document.createElement('span')
            letter.className = 'muv-choice-letter'
            letter.textContent = String.fromCharCode(65+idx)
            btn.appendChild(letter)
            btn.appendChild(document.createTextNode(String(text == null ? '' : text)))
            box.appendChild(btn)
          })(opts[i], i)
        }
        return box
      }

      /**
       * 把子树拼成一个字符串，**在 `<br>` 与块级边界补 `\n`**，并给出「字符 → 文本节点」的映射。
       *
       * 为什么不能直接拼 `nodeValue`：`<br>` 自己没有任何文本，而它恰恰是选项行的分隔符。
       * 直接拼会得到 `A. 甲B. 乙`，把两个选项粘成一个（`innerText` 在这里是对的，
       * 因为它按布局算换行；`textContent` 是错的）。实测就是这个坑：
       * 粘在一起之后 `<choices>` 只解析出 1 个选项。
       * @param {Element} root
       * @returns {{text: string, map: Array<{node: Text, start: number}>}}
       */
      function muvTextWithBreaks(root) {
        var text = ''
        var map = []
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null)
        var n
        var BLOCK = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, PRE: 1, BLOCKQUOTE: 1, TR: 1, TABLE: 1, UL: 1, OL: 1 }
        while ((n = walker.nextNode())) {
          if (n.nodeType === 3) {
            var v = n.nodeValue || ''
            if (!v) continue
            map.push({ node: n, start: text.length })
            text += v
            continue
          }
          var tag = n.tagName || ''
          if (tag === 'BR') { text += '\n'; continue }
          if (BLOCK[tag] && text && !/\n$/.test(text)) text += '\n'
        }
        return { text: text, map: map }
      }

      /**
       * 在「文本 + 映射」里定位一个字符位置。
       * 取「起点不晚于 pos 的最后一个文本节点」：pos 若落在合成的换行符上，会吸附到
       * 前一个文本节点的末尾（删除/插入的位置因此仍然正确）。
       * @param {Array<{node: Text, start: number}>} nodes
       * @param {number} pos
       * @returns {{node: Text, offset: number}|null}
       */
      function locateInWalked(nodes, pos) {
        for (var i = nodes.length - 1; i >= 0; i--) {
          if (pos >= nodes[i].start) {
            var len = (nodes[i].node.nodeValue || '').length
            return { node: nodes[i].node, offset: Math.min(pos - nodes[i].start, len) }
          }
        }
        return null
      }

      /**
       * 在**文本里**找一段 `<choices>…</choices>`，返回可做 Range 手术的位置。
       *
       * 与装饰器那边的 `findTextRange` 同源，但两者在不同作用域（那边在消息装饰的
       * 闭包里），所以这里自带一份最小实现 —— 并且比它多一件事：**识别换行**。
       * 等 markdown 分段补丁把装饰器也搬过来时再合并（那边同样需要这个换行感知，
       * 现在搬会动到已跑通的状态栏那条路，不划算）。
       * @param {Element} root
       * @returns {{startNode:Text, startOffset:number, endNode:Text, endOffset:number, content:string}|null}
       */
      function muvFindChoiceRange(root) {
        var walked = muvTextWithBreaks(root)
        var m = /<choices?>([\s\S]*?)<\/choices?>/i.exec(walked.text)
        if (!m) return null
        var a = locateInWalked(walked.map, m.index)
        var b = locateInWalked(walked.map, m.index + m[0].length)
        if (!a || !b || !a.node.parentNode || !b.node.parentNode) return null
        return { startNode: a.node, startOffset: a.offset, endNode: b.node, endOffset: b.offset, content: m[1] }
      }

      /**
       * 把 DOM 里的『📅…|⏰…|📍…』状态表头**折成一行**（markdown 第二类迁移）。
       *
       * 折叠本身是纯文本变换（见 normalizeStatusHeader：把括号内的换行换成空格、
       * 归一化 ` | `），完全不需要 `body.innerHTML = html` 那条路 —— 而那条路的输入是
       * `innerText`，会把整条消息的 markdown 抹掉。
       *
       * 折完之后 `normalizeStatusHeader(innerText) === innerText`，于是 `beautifyMuv`
       * 那一档会**原样返回**（不触发整条替换）⇒ markdown 保住、表头照旧折好。
       * 卫生 pass 的 MutationObserver 注册在装饰器之前（1687 vs 2591），两者的回调都走
       * rAF，按注册顺序执行 ⇒ 折叠总是先于装饰发生。
       *
       * 每次替换完重新 walk 一遍（Range 手术会拆/并文本节点，旧的映射会失效），
       * 只处理「第一个需要折」的块；折过的块再过一遍 normalizeStatusHeader 就是恒等，
       * 所以循环必然收敛（最多 8 轮兜底）。
       * @param {Element} root
       * @returns {number} 折掉的表头数量
       */
      function muvFoldStatusHeader(root) {
        if (!root || root.nodeType !== 1) return 0
        if (typeof normalizeStatusHeader !== 'function') return 0
        var done = 0
        for (var guard = 0; guard < 8; guard++) {
          var walked = muvTextWithBreaks(root)
          var re = /『([\s\S]*?)』/g
          var m = null, hit = null
          while ((m = re.exec(walked.text))) {
            if (normalizeStatusHeader(m[0]) !== m[0]) { hit = m; break }
          }
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          if (!a || !b || !a.node.parentNode || !b.node.parentNode) break
          try {
            var range = document.createRange()
            range.setStart(a.node, a.offset)
            range.setEnd(b.node, b.offset)
            range.deleteContents()
            range.insertNode(document.createTextNode(normalizeStatusHeader(hit[0])))
          } catch (_) { break }
          done++
        }
        return done
      }

      /**
       * `<choices>…</choices>`（单复数都认）→ 选项按钮，**在 DOM 层完成**。
       *
       * 为什么必须有这份 DOM 实现：字符串层的 `replaceChoices()` 只有在调用方
       * `body.innerHTML = html` 整条写回时才生效，而那次写回用的是 `innerText`
       * （`**`/`##`/``` 已经被 DSH 渲染掉了）—— markdown 会被**永久**抹掉。
       * 在这里渲染则完全不动消息里已有的 `<strong>` / `<h2>` / `<pre><code>`：
       * 只把那一段 `<choices>` 文本换成按钮框。
       *
       * 循环处理是因为一条消息里可能有多个 `<choices>` 块（每次替换完重新扫）。
       * @param {Element} root
       * @returns {number} 换掉的选项块数量
       */
      function muvRenderChoices(root) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        for (var guard = 0; guard < 20; guard++) {
          var hit = muvFindChoiceRange(root)
          if (!hit) break
          var opts = parseChoiceOptions(hit.content)
          try {
            var range = document.createRange()
            range.setStart(hit.startNode, hit.startOffset)
            range.setEnd(hit.endNode, hit.endOffset)
            range.deleteContents()
            if (opts.length) range.insertNode(muvBuildChoices(opts))
          } catch (_) {
            return done
          }
          done++
        }
        return done
      }

      function muvRenderOpts(root) {
        var cns = root.querySelectorAll('.tsit-char-name')
        for (var ci = 0; ci < cns.length; ci++) {
          var ne = cns[ci]
          if (ne.closest('.muv-choices') || ne.closest('.dshv-root')) continue
          if (!/^(行动选项|可选行动|请选择|选择|选项|行动)[:：]?\s*$/.test(ne.textContent.trim())) continue
          var ce = ne.closest('.tsit-char')
          if (!ce) continue
          // 跳过已被其他插件渲染过的（后面已有 .muv-choices 或 .dshv-root）
          var ns = ce.nextElementSibling
          if (ns && (ns.classList.contains('muv-choices') || ns.classList.contains('dshv-root'))) continue
          var opts = [], els = [], sib = ce.nextElementSibling
          while (sib && sib.classList.contains('tsit-char')) {
            var sn = sib.querySelector('.tsit-char-name')
            if (sn && /^\s*[-*•·]\s+/.test(sn.textContent)) {
              els.push(sib)
              var ot = muvStripOpt(sn.textContent.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
              if (ot) opts.push(ot)
            } else break
            sib = sib.nextElementSibling
          }
          if (opts.length < 2) continue
          var box = muvBuildChoices(opts)
          ce.style.display = 'none'
          els.forEach(function(e){e.style.display='none'})
          ce.insertAdjacentElement('afterend', box)
        }
        var paras = root.querySelectorAll('p, div, li')
        for (var pi = 0; pi < paras.length; pi++) {
          var p = paras[pi]
          if (p.closest('.muv-choices') || p.closest('.tsit-char') || p.closest('.dshv-root')) continue
          var tm = p.textContent.trim().match(/^(行动选项|可选行动|请选择|选择|选项|行动)[:：]?\s*([\s\S]*)$/)
          if (!tm) continue
          var lists = [], oels = [], opts2 = []
          var rest = tm[2] ? tm[2].trim() : ''
          if (rest) rest.split(/\n|<br\s*\/?>/i).forEach(function(line){
            var r = muvStripOpt(line.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
            if (r && r.length > 1) opts2.push(r)
          })
          var nx = p.nextElementSibling
          while (nx && (nx.tagName==='UL'||nx.tagName==='OL'||(nx.tagName==='P'&&/^\s*[-*•·]\s+/.test(nx.textContent)))) {
            if (nx.tagName==='UL'||nx.tagName==='OL') {
              lists.push(nx)
              nx.querySelectorAll('li').forEach(function(li){ var o=muvStripOpt(li.textContent); if(o)opts2.push(o) })
            } else {
              oels.push(nx)
              var pt = muvStripOpt(nx.textContent.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
              if (pt) opts2.push(pt)
            }
            nx = nx.nextElementSibling
          }
          if (opts2.length < 2) continue
          var box2 = muvBuildChoices(opts2)
          p.style.display = 'none'
          lists.forEach(function(e){e.style.display='none'})
          oels.forEach(function(e){e.style.display='none'})
          p.insertAdjacentElement('afterend', box2)
        }
      }

      function muvStyleTavernOpts(root) {
        var groups = []
        if (root.classList && root.classList.contains('tavern-options')) groups.push(root)
        var found = root.querySelectorAll('.tavern-options')
        for (var fi = 0; fi < found.length; fi++) groups.push(found[fi])
        for (var gi = 0; gi < groups.length; gi++) {
          var group = groups[gi]
          if (group.hasAttribute('data-muv-styled')) continue
          group.setAttribute('data-muv-styled', '1')
          var btns = group.querySelectorAll('.tavern-option-btn')
          for (var bi = 0; bi < btns.length; bi++) {
            btns[bi].setAttribute('data-opt-letter', String.fromCharCode(65 + bi))
          }
        }
      }

      /**
       * Run the tavern-cleanup pass over one element (or a whole document).
       *
       * Split out of `muvSanitize` so the message decorator can re-run it on a
       * single element after rewriting that element's HTML: the rewrite throws
       * away this pass's output (`<choices>` → buttons) while the
       * `data-muv-sanitized` mark prevents it from ever running again, which
       * silently deleted the 行动选项 buttons.
       * @param {Element} md
       */
      function muvSanitizeNode(md) {
        if (!md || md.nodeType !== 1) return
        if (md.hasAttribute(MUV_SAN_MARK) || md.closest('[contenteditable="true"]')) return
        md.setAttribute(MUV_SAN_MARK, '1')
        // 每一步各自 try：一类标记出错不该把**其它类**的渲染一起带走
        // （挤在同一个 try 里时，表头折叠抛一次异常，选项按钮就再也不出现了 ——
        //  这正是实测暴露出来的：探针少注入一个依赖，4 项断言同时红）。
        try { muvCleanText(md) } catch (e) { console.error('[muv-engine clean]', e) }
        try { muvFoldStatusHeader(md) } catch (e) { console.error('[muv-engine header]', e) }
        try { muvRenderOpts(md); muvStyleTavernOpts(md) } catch (e) { console.error('[muv-engine opts]', e) }
        try { muvRenderChoices(md) } catch (e) { console.error('[muv-engine choices]', e) }
      }

      /**
       * Find the elements this pass should clean.
       *
       * Deliberately not a plain `[class*="_markdown"]` query. Two things go
       * wrong with a bare class match:
       *
       *  - DSH's body container is a CSS Modules name whose hash changes every
       *    time the Web bundle is rebuilt (`Sxvs8a_root` → `_markdown_kcgor_5`).
       *    A hard-coded hash stops matching after an upgrade and the whole
       *    chain goes quiet with no error on the page.
       *  - `_markdown_*` is *also* used by the file-type icon module, so the
       *    class alone matches elements that are not messages at all.
       *
       * So match the shape (`_markdown_<hash>_<n>`) and then require rendered
       * block children, which the icon does not have. Same two rules the tavern
       * client uses, so both plugins agree on what a message is.
       * @returns {Element[]}
       */
      var MUV_BODY_RE = /_markdown_[a-z0-9]+_\d+/i
      var MUV_BLOCK_RE = /_[a-zA-Z]+_[a-z0-9]+_\d+/

      function isMuvMessageBody(el) {
        if (!el || el.nodeType !== 1) return false
        var cls = el.className
        if (typeof cls !== 'string' || !cls) return false
        if (!MUV_BODY_RE.test(cls)) return false
        try {
          return !!el.querySelector('p, pre, ul, ol, blockquote, table, h1, h2, h3')
        } catch (_) { return false }
      }

      function muvSanitizeTargets() {
        var out = []
        try {
          var byShape = document.querySelectorAll('[class*="_markdown_"]')
          for (var i = 0; i < byShape.length; i++) if (isMuvMessageBody(byShape[i])) out.push(byShape[i])
        } catch (_) {}
        if (!out.length) {
          // Fallback: any CSS-Modules-shaped class that contains block content.
          try {
            var all = document.querySelectorAll('[class]')
            for (var j = 0; j < all.length; j++) {
              var el = all[j]
              var cls = el.className
              if (typeof cls !== 'string' || !MUV_BLOCK_RE.test(cls)) continue
              try { if (el.querySelector('p, pre, ul, ol, blockquote, table')) out.push(el) } catch (_) {}
            }
          } catch (_) {}
        }
        // Plugin-owned containers keep their explicit hooks.
        try {
          var owned = document.querySelectorAll('[class*="tavern-"], [class*="dsh-tv"], [class*="muv-"]')
          for (var k = 0; k < owned.length; k++) out.push(owned[k])
        } catch (_) {}
        // Explicit role markers: older DSH builds and other shells do not use
        // CSS Modules at all (`Sxvs8a_root`), so neither shape rule above can
        // see them. The tavern client carries the same fallback.
        try {
          var legacy = document.querySelectorAll('[data-role="assistant"], .assistant-message, .chat-message.assistant')
          for (var L = 0; L < legacy.length; L++) out.push(legacy[L])
        } catch (_) {}
        return out
      }

      function muvSanitize() {
        var mds = muvSanitizeTargets()
        for (var i = 0; i < mds.length; i++) muvSanitizeNode(mds[i])
      }

      muvSanitize()
      var _muvSanRaf = 0
      var _muvSanObs = new MutationObserver(function(){
        if (_muvSanRaf) return
        _muvSanRaf = window.requestAnimationFrame(function(){ _muvSanRaf = 0; muvSanitize() })
      })
      _muvSanObs.observe(document.body, { childList: true, subtree: true })

      // ★★★ dsh-visual-render 代码块渲染（visual/options/aside/scene）★★★
      ;(function() {
    var LANG_RE = /^(visual|dsh-html|vhtml)$/i;
    var OPTIONS_LANG_RE = /^options$/i;
    var ASIDE_LANG_RE = /^(aside|narration|narrador)$/i;
    var SCENE_LANG_RE = /^(scene|juqing|drama|剧本|场景)$/i;
    var MARK = 'data-dshv-processed';

    var UI_CSS = `.dshv-root{margin:12px 0;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.2));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));backdrop-filter:blur(8px);}
.dshv-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));border-bottom:1px solid var(--dsw-alias-border, rgba(127,127,127,.15));font-size:12.5px;}
.dshv-label{font-weight:600;color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));margin-right:auto;letter-spacing:.3px;}
.dshv-btn{border:1px solid var(--dsw-alias-border, rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-primary, inherit);border-radius:6px;padding:3px 10px;font-size:11px;line-height:1.5;cursor:pointer;font-family:inherit;transition:all .15s ease;}
.dshv-btn:hover{background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12));}
.dshv-body{background:transparent;color:var(--dsw-alias-label-primary, inherit);}
.dshv-frame{width:100%;min-height:360px;border:0;display:block;}
.dshv-options{display:flex;flex-direction:column;gap:8px;padding:14px;}
.dshv-opt{text-align:left;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-1, rgba(255,255,255,.6));color:var(--dsw-alias-label-primary, inherit);border-radius:10px;padding:10px 14px 10px 40px;font-size:13.5px;cursor:pointer;line-height:1.6;font-family:inherit;position:relative;transition:all .18s cubic-bezier(.4,0,.2,1);word-break:break-word;}
.dshv-opt::before{content:attr(data-idx);position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15));color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all .18s ease;}
.dshv-opt:hover{border-color:rgba(59,127,240,.5);background:var(--dsw-alias-bg-layer-2, rgba(59,127,240,.06));transform:translateX(3px);box-shadow:0 2px 12px rgba(59,127,240,.12);}
.dshv-opt:hover::before{background:#3b7ff0;color:#fff;}
.dshv-opt[data-dshv-picked]{border-color:#3b7ff0;background:rgba(59,127,240,.1);box-shadow:0 0 0 3px rgba(59,127,240,.12);}
.dshv-opt[data-dshv-picked]::before{background:#3b7ff0;color:#fff;content:"✓";}
.dshv-opt-status{padding:2px 4px 0;font-size:12px;color:var(--dsw-alias-label-tertiary, rgba(127,127,127,.55));}
.dshv-aside{padding:6px 12px;font-size:11.5px;line-height:1.7;font-style:italic;color:var(--dsw-alias-label-tertiary,#9aa3b2);opacity:.72;border-left:2px solid var(--dsw-alias-border, rgba(127,127,127,.22));white-space:pre-line;}
html body [class*="tavern" i],html body [class*="agent-preset" i],html body [class*="style" i],html body [class*="skin" i],html body [class*="theme" i]{position:static !important;transform:none !important;left:auto !important;top:auto !important;margin:initial !important;max-height:none !important;overflow-y:visible !important;}
html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry],html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry],html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry],html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision],html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern],html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry],html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry],html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry{color:#e8ecf4 !important;background:rgba(22,27,38,.5) !important;border-radius:8px !important;}html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry]:hover,html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern]:hover,html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry]:hover,html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry]:hover,html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry:hover,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry:hover{color:#ffffff !important;background:rgba(22,27,38,.72) !important;}html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry[data-active],html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry[data-active]{color:#ffffff !important;background:rgba(59,127,240,.38) !important;}
html body [data-dsh-tavern-manager-entry]{display:none !important;}
html body [data-dsh-style-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:132px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
html body [data-dsh-vr-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:144px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
.VOzbGW_navCell,.VOzbGW_navTitle,.VOzbGW_navLabel,.VOzbGW_navIcon{color:#1f2329 !important;opacity:1 !important;text-shadow:none !important;}
.VOzbGW_navCell.VOzbGW_active{color:#ffffff !important;}
.dshv-root.dshv-scene .dshv-sc-body{background:linear-gradient(180deg,#fbf6ee,#f3ead8);color:#3a2f1d;padding:16px 18px;}
.dshv-root.dshv-scene .dshv-sc-title{font-size:17px;font-weight:700;margin-bottom:10px;color:#5b3a12;letter-spacing:1px;}
.dshv-root.dshv-scene .dshv-sc-p{font-size:14px;line-height:1.9;margin:0 0 6px;text-indent:2em;}
.dshv-root.dshv-scene .dshv-sc-pad{height:8px;}
.dshv-root.dshv-scene .dshv-sc-item{font-size:13.5px;color:#6b5633;margin:0 0 5px;padding-left:12px;border-left:2px solid #c5a468;}
.dshv-root.dshv-scene .dshv-sc-line{display:flex;gap:8px;margin:4px 0;}
.dshv-root.dshv-scene .dshv-sc-who{flex:none;font-weight:700;color:#8a4b2a;min-width:56px;}
.dshv-root.dshv-scene .dshv-sc-say{flex:1;color:#3a2f1d;line-height:1.7;}
button.Kad6XG_iconButton{width:26px !important;height:26px !important;color:#3b7ff0 !important;background:rgba(59,127,240,.12) !important;border:1px solid rgba(59,127,240,.4) !important;border-radius:6px !important;opacity:1 !important;pointer-events:auto !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;}
button.Kad6XG_iconButton:hover{color:#fff !important;background:#3b7ff0 !important;}
button.Kad6XG_iconButton svg{width:16px !important;height:16px !important;fill:currentColor !important;}
.nFunOq_iconButton,.nFunOq_rerollButton{color:#3b7ff0 !important;opacity:1 !important;border-color:rgba(59,127,240,.5) !important;background:rgba(59,127,240,.1) !important;}
.nFunOq_iconButton:hover,.nFunOq_rerollButton:hover{color:#fff !important;background:#3b7ff0 !important;}
html body [data-pane="sidebar"][data-pane="sidebar"]{--dsw-alias-label-primary:#dbe4f7 !important;--dsw-alias-label-primary-bluish:#c6d1e9 !important;--dsw-alias-label-secondary:#bdc9e3 !important;--dsw-alias-label-tertiary:#9bb0d5 !important;--dsw-alias-label-caption:#8a9cc0 !important;--dsw-alias-label-dimmed:#a1b0cf !important;color:#dbe4f7 !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] button,html body [data-pane="sidebar"][data-pane="sidebar"] button span,html body [data-pane="sidebar"][data-pane="sidebar"] button svg,html body [data-pane="sidebar"][data-pane="sidebar"] [role="button"] svg{color:#dbe4f7 !important;fill:currentColor !important;opacity:1 !important;text-shadow:none !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] button:hover,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover span,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover svg{color:#ffffff !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] .hHd-Xa_iconButton.hHd-Xa_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_iconButton.qDHVXG_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_searchButton.qDHVXG_searchButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_headerActions.qDHVXG_headerActions,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_sectionLabel.qDHVXG_sectionLabel{color:#dbe4f7 !important;fill:currentColor !important;background:transparent !important;border-color:transparent !important;}
`;


    var LIB_CSS = `*{box-sizing:border-box;}
body{margin:0;padding:18px;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#23272e;background:#f2f4f7;}
.browser{width:100%;max-width:860px;margin:0 auto;border-radius:10px;overflow:hidden;background:#fff;color:#23272e;box-shadow:0 12px 32px rgba(0,0,0,.18);}
.browser-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#e8eaee;border-bottom:1px solid #d5d8dd;}
.dot{width:12px;height:12px;border-radius:50%;flex:none;}
.dot.red{background:#ff5f57;}.dot.yellow{background:#febc2e;}.dot.green{background:#28c840;}
.address{flex:1;display:flex;align-items:center;gap:6px;background:#fff;border-radius:6px;padding:5px 10px;font-size:13px;color:#555b66;margin-left:6px;}
.nav{display:flex;align-items:center;gap:22px;padding:12px 28px;border-bottom:1px solid #edeff2;font-size:14px;}
.nav .logo{font-weight:700;color:#1456cc;margin-right:auto;}
.nav a{color:#4a5160;text-decoration:none;}
.hero{padding:44px 28px;background:linear-gradient(135deg,#1456cc,#3b7ff0 60%,#6ea8ff);color:#fff;}
.hero h1{margin:0 0 10px;font-size:30px;}
.hero p{margin:0 0 18px;font-size:14px;opacity:.9;}
.hero button{border:0;background:#fff;color:#1456cc;font-size:14px;padding:9px 22px;border-radius:20px;cursor:pointer;}
.content-grid{display:grid;grid-template-columns:1fr 260px;gap:24px;padding:24px 28px 30px;}
.article h3{margin:0 0 10px;font-size:18px;}
.article p{font-size:14px;line-height:1.9;color:#3c434e;margin:0;}
.sidebar{background:#f5f7fa;border-radius:8px;padding:14px 16px;}
.sidebar h4{margin:0 0 10px;font-size:13px;color:#1456cc;}
.sidebar ul{margin:0;padding-left:18px;font-size:13px;color:#4a5160;line-height:2;}
.footer{padding:14px 28px;border-top:1px solid #edeff2;font-size:12px;color:#8b93a1;text-align:center;}
.phone{width:100%;max-width:380px;margin:0 auto;background:#0f1115;border-radius:30px;padding:10px 8px 14px;box-shadow:0 12px 32px rgba(0,0,0,.25),inset 0 0 0 2px #000;}
.screen{background:#f4f5f7;border-radius:22px;overflow:hidden;color:#23272e;}
.statusbar{display:flex;justify-content:space-between;padding:8px 18px 4px;font-size:12px;}
.chat-head{display:flex;align-items:center;gap:10px;padding:8px 14px 10px;border-bottom:1px solid #e6e8ec;background:#fff;}
.back{border:0;background:transparent;font-size:22px;line-height:1;color:#23272e;cursor:pointer;padding:0;}
.chat-title{font-weight:600;font-size:15px;}
.chat-head .more{margin-left:auto;color:#8b93a1;font-size:14px;letter-spacing:2px;}
.chat-body{display:flex;flex-direction:column;gap:10px;padding:18px 14px;min-height:240px;}
.bubble{max-width:78%;padding:9px 13px;font-size:14px;line-height:1.6;border-radius:10px;}
.bubble.left{align-self:flex-start;background:#fff;border-top-left-radius:3px;}
.bubble.right{align-self:flex-end;background:#95ec69;border-top-right-radius:3px;}
.chat-time{text-align:center;font-size:11px;color:#9aa3b2;}
.chat-input{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e6e8ec;}
.chat-input .plus{font-size:22px;color:#4a5160;}
.chat-input .field{flex:1;background:#f4f5f7;border-radius:6px;padding:7px 10px;font-size:13px;color:#9aa3b2;}
.chat-input .send{border:0;background:#07c160;color:#fff;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;}
.terminal{width:100%;max-width:720px;margin:0 auto;background:#050806;border:1px solid #1d2b1f;border-radius:8px;padding:20px 22px;font-family:Consolas,"Courier New",monospace;font-size:14px;line-height:1.9;color:#33ff66;text-shadow:0 0 6px rgba(51,255,102,.6);box-shadow:0 0 32px rgba(51,255,102,.1),inset 0 0 60px rgba(51,255,102,.04);white-space:pre-wrap;word-break:break-all;}
.terminal.amber{color:#ffb000;text-shadow:0 0 6px rgba(255,176,0,.6);box-shadow:0 0 32px rgba(255,176,0,.12),inset 0 0 60px rgba(255,176,0,.04);}
.cursor{animation:dshv-blink 1s steps(2,start) infinite;}
@keyframes dshv-blink{to{visibility:hidden;}}
.letter{width:100%;max-width:560px;margin:0 auto;position:relative;padding:46px 52px 88px;font-family:"Kaiti SC","STKaiti","KaiTi","SimSun",serif;color:#3a3226;background:radial-gradient(120% 90% at 18% 0%,rgba(160,120,60,.1),transparent 55%),radial-gradient(120% 90% at 82% 100%,rgba(160,120,60,.12),transparent 55%),linear-gradient(180deg,#f8f1df,#f2e7cc);border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.2),0 16px 40px rgba(0,0,0,.25);}
.letter::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(96,74,40,.12);transform:translateX(-50%) rotate(1.5deg);}
.letter-head{text-align:right;font-size:13px;color:#6d5f45;margin-bottom:26px;letter-spacing:1px;}
.letter .salutation{font-size:18px;margin:0 0 14px;}
.letter .body-p{font-size:16px;line-height:2.1;text-indent:2em;margin:0 0 10px;text-shadow:0 0 2px rgba(0,0,0,.45);}
.letter .sign{text-align:right;margin-top:34px;font-size:17px;letter-spacing:2px;padding-right:96px;}
.letter .ps{margin-top:30px;padding-top:12px;padding-right:110px;border-top:1px dashed rgba(96,74,40,.35);font-size:14px;color:#6d5f45;}
.seal{position:absolute;right:34px;bottom:36px;width:78px;height:78px;border-radius:50%;border:3px solid rgba(178,34,34,.72);color:rgba(178,34,34,.85);display:flex;align-items:center;justify-content:center;font-size:34px;transform:rotate(-12deg);box-shadow:inset 0 0 6px rgba(178,34,34,.25);}
.newspaper{width:100%;max-width:760px;margin:0 auto;background:#e9e4d1;color:#26221a;border:2px solid #b6ad93;padding:26px 30px 32px;box-shadow:0 16px 40px rgba(0,0,0,.25);font-family:"Songti SC","STSong","SimSun",serif;}
.masthead{text-align:center;}
.masthead h1{margin:0 0 8px;font-size:44px;letter-spacing:10px;font-weight:900;}
.dateline{font-size:12px;letter-spacing:3px;border-top:3px double #26221a;border-bottom:1px solid #26221a;padding:5px 0;margin-bottom:18px;}
.news-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:18px;}
.news-grid article{font-size:13px;line-height:1.9;}
.news-grid article+article{border-left:1px solid #b6ad93;padding-left:18px;}
.news-grid h2{font-size:19px;line-height:1.5;margin:0 0 8px;}
.news-grid .lead h2{font-size:26px;}
.news-grid p{text-indent:2em;margin:0 0 8px;}
.news-grid .byline{font-size:11px;color:#6d6450;text-indent:0;letter-spacing:1px;}
@media (max-width:640px){.content-grid{grid-template-columns:1fr;}.news-grid{grid-template-columns:1fr;}.news-grid article+article{border-left:0;border-top:1px solid #b6ad93;padding-left:0;padding-top:14px;}}`;

    var uiInjected = false;
    function injectUiCss() {
      if (uiInjected) return;
      if (document.querySelector('style[data-plugin-css="dsh-visual-render-ui"]')) { uiInjected = true; return; }
      var tag = document.createElement('style');
      tag.dataset.pluginCss = 'dsh-visual-render-ui';
      tag.textContent = UI_CSS;
      document.head.appendChild(tag);
      uiInjected = true;
    }

    function renderDoc(source) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">' +
        '<style>' + LIB_CSS + '</style></head><body>' + source + '</body></html>';
    }

    function langOf(block) {
      var wrap = block.firstElementChild;
      if (!wrap) return '';
      var banner = wrap.firstElementChild;
      if (!banner) return '';
      var info = banner.firstElementChild;
      if (!info) return '';
      var text = (info.textContent || '').trim();
      return text.split(/\s+/)[0] || '';
    }

    function codeTextOf(block) {
      var pre = block.querySelector('pre');
      return pre ? pre.textContent : '';
    }

    function makeButton(label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dshv-btn';
      btn.textContent = label;
      return btn;
    }

    function sizeFrame(frame) {
      try {
        var doc = frame.contentDocument;
        if (doc && doc.documentElement) {
          var h = Math.max(360, doc.documentElement.scrollHeight + 24);
          if (h > 1400) h = 1400;
          frame.style.height = h + 'px';
        }
      } catch (e) {}
    }

    function buildView(block, lang) {
      var source = codeTextOf(block).replace(/\s+$/, '');
      if (!source.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎬 ' + lang.toUpperCase() + ' 实时渲染';
      var srcBtn = makeButton('源码');
      var openBtn = makeButton('新窗口');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      bar.appendChild(openBtn);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-body';
      var frame = document.createElement('iframe');
      frame.className = 'dshv-frame';
      frame.title = 'visual render';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.srcdoc = renderDoc(source);
      frame.addEventListener('load', function () { sizeFrame(frame); });
      bodyWrap.appendChild(frame);

      root.appendChild(bar);
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '预览';
      });
      openBtn.addEventListener('click', function () {
        var win = window.open('', '_blank');
        if (!win) return;
        win.document.open();
        win.document.write(renderDoc(codeTextOf(block).replace(/\s+$/, '')));
        win.document.close();
      });

      var last = source;
      var timer = 0;
      var updater = function () {
        var now = codeTextOf(block).replace(/\s+$/, '');
        if (now === last) return;
        last = now;
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          if (!frame.isConnected) return;
          frame.srcdoc = renderDoc(last);
        }, 250);
      };
      var pre = block.querySelector('pre');
      var mo = new MutationObserver(updater);
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }

    function insertIntoInput(text) {
      var input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (!input) return false;
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        var value = input.value || '';
        input.value = value + (value ? '\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        input.textContent = (input.textContent || '') + '\n' + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

    function optionLines(source) {
      var out = [];
      var lines = String(source || '').split(/\n/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].replace(/^(?:[-*]\s+|(?:\d+[.)、]))+/, '').trim();
        if (t) out.push(t);
      }
      return out;
    }

    function buildOptions(block, lang) {
      var opts = optionLines(codeTextOf(block));
      if (!opts.length) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎲 剧情选项（点击后自动填入输入框）';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-body';
      var list = document.createElement('div');
      list.className = 'dshv-options';
      bodyWrap.appendChild(list);
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      function renderButtons() {
        var lines = optionLines(codeTextOf(block));
        list.innerHTML = '';
        for (var i = 0; i < lines.length; i++) {
          (function (text) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dshv-opt';
            btn.textContent = (i + 1) + ' · ' + text;
            btn.addEventListener('click', function () {
              if (btn.hasAttribute('data-dshv-picked')) return;
              btn.setAttribute('data-dshv-picked', '1');
              btn.textContent = '✓ ' + text;
              if (insertIntoInput(text)) {
                var status = document.createElement('div');
                status.className = 'dshv-opt-status';
                status.textContent = '已填入输入框，直接发送即可。';
                list.appendChild(status);
              }
            });
            list.appendChild(btn);
          })(lines[i]);
        }
      }
      renderButtons();

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '选项';
      });

      var timer = 0;
      var mo = new MutationObserver(function () {
        clearTimeout(timer);
        timer = window.setTimeout(renderButtons, 300);
      });
      var pre = block.querySelector('pre');
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }

    function buildAside(block, lang) {
      var text = codeTextOf(block).replace(/\s+$/, '');
      if (!text.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎙️ 旁白吐槽';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var body = document.createElement('div');
      body.className = 'dshv-aside';
      body.textContent = text;
      root.appendChild(body);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        body.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '旁白';
      });

      var timer = 0;
      var mo = new MutationObserver(function () {
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          body.textContent = codeTextOf(block).replace(/\s+$/, '');
        }, 250);
      });
      var pre = block.querySelector('pre');
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }

    function buildScene(block, lang) {
      var text = codeTextOf(block).replace(/\s+$/, '');
      if (!text.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var title = '', body = text;
      var m = text.match(/^#+\s*(.+)\s*\n([\s\S]*)$/);
      if (m) { title = m[1].trim(); body = m[2]; }
      var lines = body.split(/\n/);
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\s+$/, '');
        if (!ln.trim()) { html += '<div class="dshv-sc-pad"></div>'; continue; }
        if (ln.match(/^\s*[-*]\s+/)) { html += '<div class="dshv-sc-item">' + escapeHtml(ln.replace(/^\s*[-*]\s+/, '')) + '</div>'; continue; }
        var dial = ln.match(/^\s*(?:「(?:\S*[:：]?)?)?(.+?)(?:」)?\s*[:：]\s*(.+)$/);
        if (dial) { html += '<div class="dshv-sc-line"><span class="dshv-sc-who">' + escapeHtml(dial[1]) + '</span><span class="dshv-sc-say">' + escapeHtml(dial[2]) + '</span></div>'; continue; }
        html += '<div class="dshv-sc-p">' + escapeHtml(ln) + '</div>';
      }

      var root = document.createElement('div');
      root.className = 'dshv-root dshv-scene';
      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎭 剧情场景' + (lang ? ' · ' + lang : '');
      label.style.marginRight = '0';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-sc-body';
      bodyWrap.innerHTML = (title ? '<div class="dshv-sc-title">' + escapeHtml(title) + '</div>' : '') + html;
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '场景';
      });

      var timer = 0;
      var updater = function () {
        var now = codeTextOf(block).replace(/\s+$/, '');
        if (now === text) return;
        text = now;
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          var mm = text.match(/^#+\s*(.+)\s*\n([\s\S]*)$/);
          var t2 = mm ? mm[1].trim() : '';
          var b2 = mm ? mm[2] : text;
          var l2 = b2.split(/\n/), h2 = '';
          for (var j = 0; j < l2.length; j++) {
            var s = l2[j].replace(/\s+$/, '');
            if (!s.trim()) { h2 += '<div class="dshv-sc-pad"></div>'; continue; }
            if (s.match(/^\s*[-*]\s+/)) { h2 += '<div class="dshv-sc-item">' + escapeHtml(s.replace(/^\s*[-*]\s+/, '')) + '</div>'; continue; }
            var dd = s.match(/^\s*(?:「(?:\S*[:：]?)?)?(.+?)(?:」)?\s*[:：]\s*(.+)$/);
            if (dd) { h2 += '<div class="dshv-sc-line"><span class="dshv-sc-who">' + escapeHtml(dd[1]) + '</span><span class="dshv-sc-say">' + escapeHtml(dd[2]) + '</span></div>'; continue; }
            h2 += '<div class="dshv-sc-p">' + escapeHtml(s) + '</div>';
          }
          bodyWrap.innerHTML = (t2 ? '<div class="dshv-sc-title">' + escapeHtml(t2) + '</div>' : '') + h2;
        }, 250);
      };
      var pre = block.querySelector('pre');
      if (pre) { var mo = new MutationObserver(updater); mo.observe(pre, { childList: true, subtree: true, characterData: true }); }
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function stats() {
      var blocks = document.querySelectorAll('.md-code-block');
      var wrapped = document.querySelectorAll('.dshv-root').length;
      var langs = [];
      for (var i = 0; i < blocks.length; i++) {
        var l = langOf(blocks[i]);
        if (l) langs.push(l);
      }
      return { codeBlocks: blocks.length, wrappedBlocks: wrapped, langs: langs };
    }

    var VR_ENTRY = '[data-dsh-vr-entry]';
    var VR_PANEL = '[data-dsh-vr-view]';
    var VR_ACTIVE = 'data-dsh-vr-active';

    function vrSidebarRoot() {
      var column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      if (!column) return undefined;
      var logoOwner = column.querySelector('[class*="logoRow"]') ? column.querySelector('[class*="logoRow"]').parentElement : undefined;
      return logoOwner || (column.firstElementChild || undefined);
    }

    function vrNewSessionButton(root) {
      var nested = root.querySelector('button[class*="newSession"]');
      if (nested) return nested;
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i].tagName === 'BUTTON') return root.children[i];
      }
      return undefined;
    }

    function vrCreateEntry() {
      var entry = document.createElement('button');
      entry.type = 'button';
      entry.dataset.dshVrEntry = '';
      entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;max-width:100%;padding:8px 12px;background:rgba(255,255,255,.06);border:none;color:#e8ecf4;cursor:pointer;font-size:13px;text-align:left;border-radius:8px;';
      var icon = document.createElement('span');
      icon.textContent = '🎬';
      icon.style.cssText = 'flex:0 0 auto;display:inline-block;line-height:1;font-size:15px;';
      var label = document.createElement('span');
      label.textContent = '视觉渲染';
      label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;line-height:1.4;';
      entry.appendChild(icon);
      entry.appendChild(label);
      return entry;
    }

    function vrCreatePanel() {
      var panel = document.createElement('div');
      panel.dataset.dshVrView = '';
      panel.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.55);z-index:1300;display:none;align-items:flex-start;justify-content:center;padding:10vh 16px;box-sizing:border-box;font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;';
      var card = document.createElement('div');
      card.style.cssText = 'background:#ffffff;color:#1c2024;border:1px solid rgba(0,0,0,.14);border-radius:12px;max-width:520px;width:100%;padding:16px;box-shadow:0 24px 64px rgba(0,0,0,.45);font-size:13px;line-height:1.7;';
      card.innerHTML = [
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><strong style="font-size:15px">🎬 视觉渲染状态</strong><button data-dsh-vr-close type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:2px 10px;cursor:pointer">✕</button></div>',
        '<div style="background:#f5f7fb;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;line-height:1.8"><strong>🎯 这个按钮不用点——渲染是全自动的。</strong><br>当聊天里出现 <code>\`\`\`visual</code> / <code>\`\`\`options</code> / <code>\`\`\`aside</code> 代码块时会自动变漂亮：<br>📜 visual → 信纸 / 终端 / 报纸 / 手机 / 浏览器界面<br>🎲 options → 三个可点击的剧情选项<br>🎙️ aside → 淡色小字旁白<br>这里只是状态面板，用来看渲染数量。</div>',
        '<div data-dsh-vr-stats style="opacity:.85"></div>',
        '<div data-dsh-vr-diag style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(0,0,0,.15);font-size:11px;opacity:.75;white-space:pre-wrap;line-height:1.6"></div>',
        '<div style="display:flex;gap:8px;margin-top:10px"><button data-dsh-vr-rescan type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px">🔄 重新扫描</button><button data-dsh-vr-close2 type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px">关闭</button></div>',
        '<div style="margin-top:8px;opacity:.55;font-size:11.5px">支持的语言块：visual（界面渲染）/ options（三选一按钮）/ aside（淡色旁白）。langs 为空表示本页没有这些代码块。</div>'
      ].join('');
      panel.appendChild(card);
      return panel;
    }

    function mountUi() {
      if (window.__dshVrUi && typeof window.__dshVrUi.dispose === 'function') {
        try { window.__dshVrUi.dispose(); } catch (e) {}
        window.__dshVrUi = null;
      }
      document.querySelectorAll('[data-dsh-vr-entry]').forEach(function (el) { el.remove(); });
      document.querySelectorAll('[data-dsh-vr-view]').forEach(function (el) { el.remove(); });
      document.documentElement.removeAttribute(VR_ACTIVE);

      var entry = vrCreateEntry();
      var panel;
      var root;
      var placed = false;

      function refresh() {
        var el = panel && panel.querySelector('[data-dsh-vr-stats]');
        if (!el) return;
        var s = stats();
        var text = '代码块 ' + s.codeBlocks + ' 个 · 已渲染 ' + s.wrappedBlocks + ' 个 · 语言: ' + (s.langs.length ? s.langs.join(', ') : '（无）');
        if (el.textContent !== text) el.textContent = text;
        var diag = panel.querySelector('[data-dsh-vr-diag]');
        if (diag) {
          var parts = [];
          var sels = ['[data-dsh-lewdscale-entry]', '[data-dsh-possess-entry]', '[data-dsh-datatools-entry]', '[data-dsh-datatools-vision]', '[data-dsh-datatools-tavern]', '[data-dsh-tavern-entry]', '[data-dsh-tavern-manager-entry]', '[data-dsh-style-entry]', '[data-dsh-vr-entry]'];
          for (var i = 0; i < sels.length; i++) parts.push(sels[i] + ' = ' + document.querySelectorAll(sels[i]).length);
          var side = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
          var btns = side ? side.querySelectorAll('button') : [];
          parts.push('--- 侧边栏按钮采样（' + btns.length + ' 个）---');
          for (var j = 0; j < Math.min(btns.length, 12); j++) {
            var b = btns[j];
            var attrs = [];
            for (var k = 0; k < b.attributes.length; k++) {
              var a = b.attributes[k];
              if (/data-|class/.test(a.name)) attrs.push(a.name + '=' + String(a.value).slice(0, 22));
            }
            parts.push(j + '. [' + attrs.join(' ') + '] ' + (b.textContent || '').trim().slice(0, 24));
          }
          parts.push('--- 样式状态 ---');
          parts.push('style 标签在页面里 = ' + (document.querySelector('style[data-plugin-css="dsh-visual-render-ui"]') ? 'YES' : 'NO'));
          var probe = document.querySelector('[data-dsh-lewdscale-entry]');
          if (probe) {
            var cs = window.getComputedStyle(probe);
            parts.push('档位入口计算色 = ' + cs.color + ' | ' + cs.backgroundColor);
          }
          var dtxt = parts.join('\n');
          if (diag.textContent !== dtxt) diag.textContent = dtxt;
        }
      }

      function applyActive() {
        if (!panel) return;
        var active = document.documentElement.hasAttribute(VR_ACTIVE);
        panel.style.display = active ? 'flex' : 'none';
        if (active) refresh();
      }

      function ensurePanel() {
        if (panel && panel.isConnected) return panel;
        panel = vrCreatePanel();
        document.body.appendChild(panel);
        var close = function () {
          document.documentElement.removeAttribute(VR_ACTIVE);
          applyActive();
        };
        panel.querySelector('[data-dsh-vr-close]').addEventListener('click', close);
        panel.querySelector('[data-dsh-vr-close2]').addEventListener('click', close);
        panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
        panel.querySelector('[data-dsh-vr-rescan]').addEventListener('click', function () {
          scan(document);
          refresh();
        });
        return panel;
      }

      entry.addEventListener('click', function () {
        ensurePanel();
        if (document.documentElement.hasAttribute(VR_ACTIVE)) {
          document.documentElement.removeAttribute(VR_ACTIVE);
        } else {
          document.documentElement.setAttribute(VR_ACTIVE, '');
        }
        applyActive();
      });

      var tryPlace = function () {
        if (root && !root.isConnected) { root = undefined; placed = false; }
        if (placed) { if (document.body.contains(entry)) return; placed = false; }
        root = root || vrSidebarRoot();
        if (!root) {
          if (entry.parentElement !== document.body) {
            entry.style.position = 'fixed';
            entry.style.bottom = '108px';
            entry.style.right = '20px';
            entry.style.zIndex = '99999';
            entry.style.width = 'auto';
            entry.style.borderRadius = '999px';
            entry.style.background = 'var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15))';
            entry.style.boxShadow = '0 4px 16px rgba(0,0,0,.25)';
            document.body.appendChild(entry);
            placed = true;
          }
          return;
        }
        var button = vrNewSessionButton(root);
        if (!button) {
          if (entry.parentElement !== root) root.appendChild(entry);
          placed = true;
          return;
        }
        if (entry.parentElement !== root) {
          var row = button.closest('[class*="logoRow"]');
          var base = (row && row.parentElement === root) ? row : button;
          root.insertBefore(entry, base.nextElementSibling);
        }
        placed = true;
      };

      var observerRaf = 0;
      var observer = new MutationObserver(function () {
        if (observerRaf) return;
        observerRaf = window.requestAnimationFrame(function () {
          observerRaf = 0;
          tryPlace();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      tryPlace();

      window.__dshVrUi = {
        dispose: function () {
          observer.disconnect();
          if (entry) entry.remove();
          document.documentElement.removeAttribute(VR_ACTIVE);
          if (panel) panel.remove();
        }
      };
    }

    function scan(root) {
      var blocks = (root || document).querySelectorAll('.md-code-block');
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.hasAttribute(MARK)) continue;
        var lang = langOf(block);
        var isVisual = LANG_RE.test(lang);
        var isOptions = OPTIONS_LANG_RE.test(lang);
        var isAside = ASIDE_LANG_RE.test(lang);
        var isScene = SCENE_LANG_RE.test(lang);
        if (!isVisual && !isOptions && !isAside && !isScene) continue;
        try {
          injectUiCss();
          if (isScene) buildScene(block, lang);
          else if (isAside) buildAside(block, lang);
          else if (isOptions) buildOptions(block, lang);
          else buildView(block, lang);
        } catch (e) {
          if (typeof console !== 'undefined' && console.error) console.error('[dsh-visual-render]', e);
        }
      }
    }


        // 启动代码块渲染
        injectUiCss();
        scan(document);
        var _vrRaf = 0;
        _vrObs = new MutationObserver(function() {
          if (_vrRaf) return;
          _vrRaf = window.requestAnimationFrame(function() { _vrRaf = 0; scan(document); });
        });
        _vrObs.observe(document.body, { childList: true, subtree: true });

        // ── 消息装饰：把卡片正则脚本的结果真正贴回 DOM ──────────────
        // beautifyMuv() 一直存在，但历史上没有任何地方调用它：卡片的 21 条
        // 脚本（对话美化/心声/状态栏/世界卡…）算得出来，却从没写回页面，
        // 用户看到的就是纯原文。这里负责补上这一步。
        //
        // 正文容器按 CSS Modules 的“形状”匹配而不是写死哈希 —— DSH 每次
        // 重建 Web 资源哈希都会变，写死必然在某次升级后静默失效。
        var MSG_BODY_RE = /_markdown_[a-z0-9]+_\d+/i
        var DECORATED_ATTR = 'data-muv-decorated'
        var _decorating = false
        var _decorRaf = 0

        /** Every message body in the current view, paired with its message root. */
        function messageTargets() {
          var out = []
          try {
            var all = document.querySelectorAll('[class*="_markdown_"]')
            for (var i = 0; i < all.length; i++) {
              var body = all[i]
              var cls = body.className
              if (typeof cls !== 'string' || !MSG_BODY_RE.test(cls)) continue
              // 同名模式也用在文件类型图标上，正文一定含块级子节点
              if (!body.querySelector('p, pre, ul, ol, blockquote, table, h1, h2, h3')) continue
              out.push({ body: body, root: messageRootOf(body) })
            }
          } catch (_) {}
          return out
        }

        async function decorateMessages() {
          if (_decorating) return
          _decorating = true
          try {
            var targets = messageTargets()
            for (var i = 0; i < targets.length; i++) {
              await _decorateOne(targets[i])
            }
          } finally {
            _decorating = false
          }
        }

        /**
         * Decorate one message.
         *
         * Writes into the *body* element's innerHTML and never the message root:
         * the root is DSH's own wrapper, and replacing it destroys the
         * `_markdown_*` element this decorator relies on (and re-renders on every
         * scroll). Accepts either a `{body, root}` pair or a bare element.
         * @param {{body:Element, root:Element}|Element} target
         */
        async function _decorateOne(target) {
          var body = target && target.body ? target.body : target
          var root = target && target.root ? target.root : target
          if (!body || body.nodeType !== 1) return
          if (body.getAttribute(DECORATED_ATTR) === '1') return
          // 流式输出中的消息先不动，等它写完
          if (root && root.closest && root.closest('[data-streaming]')) return
          if (body.closest && body.closest('[data-streaming]')) return
          var raw = ''
          try {
            // innerText, not textContent: textContent concatenates block children
            // with no separator, so a message DSH rendered as several <p> would
            // arrive as one long line and every line-based parser would see a
            // single field. innerText keeps the rendered line breaks.
            raw = body.innerText || body.textContent || ''
          } catch (_) { return }
          if (!raw) return
          var html = null
          try { html = await beautifyMuv(raw) } catch (_) { html = null }
          if (html && html !== raw) {
            try { applyDecoratedHtml(body, html, raw) } catch (_) {}
            // The swap rebuilds the message's HTML from plain text, which
            // discards anything the sanitize pass had already produced in this
            // element (`<choices>` → buttons) and re-marks it so the pass never
            // revisits it. That is how the option buttons disappeared. Clear
            // the mark and re-run the pass over just this element.
            try {
              body.removeAttribute('data-muv-sanitized')
              if (typeof muvSanitizeNode === 'function') muvSanitizeNode(body)
            } catch (_) {}
          }
          body.setAttribute(DECORATED_ATTR, '1')
        }

        var STATUS_OPEN_RE = /<\s*(?:Status_block|状况)\s*>/i
        var STATUS_CLOSE_RE = /<\s*\/\s*(?:Status_block|状况)\s*>/i

        /**
         * 从装饰结果里取出那一段 `muv-statusbar-wrap`（配平地扫 div）。
         *
         * 以前这里是个正则：`/<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/`
         * —— 它假定卡片末尾**恰好连着三个 `</div>`**。而真实产物并不总是这样：
         *  - 卡自带整页 HTML 时里面是 `<iframe …></iframe></div>`（零个内层 div）；
         *  - 空状态是 `<div class="muv-sb muv-sb-empty">…</div></div>`（两个）。
         * 匹配不上就直接走整条替换，markdown 白丢一次。所以改成按 div 深度配平：
         * 这是「生成什么就解析什么」的做法，不依赖产物长什么样。
         * @param {string} html
         * @returns {string|null}
         */
        function extractStatusWrap(html) {
          var s = String(html || '')
          var open = s.indexOf('<div class="muv-statusbar-wrap"')
          if (open < 0) return null
          var gt = s.indexOf('>', open)
          if (gt < 0) return null
          var depth = 1
          var re = /<\/?div\b[^>]*>/gi
          re.lastIndex = gt + 1
          var m
          while ((m = re.exec(s))) {
            depth += (m[0].charAt(1) === '/') ? -1 : 1
            if (depth === 0) return s.slice(open, re.lastIndex)
          }
          return null
        }

        /**
         * 用一段 HTML 替换 DOM 里的一段文本（Range 手术），失败返回 false。
         * @param {Element} body
         * @param {{node:Text,offset:number}} start
         * @param {{node:Text,offset:number}} end
         * @param {string} html
         * @returns {boolean}
         */
        function insertHtmlAtRange(body, start, end, html) {
          try {
            var range = document.createRange()
            range.setStart(start.node, start.offset)
            range.setEnd(end.node, end.offset)
            range.deleteContents()
            var holder = document.createElement('div')
            holder.className = 'muv-statusbar-hit'
            holder.innerHTML = html
            range.insertNode(holder)
            return true
          } catch (_) { return false }
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain text
         * (`innerText` — `**`/`##`/``` 早就被 DSH 渲染掉了), so its output carries no
         * markdown: code blocks, tables and emphasis get flattened permanently, and
         * any ordinary reply that merely *mentions* a marker would be rewritten too.
         *
         * 所以只在**确实需要落地的那一段**上做手术，按优先级：
         *   ① `<Status_block>…</Status_block>`  → 只替换这一段；
         *   ② `<StatusPlaceHolderImpl/>`          → 只替换这一段（第二类迁移新增）；
         *   ③ 都找不到 → 只能整条替换（最后手段，保留原行为）。
         * 文本偏移而不是「包住标签的那个元素」：DSH 的 markdown 会把这些行塞进任意嵌套
         * 元素里，元素级手术会留下半截标签文本 —— 那正是 0.3.3 时代 `角色状态]</summary>`
         * 那种碎屑的来源。
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function applyDecoratedHtml(body, html, raw) {
          var cardMatch = extractStatusWrap(html)
          // 装饰产物里根本没有状态栏（卡的正则改了文本但级联没出东西）：保持老行为。
          if (!cardMatch) { body.innerHTML = html; return }

          // ① 结构化状态块
          var open = findTextRange(body, STATUS_OPEN_RE)
          if (open) {
            var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
            var full = ''
            var n
            while ((n = walker.nextNode())) full += n.nodeValue || ''
            var afterOpen = full.slice(open.start)
            var cm = STATUS_CLOSE_RE.exec(afterOpen)
            var end
            if (cm) {
              var closeEnd = open.start + cm.index + cm[0].length
              var w2 = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
              var nodes2 = []
              var acc = ''
              var t
              while ((t = w2.nextNode())) {
                var v = t.nodeValue || ''
                if (!v) continue
                nodes2.push({ node: t, start: acc.length })
                acc += v
              }
              var loc = function (pos) {
                for (var i = 0; i < nodes2.length; i++) {
                  var s = nodes2[i].start
                  var e = s + (nodes2[i].node.nodeValue || '').length
                  if (pos >= s && pos <= e) return { node: nodes2[i].node, offset: pos - s }
                }
                return null
              }
              end = loc(closeEnd)
            } else {
              // 未闭合（还在流式，或模型漏了收尾标签）：只换开标签自己。
              end = { node: open.node, offset: open.offset + (open.endOffset - open.offset) }
            }
            if (end && insertHtmlAtRange(body, { node: open.node, offset: open.offset }, end, cardMatch)) return
            body.innerHTML = html
            return
          }

          // ② 占位符：卡用 `<StatusPlaceHolderImpl/>` 而不是 `<Status_block>`
          var ph = findTextRange(body, STATUS_PH_TEST)
          if (ph && insertHtmlAtRange(body, { node: ph.node, offset: ph.offset },
            { node: ph.endNode, offset: ph.endOffset }, cardMatch)) return

          // ③ 找不到落点：最后手段（这一条会让 markdown 变平，但至少消息不是空的）
          body.innerHTML = html
        }

        /**
         * Find the character offset of a regex match inside an element's text,
         * walking text nodes in document order.
         * @param {Element} root
         * @param {RegExp} re
         * @returns {{node:Text, offset:number, endNode:Text, endOffset:number, start:number}|null}
         */
        function findTextRange(root, re) {
          var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
          var nodes = []
          var full = ''
          var n
          while ((n = walker.nextNode())) {
            var v = n.nodeValue || ''
            if (!v) continue
            nodes.push({ node: n, start: full.length })
            full += v
          }
          var m = re.exec(full)
          if (!m) return null
          var start = m.index
          var end = start + m[0].length
          var locate = function (pos) {
            for (var i = 0; i < nodes.length; i++) {
              var s = nodes[i].start
              var e = s + (nodes[i].node.nodeValue || '').length
              if (pos >= s && pos <= e) return { node: nodes[i].node, offset: pos - s }
            }
            return null
          }
          var a = locate(start)
          var b = locate(end)
          if (!a || !b) return null
          // Both endpoints must live in an element we can safely edit.
          if (!a.node.parentNode || !b.node.parentNode) return null
          return { node: a.node, offset: a.offset, endNode: b.node, endOffset: b.offset, start: start }
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain
         * text, so its prose output carries no markdown — code blocks, tables and
         * emphasis DSH rendered get flattened, and any ordinary reply that merely
         * *mentions* `<Status_block>` would be rewritten too.
         *
         * So we delete exactly the text range spanned by the status block and
         * drop the card in its place, using a DOM Range. Working on text offsets
         * (rather than picking "the block element that contains the tag") matters:
         * DSH's markdown wraps these lines in arbitrary, often nested elements, so
         * element-level surgery leaves fragments of the tag text behind — which is
         * exactly the `角色状态]</summary> ...` debris that shipped in 0.3.3.
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function scheduleDecorate() {
          if (_decorRaf) return
          _decorRaf = window.requestAnimationFrame(function () {
            _decorRaf = 0
            decorateMessages()
          })
        }

        scheduleDecorate()
        _muvMsgObs = new MutationObserver(scheduleDecorate)
        _muvMsgObs.observe(document.body, { childList: true, subtree: true })

        // Publish the entry points now that the DOM helpers exist.
        _decorateOneHook = _decorateOne
        _scheduleDecorateHook = scheduleDecorate
      })();      return function() {
        style.remove()
        if (_macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
        // These live in the factory scope (declared above) so the cleanup can
        // actually reach them — inside the IIFE they were unreachable here.
        if (_muvMsgObs) { _muvMsgObs.disconnect(); _muvMsgObs = null }
        if (_vrObs) { _vrObs.disconnect(); _vrObs = null }
      }
    }

    return module.exports
  }
})