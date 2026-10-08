
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

    /** 卡 iframe 首屏遮蔽的**绝对上限**（ms）：超过它一律显形，宁可闪一下也不让卡永久隐身。 */
    var MUV_CARD_MASK_MAX = 15000

    /**
     * 让一张卡 iframe 显形（幂等）。遮蔽见 `ensureCardMask` / `cardHtmlIframe`。
     * @param {Element} frame
     * @returns {void}
     */
    function muvCardShow(frame) {
      try {
        if (!frame || !frame.setAttribute) return
        if (frame.getAttribute('data-muv-shown') === '1') return
        frame.setAttribute('data-muv-shown', '1')
      } catch (_) {}
    }

    /**
     * 安装卡 iframe 首屏遮蔽的**两条兜底**（全局只装一次，幂等标记挂 `window`）。
     *
     * 遮蔽本体是一条**宿主样式规则**（带 `data-muv-mask` 的卡 iframe 上挂 `opacity:0`，
     * 见注入样式区；判据见 `cardHtmlIframe`），显形的**主路**是
     * 卡内垫片报的 `{__muvReady:1}`（见 `muvCardCompatScript` 第 0 段）。这里补两条兜底，
     * 保证"遮蔽"**不可能**把卡永久藏起来：
     *   ① iframe 的 `load` 事件 —— 用**捕获期**挂在 `document` 上（`load` 不冒泡，但捕获
     *      阶段能到 document）。子文档的 `load` 一定不早于它自己的 `DOMContentLoaded`，
     *      所以显形时同样是终态；垫片被卡的 HTML 顶掉、或根本不是卡文档（没有垫片）时
     *      靠这条兜住。
     *   ② 绝对上限 `MUV_CARD_MASK_MAX` —— 连 `load` 都没来（文档整个没加载成功）也不会
     *      永远隐身。记"第一次看到它还盖着"的时刻，用 **WeakMap** 记而不是写进 iframe 的
     *      HTML：产物是**缓存字符串**，把时间戳写进 HTML 会让缓存命中的那份带着旧时间戳，
     *      一插进来就判超时 ⇒ 遮蔽当场失效（切回会话走的正是缓存命中这条路）。
     * @returns {void}
     */
    function ensureCardMask() {
      try {
        if (typeof window === 'undefined' || !window) return
        if (window.__muvCardMaskOn === true) return
        window.__muvCardMaskOn = true
        window.addEventListener('load', function (ev) {
          var t = ev && ev.target
          try {
            if (!t || String(t.tagName || '').toUpperCase() !== 'IFRAME') return
            if (!t.getAttribute || !t.getAttribute('data-muv-mask')) return
          } catch (_) { return }
          muvCardShow(t)
        }, true)
        var seen = new WeakMap()
        window.setInterval(function () {
          var frames
          try { frames = document.querySelectorAll('iframe.muv-iframe[data-muv-mask]') } catch (_) { return }
          var now = Date.now()
          for (var i = 0; i < frames.length; i++) {
            var f = frames[i]
            try { if (f.getAttribute('data-muv-shown') === '1') continue } catch (_) { continue }
            var t0 = 0
            try { t0 = seen.get(f) || 0 } catch (_) { t0 = 0 }
            if (!t0) { try { seen.set(f, now) } catch (_) {} continue }
            if (now - t0 >= MUV_CARD_MASK_MAX) muvCardShow(f)
          }
        }, 1200)
      } catch (_) {}
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
        // 同 `muvCardCompatSeed`：内存 miss 先回捞持久层（hello 回送与首帧种子同一份账）。
        try { muvKvEnsure(ns) } catch (_) {}
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
     * 把产物里的 KV 种子段**替换为当前时刻的现算快照**（渲染出口统一过一遍）。
     *
     * 为什么必须有（2026-09-24，足控天堂暗色不保存第二段根因）：种子字面量是
     * `withCardCompat` 在**构建时**算死的，而产物（`muvInjectCache` 与上游的装饰产物
     * 缓存）会被**原样缓存复用** —— 真机实测（Storage 访问 hook）：reload 后 srcdoc 里
     * 的种子停在 `__muvKvSeed={}`（首次构建、持久层还没有数据时的快照），此后无论 KV
     * 写了多少、回捞命中与否，种子永远是那份冻结值。hello 应答虽然会把最新种子
     * postMessage 回填进垫片（`mem` 里看得到 `zkt2-theme`），但那是**异步竞速**：
     * 应答早于卡的 `DOMContentLoaded` 就赢（主题生效），晚于就输（永远默认主题）——
     * 真机三轮实验恰好一次赢两次输。根治：卡 iframe 的**唯一渲染出口**上，用
     * `muvCompatSeedMap`（带回捞）的**当前值**覆盖产物里那段种子，缓存命中路径、
     * 内存缓存路径、上游持久缓存路径三路统一生效。
     *
     * 定位口径：种子段由我们自己注入且**必在文档最前**（`withCardCompat` 落在第一个
     * head/html 锚点），所以取**第一个** `window.__muvKvSeed=`，配我们自己的
     * `;window.__muvVH=` 收尾（同一句话里相邻产出）——不扫卡正文，也不正则。
     * 找不到锚点（旧版产物/别的形态）就原样返回，**不比覆盖前差**。
     * @param {string} html 注入链产物（尚未进 srcdoc 属性转义）
     * @param {string} key `data-muv-kv` 上的卡键
     * @returns {string}
     */
    function muvKvSeedFill(html, key) {
      try {
        var at = html.indexOf('window.__muvKvSeed=')
        if (at < 0) return html
        var end = html.indexOf(';window.__muvVH=', at)
        if (end < 0) return html
        return html.slice(0, at) + 'window.__muvKvSeed=' + muvJsonSafe(muvCompatSeedMap(key)) + html.slice(end)
      } catch (_) { return html }
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
