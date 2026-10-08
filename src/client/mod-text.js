      // ── mod-text：纯文本 / 围栏 / 标签扫描工具（S2 段1 从工厂体内搬来，函数内容逐字未改）──
    function splitArgs(src) {
      var out = [], buf = '', q = null
      for (var i = 0; i < src.length; i++) {
        var ch = src[i]
        if (q) { buf += ch; if (ch === q) q = null; continue }
        if (ch === '"' || ch === "'") { q = ch; buf += ch; continue }
        if (ch === ',') { out.push(buf); buf = ''; continue }
        buf += ch
      }
      if (buf.trim()) out.push(buf)
      return out.map(function (s) { return s.trim() })
    }

    function findClosingFence(source, from, minLen) {
      // 行首（≤3 空格缩进）+ 反引号串 + 行尾只剩空白
      var re = /^[ \t]{0,3}(`{3,})[ \t]*(?:\r?\n|$)/gm
      re.lastIndex = from
      var m
      while ((m = re.exec(source))) {
        if (m[1].length >= minLen) return { start: m.index, end: re.lastIndex }
      }
      return null
    }

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
