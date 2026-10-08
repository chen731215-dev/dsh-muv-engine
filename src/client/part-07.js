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
