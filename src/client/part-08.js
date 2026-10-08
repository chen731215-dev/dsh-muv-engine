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
          // ★ 变量修订号 +1：服务端已 merge 进新变量 ⇒ 所有带变量的缓存产物作废。
          try { muvVarRevBump() } catch (_) {}
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
        // ★ 变量修订号 +1：卡自己写了变量 ⇒ 带变量的缓存产物作废（同 muvFeedVariables）。
        try { muvVarRevBump() } catch (_) {}
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

