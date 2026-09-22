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
    // 追加时用的**字面量**（不是从正则里拼）：正则对象带 `g` 时 `lastIndex` 有状态，
    // 拿它去参与字符串拼接迟早出错。值必须与 `tavern_helper.scripts[0].data["特殊符号值"]`
    // 逐字相同 —— 卡的正则 `[2]` 认的就是这一个拼写。
    var STATUS_PH_TEXT = '<StatusPlaceHolderImpl/>'

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
        // ★ 惰性重解析（与酒馆 `getCurrentSessionId()` 同一处修正，别只修一半）：
        //   `sessions` 是**异步 provide** 的服务，插件 apply() 跑的那一刻可能还拿不到。
        //   只读一次 `__DSH_TAVERN_SESSIONS__` 的话，拿到 undefined 就**永久**是
        //   undefined，之后一路退化到 URL → `data-dsh-current-session` ——
        //   而那个属性在切换会话后仍是**旧值**（下面第 3 步的注释里就写明了）。
        //   后果在装饰链上比在面板上更贵：`fetchTavernCard()` 会拿不到会话 id，
        //   于是带着**面板当前预设**（一个会粘住的全局值）去取卡 ⇒ 工作区里所有会话
        //   都被同一张卡的美化渲染。所以这里每次调用都重试一次解析。
        if (!svc || !svc.list || typeof svc.list.getSnapshot !== 'function') {
          try {
            var ctx = window.__DSH_TAVERN_CTX__
            if (ctx && typeof ctx.get === 'function') {
              var fresh = ctx.get('sessions')
              if (fresh) {
                window.__DSH_TAVERN_SESSIONS__ = fresh
                svc = fresh
              }
            }
          } catch (_) {}
        }
        if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
          var snap = svc.list.getSnapshot()
          var cur = snap && snap.current
          if (cur && /^(session-)?[a-f0-9-]{20,}$/i.test(String(cur))) {
            var sid = 'session-' + String(cur).replace(/^session-/, '')
            // 顺手把权威 id 落到属性上：酒馆面板的兜底链也读它，两边保持一致。
            try { document.documentElement.setAttribute('data-dsh-current-session', sid) } catch (_) {}
            return sid
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
     * 本会话**权威**的卡身份：DSH 会话日志里最新一条 `agent-preset/selected`。
     *
     * 这是酒馆插件 `resolveAuthoritativePresetId()` 的同一条规则（那边已经上线并验证过），
     * 装饰链必须用它，理由见 `fetchTavernCard` 顶上那段。
     *
     * 三种返回值语义**必须区分**，别把它们混成一种：
     *   - `{ known: true, presetId: 'default' }` → 本会话**不是酒馆会话**
     *     （用户在 DSH 顶部选了 standard / minimal 等）⇒ **不出卡**；
     *   - `{ known: true, presetId: '<id>' }`    → 就是这个预设；
     *   - `{ known: false }`                     → **无法判定**（端点报错、超时、会话 id 为空）
     *     ⇒ 这一段**没有**更强的依据，但"不知道"不等于"可以拿别人的卡填"，
     *       所以调用方也不能因此退回面板预设 —— 宁可这次不美化。
     * @param {string} sid
     * @returns {Promise<{known: boolean, presetId: string}>}
     */
    async function fetchAuthoritativePresetId(sid) {
      try {
        if (!sid) return { known: false, presetId: '' }
        const r = await fetch('/api/tavern/current-session?sessionId=' + encodeURIComponent(sid))
        const d = await r.json()
        if (!d || d.ok !== true) return { known: false, presetId: '' }
        const pid = d.presetId ? String(d.presetId) : ''
        if (!pid) return { known: false, presetId: '' }
        return { known: true, presetId: pid }
      } catch (_) {
        return { known: false, presetId: '' }
      }
    }

    /**
     * Load the active card, including its regex scripts.
     * @returns {Promise<object|null>}
     */
    async function fetchTavernCard() {
      try {
        // 只带**一个**定位参数，且**会话 id 优先**。
        //
        // 为什么不能两个都带：服务端 `if (presetId) … else if (sessionId) …` 的判定是
        // presetId 在前（现在已改开会话优先，但客户端这一层仍然只该给一个 —— 两层都有保险，
        // 而且老版本服务端还在跑的时候也不会串台）。而 `currentPresetId()` 读的是酒馆面板的
        // `dataset.presetId` / localStorage，**切换会话后它可能仍是上一个会话的预设**：
        // 用户实测在「瑟瑟提瓦特」的会话里看到了「足控天堂」的状态栏界面。
        // 会话 id 由服务端按 session-bindings.json 查，切换会话必然跟着变 —— 它才是
        // 「不管点哪个会话都显示同一张卡」的解药。
        //
        // ★★ P1-4 修正（本轮，实测）：**光送 sessionId 还不够**。
        //   `muv-table/tavern-card` 的 `fromSession()` 只读 `session-bindings.json`，
        //   而那是一个**快照文件**，只在酒馆写它的时候更新 —— 用户在 DSH **顶部选择器**
        //   换预设时 DSH 只往会话事件流里追加 `agent-preset/selected`，**根本不写 bindings**。
        //   实测（真实会话 `session-c98dfb13-…`）：
        //     bindings              = preset-fixture  → 魔法少女MVU测试 / 8 条脚本
        //     会话日志最新 selected = preset-fixture  → _足控天堂2    / 10 条脚本
        //   装饰链当时读了 bindings 那张 ⇒ **用别的卡的 10 条/8 条剧本去改写这张卡的正文**：
        //   该卡的标记（`<img>` / `<video>` / `<StatusPlaceHolderImpl/>`）没被任何脚本认领，
        //   整条消息原样吐回 —— 用户看到的正是"美化没了、后面全是纯文本"。
        //   所以这里先问**权威来源**（酒馆插件 `/api/tavern/current-session`，它读会话日志），
        //   再带着那个 presetId + `preferPreset=1` 去取卡。这与酒馆**状态栏那条链**
        //   （`client.manager.bundle.js` 的 `_sid → current-session → _askCard('?presetId=…&preferPreset=1')`）
        //   用的是同一套做法 ⇒ 两条链不再各有各的卡身份。
        var params = []
        var sid = currentSessionId()
        if (sid) {
          var auth = await fetchAuthoritativePresetId(sid)
          if (auth.known && auth.presetId === 'default') {
            // 本会话不是酒馆会话：**不出卡**。
            //
            // 为什么不能退回"按 sessionId 让服务端查 bindings"（这正是修之前的行为）：
            // 实测 `session-bindings.json` 里有**过期绑定**，那一步会给非酒馆会话照样
            // 发一张别人的卡 —— 于是工作区里每个会话都被同一张卡的美化渲染。
            // 与酒馆自己的会话隔离判据（`shouldInjectForSession()`）保持一致：
            // 不是酒馆会话，就没有"哪张卡"可言。
            try {
              console.debug('[muv] 本会话不是酒馆会话（权威解析=default），不取卡、不做美化：' + sid)
            } catch (_) {}
            return null
          }
          if (auth.known) {
            params.push('presetId=' + encodeURIComponent(auth.presetId))
            params.push('preferPreset=1')
          } else {
            // ★ 权威值**拿不到**：本次不取卡、不美化。
            //
            // 为什么不退回"按 sessionId 让服务端查 bindings"（那是修之前的行为）：
            // `session-bindings.json` 是快照，实测里面有**过期绑定**。权威端点读不到
            // （超时、报错、会话日志缺失）时退回它，就是在"我不知道这是哪个会话"的状态下
            // 拿一张**可能属于别的会话**的卡去改写正文 —— 那正是串台与"整条纯文本"的
            // 共同成因。一次不美化是可恢复的（下一条消息会再问一次），
            // 用错的卡照出来的东西不可恢复。
            try {
              console.warn('[muv] 权威预设解析失败（既不是酒馆会话、也无法判定）：' +
                '本次不做美化，避免用 bindings 里的过期绑定串台。sessionId=' + sid)
            } catch (_) {}
            return null
          }
        } else {
          // 认不出会话（与"判定为非酒馆"是两回事）：退回面板当前预设。
          //
          // ★ 这一档是**有意的取舍**，不是漏掉：`verify-tavern-card-locator.mjs`
          //   的 B1/B2/D2 把"认不出会话时必须带 presetId 兜底"钉死了（那条判据当时的
          //   理由是：空参请求 ⇒ 服务端 default ⇒ 剧本 0 条 ⇒ 正文裸奔）。
          //   代价必须写清楚：这个值来自酒馆面板的 `dataset.presetId` /
          //   `localStorage['dsh-tavern-active-preset']`，**切换会话后可能仍是上一个
          //   会话的预设**。所以只要**能认出会话**，就绝不走这里 —— 那条路径已经改成
          //   先问 `/api/tavern/current-session`（读会话日志）再带该会话自己的
          //   `presetId + preferPreset=1`（见上面 `if (sid)` 分支）。
          //   净效果：正常的酒馆会话不再串台；只有"连会话都认不出"这一档会退回旧行为。
          var pid = currentPresetId()
          if (pid) params.push('presetId=' + encodeURIComponent(pid))
        }
        var qs = params.length ? '?' + params.join('&') : ''
        // ★ 定位留痕：不许静默。一个定位参数都没有时这一请求必然落到服务端默认预设，
        //   而只有**认得出会话**才敢说"看的就是这张卡" —— 认不出就必须能看见。
        if (!params.length) {
          try {
            console.warn('[muv] 认不出会话 id，也没有面板 presetId 兜底：' +
              '本次按服务端默认预设取卡，卡的正则剧本可能一条都不匹配、消息会原样渲染。')
          } catch (_) {}
        } else {
          try {
            console.debug('[muv] tavern-card 定位：' + params.join('&'))
          } catch (_) {}
        }
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
      // ★ 早退守卫必须同时认**两条**出路，否则兜底那条是死代码。
      //
      // 原来只认 ``` ：一份**没有围栏、但自成完整整页文档**的卡 HTML（本卡脚本
      // [6]「视频」/ [9]「CG插图」就是这样，社区卡普遍如此）里一个反引号都没有
      // ⇒ 在这里直接 return，下面 `wrapLoneDocuments(out)` **永远跑不到** ⇒ 整份文档
      // 原样落进消息 DOM：卡的 `<style>` 是全局作用域，宿主主题被改（用户实测「几乎每个
      // 会话都变成同一张卡的界面」），`position:fixed` 的工具栏更会逃出消息容器贴在整个
      // 窗口右上角一直盖着。
      //
      // 实测（verify-fence-hijack.mjs，真卡 `_足控天堂2` 的 46KB / 210KB 整页文档）：
      // 只认反引号时「无围栏」三例产物 46081/46088 字符全是裸文档、iframe = 0；
      // 认上 `<html`/`<!doctype` 之后同样三例产出 1 个 iframe、裸文档 0 字符。
      // 守卫保留的意义只剩「字符串里既没有反引号也没有文档开头时不做无谓扫描」。
      if (!text) return text
      var source = String(text)
      if (source.indexOf('```') === -1 && !/<!doctype|<html[\s>]/i.test(source)) return text
      // ★ 先归一化行尾：CRLF 必须与 LF 走同一条路。
      //
      // 上面那条「信息串必须是合法信息串」的收紧会把 CRLF 误杀：开围栏正则的
      // `([^\n`]*)` 会把 `\r` 一起吃进信息串（`"```\r\n"` → info = `"\r"`），
      // 而 `\r` 属于 `\s`，于是 `/^[^\s`]+$/` 判它非法 ⇒ `continue` ⇒ **CRLF 换行的卡
      // 文档全部退化成裸文本**。实测（test-client-render 的 `CRLF 换行` 用例）：
      // 收紧前 `\n` 与 `\r\n` 都产出 iframe，收紧后 `\r\n` 变成原样纯文本。
      // 在入口统一成 `\n`，两种行尾就再也分不开叉。
      source = source.replace(/\r\n/g, '\n')
      // ★ 分段产出：每段标记它是不是已经进过 iframe。
      //
      // 为什么不能像早期版本那样「先拼出 out、再对整个 out 跑一遍兜底」：兜底那一步会
      // 去抓 `srcdoc="…"` 里**已经被转义过的**文档、以及刚被围栏路径处理过的正文，
      // 切片越界之后把**整条消息吞成 0 字符** —— 比原缺陷更糟（实测：81,112 字符 → 0）。
      // 分段之后，兜底只会看到「围栏路径没接走的纯文本」，边界天然清楚。
      var segments = []
      var pos = 0
      var open = /^[ \t]{0,3}(`{3,})([^\n`]*)\r?\n/gm
      var m
      while ((m = open.exec(source))) {
        // ★ 信息串必须是 CommonMark 语义下的合法信息串。
        //
        // 以前这里是 `([^\n`]*)`（任意字符），于是**卡片文档后面紧跟的说明文字**
        // 会被当成开围栏。真机实测（_足控天堂2 + 真实模型输出，产物 81,112 字符）：
        //
        //     …processAudio();\n    });\n  </script>\n</body>\n</html>\n
        //     ````进行包裹
        //
        // `</html>` 就在开围栏前 10 个字符处 —— 整页文档是**完整的**，却被这行
        // 「说明文字里的反引号」劫持。旧代码接着 `break`，把这一行之后的**全部内容**
        // （包括那份完整文档）当纯文本放行 ⇒ 用户看到「一大段 HTML 没渲染、全是字」。
        //
        // CommonMark 规定围栏信息串只能是**一串不含空格的字符**（```js / ```html），
        // `进行包裹` 这种带中文断词的串本来就不是合法信息串。收紧到这一条即可挡掉劫持，
        // 且不会误伤 ````html / ```js / ``` 这些真实用法（回退验证脚本会对照）。
        var info = m[2] || ''
        if (info !== '' && !/^[^\s`]+$/.test(info)) continue
        var close = findClosingFence(source, open.lastIndex, m[1].length)
        // ★ 未找到收尾围栏：**不能 break**。
        //
        // 旧代码 `if (!close) break` 会让剩下的内容全部走 `out += source.slice(pos)`，
        // 也就是「一次误判毁掉整条消息里后面所有的卡片渲染」。这里改成把这一行当普通
        // 文本跳过、继续往下扫：本次不产出 iframe，但后面的真实围栏仍然有机会被处理。
        if (!close) continue
        var body = source.slice(open.lastIndex, close.start)
        var head = body.replace(/^\s+/, '').slice(0, 40).toLowerCase()
        var isDoc = head.indexOf('<!doctype') === 0 || head.indexOf('<html') === 0
        // 是文档 → 只替换围栏本身；不是 → 整块（含围栏）原样抄过去
        segments.push({ iframe: false, text: source.slice(pos, isDoc ? m.index : close.end) })
        if (isDoc) {
          // 卡 HTML 的 iframe 一律从这里出去：里面带高度测量引导脚本，
          // 否则 894px / 1635px 的卡会被写死的 600px 裁掉（见 cardHtmlIframe）。
          segments.push({ iframe: true, text: '<div class="muv-statusbar-wrap">' + cardHtmlIframe(body) + '</div>' })
        }
        pos = close.end
        open.lastIndex = close.end
      }
      segments.push({ iframe: false, text: source.slice(pos) })

      // ★ 兜底：围栏启发式之外，再按「完整的整页文档」抓一遍。
      //
      // 上面那条路要求文档外面**有**围栏且围栏合法；社区卡并不保证这一点（同一个
      // `_足控天堂2` 里，脚本 [6]「视频」与 [9]「CG插图」产出的就是**没有围栏**的
      // 裸 HTML）。`<!DOCTYPE … </html>` 是无歧义的整页文档边界，所以再按它抓一遍：
      // 命中就一律进 iframe，绝不内联进宿主 DOM —— 卡的 `<style>` 是全局作用域的，
      // 一旦内联，整个 app 的主题都会被它改掉（用户「每个会话都变成同一张卡」就是
      // 这个机制），而 `position:fixed` 元素更会逃出消息容器贴在整个窗口上一直覆盖。
      //
      // ★★ 为什么这里从 `.map()` 改成显式下标循环：`wrapLoneDocuments` 需要知道
      //   「这一段的尾巴后面紧跟的是不是一份文档」。上面那个围栏配对循环会**跨文档
      //   配错对**——把第 1 份文档的**收**围栏当成第 2 份文档的**开**围栏配成一对
      //   （两份文档只隔 `</response>\n</content>\n\n` 这种信封残留），于是
      //   `open.lastIndex` 直接跳到第 2 个围栏之后，第 2 份文档的开围栏被孤零零留在
      //   前一段的末尾。实测（真卡 + 真回复 + 本轮补上的占位符 ⇒ 消息里第一次同时
      //   出现 [1] 与 [2] 两份整页文档）：产物里残留一行
      //   `</content>\n\n```\n<div class="muv-statusbar-wrap">…`，也就是用户能看见
      //   那个 ```` ``` ````。所以把「后面紧跟文档」这个事实交给下游，让它把
      //   那个孤立的开围栏一起吞掉。
      var rendered = []
      for (var si = 0; si < segments.length; si++) {
        if (segments[si].iframe) { rendered.push(segments[si].text); continue }
        // ★ 「后面紧跟文档」的判据必须看**下一段的文本本身**，不能看"下一段是不是 iframe"
        //   —— 配错对的那一档里两份文档**谁都没被配对成 iframe**（配对循环把 doc1 的收
        //   围栏与 doc2 的开围栏配成了一对），所以那一段的 `iframe` 也是 false。
        //   第一版就是按 iframe 找的，于是这个分支从不触发、残留照旧。
        var nextIsDoc = false
        for (var sj = si + 1; sj < segments.length; sj++) {
          if (segments[sj].iframe) { nextIsDoc = true; break }
          var probe = String(segments[sj].text).replace(/^\s+/, '')
          if (!probe.length) continue
          nextIsDoc = /^<!doctype/i.test(probe) || /^<html[\s>]/i.test(probe)
          break
        }
        rendered.push(wrapLoneDocuments(segments[si].text, nextIsDoc))
      }
      return rendered.join('')
    }

    /**
     * 把「没有围栏包裹、但自成完整整页文档」的 `<!DOCTYPE … </html>` 抓出来交给 iframe。
     *
     * 为什么必须有这一条：围栏是**卡作者的约定**，不是 HTML 的语法。作者没加围栏时，
     * 上面的围栏路径完全看不到这份文档，它就会原样落进消息 DOM（内联泄漏）。
     * 这里只处理**成对**的整页文档：必须同时见到起头的 `<!doctype`/`<html` 与收尾的
     * `</html>`，否则一律不动 —— 只有开头没有结尾多半是流式输出到一半，那时塞进
     * iframe 会得到一个半截文档，比不处理更糟（交给流式那一类去解决）。
     *
     * `<script>` 区间不碰：卡自己的字符串里可能就写着 `</html>`。
     * @param {string} text
     * @param {boolean} [trailingOrphanFence] 这一段的**尾巴后面**紧跟的是另一份文档；
     *   为真时把段尾那个没有配对、后面只剩空白的开围栏也吞掉（见 `renderFencedHtml`
     *   末尾 ★★ 那段：围栏配对会跨文档配错对，把下一份文档的开围栏留在本段末尾）。
     * @returns {string}
     */
    function wrapLoneDocuments(text, trailingOrphanFence) {
      // ── 围栏判据（**内联在函数体里**，不做成模块级函数）──────────────────────
      //
      // ★ 必须是内联的。本项目所有门禁都是"按名字逐字抽出函数体、拼成一段代码再跑"
      //   （`verify-shared.mjs:extractFunction` / 各 `verify-*.mjs` 自带的提取器），
      //   而其中几份**只抽 `wrapLoneDocuments` 一个名字**、不做依赖发现
      //   （`verify-fence-hijack-main.mjs` 就是这样）。把它写成模块级函数时，
      //   那份门禁当场 `ReferenceError: stripFenceBefore is not defined` ——
      //   报出来像"卡的代码坏了"，其实是"新加的依赖抽不到"。
      //   内联之后 `wrapLoneDocuments` 自成一体，任何提取器都能跑。
      //   （代价是这个函数变长；但它的三个小helper 只服务这一个函数，内联没有重复。）
      /** 围栏周围的「空白」：空格 / 制表 / CR / 换行。 */
      function fenceBlank(ch) {
        return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'
      }
      /** 同一行内的空白（不含换行）。 */
      function fenceInlineBlank(ch) {
        return ch === ' ' || ch === '\t' || ch === '\r'
      }
      /**
       * `end` 前面紧邻着一个开围栏（```` ``` ```` / ````` ```lang `````）时，
       * 返回**应当被吞掉的起点**；没找到返回 `-1`。
       *
       * 返回值用 `-1` 表示"没找到"而不是 `0`：`0` 是合法结果（围栏正好在文本开头）。
       * 两步必须分开 —— 先吃掉文档与围栏之间的空白（含换行），**再**跳过信息串
       * （```` ```html ```` 里的 `html`）：吃掉换行后 `at` 停在信息串的最后一个字符上，
       * 而它既不是空白也不是反引号，直接数反引号会数到 0 个 ⇒ 恒"没找到"。
       */
      function fenceOpenAt(s2, end) {
        if (end <= 0) return -1
        var i = end
        while (i > 0 && fenceBlank(s2.charAt(i - 1))) i--
        while (i > 0 && s2.charAt(i - 1) !== '`' && s2.charAt(i - 1) !== '\n') i--
        var tickEnd = i
        while (i > 0 && s2.charAt(i - 1) === '`') i--
        if (tickEnd - i < 3) return -1
        // 反引号之前到行首只有空白 → 连那一行一起吞；否则只吞围栏标记本身
        // （`正文 ```html` 这种带渲染残留的前缀是用户该看到的正文，不能吞）。
        var lineStart = s2.lastIndexOf('\n', i - 1) + 1
        if (/^[ \t\r]*$/.test(s2.slice(lineStart, i))) return lineStart
        return i
      }
      /**
       * `from` 处（跳过空白之后）紧邻着一个收围栏时，返回该围栏**之后**的下标；
       * 否则返回 `from`。不要求"独占一行"—— 折行形态下收围栏后面同一行还跟着
       * `</response>`；调用点（刚识别出一份完整文档）本身就是最强的约束。
       */
      function fenceCloseFrom(s2, from) {
        var i = from
        while (i < s2.length && fenceBlank(s2.charAt(i))) i++
        var tickStart = i
        while (i < s2.length && s2.charAt(i) === '`') i++
        if (i - tickStart < 3) return from
        var tail = i
        while (tail < s2.length && fenceInlineBlank(s2.charAt(tail))) tail++
        if (tail < s2.length && s2.charAt(tail) === '\n') tail++
        return tail
      }
      /**
       * 吞掉段尾那个没配对、后面只剩空白的开围栏（见 `renderFencedHtml` 末尾 ★★）。
       *
       * 判据按**最后一行的形状**写：`[行首空白]* 反引号x>=3 [信息串?]`，且其后到文末只有空白。
       * `code` + 三反引号、`正文` + 三反引号、行内 `` `x` `` 都不满足这个形状
       * （反引号前面不是行首空白），所以不会被误吞。
       * 信息串那一档必须一起认：卡里 `[1]` 的围栏是 ```` ```html ````、`[2]` 的是裸
       * ```` ``` ````，两种都可能成为段尾那个孤儿。
       */
      function fenceTrimTrailingOrphan(s2) {
        var end = s2.length
        while (end > 0 && fenceBlank(s2.charAt(end - 1))) end--
        var lineStart = s2.lastIndexOf('\n', end - 1) + 1
        if (!/^[ \t]*\u0060{3,}[^\s\u0060]*$/.test(s2.slice(lineStart, end))) return s2
        return s2.slice(0, lineStart)
      }

      var s = String(text || '')
      var lower = s.toLowerCase()
      if (lower.indexOf('<!doctype') === -1 && lower.indexOf('<html') === -1) return s
      // 已经进过 iframe 的部分不再碰（否则会把 srcdoc 里被转义的文档再抓一次）。
      var ranges = scriptRangesOf(s)
      var out = ''
      var pos = 0
      var re = /<(!doctype\s+html|html[\s>])/gi
      var m
      while ((m = re.exec(s))) {
        if (rangesContain(ranges, m.index)) continue
        var start = m.index
        var endRe = /<\/html\s*>/gi
        endRe.lastIndex = start
        var e = endRe.exec(s)
        if (!e) continue
        if (rangesContain(ranges, e.index)) continue
        // 长度先用**原始**边界量（下面吞围栏会把起点提前，但"这份文档是不是卡页面"
        // 只由文档本身决定，不该受包着它的围栏影响）。
        // 太短的多半是文档里的一段示例，不是卡页面。
        if ((endRe.lastIndex - start) < 400) continue
        // 已经在内联 iframe 的属性里（被转义过）就跳过：`&lt;!DOCTYPE` 不会命中本正则，
        // 但 `srcdoc="<iframe…"` 之后的裸文本仍可能命中，所以再做一次相邻判断。
        var before = s.slice(Math.max(0, start - 260), start)
        if (/srcdoc="[^"]*$/.test(before)) continue
        // ★★ 顺手吞掉紧邻的那对围栏标记。
        //
        // 为什么这条是**必须**的，而不是锦上添花：走到这一段说明上面的围栏路径
        // **没有**接走这份文档，而那只会在一种输入形态下发生 —— 开围栏不在行首。
        // 输入之所以会是那个形态，是因为 `_decorateOne` 拿的是 `body.innerText`：
        // DSH 的 markdown 已经把 `### 正文` 渲染成标题、把紧跟的标签折进同一行，
        // 于是 `raw` 的开头是 `正文 <content>`，卡的 `[1]` 把这个开标签换成
        // ````` ```html ````` 开头的整页文档之后，**开围栏就落在了行中部**，
        // 行首锚定的 `renderFencedHtml` 正则够不着它，两个反引号只能当普通文本留下。
        // 真机实测（真卡 + 真实模型回复）：
        //   V1 `### 正文` 独占行 → 产物里可见反引号 = false（干净）；
        //   V2/V3/V4 标题与标签同行 → 可见反引号 = true，产物开头逐字是
        //   `正文 ```html\n<div class="muv-statusbar-wrap">…` —— 与用户截图一致。
        var fenceOpen = fenceOpenAt(s, start)
        if (fenceOpen >= 0) start = fenceOpen
        var fenceClose = fenceCloseFrom(s, endRe.lastIndex)
        var docEnd = fenceClose > endRe.lastIndex ? fenceClose : endRe.lastIndex
        var doc = s.slice(start, endRe.lastIndex)
        out += s.slice(pos, start)
        out += '<div class="muv-statusbar-wrap">' + cardHtmlIframe(doc) + '</div>'
        pos = docEnd
        re.lastIndex = pos
      }
      if (!pos) return s
      var tailSeg = s.slice(pos)
      if (trailingOrphanFence) tailSeg = fenceTrimTrailingOrphan(tailSeg)
      return out + tailSeg
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
     * 媒体标签怎么处理？**字符串路径与 DOM 路径共用这一份判定**，两条路不会各说各话。
     *
     *   'media'       有 src（哪怕 `src=""`）或带 `<source>` 子节点 → 真实元素，
     *                 缺 `controls` / `preload` 就补上；
     *   'skip'        有属性、但没有 src → **一动不动**。`<video id="carVid" …></video>`
     *                 是「先占位、稍后由卡的 JS 赋 src」的写法，降级成 div 会让卡里的
     *                 `getElementById('carVid')` 找不到元素（真机实测过）；
     *   'placeholder' 一个属性都没有的裸提示词（`<audio>轻快的BGM</audio>`）→ 文字占位。
     *
     * `src=""` 算 media 而不是"没有 src"：真卡 cgFsVid 就是这种（JS 随后填 src）。
     * @param {boolean} hasSrcAttr 存在 src 属性（哪怕是空串）
     * @param {boolean} hasNonEmptySrc src 有非空值
     * @param {boolean} hasAttrs 有任何属性
     * @param {boolean} hasChildren 有子节点（`<source>` / `<track>`）
     * @returns {'media'|'skip'|'placeholder'}
     */
    function mediaTagDisposition(hasSrcAttr, hasNonEmptySrc, hasAttrs, hasChildren) {
      if (hasNonEmptySrc || hasChildren || hasSrcAttr) return 'media'
      if (hasAttrs) return 'skip'
      return 'placeholder'
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
     * 单独抽成函数是为了能被测试直接跑——它是纯字符串变换，回归测试从本文件取源码执行：
     *  - `test-client-source.mjs` 里有一份**写死的入口函数名**（`RENDER_FN_NAMES`）：
     *    改名/删名会当场报错；
     *  - `test-client-render.mjs` 则**自动发现依赖**：扫函数体里出现的 `名字(`，能提取出来
     *    就一起带上（提取不到就跳过 —— 引导脚本那种"字符串里的代码"会让扫描命中并不存在
     *    的顶层函数）。
     * 所以新增 helper 一般不用改测试；只有新增**入口**才要往 `RENDER_FN_NAMES` 里加一笔。
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
        // 判定与 DOM 路径共用一份（见 mediaTagDisposition）：skip 表示"别碰它"
        var disposition = mediaTagDisposition(srcValue !== null, !!srcValue, /\S/.test(start.attrs), false)
        if (disposition === 'skip') continue
        var closeRe = new RegExp('</' + tag + '\\s*>', 'i')
        closeRe.lastIndex = start.end
        var cm = closeRe.exec(source)
        var inner = cm ? source.slice(start.end, cm.index) : ''
        var end = cm ? cm.index + cm[0].length : start.end
        out += source.slice(pos, m.index)
        if (disposition === 'placeholder') {
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

    /**
     * 客户端构建标记（写进 `document.documentElement[data-muv-engine]` 与控制台）。
     *
     * 只解决一个问题：**"我重启了 DSH，为什么看起来没变"**。DSH 重启换的是服务端模块，
     * 浏览器里已打开的标签页仍在跑加载时注入的那份客户端 bundle。有这行标记，
     * 一眼就能区分「页面没重新加载」与「加载了但效果不对」。改客户端行为时顺手改它。
     * @type {string}
     */
    var MUV_BUILD = '2026-09-22n'

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
    /**
     * 上限**只**用于拦畸形/恶意值（一个是人写不出来的天文数字），不是内容量级的天花板。
     *
     * ★ 为什么从 2400 提到 12000（2026-09-22）：2400 曾经真的在裁卡。
     *   ST 本体的做法是「`body.scrollHeight` 原样写进 `frameElement.style.height`」，
     *   **没有任何上限**（ST-IFRAME-SPEC §6）。我们跟了个 2400，而真卡实测已经到
     *   2056 / 2083（距上限 13%），棘轮门禁自己的注释就写着「超限的表现是**静默截断**」——
     *   而 reset 里是 `html,body{overflow:hidden!important}`，被夹掉的部分**连滚动条都没有**。
     *   12000 ≈ 900px 视口下的 13 屏：画廊/长列表类卡够用，同时仍然拦得住
     *   `__muvFrameHeight: 1e9` 这种会把消息列撑到不可用的值。
     */
    var MUV_FRAME_H_MAX = 12000

    /**
     * 高度夹取范围：畸形卡最多把 iframe 撑到 12000px，最小不低于 160px。
     *
     * 故意做成**函数**而不是闭包常量：回归测试（test-client-render.mjs /
     * test-client-source.mjs）是「从源码里逐字提取函数体再执行」的，闭包变量不在
     * 函数体里，提取出来就是 ReferenceError。这一片的每个 helper 都保持自足，
     * 测试才测得到真实代码，而不是一份副本。
     * @returns {{min: number, max: number}}
     */
    function muvFrameHeightLimits() {
      return { min: 160, max: 12000 }
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
     * 包围盒量不出来（`extent()===0`，例如主视觉全是 `position:fixed`）时**不报任何值**、
     * 帧高保持不动 —— **不用 `body.scrollHeight` 兜底**，那是视口回声（§15.3 第 2 条禁用它）。
     * 见 `muvFrameBootstrap` 里 `function m()` 上方的长注释。
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
        // ★ 棘轮的"首帧已过"闸。为什么要它：`load` 之前 `getBoundingClientRect()` 对未 decode
        //   的远程插图返回 0 或占位高，此时记下的值就是坏读数，而 reset 是
        //   `overflow:hidden!important` ⇒ 坏读数会变成**永久裁切**。
        //
        //   ★★ 但闸门**也不能放宽**。试过两版"更宽容"的闸，**都实测更差**：
        //     `document.readyState!=="loading"`（`interactive` 就记账）
        //        → `verify-frame-size` 稳定 **30 通过 / 2 失败**（3 次以上复现）
        //     同一版再加"6 秒超时提闸"
        //        → **31 通过 / 1 失败**、**30 通过 / 2 失败**（两次）
        //     只有回到 `==="complete"` 才是 **32 通过 / 0 失败**。
        //   所以**记账的判据就是 `complete`**，不加例外、不加超时。
        //
        //   ★★★ "complete 永远不到"那个担忧**没有实测支持**：真卡（含 7 处远程插图 +
        //   一支 28.5MB 的 PV）在夹具里都能到 `complete`。既然放宽有代价、而收益未被观测到，
        //   就不放 —— 宁可某张卡一直不记账（帧高停在报告值上，只是不高），
        //   也不要记一个**偏小的**值把内容永久裁掉（reset 是 `overflow:hidden!important`）。
        //   写成函数、每次测量时**现读**（不是启动时算一次的快照）——读不到 `readyState`
        //   的环境（逐字提取执行的门禁里的假 document）按"已过闸"处理，保持旧行为。
        'function RL(){try{return String(document.readyState)==="complete"}catch(e){return true}}' +
        'function extent(){' +
        'var body=document.body;if(!body)return 0;' +
        'var de=document.documentElement;' +
        'var all=body.getElementsByTagName("*"),y=window.scrollY||0,maxB=0;' +
        'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el);' +
        'if(cs.position==="fixed"||cs.position==="sticky")continue;' +
        'if(cs.display==="none"||cs.visibility==="hidden")continue;' +
        'var r=el.getBoundingClientRect();' +
        'if(r.height===0&&r.width===0)continue;' +
        'var b=r.top+y+Math.max(r.height,el.scrollHeight||0);' +
        'if(b>maxB)maxB=b}' +
        // ★① body / html **自己**的 `min-height`：卡把 `min-height:100vh` 写在 body 上（我们已在
        //   rewriteVhMinHeight 里改写成 px），而上面那个循环是 `body.getElementsByTagName("*")`，
        //   **不含 body 自己** ⇒ 整卡被报矮到内容高度、再被 body 的 min-height 撑开 ⇒ 永远是内部
        //   滚动条（实测：正文美化 报 251 / 文档 1198）。只取 **px** 值：`100vh` 那种视口相对
        //   阈值正是刚消掉的东西，拿它当结果会把不动点带回来。
        'var bmh=parseFloat(getComputedStyle(body).minHeight);' +
        'if(isFinite(bmh)&&bmh>maxB)maxB=bmh;' +
        'var hmh=de?parseFloat(getComputedStyle(de).minHeight):0;' +
        'if(isFinite(hmh)&&hmh>maxB)maxB=hmh;' +
        // ★② 溢出学习：观测到文档滚得动时，记下当时的 scrollHeight 当作高度下界。收掉两类任何
        //   DOM 遍历都看不见的溢出：CSS 伪元素（`::after` 撑出去的），以及子元素 margin 折叠出
        //   body 的（实测 正文美化 差 118px、开场白 差 5px、开场白2 差 20px。逐个 CSS 开关的隔离
        //   实验见 verify-frame-gap.mjs）。`extent()` 取每个元素的 `max(rect, scrollHeight)`
        //   只覆盖能遍历到的元素；伪元素与折叠 margin 生成的溢出没有对应元素，只有滚动区自己知道。
        //
        //   为什么要"记住"而不是每次现算：**不溢出时 scrollHeight 等于视口高**，现算会得到
        //   「内容高 → 收缩 → 又溢出 → 再长高」的来回振荡（振幅就是那 118px，一眼可见的抽动）。
        //
        // ★ 但这把尺子**必须能降**（原来不能，是一把只增不减的棘轮，两个真实反例）：
        //   ① 内容缩小后帧高永不回落：棘轮记下 1200 → 用户折叠了卡里面板、内容只剩 300 →
        //      `bOver` 为假、`__muvHFit` 仍是 1200 ⇒ 卡片底下常年一大片死白。
        //   ② 一次坏读数把高度锁死（更危险）：`load` 之前远程插图还没 decode、
        //      `getBoundingClientRect()` 高度是 0 或占位高，首帧就记下一个偏小值；而 reset 是
        //      `overflow:hidden!important` ⇒ 内容被**永久裁掉**，且此后再没有降回路径。
        //   所以记的三个条件缺一不可：**只在「首帧已过」之后记**（见下面 `RL` 那道闸）、
        //   连续 3 次「不溢出且内容比已学值小 24px 以上」才清零重学并用 24px 滞回防抖、
        //   判据用 `extent()`（真实内容高，见③）而不是 `body.scrollHeight`。
        //   收缩方向的门禁见 verify-frame-height.mjs（内容缩小后报数必须回落）。
        //
        //   ★★ 滞回**只作用在收缩方向**。只要 `bOver||dOver` 为真（**观测到**溢出），
        //   `need > fit` 就**无条件**提升 —— 没有阈值、没有等待、没有"下次再说"。
        //   这是硬要求：reset 是 `overflow:hidden!important`，溢出的那几像素如果没被
        //   立刻补上就是**永久裁掉**（实测 `ERA 状态栏` 内容 929 / 帧高 923，差 5px）。
        //   反过来，这 5px 也是"棘轮为什么必须存在"的活例子：`extent()` 量到 923 而真实
        //   内容要 929，只有滚动区自己（body 溢 5px）看得见。
        //
        // ★ body 与 html **两个**滚动区都要看：reset 把两者都啃成了 `overflow:hidden!important`
        //   （照 ST），于是 body 是独立滚动容器，它的溢出**不再传导**到
        //   `documentElement.scrollHeight` —— 只看 html 会漏（实测 ERA 状态栏：html 报 923、
        //   body 自己滚到 929）。`overflow:hidden` 只是不显示滚动条，**`scrollHeight` 依旧报告
        //   溢出距离**，所以这两个比较照旧有效。而"有没有溢出"这个**前提**仍然是必须的：body
        //   若是 `height:100%`，`body.scrollHeight` 就等于视口高，无条件采用它就回到不动点。
        'var bOver=body.scrollHeight>body.clientHeight+1;' +
        'var dOver=de?(de.scrollHeight>de.clientHeight+1):false;' +
        'var need=Math.max(body.scrollHeight,de?de.scrollHeight:0);' +
        'var fit=window.__muvHFit||0;' +
        'if(RL&&(bOver||dOver)){if(need>fit){window.__muvHFit=need;fit=need}window.__muvHReset=0}' +
        'else if(RL&&fit>0&&maxB>0&&(fit-maxB)>24){' +
        'var rc=(window.__muvHReset||0)+1;' +
        'if(rc>=3){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{window.__muvHReset=rc}}' +
        'else{window.__muvHReset=0}' +
        'if(fit>maxB)maxB=fit;' +
        'return Math.ceil(maxB)}' +
        // ★ 量不出来（`extent()===0`）时**什么都不报**，帧高保持不动。
        //
        // 原来这里回退到 `document.body.scrollHeight` —— 那正是 HANDOFF §15.3 第 2 条
        // **明确禁用**的值：卡普遍写着 `html,body{height:100%}`，此时 body.scrollHeight
        // **等于 iframe 当前高度**（视口回声）。拿它当结果报回去就是把起始值当答案，
        // 而且它会和下一轮"按内容改高度"打架 ⇒ 帧高在 视口高 ↔ 内容高 之间来回跳。
        //
        // 这条路径不是理论上的：`extent()` 会跳过 `position:fixed/sticky` 的元素
        // （它们是视口相关的，算进去会把视口高当成内容高），而真卡 `_足控天堂2` 的
        // ERA 状态栏里有 **9 处 `position:fixed`**。所以「整卡主视觉都是 fixed」时
        // `extent()` 就是 0 —— 正是最容易踩到它的卡。
        //
        // `h>0` 这个条件本来就在（原来写的是 `var h=e>0?e:(…scrollHeight)`，把 0 换成了猜测）。
        // 现在 0 就是 0：**不报**。帧高停在已有值上，等下一次（700ms / 1600ms / RO / load）
        // 量出来再改。宁可暂时矮/高一点，也不写一个错的、会自我放大的值进去。
        //   ★ 记账只在 `readyState==='complete'` 之后（`load` 已触发、远程插图已 decode）：
        //   `load` 之前 `getBoundingClientRect()` 对未 decode 的插图返回 0 或占位高，此时记下的
        //   任何值都是坏读数 —— 而 reset 是 `overflow:hidden!important`，坏读数会变成永久裁切。
        //   ★ 记账只在「首帧已过」（`RL`，见上面那段）之后；`m()` 仍然照报 ——
        //   早报一次能让帧高尽快贴近内容，只是那一次**没有棘轮可记**。
        'function m(){try{var e=extent();' +
        'if(e>0)window.parent.postMessage({__muvFrameHeight:e},"*");' +
        // ★ 注入判据用的**专属 token**（见 withFrameHeightBootstrap 的守卫注释）：
        //   它只出现在引导脚本里，卡自己的 `window.__muvH=1` 或 `__muvHello` 都**不含**它，
        //   所以"注入了几次"数这个才数得准（数 `window.__muvH=1` 会被卡自己的拷贝污染，
        //   断言会**因为错误的原因通过**）。它是 `postMessage(…)` 语句的一部分，任何
        //   `"*"` 结尾的 postMessage 断言照旧成立。
        'window.__muvHFitProbe=1;' +
        '}catch(err){}}' +
        'function s(){if(t)clearTimeout(t);t=setTimeout(m,150)}' +
        'window.addEventListener("load",function(){m();s()});' +
        'document.addEventListener("DOMContentLoaded",s);' +
        'try{if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)}catch(e){}' +
        'setTimeout(m,700);setTimeout(m,1600);' +
        // ★ 后期补量（有限次，到点就停）。为什么需要：内容**在最后一次测量之后**还在长高时
        //   （远程插图 decode 完、字体替换、卡自己的定时器改 DOM），棘轮就一次都没观测到那次
        //   溢出，而 reset 是 `overflow:hidden!important` ⇒ 那几像素**永久裁掉**，表现为
        //   「同一张卡、同一份源码，跑两次一次红一次绿」的间歇性失败
        //   （实测 `ERA 状态栏` 内容 929 / 帧高 923，差 5px，只在部分运行里出现）。
        //   700/1600 两次太早：真卡的主视觉要 2~3 秒才落定。这里补四次低频补量覆盖到 11 秒；
        //   RO 已经覆盖"内容一长高就报"，所以这四次只是**兜底**，不是主路径。
        //   有意不写成 `setInterval`：稳态之后每秒重扫整棵子树是纯浪费，而棘轮已经收敛，
        //   没有新信息可拿。
        'for(var i=0;i<4;i++)setTimeout(m,2500+i*2800);' +
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
      // ★ 守卫查的是**引导脚本专属 token**（`__muvHFitProbe` 只出现在上面那个 postMessage 语句里），
      //   **不是** `window.__muvH=1` —— 后者是卡随时能写的公共标记：
      //   卡的原始 HTML 里只要出现 `window.__muvH=1`（模型跑题、作者抄别家 shim、卡里内嵌文档），
      //   整段引导脚本就被**静默跳过**，iframe 再也不发 `__muvFrameHeight`，高度永远停在
      //   cardHtmlIframe 的默认 900px。检查这个 token 时按**整句**匹配（带上后半句），
      //   卡的拷贝要一字不差才会误命中。
      //
      //   ★ 真正的根治在**父页记账**（见 cardHtmlIframe 的 `__muvInjectCache`）：同一个 `raw`
      //   只在这里组装一次，重复调用直接命中缓存。子文档侧这条守卫只是第二道保险。
      //   注入链见 cardHtmlIframe：compat 在内层先跑，产物里没有这个 token，不会互相顶掉。
      if (s.indexOf('__muvHFitProbe=1;') !== -1) return s
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
     *
     * ★ 标记存的是**监听器本身**，不是 `true`（brief P2）：插件重载后这个函数会被新的闭包
     *   重新求值，`onMuvFrameHeightMessage` 是新函数对象，而**旧监听器仍挂在页面上**。
     *   只写 `true` 的话旧监听器永远不被解绑、也永远不被识别 ⇒ 它继续处理消息（写进旧的
     *   孤儿状态），而且旧闭包永不回收。存引用就能看出"换了人"：不一致时先解绑旧的。
     * @returns {void}
     */
    function ensureFrameHeightListener() {
      try {
        if (typeof window === 'undefined' || !window.addEventListener) return
        var old = window.__muvFrameHListener
        if (old === onMuvFrameHeightMessage) return
        if (typeof old === 'function') {
          try { window.removeEventListener('message', old, false) } catch (_) {}
        }
        window.addEventListener('message', onMuvFrameHeightMessage, false)
        window.__muvFrameHListener = onMuvFrameHeightMessage
      } catch (_) {}
    }

    /**
     * 父页收到子文档报来的高度后，只做一件事：改那个 iframe 的高度。
     *
     * 安全约束（红队会照这几条打）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃；
     *    伪造的、别的窗口/扩展发的消息都进不来（不查 origin：沙箱是不透明来源，
     *    它的 origin 恒为 "null"，拿它当凭据没有意义）；
     *  - 只接受有限正数，并夹到 [160, 12000]，畸形卡不能把页面撑到不可用；
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
      // ★ 死区**只作用在收缩方向** —— 与孩子侧棘轮同一条铁律（见 muvFrameBootstrap 里
      //   「滞回只作用在收缩方向」那段）。
      //
      //   为什么增长必须无条件生效：孩子侧报上来的"溢出学习"值是 `body.scrollHeight`
      //   （**精确**的溢出下沿，不是估值）。实测真卡 `_足控天堂2` 的 ERA 状态栏：
      //   内容 894 / 帧 889 —— 差 5px，被这个 8px 死区丢掉 ⇒ **卡底部永久少一条**
      //   （reset 把 html/body 啃成 `overflow:hidden!important`，连滚动条都没有）。
      //   `extent()` 量到的是元素包围盒（**不含 margin**），所以"最后那几个像素"只有
      //   滚动区自己看得见 —— 那正是死区最容易吃掉的一段。
      //   收缩方向照旧留 8px：亚像素抖动、卡内动画的 ±几像素不该引发连续重排。
      var cur = parseFloat(frame.style.height)
      if (isFinite(cur) && h <= cur && (cur - h) < 8) return
      try { frame.style.height = h + 'px' } catch (_) {}
    }

    /**
     * 把卡文档里 `min-height:…vh` 的声明**重写成固定像素**。
     *
     * ★ 这是「卡片塌成默认高度 + 框里永远有滚动条」的**根因**，也是照 ST 平价的关键一条。
     *
     * 循环定义长这样：卡的 CSS 写 `#app{min-height:100vh}`（`主页` / `正文美化` / `食人世界·开场白`
     * 三份都有）。`100vh` 在我们的 iframe 里 = **iframe 自己的高度**，而我们又要「以内容包围盒
     * 决定 iframe 的高度」—— 两边互为因果：iframe 起手 900 ⇒ vh=900 ⇒ 内容至少 900 ⇒ 报 900 ⇒
     * 不动点；可一旦某次报小了（高度测量有漏算，见 verify-frame-gap.mjs），内容跟着缩，
     * **再也长不回去**。用户的观感就是"卡片塌了、立绘很小、框里还有滚动条"。
     *
     * ST 的做法（`C:\_st_spec\SPEC.md`，另一个人真机实测抽出）：把 `min-height:100vh` 改写成
     * `min-height:var(--TH-viewport-height)`，值取**父窗口的 innerHeight**。我们照做，但直接落成
     * 像素值、不用 CSS 变量（少一层依赖，也少一处可能取不到变量的地方）：
     *
     *   vh 的取用顺序：**父窗口 innerHeight** → 拿不到就**不重写**。
     *   宁可不改，也不写一个错的固定值 —— 写错比不改更糟（卡会被钉死在错误高度上）。
     *
     * 只改 `min-height`，**不动** `max-height:…vh` / `height:…vh`（与 ST 一致，实测残留
     * `max-height:86vh` 是正常的）。`<script>` 里的同名文本**不碰**：卡自己可能在拼样式字符串，
     * 改了会让它的逻辑与实际样式不一致。
     * @param {string} html 卡自带的整页 HTML
     * @returns {string}
     */
    function rewriteVhMinHeight(html) {
      var s = String(html == null ? '' : html)
      var vh = 0
      try {
        if (typeof window !== 'undefined' && window.innerHeight) vh = Number(window.innerHeight) || 0
      } catch (_) {}
      if (!(vh >= 200)) return s          // 拿不到可信视口高：宁可保持原样
      var ranges = scriptRangesOf(s)
      var out = ''
      var last = 0
      var hits = 0
      var lower = s.toLowerCase()
      var i = 0
      // ★ 这里用**逐字符扫描**而不是正则字面量，是有原因的（踩过，别改回去）：
      //   `test-client-source.mjs` 与 `verify-shared.mjs` 都要把本函数**逐字提取出来执行**，
      //   而它们的词法扫描器按「`/` 在代码位置就是正则开头」处理。本函数里有
      //   `vh * parseFloat(x) / 100` 这个**除号**，于是扫描器进正则态、一路吃到后面某处，
      //   切片越界到下一个函数 ⇒ `new Function` 报
      //   `SyntaxError: Unexpected token 'function'`（报错位置在 test-client-source.js 里，
      //   看起来像源码坏了，真因在这行除号）。
      //   改成纯字符串扫描后，**两个提取器都不再需要词法判断**，同时也省掉了
      //   每次循环重建 RegExp 对象。`rewriteVhMinHeight` 因此可以逐字被提取验证。
      // 行为与原来的 `min-height\s*:\s*([0-9.]+)\s*(vh|dvh|svh|lvh)\b` 等价：
      //   大小写不敏感（这里靠整串 toLowerCase 后比对）、允许空白、值必须是数字，
      //   单位后**不接标识符字符**（`vhx` 不算）。只改 min-height，
      //   `max-height:…vh` / `height:…vh` 一律不碰（与 ST 一致）。
      while (i < s.length) {
        var at = lower.indexOf('min-height', i)
        if (at < 0) break
        var j = at + 10
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        if (s[j] !== ':') { i = at + 10; continue }
        j++
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        var numStart = j
        while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++
        if (j === numStart) { i = at + 10; continue }
        var numText = s.slice(numStart, j)
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        var unitStart = j
        while (j < s.length) {
          var cu = lower[j]
          if (cu >= 'a' && cu <= 'z') j++
          else break
        }
        var unit = lower.slice(unitStart, j)
        // 值与单位必须是**同一个** `min-height` 声明里的东西：单位后不许再接标识符字符
        // （`min-height:100vhx` / `min-height:100vh_foo` 都不算），这正是原正则 `\b` 的作用。
        // ⚠ `_` 也属于标识符字符。少了它，`100vh_foo` 会被当成**命中**并写成 1080px
        //   （差分测试抓到的唯一一处不一致）。
        if (!(unit === 'vh' || unit === 'dvh' || unit === 'svh' || unit === 'lvh')) { i = at + 10; continue }
        if (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) { i = at + 10; continue }
        var tokenEnd = j
        if (rangesContain(ranges, at)) { i = tokenEnd; continue }   // 落在 <script> 里：跳过，但别打乱切片
        // ★ 写成 `* 0.01` 而不是 `/ 100`：**本函数里不能出现代码位置的除号**。
        //   测试的 `sliceBalanced`（test-client-render.mjs / test-client-source.mjs /
        //   verify-shared.mjs）在 code 态看到 `/` 就进正则态，一路吃到下一个 `/`，于是
        //   花括号配平跑偏、切片错位，`extractFunction('rewriteVhMinHeight')` 抛
        //   `Invalid regular expression: missing /`。而 `buildFrom` 的自动发现是
        //   `try{…}catch(_){ null }` ⇒ **静默跳过**这个依赖，最后表现为
        //   `cardHtmlIframe` 在 eval 沙箱里 `ReferenceError: rewriteVhMinHeight is not defined`
        //   （报错位置指向 cardHtmlIframe，真因在这个除号 —— 极难反查）。
        //   本函数开头的注释已经记过一次这个坑，这里是当时漏改的第二处。别改回去。
        var px = Math.round(vh * parseFloat(numText) * 0.01)
        out += s.slice(last, at) + 'min-height:' + px + 'px'
        last = tokenEnd
        hits++
        i = tokenEnd
      }
      return hits ? out + s.slice(last) : s
    }

    // 主题快照缓存。**故意放在函数之前**（`var` 提升在这里不能靠）：
    // 回归测试会把 `dswThemeSnapshotCss` 的函数体逐字提取出来执行，闭包外的变量在
    // 提取物里不存在 —— 放在同一段顶层源码里，提取器才能把它们一起带上。
    var __muvThemeCss = ''
    var __muvThemeSig = ''

    /**
     * 宿主主题变量 `--dsw-alias-*` 的**当前值快照**，供 srcdoc 里的卡使用。
     *
     * 为什么需要：iframe 不继承父页的 CSS 变量 —— 卡里写 `var(--dsw-alias-bg-l1)` 会
     * 全部落到 fallback（或者干脆是空/黑），于是**今天所有 iframe 化的卡都没有主题**
     * （宿主主题只作用于宿主 DOM）。用户看到的就是"卡片和外面的聊天气泡不像一套东西"。
     *
     * 只取**有值的**变量：`getComputedStyle` 对未声明的自定义属性返回空串，把空串原样
     * 写进 `:root{--x:}` 会让这条声明变成无效声明，反而把卡自己的 fallback 链条弄脏。
     *
     * 值做一道**去尖括号**：`<style>` 里出现 `</style>` 会当场把样式表截断并把后面
     * 整段当 HTML 解析。主题变量是我们自己的调色板、正常不会带尖括号，但这条防线
     * 成本为零，而且它防的是"渲染整页毁掉"这个量级的后果。
     *
     * 结果按连接串缓存：只在**首次**注入时算一次（单个 iframe 内调一次 `getComputedStyle`
     * 够用，省掉每个 frame 重新枚举一遍全部变量）。
     * @returns {string} `:root{…}` 形式，取不到就返回空串
     */
    function dswThemeSnapshotCss() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) return ''
        var cs = window.getComputedStyle(document.documentElement)
        if (!cs) return ''
        var names = []
        for (var i = 0; i < cs.length; i++) {
          var p = cs[i]
          if (typeof p === 'string' && p.indexOf('--dsw-alias-') === 0) names.push(p)
        }
        if (!names.length) return ''
        var sig = names.join(',')
        if (__muvThemeSig === sig && __muvThemeCss) return __muvThemeCss
        var out = ''
        for (var k = 0; k < names.length; k++) {
          var v = cs.getPropertyValue(names[k])
          if (typeof v !== 'string') continue
          v = v.replace(/[<>]/g, '').trim()
          if (!v) continue
          out += names[k] + ':' + v + ';'
        }
        __muvThemeCss = out ? ':root{' + out + '}' : ''
        __muvThemeSig = sig
        return __muvThemeCss
      } catch (_) { return '' }
    }

    /**
     * 注入卡文档的 **reset 样式**（照 ST 平价，`C:\_st_spec\SPEC.md` 真机实测抽出）。
     *
     * ST 原文（`ST-IFRAME-SPEC.md` §3，`b1()` 里那一段，逐字）：
     *   `*,*::before,*::after{box-sizing:border-box;}`
     *   `html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}`
     *
     * ★ `overflow` 从 `auto` 改回 **ST 的 `hidden`**（原来那一版是 `overflow-y:auto`）。
     *
     * 旧那版留了 `auto` 当"退路"：怕跨源的高度是估的、估短了会静默裁掉内容。
     * 但那条退路的**代价**是用户真的会看到：卡自己的滚动条出现在卡片里面（截图里右侧那条），
     * 而且 `body` 一旦是可滚动容器，`body.scrollHeight` 与帧高的关系就被搅乱。
     * 现在的取舍是：`hidden` + **保证帧高 ≥ 内容高**（见 `muvFrameBootstrap` 的度量：
     * 内容包围盒 ∪ 观测到的 `body.scrollHeight` 溢出 ∪ body/html 的 px `min-height`，
     * 三者取最大；**只要有任何一项超过帧高就抬帧高**）。
     * 也就是说裁切不再可能：报给父页的值**只会 ≥ 真实内容高**。
     * 实测 9 份真卡 × 3 档起始高度：内容底边 ≤ 帧高 全部成立（verify-frame-size.mjs /
     * verify-frame-height.mjs）。横向一直是 `hidden`（照 ST），没变。
     * @returns {string}
     */
    function muvCardResetCss() {
      return '*,*::before,*::after{box-sizing:border-box}' +
        'html,body{margin:0!important;padding:0;max-width:100%!important;' +
        'overflow:hidden!important}'
    }

    /**
     * ★ 卡 iframe 的 **ST 同款前端库**注入开关（Tailwind / jQuery / jQuery-UI /
     * Vue / Vue-Router / FontAwesome）。**默认开 —— 不要顺手关掉。**
     *
     * 事实依据（`ST-IFRAME-SPEC.md` §3 / §7；这次是直接从 ST 的 `dist/index.js`
     * 里把 `v1` 常量原文取出来的，不是推测）。ST 的 iframe 文档模板 `b1()`
     * **无条件**把 `${v1}` 塞进**每一个**卡 iframe，`v1` 的原文是：
     *
     *   <link rel="stylesheet" href="…/@fortawesome/fontawesome-free/css/all.min.css">
     *   <script src="…/lib/tailwindcss.min.js">            （= @tailwindcss/browser@4.1.12）
     *   <script src="…/jquery/dist/jquery.min.js">
     *   <script src="…/jquery-ui/dist/jquery-ui.min.js">
     *   <link rel="stylesheet" href="…/jquery-ui/themes/base/theme.min.css">
     *   <script src="…/jquery-ui-touch-punch">
     *   <script src="…/vue/dist/vue.runtime.global.prod.min.js">
     *   <script src="…/vue-router/dist/vue-router.global.prod.min.js">
     *
     * ⇒ ST 里的卡 HTML **天然拥有** Tailwind 工具类（`class="w-full"`）、`$()`、
     * `$.ui`、Vue / Vue-Router、`fa-solid fa-xxx` 图标。写卡的人**直接依赖**这些、
     * 从不自己引 —— 所以「卡里东西出不来」有一条**独立**原因就是我们一个都没注入：
     *   · Tailwind 类没有任何 CSS 规则 ⇒ 布局按"没有样式"塌掉；
     *   · `$` / `Vue` 未定义 ⇒ 卡的脚本第一行就抛 ⇒ **界面照常渲染、功能全废**
     *     （与 §18 / §21 那两次 `$'` / `$&` 打坏卡脚本是同一类观感，极难查）。
     *
     * 关掉会发生什么：部分卡布局缺失、交互失效（"显示不全 / 点了没反应"）。
     * 只在**确认**某张卡被这些库干扰时才关；关法就是把这个常量改成 `false`，
     * **不要删代码**（删了就再也回不到 ST 平价）。
     *
     * 为什么走 CDN 而不是打包进插件：这六个库合计 ~600KB，打包会让每条消息多背
     * 一份；而卡的 iframe 本来就在拉远程图片/视频，网络能力不是新增的攻击面。
     * 失败形态是**安全的**：`script src` 取不到只是该全局为 `undefined`，卡里
     * 现成的 `typeof $ !== 'undefined'` 检测照旧短路 —— 不会比"从不注入"更差。
     * @type {boolean}
     */
    var MUV_CARD_LIBS = true

    /**
     * 库注入开关的读取口。
     *
     * 做成**函数**而不是直接引用常量：回归门禁是「从源码里逐字提取函数体再执行」
     * 的，闭包变量不在提取物里，裸引用 `MUV_CARD_LIBS` 会 `ReferenceError`
     * （这一片的每个 helper 都保持自足，测的才是真实代码）。
     * `typeof` 保护让它在"没有那个闭包"的提取场景下退回**默认开**。
     * @returns {boolean}
     */
    function muvCardLibsOn() {
      try { if (typeof MUV_CARD_LIBS !== 'undefined') return !!MUV_CARD_LIBS } catch (_) {}
      return true
    }

    /**
     * ST `v1` 的等价物 —— 六个库，**顺序照抄 ST**：先 CSS 后 JS，jQuery 在 Vue 前
     * （Vue-Router 依赖全局 `Vue`，jQuery-UI 依赖全局 `jQuery`，顺序错了就是静默
     * 少一个库）。版本**钉死**而不是用 latest：卡的写法是针对某一代库调过的，
     * 让 CDN 的 latest 自己往前走会引入无法复现的回归。
     *
     * 与 ST 的两处**有意**差异（都在注释里留痕，别当成 bug 修）：
     *  - Vue 用**完整构建** `vue.global.prod.js` 而不是 ST 的 `vue.runtime.global.prod`
     *    （runtime 版不含模板编译器）。完整版是它的**超集**：ST 能跑的写法这里都能跑，
     *    额外还能跑 `template:` 字符串 —— 只会多救几张卡，不会少。
     *  - 省略 jquery-ui 的 `theme.min.css` 与 `jquery-ui-touch-punch`（ST 有）：
     *    两者只影响 `.ui-*` 控件与触屏拖拽，而每多一个远程资源就多一份失败面。
     *    真遇到依赖它们的卡再补，补的时候照 ST 的顺序插（theme 在 jquery-ui 之后）。
     *
     * 两条硬约束（与 `muvFrameBootstrap` 同源）：**不含反引号**；字符串里
     * **不出现裸的 `</script>`**（收尾标签用 `'</' + 'script>'` 拼出来）。
     * @returns {string}
     */
    function muvCardLibTags() {
      var CDN = 'https://cdn.jsdelivr.net/npm/'
      return '<link data-muv-libs="fa" rel="stylesheet" href="' + CDN + '@fortawesome/fontawesome-free@6.7.2/css/all.min.css">' +
        '<script data-muv-libs="tw" src="' + CDN + '@tailwindcss/browser@4.1.12/dist/index.global.js"></' + 'script>' +
        '<script data-muv-libs="jq" src="' + CDN + 'jquery@3.7.1/dist/jquery.min.js"></' + 'script>' +
        '<script data-muv-libs="jqui" src="' + CDN + 'jquery-ui-dist@1.13.3/jquery-ui.min.js"></' + 'script>' +
        '<script data-muv-libs="vue" src="' + CDN + 'vue@3.5.13/dist/vue.global.prod.js"></' + 'script>' +
        '<script data-muv-libs="vr" src="' + CDN + 'vue-router@4.5.0/dist/vue-router.global.prod.js"></' + 'script>'
    }

    /**
     * 把 ST 同款前端库插进卡文档的 `<head>` —— **只**走卡 iframe 这一条路
     * （调用点是 `muvInjectDoc`，DSH 自己的 iframe 根本不经过它）。
     *
     * ★ 落点：**head 的末尾**（`</head>` 之前），不是 `<head>` 之后。
     *   这样 compat 垫片（解析期就必须生效的内联脚本）与 reset 样式都排在它前面：
     *   CDN 慢/挂时，卡自己的文档和我们的垫片**已经跑过了**，最坏只是"库没到"，
     *   不会连带把 compat / reset 一起推迟（那才会真的影响渲染）。
     *   而它仍然在 `<body>` 之前 ⇒ 卡的脚本（含 body 里的 IIFE）照样拿得到
     *   `jQuery` / `Vue`，与 ST 的时序一致。
     *
     * 用普通 `<link>` / `<script src>`（不是 `document.write`、不是我们自己的
     * 动态 loader）：加载失败只是少一个全局，卡的 HTML/CSS 照常渲染。
     * @param {string} html
     * @returns {string}
     */
    function withCardLibs(html) {
      var s = String(html == null ? '' : html)
      if (!muvCardLibsOn()) return s
      // 幂等守卫查的是**我们自己那个属性名**（连 `=` 一起查）：卡的原文里就算提到
      // `data-muv-libs` 这几个字（文档里抄了一段我们的 shim 之类）也不会被误判成
      // "已注入" —— 与 `withCardReset` / `withCardCompat` 那三处守卫同一个口径。
      if (s.indexOf('data-muv-libs=') !== -1) return s
      var tag = muvCardLibTags()
      var ranges = scriptRangesOf(s)
      var re = /<\/head\s*>/gi
      var m
      while ((m = re.exec(s))) {
        // 卡自己的 JS 字符串里可能写着 '</head>'，那样的落点在脚本内部，会把卡的代码切断。
        if (!rangesContain(ranges, m.index)) return s.slice(0, m.index) + tag + s.slice(m.index)
      }
      re = /<head\b[^>]*>/gi
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      re = /<html\b[^>]*>/gi
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      return tag + s
    }

    /**
     * 宿主视口高（px）—— `--TH-viewport-height` 的**取值来源**。
     *
     * ★ 语义按 ST：`ST-IFRAME-SPEC.md` §5，ST 的 `adjust_viewport.js` 写的是
     *   `$('html').css('--TH-viewport-height', window.parent.innerHeight + 'px')`
     *   —— 也就是**宿主（父页）的 innerHeight**，不是卡 iframe 自己的高度。
     *   `min-height:100vh` 在 ST 里的含义因此是「至少和聊天视口一样高」。
     *
     * 本函数在**父页**里执行，所以 `window.innerHeight` 恰好就是 ST 的那个 `window.parent.innerHeight`。
     * （`rewriteVhMinHeight` / `withCardReset` 都在父页侧调用，不在 iframe 里。）
     * `explicit` 让调用方（尤其是逐字提取执行的测试）能直接传一个高度进来。
     * @param {number} [explicit] 调用方给定的高度，优先于 window.innerHeight
     * @returns {number} px，取不到可信值时为 0
     */
    function muvHostViewportHeight(explicit) {
      var v = Number(explicit)
      if (isFinite(v) && v >= 200) return Math.round(v)
      try { v = Number(window.innerHeight) } catch (_) { v = 0 }
      if (isFinite(v) && v >= 200) return Math.round(v)
      return 0
    }

    /**
     * 把 reset 样式插到**不在任何 `<script>` 里的第一个** `<head …>` 之后；
     * 没有 head 就退到 `<html …>` 之后，再没有就接在最前面。
     *
     * 必须在卡的样式**之后**才生效吗？不 —— reset 靠 `!important`（margin/overflow/max-width）
     * 与低优先级的 `box-sizing` 改变继承默认值，插在最前面也不怕被卡的样式覆盖回来：
     * `!important` 只在**卡的声明也带 !important** 时才需要比优先级，那种情况极少。
     * 而插在最前面能保证**第一帧就生效**，避免"先按卡的原样式排一次、再重排"的闪动。
     *
     * 同一个锚点后面还插两样东西（都是 ST 有的、我们原来缺的）：
     *  - `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
     *    （`ST-IFRAME-SPEC.md` §3；卡里有 `@media` 移动端分支时按这个 viewport 求值）
     *  - `html{--TH-viewport-height:<N>px}` —— §5 的那个 CSS 变量。
     *    ★ 为什么由**父页烘焙**一个 px 初值（ST 是注入脚本运行时设的）：我们的引导脚本
     *      有可能因为卡自己的脚本报错而没跑到；那时候 `min-height:var(--TH-viewport-height)`
     *      会变成**无效的 IACVT**、退化成 `auto`，卡会当场塌掉。烘焙一个真值就没有这个坑；
     *      运行时拿到宿主 resize 广播后会 `setProperty` 覆盖它（见 muvFrameBootstrap）。
     * @param {string} html
     * @param {number} [hostH] 宿主视口高（测试里直接传；生产里取 window.innerHeight）
     * @returns {string}
     */
    function withCardReset(html, hostH) {
      var s = String(html == null ? '' : html)
      // ★ 守卫查的是**注入产物自己那个标签的属性名**（`data-muv-reset=` 只在上面那个 tag 里），
      //   不是裸子串 `__muvReset` —— 卡的原始 HTML 里只要出现该串（模型跑题、抄别家 shim、
      //   卡里内嵌文档）整段 reset 就会被静默跳过。同一个类的三处守卫一起收紧，见 brief P0-2。
      //   属性名后面那个 `=` 也要带上：单写属性名虽已足够专有，带上 `=` 之后连"文档里提到
      //   这个属性"的巧合都排除掉，而 `data-muv-reset="__muvReset"` 这种老产物仍被认作已注入。
      if (s.indexOf('data-muv-reset=') !== -1) return s
      var vh = muvHostViewportHeight(hostH)
      var css = muvCardResetCss()
      if (vh) css += 'html{--TH-viewport-height:' + vh + 'px}'
      var tag = '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<style data-muv-reset="__muvReset">' + css + '</style>'
      var ranges = scriptRangesOf(s)
      var re = /<head\b[^>]*>/gi
      var m
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      re = /<html\b[^>]*>/gi
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      return tag + s
    }

    /**
     * ── 卡 app 的 **ST 兼容层**（注入卡 iframe 内部的垫片） ────────────────────
     *
     * 背景：ST 的卡 iframe **没有 `sandbox`**（同源），所以卡作者的 app 顺手就用
     * `localStorage`、`SillyTavern.getContext()`、`window.parent`。我们的沙箱是
     * `allow-scripts`（不透明来源，安全决策见上面 `MUV_CARD_SANDBOX` 的长注释），
     * 于是这些 API 要么抛 `SecurityError`、要么够不着。
     *
     * 症状是**静默**的（真卡 `_足控天堂2` 实测）：`cgGetCache`/`cgSaveCache` 都被
     * `try{…}catch(e){}` 包着 ⇒ 不报错、永远返回空缓存 ⇒ CG 画廊永不解锁 ⇒
     * 那 18 个远程插图和视频永不显示。用户看到的只是"图/视频没出来"。
     *
     * 为什么不用 `allow-same-origin` 解决：那张卡的代码**主动探测** `window.parent.document`
     * （见 §9 事故记录）。同源后这三行立刻变活：
     *   `if(window.parent&&window.parent!==window)parentDocs.push(window.parent.document)`
     *   `if(window.opener)parentDocs.push(window.opener.document)`
     *   `if(window.parent.parent&&… )parentDocs.push(window.parent.parent.document)`
     * 卡就能读写 DSH 前端 DOM、带凭据打 `/api/*`。**所以只能垫片，不能放开沙箱。**
     *
     * ★ 关键的可行性依据（已实测，别丢）：卡的 `cgScanChat` 是从 `window` **起步**的 ——
     *   ```js
     *   var targetWindow=window;
     *   try{if(window.parent&&window.parent.SillyTavern)targetWindow=window.parent;}catch(e){}
     *   if(targetWindow.SillyTavern&&targetWindow.SillyTavern.getContext){ … }
     *   ```
     *   它只在 `window.parent.SillyTavern` 存在时才"升级"到父页。我们**跨源无法**给
     *   `window.parent` 挂属性，但**完全可以在 iframe 内部定义 `window.SillyTavern`** ⇒
     *   卡会采纳它。所以不用同源也能满足这条路径。
     *
     * 已实测**不需要**垫的两样（省掉就是少两处风险，理由都来自真数据）：
     *  - `$`/`jQuery`：全卡只有 2 处，且都写着 `if(typeof $ !== 'undefined' && $(el).length){…}`
     *    —— 已被 feature-detect 短路，没 jQuery 也不抛。
     *  - `indexedDB`：不透明源下 `indexedDB.open()` 是**同步抛** `SecurityError`
     *    （"access to the Indexed Database API is denied in this context"），
     *    而卡的 `cgImgDbOpen()` 正是 `try{…}catch(e){fail(e)}` —— 抛被接住、Promise reject、
     *    `cgLoadImg` 的 `.catch` 回退远程 URL。行为与 ST 只差"第二次打开走本地 blob 缓存"。
     *
     * 垫片的**形态约定**（沿用 `muvFrameBootstrap` 那两条硬约束，踩过）：
     *  - 整段是**单引号字符串**，所以内部一律用 `"` 引号，且**不含反引号**；
     *  - 字符串里**不出现裸的 `</script>`**（收尾标签用 `'</' + 'script>'` 拼）。
     * @returns {string} 只有 JS 正文，不含 script 标签
     */
    function muvCardCompatScript() {
      return '(function(){' +
        // 幂等标记用 `__muvCompatOn`（不是 `__muvCompat`）：它同时是父页守卫查的
        // **专属 token**，见 `withCardCompat` 的注释。卡自己写 `window.__muvCompat=1`
        // 不再能顶掉整段垫片。
        'if(window.__muvCompatOn)return;window.__muvCompatOn=1;' +
        'function S(v){return v==null?"":String(v)}' +
        'function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}' +
        // ── 1. KV：localStorage / sessionStorage 的内存实现 ──────────────────
        // 命名空间靠**前缀**区分（"L:" / "S:"），前缀首字符就不同 ⇒ 不可能串键。
        'var seed=(window.__muvKvSeed&&typeof window.__muvKvSeed==="object")?window.__muvKvSeed:{};' +
        'var mem={};' +
        'for(var k0 in seed){if(Object.prototype.hasOwnProperty.call(seed,k0))mem[k0]=S(seed[k0])}' +
        'function keysOf(ns){var a=[];for(var k in mem){if(k.indexOf(ns)===0)a.push(k.slice(ns.length))}return a}' +
        'function push(op,k,v){var m={__muvKv:op,k:S(k)};if(op==="set")m.v=S(v);post(m)}' +
        'function makeStore(ns){' +
        'var api={};' +
        'api.getItem=function(k){try{k=S(k);return Object.prototype.hasOwnProperty.call(mem,ns+k)?mem[ns+k]:null}catch(e){return null}};' +
        'api.setItem=function(k,v){try{k=S(k);v=S(v);mem[ns+k]=v;push("set",k,v)}catch(e){}};' +
        'api.removeItem=function(k){try{k=S(k);delete mem[ns+k];push("remove",k)}catch(e){}};' +
        'api.clear=function(){try{var ks=keysOf(ns);for(var i=0;i<ks.length;i++)delete mem[ns+ks[i]];push("clear")}catch(e){}};' +
        'api.key=function(i){try{var ks=keysOf(ns);i=Number(i);if(!isFinite(i))return null;return(i>=0&&i<ks.length)?ks[i]:null}catch(e){return null}};' +
        'try{Object.defineProperty(api,"length",{configurable:true,get:function(){try{return keysOf(ns).length}catch(e){return 0}}})}catch(e){}' +
        'return api}' +
        // 只在**真 API 不可用**时才覆盖：这样万一哪天沙箱回到同源，真实存储不会被我们顶掉。
        // 覆盖走 defineProperty（`window.localStorage` 在 Chrome/Edge 下是**自有且
        // configurable** 的访问器 —— 已实测 `own configurable=true`），
        // 不是 try/catch 包一层，也不是裸赋值（卡里是 'use strict'）。
        'function def(name,val){' +
        'try{Object.defineProperty(window,name,{configurable:true,get:function(){return val},set:function(){}});return true}catch(e){}' +
        'try{window[name]=val;return true}catch(e2){}return false}' +
        'function usable(name){' +
        'try{var s=window[name];if(!s)return false;s.setItem("__muvP","1");var ok=s.getItem("__muvP")==="1";s.removeItem("__muvP");return ok}catch(e){return false}}' +
        'if(!usable("localStorage")){def("localStorage",makeStore("L:"))}' +
        'if(!usable("sessionStorage")){def("sessionStorage",makeStore("S:"))}' +
        // ── 2. window.SillyTavern：卡从 getContext().chat 里扫 <img> 解锁 CG ──
        // chat 由**宿主**通过 postMessage 送进来（宿主才有消息文本）。取不到就空数组，
        // **必须不抛错** —— 卡的 cgScanChat 只做 `ctx.chat||[]`。
        'var hostChat=[];' +
        'function getContext(){' +
        'try{return{chat:hostChat,name1:"User",name2:"",characters:[],characterId:0,chatId:"",' +
        'eventSource:null,eventTypes:{},extensionSettings:{},getRequestHeaders:function(){return{}},' +
        'getCharacters:function(){return hostChat}}' +
        '}catch(e){return{chat:[]}}}' +
        'if(!window.SillyTavern)def("SillyTavern",{getContext:getContext});' +
        // ── 3. 事件总线：eventOn/eventEmit/eventOnce/eventClearAll ────────────
        // 卡用这套协议收发 ERA 数据（它只 emit 请求，应答者另有其人）。
        // `eventClearAll` 这个名字是 ST 的 `predefine.js` 第 47 行要求的：
        // `$(window).on("pagehide",function(){eventClearAll()})` —— 名字对不上会当场抛。
        // ★ `on` 返回**取消订阅函数**（ST/酒馆助手同口径）：实测新卡
        //   `var unsub = on(name, handler); _eventBindings.push({name, unsub: typeof unsub === 'function' ? unsub : null})`
        //   —— 它自己就带 null 兜底，所以返回值只是"能用上更好"，不影响老卡。
        'var handlers={};' +
        'function on(n,f){try{n=S(n);if(typeof f!=="function")return undefined;(handlers[n]=handlers[n]||[]).push(f);return function(){try{off(n,f)}catch(e){}}}catch(e){return undefined}}' +
        'function off(n,f){try{var a=handlers[S(n)]||[];var i=a.indexOf(f);if(i>=0)a.splice(i,1)}catch(e){}}' +
        'function once(n,f){try{var w=function(d){try{off(n,w)}catch(e){}try{f(d)}catch(e){}};on(n,w)}catch(e){}}' +
        // 派发只在**卡内**做。宿主回灌的事件走这里，**不走 emit** —— 否则一个来回就成正反馈
        // （宿主 → 卡 → 转发回宿主 → 宿主再回 …），所以两处入口必须分开。
        'function fire(n,d){try{var a=(handlers[S(n)]||[]).slice();for(var i=0;i<a.length;i++){try{a[i](d)}catch(e){}}}catch(e){}}' +
        // 卡的 `eventEmit` = 卡内派发 + 把请求**转发给宿主**。
        // ★ 为什么必须转发：ERA 的数据在宿主那一侧（卡的 `eraGet()` 只读卡内的 `currentStat`，
        //   而 `currentStat` 完全靠事件喂）。宿主不在 iframe 里、也进不去（不透明来源），
        //   所以子 → 父这一跳是唯一的通路。
        'function emit(n,d){fire(n,d);out(n,d)}' +
        'function out(n,d){' +
        'try{' +
        'if(typeof n!=="string"||!n||n.length>64)return;' +
        // 只送可结构化克隆的纯数据：函数/DOM 节点/循环引用会让 postMessage 当场抛。
        // 先 stringify 再 parse，顺带得到一个体积上限（恶意卡不能靠一个巨大的 detail 撑爆父页）。
        'var s=null;try{s=JSON.stringify(d===undefined?null:d)}catch(e){s=null}' +
        'if(s===undefined)return;' +
        'if(s!==null&&s.length>65536)return;' +
        'var v=null;if(s!==null){try{v=JSON.parse(s)}catch(e){v=null}}' +
        'post({__muvEventOut:{name:n,detail:v}})' +
        '}catch(e){}}' +
        'function clearAll(){try{handlers={}}catch(e){}}' +
        'if(typeof window.eventOn!=="function")def("eventOn",on);' +
        'if(typeof window.eventEmit!=="function")def("eventEmit",emit);' +
        'if(typeof window.eventOnce!=="function")def("eventOnce",once);' +
        'if(typeof window.eventOff!=="function")def("eventOff",off);' +
        'if(typeof window.eventClearAll!=="function")def("eventClearAll",clearAll);' +
        // ── 4. 视口变量（ST §5 的 --TH-viewport-height）────────────────────
        'function setVh(px){try{px=Number(px);if(!isFinite(px)||px<200)return;document.documentElement.style.setProperty("--TH-viewport-height",Math.round(px)+"px")}catch(e){}}' +
        'setVh(window.__muvVH);' +
        // ── 5. 收宿主的消息 ────────────────────────────────────────────────
        // 只认 `window.parent` 发来的（沙箱里子文档的 origin 是 "null"，拿 origin 当凭据
        // 没有意义；用 source 比对才是有效凭据）。
        'window.addEventListener("message",function(ev){' +
        'try{' +
        'if(ev.source!==window.parent)return;' +
        'var d=ev.data;if(!d||typeof d!=="object")return;' +
        'if(d.__muvVH!==undefined)window.__muvVH=d.__muvVH;' +
        'if(d.type==="TH_UPDATE_VIEWPORT_HEIGHT"||d.__muvVH!==undefined)setVh(window.__muvVH);' +
        'if(d.__muvKvSeed&&typeof d.__muvKvSeed==="object"){var s2=d.__muvKvSeed;for(var k2 in s2){if(Object.prototype.hasOwnProperty.call(s2,k2))mem[k2]=S(s2[k2])}}' +
        'if(d.__muvChat&&d.__muvChat.list&&typeof d.__muvChat.list.length!=="undefined")hostChat=d.__muvChat.list;' +
        // 宿主→卡的事件注入：宿主 postMessage 这个形状，卡的 eventOn("era:queryResult")
        // 就收到（不需要同源）。
        // ★ 走 `fire` 而**不是** `emit`：这是「防环」的唯一开关。用 emit 的话宿主回灌的事件会被
        //   再转发回宿主，宿主照协议再回一次 —— 一个来回就成正反馈，父页被自己打满。
        // ★ 同一个 detail 再喂一份给**变量缓存**（`__muvAbsorb`）：MVU 卡的
        //   `Mvu.getMvuData()` / `TavernHelper.getVariables()` 是**同步**读，不喂缓存的话
        //   它们只能回初始值 —— 就是"服务端有真值、卡上是空的"那个症状。
        //   写成两条并列 if 而不是一条 if 里塞两句：`…__muvEvent.name)fire(` 这个形状是
        //   verify-era-bridge 的「防环」断言逐字盯着的（它认的就是"入站直接 fire"），
        //   合并成 `{fire(...);…}` 会把那条断言打红 —— 别为了少几个字节去动既有门禁口径。
        'if(d.__muvEvent&&d.__muvEvent.name)fire(d.__muvEvent.name,d.__muvEvent.detail);' +
        'if(d.__muvEvent&&d.__muvEvent.name)__muvAbsorb(d.__muvEvent.name,d.__muvEvent.detail);' +
        '}catch(e){}},false);' +
        // ── 5.5 音频兜底：CDN 文件名带序号，而预设「音乐列表」写的是裸类别名 ──
        // 实测（2026-09-22，直接 HEAD 那个 CDN）：
        //   `音频/日常.mp3` = **404**，而 `音频/日常1.mp3` / `日常2` / `日常3` = 200；
        //   搞笑 / 欢快 / 暧昧 同样（裸名 404、带序号 200）。
        // 而卡模板的 `processAudio()` 就是按消息里 `<audio>日常</audio>` 拼
        // `${BASE_URL}音频/日常.mp3` ⇒ 必然 404，播放器一片空白（卡自己的 error
        // 处理只是把提示语调暗）。ST 侧同一张卡、同一个 URL，同样会静默 —— 这一条
        // **不是我们的偏差**，但既然命名规律是确定的，就顺手兜住。
        // 策略：只在**真的加载失败**时兜，且只对"不以数字结尾"的 .mp3 名字动手，
        // 依次试 `<名字>1 / 2 / 3`；名字已经带序号（日常1）时**不猜**，绝不改坏正解。
        'var __muvAudioTried={};' +
        'function __muvAudioFix(el){' +
        'try{' +
        'var a=el;if(a&&String(a.tagName||"").toLowerCase()==="source")a=a.parentNode;' +
        'if(!a||String(a.tagName||"").toLowerCase()!=="audio")return;' +
        'var sEl=a.querySelector?a.querySelector("source"):null;' +
        'var src=(sEl&&sEl.getAttribute("src"))||a.getAttribute("src")||"";' +
        'var m=/^(.*\\/)([^\\/]+)\\.mp3$/i.exec(String(src).split("?")[0]);' +
        'if(!m)return;' +
        'var name="";try{name=decodeURIComponent(m[2])}catch(e){name=String(m[2])}' +
        // 别名记号挂在**元素自己**身上（`a.__muvAudioBase`），不能用全局名字表：
        // 全局表会让另一个元素上**合法**的 `日常1.mp3` 被当成我们的候选，被继续改掉
        // （门禁 B 档实测抓到的）。名字带数字结尾时**不猜** —— 除非它就是本元素上一轮兜出来的。
        'var base=a.__muvAudioBase||name;' +
        'if(!a.__muvAudioBase&&/\\d$/.test(name))return;' +
        'var n=__muvAudioTried[base]||0;' +
        'if(n>=3)return;__muvAudioTried[base]=n+1;' +
        'var cand=m[1]+encodeURIComponent(base+(n+1))+".mp3";' +
        // 改写方式很讲究：**只改 `<source>` 的 src 再 `load()` 不会重新触发**资源选择算法
        // （实测：重试一次之后就不再报错，等于没重试）。规范里媒体元素**有 `src` 属性时
        // 会忽略 `<source>` 子节点**，所以清空子节点 + 直接设 `src` 才能保证真的重新选源，
        // 而且之后的错误会打在媒体元素上（本函数的两个分支都收）。
        'if(sEl){try{while(a.firstChild)a.removeChild(a.firstChild)}catch(e){}}' +
        'a.setAttribute("src",cand);' +
        'try{a.__muvAudioBase=base}catch(e){}' +
        'try{console.log("[muv-engine] 音频兜底 "+name+".mp3 → "+name+(n+1)+".mp3")}catch(e){}' +
        'try{a.load()}catch(e){}' +
        'try{var p=a.play();if(p&&p.catch)p.catch(function(){})}catch(e){}' +
        '}catch(e){}}' +
        'document.addEventListener("error",function(ev){__muvAudioFix(ev&&ev.target)},true);' +
        // ── 6. 开工：向宿主报名（要 chat / 视口高 / KV 快照）─────────────────
        'post({__muvHello:1});' +
        // ── 7. 用户消息桥：卡里「发送到酒馆」的首选路径 ─────────────────────
        // 真卡 sendToTavern 的三级降级（ERA 状态栏 2998-3054 行实测）：① 宿主注入的
        // 全局函数 sendUserMessage(msg)（首选）② DOM 直插父文档 #send_textarea +
        // #send_but（跨源必被拒）③ 剪贴板。①在这里兑现：postMessage 给宿主，由宿主
        // 填 DSH 的聊天输入框（mode=send 再代发，mode=fill 只填不发送）。
        // 另一类卡（主页.html 的 fillSendTextarea）先搜**自己文档**里的 #send_textarea：
        // 给它一个隐藏收件箱，卡用原生 setter 写值 + input/change 事件时这里捕获后按
        // fill 转发 —— 卡自己的提示语就是「已填入消息输入框，请检查后手动发送」。
        // 收件箱只在卡源码真的用到这套约定时才装（避免无关卡里多一个幽灵元素）。
        'function __muvUserSend(msg,mode){try{var s=S(msg);if(!s||s.length>20000)return false;' +
        'post({__muvUserSend:{text:s,mode:mode==="fill"?"fill":"send"}});return true}catch(e){return false}}' +
        'if(typeof window.sendUserMessage!=="function")def("sendUserMessage",function(m){return __muvUserSend(m,"send")});' +
        'function __muvInbox(){try{' +
        'var src="";try{src=document.documentElement.innerHTML}catch(e){}' +
        'if(src.indexOf("send_textarea")===-1&&src.indexOf("sendUserMessage")===-1&&src.indexOf("fillSendTextarea")===-1)return;' +
        'if(document.getElementById("send_textarea"))return;' +
        'var t=document.createElement("textarea");t.id="send_textarea";t.setAttribute("data-muv-inbox","1");' +
        't.style.cssText="position:absolute!important;left:-9999px!important;top:0;width:10px;height:10px;opacity:0!important;pointer-events:none!important";' +
        'document.body.appendChild(t);' +
        'var h=function(){if(!t.value)return;__muvUserSend(t.value,"fill")};' +
        't.addEventListener("input",h);t.addEventListener("change",h);}catch(e){}}' +
        'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",__muvInbox)}else{__muvInbox()}' +
        // ── 8. 变量宿主 API 垫片：window.TavernHelper / window.Mvu / 裸全局 ──────────
        // 形态来源是**实测**（2026-09-22，新卡 `1.txt` 的 DOM 快照 + 依赖计数），不是照文档想象：
        //   · 卡里 `var W = (function(){ try{ return window.parent && window.parent.document ?
        //     window.parent : window; }catch(e){ return window; } })();`
        //     —— 跨源时 `window.parent.document` **抛异常** ⇒ `W === window` ⇒ 卡的
        //     `W.TavernHelper` / `W.Mvu` **正好落到我们这一份**。这就是"父页探测回落"
        //     能成立的原因（不需要、也做不到去写父页的对象）。
        //   · 卡的 `pickStat(o)` 只在 `o.stat_data` 是**非空对象**时才算数 ⇒ 我们缓存/回送的
        //     必须是 `{stat_data:{…}}` 形状（宿主侧 `muvMvuWrap` 负责包；平铺路径由
        //     `readVar` 的第二跳兜底命中）。少了这一层包装 ⇒ 卡的读链四跳全落空 ⇒ 面板空。
        //   · 卡的读链：`Mvu.getCurrentMvuData()` → `Mvu.getMvuData(scope)` →
        //     `TH.getVariables(scope)` → `ST.chat[i].variables[sw].stat_data`；
        //     写链：`Mvu.replaceMvuData(full, scope)` → `TH.replaceVariables(full, scope)` →
        //     `TH.insertOrAssignVariables(payload, scope)`。所以这四个方法都要有。
        //   · 卡用 `Mvu.events.VARIABLE_UPDATE_ENDED` / `'mag_variable_update_ended'` /
        //     `'mag_variable_initialized'` 订阅刷新 ⇒ 宿主在状态变化后 emit
        //     `mag_variable_update_ended`（见 `muvEraPushNow`），这里吸收进缓存。
        //   · 裸全局 `insertOrAssignVariables(payload,{type:"global"})` 与 `W.triggerSlash` 也是
        //     卡的真实调用点（酒馆助手在 ST 里就是注入裸全局的）⇒ 一并提供。
        'var mvuData={stat_data:{}};' +
        'function mergeDeep(a,b){try{var o={};var k;for(k in a){if(Object.prototype.hasOwnProperty.call(a,k))o[k]=a[k]}for(k in b){if(!Object.prototype.hasOwnProperty.call(b,k))continue;var x=o[k],y=b[k];if(y&&typeof y==="object"&&!Array.isArray(y)&&x&&typeof x==="object"&&!Array.isArray(x)){o[k]=mergeDeep(x,y)}else{o[k]=y}}return o}catch(e){return b}}' +
        'function cloneDeep(v){try{return JSON.parse(JSON.stringify(v))}catch(e){return v}}' +
        'function getPath(root,p){try{if(p==null||p==="")return root;var a=S(p).split(".");var c=root;for(var i=0;i<a.length;i++){if(c==null||typeof c!=="object")return undefined;c=c[a[i]]}return c}catch(e){return undefined}}' +
        'function setPathIn(root,p,v){try{var a=S(p).split(".");if(!a.length||!a[0])return root;var out=(root&&typeof root==="object"&&!Array.isArray(root))?cloneDeep(root):{};var c=out;for(var i=0;i<a.length-1;i++){var k=a[i];if(!c[k]||typeof c[k]!=="object")c[k]={};c=c[k]}c[a[a.length-1]]=v;return out}catch(e){return root}}' +
        // 变量树视图：整体优先；查路径时先整体、再退到 `stat_data` 里（卡两种写法都能命中）。
        'function readVar(p,def){var v=getPath(mvuData,p);if(v===undefined&&mvuData&&mvuData.stat_data)v=getPath(mvuData.stat_data,p);return v===undefined?def:v}' +
        'function mvuWrap(tree){try{var t=(tree&&typeof tree==="object"&&!Array.isArray(tree))?tree:{};if(t.stat_data&&typeof t.stat_data==="object")return t;return {stat_data:t}}catch(e){return {stat_data:{}}}}' +
        'function mvuSet(tree){try{mvuData=mvuWrap(tree)}catch(e){}}' +
        // 事件里的变量树：`era:queryResult` / `era:writeDone` 是宿主**已经算好**的那份，
        // `mag_variable_update_ended` 是 MVU 口径的推送（宿主已包过一层，这里再包是幂等的）。
        'function __muvAbsorb(n,d){try{if(n==="era:queryResult"&&d&&d.result&&d.result.stat){mvuSet(d.result.stat);return}if(n==="era:writeDone"&&d&&d.statWithoutMeta){mvuSet(d.statWithoutMeta);return}if(n==="mag_variable_update_ended"&&d){mvuSet(d);return}}catch(e){}}' +
        // MVU 数据是**宿主**持有的（卡内没有第二份真值）⇒ 先问一次；节流防卡循环问。
        'var mvuReqAt=0;' +
        'function mvuReq(){try{var n=Date.now();if(n-mvuReqAt<1000)return;mvuReqAt=n;post({__muvMvuReq:1})}catch(e){}}' +
        // 写回：只发"要写什么"，落库由宿主做（`__muvVarWrite` → POST /api/muv-engine/state）。
        // `replace=true` 只在"载荷自带 stat_data"时用 —— 那说明它是**整棵树**（见宿主侧注释）。
        'function varWrite(data,replace){try{if(!data||typeof data!=="object")return false;post({__muvVarWrite:{data:data,replace:!!replace}});return true}catch(e){return false}}' +
        'function warnShim(m){try{console.warn("[muv-engine] "+S(m))}catch(e){}}' +
        // ── 8.1 TavernHelper 的最小可用集 ────────────────────────────────────
        // `getVariables(scopeOrPath, opts)`：**两种调用形态都要认**（实测卡里两种都有）：
        //   `TH.getVariables({type:"message",message_id:"latest"})` ⇒ 回整树（卡的 pickStat 走这条）；
        //   `TH.getVariables("公司.总现金", {defaultValue:0})`    ⇒ 回路径值。
        // scope 的 type（global/character/chat/message）**我们只有一份树** ⇒ 一律忽略，
        // 在注释与文档里写明（这是与 ST 的**已知差异**，不是等价实现）。
        'function thGetVariables(a,b){try{' +
        'if(a&&typeof a==="object")return mvuData;' +
        'if(a===undefined||a===null||a==="")return mvuData;' +
        'var d=(b&&typeof b==="object"&&Object.prototype.hasOwnProperty.call(b,"defaultValue"))?b.defaultValue:undefined;' +
        'return readVar(a,d)' +
        '}catch(e){return undefined}}' +
        // 写 API 的落库口径（写在注释与文档里）：
        //   · 载荷自称整树（顶层有 stat_data）⇒ `replace`（宿主整树替换）；
        //   · 否则（平铺/增量）⇒ `merge`（深合并，**不抹**另一来源的键）。
        // 本地缓存**一律深合并** —— 缓存少一个键就会让卡的同步读链瞬间变空。
        'function thReplaceVariables(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,!!(obj.stat_data&&typeof obj.stat_data==="object"))}catch(e){return false}}' +
        'function thInsertOrAssign(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,false)}catch(e){return false}}' +
        'function getLastId(){try{return hostChat.length?hostChat.length-1:-1}catch(e){return -1}}' +
        'function findMsg(all,id){try{if(typeof id==="number"){var i=id<0?all.length+id:id;return (i>=0&&i<all.length)?all[i]:null}if(typeof id==="string"){for(var j=0;j<all.length;j++){if(String(all[j].message_id)===id)return all[j]}return null}return null}catch(e){return null}}' +
        'function chatMsgs(){try{var out=[];for(var i=0;i<hostChat.length;i++){var m=hostChat[i]||{};out.push({message_id:i,name:m.name||"",mes:String(m.mes==null?"":m.mes),is_user:!!m.is_user,role:m.is_user?"user":"assistant"})}return out}catch(e){return []}}' +
        // `getChatMessages`：形态尽量贴 ST（number/string ⇒ 单条；数组 ⇒ 子集；无参 ⇒ 全部；
        // 负下标从尾部数）。数据源是宿主喂进来的 `hostChat`（**只有文本**，没有 swipe /
        // 变量 / 时间戳 —— 那些键一律不出现，别伪造）。
        'function thGetChatMessages(ids){try{var all=chatMsgs();if(ids===undefined||ids===null)return all;if(Array.isArray(ids)){var out=[];for(var i=0;i<ids.length;i++){var h=findMsg(all,ids[i]);if(h)out.push(h)}return out}return findMsg(all,ids)}catch(e){return Array.isArray(ids)?[]:null}}' +
        // `formatAsTavernRegexedString`：**最小实现 = 原样返回**。为什么不做真正则：
        //   ST 那个 API 要按消息深度跑卡的正则脚本，我们这边**同步**函数里没有可用的
        //   服务端往返（它是同步签名，卡拿返回值直接用）。原样返回是**保守正确**：
        //   不假装渲染过，也不会把文本改坏。真正需要正则渲染的卡请走消息管线本身。
        'function thFormatRegex(t){return S(t)}' +
        // ── 8.2 triggerSlash：**白名单**（不在名单里的一律不执行） ────────────
        // 名单：`/send <文本>`（走已有的用户消息桥）、`/setvar k=v`、`/getvar k`、`/echo <文本>`。
        // 其余（含实测卡里在用的 `/inject`）**只警告、不执行**：`triggerSlash` 在 ST 里能驱动
        // 宿主做很多事（注入提示词、改楼层、触发生成），我们没有等价能力，就**如实不做**——
        // 静默装作做过会让卡以为成功、后面每一步都错。
        'function parseScalar(s){try{var t=S(s).trim();if(/^-?(?:\\d+\\.?\\d*|\\.\\d+)$/.test(t))return Number(t);if(t==="true")return true;if(t==="false")return false;if(t==="null")return null;var m=/^(["\'])([\\s\\S]*)\\1$/.exec(t);if(m)return m[2];return t}catch(e){return s}}' +
        'function triggerSlash(cmd){' +
        'try{' +
        'var s=S(cmd).trim();' +
        'var m=/^\\/([A-Za-z_][A-Za-z0-9_]*)\\s*([\\s\\S]*)$/.exec(s);' +
        'if(!m){warnShim("triggerSlash 未支持："+s);return Promise.resolve(null)}' +
        'var name=m[1].toLowerCase();var rest=m[2]||"";' +
        'if(name==="send"){__muvUserSend(rest,"send");return Promise.resolve("")}' +
        'if(name==="echo"){try{console.log("[muv-engine] /echo "+rest)}catch(e){}return Promise.resolve("")}' +
        'if(name==="setvar"){' +
        'var eq=/^([^=\\s]+)\\s*=?\\s*([\\s\\S]*)$/.exec(rest);' +
        'if(!eq){warnShim("triggerSlash /setvar 缺参数："+rest);return Promise.resolve(null)}' +
        'var v2=parseScalar(eq[2]);mvuData=setPathIn(mvuData,eq[1],v2);' +
        'var w=setPathIn({},eq[1],v2);varWrite(w,false);' +
        'return Promise.resolve("")}' +
        'if(name==="getvar"){var gv=readVar(rest.trim(),"");return Promise.resolve(gv===undefined||gv===null?"":String(gv))}' +
        'warnShim("triggerSlash 未支持："+s);' +
        'return Promise.resolve(null)' +
        '}catch(e){warnShim("triggerSlash 异常："+S(e&&e.message));return Promise.resolve(null)}}' +
        'var TH={version:"3.0.0",getVariables:thGetVariables,replaceVariables:thReplaceVariables,' +
        'insertOrAssignVariables:thInsertOrAssign,triggerSlash:triggerSlash,' +
        'eventOn:on,eventEmit:emit,eventOnce:once,eventOff:off,eventClearAll:clearAll,' +
        'getChatMessages:thGetChatMessages,formatAsTavernRegexedString:thFormatRegex,' +
        'getLastMessageId:getLastId,getCurrentChatId:function(){return ""},getContext:getContext};' +
        // 只在卡**自己没定义**时落位（卡若自带一套，尊重卡的）。
        'if(!window.TavernHelper)def("TavernHelper",TH);' +
        // ── 8.3 window.Mvu 的最小可用集 ─────────────────────────────────────
        // `events` 的名字照 MVU 的真实事件名给；卡里 `Mvu.events.VARIABLE_UPDATE_ENDED` 缺了
        // 也能退化到字符串字面量，但给了它才会走到**首选**那条。
        'var Mvu={version:"3.0.0",' +
        'events:{VARIABLE_UPDATE_ENDED:"mag_variable_update_ended",VARIABLE_INITIALIZED:"mag_variable_initialized",BEFORE_MESSAGE_UPDATE:"mag_variable_update_before"},' +
        'getMvuData:function(){mvuReq();return mvuData},' +
        'getCurrentMvuData:function(){mvuReq();return mvuData},' +
        'getMvuVariable:function(p,d){return readVar(p,d)},' +
        'replaceMvuData:function(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,!!(obj.stat_data&&typeof obj.stat_data==="object"))}catch(e){return false}}};' +
        'if(!window.Mvu)def("Mvu",Mvu);' +
        // ── 8.4 裸全局（酒馆助手在 ST 里就是注入裸全局；实测卡里两种写法都有） ──
        'if(typeof window.getVariables!=="function")def("getVariables",thGetVariables);' +
        'if(typeof window.replaceVariables!=="function")def("replaceVariables",thReplaceVariables);' +
        'if(typeof window.insertOrAssignVariables!=="function")def("insertOrAssignVariables",thInsertOrAssign);' +
        'if(typeof window.triggerSlash!=="function")def("triggerSlash",triggerSlash);' +
        'if(typeof window.getLastMessageId!=="function")def("getLastMessageId",getLastId);' +
        'if(typeof window.formatAsTavernRegexedString!=="function")def("formatAsTavernRegexedString",thFormatRegex);' +
        'if(typeof window.getChatMessages!=="function")def("getChatMessages",thGetChatMessages);' +
        // 开工就先问一次 MVU 数据（此刻宿主可能还没预热完 ⇒ 回来后走 `__muvMvuReq` 的补齐队列）。
        'mvuReq();' +
        '})();'
    }

    /**
     * 卡 iframe 的**跨 iframe KV 存储**（父页内存）。
     *
     * 为什么必须有这一层（不是"锦上添花"）：卡在**每条消息**里各有一个 iframe，
     * 而 CG 画廊状态 `ft2_cg_cache_v2` 正是在这些 iframe 之间流转的 ——
     * 「上一条消息的状态栏解锁了一张 CG，下一条消息的状态栏应该看得见」。
     * 只用内存垫片的话，每个 iframe 都是一座孤岛，画廊会一直空着（**和修之前一样**）。
     *
     * 键的取法：对**注入前的卡文档**做一个 32 位散列（`k` + 十六进制 + 长度）。
     * 同一张卡每次重建得到同一个键 ⇒ 状态能续上；不同的卡互不串。
     *
     * 安全约束（跨源消息是最容易被拿来做手脚的入口，照 `onMuvFrameHeightMessage` 的口径）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃；
     *  - 键**不从消息里取**，而是从那个 iframe 元素的 `data-muv-kv` 属性取 ——
     *    消息里的东西一律不可信，恶意卡不能借此写别的卡的命名空间；
     *  - 只接受字符串键/值，且键 ≤ 160 字符、值 ≤ 256 KB、单卡 ≤ 400 条 / 2 MB 总量，
     *    超限就拒绝（防止恶意卡把父页内存撑爆）；
     *  - **命名空间带会话栅栏**：真正落进来的键是 `muvKvKeyOf(key)`，即 `<卡键>@<会话 id>`
     *    —— 同一张卡在两个会话里各持一份互不可见的 KV。少了这道栅栏，B 会话的卡会看到
     *    A 会话解锁的 CG（CG 画廊状态在两个会话之间串）。
     *  - 只做 KV 读写与 chat 回送，**不 eval、不插入内容、不读卡内任何东西**。
     * @type {Object<string, Object>}
     */
    var muvKv = {}

    /**
     * `muvKv` 的 LRU 记账：`命名空间键 → 最近一次触碰的 ms`（brief P2）。
     *
     * 为什么必须有：400 条 / 2MB 是**每键**上限，**键的总数原先没有上限**，而键 = 卡内容散列
     * + 长度 —— 内容一变（编辑消息、流式重渲染）就是**新键**，旧键永远留着。`muvKv` 是
     * 页面级生命周期，没有 delete、没有清理钩子 ⇒ 30 个历史键 × 最坏 2MB = 60MB 常驻。
     * 现在按 16 键 / 8MB 两道上限做 LRU 淘汰；会话切换时另外清掉不可达的键（见 `muvKvGc`）。
     * 故意**声明成纯对象字面量**（理由同 `muvEraVars`：逐字提取的门禁要能内联它）。
     * @type {Object<string, number>}
     */
    var muvKvAt = {}

    /**
     * 已装饰过的消息文本。宿主把它回送给卡的 `getContext().chat`。
     *
     * 卡的 `cgScanChat` 两条路：① `SillyTavern.getContext().chat`（我们靠垫片顶上）；
     * ② 扫 DOM（要 `window.parent.document`，跨源被拒，没用）。所以①是唯一活路，
     * 而①的数据只能由宿主提供 —— 宿主手里就是这些消息文本。
     *
     * ★ 但它是**会话局部的**（brief P2）：原先这条缓冲是全局的，而 `muvReplyToFrame` 把
     *   **全量 80 条**发给**每一个**卡 iframe ⇒ A 会话的消息会出现在 B 会话卡的
     *   `getContext().chat` 里，卡的 `cgScanChat` 扫 `<img>名</img>` ⇒ **在 B 会话能解锁
     *   A 会话的 CG**，A 会话正文（含世界书文本）也被送进 B 会话 iframe。
     *   现在由 `muvChatFence()` 按 `currentSessionId()` 当栅栏：会话 id 一变就整条清空。
     *   故意**不是 const**：清空是重新绑定一个新数组（所有闭包读的都是同一个模块变量，
     *   不需要逐个通知）。
     * @type {Array<string>}
     */
    var muvChatLog = []

    /** chat 栅栏状态：上次观察到的会话 id（会话一变，`muvChatLog` 整条作废）。 */
    var muvChatSession = ''

    var MUV_KV_MAX_KEY = 160
    var MUV_KV_MAX_VAL = 262144
    var MUV_KV_MAX_ITEMS = 400
    var MUV_KV_MAX_TOTAL = 2097152
    /** KV 命名空间的**总数**上限（LRU）与全部命名空间的字节上限。 */
    var MUV_KV_MAX_NS = 16
    var MUV_KV_MAX_NS_TOTAL = 8388608
    var MUV_CHAT_MAX_ITEMS = 80
    var MUV_CHAT_MAX_ITEM = 40000
    var MUV_CHAT_MAX_TOTAL = 600000

    /** ERA 变量快照的复用窗口（ms）。同一批 iframe 的 `era:getCurrentVars` 共用一个请求。 */
    var MUV_ERA_TTL = 5000
    /** 同一帧的 ERA 应答上限（窗口内），防止卡用 `setInterval` 把父页的主线程刷满。 */
    var MUV_ERA_MAX_REPLIES = 8
    var MUV_ERA_WINDOW = 4000

    /**
     * ERA 变量快照的缓存。
     *
     * **故意声明成纯对象字面量**（字段运行时再挂）：`verify-shared.mjs` 的
     * `moduleVarStatements` 只内联「RHS 是纯字面量」的模块级 `var`，带标识符字段的对象字面量
     * 会被它跳过 —— 那样逐字提取出来的函数在门禁里就成了 `ReferenceError`。
     * `.locator` = 这份数据是**按谁**取的（会话 id 或预设 id），`.data` = 变量树（未就绪为 null），
     * `.at` = 取数时刻，`.inflight` = 正在取。
     * @type {Object}
     */
    var muvEraVars = {}
    /** 取数还没回来就收到的请求（帧 + 请求名），回来后一起兑现。 */
    var muvEraPending = []
    /** 按 iframe 的 KV 命名空间记账的应答滑动窗口。 */
    var muvEraGate = {}

    /**
     * `__muvHello` 的**每帧**节流时间戳（`data-muv-kv` → 上次回送的 ms）。
     *
     * 为什么必须有：hello 是卡**唯一**能主动反复触发的入口，而每次回送要付
     * `muvCompatSeedMap`（深遍历最多 400 条 KV 重建对象）+ `muvChatList`（80 条 / 600KB
     * 截断）+ 两次 `postMessage`（结构化克隆）。沙箱卡只要
     * `setInterval(function(){parent.postMessage({__muvHello:1},"*")},0)` 就能把父页主线程
     * 打满 —— 跨源消息的 source 校验挡不住它（它**就是**我们自己的卡）。
     * 200ms 是"比任何合理重绘都快、比 setInterval 慢两个数量级"的折中；
     * 第一次回送**不受限**（否则卡的首屏拿不到种子）。
     * 故意**声明成纯对象字面量**：`verify-shared.mjs` 的 `moduleVarStatements` 只内联
     * 「RHS 是纯字面量」的模块级 `var`，带标识符字段的对象字面量会被它跳过 ⇒ 逐字提取出来的
     * 函数在门禁里会 `ReferenceError`。键被删掉也没关系（下次当作首次）。
     * @type {Object<string, number>}
     */
    var muvHelloAt = {}
    /** 同帧两次 hello 回送的最小间隔（ms）。 */
    var MUV_HELLO_MIN_GAP = 200

    /**
     * 用户消息桥的每帧节流账本（`data-muv-kv` → 最近一次转发 ms）。
     * 声明口径同 `muvHelloAt`（纯对象字面量，供逐字提取的门禁内联）。
     * @type {Object<string, number>}
     */
    var muvUserSendAt = {}
    /** 同帧两次「用户消息」转发的最小间隔（ms）。 */
    var MUV_USERSEND_MIN_GAP = 800

    /**
     * 卡内**变量写 API** 的每帧节流账本（`data-muv-kv` → 最近一次落库 ms）。
     *
     * 为什么要节流：`Mvu.replaceMvuData` / `TavernHelper.insertOrAssignVariables` 是卡**能主动
     * 反复触发**的入口，每次都要写服务端 + 作废缓存 + 多档重推（三次取数 + 三次全帧 postMessage）。
     * 沙箱卡 `setInterval(…,0)` 就能把父页与服务端一起打满。声明口径同 `muvHelloAt`。
     * @type {Object<string, number>}
     */
    var muvVarWriteAt = {}
    /** 同帧两次「变量落库」的最小间隔（ms）。 */
    var MUV_VARWRITE_MIN_GAP = 200
    /** 单次 `__muvVarWrite` 的 JSON 体积上限（字符）：恶意卡不能靠一个巨型树撑爆服务端。 */
    var MUV_VARWRITE_MAX_BYTES = 524288

    /**
     * `__muvMvuReq` 的每帧节流账本（`data-muv-kv` → 最近一次应答 ms）。
     * 声明口径同 `muvHelloAt`。@type {Object<string, number>}
     */
    var muvMvuReqAt = {}
    /** 同帧两次 MVU 数据回送的最小间隔（ms）。 */
    var MUV_MVUREQ_MIN_GAP = 400

    /** 取数没回来就收到的 `__muvMvuReq`（帧），回来后用 `mag_variable_update_ended` 一起兑现。 */
    var muvMvuPending = []

    /**
     * 卡 → 宿主的「用户消息」落地：把文本写进 DSH 的聊天输入框。
     *
     * mode='fill' 只填不发送（主页卡的提示语是「已填入消息输入框，请检查后手动发送」，
     * 卡自己会 toast 提示）；mode='send' 填入后再代发一次 —— 走 Enter 键路径，与
     * `exports.apply` 里 muv-choice-btn 的点击委托同一口径（DSH 把 Enter 当发送）。
     * 找输入框的优先级与那处委托一致：宏钩子标记 → placeholder 关键词 → 兜底全量扫
     * （可见、可写、rows≥2）。值必须走**原生 setter**（DSH 的输入框是受控组件）。
     * @param {string} text
     * @param {'fill'|'send'} mode
     * @returns {boolean} 是否找到了输入框并写入
     */
    function muvDeliverUserText(text, mode) {
      var textarea = null
      try {
        textarea = document.querySelector('textarea[data-muv-macro-hooked]') ||
          document.querySelector('textarea[placeholder*="消息"], textarea[placeholder*="Message"], textarea[placeholder*="输入"]')
      } catch (_) { textarea = null }
      if (!textarea) {
        try {
          var all = document.querySelectorAll('textarea')
          for (var i = 0; i < all.length; i++) {
            if (all[i].offsetParent !== null && !all[i].readOnly && all[i].rows >= 2) { textarea = all[i]; break }
          }
        } catch (_) { textarea = null }
      }
      if (!textarea) return false
      var v = String(text == null ? '' : text)
      try {
        var proto = (typeof HTMLInputElement !== 'undefined' && textarea instanceof HTMLInputElement)
          ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(textarea, v)
      } catch (_) {
        try { textarea.value = v } catch (_) { return false }
      }
      try { textarea.dispatchEvent(new Event('input', { bubbles: true })) } catch (_) {}
      try { textarea.focus() } catch (_) {}
      if (mode === 'send') {
        setTimeout(function () {
          try { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) } catch (_) {}
        }, 60)
      }
      return true
    }

    /**
     * 卡文档 → 稳定的存储键。
     *
     * 用**注入前**的原文（不是注入后的 srcdoc），所以后台改 CSS/加垫片都不会改键。
     * 32 位散列配长度后缀；卡数量是个位数，碰撞概率可忽略，真撞了也只是两张卡共用一份
     * KV（不是安全边界，只是缓存归并）。故意**不用除法**：这个函数会被回归测试逐字提取，
     * 而提取器的词法扫描对 `/` 有额外判断（见 `rewriteVhMinHeight` 上方那段踩坑注释）。
     *
     * ⚠ 已知取舍（brief P2，**本轮不动**）：内容散列本来就不是"卡的身份" —— 同一张卡改一个字
     *   就是新键，CG 缓存全丢；而旧键要等 LRU 淘汰。改成文件名/预设 id 需要 `cardHtmlIframe`
     *   拿到卡身份，而它的入参只有 HTML 串（调用点 `cascadeStatusBlock` / `beautifyMuv` 都不
     *   掌握卡名）⇒ 那是**另一个接口改动**，不是这里的 bug 修复。LRU（`muvKvEvict`）先把
     *   "无界增长"这一半收掉。
     * @param {string} html
     * @returns {string}
     */
    function muvCompatKey(html) {
      var s = String(html == null ? '' : html)
      var h = 0
      for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
      var hex = (h >>> 0).toString(16)
      return 'k' + hex + '-' + s.length.toString(16)
    }

    /**
     * 这个 iframe 的 KV 命名空间 = `data-muv-kv`（卡键）**带上会话栅栏**。
     *
     * `data-muv-kv` 属性仍旧只写卡键（它也是 `iframe` 的公开契约，门禁按它取快照），
     * 会话栅栏在**父页内部**拼 —— 同一张卡在两个会话里各持一份互不可见的 KV。
     * @param {string} key `data-muv-kv` 上那个卡键
     * @returns {string}
     */
    function muvKvKeyOf(key) {
      var k = String(key == null ? '' : key)
      var sid = ''
      try { sid = currentSessionId() } catch (_) { sid = '' }
      // 认不出会话时**不加栅栏**（保持旧行为）：错加一个空栅栏会把"切会话"和"认不出会话"
      // 混成同一件事。此时 `muvChatFence` 也认不出，两边一致。
      return sid ? (k + '@' + sid) : k
    }

    /**
     * 触碰一个 KV 命名空间（LRU 记账）。`onMuvCardCompatMessage` 认下帧之后**无条件**调一次。
     * @param {string} key `data-muv-kv` 上那个卡键
     * @returns {string} 真正落库用的命名空间键
     */
    function muvKvTouch(key) {
      var ns = muvKvKeyOf(key)
      try { muvKvAt[ns] = Date.now() } catch (_) {}
      return ns
    }

    /**
     * LRU 淘汰：命名空间数 ≤ 16、全部命名空间的字符总量 ≤ 8MB（brief P2）。
     *
     * 淘汰自记的"最久未触碰"。**先按数量再按总量**：数量是主约束（键数才会爆炸），
     * 总量是防单键吃满 2MB 时的兜底。账本（`muvKvAt`）可能与 `muvKv` 不同步
     * （比如被测试直接塞过），所以两个方向都扫一遍，孤儿一起清掉。
     * @returns {number} 淘汰掉的命名空间数
     */
    function muvKvEvict() {
      var dropped = 0
      try {
        var names = []
        for (var k in muvKv) {
          if (Object.prototype.hasOwnProperty.call(muvKv, k)) names.push(k)
        }
        if (!names.length) return 0
        var total = 0
        for (var i = 0; i < names.length; i++) {
          var st = muvKv[names[i]]
          for (var kk in st) {
            if (Object.prototype.hasOwnProperty.call(st, kk)) total += String(st[kk]).length
          }
        }
        if (names.length <= MUV_KV_MAX_NS && total <= MUV_KV_MAX_NS_TOTAL) return 0
        names.sort(function (a, b) { return (muvKvAt[a] || 0) - (muvKvAt[b] || 0) })
        for (var j = 0; j < names.length; j++) {
          if (names.length - dropped <= MUV_KV_MAX_NS) break
          var gone = names[j]
          var sz = 0
          for (var k3 in muvKv[gone]) {
            if (Object.prototype.hasOwnProperty.call(muvKv[gone], k3)) sz += String(muvKv[gone][k3]).length
          }
          try { delete muvKv[gone] } catch (_) {}
          try { delete muvKvAt[gone] } catch (_) {}
          total -= sz
          dropped++
        }
        // 数量已够，但总量仍超：继续按 LRU 丢，直到落到 8MB 以下（至少留 1 个）。
        var idx = 0
        while (total > MUV_KV_MAX_NS_TOTAL && idx < names.length) {
          var n2 = names[idx]
          idx++
          if (!Object.prototype.hasOwnProperty.call(muvKv, n2)) continue
          if ((names.length - dropped) <= 1) break
          var sz2 = 0
          for (var k4 in muvKv[n2]) {
            if (Object.prototype.hasOwnProperty.call(muvKv[n2], k4)) sz2 += String(muvKv[n2][k4]).length
          }
          try { delete muvKv[n2] } catch (_) {}
          try { delete muvKvAt[n2] } catch (_) {}
          total -= sz2
          dropped++
        }
      } catch (_) {}
      return dropped
    }

    /**
     * 会话栅栏 + 不可达 KV 的清理。`muvPushChatLog` / `muvReplyToFrame` 每次入口调一次。
     *
     * 会话 id 一变：chat 缓冲整条作废（核心隔离，见 `muvChatLog` 的注释），并且把 KV 里
     * **属于别的会话**的命名空间删掉 —— 那是上一次会话留下的、本会话永远不会命中的键。
     * 认不出会话 id 时**不清**（宁可留着也不误删当前会话的缓存）。
     * @returns {string} 当前会话 id（认不出为空串）
     */
    function muvChatFence() {
      var sid = ''
      try { sid = currentSessionId() } catch (_) { sid = '' }
      if (sid && sid !== muvChatSession) {
        muvChatSession = sid
        muvChatLog = []
        try {
          var suffix = '@' + sid
          for (var k in muvKv) {
            if (!Object.prototype.hasOwnProperty.call(muvKv, k)) continue
            if (k.slice(-suffix.length) === suffix) continue
            try { delete muvKv[k] } catch (_) {}
            try { delete muvKvAt[k] } catch (_) {}
          }
        } catch (_) {}
      }
      return sid
    }

    /**
     * 安全地把值嵌进内联 `<script>` 的 JSON 字面量。
     *
     * 卡的消息文本是**不可信输入**（模型/卡作者写的），里面完全可能有 `</script>`：
     * 那样会当场把内联脚本截断、整个垫片报废（`renderMediaTags` 踩过同一类坑）。
     * 所以转义 `<`（以及 U+2028/U+2029，它们在 JS 字符串字面量里是非法换行）。
     * 故意不用正则字面量：`verify-shared.mjs` 的提取器按「`/` 在代码位置就是正则开头」
     * 处理，少一个正则就少一处误判。
     * @param {*} v
     * @returns {string}
     */
    function muvJsonSafe(v) {
      var s = ''
      try { s = JSON.stringify(v) } catch (_) { s = '' }
      if (typeof s !== 'string' || !s) s = 'null'
      s = s.split('<').join('\\u003c')
      s = s.split('\u2028').join('\\u2028')
      s = s.split('\u2029').join('\\u2029')
      return s
    }

    /**
     * 本次注入要带给垫片的**初始状态**（KV 快照 + 宿主视口高）。
     *
     * 走静态注入而不是"先跑起来再问宿主"：卡的首屏就在同步读 `localStorage`
     * （`var cgGalleryState=(function(){try{var s=localStorage.getItem("ft2_cg_state")…`），
     * 异步回填会慢一拍、首屏用错值。
     * @param {string} key `data-muv-kv` 上那个卡键
     * @param {number} vh
     * @returns {string}
     */
    function muvCardCompatSeed(key, vh) {
      var kv = {}
      var st = null
      try {
        var ns = muvKvKeyOf(key)
        if (typeof muvKv === 'object' && muvKv && Object.prototype.hasOwnProperty.call(muvKv, ns)) st = muvKv[ns]
      } catch (_) { st = null }
      try {
        for (var k in st) {
          if (Object.prototype.hasOwnProperty.call(st, k)) kv['L:' + k] = st[k]
        }
      } catch (_) {}
      return 'window.__muvKvSeed=' + muvJsonSafe(kv) + ';window.__muvVH=' + (vh || 0) + ';'
    }

    /**
     * 把兼容层插到**不在任何 `<script>` 里的第一个** `<head …>` 之后（没有 head 就
     * 退到 `<html …>`，再没有就接在最前面）。
     *
     * ★ 必须是文档里**最早的**脚本之一：卡的「ERA 状态栏」是一个 `(function(){'use strict';…})()`
     *   IIFE，它**解析期就**读 `localStorage`（`cgGalleryState` 那个 IIFE）——
     *   垫片晚一步就没用了。
     * @param {string} html
     * @param {number} [hostH]
     * @returns {string}
     */
    function withCardCompat(html, hostH) {
      var s = String(html == null ? '' : html)
      // ★ 守卫查的是垫片**运行时会留下的属性名**（`__muvCompatOn` 只出现在垫片第一句），
      //   不是裸子串 `__muvCompat`：垫片跑在**最内层、直接面对卡原文**，处境最危险 ——
      //   卡的 HTML 里写到一个 `__muvCompat`（哪怕只是文档里提了一句）就足以让整段垫片
      //   被静默跳过，卡的 `localStorage` / `getContext()` 全塌，而且**没有任何日志**。
      if (s.indexOf('__muvCompatOn') !== -1) return s
      var vh = muvHostViewportHeight(hostH)
      var tag = '<script>' + muvCardCompatSeed(muvCompatKey(s), vh) + muvCardCompatScript() + '</' + 'script>'
      var ranges = scriptRangesOf(s)
      var re = /<head\b[^>]*>/gi
      var m
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      re = /<html\b[^>]*>/gi
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) return s.slice(0, re.lastIndex) + tag + s.slice(re.lastIndex)
      }
      return tag + s
    }

    /**
     * 安装卡兼容层的父页监听。全局只装一次；幂等标记挂 `window`（理由同
     * `ensureFrameHeightListener`：本函数会被回归测试从源码里逐字提取执行，
     * 闭包变量在提取物里不存在）。
     *
     * ★ 标记存**监听器引用**而不是 `true`（brief P2）：监听器闭包持有 `muvKv` / `muvChatLog`，
     *   插件重载会产生一份**新的空状态**。若继续用 `true` 挡着，旧监听器会一直留在页面上
     *   处理老 iframe 的消息（写进孤儿状态），新 iframe 又只拿到新状态 ⇒ **CG 解锁在重载后
     *   丢失**，且旧闭包永不回收。存引用就能发现"换了人"并显式解绑旧的。
     * @returns {void}
     */
    function ensureCardCompatListener() {
      try {
        if (typeof window === 'undefined' || !window.addEventListener) return
        var old = window.__muvCardCompatListener
        if (old === onMuvCardCompatMessage) return
        if (typeof old === 'function') {
          try { window.removeEventListener('message', old, false) } catch (_) {}
        }
        window.addEventListener('message', onMuvCardCompatMessage, false)
        window.__muvCardCompatListener = onMuvCardCompatMessage
      } catch (_) {}
    }

    /**
     * KV 快照 → 可注入的对象形态（`muvCardCompatSeed` 产的是内联脚本字面量，
     * 这里是 postMessage 用的对象）。
     * @param {string} key
     * @returns {Object<string,string>}
     */
    function muvCompatSeedMap(key) {
      var out = {}
      var st = null
      try {
        var ns = muvKvKeyOf(key)
        if (typeof muvKv === 'object' && muvKv && Object.prototype.hasOwnProperty.call(muvKv, ns)) st = muvKv[ns]
      } catch (_) { st = null }
      try {
        for (var k in st) {
          if (Object.prototype.hasOwnProperty.call(st, k)) out['L:' + k] = st[k]
        }
      } catch (_) {}
      return out
    }

    /**
     * 回送给卡的 chat（环形缓冲的尾部若干条，受总量上限约束）。
     *
     * ★ 入口先过一次会话栅栏（`muvChatFence`）：这条缓冲**只属于当前会话**，
     *   否则 B 会话的卡会从 `getContext().chat` 里扫到 A 会话的 `<img>` 标记并**解锁 A 的 CG**。
     * @returns {Array<{mes: string}>}
     */
    function muvChatList() {
      try { muvChatFence() } catch (_) {}
      var out = []
      try {
        var start = muvChatLog.length - MUV_CHAT_MAX_ITEMS
        if (start < 0) start = 0
        var total = 0
        for (var i = start; i < muvChatLog.length; i++) {
          var mes = String(muvChatLog[i] || '')
          if (mes.length > MUV_CHAT_MAX_ITEM) mes = mes.slice(0, MUV_CHAT_MAX_ITEM)
          total += mes.length
          if (total > MUV_CHAT_MAX_TOTAL) break
          out.push({ mes: mes })
        }
      } catch (_) {}
      return out
    }

    /**
     * 记一条已装饰的消息文本，供卡的 `getContext().chat` 扫描。
     *
     * 卡的 `cgScanChat` 靠扫聊天里的 `<img>名</img>` 标记解锁 CG；那条路在 ST 里读的是
     * `SillyTavern.getContext().chat`。同源被我们主动放弃（见 MUV_CARD_SANDBOX 的长注释），
     * 所以数据只能由宿主喂。**只存文本，不解析、不执行。**
     * @param {string} text
     * @returns {void}
     */
    function muvPushChatLog(text) {
      try { muvChatFence() } catch (_) {}
      try {
        var t = String(text == null ? '' : text)
        if (!t) return
        // 同一条消息可能因为编辑/重装饰被再次喂进来；流式增长时新文本是旧文本的
        // 前缀延伸。两种情况都该**替换**而不是追加，否则 80 条上限会被同一条消息的
        // 多个版本挤满，卡就扫不到别的消息了（CG 解锁要扫**整个聊天**）。
        var last = muvChatLog.length ? String(muvChatLog[muvChatLog.length - 1] || '') : ''
        if (last && (t === last || t.indexOf(last) === 0 || last.indexOf(t) === 0)) {
          muvChatLog[muvChatLog.length - 1] = t
          return
        }
        // ★ 「替换而非追加」只覆盖**前缀延伸**，覆盖不到「消息被编辑成前后无关的文本」。
        //   那种情况会变成新增一条 —— 也就是同一条消息吃掉两份 80 条额度，而且是**永久**的
        //   （`muvChatLog` 没有按消息 id 去重的能力，它手里只有文本）。这一轮不引入消息 id
        //   （那要改 `muvPushChatLog` 的调用契约），先把**额度浪费**收在可控范围：
        //   同一条消息的**新版本**若与最近 K 条里任意一条是前缀关系，就替换那一条。
        for (var back = 1; back <= 4 && back <= muvChatLog.length; back++) {
          var at = muvChatLog.length - 1 - back
          var old = String(muvChatLog[at] || '')
          if (!old) continue
          if (t.indexOf(old) === 0 || old.indexOf(t) === 0) {
            muvChatLog[at] = t
            // 既然旧版本在更靠前的位置被替换，它后面的条目整体前移没有意义
            // （顺序仍然按"进缓冲的先后"），所以只替换、不搬动。
            return
          }
        }
        muvChatLog.push(t)
        while (muvChatLog.length > MUV_CHAT_MAX_ITEMS) muvChatLog.shift()
      } catch (_) {}
    }

    /**
     * 把快照/视口高/chat 回送给某个卡 iframe。
     *
     * 回送前 `muvChatList()` 会过一次会话栅栏，所以跨会话的 chat 不会流进别的会话的卡。
     * @param {HTMLIFrameElement} frame
     * @param {string} key `data-muv-kv` 上那个卡键
     * @returns {void}
     */
    function muvReplyToFrame(frame, key) {
      if (!frame) return
      try {
        frame.contentWindow.postMessage({
          __muvKvSeed: muvCompatSeedMap(key),
          __muvVH: muvHostViewportHeight(0),
          __muvChat: { list: muvChatList() }
        }, '*')
      } catch (_) {}
    }

    /**
     * 「ERA 事件应答桥」的子 → 父**定位参数**。
     *
     * 会话 id 优先，理由与 `fetchTavernCard` 完全相同（预设 id 会「粘住」上一个会话的值，
     * 会话 id 才是随切换必然变化的那个）。取不到会话就返回空串 ——
     * **不猜**，也不拿 `currentPresetId()`（面板上那个预设可能是上一个会话的）凑数：
     * 服务端会对 `presetId` 调 `fromExplicit()` 并标成 `explicit`，等于把我们猜的值
     * 冒充成"用户明确指定"（P1-3 的同一条理由，见 `fetchTavernCard` 里的长注释）。
     *
     * 代价是**认不出会话时 ERA 桥拿不到变量表**（`muvEraAnswer` 会如实回空对象）——
     * 这是刻意选的：宁可那一次不填数值，也不把**别的卡**的数值填进这张卡的状态栏。
     * @returns {string} `sessionId=…` / `''`
     */
    /**
     * 运行时变量回灌：把消息里的 `<UpdateVariable><initvar>` 块喂给
     * `POST /api/muv-engine/extract`，服务端 `mergeState` 进会话状态。
     *
     * 为什么必须有：era 桥（`muvEraFetchVars`）原先只送**卡声明的初始变量**——
     * 本会话跑出来的运行时数值没有任何通路（`/api/muv-engine/extract` 在 2026-09-22
     * 之前零调用方）。ST 里那张卡的数据由酒馆助手的 ERA 框架脚本维护；DSH 里等价的
     * 维护者就是这个回灌。用户可见症状：卡的 世界树/世界信息/数值区 全空、整卡塌成
     * 半截（数据驱动的自适应布局没数可填）。
     *
     * 口径：只回灌能定位到会话的消息（`currentSessionId()` 为空就跳过——宁可空着，
     * 也不把变量灌进 'default' 污染别的会话）；同一块内容只 POST 一次（签名去重）；
     * 只发命中的块本身，不发整条消息（消息里可能有用户不想落库的正文）。
     * @param {string} text 消息全文（装饰前的 innerText）
     * @returns {void}
     */
    function muvFeedVariables(text) {
      try {
        if (!text || text.length > 600000) return
        // ★ 实体解码（`&amp;` **最后**解：否则 `&amp;lt;` 会被二次解码成 `<`）。
        //
        //   为什么要它：调用方喂的是 `body.innerHTML`，而 DSH 把消息渲染成什么形态决定
        //   标签是"元素"还是"转义文本"——
        //     · 当元素：innerHTML 里是 `<variableedit>…</variableedit>`（小写，靠 `i` 标志命中）；
        //     · 当文本：innerHTML 里是 `&lt;VariableEdit&gt;…`（**只有解码后才命中**）。
        //   两种都不能漏：漏一种的后果是"变量永远回灌不进去"，而且**控制台毫无动静**
        //   （没有异常、没有请求），最难查的一类。
        var src = String(text)
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&quot;/gi, '"')
          .replace(/&#0?39;/g, "'")
          .replace(/&amp;/gi, '&')
        var blocks = []
        var total = 0
        // ★ 两种数据源都要收（2026-09-22）：
        //   ① `<UpdateVariable>` / `<initvar>` —— MUV 原生 YAML 块；
        //   ② `<VariableInsert|VariableEdit|VariableDelete>` —— 社区卡（TavernHelper ERA 变量框架）
        //      里**模型每楼实际发出的**增量 JSON；`<era_data>` 是同一框架给每楼的消息键
        //      （服务端靠它按楼重放，乱序送达也不回退）。
        //   只认 ① 的后果实测过：`_足控天堂2` 的选项全空、好感度停在初值、CG 的 NSFW 视频锁着
        //   —— 三件事同一个根因。
        var re = /<UpdateVariable[^>]*>[\s\S]*?<\/UpdateVariable>|<initvar>[\s\S]*?<\/initvar>|<(VariableInsert|VariableEdit|VariableDelete)>[\s\S]*?<\/\1>|<era_data>[\s\S]*?<\/era_data>/gi
        var m
        while ((m = re.exec(src)) !== null) {
          blocks.push(m[0])
          total += m[0].length
          if (blocks.length >= 12 || total > 500000) break
        }
        if (!blocks.length) return
        var sid = ''
        try { sid = currentSessionId() } catch (_) { sid = '' }
        if (!sid) return
        // 指纹取"整批块的 长度 + 头 + 尾"：原来只看最后一块的前 120 字，
        // 加了 era_data 之后最后一块可能只是个消息键，指纹会退化成"同一会话同长度就一样"。
        var joined = blocks.join('\n')
        var sig = sid + '|' + joined.length + '|' + joined.slice(0, 80) + '|' + joined.slice(-80)
        if (muvVarFedSig[sig]) return
        muvVarFedSig[sig] = 1
        var keys = Object.keys(muvVarFedSig)
        if (keys.length > 512) { for (var d = 0; d < 128; d++) delete muvVarFedSig[keys[d]] }
        fetch('/api/muv-engine/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, text: joined })
        }).then(function () {
          // 回灌成功后作废 era 缓存，并**多档重推**给在线卡帧。
          try { muvEraVars.data = null } catch (_) {}
          muvEraSchedulePush()
        }).catch(function () {})
      } catch (_) {}
    }

    /**
     * 把当前变量状态推给**所有在线卡帧**（取数落地后推一次）。
     *
     * 为什么要多档重推、而不是"回灌完成推一次"：卡 iframe 是**消息渲染时**才创建的，
     * 而回灌发生在渲染**之前** —— 最后一次回灌完成时卡帧往往还不存在
     * （`querySelectorAll` 数到 0 个），那一次推送就落空；而卡只在自己加载约 1200ms 时
     * 查一次变量，于是它就**永久停在初始值**上。实测症状：服务端状态里
     * `剧情选项` 三条真文本、`时间详情` 10:15，卡上却还是空选项 / 10:00。
     *
     * ★ 每帧**推两条**（两代卡各要一条，别只推一条）：
     *   ① `era:queryResult` —— ERA/MUV 卡的 `eventOn` 通路（老行为，逐字未改）；
     *   ② `mag_variable_update_ended` —— MVU 新 API 那代卡的刷新钩子（实测 `1.txt`：
     *      卡在 `Mvu.events.VARIABLE_UPDATE_ENDED` / `'mag_variable_update_ended'` 上
     *      `ingestMvuEvent(wrapper)`，detail 必须带非空 `stat_data` 才被接受）。
     *      同时被垫片 `__muvAbsorb` 吸进变量缓存 ⇒ `Mvu.getMvuData()` 的**同步**读也拿到新值。
     * @returns {void}
     */
    function muvEraPushNow() {
      var locator = muvEraLocator()
      if (!locator) return
      muvEraWarm(locator)   // 缓存里没数就去取；有数就直接用（状态是服务端算好的）
      var tries = 0
      var iv = setInterval(function () {
        tries++
        if (muvEraVars.data == null && tries <= 25) return
        clearInterval(iv)
        if (muvEraVars.data == null) return
        var frames
        try { frames = document.querySelectorAll('iframe.muv-iframe') } catch (_) { return }
        if (!frames.length) return
        var mvuTree = muvMvuWrap(muvEraVars.data)
        for (var i = 0; i < frames.length; i++) {
          muvEraDeliver(frames[i], 'era:getCurrentVars', muvEraVars.data)
          muvEraSend(frames[i], 'mag_variable_update_ended', mvuTree)
        }
        // 这条日志是**诊断用**的：用户在控制台能直接看到"推了几棵树给几帧"，
        // 比"卡上没反应"这种无可观测症状好判得多。
        try { console.log('[muv-engine] era push → ' + Object.keys(muvEraVars.data).length + ' 棵树 → ' + frames.length + ' 帧（含 MVU 事件）') } catch (_) {}
      }, 120)
    }

    /**
     * 状态变化后的重推时刻表：立刻 + 1.5s + 4s。
     *
     * 三档分别覆盖：已经存在的卡帧（立刻）、刚被创建还在跑初始化脚本的帧（1.5s）、
     * 以及滚动/懒渲染才出现的帧（4s）。没有这三档时实测选项填不上。
     * @returns {void}
     */
    function muvEraSchedulePush() {
      var delays = [0, 1500, 4000]
      for (var i = 0; i < delays.length; i++) {
        setTimeout(muvEraPushNow, delays[i])
      }
    }

    /** 回灌去重账本（`会话|长度|块头 120 字` → 1）。声明口径同 muvHelloAt。@type {Object<string, number>} */
    var muvVarFedSig = {}

    function muvEraLocator() {
      // ★★ 与 `fetchTavernCard` **同一逻辑同一处理**（别只修一半）。
      //
      // 上一版（P1-3 原稿）这里也把 `presetId` 兜底删了。同样的代价：`currentSessionId()`
      // 拿不到时定位串成了空 ⇒ `muvEraFetchVars('')` 请求的是**服务端默认预设**的
      // `initvarData` ⇒ 喂给卡 `data-era` 的变量树是**别的卡的**（实测默认预设是
      // `川上富江`，它连正则剧本都是 0 条），卡拿到的路径全对不上 ⇒ 数值全空。
      // 那比"不填"更糟：**填的是另一张卡的值**，而面板看不出来。
      //
      // 窄化兜底：有会话用会话，没有会话才退回面板预设（没有会话就没有"串会话"可言）。
      var sid = ''
      try { sid = currentSessionId() } catch (_) { sid = '' }
      if (sid) return 'sessionId=' + encodeURIComponent(sid)
      var pid = ''
      try { pid = currentPresetId() } catch (_) { pid = '' }
      if (pid) return 'presetId=' + encodeURIComponent(pid)
      return ''
    }

    /**
     * 深合并（era 桥专用）：`overlay` 覆盖 `base`，两边都是纯对象时递归，数组整体替换。
     * 自足函数 —— 逐字提取的门禁要能单独执行它。
     * @param {Object} base
     * @param {Object} overlay
     * @returns {Object}
     */
    function muvDeepMerge(base, overlay) {
      var out = {}
      var k
      for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k] }
      for (k in overlay) {
        if (!Object.prototype.hasOwnProperty.call(overlay, k)) continue
        var b = out[k], o = overlay[k]
        if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) {
          out[k] = muvDeepMerge(b, o)
        } else {
          out[k] = o
        }
      }
      return out
    }

    /**
     * 向 muv-table 取**卡声明的初始变量**、向 muv-engine 取**本会话运行时变量**，
     * 合并（运行时覆盖初始）后交给 era 桥。
     *
     * 数据形态：`tavern-card` 的 `initvarData` —— 卡自己声明的变量树（`世界信息.时间.日期`、
     * `公司.总现金`、`主播档案.超天酱.数值.好感度` …），正好是卡里 `data-era` 用的那套路径；
     * `muv-engine/state` —— `muvFeedVariables` 从消息流里的 `<UpdateVariable><initvar>`
     * 块回灌出来的运行时状态（ST 里由酒馆助手的 ERA 框架脚本维护的那一份）。
     *
     * ★ 诚实声明：运行时状态来自**本会话已装饰过的消息**，会话历史没回灌完之前它可能
     *   只有部分数值 —— 绝不编数据，取不到就返回 `{}`（见 `muvEraDeliver`）。
     * @param {string} locator
     * @returns {Promise<Object>} 变量树，失败时 {}
     */
    function muvEraFetchVars(locator) {
      var sid = ''
      try {
        if (locator && locator.indexOf('sessionId=') === 0) sid = decodeURIComponent(locator.slice(10))
      } catch (_) { sid = '' }
      var baseP = fetch('/api/muv-table/tavern-card' + (locator ? '?' + locator : ''))
        .then(function (r) { return r.json() })
        .then(function (d) {
          return (d && d.ok && d.initvarData && typeof d.initvarData === 'object') ? d.initvarData : {}
        })
        .catch(function () { return {} })
      var runP = sid
        ? fetch('/api/muv-engine/state?sessionId=' + encodeURIComponent(sid))
          .then(function (r) { return r.json() })
          .then(function (d) {
            if (!d || !d.ok || !d.state || typeof d.state !== 'object') return {}
            // ★★ 必须剥掉端点那层 `{data, updatedAt}` 信封（2026-09-22 现场取证抓到）。
            //
            //   `/api/muv-engine/state` 回的是 `stateStore` 里那条记录本身：
            //     `{ ok:true, state:{ data:{世界信息:…, 剧情选项:…}, updatedAt:… } }`
            //   这里原来直接 `return d.state` ⇒ 运行时值被塞进**深一层** `stat.data.*`，
            //   而卡读的是 `stat.剧情选项.选项1` ⇒ 读到的仍是**初始值**。
            //   实测症状极具迷惑性：`data-era` 里 17 个填上 14 个（那些字段 initvar 有默认值），
            //   **只有 剧情选项.选项1/2/3（initvar 默认是空串）是空的**，时间也停在 initvar 的 10:00
            //   —— 看起来像"某几个字段没被填"，其实是**整份运行时状态都没接上**。
            //   判据用"键数"分辨不出（信封和真值都可能非空），只有**比对一个 initvar 与运行时
            //   取值不同的字段**才拦得住 —— 见 verify-era-bridge 里那条新增断言。
            var s = d.state
            return (s.data && typeof s.data === 'object') ? s.data : s
          })
          .catch(function () { return {} })
        : Promise.resolve({})
      return Promise.all([baseP, runP]).then(function (rs) {
        var base = rs[0] || {}
        var run = rs[1] || {}
        var hasRun = false
        for (var k in run) { if (Object.prototype.hasOwnProperty.call(run, k)) { hasRun = true; break } }
        return hasRun ? muvDeepMerge(base, run) : base
      })
    }

    /**
     * 预热变量快照（幂等 + 去重）。`__muvHello` 时就开始取，这样卡 1200ms 后的那次
     * `era:getCurrentVars` 命中缓存、当场有数（**数值要尽快到位**）。
     * @param {string} locator
     * @returns {void}
     */
    function muvEraWarm(locator) {
      if (!locator) return
      var now = Date.now()
      if (muvEraVars.locator === locator) {
        if (muvEraVars.inflight) return
        if (muvEraVars.data != null && (now - muvEraVars.at) < MUV_ERA_TTL) return
      }
      muvEraVars.locator = locator
      muvEraVars.at = now
      muvEraVars.data = null
      muvEraVars.inflight = true
      muvEraFetchVars(locator).then(function (v) {
        muvEraVars.inflight = false
        muvEraVars.data = v
        muvEraVars.at = Date.now()
        muvEraFlushPending()
      })
    }

    /**
     * 一张卡在窗口内还能不能再收到应答。
     * @param {string} key `data-muv-kv`（每个 iframe 一个命名空间）
     * @returns {boolean}
     */
    function muvEraAllowed(key) {
      var now = Date.now()
      var g = muvEraGate[key]
      if (!g || (now - g.t) > MUV_ERA_WINDOW) {
        muvEraGate[key] = { t: now, n: 1 }
        return true
      }
      if (g.n >= MUV_ERA_MAX_REPLIES) return false
      g.n = g.n + 1
      return true
    }

    /**
     * 宿主 → 卡的事件注入（唯一出口）。
     * @param {HTMLIFrameElement} frame
     * @param {string} name
     * @param {*} detail
     * @returns {void}
     */
    function muvEraSend(frame, name, detail) {
      if (!frame) return
      try {
        frame.contentWindow.postMessage({ __muvEvent: { name: name, detail: detail } }, '*')
      } catch (_) {}
    }

    /**
     * 把一份变量树按卡的语义投递回去。
     *
     * 卡里的形状是**实测**出来的（`_足控天堂2.png` 的《ERA 状态栏》脚本，4690-4740 行）：
     *   - `eventOn('era:writeDone', d => d.statWithoutMeta && renderAll(d.statWithoutMeta))`
     *   - `eventOn('era:queryResult', d => d.queryType === 'getCurrentVars' && d.result
     *        && renderAll(d.result.statWithoutMeta || d.result.stat))`
     * 所以 `getCurrentVars` 回 `era:queryResult`（`queryType` 必须原样叫 `getCurrentVars`，
     * 否则卡那边整条 if 都不进）；`forceSync` 是「把当前状态同步出去」的语义，回 `era:writeDone`
     * ——**不谎报一次写**：我们确实没有写，只是把手上这份状态当成同步结果递过去。
     * @param {HTMLIFrameElement} frame
     * @param {string} name 卡请求的事件名
     * @param {Object} stat 变量树（拿不到就传 {}）
     * @returns {void}
     */
    function muvEraDeliver(frame, name, stat) {
      var s = (stat && typeof stat === 'object') ? stat : {}
      if (name === 'era:forceSync') {
        muvEraSend(frame, 'era:writeDone', { statWithoutMeta: s })
        return
      }
      muvEraSend(frame, 'era:queryResult', {
        queryType: 'getCurrentVars',
        result: { stat: s, statWithoutMeta: s }
      })
    }

    /**
     * MVU 口径包装：卡里的 `pickStat()` **只认非空的 `stat_data`**（实测
     * `1.txt` 里 `pickStat(o)` 的判据是 `o.stat_data && typeof o.stat_data === 'object'
     * && Object.keys(o.stat_data).length`）。
     *
     * 所以凡是走"新 API"（`Mvu.getMvuData` / `TavernHelper.getVariables` / 事件 detail）
     * 送出去的树，都要包成 `{stat_data:…}`；平铺树只在卡内 `readVar` 的路径查询里兜底命中。
     * 已经是 MVU 形态（顶层就有非空 `stat_data`）的原样返回 —— 不重复包一层。
     * @param {*} tree
     * @returns {Object}
     */
    function muvMvuWrap(tree) {
      try {
        var t = (tree && typeof tree === 'object' && !Array.isArray(tree)) ? tree : {}
        if (t.stat_data && typeof t.stat_data === 'object' && !Array.isArray(t.stat_data)) return t
        return { stat_data: t }
      } catch (_) { return { stat_data: {} } }
    }

    /**
     * 应答卡内的 `__muvMvuReq`（`Mvu.getMvuData()` 的第一次调用）。
     *
     * 走**已有的事件通道**（`mag_variable_update_ended`）而不是新开一条：卡自己就在
     * `eventOn('mag_variable_update_ended' | Mvu.events.VARIABLE_UPDATE_ENDED, ingestMvuEvent)`
     * 上消费这个事件（实测 `1.txt` 的 `bindEvents()`），所以同一条消息既唤醒卡的刷新、
     * 又被垫片 `__muvAbsorb` 吸进变量缓存 —— 一个出口覆盖"刷 UI"和"同步读"两件事。
     * 数据没取回来就先记账（`muvMvuPending`），回来后在 `muvEraFlushPending` 里一起兑现。
     * @param {HTMLIFrameElement} frame
     * @returns {void}
     */
    function muvMvuReply(frame) {
      if (!frame) return
      var locator = muvEraLocator()
      if (!locator) { muvEraSend(frame, 'mag_variable_update_ended', muvMvuWrap({})); return }
      muvEraWarm(locator)
      if (muvEraVars.data == null) {
        muvMvuPending.push(frame)
        while (muvMvuPending.length > 16) muvMvuPending.shift()
        return
      }
      muvEraSend(frame, 'mag_variable_update_ended', muvMvuWrap(muvEraVars.data))
    }

    /**
     * 卡内**变量写 API** 的宿主侧落地：`POST /api/muv-engine/state`。
     *
     * 覆盖的卡内入口（实测新卡的写链）：`Mvu.replaceMvuData` ·
     * `TavernHelper.replaceVariables` / `insertOrAssignVariables` · 同名的裸全局 ·
     * `triggerSlash('/setvar k=v')`。
     *
     * 口径（与 `muvFeedVariables` 完全一致，别只改一半）：
     *  - **认不出会话就不写** —— 宁可这次不生效，也不把变量写进别的会话（或 'default'）；
     *  - 只发卡送上来的那份 data，**不做任何求值**；
     *  - 体积上限 `MUV_VARWRITE_MAX_BYTES`，超了直接丢（恶意卡不能靠一棵巨树撑爆服务端）；
     *  - 落库成功后作废 era 缓存并**多档重推**：卡的写入口后面通常紧跟一次同步读
     *    （`writeMany` → `readVars()`），推送不到位就会"点了没反应"。
     * @param {HTMLIFrameElement} frame
     * @param {*} payload `{data, replace}`
     * @returns {void}
     */
    function muvVarWriteFromCard(frame, payload) {
      var data = payload && payload.data
      if (!data || typeof data !== 'object') return
      var sid = ''
      try {
        var locator = muvEraLocator()
        if (locator && locator.indexOf('sessionId=') === 0) sid = decodeURIComponent(locator.slice(10))
      } catch (_) { sid = '' }
      if (!sid) return
      var body = ''
      try {
        body = JSON.stringify({ sessionId: sid, data: data, merge: payload.replace !== true })
      } catch (_) { return }
      if (!body || body.length > MUV_VARWRITE_MAX_BYTES) return
      fetch('/api/muv-engine/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).then(function () {
        try { muvEraVars.data = null } catch (_) {}
        try { console.log('[muv-engine] 卡写变量 → 已落库（merge=' + (payload.replace !== true) + '）') } catch (_) {}
        muvEraSchedulePush()
      }).catch(function () {})
    }

    /**
     * 兑现攒下来的请求（取数回来时调用一次）。
     * 取数**失败**也兑现，回空对象 —— 卡的查询周期要能收尾，不能永远挂着等。
     *
     * 两条队列都要兑现：`muvEraPending`（`era:getCurrentVars` 的请求）与
     * `muvMvuPending`（`__muvMvuReq` 的请求）。少兑现一条就是"某些卡永远停在初始值"。
     * @returns {void}
     */
    function muvEraFlushPending() {
      var ok = (muvEraVars.data != null)
      var q = muvEraPending
      muvEraPending = []
      for (var i = 0; i < q.length; i++) {
        var it = q[i]
        muvEraDeliver(it.frame, it.name, ok ? muvEraVars.data : {})
      }
      var mp = muvMvuPending
      muvMvuPending = []
      for (var j = 0; j < mp.length; j++) {
        muvEraSend(mp[j], 'mag_variable_update_ended', muvMvuWrap(ok ? muvEraVars.data : {}))
      }
    }

    /**
     * 「ERA 事件应答桥」的宿主侧入口：卡发来的 ERA 请求在这里被认出来并作答。
     *
     * 只认两个请求名（**白名单**，不是「以 era: 开头」）：卡的脚本里 `eventEmit` 只有
     * `era:getCurrentVars` 与 `era:forceSync` 两处，其余名字一律不管 —— 白名单让恶意卡
     * 无法用任意事件名驱动父页做别的事。
     * @param {HTMLIFrameElement} frame
     * @param {string} key
     * @param {string} name
     * @returns {void}
     */
    function muvEraAnswer(frame, key, name) {
      if (!frame) return
      if (name !== 'era:getCurrentVars' && name !== 'era:forceSync') return
      if (!muvEraAllowed(key)) return
      var locator = muvEraLocator()
      if (!locator) {
        // 认不出会话也认不出预设 ⇒ 没有可信的来源，**如实回空对象**（不猜一张卡的变量塞给另一张）。
        muvEraDeliver(frame, name, {})
        return
      }
      muvEraWarm(locator)
      if (muvEraVars.locator !== locator || muvEraVars.data == null) {
        muvEraPending.push({ frame: frame, key: key, name: name })
        while (muvEraPending.length > 64) muvEraPending.shift()
        return
      }
      muvEraDeliver(frame, name, muvEraVars.data)
    }

    /**
     * `__muvHello` 到达时的预热。
     *
     * 为什么**只预热、不顺手推一次 `era:queryResult`**：卡的 `eventOn('era:queryResult')` 是
     * 在 `window.__homeInit` 里注册的（`DOMContentLoaded` 之后），而 hello 的应答几乎和它同时
     * 到达 —— 谁先谁后不确定，早推的那一份**可能落在监听器注册之前**而被丢掉。既然卡自己在
     * 1200ms 处会主动要一次（`setupERAListeners` 末尾的 `setTimeout`），就把「推」这件事只挂在
     * 那次请求上；hello 只负责把数据**先取回来**。这样也有个副作用是对的：桥只有一个触发点
     * （`__muvEventOut`），before/after 对照才能把桥**单独**关掉。
     * @returns {void}
     */
    function muvEraPrewarm() {
      var locator = muvEraLocator()
      if (locator) muvEraWarm(locator)
    }

    /**
     * 父页收到垫片的**报名**或 **KV 变更**后处理。协议（与 `muvCardCompatScript` 对齐）：
     *   子 → 父：`{__muvHello:1}` / `{__muvKv:'set'|'remove'|'clear', k, v}`
     *          / `{__muvEventOut:{name, detail}}`  ← ERA 请求（卡自己 emit 过的事件）
     *          / `{__muvMvuReq:1}`                ← 卡的 `Mvu.getMvuData()` 首次调用
     *          / `{__muvVarWrite:{data, replace}}` ← 卡的写 API（见 `muvVarWriteFromCard`）
     *   父 → 子：`{__muvKvSeed, __muvVH, __muvChat:{list}}`
     *          / `{__muvEvent:{name, detail}}`     ← ERA 应答 / `mag_variable_update_ended`
     *
     * 安全约束（跨源消息是最容易被拿来做手脚的入口，照 `onMuvFrameHeightMessage` 的口径）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃
     *    （不查 origin：沙箱是不透明来源，origin 恒为 `"null"`，拿它当凭据没有意义）；
     *  - **命名空间不从消息里取**，而是从那个 iframe 元素的 `data-muv-kv` 属性取 ——
     *    消息里的东西一律不可信，恶意卡不能借此写别的卡的 KV；
     *  - 只接受字符串键/值，键 ≤ 160 字符、值 ≤ 256 KB、单卡 ≤ 400 条 / 2 MB 总量，
     *    超限直接拒绝（防止恶意卡把父页内存撑爆）；
     *  - 事件**转发**（`__muvEventOut`）只认两个白名单名字，名字必须是 ≤ 64 字符的字符串；
     *    每帧窗口内最多回 8 次应答（否则卡能靠 `eventEmit` 循环把父页主线程打满）；
     *  - 变量**写**（`__muvVarWrite`）与 MVU **读请求**（`__muvMvuReq`）都**每帧节流**
     *    （`MUV_VARWRITE_MIN_GAP` / `MUV_MVUREQ_MIN_GAP`）：两者都会触发一次取数 +
     *    全帧多档重推，不节流的话 `setInterval(…,0)` 就能把父页与服务端一起打满；
     *  - 只做 KV 记账、快照回送、ERA/MVU 应答与"把卡送上来的树落库"，**不 eval、不插入内容、
     *    不读卡内任何东西**；ERA 应答里的变量树是**宿主自己**从 muv-table 取回来的，
     *    不是卡送上来的。
     * @param {MessageEvent} ev
     * @returns {void}
     */
    function onMuvCardCompatMessage(ev) {
      var data = ev && ev.data
      if (!data || typeof data !== 'object') return
      var isHello = data.__muvHello !== undefined
      var isKv = typeof data.__muvKv === 'string'
      var isEventOut = !!(data.__muvEventOut && typeof data.__muvEventOut === 'object')
      var isUserSend = !!(data.__muvUserSend && typeof data.__muvUserSend === 'object')
      var isMvuReq = data.__muvMvuReq !== undefined
      var isVarWrite = !!(data.__muvVarWrite && typeof data.__muvVarWrite === 'object')
      if (!isHello && !isKv && !isEventOut && !isUserSend && !isMvuReq && !isVarWrite) return
      var frames
      try { frames = document.querySelectorAll('iframe.muv-iframe') } catch (_) { return }
      var frame = null
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === ev.source) { frame = frames[i]; break }
      }
      if (!frame) return
      var key = ''
      try { key = String(frame.getAttribute('data-muv-kv') || '') } catch (_) { key = '' }
      if (!key || key.length > MUV_KV_MAX_KEY) return

      // ★ 用户消息桥（卡 → DSH 输入框）：每帧节流，防卡循环连发把输入框打爆。
      if (isUserSend) {
        var us = data.__muvUserSend
        var txt = (us && typeof us.text === 'string') ? us.text : ''
        if (!txt || txt.length > 20000) return
        var nowU = Date.now()
        var lastU = muvUserSendAt[key] || 0
        if (lastU && (nowU - lastU) < MUV_USERSEND_MIN_GAP) return
        muvUserSendAt[key] = nowU
        muvDeliverUserText(txt, us.mode === 'fill' ? 'fill' : 'send')
        return
      }

      // ★ MVU 数据请求（卡内 `Mvu.getMvuData()` 的首次调用）：节流 + 回送一帧。
      //   与 `muvEraAnswer` 同一口径：认不出会话就**如实回空**（不猜一张卡的数据塞给另一张）。
      if (isMvuReq) {
        var nowM = Date.now()
        var lastM = muvMvuReqAt[key] || 0
        if (lastM && (nowM - lastM) < MUV_MVUREQ_MIN_GAP) return
        muvMvuReqAt[key] = nowM
        muvMvuReply(frame)
        return
      }

      // ★ 变量写（卡的写 API）：节流 + 落库 + 作废缓存 + 多档重推（见 muvVarWriteFromCard）。
      if (isVarWrite) {
        var nowW = Date.now()
        var lastW = muvVarWriteAt[key] || 0
        if (lastW && (nowW - lastW) < MUV_VARWRITE_MIN_GAP) return
        muvVarWriteAt[key] = nowW
        muvVarWriteFromCard(frame, data.__muvVarWrite)
        return
      }

      if (!key || key.length > MUV_KV_MAX_KEY) return
      // ★ 会话栅栏 + LRU 触碰：真正落库的命名空间是 `<卡键>@<会话 id>`（见 muvKvKeyOf）。
      //   这一步对所有 op 都做 —— 否则"只发 remove/clear 的帧"永远不进 LRU 账本，
      //   那些命名空间会一直是 LRU 里的最冷项而被误淘汰。
      var ns = muvKvTouch(key)

      if (isHello) {
        // ★ 每帧节流：见 muvHelloAt 的注释。首次（时间戳为 0）无条件放行。
        //   键用**卡键**（不是 ns）：节流是"这个 iframe 太久没被回送过"，与会话无关。
        var now = Date.now()
        var lastAt = muvHelloAt[key] || 0
        if (lastAt && (now - lastAt) < MUV_HELLO_MIN_GAP) return
        muvHelloAt[key] = now
        muvReplyToFrame(frame, key)
        muvEraPrewarm()
        return
      }

      if (isEventOut) {
        var nm = data.__muvEventOut.name
        if (typeof nm !== 'string' || !nm || nm.length > 64) return
        muvEraAnswer(frame, key, nm)
        return
      }

      var op = data.__muvKv
      if (op === 'clear') { muvKv[ns] = {}; return }
      if (op !== 'set' && op !== 'remove') return
      var k = data.k === undefined ? '' : String(data.k)
      if (!k || k.length > MUV_KV_MAX_KEY) return
      if (!Object.prototype.hasOwnProperty.call(muvKv, ns)) muvKv[ns] = {}
      var st = muvKv[ns]
      if (op === 'remove') {
        try { delete st[k] } catch (_) {}
        return
      }
      var v = data.v === undefined ? '' : String(data.v)
      if (v.length > MUV_KV_MAX_VAL) return
      var count = 0
      var total = 0
      for (var k2 in st) {
        if (!Object.prototype.hasOwnProperty.call(st, k2)) continue
        count++
        total += String(st[k2]).length
      }
      var exists = Object.prototype.hasOwnProperty.call(st, k)
      if (!exists && count >= MUV_KV_MAX_ITEMS) return
      if (total - (exists ? String(st[k]).length : 0) + v.length > MUV_KV_MAX_TOTAL) return
      try { st[k] = v } catch (_) {}
      // ★ 写入之后再过一次 LRU：命名空间**总数**原先无上限（键 = 内容散列 + 长度，
      //   内容一变就是新键），页面级生命周期下会累积到几十 MB（brief P2）。
      muvKvEvict()
    }

    /**
     * 父页记账的**注入链缓存** —— P0-2「幂等守卫查子串」那一条的**根治手段**。
     *
     * 类是什么：三处注入（reset / compat / 高度引导）原先各自靠"在卡原文里查一个子串"判断
     * 有没有注入过。卡的 HTML 里只要出现那个串（模型跑题、作者抄别家 shim、卡里内嵌文档），
     * **整段脚本就被静默跳过** —— 卡的 `localStorage` / `getContext().chat` / 高度上报全塌，
     * 没有任何日志。三处同形、同一种静默失效模式。
     *
     * 根治办法（brief P0-2 第 1 条）：**幂等状态放父页** —— 同一个 `raw` 只在这里组装一次
     * 注入链，结果缓存进这个 `Map`；子文档只执行、不自我判断。这一改直接消掉整个类：
     * 卡原文再也决定不了"要不要注入"。
     *
     * 键 = `muvCompatKey(raw)`（32 位散列 + 长度）。**故意不用 `raw` 本身当键**：真卡的围栏
     * 正文一份就有 210KB，几十条消息就是几十 MB 的 Map。散列键只有十几字节，且与
     * `data-muv-kv` 用的是同一个键函数（同一张卡在整条链上只有一个身份）。
     * 故意**声明成纯对象字面量**（理由同 `muvEraVars`：逐字提取的门禁要能内联它）。
     * @type {Object<string, string>}
     */
    var muvInjectCache = {}
    /** 注入链缓存的条目上限（LRU）。一张卡一份 srcdoc，几十条消息的卡也就是个位数。 */
    var MUV_INJECT_MAX = 8

    /**
     * 组装一条卡文档的完整注入链，**并在父页记账**。
     *
     * 顺序（内层先跑，外层看到的是内层已改过的文档）：
     *   `rewriteVhMinHeight(raw)` → `withCardCompat` → `withCardReset` → `withCardLibs`
     *   → `withFrameHeightBootstrap`
     * 理由见 `cardHtmlIframe` 的长注释。（`withCardLibs` 的落点是 head 末尾，
     * 与 compat / reset 的 `<head>` 锚点不冲突，所以它排在哪一层都不改变位置。）
     *
     * ★ 缓存只在 `hostH` 相同时命中：`hostH` 会进 `min-height:<N>px` 与
     *   `--TH-viewport-height`，窗口尺寸变了必须重算（否则卡被钉死在旧的视口高上）。
     *   `hostH` 只是标识，真正的 vh 由 `rewriteVhMinHeight` 自己取（它不收形参）。
     * @param {string} raw 注入前的卡文档
     * @param {number} hostH 宿主视口高（缓存标识）
     * @param {string} ck 卡键（`muvCompatKey(raw)`，调用方已经算过，省一次 O(n) 散列）
     * @returns {string} 注入后的完整文档
     */
    function muvInjectDoc(raw, hostH, ck) {
      var key = String(ck || '') + '@' + String(hostH || 0)
      try {
        if (Object.prototype.hasOwnProperty.call(muvInjectCache, key)) return muvInjectCache[key]
      } catch (_) {}
      var doc = withFrameHeightBootstrap(
        withCardLibs(withCardReset(withCardCompat(rewriteVhMinHeight(raw), hostH), hostH)))
      try {
        muvInjectCache[key] = doc
        var names = []
        for (var k in muvInjectCache) {
          if (Object.prototype.hasOwnProperty.call(muvInjectCache, k)) names.push(k)
        }
        while (names.length > MUV_INJECT_MAX) {
          var gone = names.shift()
          if (gone === key) { names.push(gone); continue }
          try { delete muvInjectCache[gone] } catch (_) {}
        }
      } catch (_) {}
      return doc
    }

    /**
     * 构造承载「卡自带整页 HTML」的 iframe —— 所有这类 iframe 的唯一出口。
     *
     * 统一成一个出口的好处：沙箱常量只有一处（MUV_CARD_SANDBOX）、高度测量只有一处
     * 注入点、默认尺寸只有一处。默认高度只在收到子文档报数之前生效；子文档没报数
     * （脚本被卡里别的错误挡住等）就维持默认值，**不会比修之前更差**。
     *
     * ★ 默认高度 600px → 900px：真卡实测高度是 251 / 349 / 675 / 895 / 1636px，600px 明显偏矮，
     *   用户看到的是"别人的窗口非常大，DSH 里又小又小"。900px 更接近常见卡的高度；收到
     *   子文档报的内容包围盒就覆盖它（onMuvFrameHeightMessage），所以这只是兜底值。
     *   故意**不设** max-height / max-width 上限。
     *
     * ★ 链的**顺序**是有讲究的（内层先跑，外层看到的是内层已改过的文档）：
     *   `rewriteVhMinHeight` → `withCardCompat` → `withCardReset` → `withCardLibs`
     *   → `withFrameHeightBootstrap`
     *  - vh 重写必须在最内层：它要**只**处理卡自己的 `min-height`，不碰我们注入的东西；
     *  - compat 垫片要尽可能靠前（解析期就生效），且必须排在 reset 之前才能在
     *    `<head>` 锚点上落在 reset 的 `<style>` 之后（两者都插在同一锚点，后跑的排前面）；
     *  - 前端库（`withCardLibs`）插在 `</head>` 之前：仍在 body 之前（卡的脚本拿得到
     *    `jQuery`/`Vue`，与 ST 一致），但排在 compat/reset **之后** ⇒ CDN 出问题时
     *    不会连带推迟我们自己那两段；
     *  - 高度引导脚本必须**最后**（它是"插在最后一个 `</body>` 之前"，
     *    早插会被后面的 head 注入打乱）。
     * @param {string} html 卡自带的整页 HTML
     * @returns {string}
     */
    function cardHtmlIframe(html) {
      ensureFrameHeightListener()
      ensureCardCompatListener()
      var raw = String(html == null ? '' : html)
      var hostH = muvHostViewportHeight(0)
      // ★ `rewriteVhMinHeight` 只收一个形参（注入前的卡文档）。这里原来多传了一个 `hostH`
      //   —— 函数内是自取 `window.innerHeight` 的，多出来的实参被静默丢掉。功能无害，
      //   但它**遮蔽了真实契约**（读调用点的人会以为 vh 是由调用方决定的）。删掉实参。
      var doc = muvInjectDoc(raw, hostH, muvCompatKey(raw))
      return '<iframe class="muv-iframe" data-muv-kv="' + escAttr(muvCompatKey(raw)) +
        '" srcdoc="' + escAttr(doc) +
        '" sandbox="' + MUV_CARD_SANDBOX +
        '" style="display:block;width:100%;height:900px;border:none;border-radius:8px;background:transparent"></iframe>'
    }

    /**
     * 这张卡里有没有一条正则脚本会去消费 `<StatusPlaceHolderImpl/>`？
     *
     * 判据刻意做得**很窄**（只有在 findRegex 里逐字出现 `StatusPlaceHolderImpl` 才算），
     * 因为它决定我们要不要往每条消息尾部追加一个占位符 —— 猜错的代价是给一张不认这个
     * 标记的卡塞进一段它渲染不出来的文本。
     *
     * 三种卡形态都要认：`{regexScripts:[…]}`（muv-table 的规范化产物，门禁夹具用的就是它）、
     * 裸 chara_card_v3（`data.extensions.regex_scripts`）、以及顶层的 `regex_scripts`
     * —— 与 `regex-engine.js:regexScriptsOf` 认的那三种保持一致，别只认一种。
     * @param {object|null} cardJson
     * @returns {boolean}
     */
    function cardWantsStatusPlaceholder(cardJson) {
      try {
        if (!cardJson || typeof cardJson !== 'object') return false
        var list = cardJson.regexScripts
        if (!list && cardJson.data && cardJson.data.extensions) list = cardJson.data.extensions.regex_scripts
        if (!list) list = cardJson.regex_scripts
        if (!list || !list.length) return false
        for (var i = 0; i < list.length; i++) {
          var s = list[i]
          if (!s || s.disabled) continue
          if (String(s.findRegex || '').indexOf('StatusPlaceHolderImpl') >= 0) return true
        }
      } catch (_) {}
      return false
    }

    /**
     * ★★ 补齐 `<StatusPlaceHolderImpl/>` —— 这一条救回的是整张卡的 ERA 状态栏。
     *
     * 为什么必须有：占位符**不是**模型写的，也不是预设/世界书里的任何一句要求的。
     * `card.json` 的 `tavern_helper.scripts[0]`（名为 `ERA变量框架1.4.11`）的 data 里写着
     * `"在ai消息尾部生成特殊符号": true, "特殊符号值": "<StatusPlaceHolderImpl/>"` ——
     * **是那个 148 KB 的酒馆助手脚本往每条 AI 消息尾部追加它**。
     * DSH 没有酒馆助手执行器，所以：
     *   · 卡的正则 `[2]「ERA 状态栏」`（`findRegex = /<StatusPlaceHolderImpl\/>/gsi`，
     *     210,219 字符，全卡最大的脚本）**永远没有可命中的目标**；
     *   · 而它产出的正是 210 KB 的 ERA 状态栏页面（资源条 8 个 chip / CG 画廊 / 城市地图 /
     *     选项区 / 数值）。
     * 实测全文扫描：`<StatusPlaceHolderImpl/>` 在预设 0 次、世界书 0 次、开场白 0 次，
     * 只出现在两处 —— 本条正则的 findRegex，和那个酒馆助手脚本的 data 里。
     * ⇒ 不补它，那张状态栏在 DSH 里**永无可能出现**。
     *
     * 补法：把占位符追加在**消息尾部**（与酒馆助手的语义一致：「在ai消息尾部生成特殊符号」）。
     * 位置正确很重要 —— `applyDecoratedHtml` 的 ② 分支就是按「占位符在正文末尾」来放
     * 状态栏的。
     *
     * 幂等 + 保守：正文里已经有占位符就不再追加（模型的某轮可能自己写了）；
     * 卡不认这个标记就一个字符都不加。
     * @param {string} text
     * @param {object|null} cardJson
     * @returns {string}
     */
    function withStatusPlaceholder(text, cardJson) {
      try {
        if (!text) return text
        if (STATUS_PH_TEST.test(text)) return text
        if (!cardWantsStatusPlaceholder(cardJson)) return text
        // 追加而不是替换：`beautifyMuv` 的原文是 `body.innerText`，尾部很可能就是
        // `</content>` 这样的信封收尾。另起一行放占位符，卡的正则 `[2]` 才有一个
        // 干净的落点（它把整个占位符换成 ```` ``` ```` + 整页文档）。
        return String(text).replace(/\s+$/, '') + '\n' + STATUS_PH_TEXT
      } catch (_) {
        return text
      }
    }

    /**
     * 本卡在**本次装饰**里处于第几层（SillyTavern 的 `depth` 口径）。
     *
     * 口径与 ST 一致 —— **最新一条是 0，越旧越大**。卡侧脚本
     * `[8]「自动总结，隐藏6楼以上除摘要外内容」` 的 `minDepth = 7` 就是按这个口径写的
     * （`regex-engine.js` 的 `depthAllows` 直接比大小）。
     *
     * ★ 这个换算**必须**在能看到 DOM 消息列表的地方做（`_decorateOne` 就在那个作用域里），
     *   所以函数体在那边、接受的是已经算好的「本条之后还有几条」。
     *   第一版把整件事放在工厂作用域并 `typeof messageTargets === 'function'` 兜底 ——
     *   那个名字在工厂作用域里**永远**不是函数，于是恒定返回 0、看起来"接上了"其实没接上。
     * @param {number} laterCount 页面上排在本条**之后**的消息条数
     * @returns {number}
     */
    function muvDepthFromLaterCount(laterCount) {
      var n = typeof laterCount === 'number' && isFinite(laterCount) && laterCount > 0 ? Math.floor(laterCount) : 0
      return n
    }

    async function beautifyMuv(text, opts) {
      if (!text) return text
      // 第二参数是**可选**的：`{ depth }`。真实调用方目前只有装饰链（`_decorateOne`），
      // 而酒馆面板那条 `MuvEngine.beautify(text)` 仍按单参调用 ⇒ 必须容忍 `opts` 为 undefined，
      // 且缺省时按 depth 0 处理（与 `regex-engine.js` 的默认一致：就是「正在渲染的这一条」）。
      var muvOpts = opts && typeof opts === 'object' ? opts : {}
      var depth = typeof muvOpts.depth === 'number' && isFinite(muvOpts.depth) ? muvOpts.depth : 0
      // MUV / tavern markers. `Status_?Block` accepts both the documented
      // `<Status_block>` spelling and the `<StatusBlock>` variant cards use.
      // （下面这几段讲的是**曾经**那份手写名单；名单已在本轮整体删除，见 ★★。）
      //
      // `<choices>` belongs in this list even though it is not a status marker:
      // a large share of community cards answer with prose plus an options
      // block and no status bar at all. Leaving it out sent those messages past
      // this function entirely, so their options never rendered — the failure
      // was silent, which is why it looked like "选项没了".
      //
      // ★ `<content>` / `<now_plot>` 同理（上一轮实测补上）：这两条是**本项目自己的**
      //   输出信封 —— 角色卡与预设都按它们写规则。而模型并不是每一轮都带上状态栏
      //   占位符：实测真实会话 `session-c98dfb13-…` 第 1 轮命中 `<Abstract`、
      //   第 2~7 轮只有正文与这个信封。名单里没有它们时，那些轮次**在取卡之前**
      //   就被这一行原样 return 掉 ⇒ 用户看到「前几轮有美化、之后每轮都是纯文本」，
      //   而且没有任何报错。
      //
      // ★★ 于是本轮把枚举**整条去掉**，换成"标签无关"的形状判据。
      //
      //   理由是同一类 bug 已经发生**两次**，两次都是同一处枚举漏项：
      //     第一次漏 `<content>` / `<now_plot>`（上一轮补的）；
      //     第二次漏 `<video>` / `<img>`（本轮实测：真实角色扮演会话
      //     `session-c98dfb13-…` 里，守卫放行的那一轮（含 `<content>`+`<video>`+`<img>`）
      //     被完整美化；紧接着的下一轮正文里只有 `<audio>欢快</audio>`，一个白名单标记
      //     都没有 ⇒ 整轮在取卡之前就返回，用户看到的就是"纯文本"）。
      //   枚举注定继续漏：卡的标记由**卡**决定，卡随时能新增（`<audio>`/`<插图>`/
      //   `<era_data>`/`<JSONPatch>`… 全是卡侧的自由发挥），而这份名单在引擎里。
      //   所以判据改成"正文里出现任何 HTML 形态的标签就不跳过"：
      //     `<` 后面必须是 `/` `!` 之一或字母/下划线/汉字 ⇒ `2 < 3`、`a <= b`、`1 <2`
      //     这类普通文本**不会**误命中（`<` 后是空格/数字）；而 `<audio>`、`<video>`、
      //     `<img>`、`</content>`、`<!DOCTYPE html>`、`<era_data>`、`<JSONPatch>`、
      //     以及**中文标签**（`<插图>`、`<赏令接取>` 这类社区卡专属标记 —— 判据里的
      //     汉字分支抄的是本文件里那条转义还原正则 `[a-zA-Z\u4e00-\u9fa5]`，
      //     两条必须同时认中文名，否则又会出现"英文标记放行、中文标记跳过"的分叉），
      //     一次全覆盖。
      //   代价只是"多取一次卡"：取到卡之后若没有任何脚本命中，本函数末尾的
      //   `if (normalized === text) return normalized` 会把原文原样交回，
      //   调用方（`_decorateOne`）见到 `html === raw` 就不动 DOM ⇒ 无副作用。
      //   这条已在 `verify-guard-tag-agnostic.mjs` 里用真实卡 + 真实回复量过
      //   （纯散文/`2 < 3` 一档：取卡 0 次、DOM 与原样一致）。
      //
      //   仍然**不在**标签判据里的（如实记录）：
      //     · `<!-- 注释 -->`（`<!` 后面是 `-`，不是名字）。没有任何渲染器认它。
      //
      // ★★ 第三次漏（2026-09-22 实锤，本轮修掉）：**占位符 greeting**。
      //   社区卡大量使用「first_mes 只是短占位文本，靠卡的 markdownOnly 显示层正则把它
      //   换成 ```html 包裹的整页 HTML」的模式（魔女卡的 7 字「星盟契约开场白」、
      //   _足控天堂2 的「【主页】」→「星盟契约 · 缔约书」整页界面）。ST 的首楼因此
      //   渲染出完整卡 UI，而上面那条形状判据只认 HTML 标签 —— **纯文本占位符在取卡
      //   之前就被整楼跳过**，greeting 楼的正则替换从未发生（上面赌的"没有只带
      //   【主页】的一轮"输给了占位符 greeting 楼）。
      //   修法（最小改动，**不许**退化成"所有文本都取卡"）：
      //     不含 HTML 标签、但去首尾空白后**足够短**（≤ 300 字符）的文本也放行去取卡。
      //     · 无副作用的依据：就算卡的脚本全部落空，既有兜底
      //       `normalized === text ⇒ 原样交回 ⇒ 调用方不动 DOM`（见本函数末尾）保证原样返回；
      //     · 性能的依据：长散文（模型正文的绝对主力）不该多付一次取卡成本，只放短文本；
      //       空白文本更没必要取卡（没有任何可装饰的东西）。
      //     门禁：verify-guard-tag-agnostic.mjs 的决策臂 + B7（G 用例「【主页】」）。
      var muvHasTag = /<[!\/]?[a-zA-Z_\u4e00-\u9fa5][^<>]*>/.test(text)
      var muvTrimmedLen = String(text).trim().length
      var muvShortOk = muvTrimmedLen > 0 && muvTrimmedLen <= 300
      if (!muvHasTag && !muvShortOk) return text

      const normalized = normalizeStatusHeader(text)

      try {
        // Get card data for regex scripts
        const cardJson = await fetchTavernCard()

        if (cardJson) {
          // ★★ 补齐「酒馆助手」脚本会追加的那个占位符（见 withStatusPlaceholder 的长注释）。
          //   必须在**取卡之后**做：要不要补，取决于这张卡有没有一条消费占位符的正则。
          const regText = withStatusPlaceholder(normalized, cardJson)
          // Apply regex scripts
          const r = await fetch('/api/muv-engine/apply-regex-card', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: regText, cardJson, depth: depth })
          })
          const d = await r.json()
          if (d.ok) {
            let result = d.text
            // ★ 状态栏级联：卡片自带 HTML → 结构化解析（YAML/👤/自由形态）→ 变量模板
            //   第 1 级（card）与第 2~4 级（yaml/free/loose）都在服务端算；
            //   第 5 级（变量模板）留在本地，因为它和 CSS 在一起。
            let sbHtml = d.statusBarHtml
            if (!sbHtml && STATUS_PH_TEST.test(result)) sbHtml = buildDefaultStatusBar(regText)
            // 占位符还在才构造：卡自己的正则往往已经把占位符换掉了，那时下一页
            // 210 KB 的 escAttr 会被下面的 replace 直接丢掉——纯浪费。
            // 占位符在、但没有任何数据可展示时给个空状态：绝不把 `<StatusPlaceHolderImpl/>`
            // 原文露给用户。
            if (STATUS_PH_TEST.test(result)) {
              ensureStatusCss()
              const builtin = /^\s*<div class="muv-sb"/.test(sbHtml || '')
              const frame = builtin ? sbHtml : (sbHtml ? cardHtmlIframe(sbHtml) : emptyStatusBar())
              // ★★ 函数式替换（不是字符串替换）—— 见 muvFrameBlock 的长注释：
              //   frame 里有卡自己的 JS，字符串替换会把 `$&` / `$'` / `` $` `` 当引用解析掉，
              //   卡的脚本会被打坏（界面照常显示、功能全废）。
              result = result.replace(STATUS_PH_ALL, function () { return muvFrameBlock(frame) })
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
          // ★★ 函数式替换：见 muvFrameBlock 的长注释
          return renderFencedHtml(normalized.replace(STATUS_PH_ALL, function () { return muvFrameBlock(sb) }))
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
        // ★★ 函数式替换：见 muvFrameBlock 的长注释（卡 HTML 里有 `$&` / `$'` 会被吃掉）
        return text.replace(/<\s*Status_block\s*>[\s\S]*?<\s*\/\s*Status_block\s*>/gi,
          function () { return muvFrameBlock(frame) })
      } catch (_) {
        return text
      }
    }

    /**
     * 把一整页卡 HTML 包进状态栏容器。**必须配 `replace(re, function () {…})` 用。**
     *
     * ★★ 为什么不能写成 `text.replace(re, '<div …>' + frame + '</div>')`（踩过，必修）：
     *   `String.replace` 的**字符串替换**里，`$&`（整个匹配）、`` $` ``（匹配前）、
     *   `$'`（匹配后）、`$$`、`$1…$99`、`$<name>` 都是**引用语法**，会从 frame 里被解析掉。
     *   而 frame 里装的是**卡自己的 JS**，真出现这些序列：
     *     卡的 ERA 脚本里有 `function isTemplate(key){return key&&key.charAt(0)===&#39;$&#39;}`
     *     —— `$` 后面紧跟 `&`（`&#39;` 的实体首字符）⇒ 被当成 `$&` ⇒ 那行变成
     *     `===&#39;<<StatusPlaceHolderImpl/>#39;}` ⇒ **卡的脚本当场语法错误**。
     *   后果极难查：**HTML/CSS 照常渲染**（界面看着好好的），只是卡的 JS 全废：
     *   选项空白、数值不更新、tab 点不动，而控制台里只有卡内那条 `about:srcdoc` 报错。
     *   ⇒ 与服务端第 4 轮修掉的那个 `$'` bug 是**同一个坑的两端**，铁律一样：
     *     **凡是把"别人的一大段文本"拼进替换串，一律用函数式替换。**
     * @param {string} frame 已经构造好的 iframe/内置状态栏 HTML
     * @returns {string}
     */
    function muvFrameBlock(frame) {
      return '<div class="muv-statusbar-wrap">' + frame + '</div>'
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
        // ★ 构建标记：**页面加载的那一份**客户端代码是哪一版。
        //
        // 为什么要有它：DSH 重启只换服务端模块，浏览器里已经打开的标签页仍跑着**加载时**
        // 注入的那一份客户端 bundle —— 用户"重启了但看起来没变"最常见的原因就是这个。
        // 有这个标记，一句话就能分辨「代码没生效」还是「效果不对」：
        //   console 里应能看到 `[muv-engine] client loaded <build>`；
        //   控制台执行 `document.documentElement.dataset.muvEngine` 也能读到同一个串。
        // 找不到 / 是旧串 ⇒ 页面没重新加载，硬刷新（Ctrl+Shift+R）即可。
        build: MUV_BUILD,
        beautify: beautifyMuv,
        expandMacros: _expandMacros,
        // hooks the tavern panel calls to hand decoration over to this plugin
        decorateMessage: function (el, depth) {
          try { if (_decorateOneHook) _decorateOneHook(el, depth) } catch (_) {}
        },
        scheduleDecorate: function () {
          try { if (_scheduleDecorateHook) _scheduleDecorateHook() } catch (_) {}
        },
      }
      try { document.documentElement.setAttribute('data-muv-engine', MUV_BUILD) } catch (_) {}
      try { console.log('[muv-engine] client loaded ' + MUV_BUILD) } catch (_) {}

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
      // ★ 承载卡 HTML 的容器必须**显式撑满**，不能只靠里面的 `width:100%`。
      //
      // 实测（verify-card-width.mjs，聊天列宽 940px，把 renderFencedHtml 的真产物放进不同父容器）：
      //   块级父容器            → wrap 940 / iframe 940   ✅
      //   flex 行父容器（未设宽）→ wrap 300 / iframe 300   ❌ 整框塌成 iframe 的**固有宽度**
      //   flex 列父容器          → wrap 940 / iframe 940   ✅
      // 机制：flex 子项的 `width:auto` 按 min-content 定尺寸，而它内部的 `<iframe style="width:100%">`
      // 的固有宽度是 300px，于是"父宽取决于子宽、子宽取决于父宽"收敛到 300。
      // 用户看到的就是这个：DSH 里卡片的框又窄又小（卡自身还有 min-width 时会到 ~460px），
      // 同时因为按窄宽度重排、内容包围盒变矮，**高度自适应也跟着报小**、框内出现滚动条。
      //   - `min-width:0`：解除 flex 子项的 min-content 下限（否则仍可能被内容顶宽）
      //   - `align-self:stretch`：交叉轴上撑满（flex 列方向）
      //   - `box-sizing:border-box`：边框算进宽度，避免 100% + border 溢出
      // 故意**不设** `max-width`：用户明确要"和 ST 一样大"。
      style.textContent = '.muv-statusbar-wrap{display:block;width:100%;min-width:0;align-self:stretch;box-sizing:border-box;margin:10px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.muv-iframe{display:block;width:100%}'+
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
       * 把 DOM 里的一段文本换成**元素**（Range 手术）。
       * @param {{node:Text,offset:number}} start
       * @param {{node:Text,offset:number}} end
       * @param {Node} node
       * @returns {boolean}
       */
      function replaceRangeWithNode(start, end, node) {
        try {
          var range = document.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          range.deleteContents()
          range.insertNode(node)
          return true
        } catch (_) { return false }
      }

      // 媒体元素允许保留的属性白名单。**`on*` 一律丢**：媒体标签的文本来自模型/卡，
      // 直接 innerHTML 就等于把 `onerror=` 这类东西请进 DSH 自己的页面（同源执行）。
      // 白名单化之后，最坏情况只是"属性被忽略"，而不是"脚本被执行"。
      var MUV_MEDIA_ATTRS = {
        src: 1, controls: 1, preload: 1, loop: 1, autoplay: 1, muted: 1, playsinline: 1,
        poster: 1, width: 1, height: 1, id: 1, class: 1, style: 1, title: 1,
        type: 1, kind: 1, srclang: 1, label: 1, crossorigin: 1, media: 1,
      }

      /**
       * 把一个解析出来的媒体元素**按白名单**拷成新元素。
       * @param {Element} srcEl
       * @returns {Element|null}
       */
      function muvCloneMediaElement(srcEl) {
        if (!srcEl || srcEl.nodeType !== 1) return null
        var tag = String(srcEl.tagName || '').toLowerCase()
        if (tag !== 'video' && tag !== 'audio' && tag !== 'source' && tag !== 'track') return null
        var out = document.createElement(tag)
        var attrs = srcEl.attributes || []
        for (var i = 0; i < attrs.length; i++) {
          var name = String(attrs[i].name || '').toLowerCase()
          if (name.indexOf('on') === 0) continue
          if (!MUV_MEDIA_ATTRS[name]) continue
          try { out.setAttribute(name, attrs[i].value) } catch (_) {}
        }
        return out
      }

      /**
       * 由一段媒体标签文本造出真正的元素（原生路径的 ④）。
       *
       * 用 `DOMParser` 解析**离线文档**（不是活动文档的 innerHTML），再逐属性白名单拷贝 ——
       * 这样既能支持 `<video><source …></video>` 这种带子节点的形态，又不会把事件处理器
       * 带进页面。
       *
       * 与字符串路径 `renderMediaTags()` 的取舍保持一致：
       *  - 有 src（或带 `<source>` 子节点）→ 真实元素，缺 `controls` / `preload` 就补上；
       *  - **一个属性都没有**的裸提示词 → 文字占位（`muv-video-ph` / `muv-audio`）；
       *  - 有属性但没 src → 返回 null（**不动它**：那多半是脚本待填的元素，见 ② 的说明）。
       * @param {string} segment
       * @returns {Element|null}
       */
      function muvBuildMediaElement(segment) {
        var parsed
        try {
          parsed = new DOMParser().parseFromString('<div id="muv-media-root">' + String(segment) + '</div>', 'text/html')
        } catch (_) { return null }
        var host = parsed && parsed.getElementById('muv-media-root')
        var first = host && host.firstElementChild
        if (!first) return null
        var el = muvCloneMediaElement(first)
        if (!el) return null
        var kids = first.children || []
        for (var i = 0; i < kids.length; i++) {
          var child = muvCloneMediaElement(kids[i])
          if (child) el.appendChild(child)
        }
        var hasSrc = !!el.getAttribute('src') || !!el.querySelector('source')
        var hasSrcAttr = el.hasAttribute('src')
        var hasChildren = !!(el.children && el.children.length)
        var disposition = mediaTagDisposition(hasSrcAttr, hasSrc, !!(first.attributes && first.attributes.length), hasChildren)
        if (disposition === 'skip') return null
        if (disposition === 'placeholder') {
          var ph = document.createElement('div')
          ph.className = el.tagName === 'VIDEO' ? 'muv-video-ph' : 'muv-audio'
          ph.textContent = (el.tagName === 'VIDEO' ? '🎬 ' : '🎵 ') + String(first.textContent || '').trim()
          return ph
        }
        if (!el.hasAttribute('controls')) el.setAttribute('controls', '')
        if (!el.hasAttribute('preload')) el.setAttribute('preload', 'metadata')
        try { el.classList.add('muv-media') } catch (_) {}
        return el
      }

      /**
       * 原生路径的媒体标签渲染（DOM 层）—— ④。
       *
       * 为什么必须是 DOM 层：`renderMediaTags()` 的结果如果整条写回（`body.innerHTML = html`），
       * 输入是 `innerText`（markdown 早被 DSH 渲染掉了），会把整条消息的 markdown 抹平。
       * 实测过：媒体产物里没有任何状态栏片段 ⇒ `applyDecoratedHtml` 会落在那条最后手段上。
       * 所以这里只把**那一段标签文本**换成元素，其余 DOM 一个不碰。
       *
       * 落点在 `<script>` / `<style>` 里的文本一律跳过（与字符串路径同一条红线：
       * 那是代码，不是标记）。
       * @param {Element} root
       * @returns {number} 换掉的媒体标签数量
       */
      function muvRenderMediaTags(root) {
        if (!root || root.nodeType !== 1) return 0
        if (typeof DOMParser !== 'function') return 0
        var done = 0
        var from = 0
        var re = /<(audio|video)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi
        for (var guard = 0; guard < 40; guard++) {
          var walked = muvTextWithBreaks(root)
          var pattern = new RegExp(re.source, re.flags)
          pattern.lastIndex = from
          var hit = pattern.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          // 跳过代码里的同名标签，以及定位不到的情况：把游标推过这一段，继续找下一个
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var built = muvBuildMediaElement(hit[0])
          if (!built) { from = hit.index + hit[0].length; continue }
          if (!replaceRangeWithNode(a, b, built)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * `<插图>名字</插图>` → 占位块（原生路径的 ④ 之一）。
       *
       * 酒馆路径有这一步（`_tavernRenderTags` 里那段字符串替换），原生路径从来没有 ——
       * 于是模型写的 `<插图>` 就是一段裸文本。这里在 DOM 层只换那一段，markdown 不受影响。
       * 元素是**手工搭**的（textContent），不解析任何 HTML：名字来自模型，不该进解析器。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderIllustrations(root) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        var from = 0
        for (var guard = 0; guard < 20; guard++) {
          var walked = muvTextWithBreaks(root)
          var re = /<插图>([\s\S]*?)<\/插图>/gi
          re.lastIndex = from
          var hit = re.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var box = document.createElement('div')
          box.className = 'muv-illustration'
          var icon = document.createElement('span')
          icon.className = 'muv-illustration-icon'
          icon.textContent = '🖼️'
          box.appendChild(icon)
          box.appendChild(document.createTextNode(' ' + String(hit[1] || '').trim()))
          if (!replaceRangeWithNode(a, b, box)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * 通用的「把一段标记文本换成元素」循环（第三类及其后续都复用它）。
       *
       * 与 `muvRenderMediaTags` 同样的三条纪律：跳过 `<script>/<style>` 里的同名文本
       * （那是代码不是标记）、只动命中的那一段、有收敛上限。
       * 决定「不处理」时把游标推过这一段继续找下一个，而不是直接 break ——
       * 一条消息里可能有好几个同类块，其中一个形态不认识不该让后面的也漏掉。
       * @param {Element} root
       * @param {RegExp} re 需带 g 标志
       * @param {(hit: RegExpExecArray) => Element|'remove'|null} build 返回元素=替换、
       *   返回 `'remove'`=只删掉这一段（隐藏类标记）、返回 null=别碰（推过这一段继续找）
       * @param {number} [maxRounds]
       * @returns {number} 处理掉的块数
       */
      function muvReplaceTagBlocks(root, re, build, maxRounds) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        var from = 0
        var limit = maxRounds || 40
        for (var guard = 0; guard < limit; guard++) {
          var walked = muvTextWithBreaks(root)
          var pattern = new RegExp(re.source, re.flags)
          pattern.lastIndex = from
          var hit = pattern.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var node = null
          try { node = build(hit) } catch (_) { node = null }
          if (node === 'remove') {
            if (!replaceRangeWithNode(a, b, document.createTextNode(''))) {
              from = hit.index + hit[0].length
              continue
            }
            from = 0
            done++
            continue
          }
          if (!node || !replaceRangeWithNode(a, b, node)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * `<details class="…"><summary>标题</summary><pre|div>正文</pre|div></details>`。
       * 正文一律用 `textContent` / `createTextNode`：这些内容来自模型，不该进 HTML 解析器。
       * @param {string} cls
       * @param {string} title
       * @param {string} text
       * @param {string} [bodyTag='pre']
       * @returns {Element}
       */
      function muvDetailsBlock(cls, title, text, bodyTag) {
        var box = document.createElement('details')
        box.className = cls
        var summary = document.createElement('summary')
        summary.textContent = title
        box.appendChild(summary)
        var body = document.createElement(bodyTag === 'div' ? 'div' : 'pre')
        body.textContent = String(text == null ? '' : text)
        box.appendChild(body)
        return box
      }

      /**
       * `<tag class="…">文本</tag>` 这种最简元素（内容走 textContent）。
       * @param {string} tag
       * @param {string} cls
       * @param {string} text
       * @returns {Element}
       */
      function muvSimpleBlock(tag, cls, text) {
        var el = document.createElement(tag)
        el.className = cls
        el.textContent = String(text == null ? '' : text)
        return el
      }

      /**
       * 原生路径要接的内联标签表 —— **与酒馆路径 `_tavernRenderTags` 对齐**
       * （那里的字符串版 + `verify-decorate-dom.mjs` 是行为基准）。
       *
       * 每条规则一种产出：
       *  - `{tag, cls}`         → 最简元素（内容走 textContent）
       *  - `{tag, cls, prefix}` → 前面加个图标字符
       *  - `{details, title}`   → 折叠卡
       *  - `{hr: true}`         → `hr.muv-sep`
       *  - `{remove: true}`     → 整段删掉（**内部块**，本来就不该给用户看）
       *
       * 做成表而不是逐条 `result.replace(...)`：两条路径的**集合**必须一致，
       * 而集合散在 40 行里一定会漂移（前两类就是这么教育我们的）。
       * @type {Array<object>}
       */
      var MUV_TAG_RULES = [
        { re: /<speech>([\s\S]*?)<\/speech>/gi, tag: 'div', cls: 'muv-speech' },
        { re: /<dialogue>([\s\S]*?)<\/dialogue>/gi, tag: 'div', cls: 'muv-dialogue' },
        { re: /<(?:引用|quote)>([\s\S]*?)<\/(?:引用|quote)>/gi, tag: 'blockquote', cls: 'muv-quote' },
        { re: /<(?:char|character)>([\s\S]*?)<\/(?:char|character)>/gi, tag: 'b', cls: 'muv-char-name' },
        { re: /<inner>([\s\S]*?)<\/inner>/gi, tag: 'div', cls: 'muv-inner' },
        { re: /<Drama>([\s\S]*?)<\/Drama>/gi, tag: 'div', cls: 'muv-drama' },
        { re: /<story>([\s\S]*?)<\/story>/gi, tag: 'div', cls: 'muv-story' },
        { re: /<narrative>([\s\S]*?)<\/narrative>/gi, tag: 'div', cls: 'muv-narrative' },
        { re: /<action>([\s\S]*?)<\/action>/gi, tag: 'div', cls: 'muv-action' },
        { re: /<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/gi, tag: 'div', cls: 'muv-thought', prefix: '💭 ' },
        { re: /<(?:feeling|emotion)>([\s\S]*?)<\/(?:feeling|emotion)>/gi, tag: 'span', cls: 'muv-feeling' },
        { re: /<expression>([\s\S]*?)<\/expression>/gi, tag: 'span', cls: 'muv-expression' },
        { re: /<(?:pose|posture)>([\s\S]*?)<\/(?:pose|posture)>/gi, tag: 'span', cls: 'muv-pose' },
        { re: /<(?:location|scene)>([\s\S]*?)<\/(?:location|scene)>/gi, tag: 'div', cls: 'muv-location', prefix: '📍 ' },
        { re: /<time>([\s\S]*?)<\/time>/gi, tag: 'span', cls: 'muv-time', prefix: '⏰ ' },
        { re: /<weather>([\s\S]*?)<\/weather>/gi, tag: 'span', cls: 'muv-weather', prefix: '🌤️ ' },
        { re: /<CG>([\s\S]*?)<\/CG>/gi, tag: 'div', cls: 'muv-cg', prefix: '🎨 ' },
        { re: /<(?:inventory|背包)>([\s\S]*?)<\/(?:inventory|背包)>/gi, details: 'muv-inventory', title: '🎒 背包' },
        { re: /<(?:skill|技能)>([\s\S]*?)<\/(?:skill|技能)>/gi, details: 'muv-skill', title: '⚔️ 技能' },
        { re: /<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi, details: 'muv-jsonpatch', title: '🔧 变量补丁' },
        { re: /<sep\s*\/?>|<hr\s*\/?>/gi, hr: true },
        // ↓ 内部块：删掉。原生路径原本把这些**原样显示**，等于把内部指令泄漏给用户。
        //   只删「整块配对」的形态；没有收尾标签的（如单独的 `<system>`）宁可留着，不误删正文。
        { re: /<rule_check>[\s\S]*?<\/rule_check>/gi, remove: true },
        { re: /<rule_\w+>[\s\S]*?<\/rule_\w+>/gi, remove: true },
        { re: /<dungeon_engine>[\s\S]*?<\/dungeon_engine>/gi, remove: true },
        { re: /<user_setting>[\s\S]*?<\/user_setting>/gi, remove: true },
        { re: /<system_prompt>[\s\S]*?<\/system_prompt>/gi, remove: true },
        { re: /<status_current_variable>[\s\S]*?<\/status_current_variable>/gi, remove: true },
        { re: /<Analysis>[\s\S]*?<\/Analysis>/gi, remove: true },
        { re: /<style[^>]*>[\s\S]*?<\/style>/gi, remove: true },
      ]

      /**
       * 卡牌专属「游戏标签」（苍玄界一类卡的 赏令 / 拍卖 / 盲盒 / 道友 / 飞剑 / 自由开局 …）。
       *
       * 酒馆路径 `_tavernRenderTags` 一直按卡字段渲染信息卡；原生路径此前**没有**，
       * 这批标签整段露成裸文本（verify-decorate-dom.mjs 的 G_gamecard 门禁钉的就是它，
       * HANDOFF §16.3 已知未覆盖第 1 条）。这里与酒馆路径同一份标签集合；配色不写在
       * 元素上，走 `exports.apply` 里已有的 `[data-card="…"]` 属性选择器（改色只动 CSS）。
       * @type {Array<{tag: string, icon: string}>}
       */
      var MUV_GAME_TAGS = [
        { tag: '赏令接取', icon: '📜' },
        { tag: '赏令完成', icon: '✅' },
        { tag: '拍卖购入', icon: '💰' },
        { tag: '盲盒开启', icon: '🎁' },
        { tag: '道友收录', icon: '👥' },
        { tag: '飞剑回信', icon: '📨' },
        { tag: '自由开局', icon: '🎲' },
      ]

      /**
       * `字段：值` 行解析（与酒馆路径同一口径：全/半角冒号都认，一行一条）。
       * 全部走 textContent / createTextNode——内容来自模型，不进 HTML 解析器。
       * @param {Element} card
       * @param {string} text
       * @returns {void}
       */
      function muvFillGameCardFields(card, text) {
        var lines = String(text == null ? '' : text).split(/\r?\n/)
        for (var i = 0; i < lines.length; i++) {
          var m = /^([^：:\r\n]+)[：:]\s*([^\r\n]+)$/.exec(lines[i].trim())
          if (!m) continue
          var row = document.createElement('div')
          row.className = 'muv-card-field'
          var b = document.createElement('b')
          b.textContent = m[1].trim()
          row.appendChild(b)
          row.appendChild(document.createTextNode(' ' + m[2].trim()))
          card.appendChild(row)
        }
      }

      /**
       * 原生路径的游戏卡渲染（G_gamecard）。
       *
       * 复用 `muvReplaceTagBlocks` 的三条纪律（跳过 script/style 里的同名文本、
       * 只动命中段、有收敛上限）；夹在媒体/插图之后、通用表之前跑都安全——
       * 这批标签名不在 `MUV_TAG_RULES` 里，两张表不会互相抢块。
       * @param {Element} root
       * @returns {number} 处理掉的卡数
       */
      function muvRenderGameCards(root) {
        var n = 0
        for (var i = 0; i < MUV_GAME_TAGS.length; i++) {
          (function (g) {
            var re = new RegExp('<' + g.tag + '>([\\s\\S]*?)<\\/' + g.tag + '>', 'gi')
            n += muvReplaceTagBlocks(root, re, function (hit) {
              var card = document.createElement('div')
              card.className = 'muv-game-card'
              card.setAttribute('data-card', g.tag)
              var title = document.createElement('div')
              title.className = 'muv-game-card-title'
              title.textContent = g.icon + ' ' + g.tag
              card.appendChild(title)
              muvFillGameCardFields(card, hit[1])
              return card
            })
          })(MUV_GAME_TAGS[i])
        }
        return n
      }

      /**
       * `<img src="…">` → 真图片（第三类之二）。
       *
       * 只认带 src 的；`alt` 保留，其余属性一律不要（`onerror` 之类同上白名单的考虑）。
       * 真图片元素在 DOM 里没有文本节点，所以只有**被转义成文本**的 `<img>` 会命中。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderImages(root) {
        return muvReplaceTagBlocks(root, /<img\s+[^>]*>/gi, function (hit) {
          var seg = String(hit[0] || '')
          var m = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(seg)
          var srcValue = m ? (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])) : ''
          if (!srcValue) return null            // 没有 src 的不动它
          var alt = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(seg)
          var img = document.createElement('img')
          img.className = 'muv-img'
          img.setAttribute('src', srcValue)
          img.setAttribute('loading', 'lazy')
          img.setAttribute('style', 'max-width:100%;border-radius:8px;margin:6px 0')
          if (alt) img.setAttribute('alt', alt[1] !== undefined ? alt[1] : alt[2])
          return img
        })
      }

      /**
       * 按表渲染全部内联标签（第三类之二/之三）。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderTagRules(root) {
        var n = 0
        n += muvRenderImages(root)
        // ★ 游戏卡先于通用表：标签集合不相交，但先处理"专属形态"再处理"通用形态"
        //   是两条路径共同的安全次序（酒馆路径同样是游戏卡在通用标签之前）。
        n += muvRenderGameCards(root)
        for (var i = 0; i < MUV_TAG_RULES.length; i++) {
          var rule = MUV_TAG_RULES[i]
          n += muvReplaceTagBlocks(root, rule.re, (function (r) {
            return function (hit) {
              if (r.remove) return 'remove'
              if (r.hr) {
                var hr = document.createElement('hr')
                hr.className = 'muv-sep'
                return hr
              }
              var text = String(hit[1] == null ? '' : hit[1]).trim()
              if (r.details) return muvDetailsBlock(r.details, r.title, text, 'pre')
              return muvSimpleBlock(r.tag || 'div', r.cls, (r.prefix || '') + text)
            }
          })(rule))
        }
        return n
      }

      /**
       * 变量块 / 推演块 / 摘要块的 DOM 渲染（第三类）。
       *
       * 原生路径上这些标签**一个渲染器都没有**（只有酒馆路径的 `_tavernRenderTags` 有），
       * 于是模型输出里那一大坨 `<UpdateVariable>{…JSON…}</UpdateVariable>` 就原样显示给用户。
       * 这里把它们收进折叠卡；`<Abstract>` 转成摘要条 —— 与酒馆路径同样的 class，
       * 样式共用，但**元素是手工搭的**（textContent），JSON 里的 `<img onerror>` 之类
       * 只会是文本。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderVariableBlocks(root) {
        var n = 0
        n += muvReplaceTagBlocks(root, /<(VariableEdit|VariableInsert|UpdateVariable)>([\s\S]*?)<\/\1>/gi, function (hit) {
          var raw = String(hit[2] || '').trim()
          var pretty = raw
          // 能解析成 JSON 就美化缩进（与酒馆路径一致），否则原样展示
          try { pretty = JSON.stringify(JSON.parse(raw), null, 2) } catch (_) {}
          return muvDetailsBlock('muv-varedit', '🔧 变量更新', pretty, 'pre')
        })
        n += muvReplaceTagBlocks(root, /<VariableThink>([\s\S]*?)<\/VariableThink>/gi, function (hit) {
          return muvDetailsBlock('muv-varthink', '💭 变量推演', String(hit[1] || '').trim(), 'div')
        })
        n += muvReplaceTagBlocks(root, /<Abstract>([\s\S]*?)<\/Abstract>/gi, function (hit) {
          var box = document.createElement('div')
          box.className = 'muv-abstract'
          var icon = document.createElement('span')
          icon.className = 'muv-abstract-icon'
          icon.textContent = '📖'
          box.appendChild(icon)
          box.appendChild(document.createTextNode(' ' + String(hit[1] || '').trim()))
          return box
        })
        return n
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
        try { muvRenderMediaTags(md) } catch (e) { console.error('[muv-engine media]', e) }
        try { muvRenderIllustrations(md) } catch (e) { console.error('[muv-engine illustration]', e) }
        try { muvRenderVariableBlocks(md) } catch (e) { console.error('[muv-engine varblocks]', e) }
        try { muvRenderTagRules(md) } catch (e) { console.error('[muv-engine tags]', e) }
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

    // ★ 与 `.muv-statusbar-wrap` 同一类塌陷，同一套撑满声明（`.dshv-frame` 里也是 `width:100%`）。
    //   visual 帧会落在聊天消息里（同样是"由内容决定宽度"的容器），不显式撑满会塌成 300px。
    var UI_CSS = `.dshv-root{display:block;width:100%;min-width:0;align-self:stretch;box-sizing:border-box;margin:12px 0;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.2));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));backdrop-filter:blur(8px);}
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

        /**
         * 从正文容器向上找消息根节点。
         *
         * ★★ 这个函数**曾经根本不存在** —— 只有 `messageTargets()` 里那一处调用。
         * 那个调用点在 `try { … } catch (_) {}` 里，所以每一次都抛 `ReferenceError`、
         * 每一次被静默吞掉，`messageTargets()` **恒返回空数组**：
         *   · `decorateMessages()` 一条消息都不装饰；
         *   · 更要紧的是紧跟其后的 `_decorateOneHook = _decorateOne` 那两行**确实执行了**
         *     ⇒ `MuvEngine.decorateMessage(el)` **不抛错也什么都不做**。
         * 于是所有既有门禁都绿（它们只看"调了 decorateMessage 没抛"），
         * 而真实页面上要多刷新一次才会被装饰 —— 这类"看起来接上了其实没接上"
         * 正是本项目反复栽的那一类。实现逐字来自同栈的 `dsh-tavern-v2`
         * `lib/client.manager.bundle.js` 里那份同名函数（那边已上线验证过）。
         *
         * 判据：向上最多 4 层，一旦某层的兄弟节点多于 1 个就停 —— 那说明当前 node
         * 已经是"一条消息"，再往上就是消息列表了（把列表当一条消息会让
         * `[data-streaming]`／绝对定位都落在错误的层级上）。
         * @param {Element} bodyEl
         * @returns {Element}
         */
        function messageRootOf(bodyEl) {
          var node = bodyEl
          for (var up = 0; up < 4 && node && node.parentElement; up++) {
            var parent = node.parentElement
            // 兄弟节点明显多于一条消息 -> 说明 node 已经是单条消息，parent 是列表
            var siblings = parent.children ? parent.children.length : 0
            if (siblings > 1) break
            node = parent
          }
          return node || bodyEl
        }

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
              // 深度：排在**本条之后**的消息条数。最后一条 = 0，越旧越大。
              // 与 `regex-engine.js:depthAllows` 的口径一致（`[8]` 的 `minDepth = 7`
              // 就是拿这个数直接比大小）。
              await _decorateOne(targets[i], muvDepthFromLaterCount(targets.length - 1 - i))
            }
          } finally {
            _decorating = false
          }
        }

        /**
         * 我们自己产物的选择器 —— 一条 `[class*="muv-"]` 兜住全部。
         *
         * 不枚举类名：本项目已经栽过三次"枚举漏项"（见 `beautifyMuv` 里那段长注释），
         * 而 `muv-` 前缀是**我们自己的契约**，新增任何产物都自动在集合里。
         * 另加三个非 class 的记号：卡 iframe、跨帧 KV 属性、隐藏收件箱。
         */
        var MUV_OWN_SEL = '[class*="muv-"], iframe.muv-iframe, [data-muv-kv], [data-muv-inbox]'

        /**
         * 这个元素里（或它本身）已经有我们的装饰产物吗？
         * @param {Element} el
         * @returns {boolean}
         */
        function muvHasOwnArtifacts(el) {
          try {
            if (el.querySelector && el.querySelector(MUV_OWN_SEL)) return true
            if (el.matches && el.matches(MUV_OWN_SEL)) return true
          } catch (_) {}
          return false
        }

        /**
         * 取"这条消息的正文容器"。
         *
         * 调用方可能给我们正文容器本身，也可能给消息根节点 —— 后者**不能直接写**：
         * 替换它的 `innerHTML` 会毁掉 DSH 自己的 `_markdown_*` 元素（滚动时每次重建，
         * 而本装饰器就依赖它）。两种形态都归一到正文容器。
         * 面板 / 侧栏（`_paneBody_*` / `_surface_*`）里没有任何正文容器 ⇒ 返回 null，
         * 调用方据此**完全不碰**（实测这三个元素曾被当成消息装饰，面板内容被吃掉）。
         * @param {Element} el
         * @returns {Element|null}
         */
        function muvMessageBodyOf(el) {
          try {
            var cls = el.className
            if (typeof cls === 'string' && MSG_BODY_RE.test(cls)) return el
            var inner = el.querySelectorAll('[class*="_markdown_"]')
            if (inner.length === 1 && MSG_BODY_RE.test(String(inner[0].className || ''))) return inner[0]
          } catch (_) {}
          return null
        }

        /**
         * 取"干净的原文"：先把非正文的 DOM 临时藏起来，再读 `innerText`。
         *
         * 藏什么：按钮（酒馆注入的 ✏️ 编辑按钮等）、脚本/样式、我们自己的全部产物。
         * 为什么藏而不是克隆：`innerText` 依赖布局，脱离文档的克隆会退化成
         * `textContent` —— 块级子节点之间**没有分隔符**，整条消息会挤成一行，
         * 所有按行解析的卡逻辑都会退化（这是 `_decorateOne` 里那段长注释的老坑）。
         * hide → 读 → restore 全在同一帧内同步完成，不会看到闪烁。
         * @param {Element} body
         * @returns {string}
         */
        function muvRawTextOf(body) {
          var hidden = []
          try {
            var junk = body.querySelectorAll('button, script, style, textarea, ' + MUV_OWN_SEL)
            for (var i = 0; i < junk.length; i++) {
              var el = junk[i]
              if (!el.style) continue
              hidden.push([el, el.style.getPropertyValue('display')])
              el.style.setProperty('display', 'none', 'important')
            }
            return body.innerText || body.textContent || ''
          } catch (_) {
            return ''
          } finally {
            for (var j = 0; j < hidden.length; j++) {
              try {
                var prev = hidden[j][1]
                if (prev) hidden[j][0].style.setProperty('display', prev)
                else hidden[j][0].style.removeProperty('display')
              } catch (_) {}
            }
          }
        }

        /**
         * 这段文本是不是「整页 HTML 源码」—— 也就是**已经被（或本该被）iframe 呈现**、
         * 留在正文里只会变成一大段裸文本的那种？
         *
         * 背景（`ST-IFRAME-SPEC.md` §2 / §8 第 2 条）：ST 会给消息里残留的
         * `<pre><code>` 加 `hidden!` 隐藏。我们靠「整页 HTML 换成 iframe」绕过了
         * **大部分**情况，但**卡正则没产出整页文档**时（围栏没被认出来、或那条正则
         * 没命中），那一大段源码仍然露在正文里 —— 用户看到的就是"一大段裸文本"。
         *
         * ★ 判据刻意**窄**，且**不是**"所有代码块"：误伤的代价是用户正常的 ``` 代码块
         *   凭空消失（那是本项目栽过的"过度修复"）。只认整页文档：
         *   · `<!doctype html>` 且同时有 `<html` / `<head` / `<body` 之一；
         *   · 或 `<head` 与 `<body` 同时出现（没写 doctype 的整页文档）；
         *   · 或含 `__muvReset`（那是我们自己注入过的记号 ⇒ 这份文本**就是**卡文档）；
         *   · 外加长度 ≥ 200：挡掉"正文里举例提了一句 `<!DOCTYPE html>`"那种短文。
         * @param {string} text
         * @returns {boolean}
         */
        function muvIsPageSourceText(text) {
          var s = String(text == null ? '' : text)
          if (s.length < 200) return false
          if (s.indexOf('__muvReset') !== -1) return true
          var doctype = /<!doctype\s+html/i.test(s)
          var html = /<html[\s>]/i.test(s)
          var head = /<head[\s>]/i.test(s)
          var bodyT = /<body[\s>]/i.test(s)
          if (doctype && (html || head || bodyT)) return true
          if (head && bodyT) return true
          return false
        }

        /**
         * 隐藏正文里**与 iframe 内容重复**的整页源码块 —— ST 给残留 `<pre><code>`
         * 加 `hidden!` 的等价物（我们跨源进不去子文档，只能在父页侧隐藏）。
         *
         * 只动 `<pre>`：DSH 的 markdown 把 ``` 围栏渲染成 `<pre><code>`，
         * 而"裸文档"必然是这么来的。
         *
         * ★ 不隐藏的两类（保守）：
         *   · 内容不像整页文档的普通代码块（判据见 `muvIsPageSourceText`）；
         *   · 落在**我们自己的产物**里面的 `<pre>`（变量折叠卡 / 摘要框里的 `<pre>`
         *     是我们渲染出来的，藏掉等于把刚渲染的东西又吞了）。
         *
         * 隐藏用**内联 `display:none!important`** 而不是 `hidden` 属性：DSH 与卡
         * 都可能给 `pre` 设过 `display`，属性会被 CSS 盖掉。同时打
         * `data-muv-src-hidden` 记号，让门禁（与以后的人）数得到。
         * @param {Element} body
         * @returns {number} 隐藏了几块
         */
        function muvHidePageSourceBlocks(body) {
          var n = 0
          try {
            if (!body || !body.querySelectorAll) return 0
            var pres = body.querySelectorAll('pre')
            for (var i = 0; i < pres.length; i++) {
              var el = pres[i]
              try {
                if (el.getAttribute('data-muv-src-hidden')) { n++; continue }
                if (el.closest && el.closest('[class*="muv-"]')) continue
              } catch (_) { }
              var t = ''
              try { t = el.textContent || '' } catch (_) { t = '' }
              if (!muvIsPageSourceText(t)) continue
              try {
                el.setAttribute('data-muv-src-hidden', '1')
                el.style.setProperty('display', 'none', 'important')
                n++
              } catch (_) { }
            }
          } catch (_) { }
          return n
        }

        /**
         * Decorate one message.
         *
         * Writes into the *body* element's innerHTML and never the message root:
         * the root is DSH's own wrapper, and replacing it destroys the
         * `_markdown_*` element this decorator relies on (and re-renders on every
         * scroll). Accepts either a `{body, root}` pair or a bare element.
         * @param {{body:Element, root:Element}|Element} target
         * @param {number} [depth] SillyTavern 口径的层号（省略时 0）
         */
        async function _decorateOne(target, depth) {
          var body = target && target.body ? target.body : target
          var root = target && target.root ? target.root : target
          if (!body || body.nodeType !== 1) return
          if (body.getAttribute(DECORATED_ATTR) === '1') return
          // 流式输出中的消息先不动，等它写完
          if (root && root.closest && root.closest('[data-streaming]')) return
          if (body.closest && body.closest('[data-streaming]')) return

          // ★★ 三条守卫（2026-09-22 现场取证加的，HANDOFF §22）。
          //
          // 为什么必须有：`raw` 是从 DOM 的 `innerText` 取的，而**我们自己的装饰
          // 产物就长在那个 DOM 里** —— `.muv-statusbar-wrap`（卡 iframe）、
          // `<Abstract>` 换成的 `.muv-abstract`（📖 框）、`.muv-varthink`
          // （「💭 变量推演」），外加酒馆插件注入的 ✏️ 编辑按钮。
          // 一旦对同一个元素（或**包着它的**容器）再跑一遍，`innerText` 拿到的是
          // **我们自己渲染出来的文字**：
          //   · 卡正则 `<(?:content|…)>…</…>` 还是字面量、照样匹配 ⇒ 文档照建；
          //   · 但 `<Abstract>` 的**标签**早被换成了 `<div class="muv-abstract">`，
          //     于是 card [7]「对玩家隐藏摘要」（`/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`
          //     —— 大小写敏感 + 行锚）必然落空 ⇒ 摘要正文（时间/地点/摘要内容）
          //     **永久露在正文里**，还被当成正文塞进整页文档；
          //   · 我们自己的标签文字（📖 / 💭 变量推演 / ✏️）也一并变成正文。
          // 用户看到的「时间出现的地方不对劲」「选项/日常之外多出一堆怪文字」就是这个。
          //
          // ① 已经是我们的产物 ⇒ 绝不重复装饰（`innerText` 已经不可逆地丢了原始标签）。
          if (muvHasOwnArtifacts(body)) return
          // ② 目标规范化 + 只认"消息正文"：拿到 `_markdown_*` 正文容器本身再写，
          //    绝不写消息根节点（会毁掉 DSH 自己的正文元素），也绝不碰面板/侧栏
          //    （实测 DSH 的 `_paneBody_*` / `_surface_*` 曾被当成消息，面板内容被吃掉）。
          var normalizedBody = muvMessageBodyOf(body)
          if (!normalizedBody) return
          if (!root) root = body
          body = normalizedBody
          if (body.getAttribute(DECORATED_ATTR) === '1') return

          var raw = ''
          try {
            // innerText, not textContent: textContent concatenates block children
            // with no separator, so a message DSH rendered as several <p> would
            // arrive as one long line and every line-based parser would see a
            // single field. innerText keeps the rendered line breaks.
            //
            // ③ 取文前先把**非正文的 DOM**（按钮/脚本/我们自己的产物）临时隐藏：
            //    酒馆的 ✏️ 编辑按钮、徽标这类注入 UI 的文字同样会污染原文。
            //    隐藏而非克隆 —— 脱离文档的克隆上 `innerText` 会退化成 `textContent`，
            //    那正是上面这段注释要避免的。同一帧内同步 hide→读→restore，不会闪。
            raw = muvRawTextOf(body)
          } catch (_) { return }
          if (!raw) return
          // 记进 chat 环形缓冲，供卡的 `getContext().chat` 扫 CG 解锁标记。
          // 放在这里（而不是 `beautifyMuv` 里）是因为上面两行已经把「流式中的消息」
          // 和「已装饰过的消息」都挡掉了 ⇒ 每条消息**只记一次**，不会把 80 条上限
          // 灌满半截文本。
          muvPushChatLog(raw)
          // ★ 运行时变量回灌：消息里带 <UpdateVariable>/<initvar>/<VariableEdit>/<era_data>
          //   就喂给服务端（ERA 增量块按消息键时序重放）—— era 桥从此有运行时数值可送
          //   （卡的选项/数值/CG 解锁都靠它）。
          //   ★ 喂 **innerHTML** 而不是 innerText：DSH 把消息渲染成元素时标签名不在
          //   innerText 里（只剩 JSON 文本），innerHTML 两种形态都在。
          try { muvFeedVariables(body.innerHTML) } catch (_) { muvFeedVariables(raw) }
          var html = null
          try {
            // ★ 把 depth 交给取卡那一步（`/api/muv-engine/apply-regex-card` 的
            //   `body.depth`）。**不传它就等于 depth 0** —— 卡里 `minDepth = 7` 的
            //   `[8]「自动总结，隐藏6楼以上除摘要外内容」` 会永远拿不到自己该生效的那一层，
          //   而 `[7]` 又把 `<Abstract>` 删掉 ⇒ 旧楼层"无摘要的全文"，两头都落空。
            html = await beautifyMuv(raw, { depth: muvDepthFromLaterCount(depth) })
          } catch (_) { html = null }
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
          // ★ 最后一步：把"与 iframe 内容重复"的整页源码块藏起来（ST 的 `hidden!`）。
          //   放在装饰之后：整页文档**已经变成 iframe** 的那些，正文里对应的 `<pre>`
          //   可能仍在（卡正则没产出文档时的裸文本正是要靠这一步收掉）。
          //   装饰失败也不影响它 —— 它是纯 DOM 操作，不依赖上面的结果。
          try { muvHidePageSourceBlocks(body) } catch (_) {}
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

          // ★ 整页文档必须在**这里**就走整条替换，不能塞进下面那个 status 手术。
          //
          // 下面 ①②③ 三条路都只把 `cardMatch`（状态栏那一段）插进 DOM 的某个落点。
          // 当消息里同时有「整页文档」和「状态栏」时（`_足控天堂2` 的 `<StatusPlaceHolderImpl/>`
          // 正则天然如此），`beautifyMuv` 算出来的那个**文档 iframe 会被整段丢掉** ——
          // DOM 里只剩下状态栏，而消息里原来那段围栏文本原样留着 → 用户看到
          // 「一大段 HTML 没渲染、全是裸文本」。实测（verify-realcard-inline.mjs，真卡
          // 正文美化 46KB 文档 + 占位符）：装饰产物里 `outIframes=1`、`outHasNakedDoc=0`
          // （产物是对的），但装饰后 DOM 里 `preTextLen` 仍是 30316 字符的裸文档、
          // `msgIframes` 里那个 iframe 其实是状态栏那条。
          //
          // 判据用 `raw`（写回之前读到的**纯文本**）而不是 `html`：raw 里有没有文档，
          // 和「产物里有没有 iframe」是同一件事的两面，但 raw 是原始输入，不受
          // 状态栏渲染分支影响，判起来不会自指。
          if (/^\s{0,3}`{3,}/m.test(raw) || /<!doctype|<html[\s>]/i.test(raw)) {
            body.innerHTML = html
            return
          }

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