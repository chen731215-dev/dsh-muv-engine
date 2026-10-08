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
     * 卡自己会 toast 提示）；mode='send' 填入后再代发一次（多通道，见 `muvUserSendFire`
     * 的取证结论与通道矩阵：① 真实 click 发送按钮 ② 完整 Enter 键盘序列）。
     * 找输入框的优先级与 `exports.apply` 里 muv-choice-btn 的点击委托一致：宏钩子标记 →
     * placeholder 关键词 → 兜底全量扫（可见、可写、rows≥2）。值必须走**原生 setter**
     * （DSH 的输入框是受控组件）——这条填值路径已验证工作，**本函数不改动**。
     * @param {string} text
     * @param {'fill'|'send'} mode
     * @returns {boolean} 是否找到了输入框并写入
     */

    /**
     * 用户消息桥 send 通道（多通道，逐级降级）。
     *
     * ★ 取证结论（DSH web-frontend @deepseek-ai/dsh v0.1.5-rc.2，dist/assets/index-*.js +
     *   vendor-*.js，只读未改本体）：
     *  - DSH 聊天界面是 **React 应用**；发送绑定在「发送按钮」与「输入框 onKeyDown(Enter)」
     *    两处（bundle 里有 `IconSendOutline` 发送图标按钮，onClick→发送、onKeyDown
     *    Enter/Space→发送；输入框走 `e.key === "Enter"` 判据）。
     *  - 全链路**没有任何 `e.isTrusted` 校验**（bundle 里出现的 `isTrusted:0` 是 React
     *    SyntheticEvent 的默认字段，不是守卫）——所以合成事件可被接受。
     *  - **没有任何暴露到 `window` 的可编程发送入口**（仅 `window.__ModuleLoader__` 内部
     *    加载器，不是发送 API）——故「直接调全局函数」这条通道不可用。
     *  - React 的 `getEventKey` 把 `keyCode 13 → "Enter"`，且合成 `KeyboardEvent` 的
     *    `keyCode/which` 取构造参数；若处理器读 `keyCode/which`（非常常见），旧实现只带
     *    `key:'Enter'`（keyCode/which=0）的合成事件会**静默落空**——这正是用户实测
     *    「卡里提交后 DSH 没生成下文」的头号嫌疑。
     *  ⇒ 加固为：① 真实 `click()` 发送按钮（最稳，直接调其发送回调，不吃事件形态）→
     *    ② 输入框派发**完整键盘序列** keydown+keypress+keyup，keyCode/which/code 全带上。
     *  ★ 铁律：**绝不清空输入框**——宁可消息留在框里让用户手动按一下，也不能吞字
     *    （旧实现曾因只派一个 keydown 且没留痕，失败时连「字还在」都不可见）。每通道留痕
     *    `console.info('[muv-engine] 用户消息桥：…')`，方便用户回报哪个通道命中。
     * @param {HTMLTextAreaElement|null} ta 已填好值的输入框
     */
    function muvUserSendFire(ta) {
      if (!ta) return
      function log(s) { try { console.info('[muv-engine] 用户消息桥：' + s) } catch (_) {} }
      // —— 通道①：发送按钮真实 click()（最可靠，绕过键盘事件形态差异）——
      var btn = null
      try {
        // 从输入框向上爬父链（≤6 层），收集同容器内所有 button；优先「带 发送/Send/Submit
        // 字样」的，否则回落到容器内最后一个可见且未禁用的 button（发送钮通常在输入框之后）。
        var chain = ta, lastBtn = null
        for (var i = 0; i < 6 && chain; i++) {
          var cands = chain.querySelectorAll ? chain.querySelectorAll('button') : []
          for (var j = 0; j < cands.length; j++) {
            var b = cands[j]
            if (!b || b.disabled || b.offsetParent === null) continue
            lastBtn = b
            var label = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')
            if (/发送|send|submit/i.test(label)) { btn = b; break }
          }
          if (btn) break
          chain = chain.parentElement
        }
        if (!btn && lastBtn) btn = lastBtn
      } catch (_) {}
      if (!btn) {
        try {
          var all = document.querySelectorAll('button')
          for (var k = 0; k < all.length; k++) {
            var x = all[k]
            if (x && !x.disabled && x.offsetParent !== null && /发送|send|submit/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '') + ' ' + (x.textContent || ''))) { btn = x; break }
          }
        } catch (_) {}
      }
      if (btn) {
        try { btn.click(); log('通道① 发送按钮 click() 已触发（' + (btn.getAttribute('aria-label') || btn.textContent || 'button') + '）'); return } catch (e) { log('通道① 发送按钮 click() 异常：' + (e && e.message)) }
      } else {
        log('通道① 未找到发送按钮，跳过')
      }
      // —— 通道②：完整键盘序列（keydown+keypress+keyup，keyCode/which/code 全带）——
      try {
        var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }
        var seq = ['keydown', 'keypress', 'keyup']
        for (var s = 0; s < seq.length; s++) {
          var ev = new KeyboardEvent(seq[s], opts)
          // 部分浏览器忽略构造参数里的 keyCode/which，强制补成 getter
          try { Object.defineProperty(ev, 'keyCode', { get: function () { return 13 } }) } catch (_) {}
          try { Object.defineProperty(ev, 'which', { get: function () { return 13 } }) } catch (_) {}
          ta.dispatchEvent(ev)
        }
        log('通道② 键盘序列 Enter(keydown+keypress+keyup, keyCode=13) 已派发')
      } catch (e) {
        log('通道② 键盘序列异常：' + (e && e.message) + '；回退最小 keydown')
        try { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); log('通道② 兜底 keydown 已派发') } catch (_) {}
      }
      // 注意：此处不 return —— 两个通道都试过，但**绝不**清空 ta.value（防吞字）。
    }

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
      if (!textarea) {
        // ── contenteditable 输入框（DSH 真机取证 2026-09-25）：DSH WebUI 的聊天输入框
        //    根本不是 `<textarea>` —— 会话视图全页 0 个 textarea，输入框是
        //    `[contenteditable="true"]`（类名 uV2eYG_input，发送钮 aria-label「发送消息」）。
        //    旧代码走到这里直接 `return false` 静默放弃 ⇒ 卡的「发送到酒馆」链路
        //    （状态栏选项点击等）全部无声无息，且没有任何日志（bug：选项点击没反应）。
        //    verify-user-send 门禁此前没抓到，因为夹具用的是假 textarea —— 与真实 DOM 不符。
        //    fix：contenteditable 走 caret 移到末尾 + insertText **追加**（同一条铁律：
        //    绝不清空输入框，宁可消息留在框里让用户手动按一下）。
        var ce = null
        try { ce = document.querySelector('[contenteditable="true"]') } catch (_) { ce = null }
        if (ce && ce.getAttribute && ce.getAttribute('data-muv-inbox')) ce = null
        if (!ce) {
          try { console.info('[muv-engine] 用户消息桥：未找到输入框（textarea 与 contenteditable 均无），放弃投递') } catch (_) {}
          return false
        }
        var vce = String(text == null ? '' : text)
        var beforeLen = null
        try { beforeLen = String(ce.textContent == null ? '' : ce.textContent).length } catch (_) { beforeLen = null }
        // 记录插入期间有没有原生 input 事件（见下方合成 InputEvent 的前置判据）
        var sawNativeInput = false
        var _markNativeInput = function () { sawNativeInput = true }
        try { ce.addEventListener('input', _markNativeInput, true) } catch (_) {}
        var appended = false
        try {
          ce.focus()
          var sel = window.getSelection()
          var rg = document.createRange()
          rg.selectNodeContents(ce)
          rg.collapse(false)
          sel.removeAllRanges()
          sel.addRange(rg)
          appended = document.execCommand('insertText', false, vce)
        } catch (_) { appended = false }
        // ★ 兜底判据看**文本到底长了没有**，不看 `execCommand` 的返回值。
        //   真机 DSH（React 受控 contenteditable）上 execCommand 会「确实插入成功但返回 false」，
        //   只按返回值走兜底 ⇒ 同一段文字被插两次。2026-09-26 真机取证（_probe-sbopt8.mjs）：
        //   点一次状态栏行动选项后，选项原文在输入框里出现**两份**。
        //   所以：能测量就以「长度是否增长」为准；只有确实没增长、且 execCommand 也没报成功，
        //   才退到 appendChild。测量失败（拿不到 textContent）时才信 execCommand 的返回值。
        var grew = false
        if (beforeLen !== null) {
          try { grew = String(ce.textContent == null ? '' : ce.textContent).length > beforeLen } catch (_) { grew = false }
        }
        if (!grew && !appended) {
          // execCommand 不可用时的兜底：追加文本节点（textContent 赋值会整体替换，违反铁律，不用）
          try {
            ce.appendChild(document.createTextNode(vce))
          } catch (_) {}
        }
        try { ce.removeEventListener('input', _markNativeInput, true) } catch (_) {}
        // ★ 只在浏览器**没有**自己派发 input 事件时才补一个合成 InputEvent。
        //   真机 DSH 的输入框是受控编辑器：`execCommand('insertText')` 本身就会触发原生 input，
        //   宿主据此更新自己的模型；我们再补一个带 `data` 的合成 InputEvent，宿主会把它当成
        //   「再插一次」的指令 ⇒ 同一段文字在框里出现两份（2026-09-26 真机取证）。原生事件
        //   已经到过就不再补，只有真的没有任何 input 事件时才补（保证 React 感知兜底）。
        if (!sawNativeInput) {
          try { ce.dispatchEvent(new InputEvent('input', { bubbles: true, data: vce, inputType: 'insertText' })) } catch (_) {}
        }
        try { console.info('[muv-engine] 用户消息桥：contenteditable 输入框已追加文本（append，不清空原内容）') } catch (_) {}
        if (mode === 'send') {
          setTimeout(function () {
            try { muvUserSendFire(ce) } catch (e) { try { console.info('[muv-engine] 用户消息桥：send 通道异常 ' + (e && e.message)) } catch (_) {} }
          }, 60)
        }
        return true
      }
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
        // 多通道发送（见上方 muvUserSendFire 取证结论 + 通道矩阵）：① 真实 click 发送按钮
        // ② 完整 Enter 键盘序列。填值路径（原生 setter + input 事件）已验证工作，不动。
        // 延时 60ms 等 React 受控组件把 input 事件吃进 state、发送按钮解除 disabled。
        setTimeout(function () {
          try { muvUserSendFire(textarea) } catch (e) { try { console.info('[muv-engine] 用户消息桥：send 通道异常 ' + (e && e.message)) } catch (_) {} }
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

    // ── KV 持久层（宿主 localStorage）────────────────────────────────────────
    // 为什么必须有（2026-09-24，足控天堂暗色切换不保存实锤）：`muvKv` 是**页面级内存**，
    // 硬刷新/关页就清零，`muvChatFence` 切会话还会把其他会话的命名空间从内存删掉 ——
    // 于是「点暗色 → 立即生效，重进会话/硬刷新 → 变回默认」。真机取证（探针
    // `_probe-zkt-theme.mjs`）：点击后卡内 `localStorage` 有 `zkt2-theme=day`，硬刷新后
    // `keys=[]`、主题回 night；宿主 localStorage 里 `muvKv*` 键数 = 0（没有任何持久层）。
    // ST 的卡为什么能存：ST 的卡 iframe **同源**，`localStorage` 是真·浏览器存储（持久、
    // 同步、按 origin）。我们的沙箱是不透明来源，卡够不着 —— 所以持久化只能由**宿主**
    // 做：宿主页是真 origin，它的 `localStorage` 同步可用，语义和 ST 卡里看到的对齐。
    //
    // 安全语义（不许 loosening）：
    //  - 持久键 = `前缀 + muvKvKeyOf(key)`，会话栅栏**原样带进持久层** —— B 会话的命名
    //    空间永远读不到 A 会话的持久副本，跨会话隔离不变；
    //  - 持久键**不从 postMessage 里取**（同 `onMuvCardCompatMessage` 的口径），恶意卡
    //    无法指定写哪个桶；
    //  - localStorage 不可用（隐私模式等）时全部退化为现状的纯内存 —— 只差持久化，
    //    不引入新失败模式。
    //
    // 实现约定：全部**同步**写（卡 setItem 返回即已落盘），读在种子/回捞时按需做；
    // 不用正则字面量、不用除法（这些函数会被门禁逐字提取，提取器对 `/` 有额外判断）。
    var MUV_KV_PERSIST_PREFIX = 'muvKvP:'

    /** 宿主 localStorage，不可用返回 null（调用方一律走 try/catch + null 分支）。 */
    function muvKvPersistLs() {
      try {
        if (typeof window === 'undefined' || !window) return null
        var ls = window.localStorage
        if (!ls) return null
        ls.setItem(MUV_KV_PERSIST_PREFIX + '__probe', '1')
        ls.removeItem(MUV_KV_PERSIST_PREFIX + '__probe')
        return ls
      } catch (_) { return null }
    }

    /** 读一个命名空间的持久副本；没有/坏了/超限返回 null（调用方按"没存过"处理）。 */
    function muvKvPersistRead(ns) {
      var ls = muvKvPersistLs()
      if (!ls) return null
      var s = null
      try { s = ls.getItem(MUV_KV_PERSIST_PREFIX + ns) } catch (_) { return null }
      if (typeof s !== 'string' || !s) return null
      var v = null
      try { v = JSON.parse(s) } catch (_) { return null }
      if (!v || typeof v !== 'object') return null
      // 逐键重建：值必须是 string、条数/单值上限与写入侧同口径 —— 持久层里躺的是
      // JSON，不信任它的形状（同源脚本可写 localStorage，别给伪造数据开直通车）。
      var out = {}
      var n = 0
      for (var k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue
        if (typeof v[k] !== 'string') continue
        if (v[k].length > MUV_KV_MAX_VAL) return null
        n++
        if (n > MUV_KV_MAX_ITEMS) return null
        try { out[k] = v[k] } catch (_) { return null }
      }
      return out
    }

    /**
     * 全量覆写一个命名空间的持久副本。quota 失败时回收**最旧的**持久键（不碰当前这个、
     * 不碰非 `muvKvP:` 的键）重试一次，仍失败就放弃 —— 持久化尽力而为，失败退化为内存。
     * @returns {boolean} 是否写入成功
     */
    function muvKvPersistWrite(ns, st) {
      var ls = muvKvPersistLs()
      if (!ls) return false
      var s = ''
      try { s = JSON.stringify(st) } catch (_) { return false }
      try { ls.setItem(MUV_KV_PERSIST_PREFIX + ns, s); return true } catch (_) {}
      try {
        var old = []
        for (var i = 0; i < ls.length; i++) {
          var kk = ls.key(i)
          if (kk && kk.indexOf(MUV_KV_PERSIST_PREFIX) === 0 && kk !== MUV_KV_PERSIST_PREFIX + ns) old.push(kk)
        }
        old.sort(function (a, b) {
          var ta = muvKvAt[a.slice(MUV_KV_PERSIST_PREFIX.length)] || 0
          var tb = muvKvAt[b.slice(MUV_KV_PERSIST_PREFIX.length)] || 0
          return ta - tb
        })
        for (var j = 0; j < old.length; j++) {
          try { ls.removeItem(old[j]) } catch (_) {}
          try { ls.setItem(MUV_KV_PERSIST_PREFIX + ns, s); return true } catch (_) {}
        }
      } catch (_) {}
      return false
    }

    /** 删一个命名空间的持久副本（`clear` 用；LRU/fence **不删**持久层 —— 见 muvKvEnsure）。 */
    function muvKvPersistRemove(ns) {
      try {
        var ls = muvKvPersistLs()
        if (ls) ls.removeItem(MUV_KV_PERSIST_PREFIX + ns)
      } catch (_) {}
    }

    /**
     * 内存 miss 时从持久层回捞一个命名空间（灌回内存 + LRU 记账）。
     *
     * 回捞面覆盖两类丢失：① 硬刷新后整张 `muvKv` 清零；② `muvChatFence` 切会话时把
     * 其他会话的命名空间从内存删掉（那只是**内存**清理，切回来时在这里原样捞回）。
     * 捞回的对象来自持久层，条数/单值上限已在 `muvKvPersistRead` 里核过。
     * @param {string} ns `muvKvKeyOf` 产出的命名空间键
     * @returns {void}
     */
    function muvKvEnsure(ns) {
      if (typeof muvKv !== 'object' || !muvKv) return
      if (Object.prototype.hasOwnProperty.call(muvKv, ns)) return
      var v = muvKvPersistRead(ns)
      if (!v) return
      try { muvKv[ns] = v } catch (_) { return }
      try { if (!muvKvAt[ns]) muvKvAt[ns] = Date.now() } catch (_) {}
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
     *
     * ★ 只删**内存**（`muvKv`），不碰持久层（`muvKvP:` 那份）：删掉的命名空间切回来时由
     *   `muvKvEnsure` 从持久层原样捞回 —— 足控天堂「切走再切回主题保持」靠的就是这条。
     *   持久层键自带会话栅栏（`<卡键>@<会话 id>`），留在那里不会跨会话串数据。
     * @returns {string} 当前会话 id（认不出为空串）
     */
    function muvChatFence() {
      var sid = ''
      try { sid = currentSessionId() } catch (_) { sid = '' }
      if (sid && sid !== muvChatSession) {
        muvChatSession = sid
        muvChatLog = []
        // ★ 变量修订号**故意不在这里归零**（2026-09-25 自查修正）：修订号是按会话分开记的
        //   （`muvVarRevBySid`），在这里归零会把**上一个会话**的产物缓存全部变成 miss，
        //   恰好毁掉"切回秒开"。有界性由 `muvVarRevBump` 里按会话数淘汰负责。
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
        // 内存 miss 先回捞持久层：硬刷新/切会话回来时，种子里的就是持久化的那份
        // （这一步是同步的 —— 卡首屏解析期就读 localStorage，异步回填来不及）。
        try { muvKvEnsure(ns) } catch (_) {}
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
