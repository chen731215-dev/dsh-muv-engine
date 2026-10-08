
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
      // ★ 首屏遮蔽的显形信号（第 0 段垫片发，只可能来自卡内；见 `ensureCardMask`）
      var isReady = data.__muvReady !== undefined
      if (!isHello && !isKv && !isEventOut && !isUserSend && !isMvuReq && !isVarWrite && !isReady) return
      var frames
      try { frames = document.querySelectorAll('iframe.muv-iframe') } catch (_) { return }
      var frame = null
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === ev.source) { frame = frames[i]; break }
      }
      if (!frame) return
      // ★ 显形：**只**认"这个 source 确实就是我们的卡 iframe"，消息里没有任何可被伪造的
      //   语义（它既不带键也不带值，唯一效果是把这张 iframe 的 opacity 放出来）。
      if (isReady) { muvCardShow(frame); return }
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
      // 三个 op 落完内存都同步过一遍持久层（写通，不留异步窗口）：持久键 = 前缀 + ns，
      // 会话栅栏原样带进持久层；失败（quota/隐私模式）退化为纯内存，不比修复前差。
      if (op === 'clear') {
        muvKv[ns] = {}
        muvKvPersistRemove(ns)
        return
      }
      if (op !== 'set' && op !== 'remove') return
      var k = data.k === undefined ? '' : String(data.k)
      if (!k || k.length > MUV_KV_MAX_KEY) return
      if (!Object.prototype.hasOwnProperty.call(muvKv, ns)) muvKv[ns] = {}
      var st = muvKv[ns]
      if (op === 'remove') {
        try { delete st[k] } catch (_) {}
        muvKvPersistWrite(ns, st)
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
      muvKvPersistWrite(ns, st)
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
     *   → `withFrameHeightBootstrap` → **`withCardScripts`（最外层）**
     * 理由见 `cardHtmlIframe` 的长注释。（`withCardLibs` 的落点是 head 末尾，
     * 与 compat / reset 的 `<head>` 锚点不冲突，所以它排在哪一层都不改变位置。）
     *
     * ★ 缓存只在 `hostH` 相同时命中：`hostH` 会进 `min-height:<N>px` 与
     *   `--TH-viewport-height`，窗口尺寸变了必须重算（否则卡被钉死在旧的视口高上）。
     *   `hostH` 只是标识，真正的 vh 由 `rewriteVhMinHeight` 自己取（它不收形参）。
     * @param {string} raw 注入前的卡文档
     * @param {number} hostH 宿主视口高（缓存标识）
     * @param {string} ck 卡键（`muvCompatKey(raw)`，调用方已经算过，省一次 O(n) 散列）
     * @param {Array<{name?:string, id?:string, content?:string}>} [scripts] 卡的 enabled 脚本
     * @returns {string} 注入后的完整文档
     */
    function muvInjectDoc(raw, hostH, ck, scripts) {
      var key = String(ck || '') + '@' + String(hostH || 0) + '#' + muvCardScriptsSig(scripts)
      try {
        if (Object.prototype.hasOwnProperty.call(muvInjectCache, key)) return muvInjectCache[key]
      } catch (_) {}
      // ★ `withCardScripts` 必须在**最外层**：它是往 `</body>` 里插东西的，放在里面的话
      //   后面几层（含 bootstrap）再去数 `<script>` 区间时会把卡的脚本当成"卡自己的"，
      //   让它们各自的落点判定跟着偏移。
      var doc = withCardScripts(
        withFrameHeightBootstrap(
          withCardLibs(withCardReset(withCardCompat(rewriteVhMinHeight(raw), hostH), hostH))),
        scripts)
      // ★ 图片开销评估结论（2026-09-24，实测后**不改**）：
      //   ① CDP 真机取证：切回会话时 iframe 内图片 **0 次网络重取**（memory cache
      //      直接命中，连 fromDiskCache 事件都不产生）——"重新加载图片"在网络层
      //      本来就不发生，懒加载没有收益；
      //   ② 卡文档逐字节 parity 是 verify-visual 的硬契约（剥掉注入运行时后必须与
      //      卡原文逐字相等，ST 保真度边界）——往卡文档里加 `loading="lazy"` 立刻
      //      打红 14+ 项（实测）；
      //   ③ iframe 内 lazy 与高度棘轮存在理论冲突（离屏图永不触发加载 ⇒ 高度卡死）。
      //   ⇒ img/iframe lazy 都不启用，图片开销维持浏览器原生 memory cache 行为。
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
     *   → `withFrameHeightBootstrap` → `withCardScripts`
     *  - vh 重写必须在最内层：它要**只**处理卡自己的 `min-height`，不碰我们注入的东西；
     *  - compat 垫片要尽可能靠前（解析期就生效），且必须排在 reset 之前才能在
     *    `<head>` 锚点上落在 reset 的 `<style>` 之后（两者都插在同一锚点，后跑的排前面）；
     *  - 前端库（`withCardLibs`）插在 `</head>` 之前：仍在 body 之前（卡的脚本拿得到
     *    `jQuery`/`Vue`，与 ST 一致），但排在 compat/reset **之后** ⇒ CDN 出问题时
     *    不会连带推迟我们自己那两段；
     *  - 高度引导脚本在前端库之后、卡脚本之前（它也是插在"最后一个 `</body>` 之前"，
     *    早插会被后面的 head 注入打乱）；
     *  - **卡的 TavernHelper 脚本在最外层**（`withCardScripts` 的一组
     *    `<script type="module">`）：module 天生 defer ⇒ 执行一定排在 compat 垫片 /
     *    reset / 前端库 / 引导这些**经典脚本之后**，位置不决定顺序，所以把它放在
     *    文档最后（不影响前面任何一个锚点的搜索）。
     * @param {string} html 卡自带的整页 HTML
     * @returns {string}
     */
    function cardHtmlIframe(html) {
      ensureFrameHeightListener()
      ensureCardCompatListener()
      ensureCardMask()
      var raw = String(html == null ? '' : html)
      // ★ 首屏遮蔽的判据（见 `ensureCardMask` 与宿主样式里那条注释）：文档**自带初始主题
      //   属性**（`<body data-theme="night">` 这类）才有"先画默认主题、等卡初始化才换"的
      //   错色期。没有这个属性的卡文档**照旧不遮蔽** —— 波及面刻意收窄到"真的会错色"的那一类。
      var mask = /<(?:body|html)\b[^>]*\sdata-theme\s*=/i.test(raw) ? ' data-muv-mask="1"' : ''
      var hostH = muvHostViewportHeight(0)
      // ★ `rewriteVhMinHeight` 只收一个形参（注入前的卡文档）。这里原来多传了一个 `hostH`
      //   —— 函数内是自取 `window.innerHeight` 的，多出来的实参被静默丢掉。功能无害，
      //   但它**遮蔽了真实契约**（读调用点的人会以为 vh 是由调用方决定的）。删掉实参。
      var doc = muvInjectDoc(raw, hostH, muvCompatKey(raw), muvCardScriptsNow())
      // ★ 种子现算覆盖（见 muvKvSeedFill）：产物可能来自缓存（内存/上游持久），里面的
      //   KV 种子是构建时的冻结快照 —— 出口上用当前账本（含持久层回捞）重算一遍，
      //   卡的解析期同步读才能拿到跨刷新/跨会话的真实值，不靠 hello 回填的异步竞速。
      doc = muvKvSeedFill(doc, muvCompatKey(raw))
      return '<iframe class="muv-iframe" data-muv-kv="' + escAttr(muvCompatKey(raw)) + '"' + mask +
        ' srcdoc="' + escAttr(doc) +
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

    /**
     * 这条消息是不是**已经有**状态栏了？（占位符 / 卡自带皮肤 / `<Status_block>` 三条路）
     *
     * 文本级兜底的**优先级判据**：上面三条任一命中，兜底一个字符都不动
     * ——「占位符路径优先，既有行为不变」这条要求就落在这里。
     * @param {string} text 已经过占位符/`<Status_block>` 处理的文本
     * @param {string} sbHtml 卡自带的状态栏 HTML（`d.statusBarHtml`），没有就是空
     * @returns {boolean}
     */
    function muvStatusAlreadyRendered(text, sbHtml) {
      var s = String(text == null ? '' : text)
      return !!sbHtml
        || STATUS_PH_TEST.test(s)
        || s.indexOf('class="muv-statusbar-wrap"') >= 0
        || /<\s*Status_block\s*>/i.test(s)
    }

    /**
     * 把「状态折叠块」的正文交给服务端既有的 loose 级联渲染。
     *
     * 为什么不在这里自己解析：`<details><summary>[角色状态]</summary>```- 😃 名字…```</details>`
     * 那套形状（去围栏/去标签/section/角色块/字段行）已经在 `lib/status-cascade.js` 的
     * loose 级里实现过一整个版本（含一串踩过的坑）——重写一份必然分叉。所以只把判定过的
     * **块体**发给 `/api/muv-engine/render-status` 的新 `body` 入口（不经过
     * `extractStatusBody`，因为这里没有 `<Status_block>` 包裹）。
     * 服务端不可达时返回 ''（此时**不动**原文：宁可留着裸块，也不许把内容删掉）。
     * @param {string} body
     * @returns {Promise<string>} 渲染出的 HTML，'' 表示没渲染出来
     */
    async function muvRenderLooseStatusBody(body) {
      try {
        const r = await fetch('/api/muv-engine/render-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: body })
        })
        const d = await r.json()
        return d && d.ok && d.html ? String(d.html) : ''
      } catch (_) { return '' }
    }

    /**
     * 文本级状态栏兜底：把消息开头/正文里的裸元信息渲染成状态栏，并把原文段**移除**。
     *
     * 两件都要成立才会改文本：判据命中（`muvTextStatusProbe` / `muvTextDetailsOf`）
     * **并且**渲染成功。任何一步不算数就原样返回 —— 调用方（`_decorateOne`）见到
     * `html === raw` 就不动 DOM，所以「没救回来」的代价只是维持现状，不会更差。
     *
     * ★ 替换串铁律：这里两处大段拼接（状态栏容器）一律用**函数式替换**，见
     *   `muvFrameBlock` 的长注释（`$&` / `$'` / `` $` `` 会被字符串替换解析掉）。
     * @param {string} text
     * @param {boolean} already 已经有状态栏了（`muvStatusAlreadyRendered` 的结论）
     * @returns {Promise<string>}
     */
    async function muvApplyTextStatus(text, already) {
      if (!muvTextStatusOn() || already) return text
      var out = String(text)
      var probe = muvTextStatusProbe(out)
      var details = muvTextDetailsOf(out)
      if (!probe.prefix && !details) return text
      var changed = false

      if (probe.prefix) {
        var inner = muvTextStatusPrefixHtml(probe.prefix)
        if (inner) {
          var wrap = muvTextStatusWrap('prefix', probe.prefix.raw, '', inner)
          // ★ 函数式替换（铁律）：wrap 里是拼出来的 HTML，字符串替换会把 `$&` 吃掉
          var next = out.replace(probe.prefix.raw, function () { return wrap })
          if (next !== out) { out = next; changed = true }
        }
      }

      if (details) {
        var bodyHtml = await muvRenderLooseStatusBody(details.body)
        if (bodyHtml) {
          // 作者本来就用 `<details>` 折起来 ⇒ 还原成**折叠 UI**（默认收起），
          // 内容是 loose 级的产物。summary 用的是块上原有的标签。
          var innerHtml = '<details class="muv-sb-details"><summary>' + escHtml(details.label)
            + '</summary>' + bodyHtml + '</details>'
          var wrap2 = muvTextStatusWrap('details', details.raw, details.look, innerHtml)
          var next2 = out.replace(details.raw, function () { return wrap2 })
          if (next2 !== out) { out = next2; changed = true }
        }
      }

      if (!changed) return text
      try { ensureStatusCss() } catch (_) {}
      return out
    }

    // ── 装饰产物内存缓存（2026-09-24，「切回会话秒开」）─────────────────────
    //
    // 取证（真机 CDP，`C:\deepseek harness\_probe-session-cache.mjs`）：切走→切回同一
    // 会话，每条楼都重跑 beautifyMuv 全链 —— 每次切回 2~3 次 `/apply-regex-card`
    // 服务端往返，首楼装饰 ~234ms。而产物其实是**纯函数**：给定（正文、depth、
    // fullpage 旗标、卡），输出恒定 —— 服务端 `/apply-regex-card` 与 `/render-status`
    // 都不读会话变量状态（见 lib/index.js 两个 handler）；变量更新走 era push
    // （postMessage 推给**在线** iframe 的运行时通路），与"重装饰"无关。
    //
    // **缓存边界（2026-09-25 放宽）**：带 `iframe.muv-iframe` 的楼**与**带
    // `.muv-statusbar-wrap` 的状态栏楼，都缓存。
    //
    // 为什么放宽（用户实测反馈：「点会话再切回去，状态栏要重新渲染」）：原边界把
    // 内置 `.muv-sb` 与文本级状态栏楼排除在外，理由是"数值当场从消息文本解析、
    // 缓存也省不了几毫秒"。但用户感知到的不是解析耗时，而是**切回来那段异步空窗** ——
    // 取卡 + 服务端往返要 ~234ms，这期间该楼处于未装饰态，看起来就是"闪一下重渲染"。
    // 缓存命中后这条路不再 await，同步交回产物，空窗消失。
    //
    // 为什么不冻变量：产物是**纯函数**（见上：两个 handler 都不读会话变量状态），
    // 且键里现在带 `|v<rev>` 变量修订号 —— 任何真实变量变更都会 `muvVarRevBump()`
    // 一次，把带变量的产物全部作废。见 `muvVarRev` 的长注释。
    var muvDecorCache = {}
    var muvDecorCacheAt = {}
    /**
     * 条目上限 / 单条体积上限 / **总字节上限**（2026-09-25 实测修正）。
     *
     * 为什么加总字节上限并把条数从 32 提到 512：真机实测（`_scratch\live-cache-count.mjs`，
     * 逐行切走→切回数 `/apply-regex-card`）发现**命中的全是最后访问的三个会话，更早访问的全会
     * 重装饰**（miss 23 / 41 / 3 次）—— 典型 LRU 被冲空。而 `32` 这个总条目上限实在太小：
     * **一个长会话（实测 24 个产物楼）就能吃掉大半**，走三四个会话就全被挤掉，
     * "切回秒开"于是只在最近几个会话上成立。
     *
     * 现在改成**双限界**：条数 ≤ 512 且总字节 ≤ 48MB。按条目是字符串、实测单条多为
     * 几十 KB（农场 srcdoc ≈ 52KB、苍玄界封面 ≈ 119KB），48MB 足以装下十几个长会话；
     * 真到上限时仍按 LRU 淘汰，内存不会被撑爆。
     */
    var MUV_DECOR_MAX = 512
    var MUV_DECOR_ENTRY_MAX = 320 * 1024
    var MUV_DECOR_TOTAL_MAX = 48 * 1024 * 1024
    /** 当前缓存总字节（随写入/命中/淘汰维护；崩溃也不致命，只影响淘汰时机）。 */
    var muvDecorBytes = 0

    /**
     * **变量状态修订号**（2026-09-25，"状态栏楼也能缓存"的安全性凭据）。
     *
     * 为什么需要：产物缓存键原先只含（会话、正文、depth、fullpage）—— 那是"产物是纯
     * 函数"这个前提的直接翻译。放宽到缓存状态栏楼之后，必须再加一道**变量维度**的保险：
     * 一旦真的有变量变更，带变量的产物要立刻作废，而不是等正文变化才自然失效。
     *
     * 挂在**真正的变更点**上（两处，都紧挨既有的 era 失效信号）：
     *   ① `muvFeedVariables` POST `/extract` 成功 ⇒ 服务端 merge 进新变量；
     *   ② 卡写变量 API POST `/state` 成功（`__muvVarWrite` 落地）。
     * **故意不挂**在 `muvEraVars.data = null` 的第三处（约 L4445）：那是 TTL 过期重取，
     * 数据可能一模一样 —— 挂上去只会让切回会话白白丢缓存。
     *
     * 计数而非时间戳：键要短、要稳定（同一状态同一键），时间戳会让每次读取都 miss。
     *
     * ★★ **必须按会话分开记**（2026-09-25 自查修正）：
     *   第一版写成"全局单计数 + 切会话归零"，那是**错的**：A 会话的产物以 `v5` 存进缓存，
     *   切到 B 时归零，切回 A 时键变 `v0` ⇒ **A 的缓存全部 miss** ⇒ 恰好把"切回秒开"
     *   毁掉 —— 而切回秒开正是本缓存的立身之本。所以改成 `sid → rev` 的映射：
     *   每个会话各自单调递增，切走切回**数值不变** ⇒ 键稳定 ⇒ 命中。
     * @type {Object<string, number>}
     */
    var muvVarRevBySid = Object.create(null)

    /**
     * 取某会话的变量修订号（读不到会话 id 时退回 0 —— 与"键里必须带 sid"同一口径，
     * 认不出会话的产物本来就不进缓存，见 `muvDecorKeyOf`）。
     * @param {string} sid
     * @returns {number}
     */
    function muvVarRevOf(sid) {
      try { return (sid && muvVarRevBySid[sid]) || 0 } catch (_) { return 0 }
    }

    /** 记一次真实的变量变更（只影响**当前会话**，见 `muvVarRevBySid` 的长注释）。 */
    function muvVarRevBump() {
      try {
        var sid = ''
        try { sid = currentSessionId() } catch (_) { sid = '' }
        if (!sid) return
        muvVarRevBySid[sid] = ((muvVarRevBySid[sid] || 0) + 1) % 1000000007
        // 有界：会话数超过 64 就丢掉最旧的一批（映射键就是会话 id，不会与产物缓存互相影响）
        var ks = Object.keys(muvVarRevBySid)
        if (ks.length > 64) { for (var i = 0; i < 16; i++) delete muvVarRevBySid[ks[i]] }
      } catch (_) {}
    }

    /**
     * 缓存键：会话 id + 正文键（与 `data-muv-kv` 同一个 `muvCompatKey` 散列）+
     * depth + fullpage 旗标。depth/fullpage 进键是因为它们**真实改变产物**
     * （`maxDepth/minDepth` 正则由 depth 决定；`muv-fullpage` 破格类由楼位旗标决定）。
     *
     * ★ fullpage **必须**进键（2026-09-25 恢复）：build k 曾去掉它，理由是"打标已写
     *   在产物字符串里、缓存命中天然带标"—— 那句话**只在"打标与楼位无关"的前提下
     *   自洽**。恢复楼位判据后，同一份 `text` 在封面楼与后续楼要产出**不同**的产物
     *   字符串，键里不带 `|fp` 就会互相命中（封面楼的满宽产物被后续楼复用，或反之）。
     *   详见 `muvFullpageFloor` 的长注释。
     *
     * ★ **变量修订号 `|v<n>` 也进键**（2026-09-25）：缓存边界从"只缓存 iframe 楼"
     *   放宽到"也缓存状态栏楼"（用户实测反馈：切回会话状态栏要重新渲染）。产物虽是
     *   纯函数，但状态栏的**观感**依赖变量，所以键里带一道变量维度保险 ——
     *   任何真实变量变更都会 `muvVarRevBump()`，把带变量的产物一次作废。
     *   同会话内数值不变 ⇒ 切走切回仍是同一键 ⇒ 命中（这正是要的秒开）。
     *
     * ★ 会话 id 只认**权威**来源（会话服务 / URL）：`currentSessionId()` 的第三档
     *   DOM 属性兜底在切换瞬间是**旧会话**的值，拿它当键会把 A 会话的产物错记到
     *   B 会话头上。认不出权威会话 ⇒ 返回 null ⇒ 本楼不缓存（与旧行为完全一致）。
     * @param {string} text 装饰输入原文
     * @param {number} depth 本次装饰的层号
     * @returns {string|null}
     */
    function muvDecorKeyOf(text, depth) {
      try {
        var sid = ''
        var svc = window.__DSH_TAVERN_SESSIONS__
        if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
          var snap = svc.list.getSnapshot()
          var cur = snap && snap.current
          if (cur && /^(session-)?[a-f0-9-]{20,}$/i.test(String(cur))) {
            sid = 'session-' + String(cur).replace(/^session-/, '')
          }
        }
        if (!sid) {
          var m = location.href.match(/session[/=:-]([a-f0-9-]{20,})/i)
          if (m && m[1]) sid = 'session-' + m[1].replace(/^session-/, '')
        }
        if (!sid) return null
        var fp = false
        try { fp = muvFullpageFloorNow() === true } catch (_) {}
        var vr = 0
        try { vr = muvVarRevOf(sid) } catch (_) {}
        var d = (typeof depth === 'number' && isFinite(depth)) ? depth : 0
        return sid + '|' + muvCompatKey(text) + '|d' + d + (fp ? '|fp' : '') + '|v' + vr
      } catch (_) { return null }
    }

    function muvDecorCacheGet(key) {
      try {
        if (Object.prototype.hasOwnProperty.call(muvDecorCache, key)) {
          muvDecorCacheAt[key] = Date.now()
          return muvDecorCache[key]
        }
      } catch (_) {}
      return null
    }
