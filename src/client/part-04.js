
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
     * ★★ 2026-09-23（第 31 轮）追加两项 —— 它们**不在** ST 的 `v1` 里，而在
     *    `predefine.js` 里（下表每行都是"ST 侧证据 + 卡侧证据"两条腿，缺一条就别加）：
     *
     *    | 全局 | ST 侧证据（只读源码） | 卡侧证据（真卡 grep，2026-09-23） |
     *    |---|---|---|
     *    | `_` (lodash) | `src/iframe/predefine.js:1` `window._ = window.parent._;` | 151 处裸引用 |
     *    | `z` (zod)    | 同文件 `:12` `_.pick(window.parent, [...,'z'])` | 143 处裸引用（同一条脚本） |
     *    | `YAML` (yaml) | 同文件 `:12` 的同一个 `_.pick` 清单里就有 `'YAML'` ★ | 27 处（见下，**第 32 轮**补） |
     *
     *    · `_`：ST 本体依赖 `lodash@4.18.1`（`SillyTavern/node_modules/lodash/package.json`
     *      的 `"version": "4.18.1"`）⇒ **CDN 上也钉 4.18.1**（实测 jsdelivr 有这个版本，
     *      73,234 字节，与 npm 的 latest 同物）。`predefine.js` 第 11–19 行整段用
     *      `_.merge/_.pick/_.omit/_.get/_.set` 装配 `TavernHelper` ⇒ 它自己第一步就需要 `_`；
     *      另有 `src/iframe/adjust_iframe_height.js:26` 的 `_.throttle(measureAndPost, 500)`。
     *      卡侧：`星辉MVU核心` 一条就 74 处（`_.get(stat,'账本.待结算',{})` 这类）——
     *      §30 记的「bundle 110 处用 `_`」就是同一件事的另一种统计口径。
     *    · `z`：父页的 `z` 来自酒馆助手的 zod（`JS-Slash-Runner/package.json:89`
     *      `"zod": "^4.4.3"`）。卡侧最凶的是「8.2·星辉zod·等级能力一致性与比例数值」：
     *      它 `import { registerMvuSchema } from '…/mvu_zod.js'` 却**从不 import `z`**，
     *      `z.object/z.record/z.preprocess/z.coerce/…prefault` 全是裸引用 ⇒ 缺 `z` 时
     *      在**求值顶层 Schema 常量**时就 `ReferenceError`，`registerMvuSchema(Schema)`
     *      永远跑不到。
     *
     *    · `YAML` ★ **第 32 轮补上**（上一轮记的是"卡侧 0 处引用、故意不补"，本轮被两路
     *      新证据推翻）：① **ST 侧** —— ST 父页的 `window.YAML` 是**酒馆助手自己**装的
     *      （`JS-Slash-Runner/dist/index.js` 里 `function Qne(){globalThis.YAML=dV,…}`，
     *      `dV` 就是 `yaml@2` 的 ESM 命名空间：`parse/parseDocument/parseAllDocuments/
     *      stringify/Document/YAMLMap/CST/…`）；版本取 `JS-Slash-Runner/pnpm-lock.yaml`
     *      的 `yaml@2.9.0`（它 `package.json:59` 声明 `"yaml": "^2.9.0"`；ST 本体另有一份
     *      `node_modules/yaml` = 2.8.3，但**父页那个全局来自酒馆助手的 bundle**，所以钉 2.9.0）。
     *      ② **卡侧** —— `_足控天堂2` 的「外置手机」那条脚本是一行
     *      `import 'https://phone-ctn.pages.dev/index.js'`，该远端模块（3,150,415 字节）里
     *      有 **27 处裸引用 `YAML`**，全是 `YAML.parse(...)` / `YAML.stringify(...)` ——
     *      控制台那条 `Uncaught ReferenceError: YAML is not defined` 就是它。上一轮
     *      "卡侧 0 处"只 grep 了**卡里的内联脚本正文**，漏了「脚本文本只是一行 import、
     *      真代码在远端」这一形态（§30.2 记过这种形态，本轮把它算进来）。
     *    · 为什么不给 `dump` / `load`：ST 的 `YAML` 是 `yaml@2` 命名空间，**没有** `dump`
     *      / `load`（那是 js-yaml 的 API 名）；卡侧 27 处只用 `parse` / `stringify`。
     *      加别名会让 DSH 比 ST 更宽松（在 ST 里会炸的卡在这里悄悄跑起来），按本仓库
     *      "ST 侧 + 卡侧两条腿"的口径**不加**。真遇到用 `YAML.dump` 的卡再按同样格式取证。
     *
     * ⚠ 同一个 `_.pick` 里的 `EjsTemplate` / `showdown`：卡侧实测 0 处引用，
     *   所以**仍然故意不补**。它们分别是要宿主配合才跑得起来的 EJS 渲染 / markdown
     *   渲染；给个空壳会让卡以为"渲染成功了"从而写错数据，比缺全局更坏。
     *   真遇到依赖它们的卡再照 ST 补 —— 补之前先按上表的格式取证。
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
        '<script data-muv-libs="vr" src="' + CDN + 'vue-router@4.5.0/dist/vue-router.global.prod.js"></' + 'script>' +
        // ── lodash：**三段**（存旧值 → 加载 → 还原），语义 = "只在缺失时补" ─────────
        // ★ 为什么不能只写一个 `<script src="…lodash.min.js">`：lodash 的 UMD 收尾是
        //   `root._ = lodash` —— **无条件**覆盖。而要求是"卡自己定义了 `_` 就不许动它"。
        //   三段的分工：加载前把已存在的 `_` 存进 `__muvDashPrev`；加载后若当初存过，
        //   就把它**放回去**。没存过（= 本来就没有 `_`）⇒ lodash 留下，正是我们要的。
        //   覆盖的场景是"卡在 `<head>` 里就定义了 `_`"（顺序上早于本注入点，会被 UMD
        //   盖掉）；卡在 `<body>` 里的赋值本来就晚于这里，天然是卡赢，三段不干涉它。
        //   `__muvDashPrev` 用完即删，不给卡留一个会困惑的全局。
        '<script data-muv-libs="dash-save">(function(){try{delete window.__muvDashPrev;if(typeof window._!=="undefined")window.__muvDashPrev=window._}catch(e){}})();</' + 'script>' +
        '<script data-muv-libs="lodash" src="' + CDN + 'lodash@4.18.1/lodash.min.js"></' + 'script>' +
        '<script data-muv-libs="dash-keep">(function(){try{if(Object.prototype.hasOwnProperty.call(window,"__muvDashPrev")){window._=window.__muvDashPrev;delete window.__muvDashPrev}}catch(e){}})();</' + 'script>' +
        // ── zod：**只能走 module** —— 实测 zod@4.4.3 的 npm 包里**没有 UMD/IIFE 构建**
        //    （`dist/zod.umd.js` / `dist/index.umd.js` 都是 404；只有 `+esm` 这种由
        //    jsdelivr 现打的 ESM，328,955 字节）。所以这里是全篇唯一一个 `type="module"`
        //    的库标签。
        // ★ 顺序仍然成立：module 天然 defer，而本标签在 `<head>` 里、卡脚本在 `</body>`
        //   之前 ⇒ 文档顺序决定它**先于**卡脚本执行（§30 那条"module 之间按文档顺序"
        //   的结论在这里第二次兑现）。代价与 jQuery 那类阻塞式 CDN 同级：zod 拉得慢会
        //   推迟卡脚本的**开始**，但不会让谁失败。
        // ★ `import * as` 而不是 `import { z }`：`+esm` 是 jsdelivr 现打的包，具名导出的
        //   名字不保证稳定（实测是 `object` / `z` + `default`）。落位取**命名空间本身**
        //   （形状判据 `typeof MUVZ.object === "function"`），兜底才退到 `default` —— 卡那边
        //   看到的是一个**能用的 zod 命名空间**，不是 `undefined`。
        // ★ 仍然只在缺失时落位（卡自己定义了 `z` 就尊重卡的）。
        // ★★ 第 32 轮定位 / 第 33 轮修（§32.7）：落位必须是**整个命名空间**，**不能**是
        //   `MUVZ.z` 这个**子对象**。ST 父页那个 `z` 是整包命名空间
        //   （`JS-Slash-Runner/dist/index.js` 的 `uk = bn({$brand,$input,…,ZodAny,…})`，
        //   `Qne(){globalThis.z=uk}`）—— 它同时有 `z.object` **和** `z.z`；`MUVZ.z` 子对象
        //   只有前者，于是**用 `z.z.object(...)` 写法**的模块抛
        //   `TypeError: Cannot read properties of undefined (reading 'object')` —— 实测两处：
        //   · `tavern_resource/dist/酒馆助手/自动更新角色卡/index.js`（单行压缩，`.object`
        //     在偏移 367 ⇒ 正好是用户报的 `index.js:1:372`；那条脚本是 `const n=z, r=n.z.object({…})`）；
        //   · `tavern_resource/dist/util/mvu_zod.js:553`（`r.z.object({stat_data:e})`，更常见）。
        //   jsdelivr 的 `+esm` 导出表里 `mo as object` 与 `Os as z` **都在** ⇒ 命名空间是子对象的
        //   **纯超集**：`z.object` / `z.z` / `z.record` / `z.preprocess` / `z.coerce` 全部成立，
        //   与 ST 的形状一致（不是新行为）。
        '<script type="module" data-muv-libs="zod">import * as MUVZ from "' + CDN + 'zod@4.4.3/+esm";' +
        'try{if(typeof window.z==="undefined")window.z=(MUVZ&&typeof MUVZ.object==="function")?MUVZ:((MUVZ&&MUVZ.default)||MUVZ)}catch(e){}</' + 'script>' +
        // ── YAML（第 32 轮补）：**也只能走 module**，理由与 zod 一字不差 ─────────────
        //   实测 `yaml@2.9.0` 的 npm 包里**没有 UMD/IIFE**：`dist/index.js`（1,769 字节）
        //   与 `dist/index.min.js`（1,892 字节）都只是 CJS 的 `require('./…')` 转发壳，
        //   真正能当全局用的只有 jsdelivr 现打的那份（`+esm`，104,914 字节，源文件就是
        //   `/npm/yaml@2.9.0/browser/index.js` = 官方的浏览器入口，包里没有任何 `require(`）。
        //   ST 那边也是 module（酒馆助手是 vite 应用），所以我们这条 module 标签与 ST 同源。
        // ★ 形状：`import * as MUVY` ⇒ 命名空间本身**就带 `parse`**（实测导出表里有
        //   `parse / parseAllDocuments / parseDocument / stringify / Document / YAMLMap /
        //   CST / Schema / Scalar / Pair / …`）。判据取 `MUVY.parse` 是不是函数而不是
        //   "拿得到东西"：`+esm` 是现打的包，具名导出万一变成只有 `default` 的形态，也
        //   要先落到 `default` 上，卡那边拿到的必须是一个**能 parse 的命名空间**。
        // ★ 与 zod 一样**只在缺失时**落位（卡自己做了一份 YAML 就尊重卡的），并且顺序
        //   同样安全：module 天然 defer、本标签在 `<head>`、卡脚本在 `</body>` 之前。
        '<script type="module" data-muv-libs="yaml">import * as MUVY from "' + CDN + 'yaml@2.9.0/+esm";' +
        'try{if(typeof window.YAML==="undefined")window.YAML=(MUVY&&typeof MUVY.parse==="function")?MUVY:((MUVY&&MUVY.default)||MUVY)}catch(e){}</' + 'script>'
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

    // ───────────────────────────────────────────────────────────────────────
    // ── 卡脚本运行时：把角色卡注册的 TavernHelper（酒馆助手）脚本注进 srcdoc ──
    // ───────────────────────────────────────────────────────────────────────
    //
    // ★ 缺口的来源（用户实测，已取证，不是推测）：
    //   `魔法少女MVU测试` 的契约书封面在 DSH 里渲染出来了，但 ST 里封面下面那条
    //   **棕色状态栏（MVU 的 Status Hud）** 没有。而它的来源**不是**卡的正则：
    //   那两条消费 `<StatusPlaceHolderImpl/>` 的正则 replaceString 是**空串**
    //   （只负责把占位符删掉），真正画 HUD 的是卡的 TavernHelper 脚本 ——
    //   `data.extensions.tavern_helper.scripts[0]` 的内容就一行：
    //       import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'
    //   ST 里「酒馆助手」插件会执行卡里 enabled 的脚本 ⇒ bundle 跑起来 ⇒ HUD 出现。
    //   我们此前一条都不执行 ⇒ bundle 不跑 ⇒ HUD 恒空。这是与"沙箱/正则/替换串"
    //   并列的**独立**原因。
    //
    // ── 安全口径（写清楚，别让它变成"看起来像任意代码执行"）──────────────────
    //   1. 执行的脚本来自**用户自己导入的卡**（与 ST 同一信任级别：ST 也是无条件执行）；
    //   2. iframe 沙箱仍是 `allow-scripts`（**没有** allow-same-origin，见 §9 事故），
    //      所以摸不到 DSH 页面 DOM、`localStorage` 是垫片给的内存实现、打 `/api/*`
    //      也不带宿主凭据；
    //   3. 内容里带 `</script`（不分大小写）的条目**一律跳过**：那玩意会把 srcdoc 里
    //      的内联标签提前截断（这是注入场景下唯一的"逃出取值器"漏洞）；
    //   4. 条数与体积在服务端已经封顶（`MAX_SCRIPTS` / `MAX_CONTENT`）。
    //
    // 关掉它 = ST 那类"脚本画出来的界面"（状态栏 HUD、控制台浮窗、运行时数据区）
    // 全部失效，而且**不报错** —— 症状和现在缺 HUD 一模一样。所以默认**开**。
    /** @type {boolean} */
    var MUV_CARD_SCRIPTS = true

    /**
     * 文本级状态栏开关（第 35 轮）。
     *
     * 管的是「**没有** `<StatusPlaceHolderImpl/>` 占位符的卡」：正文开头那种裸的
     * `[时间:…][地点:…]` 连续方括号键值对，以及 `<details><summary>[角色状态]</summary>
     * ```…```</details>` 折叠块。默认**开**。
     *
     * 关掉它 = 无占位符的卡恢复**裸文本**（元信息原样堆在正文里、代码围栏裸露）——
     * 也就是本轮之前的行为。只有在「兜底把某张卡本来正常的行文认成了状态栏」时才关，
     * 而且关之前请把那张卡的原文贴出来（判据放宽比关开关更好）。
     *
     * 不影响任何既有路径：有占位符的卡、卡自带状态栏皮肤、`<Status_block>` 三条
     * 优先级都高于它（见 `muvStatusAlreadyRendered`）。
     * @type {boolean}
     */
    var MUV_TEXT_STATUS = true

    /**
     * 文本级状态栏开关的读取口。
     *
     * 做成**函数**而不是直接引用常量：回归门禁是「从源码里逐字提取函数体再执行」
     * 的，闭包变量不在提取物里，裸引用 `MUV_TEXT_STATUS` 会 `ReferenceError`。
     * `typeof` 保护让它在没有那个闭包的提取场景下退回**默认开**。
     * @returns {boolean}
     */
    function muvTextStatusOn() {
      try { if (typeof MUV_TEXT_STATUS !== 'undefined') return !!MUV_TEXT_STATUS } catch (_) {}
      return true
    }

