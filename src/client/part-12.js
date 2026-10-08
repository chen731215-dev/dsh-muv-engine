
    function buildView(block, lang) {
      var source = codeTextOf(block).replace(/\s+$/, '');
      if (!source.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎬 ' + lang.toUpperCase() + ' 实时渲染';
      var srcBtn = makeButton('源码');
      var openBtn = makeButton('新窗口');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      bar.appendChild(openBtn);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-body';
      var frame = document.createElement('iframe');
      frame.className = 'dshv-frame';
      frame.title = 'visual render';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.srcdoc = renderDoc(source);
      frame.addEventListener('load', function () { sizeFrame(frame); });
      bodyWrap.appendChild(frame);

      root.appendChild(bar);
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '预览';
      });
      openBtn.addEventListener('click', function () {
        var win = window.open('', '_blank');
        if (!win) return;
        win.document.open();
        win.document.write(renderDoc(codeTextOf(block).replace(/\s+$/, '')));
        win.document.close();
      });

      var last = source;
      var timer = 0;
      var updater = function () {
        var now = codeTextOf(block).replace(/\s+$/, '');
        if (now === last) return;
        last = now;
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          if (!frame.isConnected) return;
          frame.srcdoc = renderDoc(last);
        }, 250);
      };
      var pre = block.querySelector('pre');
      var mo = new MutationObserver(updater);
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }


    function optionLines(source) {
      var out = [];
      var lines = String(source || '').split(/\n/);
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].replace(/^(?:[-*]\s+|(?:\d+[.)、]))+/, '').trim();
        if (t) out.push(t);
      }
      return out;
    }

    function buildOptions(block, lang) {
      var opts = optionLines(codeTextOf(block));
      if (!opts.length) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎲 剧情选项（点击后自动填入输入框）';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-body';
      var list = document.createElement('div');
      list.className = 'dshv-options';
      bodyWrap.appendChild(list);
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      function renderButtons() {
        var lines = optionLines(codeTextOf(block));
        list.innerHTML = '';
        for (var i = 0; i < lines.length; i++) {
          (function (text) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dshv-opt';
            btn.textContent = (i + 1) + ' · ' + text;
            btn.addEventListener('click', function () {
              if (btn.hasAttribute('data-dshv-picked')) return;
              btn.setAttribute('data-dshv-picked', '1');
              btn.textContent = '✓ ' + text;
              if (insertIntoInput(text)) {
                var status = document.createElement('div');
                status.className = 'dshv-opt-status';
                status.textContent = '已填入输入框，直接发送即可。';
                list.appendChild(status);
              }
            });
            list.appendChild(btn);
          })(lines[i]);
        }
      }
      renderButtons();

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '选项';
      });

      var timer = 0;
      var mo = new MutationObserver(function () {
        clearTimeout(timer);
        timer = window.setTimeout(renderButtons, 300);
      });
      var pre = block.querySelector('pre');
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }

    function buildAside(block, lang) {
      var text = codeTextOf(block).replace(/\s+$/, '');
      if (!text.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var root = document.createElement('div');
      root.className = 'dshv-root';

      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎙️ 旁白吐槽';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var body = document.createElement('div');
      body.className = 'dshv-aside';
      body.textContent = text;
      root.appendChild(body);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        body.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '旁白';
      });

      var timer = 0;
      var mo = new MutationObserver(function () {
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          body.textContent = codeTextOf(block).replace(/\s+$/, '');
        }, 250);
      });
      var pre = block.querySelector('pre');
      if (pre) mo.observe(pre, { childList: true, subtree: true, characterData: true });
    }

    function buildScene(block, lang) {
      var text = codeTextOf(block).replace(/\s+$/, '');
      if (!text.trim()) return;
      block.style.display = 'none';
      block.setAttribute(MARK, '1');

      var title = '', body = text;
      var m = text.match(/^#+\s*(.+)\s*\n([\s\S]*)$/);
      if (m) { title = m[1].trim(); body = m[2]; }
      var lines = body.split(/\n/);
      var html = '';
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\s+$/, '');
        if (!ln.trim()) { html += '<div class="dshv-sc-pad"></div>'; continue; }
        if (ln.match(/^\s*[-*]\s+/)) { html += '<div class="dshv-sc-item">' + escapeHtml(ln.replace(/^\s*[-*]\s+/, '')) + '</div>'; continue; }
        var dial = ln.match(/^\s*(?:「(?:\S*[:：]?)?)?(.+?)(?:」)?\s*[:：]\s*(.+)$/);
        if (dial) { html += '<div class="dshv-sc-line"><span class="dshv-sc-who">' + escapeHtml(dial[1]) + '</span><span class="dshv-sc-say">' + escapeHtml(dial[2]) + '</span></div>'; continue; }
        html += '<div class="dshv-sc-p">' + escapeHtml(ln) + '</div>';
      }

      var root = document.createElement('div');
      root.className = 'dshv-root dshv-scene';
      var bar = document.createElement('div');
      bar.className = 'dshv-bar';
      var label = document.createElement('span');
      label.className = 'dshv-label';
      label.textContent = '🎭 剧情场景' + (lang ? ' · ' + lang : '');
      label.style.marginRight = '0';
      var srcBtn = makeButton('源码');
      bar.appendChild(label);
      bar.appendChild(srcBtn);
      root.appendChild(bar);

      var bodyWrap = document.createElement('div');
      bodyWrap.className = 'dshv-sc-body';
      bodyWrap.innerHTML = (title ? '<div class="dshv-sc-title">' + escapeHtml(title) + '</div>' : '') + html;
      root.appendChild(bodyWrap);
      block.insertAdjacentElement('afterend', root);

      var previewing = true;
      srcBtn.addEventListener('click', function () {
        previewing = !previewing;
        block.style.display = previewing ? 'none' : '';
        bodyWrap.style.display = previewing ? 'block' : 'none';
        srcBtn.textContent = previewing ? '源码' : '场景';
      });

      var timer = 0;
      var updater = function () {
        var now = codeTextOf(block).replace(/\s+$/, '');
        if (now === text) return;
        text = now;
        clearTimeout(timer);
        timer = window.setTimeout(function () {
          var mm = text.match(/^#+\s*(.+)\s*\n([\s\S]*)$/);
          var t2 = mm ? mm[1].trim() : '';
          var b2 = mm ? mm[2] : text;
          var l2 = b2.split(/\n/), h2 = '';
          for (var j = 0; j < l2.length; j++) {
            var s = l2[j].replace(/\s+$/, '');
            if (!s.trim()) { h2 += '<div class="dshv-sc-pad"></div>'; continue; }
            if (s.match(/^\s*[-*]\s+/)) { h2 += '<div class="dshv-sc-item">' + escapeHtml(s.replace(/^\s*[-*]\s+/, '')) + '</div>'; continue; }
            var dd = s.match(/^\s*(?:「(?:\S*[:：]?)?)?(.+?)(?:」)?\s*[:：]\s*(.+)$/);
            if (dd) { h2 += '<div class="dshv-sc-line"><span class="dshv-sc-who">' + escapeHtml(dd[1]) + '</span><span class="dshv-sc-say">' + escapeHtml(dd[2]) + '</span></div>'; continue; }
            h2 += '<div class="dshv-sc-p">' + escapeHtml(s) + '</div>';
          }
          bodyWrap.innerHTML = (t2 ? '<div class="dshv-sc-title">' + escapeHtml(t2) + '</div>' : '') + h2;
        }, 250);
      };
      var pre = block.querySelector('pre');
      if (pre) { var mo = new MutationObserver(updater); mo.observe(pre, { childList: true, subtree: true, characterData: true }); }
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function stats() {
      var blocks = document.querySelectorAll('.md-code-block');
      var wrapped = document.querySelectorAll('.dshv-root').length;
      var langs = [];
      for (var i = 0; i < blocks.length; i++) {
        var l = langOf(blocks[i]);
        if (l) langs.push(l);
      }
      return { codeBlocks: blocks.length, wrappedBlocks: wrapped, langs: langs };
    }

    var VR_ENTRY = '[data-dsh-vr-entry]';
    var VR_PANEL = '[data-dsh-vr-view]';
    var VR_ACTIVE = 'data-dsh-vr-active';

