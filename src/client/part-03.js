
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
