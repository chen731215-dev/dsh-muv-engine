// dsh-muv-engine client: auto regex + iframe status bar rendering
window.__ModuleLoader__.load({
  id: 'dsh-muv-engine',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Cache for card data (loaded once)
    let cardCache = null

    /**
     * Load card data from the MUV directory.
     * @param {string} cardName - Name of the card to load
     */
    async function loadCard(cardName) {
      if (cardCache && cardCache.name === cardName) return cardCache
      try {
        const r = await fetch('/api/muv-table/tavern-card')
        const d = await r.json()
        if (d.ok && d.name) {
          cardCache = d
          return d
        }
      } catch (_) {}
      return null
    }

    /**
     * Apply regex scripts to text and render status bar iframes.
     * @param {string} text - LLM output text
     * @returns {Promise<string>} Transformed HTML
     */
    async function beautifyMuv(text) {
      if (!text) return text
      // Check if text contains MUV tags
      if (!/<StatusPlaceHolder|<UpdateVariable|<Prism|<StatusBlock|<maintext/i.test(text)) return text

      try {
        // Get card data for regex scripts
        let cardJson = null
        try {
          const r = await fetch('/api/muv-table/tavern-card')
          const d = await r.json()
          if (d.ok && d.zodSource) cardJson = d
        } catch (_) {}

        if (cardJson) {
          // Apply regex scripts
          const r = await fetch('/api/muv-engine/apply-regex-card', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, cardJson })
          })
          const d = await r.json()
          if (d.ok) {
            let result = d.text
            // Render status bar iframe if HTML is available
            if (d.statusBarHtml) {
              const id = 'muv-statusbar-' + Math.random().toString(36).slice(2, 8)
              result = result.replace(/<StatusPlaceHolderImpl\s*\/>/gi,
                '<div class="muv-statusbar-wrap"><iframe id="'+id+'" class="muv-iframe" srcdoc="'+escAttr(d.statusBarHtml)+'" sandbox="allow-scripts" style="width:100%;height:600px;border:none;border-radius:8px;background:transparent"></iframe></div>')
            }
            return result
          }
        }
      } catch (_) {}

      return text
    }

    function escAttr(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    }

    // Expose beautify function globally for the tavern renderer to use
    if (typeof window !== 'undefined') {
      window.MuvEngine = { beautify: beautifyMuv }
    }

    exports.inject = []
    exports.apply = function () {
      // Inject CSS
      const style = document.createElement('style')
      style.textContent = '.muv-statusbar-wrap{margin:10px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.muv-iframe{display:block}'
      document.head.appendChild(style)
      return () => style.remove()
    }

    return module.exports
  }
})