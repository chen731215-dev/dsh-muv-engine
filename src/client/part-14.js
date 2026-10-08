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
          }
          // ★ 最后一步：把"与 iframe 内容重复"的整页源码块藏起来（ST 的 `hidden!`）。
          //   放在装饰之后：整页文档**已经变成 iframe** 的那些，正文里对应的 `<pre>`
          //   可能仍在（卡正则没产出文档时的裸文本正是要靠这一步收掉）。
          //   装饰失败也不影响它 —— 它是纯 DOM 操作，不依赖上面的结果。
          try { muvHidePageSourceBlocks(body) } catch (_) {}
          // ★ 取卡「未决」时不钉已装饰标记（2026-09-24）：否则切会话瞬间的那条
          //   greeting 会因为会话 id 探测滞后被永久钉死成"已装饰、无产物"，
          //   重试通道（扫摆）从此进不来 —— 苍玄界首楼裸 `【GameStart】` 的实锤根因。
          if (!muvCardFetchInconclusive) body.setAttribute(DECORATED_ATTR, '1')
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
        function extractStatusWrap(html) {
          var s = String(html || '')
          // ★ 前缀匹配，不带闭合引号（2026-09-23k）：wrap 打标唯一化后整页文档
          //   产物是 `<div class="muv-statusbar-wrap muv-fullpage">`，精确串
          //   `'<div class="muv-statusbar-wrap"'` 匹配不上 ⇒ cardMatch 落空 ⇒
          //   走 applyDecoratedHtml 的整条替换兜底，正文 markdown 被塌平
          //   （dsh-live31 真机实锤：农场问候楼 rectW 1576 即此因）。
          //   后面的 `>` 配平不依赖 class 串内容，放宽安全。
          var open = s.indexOf('<div class="muv-statusbar-wrap')
          if (open < 0) return null
          var gt = s.indexOf('>', open)
          if (gt < 0) return null
          var depth = 1
          var re = /<\/?div\b[^>]*>/gi
          re.lastIndex = gt + 1
          var m
          while ((m = re.exec(s))) {
            depth += (m[0].charAt(1) === '/') ? -1 : 1
            if (depth === 0) return s.slice(open, re.lastIndex)
          }
          return null
        }

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
        function muvRegExpEscape(s) {
          return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
        }

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
        function muvTsSegmentsOf(html) {
          var out = []
          try {
            var s = String(html || '')
            if (s.indexOf('data-muv-ts=') < 0) return out
            var holder = document.createElement('div')
            holder.innerHTML = s
            var nodes = holder.querySelectorAll('[data-muv-ts]')
            for (var i = 0; i < nodes.length; i++) {
              var el = nodes[i]
              out.push({
                kind: el.getAttribute('data-muv-ts') || '',
                raw: el.getAttribute('data-muv-ts-raw') || '',
                look: el.getAttribute('data-muv-ts-look') || '',
                html: el.outerHTML
              })
            }
          } catch (_) { return [] }
          return out
        }

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
        _muvMsgObs = new MutationObserver(scheduleDecorate)
        _muvMsgObs.observe(document.body, { childList: true, subtree: true })

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
        if (_vrObs) { _vrObs.disconnect(); _vrObs = null }
      }
    }

    return module.exports
  }
})