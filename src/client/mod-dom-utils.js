    // ── mod-dom-utils：DOM 小工具（S2 段3 从工厂体内搬来，函数内容逐字未改） ──
    function sizeFrame(frame) {
      try {
        var doc = frame.contentDocument;
        if (doc && doc.documentElement) {
          var h = Math.max(360, doc.documentElement.scrollHeight + 24);
          if (h > 1400) h = 1400;
          frame.style.height = h + 'px';
        }
      } catch (e) {}
    }

    function insertIntoInput(text) {
      var input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (!input) return false;
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        var value = input.value || '';
        input.value = value + (value ? '\n' : '') + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        input.textContent = (input.textContent || '') + '\n' + text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }

        function messageRootOf(bodyEl) {
          var node = bodyEl
          for (var up = 0; up < 4 && node && node.parentElement; up++) {
            var parent = node.parentElement
            // 兄弟节点明显多于一条消息 -> 说明 node 已经是单条消息，parent 是列表
            var siblings = parent.children ? parent.children.length : 0
            if (siblings > 1) break
            node = parent
          }
          return node || bodyEl
        }

        function muvIsVisibleInDom(el) {
          try {
            if (!el || !el.closest) return false
            if (el.closest('[style*="display: none"], [style*="display:none"], [hidden]')) return false
            if (el.getAttribute && el.getAttribute('data-streaming') !== null) return false
            var r = el.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) return false
            return true
          } catch (_) {
            // 判据自身出错时保守放行：宁可少美化，也不让整条链路不跑
            return true
          }
        }
