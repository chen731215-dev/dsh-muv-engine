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

    // ★ 客户端宏展开：{[random::]} / {[pick::]} / {[roll::]}
    var _pickCache = {};
    function _expandMacros(text) {
      if (!text) return text;
      var result = text;
      // random: {[random::opt1::opt2::...]}
      result = result.replace(/\{\[random::([\s\S]*?)\]\}/g, function(_, options) {
        var opts = options.split('::').map(function(s) { return s.trim(); }).filter(Boolean);
        if (opts.length === 0) return '';
        return opts[Math.floor(Math.random() * opts.length)];
      });
      // pick: {[pick::cacheKey::opt1::opt2::...]}
      result = result.replace(/\{\[pick::([^:]+)::([\s\S]*?)\]\}/g, function(_, key, options) {
        var cacheKey = 'pick_' + key.trim();
        if (_pickCache.hasOwnProperty(cacheKey)) return _pickCache[cacheKey];
        var opts = options.split('::').map(function(s) { return s.trim(); }).filter(Boolean);
        if (opts.length === 0) return '';
        var picked = opts[Math.floor(Math.random() * opts.length)];
        _pickCache[cacheKey] = picked;
        return picked;
      });
      // roll: {[roll::NdM]} 或 {[roll::NdM+K]}
      result = result.replace(/\{\[roll::(\d+)d(\d+)(?:([+-])\s*(\d+))?\]\}/g, function(_, n, m, op, mod) {
        var count = parseInt(n, 10) || 1;
        var sides = parseInt(m, 10) || 6;
        var total = 0;
        for (var i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
        if (op && mod) {
          total = op === '+' ? total + parseInt(mod,10) : total - parseInt(mod,10);
        }
        return String(total);
      });
      return result;
    }
    // 全局暴露：reroll pick
    window._tavernRerollPick = function(key) {
      var cacheKey = 'pick_' + key;
      delete _pickCache[cacheKey];
    };
    window._tavernListPicks = function() {
      var entries = [];
      for (var k in _pickCache) {
        if (_pickCache.hasOwnProperty(k) && k.indexOf('pick_') === 0) {
          entries.push({ key: k.replace(/^pick_/, ''), value: _pickCache[k] });
        }
      }
      return entries;
    };
    window._tavernExpandMacros = _expandMacros;

    // Expose beautify function globally for the tavern renderer to use
    if (typeof window !== 'undefined') {
      window.MuvEngine = { beautify: beautifyMuv, expandMacros: _expandMacros }

      // ★ 轻量 LaTeX 渲染
      if (!window._tavernLatexInstalled) {
        window._tavernLatexInstalled = true
        window._tavernRenderLatex = function(text) {
          if (!text || text.indexOf('\\(') === -1) return text
          return text.replace(/\\\(([\s\S]*?)\\\)/g, function(_, latex) {
            var html = latex
              .replace(/\\scalebox\{[^}]*\}\{/g, '').replace(/\}\s*$/g, '')
              .replace(/\\begin\{array\}\{[^}]*\}/g, '').replace(/\\end\{array\}/g, '')
              .replace(/\\fcolorbox\{([^}]*)\}\{([^}]*)\}\{/g, function(_, border, bg) {
                return '<div style="border:2px solid '+border+';background:'+bg+';border-radius:6px;padding:8px 10px;margin:6px 0">'
              })
              .replace(/\\colorbox\{([^}]*)\}\{([^}]*)\}/g, function(_, color, content) {
                return '<span style="background:'+color+';padding:2px 8px;border-radius:4px;display:inline-block">'+content+'</span>'
              })
              .replace(/\\textcolor\{([^}]*)\}\{([^}]*)\}/g, function(_, color, content) {
                return '<span style="color:'+color+'">'+content+'</span>'
              })
              .replace(/\\rule\{([^}]*)\}\{([^}]*)\}/g, function(_, w, h) {
                return '<span style="display:inline-block;width:'+w+';height:'+h+';background:currentColor;border-radius:2px;vertical-align:middle"></span>'
              })
              .replace(/\\overline\{[^}]*\}/g, '<hr style="border:none;border-top:1px solid #c9a45c;margin:4px 0">')
              .replace(/\\Large\s/g, '<span style="font-size:18px">').replace(/\\large\s/g, '<span style="font-size:16px">').replace(/\\footnotesize\s/g, '<span style="font-size:11px">')
              .replace(/\\quad/g, ' &nbsp; ').replace(/\\textbf\{([^}]*)\}/g, '<b>$1</b>').replace(/\\bullet/g, '•')
              .replace(/\\\\/g, '<br>').replace(/[\{\}]/g, '')
            var opens = (html.match(/<div/g)||[]).length - (html.match(/<\/div>/g)||[]).length
            var openSp = (html.match(/<span/g)||[]).length - (html.match(/<\/span>/g)||[]).length
            while (opens-- > 0) html += '</div>'
            while (openSp-- > 0) html += '</span>'
            return '<div class="muv-latex-block">'+html+'</div>'
          })
        }

        // ★ 通用标签渲染器：纯字符串替换，零性能开销
        window._tavernRenderTags = function(text) {
          if (!text) return text
          // 首先展开宏（{[random::]}, {[pick::]}, {[roll::]}）
          var result = _expandMacros(text)
          // <插图> → 图片占位（CG 画廊）
          result = result.replace(/<插图>([\s\S]*?)<\/插图>/gi, function(_, name) {
            return '<div class="muv-illustration"><span class="muv-illustration-icon">🖼️</span> '+escHtml(name.trim())+'</div>'
          })
          // <JSONPatch> → 折叠变量更新
          result = result.replace(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi, function(_, content) {
            return '<details class="muv-jsonpatch"><summary>🔧 变量补丁</summary><pre>'+escHtml(content.trim())+'</pre></details>'
          })
          // <speech> / <dialogue> → 对话样式
          result = result.replace(/<speech>([\s\S]*?)<\/speech>/gi, '<div class="muv-speech">$1</div>')
          result = result.replace(/<dialogue>([\s\S]*?)<\/dialogue>/gi, '<div class="muv-dialogue">$1</div>')
          // <rule_check> / <rule_*> → 隐藏
          result = result.replace(/<rule_check>[\s\S]*?<\/rule_check>/gi, '')
          result = result.replace(/<rule_\w+>[\s\S]*?<\/rule_\w+>/gi, '')
          // <dungeon_engine> → 隐藏
          result = result.replace(/<dungeon_engine>[\s\S]*?<\/dungeon_engine>/gi, '')
          // <user_setting> → 隐藏
          result = result.replace(/<user_setting>[\s\S]*?<\/user_setting>/gi, '')
          // <status_current_variable> → 隐藏（变量状态在 MUV 面板里看）
          result = result.replace(/<status_current_variable>[\s\S]*?<\/status_current_variable>/gi, '')
          // <system> / <system_prompt> → 隐藏
          result = result.replace(/<system_prompt>[\s\S]*?<\/system_prompt>/gi, '')
          // <引用> / <quote> → 引用块
          result = result.replace(/<引用>([\s\S]*?)<\/引用>/gi, '<blockquote class="muv-quote">$1</blockquote>')
          result = result.replace(/<quote>([\s\S]*?)<\/quote>/gi, '<blockquote class="muv-quote">$1</blockquote>')
          // <char> / <character> → 角色名高亮
          result = result.replace(/<char>([\s\S]*?)<\/char>/gi, '<b class="muv-char-name">$1</b>')
          result = result.replace(/<character>([\s\S]*?)<\/character>/gi, '<b class="muv-char-name">$1</b>')
          // <audio> → 音频占位
          result = result.replace(/<audio>([\s\S]*?)<\/audio>/gi, '<div class="muv-audio">🎵 $1</div>')
          // <sep> / <hr> → 分割线
          result = result.replace(/<sep\s*\/?>/gi, '<hr class="muv-sep">')
          result = result.replace(/<hr\s*\/?>/gi, '<hr class="muv-sep">')
          // <img src="..."> → 图片渲染
          result = result.replace(/<img\s+src="([^"]+)"[^>]*>/gi, function(_, src) {
            return '<img src="'+src+'" class="muv-img" style="max-width:100%;border-radius:8px;margin:6px 0" loading="lazy">'
          })
          // ★ 苍玄界游戏标签 → 信息卡片（独立配色 + 通用字段解析）
          var gameTags = ['赏令接取','赏令完成','拍卖购入','盲盒开启','道友收录','飞剑回信','自由开局']
          var cardColors = {
            赏令接取: { icon:'📜', border:'rgba(212,168,67,0.55)', bg:'rgba(212,168,67,0.08)', title:'#d4a843' },
            赏令完成: { icon:'✅', border:'rgba(74,222,128,0.45)', bg:'rgba(74,222,128,0.06)', title:'#4ade80' },
            拍卖购入: { icon:'💰', border:'rgba(34,211,160,0.45)', bg:'rgba(34,211,160,0.06)', title:'#22d3a0' },
            盲盒开启: { icon:'🎁', border:'rgba(168,85,247,0.50)', bg:'rgba(168,85,247,0.07)', title:'#a855f7' },
            道友收录: { icon:'👥', border:'rgba(96,165,250,0.45)', bg:'rgba(96,165,250,0.06)', title:'#60a5fa' },
            飞剑回信: { icon:'📨', border:'rgba(45,212,191,0.45)', bg:'rgba(45,212,191,0.06)', title:'#2dd4bf' },
            自由开局: { icon:'🎲', border:'rgba(251,146,60,0.50)', bg:'rgba(251,146,60,0.07)', title:'#fb923c' }
          }
          for (var t = 0; t < gameTags.length; t++) {
            var tag = gameTags[t]
            var re = new RegExp('<'+tag+'>(?:(?:(?!<\\/'+tag+'>)[\\s\\S])*?([^：:\\r\\n]+)[：:]\\s*([^\\r\\n]+))*[\\s\\S]*?<\\/'+tag+'>', 'gi')
            var cc = cardColors[tag] || { icon:'📋', border:'rgba(122,184,255,0.15)', bg:'rgba(122,184,255,0.04)', title:'var(--dsw-alias-brand-primary)' }
            result = result.replace(re, function(match) {
              var fields = ''
              var fieldRe = /([^：:\r\n]+)[：:]\s*([^\r\n]+)/g
              var fm
              while ((fm = fieldRe.exec(match)) !== null) {
                fields += '<div class="muv-card-field"><b>'+escHtml(fm[1].trim())+'</b> '+escHtml(fm[2].trim())+'</div>'
              }
              return '<div class="muv-game-card" data-card="'+tag+'" style="border-color:'+cc.border+';background:'+cc.bg+'"><div class="muv-game-card-title" style="color:'+cc.title+'">'+cc.icon+' '+tag+'</div>'+fields+'</div>'
            })
          }
          // <inner> → 内嵌内容（保留）
          result = result.replace(/<inner>([\s\S]*?)<\/inner>/gi, '<div class="muv-inner">$1</div>')
          // ★ <Drama> → 戏剧/舞台卡片（世界书常用）
          result = result.replace(/<Drama>([\s\S]*?)<\/Drama>/gi, '<div class="muv-drama">$1</div>')
          // ★ 剥离 <style> 块（世界书格式模板，不应展示给用户）
          result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          // <Analysis> → 隐藏
          result = result.replace(/<Analysis>[\s\S]*?<\/Analysis>/gi, '')
          // ★ 通用社区标签
          // <CG> → CG 画廊图片
          result = result.replace(/<CG>([\s\S]*?)<\/CG>/gi, '<div class="muv-cg"><span class="muv-cg-icon">🎨</span> '+escHtml('$1'.trim())+'</div>')
          // <story> / <narrative> → 正文
          result = result.replace(/<story>([\s\S]*?)<\/story>/gi, '<div class="muv-story">$1</div>')
          result = result.replace(/<narrative>([\s\S]*?)<\/narrative>/gi, '<div class="muv-narrative">$1</div>')
          // <action> → 动作描述
          result = result.replace(/<action>([\s\S]*?)<\/action>/gi, '<div class="muv-action">$1</div>')
          // <thought> / <thinking> → 内心独白
          result = result.replace(/<thought>([\s\S]*?)<\/thought>/gi, '<div class="muv-thought">💭 $1</div>')
          result = result.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, '<div class="muv-thought">💭 $1</div>')
          // <feeling> / <emotion> → 情感状态
          result = result.replace(/<feeling>([\s\S]*?)<\/feeling>/gi, '<span class="muv-feeling">$1</span>')
          result = result.replace(/<emotion>([\s\S]*?)<\/emotion>/gi, '<span class="muv-feeling">$1</span>')
          // <expression> → 表情
          result = result.replace(/<expression>([\s\S]*?)<\/expression>/gi, '<span class="muv-expression">$1</span>')
          // <pose> / <posture> → 姿势
          result = result.replace(/<pose>([\s\S]*?)<\/pose>/gi, '<span class="muv-pose">$1</span>')
          result = result.replace(/<posture>([\s\S]*?)<\/posture>/gi, '<span class="muv-pose">$1</span>')
          // <location> / <scene> → 场景
          result = result.replace(/<location>([\s\S]*?)<\/location>/gi, '<div class="muv-location">📍 $1</div>')
          result = result.replace(/<scene>([\s\S]*?)<\/scene>/gi, '<div class="muv-location">📍 $1</div>')
          // <time> → 时间
          result = result.replace(/<time>([\s\S]*?)<\/time>/gi, '<span class="muv-time">⏰ $1</span>')
          // <weather> → 天气
          result = result.replace(/<weather>([\s\S]*?)<\/weather>/gi, '<span class="muv-weather">🌤️ $1</span>')
          // <inventory> / <背包> → 背包
          result = result.replace(/<inventory>([\s\S]*?)<\/inventory>/gi, '<details class="muv-inventory"><summary>🎒 背包</summary><div>$1</div></details>')
          result = result.replace(/<背包>([\s\S]*?)<\/背包>/gi, '<details class="muv-inventory"><summary>🎒 背包</summary><div>$1</div></details>')
          // <skill> / <技能> → 技能面板
          result = result.replace(/<skill>([\s\S]*?)<\/skill>/gi, '<details class="muv-skill"><summary>⚔️ 技能</summary><div>$1</div></details>')
          result = result.replace(/<技能>([\s\S]*?)<\/技能>/gi, '<details class="muv-skill"><summary>⚔️ 技能</summary><div>$1</div></details>')
          return result
        }
        function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
      }
    }

    exports.inject = []
    exports.apply = function () {
      const style = document.createElement('style')
      style.textContent = '.muv-statusbar-wrap{margin:10px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.muv-iframe{display:block}'+
        '.muv-latex-block{margin:8px 0}.muv-illustration{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(122,184,255,.06);border:1px solid rgba(122,184,255,.2);border-radius:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}.muv-illustration-icon{font-size:20px}'+
        '.muv-jsonpatch{background:rgba(197,160,101,.06);border:1px solid rgba(197,160,101,.2);border-radius:8px;margin:8px 0;overflow:hidden}.muv-jsonpatch summary{font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;color:#c5a065}.muv-jsonpatch pre{font-size:11px;padding:6px 12px;margin:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:200px;overflow:auto}'+
        '.muv-speech{display:block;padding:4px 8px;font-style:italic;color:var(--dsw-alias-label-secondary)}.muv-dialogue{display:block;padding:4px 0;line-height:1.6;border-left:3px solid #72a8ff;padding-left:10px}'+
        '.muv-quote{border-left:3px solid var(--dsw-alias-brand-primary);padding:6px 12px;margin:6px 0;color:var(--dsw-alias-label-secondary);font-style:italic}'+
        '.muv-char-name{display:inline-block;font-weight:700;color:#ffdd99}.muv-audio{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(122,184,255,.06);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}'+
        '.muv-sep{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:8px 0}.muv-img{max-width:100%;border-radius:8px;margin:6px 0}'+
        '.muv-game-card{border-radius:10px;padding:10px 14px;margin:8px 0;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.45)}.muv-game-card-title{font-weight:700;margin-bottom:6px;font-size:14px}.muv-card-field{margin:2px 0;color:var(--dsw-alias-label-secondary)}.muv-card-field b{color:var(--dsw-alias-label-primary);font-weight:500}.muv-inner{padding:4px 0}'+
        '.muv-cg{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(233,69,96,.06);border:1px dashed rgba(233,69,96,.2);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}.muv-cg-icon{font-size:16px}'+
        '.muv-story,.muv-narrative{line-height:1.8;padding:4px 0}.muv-action{display:block;color:#9dd898;font-style:italic;padding:2px 0}.muv-thought{display:block;color:#c49ce8;font-style:italic;padding:2px 0;font-size:12px}'+
        '.muv-drama{display:block;margin:10px 0;padding:12px 16px;background:linear-gradient(135deg,rgba(233,69,96,0.06),rgba(168,85,247,0.06));border:1px solid rgba(233,69,96,0.25);border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.35)}.muv-drama details{font-size:13px}.muv-drama summary{font-weight:700;font-size:14px;color:var(--dsw-alias-label-accent,#e94560);cursor:pointer;padding:4px 0}.muv-drama .mys{background:#2a1a1a;color:#f0d9d0;padding:16px;border-radius:8px}'+
        '.muv-feeling{display:inline-block;color:#ff9eaa;font-size:12px}.muv-expression{display:inline-block;color:#ff9eaa;font-size:12px}.muv-pose{display:inline-block;color:#94d2e8;font-size:12px}.muv-location{display:block;padding:6px 8px;background:rgba(60,55,80,0.45);border-radius:6px;color:var(--dsw-alias-label-secondary)}.muv-time{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}.muv-weather{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}'+
        '.muv-inventory,.muv-skill{background:rgba(122,184,255,.04);border:1px solid rgba(122,184,255,.12);border-radius:6px;margin:6px 0;padding:6px 10px;font-size:12px}.muv-inventory summary,.muv-skill summary{cursor:pointer;font-weight:600;color:var(--dsw-alias-brand-primary)}'+
        // 游戏卡片独立配色（data-card 属性）
        '[data-card="赏令接取"]{border:1px solid rgba(212,168,67,0.55)!important;background:rgba(212,168,67,0.08)!important}[data-card="赏令接取"] .muv-game-card-title{color:#d4a843!important}'+
        '[data-card="赏令完成"]{border:1px solid rgba(74,222,128,0.45)!important;background:rgba(74,222,128,0.06)!important}[data-card="赏令完成"] .muv-game-card-title{color:#4ade80!important}'+
        '[data-card="拍卖购入"]{border:1px solid rgba(34,211,160,0.45)!important;background:rgba(34,211,160,0.06)!important}[data-card="拍卖购入"] .muv-game-card-title{color:#22d3a0!important}'+
        '[data-card="盲盒开启"]{border:1px solid rgba(168,85,247,0.50)!important;background:rgba(168,85,247,0.07)!important}[data-card="盲盒开启"] .muv-game-card-title{color:#a855f7!important}'+
        '[data-card="道友收录"]{border:1px solid rgba(96,165,250,0.45)!important;background:rgba(96,165,250,0.06)!important}[data-card="道友收录"] .muv-game-card-title{color:#60a5fa!important}'+
        '[data-card="飞剑回信"]{border:1px solid rgba(45,212,191,0.45)!important;background:rgba(45,212,191,0.06)!important}[data-card="飞剑回信"] .muv-game-card-title{color:#2dd4bf!important}'+
        '[data-card="自由开局"]{border:1px solid rgba(251,146,60,0.50)!important;background:rgba(251,146,60,0.07)!important}[data-card="自由开局"] .muv-game-card-title{color:#fb923c!important}'
      document.head.appendChild(style)
      // ★ 输入拦截器：在用户发送消息前展开宏
      var _macroInputObserver = null
      function _expandTextareaMacros(textarea) {
        var val = textarea.value
        if (val && (val.indexOf('{[') !== -1)) {
          var expanded = _expandMacros(val)
          if (expanded !== val) {
            // 用原生 setter 绕过框架的 value 绑定
            var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
            nativeSetter.call(textarea, expanded)
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
          }
        }
      }
      function _installMacroInputHook() {
        // 查找聊天输入框（DSH WebUI 的 textarea）
        var textarea = document.querySelector('textarea[placeholder*="消息"], textarea[placeholder*="Message"], textarea[placeholder*="输入"], textarea.chat-input, [data-testid="chat-input"] textarea, .chat-input-area textarea, [role="textbox"]')
        if (!textarea) {
          // 退而求其次：找页面中唯一的 textarea（常见于简单聊天 UI）
          var allTextareas = document.querySelectorAll('textarea')
          for (var ti = 0; ti < allTextareas.length; ti++) {
            var ta = allTextareas[ti]
            // 跳过隐藏的、只读的、很小的 textarea
            if (ta.offsetParent === null) continue
            if (ta.readOnly) continue
            if (ta.rows < 2) continue
            textarea = ta
            break
          }
        }
        if (!textarea || textarea.dataset.muvMacroHooked) return
        textarea.dataset.muvMacroHooked = '1'
        // 拦截 Enter 发送（无 Shift）
        textarea.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            _expandTextareaMacros(textarea)
          }
        }, true) // capture phase: 在 DSH 自己的处理器之前运行
        // 拦截所属 form 的 submit（处理点击发送按钮）
        var form = textarea.closest('form')
        if (form && !form.dataset.muvMacroHooked) {
          form.dataset.muvMacroHooked = '1'
          form.addEventListener('submit', function() {
            _expandTextareaMacros(textarea)
          }, true)
        }
        console.log('[muv-engine] 宏展开输入拦截器已安装（textarea:', (textarea.placeholder || textarea.className || textarea.id || '(无标识)') + '）')
      }
      // 立即尝试安装
      _installMacroInputHook()
      // 如果 DOM 还没渲染完，用 MutationObserver 等待
      if (!document.querySelector('textarea[data-muv-macro-hooked]')) {
        _macroInputObserver = new MutationObserver(function() {
          _installMacroInputHook()
          var hooked = document.querySelector('textarea[data-muv-macro-hooked]')
          if (hooked && _macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
        })
        _macroInputObserver.observe(document.body, { childList: true, subtree: true })
      }
      return function() {
        style.remove()
        if (_macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
      }
    }

    return module.exports
  }
})