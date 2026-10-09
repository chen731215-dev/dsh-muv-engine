    // ── mod-status-css：ensureStatusCss（档 B：**显式接线**；由 move-segment 生成）──
    /* wiring */
    const __wiring = {
      sbCss: () => MUV_SB_CSS,
    }
    function ensureStatusCss() {
      try {
        if (document.getElementById('muv-status-css')) return
        var s = document.createElement('style')
        s.id = 'muv-status-css'
        s.textContent = __wiring.sbCss()
        document.head.appendChild(s)
      } catch (_) {}
    }
