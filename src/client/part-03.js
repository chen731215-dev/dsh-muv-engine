
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

    /**
     * 卡脚本注入开关的读取口（做成函数的理由与 `muvCardLibsOn` 完全相同：
     * 回归门禁是"逐字提取函数体再执行"的，闭包变量不在提取物里）。
     * @returns {boolean}
     */
    function muvCardScriptsOn() {
      try { if (typeof MUV_CARD_SCRIPTS !== 'undefined') return !!MUV_CARD_SCRIPTS } catch (_) {}
      return true
    }

    /**
     * 卡脚本的**错误收集器**（一段普通内联脚本）。
     *
     * 为什么必须这么绕：`import 'https://…'` 这类 module 脚本的失败（URL 404 /
     * DNS / 内容里第二层 import 挂了）既不会被任何 `try` 接到，也不会冒泡到宿主的
     * `window.onerror` —— 它只在不透明来源的 srcdoc 里自己炸一声，用户看到的现象
     * 永远只是"界面缺一块"。这里是唯一能留痕的地方。
     *
     * 三个入口（都归一到同一条 `console.warn('[muv-engine] 卡脚本报错：…')`）：
     *  - `e.target` 是那个 `<script>` 元素（**资源加载失败**的形态）⇒ 从它的
     *    `data-muv-th` 读回脚本名，能把"哪一条脚本没加载起来"说到名字；
     *  - `e.target` 是**别的元素**（`<img>` / `<link>` …）⇒ 报成
     *    `（非脚本元素 <img>）` + `<img> 资源加载失败（不是卡脚本）`：真机上那条
     *    `… 脚本加载失败（本次不执行） http://127.0.0.1:3080/` 就是这一族
     *    （无署名的元素、`src` 解析成了宿主文档地址），过去被一律叫成"脚本"，误导排查；
     *  - `e` 是 ErrorEvent（**运行时报错**）⇒ error 事件本身拿不到脚本名（about:srcdoc
     *    下所有 module 共用一个 filename），报「（未知脚本）」；**但**注入器会给
     *    "没有顶层 import/export"的脚本包一层 try/catch，那些脚本的运行时错误因此能
     *    走 `window.__muvThErr(e, 名字)` 带上名字（见 `muvCardScriptTags`）；
     *  - `e.reason` 是 `unhandledrejection`（**顶层 await 被拒**）⇒ 同样没有脚本名，
     *    报「（promise 未处理）」。★ 这一条不能省：MVU bundle 的入口第一行就是
     *    `await checkVersion(...)`，它被拒时**不会**走上面那条 error（module 的顶层 await
     *    被拒是"未处理的 promise 拒绝"，只在 window 上以 `unhandledrejection` 出现）
     *    —— 少了它，"整个框架没起来"就是完全无声的。
     * 只在**捕获阶段**注册一次（`true`）才会收到元素上那个**不冒泡**的 error 事件；
     * 同一个 handler 注册两遍（capture + bubble）会让每条错报两遍。上限 20 条 —— 循环报错的卡把控制台刷爆没有意义。
     *
     * 两条硬约束（与 `muvFrameBootstrap` / `muvCardLibTags` 同源）：**不含反引号**；
     * 字符串里**不出现裸的 `</script>`**（收尾标签用 `'</' + 'script>'` 拼出来）。
     * @returns {string} 含标签的一段 HTML
     */
    function muvCardScriptErrProbe() {
      return '<script data-muv-thscript="__muvThErr">(function(){' +
        'if(window.__muvThErrOn)return;window.__muvThErrOn=1;' +
        // ★ 除了 console.warn，再把同样的东西攒进 window.__muvScriptErrs：
        //   控制台要开 devtools 才能看，而这个数组可以被门禁（CDP 求值）与
        //   真机排障（哪一个 iframe 挂了哪一条脚本）直接读出来。上限同是 20 条。
        'try{if(!window.__muvScriptErrs)window.__muvScriptErrs=[]}catch(e){}' +
        'var n=0;' +
        'function nm(t){try{return(t&&t.getAttribute)?String(t.getAttribute("data-muv-th")||""):""}catch(e){return ""}}' +
        // ★ 唯一的输出口：三条入口（元素加载失败 / 运行时报错 / promise 未处理）以及
        //   被我们 try/catch 包住的卡脚本自报，全走这里 —— console 与 __muvScriptErrs
        //   两处口径永远一致，而且共用外面那个上限计数器 n。
        'function rep(from,msg){try{' +
        'console.warn("[muv-engine] 卡脚本报错："+(from||"（未知脚本）"),msg);' +
        'try{if(window.__muvScriptErrs&&window.__muvScriptErrs.length<20)window.__muvScriptErrs.push((from||"（未知脚本）")+" | "+msg)}catch(e){}' +
        '}catch(_){}}' +
        // ★ 给注入器用的自报口（第 32 轮）：muvCardScriptTags 会把**没有顶层
        //   import/export** 的卡脚本用 try/catch 包一层，catch 里调的就是它 ——
        //   于是"运行时报错"这条也能带上脚本名，不再一律「（未知脚本）」。
        'window.__muvThErr=function(e,from){try{if(n>=20)return;n++;' +
        'rep(from,((e&&typeof e.message==="string"&&e.message)?e.message:String(e)))}catch(_){}};' +
        'function h(e){try{' +
        'if(n>=20)return;n++;' +
        'var t=e&&e.target,from=t&&t!==window?nm(t):"",msg="";' +
        'var tg=(t&&t.tagName)?String(t.tagName).toLowerCase():"";' +
        'var isScr=(tg==="script");' +
        'if(e&&typeof e.message==="string"&&e.message)msg=e.message;' +
        'else if(t&&t!==window)msg=(isScr?"脚本加载失败（本次不执行）":("<"+tg+"> 资源加载失败（不是卡脚本）"))+(t&&t.src?(" "+String(t.src).slice(0,140)):"");' +
        'else msg=String((e&&e.type)||"error");' +
        // ★ 没有 data-muv-th 的元素**未必**是脚本。真机那条
        //   「… 脚本加载失败（本次不执行） http://127.0.0.1:3080/」就是这一族：
        //   元素报错被我们一律叫成"脚本"，而那条报错其实来自**没有署名**的元素
        //   （src 解析成了文档地址，也就是 src 为空那一类）。把标签名报出来，
        //   排障时一眼分得清"我们的卡脚本挂了"与"卡里某张图/某个外链挂了"。
        'if(!from)from=(tg&&!isScr)?("（非脚本元素 <"+tg+">）"):"（未知脚本）";' +
        'rep(from,msg);' +
        '}catch(_){}}' +
        'window.addEventListener("error",h,true);' +
        // ★ unhandledrejection：module 顶层 await 被拒的**唯一**入口（见上面的注释），
        //   与 error 共用同一个计数器 n（两处合计上限 20 条，循环报错照样刷不爆控制台）。
        'function hr(e){try{' +
        'if(n>=20)return;n++;' +
        'var r=e?e.reason:null;var msg="";' +
        'try{msg=(r&&typeof r.message==="string"&&r.message)?r.message:((typeof r==="string")?r:JSON.stringify(r))}catch(x){msg=String(r)}' +
        'if(msg===null||msg===undefined||msg==="")msg=String(r);' +
        'rep("（promise 未处理）",msg);' +
        '}catch(_){}}' +
        'window.addEventListener("unhandledrejection",hr);' +
        '})();</' + 'script>'
    }

    /**
     * content 是不是"一个地址片段"而不是可执行代码？（要跳过的那种）
     *
     * ★ 真机实测的症状：`脚本加载失败（本次不执行） http://127.0.0.1:3080/` ——
     *   卡里有一条脚本的 content 不是代码、而是一个**相对/空地址**。内联进 srcdoc 后
     *   浏览器拿**宿主页**当地址基准去解析它，请求直接打到 DSH 自己身上（`127.0.0.1:3080`
     *   就是宿主）。那种请求既有害（骚扰宿主）又无用（它本来就不是能执行的脚本）。
     *
     * 判据**故意只认最保守的形态**，宁可漏也不误杀：
     *   ① 去空白后为空 ⇒ 是（空内容，见调用点另一条分支）；
     *   ② 含任何空白 ⇒ **不是** —— `import 'https://…'`、几万字的 IIFE、一整段逻辑
     *      全都有空白，这条挡住了最大的误杀面；
     *   ③ 以 `http://` / `https://` 开头 ⇒ **不是** —— 绝对地址是 ST 生态的正常写法
     *      （卡里绝大多数脚本就是这个形态），照旧原样注入，不在这里判生死；
     *   ④ 剩下的"单个 token"里只拦两类**明显是路径**的：
     *      · 以 `/` `./` `../` `~/` `//` 开头的路径片段（`/`、`//cdn.x/y.js`、`./index.js`）；
     *      · 整体是"文件名 + 已知扩展名"的（`index.js`、`assets/a.css`）。
     *   另有 `*` `(` `)` 这类字符的（正则字面量、表达式）一律**不拦** —— 它们不是路径。
     *   卡侧实况：真卡里**没有一条**脚本命中过这里（见 `verify-tavernhelper-scripts.mjs`
     *   [1] 节那片真卡清单），它是为"畸形卡 / 被工具改坏的卡"准备的护栏。
     * @param {string} c 脚本 content
     * @returns {boolean}
     */
    function muvCardScriptBareSrc(c) {
      var t = String(c == null ? '' : c).trim()
      if (!t) return true
      if (/\s/.test(t)) return false
      if (/^https?:\/\//i.test(t)) return false
      if (!/^[A-Za-z0-9_\-.\/%?=&#:@+~]+$/.test(t)) return false
      if (/^(?:\.{0,2}|~)\//.test(t)) return true
      return /\.(?:js|mjs|cjs|css|json|ts|tsx|jsx|wasm|map)$/i.test(t)
    }

    /**
     * 把一组卡脚本拼成注入串：错误收集器 + **每条一个** `<script type="module">`。
     *
     * ★ 每条独立一个标签，而不是合成一个：任一条 `import` 挂掉时只死那一条，
     *   其余照常执行（这正是你要的"一条失败不拖垮其他"）。
     * ★ `<script type="module">` 而不是普通 script：卡里普遍是 ESM（`import '…'`），
     *   而 module 天然 defer ⇒ 一定跑在 compat 垫片 / reset / 前端库之后，
     *   不依赖注入点的先后位置。这是"垫片之后"这条要求的**结构性**满足。
     *
     * ★ 三条**过滤**（都留痕带名字与原因，不静默跳过）：空白内容、
     *   "内容是个地址片段而不是代码"（muvCardScriptBareSrc）、内容含 script 收尾标记。
     *   前两条是第 32 轮加的（真机症状见各自的注释）。
     * @param {Array<{name?:string, id?:string, content?:string}>} list
     * @returns {string}
     */
    function muvCardScriptTags(list) {
      var out = muvCardScriptErrProbe()
      if (!list || !list.length) return out
      for (var i = 0; i < list.length; i++) {
        var it = list[i]
        if (!it) continue
        var c = (it.content == null) ? '' : String(it.content)
        var nm = String(it.name || '')
        var who = nm || '（未命名）'
        // ★ 空白内容（第 32 轮）：注进去只会多一个空标签，而且清单签名 / 注入缓存
        //   会把它当成"有一条脚本"。跳过并**留痕**（不静默 —— 静默跳过在排障时等于
        //   "我明明有这条脚本，怎么没跑"，那正是这一轮要消灭的那类困惑）。
        if (!c.trim()) {
          try { console.warn('[muv-engine] 卡脚本跳过（内容为空或只有空白）：' + who) } catch (_) {}
          continue
        }
        // ★ 内容是个地址片段而不是代码（第 32 轮）：判据见 muvCardScriptBareSrc 的注释。
        //   真机症状就是它 —— 「脚本加载失败（本次不执行） http://127.0.0.1:3080/」，
        //   相对地址被拿宿主页当地址基准解析，请求打到 DSH 自己身上。
        if (muvCardScriptBareSrc(c)) {
          try {
            console.warn('[muv-engine] 卡脚本跳过（内容是相对/裸地址而不是可执行代码，' +
              '内联后会被解析成宿主地址）：' + who + ' | ' + c.trim().slice(0, 120))
          } catch (_) {}
          continue
        }
        // ★ 内容里有 script 的收尾标记（含 JS 字符串里写的那份）就放弃这一条：
        //   内联进 srcdoc 会当场截断标签，后面的内容被当成 HTML 解析 —— 那是比
        //   "少跑一条脚本"坏得多的结果（与 §18 的替换串宿主引用那两次同类）。
        if (/<\/script/i.test(c)) {
          try {
            console.warn('[muv-engine] 卡脚本跳过（内容含 script 收尾标记，内联会截断文档）：' + who)
          } catch (_) {}
          continue
        }
        // ★ 给"没有顶层 import/export"的脚本包一层 try/catch（第 32 轮）：这样
        //   **运行时报错也能带上脚本名**（error 事件在不透明来源下只给得出
        //   about:srcdoc，名字无从谈起）。判据故意**极度保守**：内容里任何地方
        //   出现 import / export 就不包 —— 顶层 import 放进 try 块里是**语法错误**，
        //   包错了会把整条脚本当场弄死（宁可少一个名字，也不能少一条脚本）。
        //   try{ 后面那个换行是必需的：内容末尾可能是行注释，直接接 } 会把它注释掉。
        var body = c
        if (!/(^|[^\w$.])(import|export)([^\w$]|$)/.test(c)) {
          body = 'try{\n' + c + '\n}catch(e){try{window.__muvThErr(e,' +
            JSON.stringify(nm).replace(/</g, '\\u003c') + ')}catch(_){}}'
        }
        out += '<script type="module" data-muv-th="' + escAttr(nm) + '">' +
          body + '</' + 'script>'
      }
      return out
    }

    /**
     * 把卡脚本插到**不在任何 `<script>` 里的最后一个** `</body>` 之前；
     * 没有那种 `</body>` 就接在文档末尾。
     *
     * 为什么挑 `</body>`：module 天生 defer，位置不影响**执行顺序**（仍在 compat /
     * reset / 前端库之后），所以可以挑请求首选最安全的那个点 —— 排在文档最后就不参与
     * 后面那些注入器对 `<head>` / `</head>` / `<html>` 的搜索，也不会把卡的正文挡在
     * 自己身后。前提是这层必须排在注入链的**最外层**（见 `muvInjectDoc`）。
     * @param {string} html
     * @param {Array<{name?:string, id?:string, content?:string}>} list
     * @returns {string}
     */
    function withCardScripts(html, list) {
      var s = String(html == null ? '' : html)
      if (!muvCardScriptsOn()) return s
      if (!list || !list.length) return s
      // 幂等守卫同样查"属性名 + ="，理由见 withCardLibs / withCardReset：
      // 卡的正文/角色设定里完全可能出现 data-muv-thscript 这几个字。
      if (s.indexOf('data-muv-thscript=') !== -1) return s
      var tag = muvCardScriptTags(list)
      if (!tag) return s
      var ranges = scriptRangesOf(s)
      var re = /<\/body\s*>/gi
      var m
      var last = null
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) last = m
      }
      if (!last) return s + tag
      return s.slice(0, last.index) + tag + s.slice(last.index)
    }

    /**
     * 卡脚本清单的**内容签名**（给注入链缓存当键的一部分）。
     *
     * 为什么不是直接把清单塞进缓存键：同一张卡的内容可能有几百 KB（手动量级），
     * 而当键就要常驻 —— 用「条数 + 长度 + 名字」够用了：卡是静态的，同一张卡的
     * 清单只有"没有 / 有这两三种取值"，变了就让缓存**整体失效**（`MUV_INJECT_MAX`
     * 只有 8 条，重算一次的代价远小于拿着错的結果）。
     * @param {Array<{name?:string, id?:string, content?:string}>} list
     * @returns {string}
     */
    function muvCardScriptsSig(list) {
      if (!list || !list.length) return '0'
      var n = 0
      var total = 0
      var names = []
      for (var i = 0; i < list.length; i++) {
        var it = list[i]
        if (!it) continue
        n++
        total += String(it.content == null ? '' : it.content).length
        names.push(String(it.name || ''))
      }
      return n + ':' + total + ':' + names.join('|').slice(0, 200)
    }

    /** 已请求过的卡脚本（`presetDir|cardName` → Promise<Array>），每页一次网络往返。 */
    var muvCardScriptsCache = {}
    /** 卡清单缓存条目上限（一张会话一张卡，给上限只是防会话里换过好几张卡）。 */
    var MUV_CARD_SCRIPTS_MAX = 8
    /**
     * **当前**这张卡的 enabled 脚本清单（`cardHtmlIframe` 同步读它）。
     *
     * 为什么是"当前"而不是按帧传参：`cardHtmlIframe` 是被 `renderFencedHtml` /
     * `wrapLoneDocuments` / 状态栏替换從好几处调用的**同步**函数，改签名会把整条
     * 渲染链改成 async。而一个会话只会用一张卡（§17.3 那条"取卡口径"已保证），
     * 所以在取卡之后一次性把它填好就够了。
     * @type {Array<{name:string, id:string, content:string}>}
     */
    var muvCardScripts = []

    /**
     * **当前正在装饰的这条**是不是开场白楼（`_decorateOne` 的 `isOldestFloor`）。
     *
     * ★ full-bleed 破格的唯一判据。**2026-09-25 恢复**（build k 曾把它连同下面的
     *   读取口一起删掉，改成"产物形态判据"= 整页文档一律打标；真机实测农场会话
     *   **7/7 楼全被铺成 100vw**，复现了 §40.1 记过的那个事故）。
     *
     * 为什么"产物形态"不行 —— 两条独立证据：
     *   ① 结构同构（tools/dsh-live29b/c-fullbleed-forensic.mjs，5 会话逐楼 dump）：
     *      封面楼与状态栏楼的 `.muv-statusbar-wrap` 在**结构上完全一致**（class、
     *      data-* 属性、父级链、iframe 属性都同：封面与状态栏 UI 出自同一个
     *      `cardHtmlIframe` 产物点），CSS 选择器（含 `:has()`）分不开二者。
     *   ② 社区卡会**每轮回复都产出整页文档**（真机实测：异世界农场 7 个楼的
     *      `srcdoc` 长度**完全相同** = 52359）⇒ "整页文档 ⇒ 封面/全屏 UI"这个前提
     *      本身不成立，于是每一楼都被拉成 100vw。
     *
     * 而 ST 本体给的基准（`docs/44-ST卡片排版规格.md`，实测）是：整页卡**只占消息
     * 列宽**，且**首楼与后续楼排版零差异**、消息内容**不允许任何满宽穿出**。
     * 所以满宽破格是 DSH 侧的自造扩展，只能靠**楼位**把它收窄到封面楼。
     *
     * 为什么走"旗标 + 读取函数"而不是改 `renderFencedHtml`/`wrapLoneDocuments`
     * 的签名：它们是被多处调用的**同步**函数（见 `muvCardScripts` 处的同款论证），
     * 改签名会把整条渲染链改成 async；而回归门禁是"逐字提取函数体再执行"的，
     * 闭包变量不在提取物里 —— 所以外部引用一律走"带 typeof 兜底的读取函数"
     * （`muvFullpageFloorNow`），与 `muvCardScriptsNow` 同一惯例。
     * 装饰是串行的（`decorateMessages` 的 for-await + `_decorating` 锁），旗标
     * 在 `beautifyMuv` 前设置、finally 里复位，不跨 await 泄漏到别条消息。
     * @type {boolean}
     */
    var muvFullpageFloor = false

    /**
     * `muvFullpageFloor` 的读取口（存在理由见上：门禁提取物里没有闭包变量，
     * 直接引用会 ReferenceError）。产物点（`renderFencedHtml` / `wrapLoneDocuments`
     * 的整页卡 wrap）据此决定要不要给 wrap 加 `muv-fullpage` 类。
     *
     * ★ 这个旗标是**唯一**的打标依据 ⇒ 它必须进产物缓存键（见 `muvDecorCacheKey`
     *   的 `|fp` 分量）：同一份 `text` 在封面楼与后续楼要产出**不同**的产物字符串，
     *   键里不带它就会互相命中。build k 把两者一起删掉是自洽的（那时打标确实与
     *   楼位无关），但恢复楼位判据后 `|fp` 必须同步恢复 —— 否则封面楼的产物会被
     *   后续楼复用（或反之）。
     * @returns {boolean}
     */
    function muvFullpageFloorNow() {
      try { return typeof muvFullpageFloor !== 'undefined' && muvFullpageFloor === true } catch (_) { return false }
    }

    /**
     * `muvCardScripts` 的读取口（存在理由与 `muvCardLibsOn` 完全一样：回归门禁是
     * "逐字提取函数体再执行"的，闭包变量不在提取物里，直接引用会 `ReferenceError`
     * —— 一线的每一个外部引用都必须走这种"带 typeof 兜底的读取函数"）。
     * @returns {Array<{name:string, id:string, content:string}>}
     */
    function muvCardScriptsNow() {
      try {
        if (typeof muvCardScripts !== 'undefined' && Array.isArray(muvCardScripts)) return muvCardScripts
      } catch (_) {}
      return []
    }

    /**
     * 取这张卡的 TavernHelper 脚本（每条 `<script type="module">` 的原料）。
     *
     * 失败形态必须是**安静的**：`/api/muv-engine/card-scripts` 拿不到（muv-table 不在、
     * 卡是被删掉的 PNG、服务没重启）时回 **空数组**，卡照旧渲染 —— 与我们"缺哪个能力
     * 就只缺那块"的一贯口径一致；唯一的声音是一条 `console.warn`，便于排障。
     * @param {object|null} cardJson `fetchTavernCard()` 的产物（读它的 cardName / presetDir）
     * @returns {Promise<Array<{name:string, id:string, content:string}>>}
     */
    async function muvLoadCardScripts(cardJson) {
      try {
        if (!muvCardScriptsOn()) return []
        var name = ''
        var presetDir = ''
        if (cardJson && typeof cardJson === 'object') {
          name = String(cardJson.cardName || cardJson.name || '')
          presetDir = String(cardJson.presetDir || '')
        }
        if (!name) return []
        var key = presetDir + '|' + name
        if (Object.prototype.hasOwnProperty.call(muvCardScriptsCache, key)) return muvCardScriptsCache[key]
        var task = (async function () {
          try {
            var qs = '?cardName=' + encodeURIComponent(name) +
              (presetDir ? '&presetDir=' + encodeURIComponent(presetDir) : '')
            var r = await fetch('/api/muv-engine/card-scripts' + qs)
            var d = await r.json()
            var list = (d && d.ok && Array.isArray(d.scripts)) ? d.scripts : []
            try {
              console.debug('[muv] 卡脚本「' + name + '」：注入 ' + list.length + ' 条 / 卡里共 ' +
                String(d && d.total) + ' 条（来源 ' + String(d && d.source) +
                (d && d.fileName ? ' · ' + String(d.fileName) : '') + '）')
            } catch (_) {}
            return list
          } catch (e) {
            try { console.warn('[muv-engine] 取卡脚本失败（本次不注入）：' + String(e && e.message)) } catch (_) {}
            return []
          }
        })()
        muvCardScriptsCache[key] = task
        try {
          var ks = []
          for (var k in muvCardScriptsCache) {
            if (Object.prototype.hasOwnProperty.call(muvCardScriptsCache, k)) ks.push(k)
          }
          while (ks.length > MUV_CARD_SCRIPTS_MAX) {
            var gone = ks.shift()
            if (gone === key) continue
            try { delete muvCardScriptsCache[gone] } catch (_) {}
          }
        } catch (_) {}
        return task
      } catch (_) {
        return []
      }
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
