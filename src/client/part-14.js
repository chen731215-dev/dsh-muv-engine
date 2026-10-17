
        /**
         * 隐藏正文里**与 iframe 内容重复**的整页源码块 —— ST 给残留 `<pre><code>`
         * 加 `hidden!` 的等价物（我们跨源进不去子文档，只能在父页侧隐藏）。
         *
         * 只动 `<pre>`：DSH 的 markdown 把 ``` 围栏渲染成 `<pre><code>`，
         * 而"裸文档"必然是这么来的。
         *
         * ★ 不隐藏的两类（保守）：
         *   · 内容不像整页文档的普通代码块（判据见 `muvIsPageSourceText`）；
         *   · 落在**我们自己的产物**里面的 `<pre>`（变量折叠卡 / 摘要框里的 `<pre>`
         *     是我们渲染出来的，藏掉等于把刚渲染的东西又吞了）。
         *
         * 隐藏用**内联 `display:none!important`** 而不是 `hidden` 属性：DSH 与卡
         * 都可能给 `pre` 设过 `display`，属性会被 CSS 盖掉。同时打
         * `data-muv-src-hidden` 记号，让门禁（与以后的人）数得到。
         * @param {Element} body
         * @returns {number} 隐藏了几块
         */
        function muvHidePageSourceBlocks(body) {
          var n = 0
          try {
            if (!body || !body.querySelectorAll) return 0
            var pres = body.querySelectorAll('pre')
            for (var i = 0; i < pres.length; i++) {
              var el = pres[i]
              try {
                if (el.getAttribute('data-muv-src-hidden')) { n++; continue }
                if (el.closest && el.closest('[class*="muv-"]')) continue
              } catch (_) { }
              var t = ''
              try { t = el.textContent || '' } catch (_) { t = '' }
              if (!muvIsPageSourceText(t)) continue
              // ★ 第 40 轮：只隐藏 `<pre>` 会留下 DSH 的代码块**外壳** —— 那个外壳有
              //   圆角底 + 顶部横幅（横幅里写的就是围栏语言名；卡源码是 ```html ⇒
              //   横幅写着 **html**）+ 复制按钮 ⇒ 用户看到"一个写着 html 的空框"。
              //   所以这里**连外壳一起隐藏**，但只在「这条消息已经有卡 iframe」时：
              //   没有 iframe 说明卡没渲染成功，那块源码是用户唯一能看到的卡内容，
              //   藏掉等于吞内容（本项目栽过的过度修复）；有 iframe 才说明是**重复**。
              //   ★ 整段内联（不新开函数）：`buildFrom` 只抽依赖表里列出的函数，
              //     多一层声明在 `test-client-render` 的变异对照臂里会是 ReferenceError。
              var target = el
              try {
                if (el.closest) {
                  var msg = el.closest('[class*="_markdown_"]')
                  if (msg && msg.querySelector &&
                      msg.querySelector('.muv-statusbar-wrap, iframe.muv-iframe')) {
                    var shell = el.closest('.md-code-block')
                    if (shell && shell.querySelectorAll('pre').length <= 1) target = shell
                  }
                }
              } catch (_) { target = el }
              try {
                target.setAttribute('data-muv-src-hidden', '1')
                target.style.setProperty('display', 'none', 'important')
                n++
              } catch (_) { }
            }
          } catch (_) { }
          return n
        }

        /**
         * Decorate one message.
         *
         * Writes into the *body* element's innerHTML and never the message root:
         * the root is DSH's own wrapper, and replacing it destroys the
         * `_markdown_*` element this decorator relies on (and re-renders on every
         * scroll). Accepts either a `{body, root}` pair or a bare element.
         * @param {{body:Element, root:Element}|Element} target
         * @param {number} [depth] SillyTavern 口径的层号（省略时 0）
         */
        async function _decorateOne(target, depth, isOldestFloor) {
          var body = target && target.body ? target.body : target
          var root = target && target.root ? target.root : target
          if (!body || body.nodeType !== 1) return
          if (body.getAttribute(DECORATED_ATTR) === '1') return
          // 流式输出中的消息先不动，等它写完
          if (root && root.closest && root.closest('[data-streaming]')) return
          if (body.closest && body.closest('[data-streaming]')) return

          // ★★ 三条守卫（2026-09-22 现场取证加的，HANDOFF §22）。
          //
          // 为什么必须有：`raw` 是从 DOM 的 `innerText` 取的，而**我们自己的装饰
          // 产物就长在那个 DOM 里** —— `.muv-statusbar-wrap`（卡 iframe）、
          // `<Abstract>` 换成的 `.muv-abstract`（📖 框）、`.muv-varthink`
          // （「💭 变量推演」），外加酒馆插件注入的 ✏️ 编辑按钮。
          // 一旦对同一个元素（或**包着它的**容器）再跑一遍，`innerText` 拿到的是
          // **我们自己渲染出来的文字**：
          //   · 卡正则 `<(?:content|…)>…</…>` 还是字面量、照样匹配 ⇒ 文档照建；
          //   · 但 `<Abstract>` 的**标签**早被换成了 `<div class="muv-abstract">`，
          //     于是 card [7]「对玩家隐藏摘要」（`/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`
          //     —— 大小写敏感 + 行锚）必然落空 ⇒ 摘要正文（时间/地点/摘要内容）
          //     **永久露在正文里**，还被当成正文塞进整页文档；
          //   · 我们自己的标签文字（📖 / 💭 变量推演 / ✏️）也一并变成正文。
          // 用户看到的「时间出现的地方不对劲」「选项/日常之外多出一堆怪文字」就是这个。
          //
          // ① 已经是我们的产物 ⇒ 绝不重复装饰（`innerText` 已经不可逆地丢了原始标签）。
          if (muvHasOwnArtifacts(body)) return
          // ② 目标规范化 + 只认"消息正文"：拿到 `_markdown_*` 正文容器本身再写，
          //    绝不写消息根节点（会毁掉 DSH 自己的正文元素），也绝不碰面板/侧栏
          //    （实测 DSH 的 `_paneBody_*` / `_surface_*` 曾被当成消息，面板内容被吃掉）。
          var normalizedBody = muvMessageBodyOf(body)
          if (!normalizedBody) return
          if (!root) root = body
          body = normalizedBody
          if (body.getAttribute(DECORATED_ATTR) === '1') return

          var raw = ''
          try {
            // innerText, not textContent: textContent concatenates block children
            // with no separator, so a message DSH rendered as several <p> would
            // arrive as one long line and every line-based parser would see a
            // single field. innerText keeps the rendered line breaks.
            //
            // ③ 取文前先把**非正文的 DOM**（按钮/脚本/我们自己的产物）临时隐藏：
            //    酒馆的 ✏️ 编辑按钮、徽标这类注入 UI 的文字同样会污染原文。
            //    隐藏而非克隆 —— 脱离文档的克隆上 `innerText` 会退化成 `textContent`，
            //    那正是上面这段注释要避免的。同一帧内同步 hide→读→restore，不会闪。
            raw = muvRawTextOf(body)
          } catch (_) { return }
          if (!raw) return
          // 记进 chat 环形缓冲，供卡的 `getContext().chat` 扫 CG 解锁标记。
          // 放在这里（而不是 `beautifyMuv` 里）是因为上面两行已经把「流式中的消息」
          // 和「已装饰过的消息」都挡掉了 ⇒ 每条消息**只记一次**，不会把 80 条上限
          // 灌满半截文本。
          // ★ 先用卡的 initvar 给空会话播种（每个会话一次，只在状态为空时做）。
          //   否则状态栏只渲染"本会话写过的角色"，其余角色整块消失。
          try { await muvEnsureSeeded() } catch (_) {}
          muvPushChatLog(raw)
          // ★ 运行时变量回灌：消息里带 <UpdateVariable>/<initvar>/<VariableEdit>/<era_data>
          //   就喂给服务端（ERA 增量块按消息键时序重放）—— era 桥从此有运行时数值可送
          //   （卡的选项/数值/CG 解锁都靠它）。
          //   ★ 喂 **innerHTML** 而不是 innerText：DSH 把消息渲染成元素时标签名不在
          //   innerText 里（只剩 JSON 文本），innerHTML 两种形态都在。
          try { muvFeedVariables(body.innerHTML) } catch (_) { muvFeedVariables(raw) }
          var html = null
          try {
            // ★ 把 depth 交给取卡那一步（`/api/muv-engine/apply-regex-card` 的
            //   `body.depth`）。**不传它就等于 depth 0** —— 卡里 `minDepth = 7` 的
            //   `[8]「自动总结，隐藏6楼以上除摘要外内容」` 会永远拿不到自己该生效的那一层，
          //   而 `[7]` 又把 `<Abstract>` 删掉 ⇒ 旧楼层"无摘要的全文"，两头都落空。
            // ★ fullpage 旗标（2026-09-25 恢复）：isOldestFloor ⇒ 本条是开场白/封面楼，
            //   产出链据此给整页卡 wrap 加 `muv-fullpage`（破格只认这个类）。
            //   await 期间不放行其它装饰（decorateMessages 串行），finally 复位防泄漏。
            muvFullpageFloor = isOldestFloor === true
            // ★ 键取证（默认关；开 `window.__MUV_KEY_TRACE = true` 才记）：
            //   把本轮**将要使用**的缓存键原样记下来。键字符串本身含全部分量
            //   （`sid|ck|d<n>[|fp]|v<m>`），两次通过逐分量比对即可定位是哪一项在漂
            //   —— 用于「切回会话为什么仍 miss」，不再靠改假设回测（2026-09-25）。
            try {
              if (window.__MUV_KEY_TRACE) {
                if (!window.__muvKeyLog) window.__muvKeyLog = []
                if (window.__muvKeyLog.length < 800) {
                  window.__muvKeyLog.push({
                    turn: muvTurnOfEl(root),
                    d: depth,
                    key: muvDecorKeyOf(raw, muvDepthFromLaterCount(depth)),
                    rawLen: String(raw == null ? '' : raw).length,
                    rawHead: String(raw == null ? '' : raw).replace(/\s+/g, ' ').slice(0, 32)
                  })
                }
              }
            } catch (_) {}
            try {
              html = await beautifyMuv(raw, { depth: muvDepthFromLaterCount(depth) })
            } finally {
              muvFullpageFloor = false
            }
          } catch (e) {
            // ★ 不许静默（2026-09-24）：beautifyMuv 内部已留痕，这里再兜一层是防
            //   它在进入内部 try 之前就抛（如 normalizeStatusHeader）。吞掉 = 消息
            //   钉死成"已装饰、无产物"且零日志 —— 苍玄界整晚排错的学费。
            html = null
            try { console.warn('[muv] beautifyMuv 抛错：', e && (e.stack || e.message || e)) } catch (_) {}
          }
          // ★ 开场白的 depth 重试（2026-09-24，苍玄界实锤）：
          //   社区卡的开场白正则普遍 `maxDepth: 0`（只作用于最新一楼）—— ST 在
          //   新会话播种时对 first_mes **不传 depth**（script.js:7660
          //   `getRegexedString(firstMes, AI_OUTPUT)`，深度检查整段跳过）⇒ 开场白
          //   永远出封面。而我们老会话里首楼 depth = 后面的楼数 ⇒ `maxDepth:0`
          //   落空 ⇒ 裸占位符。
          //   重试条件（对齐 ST 播种语义）：**首楼**（DOM 第一个消息容器 ≈ 开场白楼，
          //   isOldestFloor）且首跑原样返回且 depth>0 ⇒ 用 depth 0 再试一次。
          //   苍玄界的 first_mes 是「【GameStart】 + 几 KB 正文」，所以**不能**
          //   按文本长度判 —— 必须按楼位判。风险与取舍：首楼长正文的首跑若被
          //   depth 拒掉，重试会应用 maxDepth 小的脚本 —— 首楼几乎总是开场白楼，
          //   这正是要的效果；`[8]`类 minDepth 脚本在 depth 0 时照样跳过，不受影响。
          if ((!html || html === raw) && isOldestFloor && depth > 0) {
            // 重试同样在 fullpage 旗标下跑（开场白楼重试产出的封面文档照旧破格）。
            muvFullpageFloor = true
            try {
              html = await beautifyMuv(raw, { depth: 0 })
            } catch (e) {
              html = null
              try { console.warn('[muv] 开场白 depth 重试抛错：', e && (e.stack || e.message || e)) } catch (_) {}
            } finally {
              muvFullpageFloor = false
            }
          }
          if (html && html !== raw) {
            try { applyDecoratedHtml(body, html, raw) } catch (e) {
              try { console.warn('[muv] applyDecoratedHtml 写入失败：', e && (e.stack || e.message || e)) } catch (_) {}
            }
            // The swap rebuilds the message's HTML from plain text, which
            // discards anything the sanitize pass had already produced in this
            // element (`<choices>` → buttons) and re-marks it so the pass never
            // revisits it. That is how the option buttons disappeared. Clear
            // the mark and re-run the pass over just this element.
            try {
              body.removeAttribute('data-muv-sanitized')
              if (typeof muvSanitizeNode === 'function') muvSanitizeNode(body)
            } catch (_) {}
            // ★ 2026-10-17：这条楼落地了状态栏/卡 iframe ⇒ 补一次变量推送。
            //   切回会话时 React 重建所有卡帧，而变量回灌有去重账本（同一批消息不会
            //   再 schedule push）⇒ 新帧收不到 era:getCurrentVars，卡停在「未知」初值。
            //   这里去抖补推（一轮装饰最多一次），见 muvEraPushSoon 的长注释。
            try {
              if (String(html).indexOf('muv-statusbar-wrap') >= 0 ||
                  String(html).indexOf('muv-iframe') >= 0) muvEraPushSoon()
            } catch (_) {}
          }
          // ★ 最后一步：把"与 iframe 内容重复"的整页源码块藏起来（ST 的 `hidden!`）。
          //   放在装饰之后：整页文档**已经变成 iframe** 的那些，正文里对应的 `<pre>`
          //   可能仍在（卡正则没产出文档时的裸文本正是要靠这一步收掉）。
          //   装饰失败也不影响它 —— 它是纯 DOM 操作，不依赖上面的结果。
          try { muvHidePageSourceBlocks(body) } catch (_) {}
          // ★ 取卡「未决」时不钉已装饰标记（2026-09-24）：否则切会话瞬间的那条
          //   greeting 会因为会话 id 探测滞后被永久钉死成"已装饰、无产物"，
          //   重试通道（扫摆）从此进不来 —— 苍玄界首楼裸 `【GameStart】` 的实锤根因。
          //
          // ★★ 2026-10-17 再加一条：**裸标记还在就绝不钉**。取卡可能是"确定的空"
          //   （`fetchTavernCard` 的 `known && presetId === 'default'` 那一档），那一档
          //   会把 `muvCardFetchInconclusive` 置 false ⇒ 旧写法照样钉死 ⇒ 扫摆与自愈
          //   全被第一行挡回，只能靠切会话换一个新元素。而这一档恰恰是**流式刚结束**
          //   最容易命中的（权威会话/预设还没落盘）。判据只用"卡会消费的标记"，
          //   纯散文楼（没有任何标记）照旧钉死，不会退化成反复取卡。
          var pinOk = !muvCardFetchInconclusive
          try {
            if (pinOk && !muvHasOwnArtifacts(body) && MUV_RAW_MARKER_RE.test(body.textContent || '')) pinOk = false
          } catch (_) {}
          if (pinOk) body.setAttribute(DECORATED_ATTR, '1')
          // ★ 自愈计数清零（2026-10-17）：这次真的落地了我们的产物 ⇒ 之前"裸文本重试"
          //   的账一笔勾销。只在**有产物**时清：没有产物（卡没匹配）时保留退避计数，
          //   否则自愈扫摆会退化成"每秒重跑一遍全链"。
          try {
            if (muvHasOwnArtifacts(body)) {
              body.removeAttribute('data-muv-raw-retry')
              body.removeAttribute('data-muv-raw-next')
            }
          } catch (_) {}
        }

        var STATUS_OPEN_RE = /<\s*(?:Status_block|状况)\s*>/i
        var STATUS_CLOSE_RE = /<\s*\/\s*(?:Status_block|状况)\s*>/i

        /**
         * 从装饰结果里取出那一段 `muv-statusbar-wrap`（配平地扫 div）。
         *
         * 以前这里是个正则：`/<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/`
         * —— 它假定卡片末尾**恰好连着三个 `</div>`**。而真实产物并不总是这样：
         *  - 卡自带整页 HTML 时里面是 `<iframe …></iframe></div>`（零个内层 div）；
         *  - 空状态是 `<div class="muv-sb muv-sb-empty">…</div></div>`（两个）。
         * 匹配不上就直接走整条替换，markdown 白丢一次。所以改成按 div 深度配平：
         * 这是「生成什么就解析什么」的做法，不依赖产物长什么样。
         * @param {string} html
         * @returns {string|null}
         */

        /**
         * 整条替换兜底的**段落保持**（2026-09-23k，"一大坨"修复）。
         *
         * 取证实锤（dsh-live31）：②手术在页面加载时序下落空 ⇒ 走整条替换
         * `body.innerHTML = html`，而 html 的正文部分是 innerText 投影的纯文本
         * （段间 `\n\n`）—— innerHTML 解析后 CSS 空白折叠把 `\n\n` 全部吃掉，
         * 十二段正文塌成"一大坨"（渲染后 pCount:0、裸文本节点实锤）。
         *
         * 修法：写回前只对**标签之间的文本段**做 `\n{2,}` → `<br><br>`（段落感
         * 恢复）；单 `\n` 保持原样（HTML 渲染折叠成空格，与原 DOM 观感一致）。
         * 用 `<br>` 而不是包 `<p>`：不改变文档结构、无解析器自动闭合/挪动位置
         * 的副作用（文本段可能落在特殊上下文里）。标签内部（srcdoc 属性、
         * data-* 值）一律不碰 —— 扫描器带引号配平，属性值里的裸 `>` 不会被
         * 误判成标签结束。
         * @param {string} html
         * @returns {string}
         */
        function muvParaKeepHtml(html) {
          var s = String(html == null ? '' : html)
          if (!s) return s
          var out = ''
          var n = s.length
          var i = 0
          var textStart = 0
          var changed = false
          while (i < n) {
            var lt = s.indexOf('<', i)
            if (lt < 0) break
            // 找标签结束（`>`），引号内跳过 —— 属性值里的 `>` 不算结束
            var j = lt + 1
            while (j < n) {
              var c = s.charAt(j)
              if (c === '"' || c === "'") {
                var q = s.indexOf(c, j + 1)
                if (q < 0) { j = n; break }
                j = q + 1
                continue
              }
              if (c === '>') break
              j++
            }
            if (j >= n) break
            if (lt > textStart) {
              var seg = s.slice(textStart, lt)
              if (seg.indexOf('\n\n') >= 0 || seg.indexOf('\r\n\r\n') >= 0) {
                out += seg.replace(/\r?\n[ \t]*\r?\n+/g, '<br><br>')
                changed = true
              } else out += seg
            }
            out += s.slice(lt, j + 1)
            i = textStart = j + 1
          }
          if (textStart < n) {
            var tail = s.slice(textStart)
            if (tail.indexOf('\n\n') >= 0 || tail.indexOf('\r\n\r\n') >= 0) {
              out += tail.replace(/\r?\n[ \t]*\r?\n+/g, '<br><br>')
              changed = true
            } else out += tail
          }
          return changed ? out : s
        }

        /**
         * 用一段 HTML 替换 DOM 里的一段文本（Range 手术），失败返回 false。
         * @param {Element} body
         * @param {{node:Text,offset:number}} start
         * @param {{node:Text,offset:number}} end
         * @param {string} html
         * @returns {boolean}
         */
        function insertHtmlAtRange(body, start, end, html) {
          try {
            var range = document.createRange()
            range.setStart(start.node, start.offset)
            range.setEnd(end.node, end.offset)
            range.deleteContents()
            var holder = document.createElement('div')
            holder.className = 'muv-statusbar-hit'
            holder.innerHTML = html
            range.insertNode(holder)
            return true
          } catch (_) { return false }
        }

        /**
         * 把字符串转义成可安全放进 `new RegExp` 的字面量。
         *
         * 为什么需要：文本级状态栏要按**原文逐字**在 DOM 文本里找落点，而原文是模型
         * 写的自由文本（`[`、`|`、`(`、`…` 全是正则元字符/特殊字符）。
         * @param {string} s
         * @returns {string}
         */

        /**
         * 逐字匹配、但**空白处放宽**的正则源码。
         *
         * ★ 为什么必须放宽（门禁抓到的真事，别再改回逐字）：落点原文取自
         *   `innerText`，而 `innerText` 是**渲染投影** —— 它会在软折行处插入换行
         *   （实测：夹具里那段状态折叠块在 700px 容器里折了一行，`innerText` 给出的
         *   原文就在折行处多了一个 `\n`，而 DOM 的文本节点里那个位置只是**一个空格**）。
         *   照原文逐字去 `findTextRange` 会匹配不上 ⇒ 退回整条替换 ⇒ markdown 被抹平
         *   （夹具实测：`strong/h2/pre/li` 全 0）。所以空白处一律用 `\s*`：
         *   「有空白」与「没空白」都算匹配，其余字符仍必须逐字相同。
         * @param {string} s
         * @returns {string}
         */
        function muvFlexRegExpSource(s) {
          var parts = String(s).split(/\s+/)
          var out = []
          for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue
            out.push(muvRegExpEscape(parts[i]))
          }
          return out.join('\\s*')
        }

        /**
         * 从装饰产物里取出「文本级状态栏」的落点信息。
         *
         * 读的是产物自己的 `data-muv-ts*` 属性 —— 用 DOM 解析而不是正则切字符串：
         * 属性值是 `escAttr` 转义过的（原文里可能有 `&`/`<`/`"`），交给 `innerHTML`
         * 解析一次就自动还原了，比我手写一遍反转义可靠（`&amp;` 与 `&#38;` 两种写法
         * 都要对，手写必漏一种）。
         * @param {string} html
         * @returns {Array<{kind:string, raw:string, look:string, html:string}>}
         */

        /**
         * 把正文里的原文段逐段换成文本级状态栏。任一段找不到落点就整体放弃。
         *
         * 两种落点，按可靠性排序：
         *   ① `<details>` **元素**（kind=details）：DSH 的 markdown 会把裸 HTML 直通渲染，
         *      所以状态折叠块在 DOM 里是一个**真元素**，按元素整体替换最干净（不会留下
         *      空的 `<details>`/`<pre>` 壳）。探针是该块正文的前 10 个字 —— 围栏在 DOM 里
         *      早被吃掉了，所以探针必须从「去过围栏」的文本里取（见 `muvTextDetailsOf`）。
         *   ② **逐字文本段**（kind=prefix，以及被转义成文本的 `<details>`）：用 `findTextRange`
         *      按原文匹配后 Range 替换 —— `[时间:…][地点:…]` 在 DOM 里就是普通文本。
         * @param {Element} body
         * @param {Array<{kind:string, raw:string, look:string, html:string}>} segs
         * @returns {string} '' = 全部成功；否则是 `<第几段>:<形态>:<原因>`（留痕用）
         */
        function muvReplaceTsSegments(body, segs) {
          for (var i = 0; i < segs.length; i++) {
            var seg = segs[i]
            var done = false
            if (seg.kind === 'details' && seg.look) {
              try {
                var dets = body.querySelectorAll('details')
                for (var d = 0; d < dets.length; d++) {
                  var t = dets[d].textContent || ''
                  if (t.indexOf(seg.look) < 0) continue
                  var hold = document.createElement('div')
                  hold.innerHTML = seg.html
                  if (hold.firstChild && dets[d].parentNode) {
                    dets[d].parentNode.replaceChild(hold.firstChild, dets[d])
                    done = true
                  }
                  break
                }
              } catch (_) {}
            }
            if (done) continue
            if (!seg.raw) return i + ':' + seg.kind + ':no-raw'
            var r = findTextRange(body, new RegExp(muvFlexRegExpSource(seg.raw)))
            if (!r) return i + ':' + seg.kind + ':no-range'
            if (!insertHtmlAtRange(body, { node: r.node, offset: r.offset },
              { node: r.endNode, offset: r.endOffset }, seg.html)) return i + ':' + seg.kind + ':insert'
          }
          return ''
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain text
         * (`innerText` — `**`/`##`/``` 早就被 DSH 渲染掉了), so its output carries no
         * markdown: code blocks, tables and emphasis get flattened permanently, and
         * any ordinary reply that merely *mentions* a marker would be rewritten too.
         *
         * 所以只在**确实需要落地的那一段**上做手术，按优先级：
         *   ① `<Status_block>…</Status_block>`  → 只替换这一段；
         *   ② `<StatusPlaceHolderImpl/>`          → 只替换这一段（第二类迁移新增）；
         *   ③ 都找不到 → 只能整条替换（最后手段，保留原行为）。
         * 另有两条在 ① 之前的分支，都是「整条替换」的既有语义、不是新的落点策略：
         *   · 产物里带整页文档（`raw` 里有行首围栏 / `<!doctype`）→ 整条替换；
         *   · ★ 第 35 轮：文本级状态栏（产物带 `data-muv-ts*`）→ **把正文里的原文段
         *     换成状态栏**（`①.5`，见那里的长注释），失败才退回整条替换。
         * 文本偏移而不是「包住标签的那个元素」：DSH 的 markdown 会把这些行塞进任意嵌套
         * 元素里，元素级手术会留下半截标签文本 —— 那正是 0.3.3 时代 `角色状态]</summary>`
         * 那种碎屑的来源。
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function applyDecoratedHtml(body, html, raw) {
          var cardMatch = extractStatusWrap(html)
          // 装饰产物里根本没有状态栏（卡的正则改了文本但级联没出东西）：保持老行为。
          if (!cardMatch) { body.innerHTML = muvParaKeepHtml(html); return }

          // ★ 整页文档必须在**这里**就走整条替换，不能塞进下面那个 status 手术。
          //
          // 下面 ①②③ 三条路都只把 `cardMatch`（状态栏那一段）插进 DOM 的某个落点。
          // 当消息里同时有「整页文档」和「状态栏」时（`_足控天堂2` 的 `<StatusPlaceHolderImpl/>`
          // 正则天然如此），`beautifyMuv` 算出来的那个**文档 iframe 会被整段丢掉** ——
          // DOM 里只剩下状态栏，而消息里原来那段围栏文本原样留着 → 用户看到
          // 「一大段 HTML 没渲染、全是裸文本」。实测（verify-realcard-inline.mjs，真卡
          // 正文美化 46KB 文档 + 占位符）：装饰产物里 `outIframes=1`、`outHasNakedDoc=0`
          // （产物是对的），但装饰后 DOM 里 `preTextLen` 仍是 30316 字符的裸文档、
          // `msgIframes` 里那个 iframe 其实是状态栏那条。
          //
          // 判据用 `raw`（写回之前读到的**纯文本**）而不是 `html`：raw 里有没有文档，
          // 和「产物里有没有 iframe」是同一件事的两面，但 raw 是原始输入，不受
          // 状态栏渲染分支影响，判起来不会自指。
          if (/^\s{0,3}`{3,}/m.test(raw) || /<!doctype|<html[\s>]/i.test(raw)) {
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ★★ ①.5 文本级状态栏（第 35 轮，无占位符的卡）：落点信息写在**产物自己**的
          //    `data-muv-ts-*` 属性里（自己生成、自己解析，不靠模块级状态 —— 并发装饰
          //    多条消息时不会串）。
          //
          // 与下面 ①② 的区别：那两条是「把状态栏整段插到某个标记的位置上」，而这一条是
          // **把正文里的原文段换成状态栏** —— `[时间:…][地点:…]` 那一串必须从正文里
          // 消失，否则用户会同时看到裸方括号和状态栏（用户最初的抱怨就是"裸文本堆在
          // 正文里"）。
          var tsSegs = muvTsSegmentsOf(html)
          if (tsSegs.length) {
            var tsWhy = muvReplaceTsSegments(body, tsSegs)
            if (!tsWhy) return
            // 手术失败（DOM 里的原文与产物对不上，例如别的东西改写过文本）：退回整条
            // 替换。这会让 markdown 变平，所以只作最后手段 —— 但它至少保证「状态栏出现
            // + 裸方括号消失」，也就是用户报的那件事被解决。
            // ★ 失败原因落在元素属性上（`data-muv-ts-fallback=<第几段:形态:原因>`）：
            //   这条路径**是隐形的**（用户只会看到 markdown 变平），不留痕的话只能靠
            //   重放现场查 —— 排错手册里那条"元信息裸露成裸文本"就是照着它写的。
            try { body.setAttribute('data-muv-ts-fallback', tsWhy) } catch (_) {}
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ① 结构化状态块
          var open = findTextRange(body, STATUS_OPEN_RE)
          if (open) {
            var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
            var full = ''
            var n
            while ((n = walker.nextNode())) full += n.nodeValue || ''
            var afterOpen = full.slice(open.start)
            var cm = STATUS_CLOSE_RE.exec(afterOpen)
            var end
            if (cm) {
              var closeEnd = open.start + cm.index + cm[0].length
              var w2 = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
              var nodes2 = []
              var acc = ''
              var t
              while ((t = w2.nextNode())) {
                var v = t.nodeValue || ''
                if (!v) continue
                nodes2.push({ node: t, start: acc.length })
                acc += v
              }
              var loc = function (pos) {
                for (var i = 0; i < nodes2.length; i++) {
                  var s = nodes2[i].start
                  var e = s + (nodes2[i].node.nodeValue || '').length
                  if (pos >= s && pos <= e) return { node: nodes2[i].node, offset: pos - s }
                }
                return null
              }
              end = loc(closeEnd)
            } else {
              // 未闭合（还在流式，或模型漏了收尾标签）：只换开标签自己。
              end = { node: open.node, offset: open.offset + (open.endOffset - open.offset) }
            }
            if (end && insertHtmlAtRange(body, { node: open.node, offset: open.offset }, end, cardMatch)) return
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ② 占位符：卡用 `<StatusPlaceHolderImpl/>` 而不是 `<Status_block>`
          var ph = findTextRange(body, STATUS_PH_TEST)
          if (ph && insertHtmlAtRange(body, { node: ph.node, offset: ph.offset },
            { node: ph.endNode, offset: ph.endOffset }, cardMatch)) return

          // ③ 找不到落点：最后手段（这一条会让 markdown 变平，但至少消息不是空的；
          //    段落保持兜底见 muvParaKeepHtml —— dsh-live31 实锤的"一大坨"就走的这里）
          body.innerHTML = muvParaKeepHtml(html)
        }

        /**
         * Find the character offset of a regex match inside an element's text,
         * walking text nodes in document order.
         * @param {Element} root
         * @param {RegExp} re
         * @returns {{node:Text, offset:number, endNode:Text, endOffset:number, start:number}|null}
         */
        function findTextRange(root, re) {
          var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
          var nodes = []
          var full = ''
          var n
          while ((n = walker.nextNode())) {
            var v = n.nodeValue || ''
            if (!v) continue
            nodes.push({ node: n, start: full.length })
            full += v
          }
          var m = re.exec(full)
          if (!m) return null
          var start = m.index
          var end = start + m[0].length
          var locate = function (pos) {
            for (var i = 0; i < nodes.length; i++) {
              var s = nodes[i].start
              var e = s + (nodes[i].node.nodeValue || '').length
              if (pos >= s && pos <= e) return { node: nodes[i].node, offset: pos - s }
            }
            return null
          }
          var a = locate(start)
          var b = locate(end)
          if (!a || !b) return null
          // Both endpoints must live in an element we can safely edit.
          if (!a.node.parentNode || !b.node.parentNode) return null
          return { node: a.node, offset: a.offset, endNode: b.node, endOffset: b.offset, start: start }
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain
         * text, so its prose output carries no markdown — code blocks, tables and
         * emphasis DSH rendered get flattened, and any ordinary reply that merely
         * *mentions* `<Status_block>` would be rewritten too.
         *
         * So we delete exactly the text range spanned by the status block and
         * drop the card in its place, using a DOM Range. Working on text offsets
         * (rather than picking "the block element that contains the tag") matters:
         * DSH's markdown wraps these lines in arbitrary, often nested elements, so
         * element-level surgery leaves fragments of the tag text behind — which is
         * exactly the `角色状态]</summary> ...` debris that shipped in 0.3.3.
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function scheduleDecorate() {
          if (_decorRaf) return
          _decorRaf = window.requestAnimationFrame(function () {
            _decorRaf = 0
            decorateMessages()
          })
        }

        scheduleDecorate()

        // ★★★ 「生成完就转」—— 流式一结束就装饰，不再等切会话（2026-10-17，用户实测）
        //
        // 病症（用户截图原话）：生成完，正文里的 `<UpdateVariable>…</UpdateVariable>`、
        //   `JSONPatch` 一大坨 JSON 原样露着；**必须切走再切回**才变成状态栏。
        //
        // 根因（两条，都在"触发"这一侧，与产物质量无关）：
        //   ① 旧观察配置只有 `{ childList: true, subtree: true }` —— **不看属性**。
        //      而 DSH 流式结束时是**摘掉 `[data-streaming]`**（属性变更，不是 childList），
        //      最后那一次 childList 又发生在"消息还被 streaming 守卫挡着"的时刻 ⇒
        //      `_decorateOne` 直接 return，之后**再无触发** ⇒ 裸着到天荒地老。
        //      切会话之所以"能显示"，是因为整棵子树重建 ⇒ childList 命中（且新节点不带
        //      streaming 属性）—— 这正是用户摸索出来的那个"偏方"。
        //   ② `decorateMessages` 是 async 串行（取卡 ~200ms+），旧写法撞车时 `return`，
        //      **静默丢掉这一拍**。流式结束那一瞬间恰好最容易撞上。
        //
        // 三路兜底，任何一路先到都会转（互相不依赖，单路失效不影响另两路）：
        //   A. `attributes` + `attributeFilter: ['data-streaming']`：属性被摘 ⇒ 立刻 +
        //      尾随 200ms / 800ms 各补一拍（React 摘属性后还会再 commit 一次收尾 UI，
        //      rAF 常常比那次 commit 早 —— 与 HANDOFF 里"切会话挂载晚于回调"同型）。
        //   B. **文本空闲判据**：任何 childList 变化都重置 400ms 计时器；停止流入 400ms
        //      就试一拍。不依赖 data-streaming 是否存在（别的 DSH 版本可能没有这个属性），
        //      流式途中试也无害 —— `_decorateOne` 的 `[data-streaming]` 守卫会原样返回。
        //   C. 既有 3s 低频扫摆（保留，防 A/B 都漏；也让"取卡未决"的楼最终一致）。
        function muvDecorAfterStreamEnd() {
          scheduleDecorate()
          // ★ 2000ms 那一拍是 2026-10-17 补的：DSH 关楼之后还会再 commit 一次
          //   「操作条 / 用量 / 停止标记」，实测那次 commit 可能晚到 1s 以上；
          //   只到 800ms 时会漏掉"刚装饰完又被 React 重建一次"的那条楼。
          var delays = [200, 800, 2000]
          for (var i = 0; i < delays.length; i++) {
            ;(function (ms) {
              _muvDecorTails.push(setTimeout(function () { scheduleDecorate() }, ms))
              // 有界：连续多轮生成时不许计时器无限累积
              while (_muvDecorTails.length > 12) {
                try { clearTimeout(_muvDecorTails.shift()) } catch (_) {}
              }
            })(delays[i])
          }
        }

        _muvMsgObs = new MutationObserver(function (mrs) {
          var ended = false
          try {
            for (var i = 0; i < mrs.length; i++) {
              var m = mrs[i]
              if (m.type === 'attributes' && m.attributeName === 'data-streaming' &&
                  m.target && m.target.getAttribute &&
                  m.target.getAttribute('data-streaming') === null) {
                ended = true
              }
            }
          } catch (_) {}
          if (ended) { muvTrace('stream.end'); muvDecorAfterStreamEnd(); return }
          // B：文本仍在流入 ⇒ 重置空闲计时器（流式中每帧一次，开销只有 clearTimeout+setTimeout）
          try {
            if (_muvDecorIdleTimer) clearTimeout(_muvDecorIdleTimer)
            _muvDecorIdleTimer = setTimeout(function () {
              _muvDecorIdleTimer = 0
              muvTrace('stream.idle')
              scheduleDecorate()
            }, 400)
          } catch (_) {}
          scheduleDecorate()
        })
        // ★ 注意 `attributes: true` 必须配 `attributeFilter`：DSH 的消息列表每次流式
        //   token 都会改一堆 class/style，全量属性观察会把主线程拖死。
        _muvMsgObs.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-streaming']
        })

        // ══ 裸文本自愈（2026-10-17）══════════════════════════════════════════
        //
        // 为什么还留这一层：上面三路触发都是"尽力而为"——它们只保证**有事件**时会转，
        // 但转完之后 DSH 的那次收尾 commit 可能把我们写进 DOM 的状态栏**重建掉**
        // （React 手里没有我们插的节点）。更隐蔽的是 `data-muv-decorated="1"` 钉在
        // **被复用的那个正文元素**上：内容被重建回裸 markdown，钉子还在 ⇒ 之后每一路
        // 触发（含 3s 扫摆）都在 `_decorateOne` 第一行被原样挡回，用户看到的就是
        // "一直是原始 JSON，切走再切回才好"（切会话会换一个新元素，钉子自然没了）。
        //
        // 判据刻意只看**会被卡消费掉的标记**（变量块/占位符），不看 `<content>` 这类
        // 正常正文标签 —— 后者在"卡不产出任何产物"的楼里永远存在，拿它当判据会变成
        // 每 20s 重跑一次全链，白烧取卡往返。
        var MUV_RAW_MARKER_RE = /<\s*\/?\s*(?:UpdateVariable|JSONPatch|VariableEdit|VariableInsert|StatusPlaceHolderImpl|Status_block|StatusBlock|era_data|initvar)\b/i
        // 重试退避（秒）：0 / 1 / 3 / 10 / 30 / 60，之后**停手**。
        // 停手是必须的：有的卡本来就故意让 `<UpdateVariable>` 留在正文里当可读内容，
        // 无限重试会把取卡往返烧成常态。前 6 拍足以覆盖"取卡未决 / React 重建"的窗口。
        var MUV_RAW_BACKOFF = [0, 1, 3, 10, 30, 60]

        /**
         * 这条消息体是不是**该转却还是裸的**？
         *
         * 三条同时成立才算：① 有我们的标记、② 没有我们的产物、③ 不在流式中。
         * 钉没钉过不参与判断 —— 钉过但产物被重建掉的，正是要救的那一类。
         * @param {Element} body
         * @returns {boolean}
         */
        function muvLooksRawUndecorated(body) {
          try {
            if (!body || !body.getAttribute) return false
            if (body.closest && body.closest('[data-streaming]')) return false
            if (muvHasOwnArtifacts(body)) return false
            var t = ''
            try { t = body.textContent || '' } catch (_) { t = '' }
            if (!t) return false
            return MUV_RAW_MARKER_RE.test(t)
          } catch (_) { return false }
        }

        /**
         * 撤掉钉子并记一次重试；返回 true = 这一拍可以重跑装饰。
         * @param {Element} body
         * @param {number} now
         * @returns {boolean}
         */
        function muvUnpinForRework(body, now) {
          try {
            var n = Number(body.getAttribute('data-muv-raw-retry') || 0) || 0
            if (n >= MUV_RAW_BACKOFF.length) return false
            var nextAt = Number(body.getAttribute('data-muv-raw-next') || 0) || 0
            if (nextAt && now < nextAt) return false
            body.setAttribute('data-muv-raw-retry', String(n + 1))
            body.setAttribute('data-muv-raw-next', String(now + MUV_RAW_BACKOFF[n] * 1000))
            if (body.getAttribute(DECORATED_ATTR) === '1') body.removeAttribute(DECORATED_ATTR)
            return true
          } catch (_) { return false }
        }

        /**
         * 1s 一拍的自愈扫摆。只看**最后 8 条**消息体（要救的永远是刚生成的那条；
         * 老楼由切会话那条路负责），命中即撤钉 + 触发装饰。
         */
        function muvRawWatchdogTick() {
          try {
            if (typeof document.visibilityState === 'string' && document.visibilityState !== 'visible') return
            if (_decorating) return
            var targets = messageTargets()
            var from = Math.max(0, targets.length - 8)
            var need = false
            var hits = 0
            var now = Date.now()
            for (var i = from; i < targets.length; i++) {
              var body = targets[i].body
              if (!muvLooksRawUndecorated(body)) continue
              if (!muvUnpinForRework(body, now)) continue
              need = true
              hits++
            }
            if (need) { muvTrace('watch.hit', { n: hits, last: targets.length }); scheduleDecorate() }
          } catch (_) {}
        }

        // ══ 诊断探针（2026-10-17 · 只读）═════════════════════════════════════
        //
        // 读法（DevTools Console，粘这一行就够）：
        //     copy(JSON.stringify(__muvDump(), null, 1))
        // 返回的是**当场现算**的 DOM 快照 + 最近 80 条触发/装饰留痕：
        //   · 每条消息：长度 / 钉子 / 有无产物 / 是否还在流式 / 残留标记 / 重试次数
        //   · 缓存：条目数与总字节（切回会话"秒开"靠它）
        //   · trace：`stream.*`（属性摘除）、`watch.hit`（自愈命中）、`beautify.*`（产物链）
        var __muvTrace = []
        function muvTrace(kind, extra) {
          try {
            var row = { t: Date.now() % 1000000, k: kind }
            if (extra) { for (var k in extra) row[k] = extra[k] }
            __muvTrace.push(row)
            while (__muvTrace.length > 600) __muvTrace.shift()
          } catch (_) {}
        }
        try {
          window.__MUV_TRACE__ = __muvTrace
          window.__muvDump = function () {
            var out = { at: new Date().toISOString(), href: String(location.href) }
            try {
              var svc = window.__DSH_TAVERN_SESSIONS__
              if (svc && svc.list && typeof svc.list.getSnapshot === 'function') {
                var sn = svc.list.getSnapshot()
                out.session = (sn && sn.current) || null
              }
            } catch (_) {}
            try { out.cache = { entries: Object.keys(muvDecorCache).length, bytes: muvDecorBytes } } catch (_) {}
            try {
              out.varRev = out.session ? muvVarRevOf('session-' + String(out.session).replace(/^session-/, '')) : 0
              out.strictRev = window.__MUV_CACHE_STRICT_REV === true
            } catch (_) {}
            out.msgs = []
            try {
              var ts = messageTargets()
              for (var i = 0; i < ts.length; i++) {
                var b = ts[i].body
                var tx = ''
                try { tx = b.textContent || '' } catch (_) {}
                var mk = tx.match(MUV_RAW_MARKER_RE)
                var rect = null
                try { rect = b.getBoundingClientRect() } catch (_) {}
                out.msgs.push({
                  i: i,
                  turn: muvTurnOfEl(ts[i].root),
                  len: tx.length,
                  pinned: b.getAttribute(DECORATED_ATTR) === '1',
                  artifacts: muvHasOwnArtifacts(b),
                  streaming: !!(b.closest && b.closest('[data-streaming]')),
                  marker: mk ? mk[0] : null,
                  retry: b.getAttribute('data-muv-raw-retry') || '0',
                  w: rect ? Math.round(rect.width) : -1,
                  h: rect ? Math.round(rect.height) : -1
                })
              }
            } catch (e) { out.msgsError = String((e && e.message) || e) }
            try { out.trace = __muvTrace.slice(-80) } catch (_) { out.trace = [] }
            return out
          }
          muvTrace('probe.ready', { msgs: messageTargets().length })
        } catch (_) {}

        _muvWatchTimer = setInterval(muvRawWatchdogTick, 1000)

        // ★ 装饰扫摆（2026-09-24，真机实锤的兜底）：切会话时 React 的挂载常晚于
        //   MutationObserver 的最后一次回调 —— rAF 跑的时候新消息还没 commit，
        //   decorateMessages() 空转，之后不再有 mutation ⇒ 消息永久裸着
        //   （dsh-live6 自主诊断：同一会话反复切入，卡 iframe 时有时无）。
        //   低频扫摆把"漏触发"变成"最终一致"：_decorateOne 的 DECORATED_ATTR /
        //   muvHasOwnArtifacts / [data-streaming] 三重守卫保证已装饰的零成本跳过；
        //   取卡未决（muvCardFetchInconclusive）的消息不会被钉死，扫摆会救回来。
        //   3s 是成本取舍：再密了空扫开销可感，再疏了用户等待过久。
        _muvSweepTimer = setInterval(function () { scheduleDecorate() }, 3000)

        // Publish the entry points now that the DOM helpers exist.
        _decorateOneHook = _decorateOne
        _scheduleDecorateHook = scheduleDecorate
      })();      return function() {
        style.remove()
        if (_macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
        // These live in the factory scope (declared above) so the cleanup can
        // actually reach them — inside the IIFE they were unreachable here.
        if (_muvMsgObs) { _muvMsgObs.disconnect(); _muvMsgObs = null }
        if (_muvSweepTimer) { clearInterval(_muvSweepTimer); _muvSweepTimer = null }
        if (_muvWatchTimer) { clearInterval(_muvWatchTimer); _muvWatchTimer = null }
        // 「生成完就转」的计时器同样归工厂作用域管，见 part-02 的声明处注释。
        if (_muvDecorIdleTimer) { clearTimeout(_muvDecorIdleTimer); _muvDecorIdleTimer = 0 }
        try {
          while (_muvDecorTails.length) clearTimeout(_muvDecorTails.pop())
        } catch (_) {}
        _muvDecorPending = false
        if (_vrObs) { _vrObs.disconnect(); _vrObs = null }
      }
    }

    return module.exports
  }
})