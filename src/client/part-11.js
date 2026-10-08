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
        var paras = root.querySelectorAll('p, div, li')
        for (var pi = 0; pi < paras.length; pi++) {
          var p = paras[pi]
          if (p.closest('.muv-choices') || p.closest('.tsit-char') || p.closest('.dshv-root')) continue
          var tm = p.textContent.trim().match(/^(行动选项|可选行动|请选择|选择|选项|行动)[:：]?\s*([\s\S]*)$/)
          if (!tm) continue
          var lists = [], oels = [], opts2 = []
          var rest = tm[2] ? tm[2].trim() : ''
          if (rest) rest.split(/\n|<br\s*\/?>/i).forEach(function(line){
            var r = muvStripOpt(line.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
            if (r && r.length > 1) opts2.push(r)
          })
          var nx = p.nextElementSibling
          while (nx && (nx.tagName==='UL'||nx.tagName==='OL'||(nx.tagName==='P'&&/^\s*[-*•·]\s+/.test(nx.textContent)))) {
            if (nx.tagName==='UL'||nx.tagName==='OL') {
              lists.push(nx)
              nx.querySelectorAll('li').forEach(function(li){ var o=muvStripOpt(li.textContent); if(o)opts2.push(o) })
            } else {
              oels.push(nx)
              var pt = muvStripOpt(nx.textContent.replace(/^\s*[-*•·]\s+/,'').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,''))
              if (pt) opts2.push(pt)
            }
            nx = nx.nextElementSibling
          }
          if (opts2.length < 2) continue
          var box2 = muvBuildChoices(opts2)
          p.style.display = 'none'
          lists.forEach(function(e){e.style.display='none'})
          oels.forEach(function(e){e.style.display='none'})
          p.insertAdjacentElement('afterend', box2)
        }
      }

      function muvStyleTavernOpts(root) {
        var groups = []
        if (root.classList && root.classList.contains('tavern-options')) groups.push(root)
        var found = root.querySelectorAll('.tavern-options')
        for (var fi = 0; fi < found.length; fi++) groups.push(found[fi])
        for (var gi = 0; gi < groups.length; gi++) {
          var group = groups[gi]
          if (group.hasAttribute('data-muv-styled')) continue
          group.setAttribute('data-muv-styled', '1')
          var btns = group.querySelectorAll('.tavern-option-btn')
          for (var bi = 0; bi < btns.length; bi++) {
            btns[bi].setAttribute('data-opt-letter', String.fromCharCode(65 + bi))
          }
        }
      }

      /**
       * 修复「模型把整段正文包进 <content>…</content> 原始信封」的段落塌陷
       * （2026-09-24 真机取证：会话 7347d5f7 的「凛原族…」楼，正文密一大片）。
       *
       * 三步对照的死点：
       *   ① 会话文件里的原始正文段间是 `\n\n`（该楼 34 处）—— 源头没丢；
       *   ② 装饰链走手术路径（状态栏 Range 插入）时 markdown DOM 原样保留 —— 也没丢；
       *   ③ 死在 DSH 原生 markdown：`<content>` 是未知标签，被当作**原生 HTML 块**
       *      整段透传（整个正文成了 `<CONTENT>` 元素里的一个文本节点），而该元素是
       *      `display:inline` + `white-space:normal` ⇒ HTML 空白折叠把 `\n\n`
       *      全部吃掉，段落间距全丢。
       *
       * 修法（最小、纯展示层）：给消息正文里这样的原始信封元素补
       * `display:block; white-space:pre-wrap` —— 换行与空行按原样显示（对齐用户
       * 手里「未渲染原生输出」的观感），**一个字都不改写**；不碰卡正则产物，也
       * 不碰变量管线自己的折叠卡（那些元素都带 muv- 类，走下面的 muv- 选择器排除；
       * 字面量与装饰模块的 MUV_OWN_SEL 保持一致 —— 那个常量在本模块不可见）。
       * ★ 清单（2026-09-23k 泛化）：`<content>` 之外收 `<now_plot>`（社区演出/
       *   剧情信封，形态同 content：整段正文包进原始标签）；**只收正文信封**，
       *   变量管线标签（UpdateVariable/VariableEdit/initvar/Abstract/era_data）
       *   显式跳过 —— 它们由各自管线渲染成折叠 UI，在这里补 block 化会砸坏管线。
       * 只对 markdown 形态的消息正文生效（面板/自有容器直接返回）。
       * @param {Element} root
       */
      var MUV_ENV_SEL = 'content, now_plot'
      var MUV_ENV_SKIP = { updatevariable: 1, variableedit: 1, initvar: 1, abstract: 1, era_data: 1 }

      function muvFixEnvelopeBlocks(root) {
        if (!root || root.nodeType !== 1) return
        var cls = root.className
        if (typeof cls !== 'string' || !MUV_BODY_RE.test(cls)) return
        var envs
        try { envs = root.querySelectorAll(MUV_ENV_SEL) } catch (_) { return }
        for (var i = 0; i < envs.length; i++) {
          var el = envs[i]
          try {
            if (MUV_ENV_SKIP[(el.tagName || '').toLowerCase()]) continue
            if (el.closest && el.closest('[class*="muv-"], iframe.muv-iframe, [data-muv-kv], [data-muv-inbox]')) continue
            if (el.hasAttribute('data-muv-env-fixed')) continue
            el.style.setProperty('display', 'block')
            el.style.setProperty('white-space', 'pre-wrap')
            el.setAttribute('data-muv-env-fixed', '1')
          } catch (_) {}
        }
      }

      /**
       * Run the tavern-cleanup pass over one element (or a whole document).
       *
       * Split out of `muvSanitize` so the message decorator can re-run it on a
       * single element after rewriting that element's HTML: the rewrite throws
       * away this pass's output (`<choices>` → buttons) while the
       * `data-muv-sanitized` mark prevents it from ever running again, which
       * silently deleted the 行动选项 buttons.
       * @param {Element} md
       */
      function muvSanitizeNode(md) {
        if (!md || md.nodeType !== 1) return
        if (md.hasAttribute(MUV_SAN_MARK) || md.closest('[contenteditable="true"]')) return
        md.setAttribute(MUV_SAN_MARK, '1')
        // 每一步各自 try：一类标记出错不该把**其它类**的渲染一起带走
        // （挤在同一个 try 里时，表头折叠抛一次异常，选项按钮就再也不出现了 ——
        //  这正是实测暴露出来的：探针少注入一个依赖，4 项断言同时红）。
        try { muvFixEnvelopeBlocks(md) } catch (e) { console.error('[muv-engine envelope]', e) }
        try { muvCleanText(md) } catch (e) { console.error('[muv-engine clean]', e) }
        try { muvFoldStatusHeader(md) } catch (e) { console.error('[muv-engine header]', e) }
        try { muvRenderOpts(md); muvStyleTavernOpts(md) } catch (e) { console.error('[muv-engine opts]', e) }
        try { muvRenderMediaTags(md) } catch (e) { console.error('[muv-engine media]', e) }
        try { muvRenderIllustrations(md) } catch (e) { console.error('[muv-engine illustration]', e) }
        try { muvRenderVariableBlocks(md) } catch (e) { console.error('[muv-engine varblocks]', e) }
        try { muvRenderTagRules(md) } catch (e) { console.error('[muv-engine tags]', e) }
        try { muvRenderChoices(md) } catch (e) { console.error('[muv-engine choices]', e) }
      }

      /**
       * Find the elements this pass should clean.
       *
       * Deliberately not a plain `[class*="_markdown"]` query. Two things go
       * wrong with a bare class match:
       *
       *  - DSH's body container is a CSS Modules name whose hash changes every
       *    time the Web bundle is rebuilt (`Sxvs8a_root` → `_markdown_kcgor_5`).
       *    A hard-coded hash stops matching after an upgrade and the whole
       *    chain goes quiet with no error on the page.
       *  - `_markdown_*` is *also* used by the file-type icon module, so the
       *    class alone matches elements that are not messages at all.
       *
       * So match the shape (`_markdown_<hash>_<n>`) and then require rendered
       * block children, which the icon does not have. Same two rules the tavern
       * client uses, so both plugins agree on what a message is.
       * @returns {Element[]}
       */
      var MUV_BODY_RE = /_markdown_[a-z0-9]+_\d+/i
      var MUV_BLOCK_RE = /_[a-zA-Z]+_[a-z0-9]+_\d+/

      function isMuvMessageBody(el) {
        if (!el || el.nodeType !== 1) return false
        var cls = el.className
        if (typeof cls !== 'string' || !cls) return false
        if (!MUV_BODY_RE.test(cls)) return false
        try {
          // ★ `content`/`now_plot`（2026-09-24 / 2026-09-23k）：模型把整段正文包进
          //   原始信封（`<content>…</content>` 或 `<now_plot>…</now_plot>`）时，
          //   DSH 的 markdown 把它当原生 HTML 块透传 ⇒ 正文里没有任何
          //   p/pre/ul… 块级子元素，本判据会把整楼拒掉 ⇒ sanitize 链（含
          //   muvFixEnvelopeBlocks 的段落塌陷修复）永不运行。见该函数的长注释
          //   与其 MUV_ENV_SEL 清单（两处清单保持同步）。
          return !!el.querySelector('p, pre, ul, ol, blockquote, table, h1, h2, h3, content, now_plot')
        } catch (_) { return false }
      }

      function muvSanitizeTargets() {
        var out = []
        try {
          var byShape = document.querySelectorAll('[class*="_markdown_"]')
          for (var i = 0; i < byShape.length; i++) if (isMuvMessageBody(byShape[i])) out.push(byShape[i])
        } catch (_) {}
        if (!out.length) {
          // Fallback: any CSS-Modules-shaped class that contains block content.
          try {
            var all = document.querySelectorAll('[class]')
            for (var j = 0; j < all.length; j++) {
              var el = all[j]
              var cls = el.className
              if (typeof cls !== 'string' || !MUV_BLOCK_RE.test(cls)) continue
              try { if (el.querySelector('p, pre, ul, ol, blockquote, table')) out.push(el) } catch (_) {}
            }
          } catch (_) {}
        }
        // Plugin-owned containers keep their explicit hooks.
        try {
          var owned = document.querySelectorAll('[class*="tavern-"], [class*="dsh-tv"], [class*="muv-"]')
          for (var k = 0; k < owned.length; k++) out.push(owned[k])
        } catch (_) {}
        // Explicit role markers: older DSH builds and other shells do not use
        // CSS Modules at all (`Sxvs8a_root`), so neither shape rule above can
        // see them. The tavern client carries the same fallback.
        try {
          var legacy = document.querySelectorAll('[data-role="assistant"], .assistant-message, .chat-message.assistant')
          for (var L = 0; L < legacy.length; L++) out.push(legacy[L])
        } catch (_) {}
        return out
      }

      function muvSanitize() {
        var mds = muvSanitizeTargets()
        for (var i = 0; i < mds.length; i++) muvSanitizeNode(mds[i])
      }

      muvSanitize()
      var _muvSanRaf = 0
      var _muvSanObs = new MutationObserver(function(){
        if (_muvSanRaf) return
        _muvSanRaf = window.requestAnimationFrame(function(){ _muvSanRaf = 0; muvSanitize() })
      })
      _muvSanObs.observe(document.body, { childList: true, subtree: true })

      // ★★★ dsh-visual-render 代码块渲染（visual/options/aside/scene）★★★
      ;(function() {
    var LANG_RE = /^(visual|dsh-html|vhtml)$/i;
    var OPTIONS_LANG_RE = /^options$/i;
    var ASIDE_LANG_RE = /^(aside|narration|narrador)$/i;
    var SCENE_LANG_RE = /^(scene|juqing|drama|剧本|场景)$/i;
    var MARK = 'data-dshv-processed';

    // ★ 与 `.muv-statusbar-wrap` 同一类塌陷，同一套撑满声明（`.dshv-frame` 里也是 `width:100%`）。
    //   visual 帧会落在聊天消息里（同样是"由内容决定宽度"的容器），不显式撑满会塌成 300px。
    var UI_CSS = `.dshv-root{display:block;width:100%;min-width:0;align-self:stretch;box-sizing:border-box;margin:12px 0;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.2));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));backdrop-filter:blur(8px);}
.dshv-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));border-bottom:1px solid var(--dsw-alias-border, rgba(127,127,127,.15));font-size:12.5px;}
.dshv-label{font-weight:600;color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));margin-right:auto;letter-spacing:.3px;}
.dshv-btn{border:1px solid var(--dsw-alias-border, rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-primary, inherit);border-radius:6px;padding:3px 10px;font-size:11px;line-height:1.5;cursor:pointer;font-family:inherit;transition:all .15s ease;}
.dshv-btn:hover{background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12));}
.dshv-body{background:transparent;color:var(--dsw-alias-label-primary, inherit);}
.dshv-frame{width:100%;min-height:360px;border:0;display:block;}
.dshv-options{display:flex;flex-direction:column;gap:8px;padding:14px;}
.dshv-opt{text-align:left;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.12));color:var(--dsw-alias-label-primary, inherit);border-radius:10px;padding:10px 14px 10px 40px;font-size:13.5px;cursor:pointer;line-height:1.6;font-family:inherit;position:relative;transition:all .18s cubic-bezier(.4,0,.2,1);word-break:break-word;}
.dshv-opt::before{content:attr(data-idx);position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15));color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all .18s ease;}
.dshv-opt:hover{border-color:rgba(59,127,240,.5);background:var(--dsw-alias-bg-layer-2, rgba(59,127,240,.06));transform:translateX(3px);box-shadow:0 2px 12px rgba(59,127,240,.12);}
.dshv-opt:hover::before{background:#3b7ff0;color:#fff;}
.dshv-opt[data-dshv-picked]{border-color:#3b7ff0;background:rgba(59,127,240,.1);box-shadow:0 0 0 3px rgba(59,127,240,.12);}
.dshv-opt[data-dshv-picked]::before{background:#3b7ff0;color:#fff;content:"✓";}
.dshv-opt-status{padding:2px 4px 0;font-size:12px;color:var(--dsw-alias-label-tertiary, rgba(127,127,127,.55));}
.dshv-aside{padding:6px 12px;font-size:11.5px;line-height:1.7;font-style:italic;color:var(--dsw-alias-label-tertiary,#9aa3b2);opacity:.72;border-left:2px solid var(--dsw-alias-border, rgba(127,127,127,.22));white-space:pre-line;}
html body [class*="tavern" i],html body [class*="agent-preset" i],html body [class*="style" i],html body [class*="skin" i],html body [class*="theme" i]{position:static !important;transform:none !important;left:auto !important;top:auto !important;margin:initial !important;max-height:none !important;overflow-y:visible !important;}
/* 上面两块（入口 / hover / 选中）原来是硬编码的深色壳 + 浅色字：
   color:#e8ecf4 + background:rgba(22,27,38,.5)、hover 的 color:#ffffff。
   浅色主题下侧栏底色是 rgb(249,250,251) ⇒ 浅色字压在浅底上，实测对比度 1.06:1
   （工具 dsh-live23「浅色·首页侧栏」），等于看不见。改成 DSH 主题变量：
   两个主题都跟随宿主，观感也和宿主自己的侧栏一致。 */
html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry],html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry],html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry],html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision],html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern],html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry],html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry],html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry{color:var(--dsw-alias-label-primary) !important;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)) !important;border-radius:8px !important;}html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry]:hover,html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern]:hover,html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry]:hover,html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry]:hover,html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry:hover,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry:hover{color:var(--dsw-alias-label-primary) !important;background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18)) !important;}html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry[data-active],html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry[data-active]{color:var(--dsw-alias-label-primary) !important;background:rgba(59,127,240,.38) !important;}
html body [data-dsh-tavern-manager-entry]{display:none !important;}
html body [data-dsh-style-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:132px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
html body [data-dsh-vr-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:144px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
/* ★ 第 40 轮：原来是 color:#1f2329 !important（深灰近黑）——深色模式下宿主面板底色是
   rgb(44,44,46)，实测对比度 1.14:1，设置导航十个条目在深色模式下几乎不可见（用户第一
   优先级报的就是这个）。改成 DSH 主题变量：浅色里深灰、深色里自动变浅灰/白，两个主题
   都可读。opacity:1 / text-shadow:none 是当初为了压住宿主自带的半透明与阴影，保留。 */
.VOzbGW_navCell,.VOzbGW_navTitle,.VOzbGW_navLabel,.VOzbGW_navIcon{color:var(--dsw-alias-label-secondary,#1f2329) !important;opacity:1 !important;text-shadow:none !important;}
.VOzbGW_navCell.VOzbGW_active{color:var(--dsw-alias-label-primary,#ffffff) !important;}
.dshv-root.dshv-scene .dshv-sc-body{background:linear-gradient(180deg,#fbf6ee,#f3ead8);color:#3a2f1d;padding:16px 18px;}
.dshv-root.dshv-scene .dshv-sc-title{font-size:17px;font-weight:700;margin-bottom:10px;color:#5b3a12;letter-spacing:1px;}
.dshv-root.dshv-scene .dshv-sc-p{font-size:14px;line-height:1.9;margin:0 0 6px;text-indent:2em;}
.dshv-root.dshv-scene .dshv-sc-pad{height:8px;}
.dshv-root.dshv-scene .dshv-sc-item{font-size:13.5px;color:#6b5633;margin:0 0 5px;padding-left:12px;border-left:2px solid #c5a468;}
.dshv-root.dshv-scene .dshv-sc-line{display:flex;gap:8px;margin:4px 0;}
.dshv-root.dshv-scene .dshv-sc-who{flex:none;font-weight:700;color:#8a4b2a;min-width:56px;}
.dshv-root.dshv-scene .dshv-sc-say{flex:1;color:#3a2f1d;line-height:1.7;}
button.Kad6XG_iconButton{width:26px !important;height:26px !important;color:#3b7ff0 !important;background:rgba(59,127,240,.12) !important;border:1px solid rgba(59,127,240,.4) !important;border-radius:6px !important;opacity:1 !important;pointer-events:auto !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;}
button.Kad6XG_iconButton:hover{color:#fff !important;background:#3b7ff0 !important;}
button.Kad6XG_iconButton svg{width:16px !important;height:16px !important;fill:currentColor !important;}
.nFunOq_iconButton,.nFunOq_rerollButton{color:#3b7ff0 !important;opacity:1 !important;border-color:rgba(59,127,240,.5) !important;background:rgba(59,127,240,.1) !important;}
.nFunOq_iconButton:hover,.nFunOq_rerollButton:hover{color:#fff !important;background:#3b7ff0 !important;}
/* ★ 第 40 轮：原来这一行把侧栏的 --dsw-alias-label-* 全部 !important 重写成浅蓝
   系（#dbe4f7 / #c6d1e9 / …），再给容器上 color:#dbe4f7 !important。那是**照着深色
   侧栏调**的，浅色主题下侧栏底色是 rgb(249,250,251)，浅蓝字压浅底 = 实测对比度
   1.06:1（dsh-live23「浅色·首页侧栏」）。DSH 自己在深色下给侧栏的就是
   --dsw-alias-label-primary（实测 rgb(249,250,251)，比我们这条更亮），所以**直接
   去掉重写**、让宿主变量生效即可 —— 两个主题都跟宿主，观感也统一。 */
html body [data-pane="sidebar"][data-pane="sidebar"] button,html body [data-pane="sidebar"][data-pane="sidebar"] button span,html body [data-pane="sidebar"][data-pane="sidebar"] button svg,html body [data-pane="sidebar"][data-pane="sidebar"] [role="button"] svg{color:var(--dsw-alias-label-primary) !important;fill:currentColor !important;opacity:1 !important;text-shadow:none !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] button:hover,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover span,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover svg{color:var(--dsw-alias-label-primary) !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] .hHd-Xa_iconButton.hHd-Xa_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_iconButton.qDHVXG_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_searchButton.qDHVXG_searchButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_headerActions.qDHVXG_headerActions,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_sectionLabel.qDHVXG_sectionLabel{color:var(--dsw-alias-label-secondary) !important;fill:currentColor !important;background:transparent !important;border-color:transparent !important;}
`;


    var LIB_CSS = `*{box-sizing:border-box;}
body{margin:0;padding:18px;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#23272e;background:#f2f4f7;}
.browser{width:100%;max-width:860px;margin:0 auto;border-radius:10px;overflow:hidden;background:#fff;color:#23272e;box-shadow:0 12px 32px rgba(0,0,0,.18);}
.browser-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#e8eaee;border-bottom:1px solid #d5d8dd;}
.dot{width:12px;height:12px;border-radius:50%;flex:none;}
.dot.red{background:#ff5f57;}.dot.yellow{background:#febc2e;}.dot.green{background:#28c840;}
.address{flex:1;display:flex;align-items:center;gap:6px;background:#fff;border-radius:6px;padding:5px 10px;font-size:13px;color:#555b66;margin-left:6px;}
.nav{display:flex;align-items:center;gap:22px;padding:12px 28px;border-bottom:1px solid #edeff2;font-size:14px;}
.nav .logo{font-weight:700;color:#1456cc;margin-right:auto;}
.nav a{color:#4a5160;text-decoration:none;}
.hero{padding:44px 28px;background:linear-gradient(135deg,#1456cc,#3b7ff0 60%,#6ea8ff);color:#fff;}
.hero h1{margin:0 0 10px;font-size:30px;}
.hero p{margin:0 0 18px;font-size:14px;opacity:.9;}
.hero button{border:0;background:#fff;color:#1456cc;font-size:14px;padding:9px 22px;border-radius:20px;cursor:pointer;}
.content-grid{display:grid;grid-template-columns:1fr 260px;gap:24px;padding:24px 28px 30px;}
.article h3{margin:0 0 10px;font-size:18px;}
.article p{font-size:14px;line-height:1.9;color:#3c434e;margin:0;}
.sidebar{background:#f5f7fa;border-radius:8px;padding:14px 16px;}
.sidebar h4{margin:0 0 10px;font-size:13px;color:#1456cc;}
.sidebar ul{margin:0;padding-left:18px;font-size:13px;color:#4a5160;line-height:2;}
.footer{padding:14px 28px;border-top:1px solid #edeff2;font-size:12px;color:#8b93a1;text-align:center;}
.phone{width:100%;max-width:380px;margin:0 auto;background:#0f1115;border-radius:30px;padding:10px 8px 14px;box-shadow:0 12px 32px rgba(0,0,0,.25),inset 0 0 0 2px #000;}
.screen{background:#f4f5f7;border-radius:22px;overflow:hidden;color:#23272e;}
.statusbar{display:flex;justify-content:space-between;padding:8px 18px 4px;font-size:12px;}
.chat-head{display:flex;align-items:center;gap:10px;padding:8px 14px 10px;border-bottom:1px solid #e6e8ec;background:#fff;}
.back{border:0;background:transparent;font-size:22px;line-height:1;color:#23272e;cursor:pointer;padding:0;}
.chat-title{font-weight:600;font-size:15px;}
.chat-head .more{margin-left:auto;color:#8b93a1;font-size:14px;letter-spacing:2px;}
.chat-body{display:flex;flex-direction:column;gap:10px;padding:18px 14px;min-height:240px;}
.bubble{max-width:78%;padding:9px 13px;font-size:14px;line-height:1.6;border-radius:10px;}
.bubble.left{align-self:flex-start;background:#fff;border-top-left-radius:3px;}
.bubble.right{align-self:flex-end;background:#95ec69;border-top-right-radius:3px;}
.chat-time{text-align:center;font-size:11px;color:#9aa3b2;}
.chat-input{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e6e8ec;}
.chat-input .plus{font-size:22px;color:#4a5160;}
.chat-input .field{flex:1;background:#f4f5f7;border-radius:6px;padding:7px 10px;font-size:13px;color:#9aa3b2;}
.chat-input .send{border:0;background:#07c160;color:#fff;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;}
.terminal{width:100%;max-width:720px;margin:0 auto;background:#050806;border:1px solid #1d2b1f;border-radius:8px;padding:20px 22px;font-family:Consolas,"Courier New",monospace;font-size:14px;line-height:1.9;color:#33ff66;text-shadow:0 0 6px rgba(51,255,102,.6);box-shadow:0 0 32px rgba(51,255,102,.1),inset 0 0 60px rgba(51,255,102,.04);white-space:pre-wrap;word-break:break-all;}
.terminal.amber{color:#ffb000;text-shadow:0 0 6px rgba(255,176,0,.6);box-shadow:0 0 32px rgba(255,176,0,.12),inset 0 0 60px rgba(255,176,0,.04);}
.cursor{animation:dshv-blink 1s steps(2,start) infinite;}
@keyframes dshv-blink{to{visibility:hidden;}}
.letter{width:100%;max-width:560px;margin:0 auto;position:relative;padding:46px 52px 88px;font-family:"Kaiti SC","STKaiti","KaiTi","SimSun",serif;color:#3a3226;background:radial-gradient(120% 90% at 18% 0%,rgba(160,120,60,.1),transparent 55%),radial-gradient(120% 90% at 82% 100%,rgba(160,120,60,.12),transparent 55%),linear-gradient(180deg,#f8f1df,#f2e7cc);border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.2),0 16px 40px rgba(0,0,0,.25);}
.letter::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(96,74,40,.12);transform:translateX(-50%) rotate(1.5deg);}
.letter-head{text-align:right;font-size:13px;color:#6d5f45;margin-bottom:26px;letter-spacing:1px;}
.letter .salutation{font-size:18px;margin:0 0 14px;}
.letter .body-p{font-size:16px;line-height:2.1;text-indent:2em;margin:0 0 10px;text-shadow:0 0 2px rgba(0,0,0,.45);}
.letter .sign{text-align:right;margin-top:34px;font-size:17px;letter-spacing:2px;padding-right:96px;}
.letter .ps{margin-top:30px;padding-top:12px;padding-right:110px;border-top:1px dashed rgba(96,74,40,.35);font-size:14px;color:#6d5f45;}
.seal{position:absolute;right:34px;bottom:36px;width:78px;height:78px;border-radius:50%;border:3px solid rgba(178,34,34,.72);color:rgba(178,34,34,.85);display:flex;align-items:center;justify-content:center;font-size:34px;transform:rotate(-12deg);box-shadow:inset 0 0 6px rgba(178,34,34,.25);}
.newspaper{width:100%;max-width:760px;margin:0 auto;background:#e9e4d1;color:#26221a;border:2px solid #b6ad93;padding:26px 30px 32px;box-shadow:0 16px 40px rgba(0,0,0,.25);font-family:"Songti SC","STSong","SimSun",serif;}
.masthead{text-align:center;}
.masthead h1{margin:0 0 8px;font-size:44px;letter-spacing:10px;font-weight:900;}
.dateline{font-size:12px;letter-spacing:3px;border-top:3px double #26221a;border-bottom:1px solid #26221a;padding:5px 0;margin-bottom:18px;}
.news-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:18px;}
.news-grid article{font-size:13px;line-height:1.9;}
.news-grid article+article{border-left:1px solid #b6ad93;padding-left:18px;}
.news-grid h2{font-size:19px;line-height:1.5;margin:0 0 8px;}
.news-grid .lead h2{font-size:26px;}
.news-grid p{text-indent:2em;margin:0 0 8px;}
.news-grid .byline{font-size:11px;color:#6d6450;text-indent:0;letter-spacing:1px;}
@media (max-width:640px){.content-grid{grid-template-columns:1fr;}.news-grid{grid-template-columns:1fr;}.news-grid article+article{border-left:0;border-top:1px solid #b6ad93;padding-left:0;padding-top:14px;}}`;

    var uiInjected = false;
    function injectUiCss() {
      if (uiInjected) return;
      if (document.querySelector('style[data-plugin-css="dsh-visual-render-ui"]')) { uiInjected = true; return; }
      var tag = document.createElement('style');
      tag.dataset.pluginCss = 'dsh-visual-render-ui';
      tag.textContent = UI_CSS;
      document.head.appendChild(tag);
      uiInjected = true;
    }

    function renderDoc(source) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">' +
        '<style>' + LIB_CSS + '</style></head><body>' + source + '</body></html>';
    }

    function langOf(block) {
      var wrap = block.firstElementChild;
      if (!wrap) return '';
      var banner = wrap.firstElementChild;
      if (!banner) return '';
      var info = banner.firstElementChild;
      if (!info) return '';
      var text = (info.textContent || '').trim();
      return text.split(/\s+/)[0] || '';
    }

    function codeTextOf(block) {
      var pre = block.querySelector('pre');
      return pre ? pre.textContent : '';
    }

    function makeButton(label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dshv-btn';
      btn.textContent = label;
      return btn;
    }

