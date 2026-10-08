      try { document.documentElement.setAttribute('data-muv-engine', MUV_BUILD) } catch (_) {}
      try { console.log('[muv-engine] client loaded ' + MUV_BUILD) } catch (_) {}

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
          // 兼容转义形态：&lt;标签&gt; → <标签>（仅标签形态，DSH 可能转义 LLM 输出的 XML 标签）
          result = result.replace(/&lt;(\/?)([a-zA-Z\u4e00-\u9fa5][^&>]*?)&gt;/g, '<$1$2>')
          // ★ 围栏里的整页 HTML → iframe。
          //
          // 这条以前只有 DSH 原生路径（beautifyMuv → renderFencedHtml）有，酒馆面板走的是
          // 这个渲染器，所以卡产出的整页文档在酒馆路径上**没有被转成 iframe**：
          // 9 条真卡文档里 8 条原样带着 ``` 围栏与裸 <!DOCTYPE html> 进了 `contentEl.innerHTML`。
          // 后果不是"不好看"——卡文档里的 <style> 是**全局生效**的，`html,body{height:100%}`
          // 与一堆绝对定位元素会泄漏进整个聊天 DOM（状态栏只剩一个头 / 满屏代码文本 /
          // 内容列被压扁，都是这个机制）。
          //
          // 位置说明（为什么在这里）：
          //  - 必须在**转义还原之后**：DSH 可能把标签转义成 `&lt;!DOCTYPE html&gt;`，
          //    那样 renderFencedHtml 认不出这是整页文档（它只看裸的 `<!doctype`/`<html`）。
          //  - 必须在**其它标签替换之前**：放进 srcdoc 后卡自己的标记都被转义了，
          //    后面那些正则（媒体、speech、char…）就再也不会去改写卡页面内部的东西 ——
          //    否则 renderMediaTags 会去动卡自己的 `<video>`，正是上一轮修掉的那类事故。
          result = renderFencedHtml(result)
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
          // ★ 媒体元素：带 src 的渲染成真实播放器，没 src 的才降级成占位
          //   实现见模块级 renderMediaTags()（抽出去是为了能被测试直接跑）
          result = renderMediaTags(result)
          // <sep> / <hr> → 分割线
          result = result.replace(/<sep\s*\/?>/gi, '<hr class="muv-sep">')
          result = result.replace(/<hr\s*\/?>/gi, '<hr class="muv-sep">')
          // ★ 变量编辑块（社区卡的通用形态，模型也常自行改写标签名）
          //
          //   <VariableInsert>{ …JSON… }</VariableInsert>   卡里定义的那份
          //   <VariableEdit>{ …JSON… }</VariableEdit>       模型实际发出的
          //   <UpdateVariable><initvar>…</initvar></UpdateVariable>   MUV 原生
          //
          // 这些块是给变量面板吃的，不是给用户读的正文：以前整块原样显示，
          // 于是 JSON 与标签糊满屏幕。收进折叠卡片，需要时展开看原始数据。
          result = result.replace(/<(VariableEdit|VariableInsert|UpdateVariable)>([\s\S]*?)<\/\1>/gi, function (_, tag, inner) {
            var raw = String(inner || '').trim()
            var pretty = raw
            try { pretty = JSON.stringify(JSON.parse(raw), null, 2) } catch (_) {}
            return '<details class="muv-varedit"><summary>🔧 变量更新</summary><pre>' + escHtml(pretty) + '</pre></details>'
          })
          // ★ 模型自创的思考/摘要外壳：折叠或转成摘要，避免原始标签外泄
          result = result.replace(/<VariableThink>([\s\S]*?)<\/VariableThink>/gi, function (_, inner) {
            return '<details class="muv-varthink"><summary>💭 变量推演</summary><div>' + escHtml(String(inner).trim()) + '</div></details>'
          })
          result = result.replace(/<Abstract>([\s\S]*?)<\/Abstract>/gi, function (_, inner) {
            return '<div class="muv-abstract"><span class="muv-abstract-icon">📖</span> ' + escHtml(String(inner).trim()) + '</div>'
          })
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
          // ★ <choices> → 选项列表（交互式选择；宽松解析：按行分割，支持 A、/1、/•/无前缀）
          //   标签名兼容单复数：不少角色卡写的是 <choice>…</choice>，此前只认 <choices> 会漏渲染
          result = replaceChoices(result)
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
      // ★ 承载卡 HTML 的容器必须**显式撑满**，不能只靠里面的 `width:100%`。
      //
      // 实测（verify-card-width.mjs，聊天列宽 940px，把 renderFencedHtml 的真产物放进不同父容器）：
      //   块级父容器            → wrap 940 / iframe 940   ✅
      //   flex 行父容器（未设宽）→ wrap 300 / iframe 300   ❌ 整框塌成 iframe 的**固有宽度**
      //   flex 列父容器          → wrap 940 / iframe 940   ✅
      // 机制：flex 子项的 `width:auto` 按 min-content 定尺寸，而它内部的 `<iframe style="width:100%">`
      // 的固有宽度是 300px，于是"父宽取决于子宽、子宽取决于父宽"收敛到 300。
      // 用户看到的就是这个：DSH 里卡片的框又窄又小（卡自身还有 min-width 时会到 ~460px），
      // 同时因为按窄宽度重排、内容包围盒变矮，**高度自适应也跟着报小**、框内出现滚动条。
      //   - `min-width:0`：解除 flex 子项的 min-content 下限（否则仍可能被内容顶宽）
      //   - `align-self:stretch`：交叉轴上撑满（flex 列方向）
      //   - `box-sizing:border-box`：边框算进宽度，避免 100% + border 溢出
      // 故意**不设** `max-width`：用户明确要"和 ST 一样大"。
      style.textContent = '.muv-statusbar-wrap{display:block;width:100%;min-width:0;align-self:stretch;box-sizing:border-box;margin:10px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}.muv-iframe{display:block;width:100%}'+
        // ★ 首屏遮蔽（2026-09-25，足控天堂「切回先夜色再跳白天」）：**只**盖住"自带初始主题
        //   属性"的卡文档（`data-muv-mask` 由 `cardHtmlIframe` 按 `body/html` 上有没有
        //   `data-theme=` 决定），因为只有这类文档存在"先画默认主题、等卡自己初始化才换"的错色期。
        //   显形由 `muvCardShow` 写 `data-muv-shown="1"`（主路：卡内垫片报 `__muvReady`；
        //   兜底：捕获期 `load` 事件 + 15s 绝对上限，见 `ensureCardMask`）。
        //   遮蔽用 **opacity** 而不是 `visibility`/`display`：opacity 不会进到帧内
        //   `getComputedStyle`（帧内高度引导脚本靠 `visibility==="hidden"` 跳过元素，
        //   改 visibility 会把整卡测成 0 高、高度塌掉），也不影响帧内 rAF 与布局测量。
        'iframe.muv-iframe[data-muv-mask]{opacity:0;transition:opacity .12s linear}iframe.muv-iframe[data-muv-shown="1"]{opacity:1}'+
        '.muv-latex-block{margin:8px 0}.muv-illustration{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(122,184,255,.06);border:1px solid rgba(122,184,255,.2);border-radius:8px;font-size:13px;color:var(--dsw-alias-label-secondary)}.muv-illustration-icon{font-size:20px}'+
        '.muv-jsonpatch{background:rgba(197,160,101,.06);border:1px solid rgba(197,160,101,.2);border-radius:8px;margin:8px 0;overflow:hidden}.muv-jsonpatch summary{font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;color:#c5a065}.muv-jsonpatch pre{font-size:11px;padding:6px 12px;margin:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:200px;overflow:auto}'+
        '.muv-speech{display:block;padding:4px 8px;font-style:italic;color:var(--dsw-alias-label-secondary)}.muv-dialogue{display:block;padding:4px 0;line-height:1.6;border-left:3px solid #72a8ff;padding-left:10px}'+
        '.muv-quote{border-left:3px solid var(--dsw-alias-brand-primary);padding:6px 12px;margin:6px 0;color:var(--dsw-alias-label-secondary);font-style:italic}'+
        // `.muv-video-ph` 是「没有 src 的视频提示词」的占位：它和音频占位长得一样，但
// 不该共用 `muv-audio` 这个类名——否则样式与语义上都被当成音频。
'.muv-char-name{display:inline-block;font-weight:700;color:#ffdd99}.muv-audio,.muv-video-ph{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(122,184,255,.06);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}'+
        '.muv-sep{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:8px 0}.muv-img{max-width:100%;border-radius:8px;margin:6px 0}'+
        '.muv-game-card{border-radius:10px;padding:10px 14px;margin:8px 0;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,0.45)}.muv-game-card-title{font-weight:700;margin-bottom:6px;font-size:14px}.muv-card-field{margin:2px 0;color:var(--dsw-alias-label-secondary)}.muv-card-field b{color:var(--dsw-alias-label-primary);font-weight:500}.muv-inner{padding:4px 0}'+
        '.muv-cg{display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(233,69,96,.06);border:1px dashed rgba(233,69,96,.2);border-radius:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}.muv-cg-icon{font-size:16px}'+
        '.muv-story,.muv-narrative{line-height:1.8;padding:4px 0}.muv-action{display:block;color:#9dd898;font-style:italic;padding:2px 0}.muv-thought{display:block;color:#c49ce8;font-style:italic;padding:2px 0;font-size:12px}'+
        '.muv-drama{display:block;margin:10px 0;padding:12px 16px;background:linear-gradient(135deg,rgba(233,69,96,0.06),rgba(168,85,247,0.06));border:1px solid rgba(233,69,96,0.25);border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.35)}.muv-drama details{font-size:13px}.muv-drama summary{font-weight:700;font-size:14px;color:var(--dsw-alias-label-accent,#e94560);cursor:pointer;padding:4px 0}.muv-drama .mys{background:#2a1a1a;color:#f0d9d0;padding:16px;border-radius:8px}'+
        '.muv-choices{display:flex;flex-direction:column;gap:6px;margin:10px 0}.muv-choice-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,#2a2a3e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s}.muv-choice-btn:hover{background:var(--dsw-alias-bg-layer-2,#3a3a5e);border-color:var(--dsw-alias-brand-primary,#7ab8ff)}.muv-choice-letter{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-brand-primary,#7ab8ff);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}'+
        '.muv-varedit,.muv-varthink{background:rgba(197,160,101,.06);border:1px solid rgba(197,160,101,.22);border-radius:8px;margin:8px 0;overflow:hidden}.muv-varedit summary,.muv-varthink summary{font-size:12px;font-weight:600;padding:6px 12px;cursor:pointer;color:#c5a065}.muv-varedit pre{font-size:11px;line-height:1.55;padding:8px 12px;margin:0;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto}.muv-varthink div{font-size:12px;line-height:1.7;padding:8px 12px;color:var(--dsw-alias-label-secondary,#bbb);white-space:pre-wrap}.muv-abstract{display:flex;gap:8px;padding:8px 12px;margin:8px 0;background:rgba(122,184,255,.05);border-left:3px solid rgba(122,184,255,.45);border-radius:6px;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,#bbb)}.muv-abstract-icon{flex-shrink:0}'+
        '.muv-feeling{display:inline-block;color:#ff9eaa;font-size:12px}.muv-expression{display:inline-block;color:#ff9eaa;font-size:12px}.muv-pose{display:inline-block;color:#94d2e8;font-size:12px}.muv-location{display:block;padding:6px 8px;background:rgba(60,55,80,0.45);border-radius:6px;color:var(--dsw-alias-label-secondary)}.muv-time{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}.muv-weather{display:inline-block;color:var(--dsw-alias-label-secondary);font-size:12px;opacity:0.85}'+
        '.muv-inventory,.muv-skill{background:rgba(122,184,255,.04);border:1px solid rgba(122,184,255,.12);border-radius:6px;margin:6px 0;padding:6px 10px;font-size:12px}.muv-inventory summary,.muv-skill summary{cursor:pointer;font-weight:600;color:var(--dsw-alias-brand-primary)}'+
        // 游戏卡片独立配色（data-card 属性）
        '[data-card="赏令接取"]{border:1px solid rgba(212,168,67,0.55)!important;background:rgba(212,168,67,0.08)!important}[data-card="赏令接取"] .muv-game-card-title{color:#d4a843!important}'+
        '[data-card="赏令完成"]{border:1px solid rgba(74,222,128,0.45)!important;background:rgba(74,222,128,0.06)!important}[data-card="赏令完成"] .muv-game-card-title{color:#4ade80!important}'+
        '[data-card="拍卖购入"]{border:1px solid rgba(34,211,160,0.45)!important;background:rgba(34,211,160,0.06)!important}[data-card="拍卖购入"] .muv-game-card-title{color:#22d3a0!important}'+
        '[data-card="盲盒开启"]{border:1px solid rgba(168,85,247,0.50)!important;background:rgba(168,85,247,0.07)!important}[data-card="盲盒开启"] .muv-game-card-title{color:#a855f7!important}'+
        '[data-card="道友收录"]{border:1px solid rgba(96,165,250,0.45)!important;background:rgba(96,165,250,0.06)!important}[data-card="道友收录"] .muv-game-card-title{color:#60a5fa!important}'+
        '[data-card="飞剑回信"]{border:1px solid rgba(45,212,191,0.45)!important;background:rgba(45,212,191,0.06)!important}[data-card="飞剑回信"] .muv-game-card-title{color:#2dd4bf!important}'+
        '[data-card="自由开局"]{border:1px solid rgba(251,146,60,0.50)!important;background:rgba(251,146,60,0.07)!important}[data-card="自由开局"] .muv-game-card-title{color:#fb923c!important}'+
        '.tavern-options{display:flex;flex-direction:column;gap:6px;margin:10px 0}.tavern-option-btn{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-1,#2a2a3e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;cursor:pointer;text-align:left;font-family:inherit;transition:all 0.15s;width:100%}.tavern-option-btn:hover{background:var(--dsw-alias-bg-layer-2,#3a3a5e);border-color:var(--dsw-alias-brand-primary,#7ab8ff)}.tavern-option-btn::before{content:attr(data-opt-letter);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-brand-primary,#7ab8ff);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}'+
        // ★ 封面楼破格（full-bleed）：把**开场白封面楼**的整页卡撑满聊天区宽度。
        // 真机取证（tools/dsh-live27-fullbleed.mjs，1920 窗，innerW=1896）：DSH 消息列
        // .EvIC1a_column{max-width:920px;margin:0 auto}（实测两侧 auto margin 各 311px），
        // 封面楼两侧各露 ~343px（311 auto + 32 scroll 内边距）宿主深底 = 用户说的"黑边"。
        // 祖先链（wrap → ._markdown_kcgor_5 → .hWmORq_body/_root → .EvIC1a_flowItem →
        // .EvIC1a_column → .EvIC1a_scroll → .EvIC1a_root → .wSkVaW_viewArea →
        // .wSkVaW_scrollBody(overflow:auto，滚动容器)）中途**无 overflow:hidden**，
        // 负 margin 可以安全穿出；.wSkVaW_scrollBody 左缘即侧栏右缘(x=280)，
        // 故纯 100vw 会左溢进侧栏被裁、右溢出触发横向滚动条——必须配 overflow-x:clip。
        // ★★ 判据（2026-09-25 恢复楼位）：破格类 `muv-fullpage` **只由楼位旗标**
        //   （`muvFullpageFloor` = `isOldestFloor`）写入产物，即只有开场白/封面楼破格。
        //   build k 曾改成"产物形态"（整页 HTML 文档一律打标）—— 被真机证伪：社区卡
        //   会每轮回复都产出整页文档（实测农场 7 个楼 srcdoc 全等 52359）⇒ 7/7 楼
        //   被拉成 100vw（rectW 1896@1920），既是 §40.1 记过的那个事故，也偏离 ST
        //   基准（`docs/44-ST卡片排版规格.md`：整页卡只占消息列宽、首楼与后续楼零
        //   差异、不允许满宽穿出）。所以满宽是 DSH 给封面楼开的自造扩展，作用域
        //   必须靠楼位收窄。类写在产物 HTML 里，不会被 React 重渲染丢掉
        //   （与 §23"判据看产物"同一逻辑）。
        // 裁剪边界即 .wSkVaW_scrollBody 盒（padding box），两侧对称且随窗口自适应；
        // margin-inline 是水平负 margin，不改变文档流高度，高度管线（ratchet）照常工作。
        // 作用域钉在 .wSkVaW_scrollBody 内：对话框/预览等其它挂载点不破格。
        '.wSkVaW_scrollBody .muv-statusbar-wrap.muv-fullpage{width:100vw;margin-inline:calc(50% - 50vw)}'+
        '.wSkVaW_scrollBody:has(.muv-statusbar-wrap.muv-fullpage){overflow-x:clip}'
      document.head.appendChild(style)
      // ★ 全局点击委托：选项按钮点击 → 投递到聊天输入框并代发。
      //
      // 2026-09-26b 修的是「状态栏行动选项点了没反应」（涩涩提瓦特等卡）：
      //   `status-cascade.js` 的 `renderOptions()` 产出的是 `<button class="muv-sb-opt">`，
      //   而旧委托只认 `.muv-choice-btn, .tavern-option-btn` ⇒ 按钮**可见但无任何处理器**，
      //   点击静默无反应（0.3.10 修的是 iframe→宿主的 contenteditable 末端，宿主这条
      //   级联状态栏按钮路径当时没被覆盖，所以看起来"修了还是没反应"）。
      //   同时删掉委托里那套旧 textarea-only 覆盖式逻辑：它会绕过 `muvDeliverUserText`
      //   的 contenteditable 追加 / InputEvent / 真发送钮三件事，且在 DSH 真机（0 个
      //   textarea）里必然落空。现在三条入口统一走同一个投递函数。
      //   ★ 铁律继承：追加不覆盖（`muvDeliverUserText` 内部保证）、一次点击只投递一次。
      document.addEventListener('click', function(e) {
        var btn = null
        try { btn = e.target && e.target.closest ? e.target.closest('.muv-sb-opt, .muv-choice-btn, .tavern-option-btn') : null } catch (_) { btn = null }
        if (!btn) return
        // 字母徽标只在**确实渲染出徽标**时剥：`.muv-choice-btn` 有 `.muv-choice-letter`
        //   子元素，`.tavern-option-btn` 用 `data-opt-letter`（CSS ::before 画的圆圈，
        //   textContent 里本来就没有字母）。**绝不能**对 `.muv-sb-opt` 无条件套
        //   `/^[A-D]\s*/` —— 状态栏选项是模型原文，`A new day…` 这类正文会被吃掉首字母。
        var text = String(btn.textContent == null ? '' : btn.textContent)
        var letter = ''
        try {
          var letterEl = btn.querySelector ? btn.querySelector('.muv-choice-letter') : null
          if (letterEl && letterEl.textContent) letter = String(letterEl.textContent).trim()
        } catch (_) { letter = '' }
        if (!letter) {
          try { letter = String((btn.getAttribute && btn.getAttribute('data-opt-letter')) || '').trim() } catch (_) { letter = '' }
        }
        text = text.trim()
        if (letter && text.slice(0, letter.length) === letter) {
          text = text.slice(letter.length).replace(/^[.、)）:：\s]+/, '').trim()
        }
        if (!text) return
        try {
          muvDeliverUserText(text, 'send')
        } catch (err) {
          try { console.info('[muv-engine] 选项点击投递异常：' + (err && err.message)) } catch (_) {}
        }
      })
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
      // ★ 酒馆代码清理 + 字段换行 + 选项按钮（从 dsh-visual-render 整合）
      var MUV_SAN_MARK = 'data-muv-sanitized'
      var RE_TOOLCALL = /<tool_call>[\s\S]*?<\/tool_call>|<\/?tool_call>/gi
      var RE_IFBLOCK = /\{\{if\s+[^}]*\}\}[\s\S]*?\{\{\/if\}\}/gi
      var RE_SETBLOCK = /\{\{(?:set|update|var|variable)\s+[^}]*\}\}/gi
      var RE_COMMENT = /\/\*[\s\S]*?\*\//g
      var RE_REVERSE = /\{\{reverse\}\}[\s\S]*?\{\{\/reverse\}\}/gi
      var RE_ANYMACRO = /\{\{[^}]+\}\}/g
      var RE_LEGACY = /\[\[[^\]]+\]\]/g
      var RE_MARKER = /<START(?::[^>]*)?>|\[End of turn\]|\[Initiative\]|\[End of sequence\]|\[End of scene\]/gi
      var RE_FIELD = /([^\n])\s*([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}])\s*(当前行动|当前动作|当前穿搭|当前衣着|当前身份|当前状态|下体状态|下体状况|当前内心|当前心情|当前好感|当前关系|待办事项?|日期|时间|位置|天气|心情|好感度|关系|身份|动作|衣着|穿搭|状态|内心)[：:]/gu

      function muvCleanText(root) {
        try { root.querySelectorAll('tool_call, tool-call').forEach(function(e){e.remove()}) } catch(e){}
        var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), arr = [], nd
        while ((nd = w.nextNode())) { if (!nd.parentElement || !nd.parentElement.closest('.dshv-root')) arr.push(nd) }
        for (var i = 0; i < arr.length; i++) {
          var node = arr[i]
          if (!node.parentNode) continue
          var t = node.textContent
          if (!t) continue
          var nt = t.replace(RE_TOOLCALL,'').replace(RE_IFBLOCK,'').replace(RE_SETBLOCK,'').replace(RE_COMMENT,'').replace(RE_REVERSE,'').replace(RE_ANYMACRO,'').replace(RE_LEGACY,'').replace(RE_MARKER,'')
          if (RE_FIELD.test(nt)) {
            var frag = document.createDocumentFragment(), last = 0, re = new RegExp(RE_FIELD.source,'gu'), m
            while ((m = re.exec(nt)) !== null) {
              if (m.index + m[1].length > last) frag.appendChild(document.createTextNode(nt.slice(last, m.index + m[1].length)))
              frag.appendChild(document.createElement('br'))
              frag.appendChild(document.createTextNode(m[2] + ' ' + m[3] + '：'))
              last = m.index + m[0].length
            }
            if (last < nt.length) frag.appendChild(document.createTextNode(nt.slice(last)))
            node.parentNode.replaceChild(frag, node)
          } else if (nt !== t) {
            node.textContent = nt
          }
        }
      }

      function muvStripOpt(s) {
        s = String(s||'').trim().replace(/^["\u201c\u201d']|["\u201c\u201d']$/g,'')
        s = s.replace(/^[\u{1F170}-\u{1F17E}]\s*/u,'').replace(/^[A-Za-z][.、)）]\s*/,'').replace(/^\d+[.、)）]\s*/,'')
        return s.trim()
      }

      function muvBuildChoices(opts) {
        var box = document.createElement('div')
        box.className = 'muv-choices'
        for (var i = 0; i < opts.length; i++) {
          (function(text, idx){
            var btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'muv-choice-btn'
            btn.setAttribute('data-opt', String.fromCharCode(65+idx))
            // textContent 而不是 innerHTML：选项文本可能来自模型（DOM 路径直接吃消息文本），
            // 拼进 innerHTML 就等于给它一次注入机会；字符串路径那边本来也是转义的，
            // 这样两条路径的转义口径也一致。
            var letter = document.createElement('span')
            letter.className = 'muv-choice-letter'
            letter.textContent = String.fromCharCode(65+idx)
            btn.appendChild(letter)
            btn.appendChild(document.createTextNode(String(text == null ? '' : text)))
            box.appendChild(btn)
          })(opts[i], i)
        }
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
