
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
