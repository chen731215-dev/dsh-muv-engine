        return box
      }

      /**
       * 把子树拼成一个字符串，**在 `<br>` 与块级边界补 `\n`**，并给出「字符 → 文本节点」的映射。
       *
       * 为什么不能直接拼 `nodeValue`：`<br>` 自己没有任何文本，而它恰恰是选项行的分隔符。
       * 直接拼会得到 `A. 甲B. 乙`，把两个选项粘成一个（`innerText` 在这里是对的，
       * 因为它按布局算换行；`textContent` 是错的）。实测就是这个坑：
       * 粘在一起之后 `<choices>` 只解析出 1 个选项。
       * @param {Element} root
       * @returns {{text: string, map: Array<{node: Text, start: number}>}}
       */
      function muvTextWithBreaks(root) {
        var text = ''
        var map = []
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null)
        var n
        var BLOCK = { P: 1, DIV: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, PRE: 1, BLOCKQUOTE: 1, TR: 1, TABLE: 1, UL: 1, OL: 1 }
        while ((n = walker.nextNode())) {
          if (n.nodeType === 3) {
            var v = n.nodeValue || ''
            if (!v) continue
            map.push({ node: n, start: text.length })
            text += v
            continue
          }
          var tag = n.tagName || ''
          if (tag === 'BR') { text += '\n'; continue }
          if (BLOCK[tag] && text && !/\n$/.test(text)) text += '\n'
        }
        return { text: text, map: map }
      }

      /**
       * 把 DOM 里的一段文本换成**元素**（Range 手术）。
       * @param {{node:Text,offset:number}} start
       * @param {{node:Text,offset:number}} end
       * @param {Node} node
       * @returns {boolean}
       */
      function replaceRangeWithNode(start, end, node) {
        try {
          var range = document.createRange()
          range.setStart(start.node, start.offset)
          range.setEnd(end.node, end.offset)
          range.deleteContents()
          range.insertNode(node)
          return true
        } catch (_) { return false }
      }

      // 媒体元素允许保留的属性白名单。**`on*` 一律丢**：媒体标签的文本来自模型/卡，
      // 直接 innerHTML 就等于把 `onerror=` 这类东西请进 DSH 自己的页面（同源执行）。
      // 白名单化之后，最坏情况只是"属性被忽略"，而不是"脚本被执行"。
      var MUV_MEDIA_ATTRS = {
        src: 1, controls: 1, preload: 1, loop: 1, autoplay: 1, muted: 1, playsinline: 1,
        poster: 1, width: 1, height: 1, id: 1, class: 1, style: 1, title: 1,
        type: 1, kind: 1, srclang: 1, label: 1, crossorigin: 1, media: 1,
      }

      /**
       * 把一个解析出来的媒体元素**按白名单**拷成新元素。
       * @param {Element} srcEl
       * @returns {Element|null}
       */
      function muvCloneMediaElement(srcEl) {
        if (!srcEl || srcEl.nodeType !== 1) return null
        var tag = String(srcEl.tagName || '').toLowerCase()
        if (tag !== 'video' && tag !== 'audio' && tag !== 'source' && tag !== 'track') return null
        var out = document.createElement(tag)
        var attrs = srcEl.attributes || []
        for (var i = 0; i < attrs.length; i++) {
          var name = String(attrs[i].name || '').toLowerCase()
          if (name.indexOf('on') === 0) continue
          if (!MUV_MEDIA_ATTRS[name]) continue
          try { out.setAttribute(name, attrs[i].value) } catch (_) {}
        }
        return out
      }

      /**
       * 由一段媒体标签文本造出真正的元素（原生路径的 ④）。
       *
       * 用 `DOMParser` 解析**离线文档**（不是活动文档的 innerHTML），再逐属性白名单拷贝 ——
       * 这样既能支持 `<video><source …></video>` 这种带子节点的形态，又不会把事件处理器
       * 带进页面。
       *
       * 与字符串路径 `renderMediaTags()` 的取舍保持一致：
       *  - 有 src（或带 `<source>` 子节点）→ 真实元素，缺 `controls` / `preload` 就补上；
       *  - **一个属性都没有**的裸提示词 → 文字占位（`muv-video-ph` / `muv-audio`）；
       *  - 有属性但没 src → 返回 null（**不动它**：那多半是脚本待填的元素，见 ② 的说明）。
       * @param {string} segment
       * @returns {Element|null}
       */
      function muvBuildMediaElement(segment) {
        var parsed
        try {
          parsed = new DOMParser().parseFromString('<div id="muv-media-root">' + String(segment) + '</div>', 'text/html')
        } catch (_) { return null }
        var host = parsed && parsed.getElementById('muv-media-root')
        var first = host && host.firstElementChild
        if (!first) return null
        var el = muvCloneMediaElement(first)
        if (!el) return null
        var kids = first.children || []
        for (var i = 0; i < kids.length; i++) {
          var child = muvCloneMediaElement(kids[i])
          if (child) el.appendChild(child)
        }
        var hasSrc = !!el.getAttribute('src') || !!el.querySelector('source')
        var hasSrcAttr = el.hasAttribute('src')
        var hasChildren = !!(el.children && el.children.length)
        var disposition = mediaTagDisposition(hasSrcAttr, hasSrc, !!(first.attributes && first.attributes.length), hasChildren)
        if (disposition === 'skip') return null
        if (disposition === 'placeholder') {
          var ph = document.createElement('div')
          ph.className = el.tagName === 'VIDEO' ? 'muv-video-ph' : 'muv-audio'
          ph.textContent = (el.tagName === 'VIDEO' ? '🎬 ' : '🎵 ') + String(first.textContent || '').trim()
          return ph
        }
        if (!el.hasAttribute('controls')) el.setAttribute('controls', '')
        if (!el.hasAttribute('preload')) el.setAttribute('preload', 'metadata')
        try { el.classList.add('muv-media') } catch (_) {}
        return el
      }

      /**
       * 原生路径的媒体标签渲染（DOM 层）—— ④。
       *
       * 为什么必须是 DOM 层：`renderMediaTags()` 的结果如果整条写回（`body.innerHTML = html`），
       * 输入是 `innerText`（markdown 早被 DSH 渲染掉了），会把整条消息的 markdown 抹平。
       * 实测过：媒体产物里没有任何状态栏片段 ⇒ `applyDecoratedHtml` 会落在那条最后手段上。
       * 所以这里只把**那一段标签文本**换成元素，其余 DOM 一个不碰。
       *
       * 落点在 `<script>` / `<style>` 里的文本一律跳过（与字符串路径同一条红线：
       * 那是代码，不是标记）。
       * @param {Element} root
       * @returns {number} 换掉的媒体标签数量
       */
      function muvRenderMediaTags(root) {
        if (!root || root.nodeType !== 1) return 0
        if (typeof DOMParser !== 'function') return 0
        var done = 0
        var from = 0
        var re = /<(audio|video)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi
        for (var guard = 0; guard < 40; guard++) {
          var walked = muvTextWithBreaks(root)
          var pattern = new RegExp(re.source, re.flags)
          pattern.lastIndex = from
          var hit = pattern.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          // 跳过代码里的同名标签，以及定位不到的情况：把游标推过这一段，继续找下一个
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var built = muvBuildMediaElement(hit[0])
          if (!built) { from = hit.index + hit[0].length; continue }
          if (!replaceRangeWithNode(a, b, built)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * `<插图>名字</插图>` → 占位块（原生路径的 ④ 之一）。
       *
       * 酒馆路径有这一步（`_tavernRenderTags` 里那段字符串替换），原生路径从来没有 ——
       * 于是模型写的 `<插图>` 就是一段裸文本。这里在 DOM 层只换那一段，markdown 不受影响。
       * 元素是**手工搭**的（textContent），不解析任何 HTML：名字来自模型，不该进解析器。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderIllustrations(root) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        var from = 0
        for (var guard = 0; guard < 20; guard++) {
          var walked = muvTextWithBreaks(root)
          var re = /<插图>([\s\S]*?)<\/插图>/gi
          re.lastIndex = from
          var hit = re.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var box = document.createElement('div')
          box.className = 'muv-illustration'
          var icon = document.createElement('span')
          icon.className = 'muv-illustration-icon'
          icon.textContent = '🖼️'
          box.appendChild(icon)
          box.appendChild(document.createTextNode(' ' + String(hit[1] || '').trim()))
          if (!replaceRangeWithNode(a, b, box)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * 通用的「把一段标记文本换成元素」循环（第三类及其后续都复用它）。
       *
       * 与 `muvRenderMediaTags` 同样的三条纪律：跳过 `<script>/<style>` 里的同名文本
       * （那是代码不是标记）、只动命中的那一段、有收敛上限。
       * 决定「不处理」时把游标推过这一段继续找下一个，而不是直接 break ——
       * 一条消息里可能有好几个同类块，其中一个形态不认识不该让后面的也漏掉。
       * @param {Element} root
       * @param {RegExp} re 需带 g 标志
       * @param {(hit: RegExpExecArray) => Element|'remove'|null} build 返回元素=替换、
       *   返回 `'remove'`=只删掉这一段（隐藏类标记）、返回 null=别碰（推过这一段继续找）
       * @param {number} [maxRounds]
       * @returns {number} 处理掉的块数
       */
      function muvReplaceTagBlocks(root, re, build, maxRounds) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        var from = 0
        var limit = maxRounds || 40
        for (var guard = 0; guard < limit; guard++) {
          var walked = muvTextWithBreaks(root)
          var pattern = new RegExp(re.source, re.flags)
          pattern.lastIndex = from
          var hit = pattern.exec(walked.text)
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          var inCode = false
          try {
            inCode = !!(a && a.node.parentElement && a.node.parentElement.closest
              && a.node.parentElement.closest('script, style'))
          } catch (_) {}
          if (!a || !b || inCode) { from = hit.index + hit[0].length; continue }
          var node = null
          try { node = build(hit) } catch (_) { node = null }
          if (node === 'remove') {
            if (!replaceRangeWithNode(a, b, document.createTextNode(''))) {
              from = hit.index + hit[0].length
              continue
            }
            from = 0
            done++
            continue
          }
          if (!node || !replaceRangeWithNode(a, b, node)) { from = hit.index + hit[0].length; continue }
          from = 0
          done++
        }
        return done
      }

      /**
       * `<details class="…"><summary>标题</summary><pre|div>正文</pre|div></details>`。
       * 正文一律用 `textContent` / `createTextNode`：这些内容来自模型，不该进 HTML 解析器。
       * @param {string} cls
       * @param {string} title
       * @param {string} text
       * @param {string} [bodyTag='pre']
       * @returns {Element}
       */
      function muvDetailsBlock(cls, title, text, bodyTag) {
        var box = document.createElement('details')
        box.className = cls
        var summary = document.createElement('summary')
        summary.textContent = title
        box.appendChild(summary)
        var body = document.createElement(bodyTag === 'div' ? 'div' : 'pre')
        body.textContent = String(text == null ? '' : text)
        box.appendChild(body)
        return box
      }

      /**
       * `<tag class="…">文本</tag>` 这种最简元素（内容走 textContent）。
       * @param {string} tag
       * @param {string} cls
       * @param {string} text
       * @returns {Element}
       */
      function muvSimpleBlock(tag, cls, text) {
        var el = document.createElement(tag)
        el.className = cls
        el.textContent = String(text == null ? '' : text)
        return el
      }

      /**
       * 原生路径要接的内联标签表 —— **与酒馆路径 `_tavernRenderTags` 对齐**
       * （那里的字符串版 + `verify-decorate-dom.mjs` 是行为基准）。
       *
       * 每条规则一种产出：
       *  - `{tag, cls}`         → 最简元素（内容走 textContent）
       *  - `{tag, cls, prefix}` → 前面加个图标字符
       *  - `{details, title}`   → 折叠卡
       *  - `{hr: true}`         → `hr.muv-sep`
       *  - `{remove: true}`     → 整段删掉（**内部块**，本来就不该给用户看）
       *
       * 做成表而不是逐条 `result.replace(...)`：两条路径的**集合**必须一致，
       * 而集合散在 40 行里一定会漂移（前两类就是这么教育我们的）。
       * @type {Array<object>}
       */
      var MUV_TAG_RULES = [
        { re: /<speech>([\s\S]*?)<\/speech>/gi, tag: 'div', cls: 'muv-speech' },
        { re: /<dialogue>([\s\S]*?)<\/dialogue>/gi, tag: 'div', cls: 'muv-dialogue' },
        { re: /<(?:引用|quote)>([\s\S]*?)<\/(?:引用|quote)>/gi, tag: 'blockquote', cls: 'muv-quote' },
        { re: /<(?:char|character)>([\s\S]*?)<\/(?:char|character)>/gi, tag: 'b', cls: 'muv-char-name' },
        { re: /<inner>([\s\S]*?)<\/inner>/gi, tag: 'div', cls: 'muv-inner' },
        { re: /<Drama>([\s\S]*?)<\/Drama>/gi, tag: 'div', cls: 'muv-drama' },
        { re: /<story>([\s\S]*?)<\/story>/gi, tag: 'div', cls: 'muv-story' },
        { re: /<narrative>([\s\S]*?)<\/narrative>/gi, tag: 'div', cls: 'muv-narrative' },
        { re: /<action>([\s\S]*?)<\/action>/gi, tag: 'div', cls: 'muv-action' },
        { re: /<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/gi, tag: 'div', cls: 'muv-thought', prefix: '💭 ' },
        { re: /<(?:feeling|emotion)>([\s\S]*?)<\/(?:feeling|emotion)>/gi, tag: 'span', cls: 'muv-feeling' },
        { re: /<expression>([\s\S]*?)<\/expression>/gi, tag: 'span', cls: 'muv-expression' },
        { re: /<(?:pose|posture)>([\s\S]*?)<\/(?:pose|posture)>/gi, tag: 'span', cls: 'muv-pose' },
        { re: /<(?:location|scene)>([\s\S]*?)<\/(?:location|scene)>/gi, tag: 'div', cls: 'muv-location', prefix: '📍 ' },
        { re: /<time>([\s\S]*?)<\/time>/gi, tag: 'span', cls: 'muv-time', prefix: '⏰ ' },
        { re: /<weather>([\s\S]*?)<\/weather>/gi, tag: 'span', cls: 'muv-weather', prefix: '🌤️ ' },
        { re: /<CG>([\s\S]*?)<\/CG>/gi, tag: 'div', cls: 'muv-cg', prefix: '🎨 ' },
        { re: /<(?:inventory|背包)>([\s\S]*?)<\/(?:inventory|背包)>/gi, details: 'muv-inventory', title: '🎒 背包' },
        { re: /<(?:skill|技能)>([\s\S]*?)<\/(?:skill|技能)>/gi, details: 'muv-skill', title: '⚔️ 技能' },
        { re: /<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi, details: 'muv-jsonpatch', title: '🔧 变量补丁' },
        { re: /<sep\s*\/?>|<hr\s*\/?>/gi, hr: true },
        // ↓ 内部块：删掉。原生路径原本把这些**原样显示**，等于把内部指令泄漏给用户。
        //   只删「整块配对」的形态；没有收尾标签的（如单独的 `<system>`）宁可留着，不误删正文。
        { re: /<rule_check>[\s\S]*?<\/rule_check>/gi, remove: true },
        { re: /<rule_\w+>[\s\S]*?<\/rule_\w+>/gi, remove: true },
        { re: /<dungeon_engine>[\s\S]*?<\/dungeon_engine>/gi, remove: true },
        { re: /<user_setting>[\s\S]*?<\/user_setting>/gi, remove: true },
        { re: /<system_prompt>[\s\S]*?<\/system_prompt>/gi, remove: true },
        { re: /<status_current_variable>[\s\S]*?<\/status_current_variable>/gi, remove: true },
        { re: /<Analysis>[\s\S]*?<\/Analysis>/gi, remove: true },
        { re: /<style[^>]*>[\s\S]*?<\/style>/gi, remove: true },
      ]

      /**
       * 卡牌专属「游戏标签」（苍玄界一类卡的 赏令 / 拍卖 / 盲盒 / 道友 / 飞剑 / 自由开局 …）。
       *
       * 酒馆路径 `_tavernRenderTags` 一直按卡字段渲染信息卡；原生路径此前**没有**，
       * 这批标签整段露成裸文本（verify-decorate-dom.mjs 的 G_gamecard 门禁钉的就是它，
       * HANDOFF §16.3 已知未覆盖第 1 条）。这里与酒馆路径同一份标签集合；配色不写在
       * 元素上，走 `exports.apply` 里已有的 `[data-card="…"]` 属性选择器（改色只动 CSS）。
       * @type {Array<{tag: string, icon: string}>}
       */
      var MUV_GAME_TAGS = [
        { tag: '赏令接取', icon: '📜' },
        { tag: '赏令完成', icon: '✅' },
        { tag: '拍卖购入', icon: '💰' },
        { tag: '盲盒开启', icon: '🎁' },
        { tag: '道友收录', icon: '👥' },
        { tag: '飞剑回信', icon: '📨' },
        { tag: '自由开局', icon: '🎲' },
      ]

      /**
       * `字段：值` 行解析（与酒馆路径同一口径：全/半角冒号都认，一行一条）。
       * 全部走 textContent / createTextNode——内容来自模型，不进 HTML 解析器。
       * @param {Element} card
       * @param {string} text
       * @returns {void}
       */
      function muvFillGameCardFields(card, text) {
        var lines = String(text == null ? '' : text).split(/\r?\n/)
        for (var i = 0; i < lines.length; i++) {
          var m = /^([^：:\r\n]+)[：:]\s*([^\r\n]+)$/.exec(lines[i].trim())
          if (!m) continue
          var row = document.createElement('div')
          row.className = 'muv-card-field'
          var b = document.createElement('b')
          b.textContent = m[1].trim()
          row.appendChild(b)
          row.appendChild(document.createTextNode(' ' + m[2].trim()))
          card.appendChild(row)
        }
      }

      /**
       * 原生路径的游戏卡渲染（G_gamecard）。
       *
       * 复用 `muvReplaceTagBlocks` 的三条纪律（跳过 script/style 里的同名文本、
       * 只动命中段、有收敛上限）；夹在媒体/插图之后、通用表之前跑都安全——
       * 这批标签名不在 `MUV_TAG_RULES` 里，两张表不会互相抢块。
       * @param {Element} root
       * @returns {number} 处理掉的卡数
       */
      function muvRenderGameCards(root) {
        var n = 0
        for (var i = 0; i < MUV_GAME_TAGS.length; i++) {
          (function (g) {
            var re = new RegExp('<' + g.tag + '>([\\s\\S]*?)<\\/' + g.tag + '>', 'gi')
            n += muvReplaceTagBlocks(root, re, function (hit) {
              var card = document.createElement('div')
              card.className = 'muv-game-card'
              card.setAttribute('data-card', g.tag)
              var title = document.createElement('div')
              title.className = 'muv-game-card-title'
              title.textContent = g.icon + ' ' + g.tag
              card.appendChild(title)
              muvFillGameCardFields(card, hit[1])
              return card
            })
          })(MUV_GAME_TAGS[i])
        }
        return n
      }

      /**
       * `<img src="…">` → 真图片（第三类之二）。
       *
       * 只认带 src 的；`alt` 保留，其余属性一律不要（`onerror` 之类同上白名单的考虑）。
       * 真图片元素在 DOM 里没有文本节点，所以只有**被转义成文本**的 `<img>` 会命中。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderImages(root) {
        return muvReplaceTagBlocks(root, /<img\s+[^>]*>/gi, function (hit) {
          var seg = String(hit[0] || '')
          var m = /(?:^|\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(seg)
          var srcValue = m ? (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])) : ''
          if (!srcValue) return null            // 没有 src 的不动它
          var alt = /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(seg)
          var img = document.createElement('img')
          img.className = 'muv-img'
          img.setAttribute('src', srcValue)
          img.setAttribute('loading', 'lazy')
          img.setAttribute('style', 'max-width:100%;border-radius:8px;margin:6px 0')
          if (alt) img.setAttribute('alt', alt[1] !== undefined ? alt[1] : alt[2])
          return img
        })
      }

      /**
       * 按表渲染全部内联标签（第三类之二/之三）。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderTagRules(root) {
        var n = 0
        n += muvRenderImages(root)
        // ★ 游戏卡先于通用表：标签集合不相交，但先处理"专属形态"再处理"通用形态"
        //   是两条路径共同的安全次序（酒馆路径同样是游戏卡在通用标签之前）。
        n += muvRenderGameCards(root)
        for (var i = 0; i < MUV_TAG_RULES.length; i++) {
          var rule = MUV_TAG_RULES[i]
          n += muvReplaceTagBlocks(root, rule.re, (function (r) {
            return function (hit) {
              if (r.remove) return 'remove'
              if (r.hr) {
                var hr = document.createElement('hr')
                hr.className = 'muv-sep'
                return hr
              }
              var text = String(hit[1] == null ? '' : hit[1]).trim()
              if (r.details) return muvDetailsBlock(r.details, r.title, text, 'pre')
              return muvSimpleBlock(r.tag || 'div', r.cls, (r.prefix || '') + text)
            }
          })(rule))
        }
        return n
      }

      /**
       * 变量块 / 推演块 / 摘要块的 DOM 渲染（第三类）。
       *
       * 原生路径上这些标签**一个渲染器都没有**（只有酒馆路径的 `_tavernRenderTags` 有），
       * 于是模型输出里那一大坨 `<UpdateVariable>{…JSON…}</UpdateVariable>` 就原样显示给用户。
       * 这里把它们收进折叠卡；`<Abstract>` 转成摘要条 —— 与酒馆路径同样的 class，
       * 样式共用，但**元素是手工搭的**（textContent），JSON 里的 `<img onerror>` 之类
       * 只会是文本。
       * @param {Element} root
       * @returns {number}
       */
      function muvRenderVariableBlocks(root) {
        var n = 0
        // ★ 元素形态 pass（先跑，2026-09-24 新增）。
        //
        //   泄漏机制实锤（tools/_probe-leak.mjs + 真机 session-7347d5f7）：DSH 把标签渲染成
        //   **真元素**时（§20.4 实测的两种形态之一，`<variableedit>` 小写元素），字面标签
        //   文本不在任何文本节点里 ⇒ 下面这些按**文本**匹配的正则永远打不中，
        //   `<UpdateVariable>` 里嵌的 `<Analysis>` 英文行与 `<JSONPatch>` 的 JSON 数组
        //   就以裸文本糊在正文里（实测 Edge 复现：varedit=0 / analysisLeak=1 / patchLeak=1）。
        //
        //   这里按**元素**再收一遍：外层整块折叠（内部嵌套的 Analysis/JSONPatch 随之消失）、
        //   残留的 Analysis 删除、JSONPatch 折叠 —— 与酒馆路径 `_tavernRenderTags` 的集合对齐
        //   （那里 5029 折 JSONPatch、5066 折变量块、5118 藏 Analysis）。内容一律 textContent。
        var els = []
        try { els = root.querySelectorAll('updatevariable, variableedit, variableinsert, variablethink, analysis, jsonpatch') } catch (_) { els = [] }
        for (var ei = 0; ei < els.length; ei++) {
          var el = els[ei]
          // 外层整块折叠后，内层的嵌套元素已随之摘除 —— 只处理仍挂在本根上的
          if (!el || !root.contains(el)) continue
          var etag = String(el.tagName || '').toLowerCase()
          var block = null
          if (etag === 'updatevariable' || etag === 'variableedit' || etag === 'variableinsert') {
            // 整块内容（含嵌套的 Analysis/JSONPatch 文本）收进折叠卡 —— 与文本形态的
            // "JSON 解析不出就原样展示"同一口径；标签名作为元素时不占文本，无需剔除
            block = muvDetailsBlock('muv-varedit', '🔧 变量更新', el.textContent, 'pre')
          } else if (etag === 'variablethink') {
            block = muvDetailsBlock('muv-varthink', '💭 变量推演', String(el.textContent || '').trim(), 'div')
          } else if (etag === 'jsonpatch') {
            block = muvDetailsBlock('muv-jsonpatch', '🔧 变量补丁', String(el.textContent || '').trim(), 'pre')
          } else if (etag === 'analysis') {
            block = 'remove' // 给模型的思考痕迹，不给用户看（与 MUV_TAG_RULES 的 remove 同语义）
          }
          if (!block) continue
          try {
            if (block === 'remove') el.parentNode.removeChild(el)
            else el.parentNode.replaceChild(block, el)
            n++
          } catch (_) {}
        }
        // 以下为文本形态 pass（DSH 把标签转义成 &lt;…&gt; 文本的另一种形态）—— 既有行为不动
        n += muvReplaceTagBlocks(root, /<(VariableEdit|VariableInsert|UpdateVariable)>([\s\S]*?)<\/\1>/gi, function (hit) {
          var raw = String(hit[2] || '').trim()
          var pretty = raw
          // 能解析成 JSON 就美化缩进（与酒馆路径一致），否则原样展示
          try { pretty = JSON.stringify(JSON.parse(raw), null, 2) } catch (_) {}
          return muvDetailsBlock('muv-varedit', '🔧 变量更新', pretty, 'pre')
        })
        n += muvReplaceTagBlocks(root, /<VariableThink>([\s\S]*?)<\/VariableThink>/gi, function (hit) {
          return muvDetailsBlock('muv-varthink', '💭 变量推演', String(hit[1] || '').trim(), 'div')
        })
        n += muvReplaceTagBlocks(root, /<Abstract>([\s\S]*?)<\/Abstract>/gi, function (hit) {
          var box = document.createElement('div')
          box.className = 'muv-abstract'
          var icon = document.createElement('span')
          icon.className = 'muv-abstract-icon'
          icon.textContent = '📖'
          box.appendChild(icon)
          box.appendChild(document.createTextNode(' ' + String(hit[1] || '').trim()))
          return box
        })
        return n
      }

      /**
       * 在「文本 + 映射」里定位一个字符位置。
       * 取「起点不晚于 pos 的最后一个文本节点」：pos 若落在合成的换行符上，会吸附到
       * 前一个文本节点的末尾（删除/插入的位置因此仍然正确）。
       * @param {Array<{node: Text, start: number}>} nodes
       * @param {number} pos
       * @returns {{node: Text, offset: number}|null}
       */
      function locateInWalked(nodes, pos) {
        for (var i = nodes.length - 1; i >= 0; i--) {
          if (pos >= nodes[i].start) {
            var len = (nodes[i].node.nodeValue || '').length
            return { node: nodes[i].node, offset: Math.min(pos - nodes[i].start, len) }
          }
        }
        return null
      }

      /**
       * 在**文本里**找一段 `<choices>…</choices>`，返回可做 Range 手术的位置。
       *
       * 与装饰器那边的 `findTextRange` 同源，但两者在不同作用域（那边在消息装饰的
       * 闭包里），所以这里自带一份最小实现 —— 并且比它多一件事：**识别换行**。
       * 等 markdown 分段补丁把装饰器也搬过来时再合并（那边同样需要这个换行感知，
       * 现在搬会动到已跑通的状态栏那条路，不划算）。
       * @param {Element} root
       * @returns {{startNode:Text, startOffset:number, endNode:Text, endOffset:number, content:string}|null}
       */
      function muvFindChoiceRange(root) {
        var walked = muvTextWithBreaks(root)
        var m = /<choices?>([\s\S]*?)<\/choices?>/i.exec(walked.text)
        if (!m) return null
        var a = locateInWalked(walked.map, m.index)
        var b = locateInWalked(walked.map, m.index + m[0].length)
        if (!a || !b || !a.node.parentNode || !b.node.parentNode) return null
        return { startNode: a.node, startOffset: a.offset, endNode: b.node, endOffset: b.offset, content: m[1] }
      }

      /**
       * 把 DOM 里的『📅…|⏰…|📍…』状态表头**折成一行**（markdown 第二类迁移）。
       *
       * 折叠本身是纯文本变换（见 normalizeStatusHeader：把括号内的换行换成空格、
       * 归一化 ` | `），完全不需要 `body.innerHTML = html` 那条路 —— 而那条路的输入是
       * `innerText`，会把整条消息的 markdown 抹掉。
       *
       * 折完之后 `normalizeStatusHeader(innerText) === innerText`，于是 `beautifyMuv`
       * 那一档会**原样返回**（不触发整条替换）⇒ markdown 保住、表头照旧折好。
       * 卫生 pass 的 MutationObserver 注册在装饰器之前（1687 vs 2591），两者的回调都走
       * rAF，按注册顺序执行 ⇒ 折叠总是先于装饰发生。
       *
       * 每次替换完重新 walk 一遍（Range 手术会拆/并文本节点，旧的映射会失效），
       * 只处理「第一个需要折」的块；折过的块再过一遍 normalizeStatusHeader 就是恒等，
       * 所以循环必然收敛（最多 8 轮兜底）。
       * @param {Element} root
       * @returns {number} 折掉的表头数量
       */
      function muvFoldStatusHeader(root) {
        if (!root || root.nodeType !== 1) return 0
        if (typeof normalizeStatusHeader !== 'function') return 0
        var done = 0
        for (var guard = 0; guard < 8; guard++) {
          var walked = muvTextWithBreaks(root)
          var re = /『([\s\S]*?)』/g
          var m = null, hit = null
          while ((m = re.exec(walked.text))) {
            if (normalizeStatusHeader(m[0]) !== m[0]) { hit = m; break }
          }
          if (!hit) break
          var a = locateInWalked(walked.map, hit.index)
          var b = locateInWalked(walked.map, hit.index + hit[0].length)
          if (!a || !b || !a.node.parentNode || !b.node.parentNode) break
          try {
            var range = document.createRange()
            range.setStart(a.node, a.offset)
            range.setEnd(b.node, b.offset)
            range.deleteContents()
            range.insertNode(document.createTextNode(normalizeStatusHeader(hit[0])))
          } catch (_) { break }
          done++
        }
        return done
      }

      /**
       * `<choices>…</choices>`（单复数都认）→ 选项按钮，**在 DOM 层完成**。
       *
       * 为什么必须有这份 DOM 实现：字符串层的 `replaceChoices()` 只有在调用方
       * `body.innerHTML = html` 整条写回时才生效，而那次写回用的是 `innerText`
       * （`**`/`##`/``` 已经被 DSH 渲染掉了）—— markdown 会被**永久**抹掉。
       * 在这里渲染则完全不动消息里已有的 `<strong>` / `<h2>` / `<pre><code>`：
       * 只把那一段 `<choices>` 文本换成按钮框。
       *
       * 循环处理是因为一条消息里可能有多个 `<choices>` 块（每次替换完重新扫）。
       * @param {Element} root
       * @returns {number} 换掉的选项块数量
       */
      function muvRenderChoices(root) {
        if (!root || root.nodeType !== 1) return 0
        var done = 0
        for (var guard = 0; guard < 20; guard++) {
          var hit = muvFindChoiceRange(root)
          if (!hit) break
          var opts = parseChoiceOptions(hit.content)
          try {
            var range = document.createRange()
            range.setStart(hit.startNode, hit.startOffset)
            range.setEnd(hit.endNode, hit.endOffset)
            range.deleteContents()
            if (opts.length) range.insertNode(muvBuildChoices(opts))
          } catch (_) {
            return done
          }
          done++
        }
        return done
      }

      function muvRenderOpts(root) {
        var cns = root.querySelectorAll('.tsit-char-name')
        for (var ci = 0; ci < cns.length; ci++) {
          var ne = cns[ci]
          if (ne.closest('.muv-choices') || ne.closest('.dshv-root')) continue
          if (!/^(行动选项|可选行动|请选择|选择|选项|行动)[:：]?\s*$/.test(ne.textContent.trim())) continue
          var ce = ne.closest('.tsit-char')
          if (!ce) continue
          // 跳过已被其他插件渲染过的（后面已有 .muv-choices 或 .dshv-root）
          var ns = ce.nextElementSibling
          if (ns && (ns.classList.contains('muv-choices') || ns.classList.contains('dshv-root'))) continue
          var opts = [], els = [], sib = ce.nextElementSibling
          while (sib && sib.classList.contains('tsit-char')) {
            var sn = sib.querySelector('.tsit-char-name')
            if (sn && /^\s*[-*•·]\s+/.test(sn.textContent)) {
              els.push(sib)
              var ot = muvStripOpt(sn.textContent.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
              if (ot) opts.push(ot)
            } else break
            sib = sib.nextElementSibling
          }
          if (opts.length < 2) continue
          var box = muvBuildChoices(opts)
          ce.style.display = 'none'
          els.forEach(function(e){e.style.display='none'})
          ce.insertAdjacentElement('afterend', box)
        }
