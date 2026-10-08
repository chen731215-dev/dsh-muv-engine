    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Cache for card data (loaded once)
    let cardCache = null

    // Observers owned by the factory scope so the returned teardown can dispose
    // them; declared here rather than inside the startup IIFE, where they were
    // unreachable from the cleanup path.
    let _vrObs = null
    let _muvMsgObs = null
    let _muvSweepTimer = null
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
      // ★ 第 35 轮：文本级状态栏里那个**折叠块**（`<details><summary>[角色状态]</summary>`）。
      // 作者本来就用 details 折起来，所以还原成折叠 UI（默认收起）而不是摊平 —— 展开后
      // 就是上面那套 `.muv-sb*` 卡片。summary 用 `.muv-sb-sect` 同一档小字，视觉上与前
      // 面的状态栏连成一体。
      + '.muv-sb-details{margin:4px 0}'
      + '.muv-sb-details>summary{cursor:pointer;font-size:11px;letter-spacing:.6px;opacity:.6;font-weight:600;padding:3px 0}'
      + '.muv-sb-details[open]>summary{margin-bottom:2px}'

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

    // ── 文本级状态栏（无占位符的卡）─────────────────────────────────────────
    //
    // 背景（用户实测，2026-09-23）：社区卡里有一大类**没有占位符**的卡
    // （`regex_scripts: 0`、也没有酒馆助手脚本），模型把状态直接写成消息开头的
    // **裸方括号键值对**：
    //     [时间:5月14日|星期三][季节:初夏][天气:夜间大雨][时间段:晚上20:41][地点:…]
    // 而 `status-cascade` 的四级识别（card/yaml/free/loose）**只在消息里出现
    // `<StatusPlaceHolderImpl/>` 时才被调用**（`STATUS_PH_TEST` 那条路）⇒ 这类卡
    // 级联永不触发，元信息原样堆在正文里（用户原话：「裸文本堆在正文里」）。
    //
    // 本轮在装饰链里加**兜底**把它救回来。判据刻意保守 —— **宁可漏，不可误伤正常行文**：
    //   · 只认消息**开头**（去首尾空白后 ≤ `LEAD_MAX` 字的引子以内）的
    //     **连续**方括号对；
    //   · 键必须落在 `muvTextStatusProbe` 内的**已知词表**里（词表出处逐条写在表上）；
    //   · **≥ 2 个连续对**才算（单个 `[注:…]` / `[1]` 永远不认）；
    //   · 每一对**不跨行**、值非空，命中的整段 ≤ `MAX` 字符（两个上限都是函数内常量）。
    //
    // 命中后：整段从正文里**移除**（避免重复显示）+ 渲染成状态栏卡片（复用既有
    // `.muv-sb*` 样式与 📅/🕐/🍃/🌤/📍 图标，外观与占位符路径的产物一致），
    // 落点靠产物自带的 `data-muv-ts*` 属性（自己生成、自己解析，不靠模块态）。
    //
    // 与既有路径的**优先级**：占位符 / 卡自带状态栏 / `<Status_block>` 任一命中，
    // 本兜底完全不参与（见 `muvStatusAlreadyRendered`）。

    /**
     * 从消息文本里找「开头的一段连续方括号键值对」。
     *
     * 纯字符串函数：回归门禁是「从源码里逐字提取函数体再执行」的，所以这里**自足**
     * —— 两个上限（前缀最大长度 / 引子最大长度）写成**函数内常量**而不是闭包变量，
     * 否则提取后执行会 `ReferenceError`，而 `catch` 会把它伪装成「没命中」。
     * @param {string} text
     * @returns {{prefix:{raw:string,fields:Array<{key:string,value:string,bucket:string}>}|null}}
     */
    function muvTextStatusProbe(text) {
      // 命中的整段最长多少字符（超出即放弃 —— 宁可漏，不可吞掉一大段正文）
      var MAX = 600
      // 方括号前缀前面允许多长的「引子」（不含换行/方括号）
      var LEAD_MAX = 16
      try {
        var s = String(text == null ? '' : text).replace(/\r\n/g, '\n')
        var lead = s.replace(/^[ \t\u3000]+/, '')
        // 引子：允许模型写「正文」「状态」之类的短前缀，但不得含换行/方括号，
        // 且必须紧跟着一个开括号 —— 这是「只认消息开头」这条判据的落点。
        var m0 = new RegExp('^[^\\n\\[\\]［］【】]{0,' + LEAD_MAX + '}(?=[\\[［【])').exec(lead)
        if (!m0) return { prefix: null }
        var start = m0[0].length

        // 词表（**可扩展**，新增键必须写清出处 —— 判据的保守性全靠它）：
        //  · 「用户实测」= 本轮用户真卡正文（川上富江）里逐字出现的键；
        //  · 「既有级联」= `lib/status-cascade.js` 已经认的字段名（`extractHeaderFields`
        //     的 日期和时间/时间/位置/地点/天气，loose 的 `[角色状态]` 一类 section），
        //     保持一致才不会出现「卡里有、这里不认」的分叉；
        //  · 「生态常见」= 本仓库历轮取证过的真卡正文/门禁夹具里出现过的字段与
        //     per-角色 字段（行动/内心/衣着/穿搭…，见 test-status-cascade 的夹具）；
        //  · 「英文」= loose 里已认的 `Status` / `Character Status` 写法。
        // 故意**不收**的：`备注`/`说明`/`提示`/`旁白` 这类过于口语化的词 —— 它们出现在
        // 正文里的概率远高于出现在状态前缀里的概率（误伤面比漏掉的收益更大）。
        var KEYS = {
          // 用户实测（川上富江）
          时间: 'date', 时间段: 'period', 季节: 'season', 天气: 'weather',
          地点: 'place', 环境布置: 'line', 怪谈女性角色: 'line',
          // 既有级联的表头字段
          日期和时间: 'date', 日期: 'date', 当前时间: 'date', 时间点: 'date',
          时段: 'period', 时刻: 'period',
          位置: 'place', 场景: 'place', 当前地点: 'place', 所在地: 'place',
          气候: 'weather',
          // 生态常见的 section / per-角色字段
          环境: 'line', 氛围: 'line', 场景布置: 'line',
          角色状态: 'line', NPC状态: 'line', 登场角色: 'line', 在场角色: 'line',
          角色: 'line', NPC: 'line', 人物: 'line', 主角: 'line',
          怪谈角色: 'line', 女性角色: 'line', 男性角色: 'line',
          行动: 'line', 心理: 'line', 内心: 'line', 衣着: 'line', 穿搭: 'line',
          状态: 'line', 情绪: 'line', 好感度: 'line', 关系: 'line',
          // 英文
          Status: 'line', 'Character Status': 'line'
        }

        // 一对：`[键:值]`，三种括号形态都认（`[]`/`［］`/`【】`）。
        // 键与值都**不含换行**（「宽度不跨行」），键不含冒号（第一个冒号即分隔符）。
        var PAIR = /[\[［【]\s*([^\[\]【】［］:\uFF1A\n]{1,16})\s*[:\uFF1A]\s*([^\[\]【】［］\n]{1,200})\s*[\]］】]/g
        PAIR.lastIndex = start
        var fields = [], raw = '', expect = start, m
        while ((m = PAIR.exec(lead)) !== null) {
          // 两对之间只允许空白（不得夹进别的文字）——「连续」这条判据就在这里
          if (m.index !== expect && !/^[ \t\u3000]*$/.test(lead.slice(expect, m.index))) break
          var key = m[1].trim()
          var bucket = KEYS[key]
          if (!bucket) break
          var value = m[2].trim()
          if (!value) break
          fields.push({ key: key, value: value, bucket: bucket })
          raw = lead.slice(start, PAIR.lastIndex)
          expect = PAIR.lastIndex
          if (raw.length > MAX) { fields = []; break }
        }
        if (fields.length < 2) return { prefix: null }
        return { prefix: { raw: raw, fields: fields } }
      } catch (_) {
        return { prefix: null }
      }
    }

    /**
     * 从消息文本里找「状态折叠块」：
     *   `<details><summary>[角色状态]</summary>```- 😃 川上富江的状态…```</details>`
     *
     * 模型很爱用 `<details>` 把状态区折起来，而 DSH 的原生路径没有渲染器 ⇒ 「代码块
     * 裸露」（用户实测原话）。判据同样保守：summary 文本必须是**状态类标签**（见
     * LABELS），且块内去掉围栏/标签后仍有实际内容。
     * @param {string} text
     * @returns {{raw:string,label:string,body:string,look:string}|null}
     */
    function muvTextDetailsOf(text) {
      try {
        var s = String(text == null ? '' : text)
        if (s.indexOf('<details') < 0) return null
        // 状态类 summary 标签。出处：用户实测 `[角色状态]`；其余取自
        // `status-cascade.js` loose 级已认的 section 名（`[NPC状态]` 等）+ 英文写法。
        // 故意**不收**「主页」「简介」「人物卡」这类非状态标签 —— 那些块由
        // `renderFencedHtml` 的整页文档路径负责，不能在这里被吃掉。
        var LABELS = ['角色状态', 'NPC状态', '人物状态', '登场角色', '状态栏', '状态',
          '角色', '人物', 'NPC', 'Character Status', 'Status']
        var re = /<details\b[^>]*>([\s\S]*?)<\/details>/gi
        var m
        while ((m = re.exec(s)) !== null) {
          var inner = m[1]
          var sum = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner)
          if (!sum) continue
          var label = sum[1].replace(/<[^>]*>/g, ' ').replace(/[\[\]【】［］]/g, ' ')
            .replace(/\s+/g, ' ').trim()
          if (LABELS.indexOf(label) < 0) continue
          var body = inner.slice(sum.index + sum[0].length)
          // 去掉围栏与残留标签之后必须还有内容，否则不认（空块不该被吃掉）
          var flat = body.replace(/<[^>]*>/g, ' ').replace(/`{3,}/g, ' ').replace(/\s+/g, ' ').trim()
          if (flat.length < 4) continue
          // 落点探针：必须能在 DOM 里那个 `<details>` 的 textContent 里逐字找到。
          // 围栏会被 markdown 吃掉（DOM 里只剩代码文本），所以要从**去过围栏**的
          // 文本取，并剥掉开头的项目符号。
          var look = flat.replace(/^[-•*·–—\s]+/, '').slice(0, 10)
          if (!look) continue
          return { raw: m[0], label: label, body: body, look: look }
        }
      } catch (_) {}
      return null
    }

    /**
     * 文本级状态栏的 HTML（头部字段 + 其余字段逐行）。
     *
     * 图标与容器类**刻意对齐既有状态栏**（`.muv-sb` / `.muv-sb-hd` / `.muv-sb-body` /
     * `.muv-sb-line`，图标 📅/🕐/🍃/🌤/📍 与 `status-cascade` 的表头口径一致），
     * 这样「有占位符的卡」和「没有占位符的卡」在界面上看起来是同一套东西。
     * 纯字符串函数（自足；只依赖 escHtml，门禁会自动提取它）。
     * @param {{fields:Array<{key:string,value:string,bucket:string}>}} hit
     * @returns {string}
     */
    function muvTextStatusPrefixHtml(hit) {
      // 桶 → 图标 / 是否进表头行（表头行的口径抄 status-cascade 的 loose 级）
      var ICON = { date: '📅', period: '🕐', season: '🍃', weather: '🌤', place: '📍' }
      var fields = (hit && hit.fields) || []
      var head = [], lines = []
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i]
        if (!f || !f.value) continue
        // 值里的 `|`/`｜` 是同一个字段的多段（`[时间:5月14日|星期三]`），并进一个 span
        var value = String(f.value).split(/[|｜]/).map(function (x) { return x.trim() })
          .filter(Boolean).join(' ')
        if (!value) continue
        if (ICON[f.bucket]) head.push(ICON[f.bucket] + ' ' + value)
        else lines.push('<div class="muv-sb-line"><b>' + escHtml(f.key) + '</b>' + escHtml(value) + '</div>')
      }
      if (!head.length && !lines.length) return ''
      var html = '<div class="muv-sb">'
      if (head.length) html += '<div class="muv-sb-hd">' + head.map(function (h) { return '<span>' + escHtml(h) + '</span>' }).join('') + '</div>'
      if (lines.length) html += '<div class="muv-sb-body">' + lines.join('') + '</div>'
      return html + '</div>'
    }

    /**
     * 文本级状态栏的容器。落点信息（要删的原文 / details 探针）写进**产物自己**的
     * 属性里，由 `applyDecoratedHtml` 解析 —— 不靠模块级状态，并发装饰多条消息时
     * 不会串。
     * @param {string} kind 'prefix' | 'details'
     * @param {string} raw 要从正文里删掉的原文（逐字）
     * @param {string} look details 形态的探针（DOM 里该元素的 textContent 必含它）
     * @param {string} innerHtml 容器内容
     * @returns {string}
     */
    function muvTextStatusWrap(kind, raw, look, innerHtml) {
      return '<div class="muv-statusbar-wrap" data-muv-ts="' + escAttr(kind) + '"'
        + ' data-muv-ts-raw="' + escAttr(raw) + '"'
        + (look ? ' data-muv-ts-look="' + escAttr(look) + '"' : '')
        + '>' + innerHtml + '</div>'
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
    // ★ 取卡「未决」标志（2026-09-24）：装饰被永久钉死的解药之一。
    //   fetchTavernCard 有三档结局：① 拿到卡（确定）；② 本会话非酒馆会话（确定不出卡）；
    //   ③ **权威解析失败 / 网络失败（未决）**。未决时 _decorateOne **不得**置
    //   DECORATED_ATTR —— 否则切换会话瞬间（会话 id 探测滞后于 React 挂载）那条消息
    //   被永久钉成「已装饰」，之后任何重试都进不来。真机实锤（dsh-live6 自主诊断）：
    //   苍玄界 greeting 楼裸着 `【GameStart】`、卡 iframe 时有时无，同根。
    //   「一次不美化是可恢复的」的旧假设只对"后面还有消息触发装饰"成立 —— greeting
    //   楼没有下一次，必须靠重试通道（配合装饰扫摆）。
    var muvCardFetchInconclusive = false
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
        //     bindings              = preset-mt4pv17b-9qzo89  → 魔法少女MVU测试 / 8 条脚本
        //     会话日志最新 selected = preset-mt5ip9cc-t6josi  → _足控天堂2    / 10 条脚本
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
            muvCardFetchInconclusive = false // 确定结局：不是酒馆会话，钉死无妨
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
            muvCardFetchInconclusive = true // ★ 未决：不许钉 DECORATED_ATTR，等扫摆重试
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
        muvCardFetchInconclusive = false // 服务端给了确定答复（有卡/无卡都算）
        return d && d.ok ? d : null
      } catch (_) {
        muvCardFetchInconclusive = true // ★ 网络失败 = 未决，允许重试
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

