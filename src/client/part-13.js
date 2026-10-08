
    function mountUi() {
      if (window.__dshVrUi && typeof window.__dshVrUi.dispose === 'function') {
        try { window.__dshVrUi.dispose(); } catch (e) {}
        window.__dshVrUi = null;
      }
      document.querySelectorAll('[data-dsh-vr-entry]').forEach(function (el) { el.remove(); });
      document.querySelectorAll('[data-dsh-vr-view]').forEach(function (el) { el.remove(); });
      document.documentElement.removeAttribute(VR_ACTIVE);

      var entry = vrCreateEntry();
      var panel;
      var root;
      var placed = false;

      function refresh() {
        var el = panel && panel.querySelector('[data-dsh-vr-stats]');
        if (!el) return;
        var s = stats();
        var text = '代码块 ' + s.codeBlocks + ' 个 · 已渲染 ' + s.wrappedBlocks + ' 个 · 语言: ' + (s.langs.length ? s.langs.join(', ') : '（无）');
        if (el.textContent !== text) el.textContent = text;
        var diag = panel.querySelector('[data-dsh-vr-diag]');
        if (diag) {
          var parts = [];
          var sels = ['[data-dsh-lewdscale-entry]', '[data-dsh-possess-entry]', '[data-dsh-datatools-entry]', '[data-dsh-datatools-vision]', '[data-dsh-datatools-tavern]', '[data-dsh-tavern-entry]', '[data-dsh-tavern-manager-entry]', '[data-dsh-style-entry]', '[data-dsh-vr-entry]'];
          for (var i = 0; i < sels.length; i++) parts.push(sels[i] + ' = ' + document.querySelectorAll(sels[i]).length);
          var side = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
          var btns = side ? side.querySelectorAll('button') : [];
          parts.push('--- 侧边栏按钮采样（' + btns.length + ' 个）---');
          for (var j = 0; j < Math.min(btns.length, 12); j++) {
            var b = btns[j];
            var attrs = [];
            for (var k = 0; k < b.attributes.length; k++) {
              var a = b.attributes[k];
              if (/data-|class/.test(a.name)) attrs.push(a.name + '=' + String(a.value).slice(0, 22));
            }
            parts.push(j + '. [' + attrs.join(' ') + '] ' + (b.textContent || '').trim().slice(0, 24));
          }
          parts.push('--- 样式状态 ---');
          parts.push('style 标签在页面里 = ' + (document.querySelector('style[data-plugin-css="dsh-visual-render-ui"]') ? 'YES' : 'NO'));
          var probe = document.querySelector('[data-dsh-lewdscale-entry]');
          if (probe) {
            var cs = window.getComputedStyle(probe);
            parts.push('档位入口计算色 = ' + cs.color + ' | ' + cs.backgroundColor);
          }
          var dtxt = parts.join('\n');
          if (diag.textContent !== dtxt) diag.textContent = dtxt;
        }
      }

      function applyActive() {
        if (!panel) return;
        var active = document.documentElement.hasAttribute(VR_ACTIVE);
        panel.style.display = active ? 'flex' : 'none';
        if (active) refresh();
      }

      function ensurePanel() {
        if (panel && panel.isConnected) return panel;
        panel = vrCreatePanel();
        document.body.appendChild(panel);
        var close = function () {
          document.documentElement.removeAttribute(VR_ACTIVE);
          applyActive();
        };
        panel.querySelector('[data-dsh-vr-close]').addEventListener('click', close);
        panel.querySelector('[data-dsh-vr-close2]').addEventListener('click', close);
        panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
        panel.querySelector('[data-dsh-vr-rescan]').addEventListener('click', function () {
          scan(document);
          refresh();
        });
        return panel;
      }

      entry.addEventListener('click', function () {
        ensurePanel();
        if (document.documentElement.hasAttribute(VR_ACTIVE)) {
          document.documentElement.removeAttribute(VR_ACTIVE);
        } else {
          document.documentElement.setAttribute(VR_ACTIVE, '');
        }
        applyActive();
      });

      var tryPlace = function () {
        if (root && !root.isConnected) { root = undefined; placed = false; }
        if (placed) { if (document.body.contains(entry)) return; placed = false; }
        root = root || vrSidebarRoot();
        if (!root) {
          if (entry.parentElement !== document.body) {
            entry.style.position = 'fixed';
            entry.style.bottom = '108px';
            entry.style.right = '20px';
            entry.style.zIndex = '99999';
            entry.style.width = 'auto';
            entry.style.borderRadius = '999px';
            entry.style.background = 'var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15))';
            entry.style.boxShadow = '0 4px 16px rgba(0,0,0,.25)';
            document.body.appendChild(entry);
            placed = true;
          }
          return;
        }
        var button = vrNewSessionButton(root);
        if (!button) {
          if (entry.parentElement !== root) root.appendChild(entry);
          placed = true;
          return;
        }
        if (entry.parentElement !== root) {
          var row = button.closest('[class*="logoRow"]');
          var base = (row && row.parentElement === root) ? row : button;
          root.insertBefore(entry, base.nextElementSibling);
        }
        placed = true;
      };

      var observerRaf = 0;
      var observer = new MutationObserver(function () {
        if (observerRaf) return;
        observerRaf = window.requestAnimationFrame(function () {
          observerRaf = 0;
          tryPlace();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      tryPlace();

      window.__dshVrUi = {
        dispose: function () {
          observer.disconnect();
          if (entry) entry.remove();
          document.documentElement.removeAttribute(VR_ACTIVE);
          if (panel) panel.remove();
        }
      };
    }

    function scan(root) {
      var blocks = (root || document).querySelectorAll('.md-code-block');
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (block.hasAttribute(MARK)) continue;
        var lang = langOf(block);
        var isVisual = LANG_RE.test(lang);
        var isOptions = OPTIONS_LANG_RE.test(lang);
        var isAside = ASIDE_LANG_RE.test(lang);
        var isScene = SCENE_LANG_RE.test(lang);
        if (!isVisual && !isOptions && !isAside && !isScene) continue;
        try {
          injectUiCss();
          if (isScene) buildScene(block, lang);
          else if (isAside) buildAside(block, lang);
          else if (isOptions) buildOptions(block, lang);
          else buildView(block, lang);
        } catch (e) {
          if (typeof console !== 'undefined' && console.error) console.error('[dsh-visual-render]', e);
        }
      }
    }


        // 启动代码块渲染
        injectUiCss();
        scan(document);
        var _vrRaf = 0;
        _vrObs = new MutationObserver(function() {
          if (_vrRaf) return;
          _vrRaf = window.requestAnimationFrame(function() { _vrRaf = 0; scan(document); });
        });
        _vrObs.observe(document.body, { childList: true, subtree: true });

        // ── 消息装饰：把卡片正则脚本的结果真正贴回 DOM ──────────────
        // beautifyMuv() 一直存在，但历史上没有任何地方调用它：卡片的 21 条
        // 脚本（对话美化/心声/状态栏/世界卡…）算得出来，却从没写回页面，
        // 用户看到的就是纯原文。这里负责补上这一步。
        //
        // 正文容器按 CSS Modules 的“形状”匹配而不是写死哈希 —— DSH 每次
        // 重建 Web 资源哈希都会变，写死必然在某次升级后静默失效。
        var MSG_BODY_RE = /_markdown_[a-z0-9]+_\d+/i
        var DECORATED_ATTR = 'data-muv-decorated'
        var _decorating = false
        var _decorRaf = 0

        /**
         * 从正文容器向上找消息根节点。
         *
         * ★★ 这个函数**曾经根本不存在** —— 只有 `messageTargets()` 里那一处调用。
         * 那个调用点在 `try { … } catch (_) {}` 里，所以每一次都抛 `ReferenceError`、
         * 每一次被静默吞掉，`messageTargets()` **恒返回空数组**：
         *   · `decorateMessages()` 一条消息都不装饰；
         *   · 更要紧的是紧跟其后的 `_decorateOneHook = _decorateOne` 那两行**确实执行了**
         *     ⇒ `MuvEngine.decorateMessage(el)` **不抛错也什么都不做**。
         * 于是所有既有门禁都绿（它们只看"调了 decorateMessage 没抛"），
         * 而真实页面上要多刷新一次才会被装饰 —— 这类"看起来接上了其实没接上"
         * 正是本项目反复栽的那一类。实现逐字来自同栈的 `dsh-tavern-v2`
         * `lib/client.manager.bundle.js` 里那份同名函数（那边已上线验证过）。
         *
         * 判据：向上最多 4 层，一旦某层的兄弟节点多于 1 个就停 —— 那说明当前 node
         * 已经是"一条消息"，再往上就是消息列表了（把列表当一条消息会让
         * `[data-streaming]`／绝对定位都落在错误的层级上）。
         * @param {Element} bodyEl
         * @returns {Element}
         */
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

        /** Every message body in the current view, paired with its message root. */
        /**
         * **这条消息体是否属于「当前可见的那个会话」？**
         *
         * 为什么必须有它（2026-10-08 用户实测的串台 bug）：DSH 会把**别的会话**的消息列表留在 DOM 里
         *   （虚拟列表 / 隐藏容器），而下面取样用的是**全文档**选择器 ⇒ 所有会话一起被美化 ⇒
         *   状态栏/世界卡被渲染进别的会话的节点，用户看到「两个会话来回点、美化来回串」。
         *
         * 这条护栏原本在酒馆客户端里（`isVisibleInDom`），状态栏/剧情美化**移交给本引擎时它没跟过来** ——
         *   这里按等价判据补回。顺带修掉次级问题：`depth` 用「本会话总楼数 − data-chat-turn」，
         *   混进别的会话的节点时，楼号与会话总楼数是两个会话的数，depth 必然算错。
         * @param {Element} el
         * @returns {boolean}
         */
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

        function messageTargets() {
          var out = []
          try {
            var all = document.querySelectorAll('[class*="_markdown_"]')
            for (var i = 0; i < all.length; i++) {
              var body = all[i]
              var cls = body.className
              if (typeof cls !== 'string' || !MSG_BODY_RE.test(cls)) continue
              // 同名模式也用在文件类型图标上，正文一定含块级子节点
              if (!body.querySelector('p, pre, ul, ol, blockquote, table, h1, h2, h3')) continue
              // ★ 只取**当前可见会话**的消息：别的会话留在 DOM 里的隐藏消息一旦被美化，
              //   状态栏/世界卡就渲染进那个会话的节点 ⇒ 用户看到「美化来回串」（2026-10-08 实测）。
              if (!muvIsVisibleInDom(body)) continue
              out.push({ body: body, root: messageRootOf(body) })
            }
          } catch (_) {}
          return out
        }

        /**
         * **权威楼数/首楼号**（2026-09-25）：`depth` 的稳定来源。
         *
         * 为什么必须换：`depth` 的语义是「本楼之后还有几条」，而旧口径是
         * `targets.length - 1 - i` —— **数当前 DOM 渲染窗口**。DSH 消息列表是虚拟化的
         * （实测：33 楼的会话只渲染 15 个），于是同一楼在不同访问里拿到不同 depth；
         * 更糟的是它把**同一 turn 内的多条 block 当成不同楼**。实测对比（会话 16 楼、
         * DOM 19 条）：
         * ```
         *   turn 13 的若干条：旧口径 depth = 18,17,16,15,14,13 …   权威 = 3
         *   turn 16（最新）：旧口径 6,5,4,3,2,1,0                  权威 = 0
         * ```
         * ⇒ ① 卡的 `maxDepth/minDepth` 判据在漂（同一楼有时出摘要、有时不出）
         *   ② 产物缓存键含 depth ⇒ 切回会话必然 miss（用户实测的"切回要重新渲染"）。
         *
         * 权威来源（纯客户端，**不动服务端**）：DSH 会话投影
         * `__DSH_TAVERN_CTX__.get('sessions')` → `manager.get(sid).projections.rows`：
         *   · `sessionStats.value.turns` —— 总楼数（实测 16）
         *   · `turnOutline.value[]` —— 权威有序楼表（`{turn, seq, prompt, response}`），
         *     首元素 `.turn` 即首楼号；其 `.length` 与 `turns` 互相印证（实测都是 16）
         * 配 DOM 上每条消息祖先的 `data-chat-turn`（实测 13/15/16）⇒ `depth = turns − turn`。
         *
         * ★★ 全部**特性探测 + 失败返回 null**：这是 DSH 的内部 API，别的版本/别的部署可能
         *   没有它 —— 拿不到就**退回旧口径**（数渲染窗口），**绝不让插件报错**。
         *   这与本项目"缺哪个能力就只缺那块"的一贯口径一致（同 `muvCardScriptsNow`）。
         * @returns {{total:number, first:number}|null}
         */
        function muvSessionTurnsNow() {
          try {
            var ctx = window.__DSH_TAVERN_CTX__
            if (!ctx || typeof ctx.get !== 'function') return null
            var S = ctx.get('sessions')
            if (!S || !S.list || typeof S.list.getSnapshot !== 'function') return null
            if (!S.manager || typeof S.manager.get !== 'function') return null
            var snap = S.list.getSnapshot()
            var sid = snap && snap.current
            if (!sid) return null
            var cur = S.manager.get(sid)
            var rows = cur && cur.projections && cur.projections.rows
            if (!rows || typeof rows.get !== 'function') return null
            var total = null
            var first = null
            try {
              var to = rows.get('turnOutline')
              if (to && Array.isArray(to.value) && to.value.length) {
                total = to.value.length
                var t0 = to.value[0] && to.value[0].turn
                if (typeof t0 === 'number' && isFinite(t0)) first = t0
              }
            } catch (_) {}
            try {
              var ss = rows.get('sessionStats')
              var v = ss && ss.value
              if (v && typeof v.turns === 'number' && isFinite(v.turns) && v.turns > 0) total = v.turns
            } catch (_) {}
            if (total === null) return null
            if (first === null) first = 1
            return { total: total, first: first }
          } catch (_) { return null }
        }

        /**
         * 往上找本条消息的**楼号** `data-chat-turn`（DSH 的 `EvIC1a_flowItem` 上，
         * 实测形如 `data-chat-turn="13"`）。找不到返回 null ⇒ 调用方退回旧口径。
         * @param {Element} el
         * @returns {number|null}
         */
        function muvTurnOfEl(el) {
          try {
            var n = el, hop = 0
            while (n && hop < 8) {
              if (n.getAttribute) {
                var t = n.getAttribute('data-chat-turn')
                if (t !== null && t !== undefined && t !== '') {
                  var v = Number(t)
                  if (isFinite(v)) return v
                }
              }
              n = n.parentElement
              hop++
            }
          } catch (_) {}
          return null
        }

        async function decorateMessages() {
          if (_decorating) return
          _decorating = true
          try {
            var targets = messageTargets()
            // ★★ 权威 depth（2026-09-25）：`总楼数 − 本楼楼号`，与虚拟化的渲染窗口无关。
            //    拿不到权威来源（别的 DSH 版本/部署）⇒ 整条退回旧口径 `len-1-i`，
            //    行为与改动前一致，**不报错**。见 `muvSessionTurnsNow` 的长注释。
            var turns = muvSessionTurnsNow()
            for (var i = 0; i < targets.length; i++) {
              // 深度：排在**本条之后**的消息条数。最后一条 = 0，越旧越大。
              // 与 `regex-engine.js:depthAllows` 的口径一致（`[8]` 的 `minDepth = 7`
              // 就是拿这个数直接比大小）。
              var turn = muvTurnOfEl(targets[i].root)
              var depth = null
              var oldest = null
              if (turns && turn !== null) {
                var d = turns.total - turn
                depth = muvDepthFromLaterCount(d > 0 ? d : 0)
                // 首楼判据也用权威楼号（比"DOM 第一个容器"可靠：虚拟化下第一个渲染的
                // 未必是最旧那楼）—— 破格与开场白 depth 重试都依赖它。
                oldest = (turn === turns.first)
              }
              if (depth === null) depth = muvDepthFromLaterCount(targets.length - 1 - i)
              if (oldest === null) oldest = (i === 0)
              await _decorateOne(targets[i], depth, oldest)
            }
          } finally {
            _decorating = false
          }
        }

        /**
         * 我们自己产物的选择器 —— 一条 `[class*="muv-"]` 兜住全部。
         *
         * 不枚举类名：本项目已经栽过三次"枚举漏项"（见 `beautifyMuv` 里那段长注释），
         * 而 `muv-` 前缀是**我们自己的契约**，新增任何产物都自动在集合里。
         * 另加三个非 class 的记号：卡 iframe、跨帧 KV 属性、隐藏收件箱。
         */
        var MUV_OWN_SEL = '[class*="muv-"], iframe.muv-iframe, [data-muv-kv], [data-muv-inbox]'

        /**
         * 这个元素里（或它本身）已经有我们的装饰产物吗？
         * @param {Element} el
         * @returns {boolean}
         */
        function muvHasOwnArtifacts(el) {
          try {
            if (el.querySelector && el.querySelector(MUV_OWN_SEL)) return true
            if (el.matches && el.matches(MUV_OWN_SEL)) return true
          } catch (_) {}
          return false
        }

        /**
         * 取"这条消息的正文容器"。
         *
         * 调用方可能给我们正文容器本身，也可能给消息根节点 —— 后者**不能直接写**：
         * 替换它的 `innerHTML` 会毁掉 DSH 自己的 `_markdown_*` 元素（滚动时每次重建，
         * 而本装饰器就依赖它）。两种形态都归一到正文容器。
         * 面板 / 侧栏（`_paneBody_*` / `_surface_*`）里没有任何正文容器 ⇒ 返回 null，
         * 调用方据此**完全不碰**（实测这三个元素曾被当成消息装饰，面板内容被吃掉）。
         * @param {Element} el
         * @returns {Element|null}
         */
        function muvMessageBodyOf(el) {
          try {
            var cls = el.className
            if (typeof cls === 'string' && MSG_BODY_RE.test(cls)) return el
            var inner = el.querySelectorAll('[class*="_markdown_"]')
            if (inner.length === 1 && MSG_BODY_RE.test(String(inner[0].className || ''))) return inner[0]
          } catch (_) {}
          return null
        }

        /**
         * 取"干净的原文"：先把非正文的 DOM 临时藏起来，再读 `innerText`。
         *
         * 藏什么：按钮（酒馆注入的 ✏️ 编辑按钮等）、脚本/样式、我们自己的全部产物。
         * 为什么藏而不是克隆：`innerText` 依赖布局，脱离文档的克隆会退化成
         * `textContent` —— 块级子节点之间**没有分隔符**，整条消息会挤成一行，
         * 所有按行解析的卡逻辑都会退化（这是 `_decorateOne` 里那段长注释的老坑）。
         * hide → 读 → restore 全在同一帧内同步完成，不会看到闪烁。
         * @param {Element} body
         * @returns {string}
         */
        function muvRawTextOf(body) {
          var hidden = []
          try {
            var junk = body.querySelectorAll('button, script, style, textarea, ' + MUV_OWN_SEL)
            for (var i = 0; i < junk.length; i++) {
              var el = junk[i]
              if (!el.style) continue
              hidden.push([el, el.style.getPropertyValue('display')])
              el.style.setProperty('display', 'none', 'important')
            }
            return body.innerText || body.textContent || ''
          } catch (_) {
            return ''
          } finally {
            for (var j = 0; j < hidden.length; j++) {
              try {
                var prev = hidden[j][1]
                if (prev) hidden[j][0].style.setProperty('display', prev)
                else hidden[j][0].style.removeProperty('display')
              } catch (_) {}
            }
          }
        }

        /**
         * 这段文本是不是「整页 HTML 源码」—— 也就是**已经被（或本该被）iframe 呈现**、
         * 留在正文里只会变成一大段裸文本的那种？
         *
         * 背景（`ST-IFRAME-SPEC.md` §2 / §8 第 2 条）：ST 会给消息里残留的
         * `<pre><code>` 加 `hidden!` 隐藏。我们靠「整页 HTML 换成 iframe」绕过了
         * **大部分**情况，但**卡正则没产出整页文档**时（围栏没被认出来、或那条正则
         * 没命中），那一大段源码仍然露在正文里 —— 用户看到的就是"一大段裸文本"。
         *
         * ★ 判据刻意**窄**，且**不是**"所有代码块"：误伤的代价是用户正常的 ``` 代码块
         *   凭空消失（那是本项目栽过的"过度修复"）。只认整页文档：
         *   · `<!doctype html>` 且同时有 `<html` / `<head` / `<body` 之一；
         *   · 或 `<head` 与 `<body` 同时出现（没写 doctype 的整页文档）；
         *   · 或含 `__muvReset`（那是我们自己注入过的记号 ⇒ 这份文本**就是**卡文档）；
         *   · 外加长度 ≥ 200：挡掉"正文里举例提了一句 `<!DOCTYPE html>`"那种短文。
         * @param {string} text
         * @returns {boolean}
         */
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

        /**
         * 隐藏正文里**与 iframe 内容重复**的整页源码块 —— ST 给残留 `<pre><code>`
         * 加 `hidden!` 的等价物（我们跨源进不去子文档，只能在父页侧隐藏）。
         *
         * 只动 `<pre>`：DSH 的 markdown 把 ``` 围栏渲染成 `<pre><code>`，
         * 而"裸文档"必然是这么来的。
         *
         * ★ 不隐藏的两类（保守）：
         *   · 内容不像整页文档的普通代码块（判据见 `muvIsPageSourceText`）；
         *   · 落在**我们自己的产物**里面的 `<pre>`（变量折叠卡 / 摘要框里的 `<pre>`
         *     是我们渲染出来的，藏掉等于把刚渲染的东西又吞了）。
         *
         * 隐藏用**内联 `display:none!important`** 而不是 `hidden` 属性：DSH 与卡
         * 都可能给 `pre` 设过 `display`，属性会被 CSS 盖掉。同时打
         * `data-muv-src-hidden` 记号，让门禁（与以后的人）数得到。
         * @param {Element} body
         * @returns {number} 隐藏了几块
         */
        function muvHidePageSourceBlocks(body) {
          var n = 0
          try {
            if (!body || !body.querySelectorAll) return 0
            var pres = body.querySelectorAll('pre')
            for (var i = 0; i < pres.length; i++) {
              var el = pres[i]
              try {
                if (el.getAttribute('data-muv-src-hidden')) { n++; continue }
                if (el.closest && el.closest('[class*="muv-"]')) continue
              } catch (_) { }
              var t = ''
              try { t = el.textContent || '' } catch (_) { t = '' }
              if (!muvIsPageSourceText(t)) continue
              // ★ 第 40 轮：只隐藏 `<pre>` 会留下 DSH 的代码块**外壳** —— 那个外壳有
              //   圆角底 + 顶部横幅（横幅里写的就是围栏语言名；卡源码是 ```html ⇒
              //   横幅写着 **html**）+ 复制按钮 ⇒ 用户看到"一个写着 html 的空框"。
              //   所以这里**连外壳一起隐藏**，但只在「这条消息已经有卡 iframe」时：
              //   没有 iframe 说明卡没渲染成功，那块源码是用户唯一能看到的卡内容，
              //   藏掉等于吞内容（本项目栽过的过度修复）；有 iframe 才说明是**重复**。
              //   ★ 整段内联（不新开函数）：`buildFrom` 只抽依赖表里列出的函数，
              //     多一层声明在 `test-client-render` 的变异对照臂里会是 ReferenceError。
              var target = el
              try {
                if (el.closest) {
                  var msg = el.closest('[class*="_markdown_"]')
                  if (msg && msg.querySelector &&
                      msg.querySelector('.muv-statusbar-wrap, iframe.muv-iframe')) {
                    var shell = el.closest('.md-code-block')
                    if (shell && shell.querySelectorAll('pre').length <= 1) target = shell
                  }
                }
              } catch (_) { target = el }
              try {
                target.setAttribute('data-muv-src-hidden', '1')
                target.style.setProperty('display', 'none', 'important')
                n++
              } catch (_) { }
            }
          } catch (_) { }
          return n
        }

