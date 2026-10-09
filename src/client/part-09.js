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
     * ★ task-22（2026-10-10）：这条消息文本里**自带**状态数据信号吗？
     *
     * 四种内联变量块（大小写不敏感；`[\s>]` 钉死"标签形态"，`<UpdateVariableX>` 这种
     * 恰好同前缀的别的标签不误认）：
     *   `<UpdateVariable>` / `<initvar>` —— MUV 原生 YAML 变量块（part-07 的回灌源）；
     *   `<VariableEdit>` / `<era_data>` —— ERA/MVU 框架的变量编辑与数据块。
     * 命中 ⇒ 这条消息**确定**有状态可显示，补占位符没有争议。
     * @param {string} text
     * @returns {boolean}
     */
    function muvMsgSignalsStatus(text) {
      return /<UpdateVariable[\s>]|<initvar[\s>]|<VariableEdit[\s>]|<era_data[\s>]/i.test(String(text == null ? '' : text))
    }

    /**
     * ★ task-22：**本会话**有没有变量树可显示？（读 part-08 的工厂级缓存 `muvEraVars`，
     *   口径与 `muvEraAnswer` 一致：缓存必须**归属当前会话**才作数。）
     *
     * 为什么需要这一条：ERA 类卡（`_足控天堂2`）的状态栏页面是**脚本自己拉数据**的
     * （iframe 里经桥取 `era:getCurrentVars`），很多楼的正文里**没有**内联变量块 ——
     * 只看消息信号会把那些楼的状态栏误杀（这正是第 119 轮方案 (C) 里预警过的回归）。
     * 所以消息没信号时，再看会话级：会话确实有变量 ⇒ 状态栏有东西可显示 ⇒ 照补。
     *
     * 三个防坑（都实测过形态）：
     *   ① **locator 归属**：缓存必须对得上当前会话/预设 —— 否则切会话后拿到上一张卡
     *      的变量树，空数据会话又要刷屏（老问题的变体）。
     *   ② **取数在途 ⇒ 乐观放行**：warm 是卡 iframe 的 `__muvHello` 触发的，首楼装饰时
     *      取数常在路上；这时判"无变量"会把先头几楼的状态栏灭掉（且重装饰不保证发生）。
     *      在途 ⇒ 按有处理，宁可多补一次也不灭灯。
     *   ③ **非对象/空树 ⇒ 无**：`data` 为 null（未就绪）或 `{}`（真没数据）都算无 ——
     *      后者正是第 119 轮那个「DATE 未知 / TIME 未知 / LOCATION 未知」空卡的来源。
     * @returns {boolean}
     */
    function muvSessionHasVariables() {
      try {
        if (!muvEraVars) return false
        // ★ 别名间接（反陷阱注释）：这里**故意不写「调用 muvEraLocator」的带括号形态**。
        //   门禁（test-client-render 的 buildFrom / verify-status-placeholder-era 的静态提取）
        //   会按「名字+左括号」扫被调函数并从产物里**连根拔源码** —— 而且扫描**不区分注释**，
        //   注释里出现带括号形态一样中招（本注释的前一版就踩了：真 muvEraLocator 的体内
        //   调 currentSessionId 等，在夹具作用域里拿不到 ⇒ 返回空 ⇒ 本判据恒 false，
        //   「会话有变量」那条正向永远量不到）。
        //   经别名引用（无括号形态不被扫描）⇒ 门禁用 deps 注入的桩，产品用真函数，两不误。
        var getLoc = (typeof muvEraLocator === 'function') ? muvEraLocator : null
        var locator = getLoc ? getLoc() : ''
        if (!locator || muvEraVars.locator !== locator) return false
        if (muvEraVars.inflight) return true
        var d = muvEraVars.data
        if (d == null || typeof d !== 'object') return false
        for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) return true }
        return false
      } catch (_) {
        return false
      }
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
 * ★ task-22（2026-10-10）再加一道门：卡认标记，还要**本条消息带状态信号**或
 *   **本会话有变量树**才补（见下方 muvMsgSignalsStatus / muvSessionHasVariables）——
 *   无数据楼不补，空状态栏（全 `未知`）不再刷屏。
 * @param {string} text
 * @param {object|null} cardJson
 * @returns {string}
 */
    function withStatusPlaceholder(text, cardJson) {
      try {
        if (!text) return text
        if (STATUS_PH_TEST.test(text)) return text
        if (!cardWantsStatusPlaceholder(cardJson)) return text
        // ★ task-22（2026-10-10）：「卡认标记」不再单独构成补占位符的理由 —— 还得
        //   **本条消息真的带状态**（内联变量块，见 muvMsgSignalsStatus）或
        //   **本会话真的有变量树**（见 muvSessionHasVariables）。
        //   否则「按名查库误命中 + 卡自带消费占位符正则」会像第 119 轮真机实锤的那样：
        //   每条无数据消息都挂一张全 `未知` 的空状态栏（黄金庭院，DATE/TIME/LOCATION 未知）。
        //   两支分别保住两类卡：内联块楼层走信号分支；脚本自拉数据的 ERA 卡
        //   （很多楼没有内联块）靠会话变量树那支保住 —— 两支都不满足才真的不补。
        if (!muvMsgSignalsStatus(text) && !muvSessionHasVariables()) return text
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
    // 取证（真机 CDP，开发机上的 `_probe-session-cache.mjs`；属易失产物，不在仓内）：切走→切回同一
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

    /**
     * 收"值得缓存"的产物（带卡 iframe **或**带状态栏 wrap、体积在限内），按最近使用 LRU 淘汰；
     * 条目跨会话切换**保留** —— 那正是"切回秒开"的本体。
     * 内存护栏 = **条数上限（512）与总字节上限（48MB）双限界**，见那两个常量的注释
     * （原先是"条数 32"，实测一个长会话就能吃掉大半 ⇒ 切几个会话回来就 miss）。
     * 原样返回 html（调用点直写 `return muvDecorStore(...)`）。
     */
    function muvDecorStore(key, rawText, html) {
      try {
        if (key && html && html !== rawText && html.length <= MUV_DECOR_ENTRY_MAX &&
            (html.indexOf('<iframe class="muv-iframe"') >= 0 ||
             html.indexOf('muv-statusbar-wrap') >= 0)) {
          var prev = muvDecorCache[key]
          if (typeof prev === 'string') { try { muvDecorBytes -= prev.length } catch (_) {} }
          muvDecorCache[key] = html
          muvDecorCacheAt[key] = Date.now()
          try { muvDecorBytes += html.length } catch (_) {}
          var keys = Object.keys(muvDecorCache)
          // 双限界淘汰：条数超上限**或**总字节超上限都按 LRU 丢最旧的（见常量处注释）。
          while (keys.length > MUV_DECOR_MAX || muvDecorBytes > MUV_DECOR_TOTAL_MAX) {
            var oldest = keys[0], ot = Infinity
            for (var i = 0; i < keys.length; i++) {
              var t = muvDecorCacheAt[keys[i]] || 0
              if (t < ot) { ot = t; oldest = keys[i] }
            }
            // 只省一条时不要再丢自己（keys.length===1 且只剩刚写进去的这条 ⇒ 说明单条就超总上限）
            if (keys.length <= 1) break
            try {
              if (typeof muvDecorCache[oldest] === 'string') muvDecorBytes -= muvDecorCache[oldest].length
              delete muvDecorCache[oldest]; delete muvDecorCacheAt[oldest]
            } catch (_) {}
            keys = Object.keys(muvDecorCache)
          }
        }
      } catch (_) {}
      return html
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
      muvBeautifyTrace('enter', opts && opts.depth, 'len=' + muvTrimmedLen + ' tag=' + muvHasTag)
      var muvShortOk = muvTrimmedLen > 0 && muvTrimmedLen <= 300
      // ★ 第 35 轮：文本级状态栏形态也要放行 —— 这类消息可能既**没有 HTML 标签**
      //   （纯 `[键:值]` 堆叠）、又**超过 300 字**（长状态前缀 + 长正文），两条既有
      //   判据都拦不住它，而它正是本轮要救的那一类。判据本身是保守的
      //   （≥2 个连续已知键、只在消息开头），所以这里放行不会退化成"所有文本都取卡"。
      var muvTsShaped = !!(muvTextStatusProbe(text).prefix || muvTextDetailsOf(text))
      if (!muvHasTag && !muvShortOk && !muvTsShaped) return text

      // ★★ 切回会话秒开（2026-09-24）：缓存命中即直接交回上次的装饰产物 —— 跳过
      //    取卡/服务端正则往返/级联/iframe 化全链。键与"缓存什么、不缓存什么"
      //    的边界见 muvDecorKeyOf / muvDecorStore 的长注释（只缓存带卡 iframe 的
      //    楼；状态栏楼、纯散文楼照旧现算，变量楼的数值不受任何影响）。
      var muvCk = muvDecorKeyOf(text, depth)
      if (muvCk) {
        var muvHit = muvDecorCacheGet(muvCk)
        if (muvHit != null) { muvBeautifyTrace('cache-hit', depth, 'len=' + String(muvHit).length); return muvHit }
      }

      const normalized = normalizeStatusHeader(text)

      try {
        // Get card data for regex scripts
        const cardJson = await fetchTavernCard()
        muvBeautifyTrace('card', opts && opts.depth, cardJson ? ('ok name=' + (cardJson.cardName || cardJson.name)) : ('NULL inconclusive=' + muvCardFetchInconclusive))

        if (cardJson) {
          // ★ 卡脚本（TavernHelper / 酒馆助手）：MVU 的状态栏 HUD 那一类 UI 是它们
          //   在运行时画的（不是正则产物），必须在 `cardHtmlIframe` 之前到位 ——
          //   那个函数是**同步**的，所以这里趁 `_decorateOne` 本来就在 await 先取回来。
          //   同一张卡全站只飞一次网络（见 `muvLoadCardScripts` 的按卡缓存）。
          muvCardScripts = await muvLoadCardScripts(cardJson)
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
          muvBeautifyTrace('apply', opts && opts.depth, 'ok=' + d.ok + ' textLen=' + String(d.text || '').length + ' applied=' + d.applied)
          // ★ 开场白 depth 兜底（2026-09-24，苍玄界全程实锤）：
          //   社区卡开场白正则普遍 `maxDepth: 0`。ST 播种路径对 first_mes 不传深度
          //   （script.js:7660）⇒ 开场白永远渲染；而 DSH 重渲染旧会话时首楼 depth>0
          //   ⇒ 开场白替换被服务端 depth 检查拒掉 ⇒ **原样返回** ⇒ 楼被钉成裸占位符。
          //   竞态使它更隐蔽：React 渲染后续楼时会重建首楼元素，已写入的 iframe 被清，
          //   扫摆重装饰时 depth 已 >0 ——「开头时有时无」的真相。
          //   兜底：服务端**实质原样返回**（响应仍是微小文本 —— 成功的开场白替换
          //   产物是 90KB+，微小即说明 depth 拒了替换；注意不能跟 normalized 逐字比，
          //   因为 applied 的隐藏类脚本会删掉 `<StatusPlaceHolderImpl/>`，字面必不相等）
          //   且文本是短占位符（≤300）⇒ 内部用 depth 0 重打一次（等价 ST 播种语义）。
          //   只对短占位符生效，长正文零成本；`[8]`类 minDepth 脚本不受影响。
          if (d.ok && String(d.text || '').length <= 400 && depth > 0 && muvTrimmedLen <= 300) {
            try {
              const r2 = await fetch('/api/muv-engine/apply-regex-card', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: regText, cardJson, depth: 0 })
              })
              const d2 = await r2.json()
              if (d2.ok && d2.text && d2.text !== normalized) {
                muvBeautifyTrace('retry-depth0', depth, 'textLen=' + String(d2.text).length)
                d.text = d2.text
              }
            } catch (_) {}
          }
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
            // ★★ 第 35 轮：**文本级状态栏兜底**。优先级最低 —— 占位符 / 卡自带皮肤 /
            //    `<Status_block>` 任一命中就完全不参与（判据在 muvStatusAlreadyRendered）。
            //    命中时把正文开头那串裸 `[键:值]` 换成状态栏卡片、把 `<details>` 状态
            //    折叠块换成折叠 UI（内容仍出自既有 loose 级联）。
            result = await muvApplyTextStatus(result, muvStatusAlreadyRendered(result, sbHtml))
            // 卡里「主页 / 正文美化」这类正则产出的是被 markdown 围栏包住的整页 HTML，
            // 必须在这里换成 iframe，否则 DSH 会把它当代码块渲染成几十 KB 文本。
            return muvDecorStore(muvCk, text, renderFencedHtml(result))
          }
        }
      } catch (e) {
        // ★ 不许静默（2026-09-24 苍玄界实锤）：取卡成功、服务端把 `【GameStart】`
        //   正确替换成 91KB 封面 HTML，但这里的后处理链（级联/文本状态/iframe 化）
        //   抛异常被吞 ⇒ 消息钉成"已装饰、无产物"，且零日志 —— 排查走了一整晚。
        //   任何在这里被吞的异常都必须在控制台可见。
        try { console.warn('[muv] 装饰后处理失败（取卡成功、替换产物处理抛错）：', e && (e.stack || e.message || e)) } catch (_) {}
      }

      // 拿不到卡片数据（没装 muv-table / 角色卡不是 MUV 格式）时，
      // 仍然用内置模板把状态栏渲染出来 —— 只要求输出里有占位符和变量赋值即可
      try {
        if (STATUS_PH_TEST.test(normalized)) {
          // 有变量就渲染出来；一个变量都没有也要给空状态，不能把占位符原文留在消息里。
          const sb = buildDefaultStatusBar(normalized) || emptyStatusBar()
          ensureStatusCss()
          // ★★ 函数式替换：见 muvFrameBlock 的长注释
          return muvDecorStore(muvCk, text, renderFencedHtml(normalized.replace(STATUS_PH_ALL, function () { return muvFrameBlock(sb) })))
        }
        // 没有卡片数据也要能出状态栏：级联不依赖卡片，只要能解析出结构
        const cascaded = await cascadeStatusBlock(normalized, null)
        if (cascaded !== normalized) return muvDecorStore(muvCk, text, renderFencedHtml(cascaded))
        // ★ 第 35 轮：文本级状态栏兜底（同卡片分支；这里没有卡自带皮肤，sbHtml 传空）
        const texted = await muvApplyTextStatus(cascaded, muvStatusAlreadyRendered(cascaded, ''))
        if (texted !== normalized) return muvDecorStore(muvCk, text, renderFencedHtml(texted))
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
      if (normalized === text) { muvBeautifyTrace('exit-unchanged', opts && opts.depth, 'len=' + muvTrimmedLen); return normalized }
      return muvDecorStore(muvCk, text, renderFencedHtml(replaceChoices(normalized)))
    }

    /**
     * ★ 装饰诊断留痕（2026-09-24，临时）：beautifyMuv 的进出与结局一览。
     *   苍玄界开场白整晚排错的教训——这条链上任何静默分支都会把楼钉死且零日志。
     *   用 console.debug（默认不可见，开 verbose 才有），量产后可删。
     */
    function muvBeautifyTrace(tag, depth, detail) {
      try { console.debug('[muv-trace]', tag, 'depth=' + depth, detail) } catch (_) {}
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
