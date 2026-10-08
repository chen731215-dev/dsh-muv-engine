      // ── mod-card-render：卡片字段/块构造/选项样式（S2 段5 从工厂体内搬来，函数内容逐字未改） ──
      function muvSimpleBlock(tag, cls, text) {
        var el = document.createElement(tag)
        el.className = cls
        el.textContent = String(text == null ? '' : text)
        return el
      }

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
