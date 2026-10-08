        // ── mod-text-parse：纯文本/HTML 解析与转义（S2 段4 从工厂体内搬来，函数内容逐字未改） ──
        function muvIsPageSourceText(text) {
          var s = String(text == null ? '' : text)
          if (s.length < 200) return false
          if (s.indexOf('__muvReset') !== -1) return true
          var doctype = /<!doctype\s+html/i.test(s)
          var html = /<html[\s>]/i.test(s)
          var head = /<head[\s>]/i.test(s)
          var bodyT = /<body[\s>]/i.test(s)
          if (doctype && (html || head || bodyT)) return true
          if (head && bodyT) return true
          return false
        }

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

        function muvRegExpEscape(s) {
          return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
        }

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
