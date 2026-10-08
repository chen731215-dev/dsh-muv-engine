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
          // ★ muv-fullpage：**只有开场白/封面楼**才加（2026-09-25 恢复楼位判据）。
          //   build k 曾改成"整页文档一律打标"，被真机证伪：社区卡会**每轮回复都
          //   产出整页文档**（实测异世界农场 7 个楼 srcdoc 全等 52359）⇒ 7/7 楼
          //   被拉成 100vw。ST 侧基准是"整页卡只占消息列宽、首楼与后续楼零差异、
          //   不允许满宽穿出"（docs/44-ST卡片排版规格.md）⇒ 满宽是 DSH 给封面楼开
          //   的自造扩展，只能靠楼位收窄作用域。
          segments.push({ iframe: true, text: '<div class="muv-statusbar-wrap' + (muvFullpageFloorNow() ? ' muv-fullpage' : '') + '">' + cardHtmlIframe(body) + '</div>' })
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
        // ★ doc 切片必须用回退**前**的起点（2026-09-23k 围栏残留修复）：
        //   start 马上会被回退到开围栏行首；若拿回退后的 start 切 doc，
        //   被吞的开围栏 ```html 会一起切进 iframe 文档 —— 真机实锤
        //   （dsh-live31）：服务端收围栏同行粘 <UpdateVariable> ⇒
        //   findClosingFence 失败 ⇒ 本兜底接手 ⇒ srcdoc 首行即 ```html
        //   （活体 srcdoc 52367 字实锤），iframe 里整页黑底代码块。
        var docStart = start
        var fenceOpen = fenceOpenAt(s, start)
        if (fenceOpen >= 0) start = fenceOpen
        var fenceClose = fenceCloseFrom(s, endRe.lastIndex)
        var docEnd = fenceClose > endRe.lastIndex ? fenceClose : endRe.lastIndex
        var doc = s.slice(docStart, endRe.lastIndex)
        out += s.slice(pos, start)
        // ★ muv-fullpage：**只有开场白/封面楼**才加（2026-09-25 恢复楼位判据，见上）。
        out += '<div class="muv-statusbar-wrap' + (muvFullpageFloorNow() ? ' muv-fullpage' : '') + '">' + cardHtmlIframe(doc) + '</div>'
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
    var MUV_BUILD = '2026-09-26c'

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
     *
     * 重测触发面：`load` / `DOMContentLoaded` / `ResizeObserver(documentElement)` /
     * 700·1600ms / 四次低频补量（到 10.9s）/ **媒体落定事件**（img `load`·`error`、
     * video `loadedmetadata`·`loadeddata`·`durationchange`）。
     * 最后那一类带一枚一次性令牌，让这次测量可以走**测量修正通道**（棘轮一次丢弃、报真实值）
     * —— 语义、边界与实测数字见 `extent()` 里「测量修正通道」那段注释。
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
        // ★★ 媒体落定判据 `MS()`：这张卡里**所有**媒体都已"内容尺寸定死"了吗？
        //   它是「测量修正通道」的**前置条件**（见下面 extent() 里那段长注释），只在这一条
        //   通道上用，别的路径一概不看它。
        //   - `img.complete`：图已 load 或已 error（**无 src / 尚未取源的 lazy 图是 false**）；
        //   - `video.readyState>=1`：已 HAVE_METADATA（拿到时长/尺寸）。
        //   有意**不看** `naturalHeight>0`：404 的图 `complete===true` 且 `naturalHeight===0`，
        //   它的盒子会塌成 0 高 —— 那正是需要被修正的一种形态，不能把它排除在外。
        //   读不到（假 document、异常）一律按"未落定"处理 ⇒ 退回老的 3 次观测语义，宁保守。
        //   ★ 已知的**收窄**（有意接受，不是遗漏）：`preload="none"` 的 video 永远到不了
        //   `readyState>=1`、`loading="lazy"` 且从未取源的 img `complete===false`
        //   ⇒ 这类卡上这条通道**一直关闭**，行为与 `2026-09-22t` 完全一致（只是没修好，
        //   不会更坏）。宁可少修几张卡，也不要放宽判据去动收缩方向的语义。
        'function MS(){try{' +
        'var a=document.getElementsByTagName("img");' +
        'for(var i=0;i<a.length;i++){if(!a[i].complete)return false}' +
        'var v=document.getElementsByTagName("video");' +
        'for(var j=0;j<v.length;j++){if(!(v[j].readyState>=1))return false}' +
        'return true}catch(e){return false}}' +
        'function extent(mf){' +
        'var body=document.body;if(!body)return 0;' +
        'var de=document.documentElement;' +
        'var all=body.getElementsByTagName("*"),y=window.scrollY||0,maxB=0;' +
        'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el);' +
        'if(cs.position==="fixed"||cs.position==="sticky")continue;' +
        'if(cs.display==="none"||cs.visibility==="hidden")continue;' +
        // ★ 透明浮层不贡献"可见"高度（2026-09-23 苍玄界实测）：`.cx-detail-page` 是
        //   opacity:0 **且** pointer-events:none 的隐藏详情浮层，内含 max-width:850px 大盒子 ——
        //   不跳过它，内容包围盒被撑大 ~400px，封面下方一大片白。
        //   判据必须**两条件同时满足**：只看 opacity==="0" 会误伤"入场动画前的内容"
        //   （vh-E 真卡实测被误伤 79px）；加 pointer-events:none（隐藏浮层标配）后只命中真浮层。
        //   ★★ 2026-09-24 第二层实锤：**祖先链**。苍玄界「开局」弹窗
        //   `.cx-modal{position:absolute;inset:0;opacity:0;pointer-events:none}` 里装着
        //   1575px 的角色创建表单（.cx-modal-box）—— **opacity 不继承**，子元素自身
        //   computed opacity=1，逐元素检查放过了整棵被祖先隐藏的子树 ⇒ 幽灵高度撑满
        //   视口 ⇒ iframe 永远等于视口高。改用 `checkVisibility({checkOpacity:true,
        //   checkVisibilityCSS:true})`（沿祖先链累计，Chromium 105+），老浏览器回退到
        //   元素自身双条件判断。
        'if(el.checkVisibility?!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):(cs.opacity==="0"&&cs.pointerEvents==="none"))continue;' +
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
        // ★★★ 测量修正通道（2026-09-22u）。与上面那条"内容增长"的棘轮**语义并列、互不干扰**：
        //
        //   · **内容增长**（棘轮，铁律不动）：只要**观测到**溢出（`bOver||dOver`）就无条件提升，
        //     没有阈值、没有等待 —— 因为 reset 是 `overflow:hidden!important`，溢出的那几像素
        //     不立刻补上就是**永久裁掉**。上面那个分支一个字符没变。
        //   · **测量修正**（本条）：媒体**全部落定**（`MS()`）+ 「首帧已过」（`RL`）+ **没有**
        //     观测到溢出 + 已学值比实测内容高 24px 以上 ⇒ 这次收缩是**修正一次坏读数**，不是
        //     内容真的缩了，所以**一次就够**，直接把棘轮丢掉、报真实内容高。
        //
        //   为什么必须有这条（真卡/合成取证见 HANDOFF §34，数字是实测的）：
        //   收缩方向的常规路径要求**连续 3 次**观测（下面 `rc>=3`）才清零重学，而媒体落定
        //   引起的收缩常常**只有一次**观测机会 —— 引导脚本的定时补量到 10.9s+150ms 就停了，
        //   而 RO 只在**盒子**尺寸变化时 fire（本节上文已记：媒体引起的包围盒变化可以完全
        //   不动任何盒子）。合成夹具实测（img 用 `width/height` 属性预留 600×2000 的高盒子、
        //   真实图片是 600×200 的扁图、src 在 11.5s 才设）：
        //     帧高先被撑到 **2300**（内容确实是 2300，没记错），图片到位后内容缩到 **500**，
        //     此后**再也没有第二次观测** ⇒ 帧高永久停在 2300 ⇒ **1800px 死白**
        //     （同一文档把 src 提前到 400ms → 靠 2500/5300/8100 三次补量能凑够 3 次 → 正常回落）。
        //   ⇒ 这条通道不是把滞回拆掉，是**给"媒体落定"这个终态信号补上一次它本来就该有的修正**：
        //     媒体事件是浏览器给的"这个元素的内容尺寸定了"的同步信号，落定之后不会再有一次
        //     **由媒体引起**的重排，等第 2、第 3 次观测就是等一个不会再来的事件。
        //
        //   边界（缺一不可，任何一条不满足都退回老的 3 次语义）：
        //   ① `mf` —— 本次测量必须由**媒体事件**触发（`sf()` 挂的一次性令牌）。定时补量、
        //      RO、卡自己的 JS 引起的测量都不带它 ⇒ **非媒体**的异步收缩照旧 3 次确认；
        //   ② `MS()` —— 媒体全部落定；只要还有一张图在加载（含 lazy 未取源），这条通道关闭；
        //   ③ `RL` + `!bOver && !dOver` —— 与老路径同一条闸门：**观测到溢出就绝不收缩**；
        //   ④ 只有**收缩**方向有这条通道，增长方向一个字没动。
        //
        //   修正之后的**安全复核**：`sf()` 在 +700ms 还会再挂一次令牌重量一次（见 `sf` 的注释）
        //   —— 万一这次修正量偏小（内容其实还要更多），那一次会走增长分支无条件补上，
        //   不会因为这条通道把内容永久裁掉。
        'if(mf&&MS()){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{' +
        'var rc=(window.__muvHReset||0)+1;' +
        'if(rc>=3){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{window.__muvHReset=rc}}}' +
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
        'function m(){try{' +
        // ★ 一次性令牌：本次测量是不是由**媒体落定事件**触发的？
        //   读走就清（consume-once）—— 下一个定时/RO 触发的测量绝不会继承它，
        //   否则"测量修正"会退化成"任何测量都能一次收缩"，那正是要避免的语义漂移。
        'var mf=window.__muvHMediaFix?1:0;window.__muvHMediaFix=0;var e=extent(mf);' +
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
        // ★ 媒体事件重测（2026-09-22p）。为什么 RO 不够（取证见 HANDOFF §29）：
        //   RO 只在**盒子**（边框盒）尺寸变化时 fire，而媒体引起的**包围盒**变化可以完全不
        //   动任何盒子 —— 两种真实形态（真卡 _足控天堂2「主页」两条都占）：
        //   ① 媒体元素自身 position:absolute（该卡画廊 `.polaroid img{position:absolute;inset:0}`，
        //      父盒用 aspect-ratio 预留尺寸）：媒体加载只改绝对定位元素自己的盒子，
        //      html/body 的盒子纹丝不动 ⇒ RO 一次都不 fire；而 `extent()` 对绝对定位元素
        //      单独取 `rect.top + height`，媒体到位后包围盒**确实变大** —— 帧高却不跟。
        //   ② 卡的 JS 在 load 之后才把 img 插进 DOM（该卡画廊就是运行时拼的）：
        //      固定补量到 10.9s 就停，之后插入的媒体没有任何触发器。
        //   媒体事件是浏览器给「这个元素的内容尺寸定了/变了」的同步信号（error 也算——
        //   404 的图会塌成 0 高，包围盒同样要重量），接到就 sf() 走 150ms 去抖。
        //   对已有元素挂一遍；卡运行时再插入的媒体由 MutationObserver 兜底补挂
        //   （只挂事件，不额外测量 —— 测量仍由 s() 统一去抖）。
        //
        //   ★★ 为什么走 `sf()` 而不是直接 `s()`（2026-09-22u）：媒体事件触发的这一次测量
        //   要带上一枚**一次性令牌** `__muvHMediaFix`，让 extent() 知道"这次读数来自媒体落定、
        //   可以走一次测量修正"（语义与边界见 extent() 里那段长注释）。令牌由 m() 读走即清。
        //   `sf()` 另外还在 **+700ms** 补挂一次同样的令牌重量一次：这一次是**修正的安全复核**
        //   —— 落定瞬间的布局若还没走完（transition/字体替换），修正量可能偏小，那次复核会走
        //   增长分支把它补回来。定时器用同一个句柄去重，媒体再多也只留一个待复核。
        'function sf(){window.__muvHMediaFix=1;s();' +
        'if(window.__muvHMediaT)clearTimeout(window.__muvHMediaT);' +
        'window.__muvHMediaT=setTimeout(function(){window.__muvHMediaFix=1;s()},700)}' +
        'function mw(el){try{' +
        'if(el.tagName==="IMG"){el.addEventListener("load",sf);el.addEventListener("error",sf)}' +
        'else if(el.tagName==="VIDEO"){el.addEventListener("loadedmetadata",sf);el.addEventListener("loadeddata",sf);el.addEventListener("durationchange",sf)}' +
        '}catch(e){}}' +
        'try{var mqs=document.getElementsByTagName("img"),mqvv=document.getElementsByTagName("video");' +
        'for(var mqi=0;mqi<mqs.length;mqi++)mw(mqs[mqi]);' +
        'for(var mqv=0;mqv<mqvv.length;mqv++)mw(mqvv[mqv])}catch(e){}' +
        'try{if(window.MutationObserver)new MutationObserver(function(mrs){' +
        'for(var mra=0;mra<mrs.length;mra++){var mrn=mrs[mra].addedNodes||[];' +
        'for(var mrb=0;mrb<mrn.length;mrb++){var mre=mrn[mrb];if(mre.nodeType!==1)continue;' +
        'if(mre.tagName==="IMG"||mre.tagName==="VIDEO")mw(mre);' +
        'if(mre.querySelectorAll){var mrq=mre.querySelectorAll("img,video");for(var mrc=0;mrc<mrq.length;mrc++)mw(mrq[mrc])}}}})' +
        '.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}' +
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
      //
      //   ★ 但有一个例外通道（2026-09-23 苍玄界实测）：**大幅下修**（落差 ≥ 300px）不受
      //     滞回限制、直接采纳。理由：extent() 的可见性过滤（透明浮层跳过）或媒体落定
      //     会让测量值**一次性**回落几百像素 —— 这不是抖动，是结构修正；而滞回要求
      //     连续多次观测，浮层类页面往往只给一次机会 ⇒ 不放行就永久留白
      //     （实测：vh-F 夹具 extent 报 500 一次，宿主帧高停在 900）。
      //     300px 阈值远大于任何合理抖动；误触发最多让帧高贴合真实内容，无破坏面。
      var cur = parseFloat(frame.style.height)
      if (isFinite(cur) && h <= cur && (cur - h) < 8 && (cur - h) < 300) return
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
    /**
     * 卡 iframe **画布的底色** —— 从宿主（DSH）当前主题里取，烘进 reset。
     *
     * ★ 为什么要这一段（第 40 轮真机对照实验，`tools/dsh-live22.mjs`）：
     *   iframe 是**独立文档**，宿主页面的 `--dsw-alias-*` 与 `data-ds-dark-theme`
     *   都传不进去；而 srcdoc 文档只要**没有声明任何背景**，UA 就会按自己的默认
     *   画一张**白画布**。宿主是深色时实测三个探针（`sandbox=allow-scripts`、
     *   父页 `background:transparent`，宿主页面本身 rgb(21,21,23)）：
     *     · 不声明背景          ⇒ 画布 rgb(253,253,253)  ← 就是用户说的「白框」
     *     · `background:transparent` ⇒ 画布 rgb(252,252,252)（**没用**，UA 画布照白）
     *     · `html{background:#151517;color-scheme:dark}` ⇒ 画布 rgb(24,24,26) ✓
     *   也就是说「白框」和 §39.2 修的「白边（幽灵高度）」是两件事：那一处是高度被
     *   隐藏弹窗顶高，这一处是**画布本身是白的**。
     *
     * ★ 为什么不硬编码深色值：只给 `html` 一个**低优先级**声明（插在 `<head>` 最前，
     *   且**不带** `!important`），卡自己的 `html{background}` / `body{background}`
     *   仍然照旧赢 —— 卡的配色不动（ST 保真度）。只有**没自带背景**的卡才吃到这个
     *   兜底，那种卡本来就是一块刺眼的白。
     *
     * ★ `color-scheme` 同源：它决定 iframe 内的滚动条/表单控件的 UA 配色，跟着宿主
     *   走才不会出现「深色页里嵌一条浅色滚动条」。
     * @returns {string} 空串表示取不到（测试里没有真 document 时）——那就保持 ST 原样。
     */
    function muvCardResetCss() {
      // ★ 宿主皮肤兜底（同上）：整段**内联**而不是拆成第二个函数 —— `buildFrom` 只把
      //   列进依赖表的函数抽出来求值，多一层函数声明在那些门禁里会是 ReferenceError。
      var skin = ''
      try {
        if (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function') {
          var dark = document.body.hasAttribute('data-ds-dark-theme')
          var de = document.documentElement
          if (!dark && de && de.style && de.style.colorScheme === 'dark') dark = true
          var cs = getComputedStyle(document.body)
          var bg = (cs.getPropertyValue('--dsw-alias-bg-base') || '').trim()
          if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = cs.backgroundColor
          if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = dark ? '#151517' : '#ffffff'
          skin = 'html{background:' + bg + ';color-scheme:' + (dark ? 'dark' : 'light') + '}'
        }
      } catch (_) { skin = '' }
      return '*,*::before,*::after{box-sizing:border-box}' +
        'html,body{margin:0!important;padding:0;max-width:100%!important;' +
        'overflow:hidden!important}' + skin
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
