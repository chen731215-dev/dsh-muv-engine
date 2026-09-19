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
      + '.muv-sb-sub{padding:6px 16px 13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:1px 22px}'
      + '.muv-sb-row{display:flex;align-items:center;gap:9px;padding:2px 0}'
      + '.muv-sb-name{flex:none;min-width:4.5em;max-width:6.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}'
      + '.muv-sb-bar{flex:1;min-width:56px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-l2,rgba(127,127,127,.16));overflow:hidden}'
      + '.muv-sb-fill{display:block;height:100%;border-radius:999px;transition:width .3s ease}'
      + '.muv-sb-val{flex:none;width:2.4em;text-align:right;opacity:.62;font-size:11px;font-variant-numeric:tabular-nums}'
      + '.muv-sb-empty{padding:11px 16px;opacity:.6}'
      // Cascade-rendered layouts: one-line fields and the action options list.
      + '.muv-sb-line{padding:1px 0;opacity:.92;font-size:12.5px;line-height:1.5;word-break:break-word}'
      + '.muv-sb-line b{font-weight:600;opacity:.75;margin-right:5px}'
      // Structural layout. Deliberately a single column: the old grid
      // (`repeat(auto-fit,minmax(215px,1fr))`) was built for short variable bars,
      // and made long field text flow into neighbouring columns, so a field could
      // render beside another character's.
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
     * Turn `<choices>…</choices>` (and the singular `<choice>`) into option
     * buttons.
     *
     * Extracted from `muvCleanText` so the message decorator can apply it to a
     * message that contains *only* an options block. `beautifyMuv` routes such
     * a message straight back out — it has no `<Status_block>` for the cascade
     * to replace — so before this was shared, a prose-plus-options reply
     * rendered no buttons at all.
     * @param {string} text
     * @returns {string}
     */
    function replaceChoices(text) {
      return String(text || '').replace(/<choices?>([\s\S]*?)<\/choices?>/gi, function (_, content) {
        // Split into option lines. Newlines are the normal separator, but they
        // are not guaranteed: the decorator feeds this `innerText`, and when
        // DSH renders the whole block inside a single <p>, innerText collapses
        // those lines into spaces ("<choices> A. 搭话 B. 离开 </choices>"),
        // which yielded a single button. So also break before an option marker
        // that follows a space: `A. `/`B、`/`1)`/`- ` etc.
        var split = content
          .replace(/\r/g, '')
          // Break before any line-leading option marker, mirroring the marker
          // set used to strip prefixes below (`A、` `a)` `1.` `一、` …).
          // The separator is `[:：.．、)）]` possibly followed by a space; a
          // marker like `A、搭话` has nothing after the punctuation, so
          // requiring whitespace there failed to split it at all.
          .replace(/\s+(?=[A-Ha-h1-9一二三四五六七八九]\s*[、.．:：)）])/g, '\n')
          .replace(/\s+(?=[•·])\s*/g, '\n')
        var lines = split.split('\n').map(function (s) { return s.replace(/^[•·\-\*\s]+/, '').trim() }).filter(Boolean)
        var opts = []
        for (var li = 0; li < lines.length; li++) {
          var ln = lines[li]
          // 去掉 A、/ A./ 1、/ 1. 等前缀，只留选项文本（支持 A-H 与 1-9，避免第 5 个选项露出编号）
          var clean = ln.replace(/^[A-Ha-h1-9一二三四五六七八九][、.．:：)\s]\s*/i, '').trim()
          if (!clean) continue
          // 跳过非选项行（如"请选择"、"选项："）
          if (/^(请选择|选项|行动|选择|接下来)/.test(clean)) continue
          opts.push(clean)
        }
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
     * @param {string} text
     * @returns {string}
     */
    function renderFencedHtml(text) {
      if (!text || text.indexOf('```') === -1) return text
      return String(text).replace(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g, function (whole, body) {
        const head = String(body).replace(/^\s+/, '').slice(0, 40).toLowerCase()
        const isDoc = head.startsWith('<!doctype') || head.startsWith('<html')
        if (!isDoc) return whole
        const id = 'muv-cardhtml-' + Math.random().toString(36).slice(2, 8)
        return '<div class="muv-statusbar-wrap"><iframe id="' + id + '" class="muv-iframe" srcdoc="' +
          escAttr(body) + '" sandbox="' + MUV_CARD_SANDBOX +
          '" style="width:100%;height:600px;border:none;border-radius:8px;background:transparent"></iframe></div>'
      })
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
     * 单独抽成函数是为了能被测试直接跑——它是纯字符串变换，回归测试可以从本文件
     * 取源码执行（见 test-client-render.mjs）。
     * @param {string} text
     * @returns {string}
     */
    function renderMediaTags(text) {
      if (!text) return text
      return String(text)
        .replace(/<audio\b([^>]*)>([\s\S]*?)<\/audio>/gi, function (m, attrs, inner) {
          if (!/\bsrc\s*=/i.test(attrs)) return '<div class="muv-audio">🎵 ' + escHtmlBasic(String(inner).trim()) + '</div>'
          var extra = /\bcontrols\b/i.test(attrs) ? '' : ' controls'
          return '<audio class="muv-media"' + extra + ' preload="metadata"' + attrs + '>' + inner + '</audio>'
        })
        .replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, function (m, attrs, inner) {
          if (!/\bsrc\s*=/i.test(attrs)) return '<div class="muv-audio">🎬 ' + escHtmlBasic(String(inner).trim()) + '</div>'
          var extra = /\bcontrols\b/i.test(attrs) ? '' : ' controls'
          return '<video class="muv-media"' + extra + ' preload="metadata"' + attrs + '>' + inner + '</video>'
        })
    }

    /**
     * Sandbox 属性：承载角色卡自带 HTML 时用。
     *
     * 为什么需要 `allow-same-origin`：只给 `allow-scripts` 会让文档拿到一个
     * **不透明来源（opaque origin）**。那更安全，但恰好会打断本插件存在的意义——
     * 社区卡的状态栏 HTML 会以 ES module 从 CDN 拉 Vue/Pinia（jsdelivr），并读写
     * `localStorage`；不透明来源下 `localStorage` 直接抛异常、模块加载也可能失败。
     *
     * 安全含义必须说清楚：`allow-scripts` 与 `allow-same-origin` **同时**给出，
     * 等价于让卡里的 JavaScript 以「本站一等公民」的身份运行——它能碰到父文档、
     * 读写本来源的 cookie 与 storage。这是一次真实的信任决策：**卡是第三方代码**。
     *
     * 之所以默认开启：SillyTavern 对卡的 HTML/JS **完全不做沙箱**，而本插件的目标
     * 就是让这些卡在 DSH 里跑起来。开了 `allow-same-origin` 之后仍比 ST 更严
     * （禁顶层跳转、禁表单提交、禁弹窗），但对卡而言能力已等价。
     * 不信任某张卡时，把这里改回 `'allow-scripts'` 即可（状态栏的**结构化**渲染
     * 不走 iframe，不受影响）。
     * @type {string}
     */
    var MUV_CARD_SANDBOX = 'allow-scripts allow-same-origin'

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
            if (!sbHtml && /<StatusPlaceHolderImpl\s*\/>/i.test(result)) sbHtml = buildDefaultStatusBar(normalized)
            if (sbHtml) {
              ensureStatusCss()
              const builtin = /^\s*<div class="muv-sb"/.test(sbHtml)
              const id = 'muv-statusbar-' + Math.random().toString(36).slice(2, 8)
              const frame = builtin
                ? sbHtml
                : '<iframe id="' + id + '" class="muv-iframe" srcdoc="' + escAttr(sbHtml) + '" sandbox="' + MUV_CARD_SANDBOX + '" style="width:100%;height:600px;border:none;border-radius:8px;background:transparent"></iframe>'
              result = result.replace(/<StatusPlaceHolderImpl\s*\/>/gi,
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
        if (/<StatusPlaceHolderImpl\s*\/>/i.test(normalized)) {
          const sb = buildDefaultStatusBar(normalized)
          if (sb) { ensureStatusCss(); return renderFencedHtml(normalized.replace(/<StatusPlaceHolderImpl\s*\/>/gi, '<div class="muv-statusbar-wrap">' + sb + '</div>')) }
        }
        // 没有卡片数据也要能出状态栏：级联不依赖卡片，只要能解析出结构
        const cascaded = await cascadeStatusBlock(normalized, null)
        if (cascaded !== normalized) return renderFencedHtml(cascaded)
      } catch (_) {}

      // 即使没渲染出任何卡片，也把折叠好的表头交回去：模型拆行的问题不值得
      // 让用户看到散落的『 』。
      //
      // 但 <choices> 必须在这里落地：纯剧情 + 选项的回复没有 <Status_block>，
      // 级联不会碰它，若原样返回，选项就永远不渲染（静默失败）。
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
        const id = 'muv-statusbar-' + Math.random().toString(36).slice(2, 8)
        // The card's own HTML is a self-contained document (styles + markup), so
        // it goes into a sandboxed iframe; our structural renders are inline.
        const isCardHtml = d.stage === 'card'
        const frame = isCardHtml
          ? '<iframe id="' + id + '" class="muv-iframe" srcdoc="' + escAttr(d.html) + '" sandbox="' + MUV_CARD_SANDBOX + '" style="width:100%;height:600px;border:none;border-radius:8px;background:transparent"></iframe>'
          : d.html
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
        '.muv-char-name{display:inline-block;font-weight:700;color:#ffdd99}.muv-audio{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(122,184,255,.06);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}'+
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
            btn.innerHTML = '<span class="muv-choice-letter">'+String.fromCharCode(65+idx)+'</span>'+text
            box.appendChild(btn)
          })(opts[i], i)
        }
        return box
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
        try { muvCleanText(md); muvRenderOpts(md); muvStyleTavernOpts(md) } catch(e) { console.error('[muv-engine sanitize]', e) }
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
        var STATUS_WRAP_RE = /<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/

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
        function applyDecoratedHtml(body, html, raw) {
          var cardMatch = html.match(STATUS_WRAP_RE)
          // No card in the output (the card regexes changed the text but the
          // cascade produced nothing): fall back to the whole-body swap.
          if (!cardMatch) { body.innerHTML = html; return }

          var open = findTextRange(body, STATUS_OPEN_RE)
          if (!open) { body.innerHTML = html; return }
          // Search for the closing tag *after* the opening one.
          var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
          var full = ''
          var n
          while ((n = walker.nextNode())) full += n.nodeValue || ''
          var afterOpen = full.slice(open.start)
          var cm = STATUS_CLOSE_RE.exec(afterOpen)
          if (!cm) {
            // Unterminated block (still streaming, or the model dropped the tag):
            // replace only the opening tag itself, keep everything else.
            cm = null
          }

          try {
            var range = document.createRange()
            range.setStart(open.node, open.offset)
            if (cm) {
              var closeStart = open.start + cm.index
              var closeEnd = closeStart + cm[0].length
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
              var b = loc(closeEnd)
              if (!b) { body.innerHTML = html; return }
              range.setEnd(b.node, b.offset)
            } else {
              range.setEnd(open.node, open.offset + (open.endOffset - open.offset))
            }
            range.deleteContents()
            var holder = document.createElement('div')
            holder.className = 'muv-statusbar-hit'
            holder.innerHTML = cardMatch[0]
            range.insertNode(holder)
          } catch (_) {
            // Range surgery is best-effort; a structural surprise must not blank
            // the message, so fall back to the full swap.
            body.innerHTML = html
          }
        }

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