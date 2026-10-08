      return null
    }

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
    function readStartTag(source, lt) {
      var s = String(source)
      var i = lt + 1
      var nameStart = i
      while (i < s.length && /[a-zA-Z0-9:-]/.test(s[i])) i++
      var name = s.slice(nameStart, i)
      if (!name) return null
      var attrsStart = i
      var quote = ''
      while (i < s.length) {
        var ch = s[i]
        if (quote) {
          if (ch === quote) quote = ''
          i++
          continue
        }
        if (ch === '"' || ch === "'") { quote = ch; i++; continue }
        if (ch === '>') {
          var selfClosing = i > attrsStart && s[i - 1] === '/'
          return {
            name: name,
            attrs: s.slice(attrsStart, selfClosing ? i - 1 : i),
            selfClosing: selfClosing,
            end: i + 1
          }
        }
        i++
      }
      return null
    }

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
