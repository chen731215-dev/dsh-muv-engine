
      muvSanitize()
      var _muvSanRaf = 0
      var _muvSanObs = new MutationObserver(function(){
        if (_muvSanRaf) return
        _muvSanRaf = window.requestAnimationFrame(function(){ _muvSanRaf = 0; muvSanitize() })
      })
      _muvSanObs.observe(document.body, { childList: true, subtree: true })

      // ★★★ dsh-visual-render 代码块渲染（visual/options/aside/scene）★★★
      ;(function() {
    var LANG_RE = /^(visual|dsh-html|vhtml)$/i;
    var OPTIONS_LANG_RE = /^options$/i;
    var ASIDE_LANG_RE = /^(aside|narration|narrador)$/i;
    var SCENE_LANG_RE = /^(scene|juqing|drama|剧本|场景)$/i;
    var MARK = 'data-dshv-processed';

    // ★ 与 `.muv-statusbar-wrap` 同一类塌陷，同一套撑满声明（`.dshv-frame` 里也是 `width:100%`）。
    //   visual 帧会落在聊天消息里（同样是"由内容决定宽度"的容器），不显式撑满会塌成 300px。
    var UI_CSS = `.dshv-root{display:block;width:100%;min-width:0;align-self:stretch;box-sizing:border-box;margin:12px 0;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.2));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.05));backdrop-filter:blur(8px);}
.dshv-bar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06));border-bottom:1px solid var(--dsw-alias-border, rgba(127,127,127,.15));font-size:12.5px;}
.dshv-label{font-weight:600;color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));margin-right:auto;letter-spacing:.3px;}
.dshv-btn{border:1px solid var(--dsw-alias-border, rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-primary, inherit);border-radius:6px;padding:3px 10px;font-size:11px;line-height:1.5;cursor:pointer;font-family:inherit;transition:all .15s ease;}
.dshv-btn:hover{background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12));}
.dshv-body{background:transparent;color:var(--dsw-alias-label-primary, inherit);}
.dshv-frame{width:100%;min-height:360px;border:0;display:block;}
.dshv-options{display:flex;flex-direction:column;gap:8px;padding:14px;}
.dshv-opt{text-align:left;border:1px solid var(--dsw-alias-border, rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,.12));color:var(--dsw-alias-label-primary, inherit);border-radius:10px;padding:10px 14px 10px 40px;font-size:13.5px;cursor:pointer;line-height:1.6;font-family:inherit;position:relative;transition:all .18s cubic-bezier(.4,0,.2,1);word-break:break-word;}
.dshv-opt::before{content:attr(data-idx);position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-bg-layer-3, rgba(127,127,127,.15));color:var(--dsw-alias-label-secondary, rgba(127,127,127,.7));font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;transition:all .18s ease;}
.dshv-opt:hover{border-color:rgba(59,127,240,.5);background:var(--dsw-alias-bg-layer-2, rgba(59,127,240,.06));transform:translateX(3px);box-shadow:0 2px 12px rgba(59,127,240,.12);}
.dshv-opt:hover::before{background:#3b7ff0;color:#fff;}
.dshv-opt[data-dshv-picked]{border-color:#3b7ff0;background:rgba(59,127,240,.1);box-shadow:0 0 0 3px rgba(59,127,240,.12);}
.dshv-opt[data-dshv-picked]::before{background:#3b7ff0;color:#fff;content:"✓";}
.dshv-opt-status{padding:2px 4px 0;font-size:12px;color:var(--dsw-alias-label-tertiary, rgba(127,127,127,.55));}
.dshv-aside{padding:6px 12px;font-size:11.5px;line-height:1.7;font-style:italic;color:var(--dsw-alias-label-tertiary,#9aa3b2);opacity:.72;border-left:2px solid var(--dsw-alias-border, rgba(127,127,127,.22));white-space:pre-line;}
html body [class*="tavern" i],html body [class*="agent-preset" i],html body [class*="style" i],html body [class*="skin" i],html body [class*="theme" i]{position:static !important;transform:none !important;left:auto !important;top:auto !important;margin:initial !important;max-height:none !important;overflow-y:visible !important;}
/* 上面两块（入口 / hover / 选中）原来是硬编码的深色壳 + 浅色字：
   color:#e8ecf4 + background:rgba(22,27,38,.5)、hover 的 color:#ffffff。
   浅色主题下侧栏底色是 rgb(249,250,251) ⇒ 浅色字压在浅底上，实测对比度 1.06:1
   （工具 dsh-live23「浅色·首页侧栏」），等于看不见。改成 DSH 主题变量：
   两个主题都跟随宿主，观感也和宿主自己的侧栏一致。 */
html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry],html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry],html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry],html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision],html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern],html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry],html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry],html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry{color:var(--dsw-alias-label-primary) !important;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)) !important;border-radius:8px !important;}html body [data-pane="sidebar"] [data-dsh-lewdscale-entry][data-dsh-lewdscale-entry]:hover,html body [data-pane="sidebar"] [data-dsh-possess-entry][data-dsh-possess-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-entry][data-dsh-datatools-entry]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-vision][data-dsh-datatools-vision]:hover,html body [data-pane="sidebar"] [data-dsh-datatools-tavern][data-dsh-datatools-tavern]:hover,html body [data-pane="sidebar"] [data-dsh-tavern-entry][data-dsh-tavern-entry]:hover,html body [data-pane="sidebar"] [data-dsh-session-cleaner-entry][data-dsh-session-cleaner-entry]:hover,html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry:hover,html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry:hover{color:var(--dsw-alias-label-primary) !important;background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18)) !important;}html body [data-pane="sidebar"] .iMJmYa_entry.iMJmYa_entry[data-active],html body [data-pane="sidebar"] .XSL7ga_entry.XSL7ga_entry[data-active]{color:var(--dsw-alias-label-primary) !important;background:rgba(59,127,240,.38) !important;}
html body [data-dsh-tavern-manager-entry]{display:none !important;}
html body [data-dsh-style-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:132px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
html body [data-dsh-vr-entry]{position:fixed !important;left:auto !important;top:auto !important;bottom:144px !important;right:20px !important;width:auto !important;height:auto !important;background:#3b7ff0 !important;color:#ffffff !important;font-weight:600 !important;border-radius:999px !important;padding:8px 16px !important;box-shadow:0 4px 16px rgba(0,0,0,.35) !important;z-index:99999 !important;display:flex !important;align-items:center !important;gap:6px !important;outline:none !important;border:0 !important;text-shadow:none !important;}
/* ★ 第 40 轮：原来是 color:#1f2329 !important（深灰近黑）——深色模式下宿主面板底色是
   rgb(44,44,46)，实测对比度 1.14:1，设置导航十个条目在深色模式下几乎不可见（用户第一
   优先级报的就是这个）。改成 DSH 主题变量：浅色里深灰、深色里自动变浅灰/白，两个主题
   都可读。opacity:1 / text-shadow:none 是当初为了压住宿主自带的半透明与阴影，保留。 */
.VOzbGW_navCell,.VOzbGW_navTitle,.VOzbGW_navLabel,.VOzbGW_navIcon{color:var(--dsw-alias-label-secondary,#1f2329) !important;opacity:1 !important;text-shadow:none !important;}
.VOzbGW_navCell.VOzbGW_active{color:var(--dsw-alias-label-primary,#ffffff) !important;}
.dshv-root.dshv-scene .dshv-sc-body{background:linear-gradient(180deg,#fbf6ee,#f3ead8);color:#3a2f1d;padding:16px 18px;}
.dshv-root.dshv-scene .dshv-sc-title{font-size:17px;font-weight:700;margin-bottom:10px;color:#5b3a12;letter-spacing:1px;}
.dshv-root.dshv-scene .dshv-sc-p{font-size:14px;line-height:1.9;margin:0 0 6px;text-indent:2em;}
.dshv-root.dshv-scene .dshv-sc-pad{height:8px;}
.dshv-root.dshv-scene .dshv-sc-item{font-size:13.5px;color:#6b5633;margin:0 0 5px;padding-left:12px;border-left:2px solid #c5a468;}
.dshv-root.dshv-scene .dshv-sc-line{display:flex;gap:8px;margin:4px 0;}
.dshv-root.dshv-scene .dshv-sc-who{flex:none;font-weight:700;color:#8a4b2a;min-width:56px;}
.dshv-root.dshv-scene .dshv-sc-say{flex:1;color:#3a2f1d;line-height:1.7;}
button.Kad6XG_iconButton{width:26px !important;height:26px !important;color:#3b7ff0 !important;background:rgba(59,127,240,.12) !important;border:1px solid rgba(59,127,240,.4) !important;border-radius:6px !important;opacity:1 !important;pointer-events:auto !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;}
button.Kad6XG_iconButton:hover{color:#fff !important;background:#3b7ff0 !important;}
button.Kad6XG_iconButton svg{width:16px !important;height:16px !important;fill:currentColor !important;}
.nFunOq_iconButton,.nFunOq_rerollButton{color:#3b7ff0 !important;opacity:1 !important;border-color:rgba(59,127,240,.5) !important;background:rgba(59,127,240,.1) !important;}
.nFunOq_iconButton:hover,.nFunOq_rerollButton:hover{color:#fff !important;background:#3b7ff0 !important;}
/* ★ 第 40 轮：原来这一行把侧栏的 --dsw-alias-label-* 全部 !important 重写成浅蓝
   系（#dbe4f7 / #c6d1e9 / …），再给容器上 color:#dbe4f7 !important。那是**照着深色
   侧栏调**的，浅色主题下侧栏底色是 rgb(249,250,251)，浅蓝字压浅底 = 实测对比度
   1.06:1（dsh-live23「浅色·首页侧栏」）。DSH 自己在深色下给侧栏的就是
   --dsw-alias-label-primary（实测 rgb(249,250,251)，比我们这条更亮），所以**直接
   去掉重写**、让宿主变量生效即可 —— 两个主题都跟宿主，观感也统一。 */
html body [data-pane="sidebar"][data-pane="sidebar"] button,html body [data-pane="sidebar"][data-pane="sidebar"] button span,html body [data-pane="sidebar"][data-pane="sidebar"] button svg,html body [data-pane="sidebar"][data-pane="sidebar"] [role="button"] svg{color:var(--dsw-alias-label-primary) !important;fill:currentColor !important;opacity:1 !important;text-shadow:none !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] button:hover,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover span,html body [data-pane="sidebar"][data-pane="sidebar"] button:hover svg{color:var(--dsw-alias-label-primary) !important;}
html body [data-pane="sidebar"][data-pane="sidebar"] .hHd-Xa_iconButton.hHd-Xa_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_iconButton.qDHVXG_iconButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_searchButton.qDHVXG_searchButton,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_headerActions.qDHVXG_headerActions,html body [data-pane="sidebar"][data-pane="sidebar"] .qDHVXG_sectionLabel.qDHVXG_sectionLabel{color:var(--dsw-alias-label-secondary) !important;fill:currentColor !important;background:transparent !important;border-color:transparent !important;}
`;


    var LIB_CSS = `*{box-sizing:border-box;}
body{margin:0;padding:18px;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#23272e;background:#f2f4f7;}
.browser{width:100%;max-width:860px;margin:0 auto;border-radius:10px;overflow:hidden;background:#fff;color:#23272e;box-shadow:0 12px 32px rgba(0,0,0,.18);}
.browser-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#e8eaee;border-bottom:1px solid #d5d8dd;}
.dot{width:12px;height:12px;border-radius:50%;flex:none;}
.dot.red{background:#ff5f57;}.dot.yellow{background:#febc2e;}.dot.green{background:#28c840;}
.address{flex:1;display:flex;align-items:center;gap:6px;background:#fff;border-radius:6px;padding:5px 10px;font-size:13px;color:#555b66;margin-left:6px;}
.nav{display:flex;align-items:center;gap:22px;padding:12px 28px;border-bottom:1px solid #edeff2;font-size:14px;}
.nav .logo{font-weight:700;color:#1456cc;margin-right:auto;}
.nav a{color:#4a5160;text-decoration:none;}
.hero{padding:44px 28px;background:linear-gradient(135deg,#1456cc,#3b7ff0 60%,#6ea8ff);color:#fff;}
.hero h1{margin:0 0 10px;font-size:30px;}
.hero p{margin:0 0 18px;font-size:14px;opacity:.9;}
.hero button{border:0;background:#fff;color:#1456cc;font-size:14px;padding:9px 22px;border-radius:20px;cursor:pointer;}
.content-grid{display:grid;grid-template-columns:1fr 260px;gap:24px;padding:24px 28px 30px;}
.article h3{margin:0 0 10px;font-size:18px;}
.article p{font-size:14px;line-height:1.9;color:#3c434e;margin:0;}
.sidebar{background:#f5f7fa;border-radius:8px;padding:14px 16px;}
.sidebar h4{margin:0 0 10px;font-size:13px;color:#1456cc;}
.sidebar ul{margin:0;padding-left:18px;font-size:13px;color:#4a5160;line-height:2;}
.footer{padding:14px 28px;border-top:1px solid #edeff2;font-size:12px;color:#8b93a1;text-align:center;}
.phone{width:100%;max-width:380px;margin:0 auto;background:#0f1115;border-radius:30px;padding:10px 8px 14px;box-shadow:0 12px 32px rgba(0,0,0,.25),inset 0 0 0 2px #000;}
.screen{background:#f4f5f7;border-radius:22px;overflow:hidden;color:#23272e;}
.statusbar{display:flex;justify-content:space-between;padding:8px 18px 4px;font-size:12px;}
.chat-head{display:flex;align-items:center;gap:10px;padding:8px 14px 10px;border-bottom:1px solid #e6e8ec;background:#fff;}
.back{border:0;background:transparent;font-size:22px;line-height:1;color:#23272e;cursor:pointer;padding:0;}
.chat-title{font-weight:600;font-size:15px;}
.chat-head .more{margin-left:auto;color:#8b93a1;font-size:14px;letter-spacing:2px;}
.chat-body{display:flex;flex-direction:column;gap:10px;padding:18px 14px;min-height:240px;}
.bubble{max-width:78%;padding:9px 13px;font-size:14px;line-height:1.6;border-radius:10px;}
.bubble.left{align-self:flex-start;background:#fff;border-top-left-radius:3px;}
.bubble.right{align-self:flex-end;background:#95ec69;border-top-right-radius:3px;}
.chat-time{text-align:center;font-size:11px;color:#9aa3b2;}
.chat-input{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e6e8ec;}
.chat-input .plus{font-size:22px;color:#4a5160;}
.chat-input .field{flex:1;background:#f4f5f7;border-radius:6px;padding:7px 10px;font-size:13px;color:#9aa3b2;}
.chat-input .send{border:0;background:#07c160;color:#fff;border-radius:6px;padding:7px 14px;font-size:13px;cursor:pointer;}
.terminal{width:100%;max-width:720px;margin:0 auto;background:#050806;border:1px solid #1d2b1f;border-radius:8px;padding:20px 22px;font-family:Consolas,"Courier New",monospace;font-size:14px;line-height:1.9;color:#33ff66;text-shadow:0 0 6px rgba(51,255,102,.6);box-shadow:0 0 32px rgba(51,255,102,.1),inset 0 0 60px rgba(51,255,102,.04);white-space:pre-wrap;word-break:break-all;}
.terminal.amber{color:#ffb000;text-shadow:0 0 6px rgba(255,176,0,.6);box-shadow:0 0 32px rgba(255,176,0,.12),inset 0 0 60px rgba(255,176,0,.04);}
.cursor{animation:dshv-blink 1s steps(2,start) infinite;}
@keyframes dshv-blink{to{visibility:hidden;}}
.letter{width:100%;max-width:560px;margin:0 auto;position:relative;padding:46px 52px 88px;font-family:"Kaiti SC","STKaiti","KaiTi","SimSun",serif;color:#3a3226;background:radial-gradient(120% 90% at 18% 0%,rgba(160,120,60,.1),transparent 55%),radial-gradient(120% 90% at 82% 100%,rgba(160,120,60,.12),transparent 55%),linear-gradient(180deg,#f8f1df,#f2e7cc);border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.2),0 16px 40px rgba(0,0,0,.25);}
.letter::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(96,74,40,.12);transform:translateX(-50%) rotate(1.5deg);}
.letter-head{text-align:right;font-size:13px;color:#6d5f45;margin-bottom:26px;letter-spacing:1px;}
.letter .salutation{font-size:18px;margin:0 0 14px;}
.letter .body-p{font-size:16px;line-height:2.1;text-indent:2em;margin:0 0 10px;text-shadow:0 0 2px rgba(0,0,0,.45);}
.letter .sign{text-align:right;margin-top:34px;font-size:17px;letter-spacing:2px;padding-right:96px;}
.letter .ps{margin-top:30px;padding-top:12px;padding-right:110px;border-top:1px dashed rgba(96,74,40,.35);font-size:14px;color:#6d5f45;}
.seal{position:absolute;right:34px;bottom:36px;width:78px;height:78px;border-radius:50%;border:3px solid rgba(178,34,34,.72);color:rgba(178,34,34,.85);display:flex;align-items:center;justify-content:center;font-size:34px;transform:rotate(-12deg);box-shadow:inset 0 0 6px rgba(178,34,34,.25);}
.newspaper{width:100%;max-width:760px;margin:0 auto;background:#e9e4d1;color:#26221a;border:2px solid #b6ad93;padding:26px 30px 32px;box-shadow:0 16px 40px rgba(0,0,0,.25);font-family:"Songti SC","STSong","SimSun",serif;}
.masthead{text-align:center;}
.masthead h1{margin:0 0 8px;font-size:44px;letter-spacing:10px;font-weight:900;}
.dateline{font-size:12px;letter-spacing:3px;border-top:3px double #26221a;border-bottom:1px solid #26221a;padding:5px 0;margin-bottom:18px;}
.news-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:18px;}
.news-grid article{font-size:13px;line-height:1.9;}
.news-grid article+article{border-left:1px solid #b6ad93;padding-left:18px;}
.news-grid h2{font-size:19px;line-height:1.5;margin:0 0 8px;}
.news-grid .lead h2{font-size:26px;}
.news-grid p{text-indent:2em;margin:0 0 8px;}
.news-grid .byline{font-size:11px;color:#6d6450;text-indent:0;letter-spacing:1px;}
@media (max-width:640px){.content-grid{grid-template-columns:1fr;}.news-grid{grid-template-columns:1fr;}.news-grid article+article{border-left:0;border-top:1px solid #b6ad93;padding-left:0;padding-top:14px;}}`;

    var uiInjected = false;
    function injectUiCss() {
      if (uiInjected) return;
      if (document.querySelector('style[data-plugin-css="dsh-visual-render-ui"]')) { uiInjected = true; return; }
      var tag = document.createElement('style');
      tag.dataset.pluginCss = 'dsh-visual-render-ui';
      tag.textContent = UI_CSS;
      document.head.appendChild(tag);
      uiInjected = true;
    }

    function renderDoc(source) {
      return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">' +
        '<style>' + LIB_CSS + '</style></head><body>' + source + '</body></html>';
    }

    function langOf(block) {
      var wrap = block.firstElementChild;
      if (!wrap) return '';
      var banner = wrap.firstElementChild;
      if (!banner) return '';
      var info = banner.firstElementChild;
      if (!info) return '';
      var text = (info.textContent || '').trim();
      return text.split(/\s+/)[0] || '';
    }

    function codeTextOf(block) {
      var pre = block.querySelector('pre');
      return pre ? pre.textContent : '';
    }

    function makeButton(label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dshv-btn';
      btn.textContent = label;
      return btn;
    }

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

    function vrSidebarRoot() {
      var column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
      if (!column) return undefined;
      var logoOwner = column.querySelector('[class*="logoRow"]') ? column.querySelector('[class*="logoRow"]').parentElement : undefined;
      return logoOwner || (column.firstElementChild || undefined);
    }

    function vrNewSessionButton(root) {
      var nested = root.querySelector('button[class*="newSession"]');
      if (nested) return nested;
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i].tagName === 'BUTTON') return root.children[i];
      }
      return undefined;
    }

    function vrCreateEntry() {
      var entry = document.createElement('button');
      entry.type = 'button';
      entry.dataset.dshVrEntry = '';
      // ★ 第 40 轮：`background:rgba(255,255,255,.06)` + `color:#e8ecf4` 是照深色侧栏调的，
      //   浅色主题下浅字压浅底（实测 1.06:1）看不见 ⇒ 改用 DSH 主题变量，两个主题都跟随宿主。
      entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;width:100%;max-width:100%;padding:8px 12px;background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10));border:none;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;text-align:left;border-radius:8px;';
      var icon = document.createElement('span');
      icon.textContent = '🎬';
      icon.style.cssText = 'flex:0 0 auto;display:inline-block;line-height:1;font-size:15px;';
      var label = document.createElement('span');
      label.textContent = '视觉渲染';
      label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;line-height:1.4;';
      entry.appendChild(icon);
      entry.appendChild(label);
      return entry;
    }

    function vrCreatePanel() {
      var panel = document.createElement('div');
      panel.dataset.dshVrView = '';
      panel.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,14,.55);z-index:1300;display:none;align-items:flex-start;justify-content:center;padding:10vh 16px;box-sizing:border-box;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif);';
      var card = document.createElement('div');
      // ★ 第 40 轮：原来是 `background:#ffffff;color:#1c2024`（写死的白卡）——深色模式下一块
      //   刺眼的白面板。改成 DSH 主题变量（回退值保留浅色观感），两个主题都跟宿主。
      card.style.cssText = 'background:var(--dsw-alias-bg-layer-1,#ffffff);color:var(--dsw-alias-label-primary,#1c2024);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));border-radius:12px;max-width:520px;width:100%;padding:16px;box-shadow:0 24px 64px rgba(0,0,0,.45);font-size:13px;line-height:1.7;';
      card.innerHTML = [
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><strong style="font-size:15px">🎬 视觉渲染状态</strong><button data-dsh-vr-close type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:2px 10px;cursor:pointer">✕</button></div>',
        '<div style="background:var(--dsw-alias-bg-layer-2,#f5f7fb);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;line-height:1.8"><strong>🎯 这个按钮不用点——渲染是全自动的。</strong><br>当聊天里出现 <code>\`\`\`visual</code> / <code>\`\`\`options</code> / <code>\`\`\`aside</code> 代码块时会自动变漂亮：<br>📜 visual → 信纸 / 终端 / 报纸 / 手机 / 浏览器界面<br>🎲 options → 三个可点击的剧情选项<br>🎙️ aside → 淡色小字旁白<br>这里只是状态面板，用来看渲染数量。</div>',
        '<div data-dsh-vr-stats style="opacity:.85"></div>',
        '<div data-dsh-vr-diag style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.15));font-size:11px;opacity:.75;white-space:pre-wrap;line-height:1.6"></div>',
        '<div style="display:flex;gap:8px;margin-top:10px"><button data-dsh-vr-rescan type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px">🔄 重新扫描</button><button data-dsh-vr-close2 type="button" style="border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px">关闭</button></div>',
        '<div style="margin-top:8px;opacity:.55;font-size:11.5px">支持的语言块：visual（界面渲染）/ options（三选一按钮）/ aside（淡色旁白）。langs 为空表示本页没有这些代码块。</div>'
      ].join('');
      panel.appendChild(card);
      return panel;
    }

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

        /**
         * Decorate one message.
         *
         * Writes into the *body* element's innerHTML and never the message root:
         * the root is DSH's own wrapper, and replacing it destroys the
         * `_markdown_*` element this decorator relies on (and re-renders on every
         * scroll). Accepts either a `{body, root}` pair or a bare element.
         * @param {{body:Element, root:Element}|Element} target
         * @param {number} [depth] SillyTavern 口径的层号（省略时 0）
         */
        async function _decorateOne(target, depth, isOldestFloor) {
          var body = target && target.body ? target.body : target
          var root = target && target.root ? target.root : target
          if (!body || body.nodeType !== 1) return
          if (body.getAttribute(DECORATED_ATTR) === '1') return
          // 流式输出中的消息先不动，等它写完
          if (root && root.closest && root.closest('[data-streaming]')) return
          if (body.closest && body.closest('[data-streaming]')) return

          // ★★ 三条守卫（2026-09-22 现场取证加的，HANDOFF §22）。
          //
          // 为什么必须有：`raw` 是从 DOM 的 `innerText` 取的，而**我们自己的装饰
          // 产物就长在那个 DOM 里** —— `.muv-statusbar-wrap`（卡 iframe）、
          // `<Abstract>` 换成的 `.muv-abstract`（📖 框）、`.muv-varthink`
          // （「💭 变量推演」），外加酒馆插件注入的 ✏️ 编辑按钮。
          // 一旦对同一个元素（或**包着它的**容器）再跑一遍，`innerText` 拿到的是
          // **我们自己渲染出来的文字**：
          //   · 卡正则 `<(?:content|…)>…</…>` 还是字面量、照样匹配 ⇒ 文档照建；
          //   · 但 `<Abstract>` 的**标签**早被换成了 `<div class="muv-abstract">`，
          //     于是 card [7]「对玩家隐藏摘要」（`/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`
          //     —— 大小写敏感 + 行锚）必然落空 ⇒ 摘要正文（时间/地点/摘要内容）
          //     **永久露在正文里**，还被当成正文塞进整页文档；
          //   · 我们自己的标签文字（📖 / 💭 变量推演 / ✏️）也一并变成正文。
          // 用户看到的「时间出现的地方不对劲」「选项/日常之外多出一堆怪文字」就是这个。
          //
          // ① 已经是我们的产物 ⇒ 绝不重复装饰（`innerText` 已经不可逆地丢了原始标签）。
          if (muvHasOwnArtifacts(body)) return
          // ② 目标规范化 + 只认"消息正文"：拿到 `_markdown_*` 正文容器本身再写，
          //    绝不写消息根节点（会毁掉 DSH 自己的正文元素），也绝不碰面板/侧栏
          //    （实测 DSH 的 `_paneBody_*` / `_surface_*` 曾被当成消息，面板内容被吃掉）。
          var normalizedBody = muvMessageBodyOf(body)
          if (!normalizedBody) return
          if (!root) root = body
          body = normalizedBody
          if (body.getAttribute(DECORATED_ATTR) === '1') return

          var raw = ''
          try {
            // innerText, not textContent: textContent concatenates block children
            // with no separator, so a message DSH rendered as several <p> would
            // arrive as one long line and every line-based parser would see a
            // single field. innerText keeps the rendered line breaks.
            //
            // ③ 取文前先把**非正文的 DOM**（按钮/脚本/我们自己的产物）临时隐藏：
            //    酒馆的 ✏️ 编辑按钮、徽标这类注入 UI 的文字同样会污染原文。
            //    隐藏而非克隆 —— 脱离文档的克隆上 `innerText` 会退化成 `textContent`，
            //    那正是上面这段注释要避免的。同一帧内同步 hide→读→restore，不会闪。
            raw = muvRawTextOf(body)
          } catch (_) { return }
          if (!raw) return
          // 记进 chat 环形缓冲，供卡的 `getContext().chat` 扫 CG 解锁标记。
          // 放在这里（而不是 `beautifyMuv` 里）是因为上面两行已经把「流式中的消息」
          // 和「已装饰过的消息」都挡掉了 ⇒ 每条消息**只记一次**，不会把 80 条上限
          // 灌满半截文本。
          muvPushChatLog(raw)
          // ★ 运行时变量回灌：消息里带 <UpdateVariable>/<initvar>/<VariableEdit>/<era_data>
          //   就喂给服务端（ERA 增量块按消息键时序重放）—— era 桥从此有运行时数值可送
          //   （卡的选项/数值/CG 解锁都靠它）。
          //   ★ 喂 **innerHTML** 而不是 innerText：DSH 把消息渲染成元素时标签名不在
          //   innerText 里（只剩 JSON 文本），innerHTML 两种形态都在。
          try { muvFeedVariables(body.innerHTML) } catch (_) { muvFeedVariables(raw) }
          var html = null
          try {
            // ★ 把 depth 交给取卡那一步（`/api/muv-engine/apply-regex-card` 的
            //   `body.depth`）。**不传它就等于 depth 0** —— 卡里 `minDepth = 7` 的
            //   `[8]「自动总结，隐藏6楼以上除摘要外内容」` 会永远拿不到自己该生效的那一层，
          //   而 `[7]` 又把 `<Abstract>` 删掉 ⇒ 旧楼层"无摘要的全文"，两头都落空。
            // ★ fullpage 旗标（2026-09-25 恢复）：isOldestFloor ⇒ 本条是开场白/封面楼，
            //   产出链据此给整页卡 wrap 加 `muv-fullpage`（破格只认这个类）。
            //   await 期间不放行其它装饰（decorateMessages 串行），finally 复位防泄漏。
            muvFullpageFloor = isOldestFloor === true
            // ★ 键取证（默认关；开 `window.__MUV_KEY_TRACE = true` 才记）：
            //   把本轮**将要使用**的缓存键原样记下来。键字符串本身含全部分量
            //   （`sid|ck|d<n>[|fp]|v<m>`），两次通过逐分量比对即可定位是哪一项在漂
            //   —— 用于「切回会话为什么仍 miss」，不再靠改假设回测（2026-09-25）。
            try {
              if (window.__MUV_KEY_TRACE) {
                if (!window.__muvKeyLog) window.__muvKeyLog = []
                if (window.__muvKeyLog.length < 800) {
                  window.__muvKeyLog.push({
                    turn: muvTurnOfEl(root),
                    d: depth,
                    key: muvDecorKeyOf(raw, muvDepthFromLaterCount(depth)),
                    rawLen: String(raw == null ? '' : raw).length,
                    rawHead: String(raw == null ? '' : raw).replace(/\s+/g, ' ').slice(0, 32)
                  })
                }
              }
            } catch (_) {}
            try {
              html = await beautifyMuv(raw, { depth: muvDepthFromLaterCount(depth) })
            } finally {
              muvFullpageFloor = false
            }
          } catch (e) {
            // ★ 不许静默（2026-09-24）：beautifyMuv 内部已留痕，这里再兜一层是防
            //   它在进入内部 try 之前就抛（如 normalizeStatusHeader）。吞掉 = 消息
            //   钉死成"已装饰、无产物"且零日志 —— 苍玄界整晚排错的学费。
            html = null
            try { console.warn('[muv] beautifyMuv 抛错：', e && (e.stack || e.message || e)) } catch (_) {}
          }
          // ★ 开场白的 depth 重试（2026-09-24，苍玄界实锤）：
          //   社区卡的开场白正则普遍 `maxDepth: 0`（只作用于最新一楼）—— ST 在
          //   新会话播种时对 first_mes **不传 depth**（script.js:7660
          //   `getRegexedString(firstMes, AI_OUTPUT)`，深度检查整段跳过）⇒ 开场白
          //   永远出封面。而我们老会话里首楼 depth = 后面的楼数 ⇒ `maxDepth:0`
          //   落空 ⇒ 裸占位符。
          //   重试条件（对齐 ST 播种语义）：**首楼**（DOM 第一个消息容器 ≈ 开场白楼，
          //   isOldestFloor）且首跑原样返回且 depth>0 ⇒ 用 depth 0 再试一次。
          //   苍玄界的 first_mes 是「【GameStart】 + 几 KB 正文」，所以**不能**
          //   按文本长度判 —— 必须按楼位判。风险与取舍：首楼长正文的首跑若被
          //   depth 拒掉，重试会应用 maxDepth 小的脚本 —— 首楼几乎总是开场白楼，
          //   这正是要的效果；`[8]`类 minDepth 脚本在 depth 0 时照样跳过，不受影响。
          if ((!html || html === raw) && isOldestFloor && depth > 0) {
            // 重试同样在 fullpage 旗标下跑（开场白楼重试产出的封面文档照旧破格）。
            muvFullpageFloor = true
            try {
              html = await beautifyMuv(raw, { depth: 0 })
            } catch (e) {
              html = null
              try { console.warn('[muv] 开场白 depth 重试抛错：', e && (e.stack || e.message || e)) } catch (_) {}
            } finally {
              muvFullpageFloor = false
            }
          }
          if (html && html !== raw) {
            try { applyDecoratedHtml(body, html, raw) } catch (e) {
              try { console.warn('[muv] applyDecoratedHtml 写入失败：', e && (e.stack || e.message || e)) } catch (_) {}
            }
            // The swap rebuilds the message's HTML from plain text, which
            // discards anything the sanitize pass had already produced in this
            // element (`<choices>` → buttons) and re-marks it so the pass never
            // revisits it. That is how the option buttons disappeared. Clear
            // the mark and re-run the pass over just this element.
            try {
              body.removeAttribute('data-muv-sanitized')
              if (typeof muvSanitizeNode === 'function') muvSanitizeNode(body)
            } catch (_) {}
          }
          // ★ 最后一步：把"与 iframe 内容重复"的整页源码块藏起来（ST 的 `hidden!`）。
          //   放在装饰之后：整页文档**已经变成 iframe** 的那些，正文里对应的 `<pre>`
          //   可能仍在（卡正则没产出文档时的裸文本正是要靠这一步收掉）。
          //   装饰失败也不影响它 —— 它是纯 DOM 操作，不依赖上面的结果。
          try { muvHidePageSourceBlocks(body) } catch (_) {}
          // ★ 取卡「未决」时不钉已装饰标记（2026-09-24）：否则切会话瞬间的那条
          //   greeting 会因为会话 id 探测滞后被永久钉死成"已装饰、无产物"，
          //   重试通道（扫摆）从此进不来 —— 苍玄界首楼裸 `【GameStart】` 的实锤根因。
          if (!muvCardFetchInconclusive) body.setAttribute(DECORATED_ATTR, '1')
        }

        var STATUS_OPEN_RE = /<\s*(?:Status_block|状况)\s*>/i
        var STATUS_CLOSE_RE = /<\s*\/\s*(?:Status_block|状况)\s*>/i

        /**
         * 从装饰结果里取出那一段 `muv-statusbar-wrap`（配平地扫 div）。
         *
         * 以前这里是个正则：`/<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/`
         * —— 它假定卡片末尾**恰好连着三个 `</div>`**。而真实产物并不总是这样：
         *  - 卡自带整页 HTML 时里面是 `<iframe …></iframe></div>`（零个内层 div）；
         *  - 空状态是 `<div class="muv-sb muv-sb-empty">…</div></div>`（两个）。
         * 匹配不上就直接走整条替换，markdown 白丢一次。所以改成按 div 深度配平：
         * 这是「生成什么就解析什么」的做法，不依赖产物长什么样。
         * @param {string} html
         * @returns {string|null}
         */
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

        /**
         * 整条替换兜底的**段落保持**（2026-09-23k，"一大坨"修复）。
         *
         * 取证实锤（dsh-live31）：②手术在页面加载时序下落空 ⇒ 走整条替换
         * `body.innerHTML = html`，而 html 的正文部分是 innerText 投影的纯文本
         * （段间 `\n\n`）—— innerHTML 解析后 CSS 空白折叠把 `\n\n` 全部吃掉，
         * 十二段正文塌成"一大坨"（渲染后 pCount:0、裸文本节点实锤）。
         *
         * 修法：写回前只对**标签之间的文本段**做 `\n{2,}` → `<br><br>`（段落感
         * 恢复）；单 `\n` 保持原样（HTML 渲染折叠成空格，与原 DOM 观感一致）。
         * 用 `<br>` 而不是包 `<p>`：不改变文档结构、无解析器自动闭合/挪动位置
         * 的副作用（文本段可能落在特殊上下文里）。标签内部（srcdoc 属性、
         * data-* 值）一律不碰 —— 扫描器带引号配平，属性值里的裸 `>` 不会被
         * 误判成标签结束。
         * @param {string} html
         * @returns {string}
         */
        function muvParaKeepHtml(html) {
          var s = String(html == null ? '' : html)
          if (!s) return s
          var out = ''
          var n = s.length
          var i = 0
          var textStart = 0
          var changed = false
          while (i < n) {
            var lt = s.indexOf('<', i)
            if (lt < 0) break
            // 找标签结束（`>`），引号内跳过 —— 属性值里的 `>` 不算结束
            var j = lt + 1
            while (j < n) {
              var c = s.charAt(j)
              if (c === '"' || c === "'") {
                var q = s.indexOf(c, j + 1)
                if (q < 0) { j = n; break }
                j = q + 1
                continue
              }
              if (c === '>') break
              j++
            }
            if (j >= n) break
            if (lt > textStart) {
              var seg = s.slice(textStart, lt)
              if (seg.indexOf('\n\n') >= 0 || seg.indexOf('\r\n\r\n') >= 0) {
                out += seg.replace(/\r?\n[ \t]*\r?\n+/g, '<br><br>')
                changed = true
              } else out += seg
            }
            out += s.slice(lt, j + 1)
            i = textStart = j + 1
          }
          if (textStart < n) {
            var tail = s.slice(textStart)
            if (tail.indexOf('\n\n') >= 0 || tail.indexOf('\r\n\r\n') >= 0) {
              out += tail.replace(/\r?\n[ \t]*\r?\n+/g, '<br><br>')
              changed = true
            } else out += tail
          }
          return changed ? out : s
        }

        /**
         * 用一段 HTML 替换 DOM 里的一段文本（Range 手术），失败返回 false。
         * @param {Element} body
         * @param {{node:Text,offset:number}} start
         * @param {{node:Text,offset:number}} end
         * @param {string} html
         * @returns {boolean}
         */
        function insertHtmlAtRange(body, start, end, html) {
          try {
            var range = document.createRange()
            range.setStart(start.node, start.offset)
            range.setEnd(end.node, end.offset)
            range.deleteContents()
            var holder = document.createElement('div')
            holder.className = 'muv-statusbar-hit'
            holder.innerHTML = html
            range.insertNode(holder)
            return true
          } catch (_) { return false }
        }

        /**
         * 把字符串转义成可安全放进 `new RegExp` 的字面量。
         *
         * 为什么需要：文本级状态栏要按**原文逐字**在 DOM 文本里找落点，而原文是模型
         * 写的自由文本（`[`、`|`、`(`、`…` 全是正则元字符/特殊字符）。
         * @param {string} s
         * @returns {string}
         */
        function muvRegExpEscape(s) {
          return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
        }

        /**
         * 逐字匹配、但**空白处放宽**的正则源码。
         *
         * ★ 为什么必须放宽（门禁抓到的真事，别再改回逐字）：落点原文取自
         *   `innerText`，而 `innerText` 是**渲染投影** —— 它会在软折行处插入换行
         *   （实测：夹具里那段状态折叠块在 700px 容器里折了一行，`innerText` 给出的
         *   原文就在折行处多了一个 `\n`，而 DOM 的文本节点里那个位置只是**一个空格**）。
         *   照原文逐字去 `findTextRange` 会匹配不上 ⇒ 退回整条替换 ⇒ markdown 被抹平
         *   （夹具实测：`strong/h2/pre/li` 全 0）。所以空白处一律用 `\s*`：
         *   「有空白」与「没空白」都算匹配，其余字符仍必须逐字相同。
         * @param {string} s
         * @returns {string}
         */
        function muvFlexRegExpSource(s) {
          var parts = String(s).split(/\s+/)
          var out = []
          for (var i = 0; i < parts.length; i++) {
            if (!parts[i]) continue
            out.push(muvRegExpEscape(parts[i]))
          }
          return out.join('\\s*')
        }

        /**
         * 从装饰产物里取出「文本级状态栏」的落点信息。
         *
         * 读的是产物自己的 `data-muv-ts*` 属性 —— 用 DOM 解析而不是正则切字符串：
         * 属性值是 `escAttr` 转义过的（原文里可能有 `&`/`<`/`"`），交给 `innerHTML`
         * 解析一次就自动还原了，比我手写一遍反转义可靠（`&amp;` 与 `&#38;` 两种写法
         * 都要对，手写必漏一种）。
         * @param {string} html
         * @returns {Array<{kind:string, raw:string, look:string, html:string}>}
         */
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

        /**
         * 把正文里的原文段逐段换成文本级状态栏。任一段找不到落点就整体放弃。
         *
         * 两种落点，按可靠性排序：
         *   ① `<details>` **元素**（kind=details）：DSH 的 markdown 会把裸 HTML 直通渲染，
         *      所以状态折叠块在 DOM 里是一个**真元素**，按元素整体替换最干净（不会留下
         *      空的 `<details>`/`<pre>` 壳）。探针是该块正文的前 10 个字 —— 围栏在 DOM 里
         *      早被吃掉了，所以探针必须从「去过围栏」的文本里取（见 `muvTextDetailsOf`）。
         *   ② **逐字文本段**（kind=prefix，以及被转义成文本的 `<details>`）：用 `findTextRange`
         *      按原文匹配后 Range 替换 —— `[时间:…][地点:…]` 在 DOM 里就是普通文本。
         * @param {Element} body
         * @param {Array<{kind:string, raw:string, look:string, html:string}>} segs
         * @returns {string} '' = 全部成功；否则是 `<第几段>:<形态>:<原因>`（留痕用）
         */
        function muvReplaceTsSegments(body, segs) {
          for (var i = 0; i < segs.length; i++) {
            var seg = segs[i]
            var done = false
            if (seg.kind === 'details' && seg.look) {
              try {
                var dets = body.querySelectorAll('details')
                for (var d = 0; d < dets.length; d++) {
                  var t = dets[d].textContent || ''
                  if (t.indexOf(seg.look) < 0) continue
                  var hold = document.createElement('div')
                  hold.innerHTML = seg.html
                  if (hold.firstChild && dets[d].parentNode) {
                    dets[d].parentNode.replaceChild(hold.firstChild, dets[d])
                    done = true
                  }
                  break
                }
              } catch (_) {}
            }
            if (done) continue
            if (!seg.raw) return i + ':' + seg.kind + ':no-raw'
            var r = findTextRange(body, new RegExp(muvFlexRegExpSource(seg.raw)))
            if (!r) return i + ':' + seg.kind + ':no-range'
            if (!insertHtmlAtRange(body, { node: r.node, offset: r.offset },
              { node: r.endNode, offset: r.endOffset }, seg.html)) return i + ':' + seg.kind + ':insert'
          }
          return ''
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain text
         * (`innerText` — `**`/`##`/``` 早就被 DSH 渲染掉了), so its output carries no
         * markdown: code blocks, tables and emphasis get flattened permanently, and
         * any ordinary reply that merely *mentions* a marker would be rewritten too.
         *
         * 所以只在**确实需要落地的那一段**上做手术，按优先级：
         *   ① `<Status_block>…</Status_block>`  → 只替换这一段；
         *   ② `<StatusPlaceHolderImpl/>`          → 只替换这一段（第二类迁移新增）；
         *   ③ 都找不到 → 只能整条替换（最后手段，保留原行为）。
         * 另有两条在 ① 之前的分支，都是「整条替换」的既有语义、不是新的落点策略：
         *   · 产物里带整页文档（`raw` 里有行首围栏 / `<!doctype`）→ 整条替换；
         *   · ★ 第 35 轮：文本级状态栏（产物带 `data-muv-ts*`）→ **把正文里的原文段
         *     换成状态栏**（`①.5`，见那里的长注释），失败才退回整条替换。
         * 文本偏移而不是「包住标签的那个元素」：DSH 的 markdown 会把这些行塞进任意嵌套
         * 元素里，元素级手术会留下半截标签文本 —— 那正是 0.3.3 时代 `角色状态]</summary>`
         * 那种碎屑的来源。
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function applyDecoratedHtml(body, html, raw) {
          var cardMatch = extractStatusWrap(html)
          // 装饰产物里根本没有状态栏（卡的正则改了文本但级联没出东西）：保持老行为。
          if (!cardMatch) { body.innerHTML = muvParaKeepHtml(html); return }

          // ★ 整页文档必须在**这里**就走整条替换，不能塞进下面那个 status 手术。
          //
          // 下面 ①②③ 三条路都只把 `cardMatch`（状态栏那一段）插进 DOM 的某个落点。
          // 当消息里同时有「整页文档」和「状态栏」时（`_足控天堂2` 的 `<StatusPlaceHolderImpl/>`
          // 正则天然如此），`beautifyMuv` 算出来的那个**文档 iframe 会被整段丢掉** ——
          // DOM 里只剩下状态栏，而消息里原来那段围栏文本原样留着 → 用户看到
          // 「一大段 HTML 没渲染、全是裸文本」。实测（verify-realcard-inline.mjs，真卡
          // 正文美化 46KB 文档 + 占位符）：装饰产物里 `outIframes=1`、`outHasNakedDoc=0`
          // （产物是对的），但装饰后 DOM 里 `preTextLen` 仍是 30316 字符的裸文档、
          // `msgIframes` 里那个 iframe 其实是状态栏那条。
          //
          // 判据用 `raw`（写回之前读到的**纯文本**）而不是 `html`：raw 里有没有文档，
          // 和「产物里有没有 iframe」是同一件事的两面，但 raw 是原始输入，不受
          // 状态栏渲染分支影响，判起来不会自指。
          if (/^\s{0,3}`{3,}/m.test(raw) || /<!doctype|<html[\s>]/i.test(raw)) {
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ★★ ①.5 文本级状态栏（第 35 轮，无占位符的卡）：落点信息写在**产物自己**的
          //    `data-muv-ts-*` 属性里（自己生成、自己解析，不靠模块级状态 —— 并发装饰
          //    多条消息时不会串）。
          //
          // 与下面 ①② 的区别：那两条是「把状态栏整段插到某个标记的位置上」，而这一条是
          // **把正文里的原文段换成状态栏** —— `[时间:…][地点:…]` 那一串必须从正文里
          // 消失，否则用户会同时看到裸方括号和状态栏（用户最初的抱怨就是"裸文本堆在
          // 正文里"）。
          var tsSegs = muvTsSegmentsOf(html)
          if (tsSegs.length) {
            var tsWhy = muvReplaceTsSegments(body, tsSegs)
            if (!tsWhy) return
            // 手术失败（DOM 里的原文与产物对不上，例如别的东西改写过文本）：退回整条
            // 替换。这会让 markdown 变平，所以只作最后手段 —— 但它至少保证「状态栏出现
            // + 裸方括号消失」，也就是用户报的那件事被解决。
            // ★ 失败原因落在元素属性上（`data-muv-ts-fallback=<第几段:形态:原因>`）：
            //   这条路径**是隐形的**（用户只会看到 markdown 变平），不留痕的话只能靠
            //   重放现场查 —— 排错手册里那条"元信息裸露成裸文本"就是照着它写的。
            try { body.setAttribute('data-muv-ts-fallback', tsWhy) } catch (_) {}
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ① 结构化状态块
          var open = findTextRange(body, STATUS_OPEN_RE)
          if (open) {
            var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
            var full = ''
            var n
            while ((n = walker.nextNode())) full += n.nodeValue || ''
            var afterOpen = full.slice(open.start)
            var cm = STATUS_CLOSE_RE.exec(afterOpen)
            var end
            if (cm) {
              var closeEnd = open.start + cm.index + cm[0].length
              var w2 = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null)
              var nodes2 = []
              var acc = ''
              var t
              while ((t = w2.nextNode())) {
                var v = t.nodeValue || ''
                if (!v) continue
                nodes2.push({ node: t, start: acc.length })
                acc += v
              }
              var loc = function (pos) {
                for (var i = 0; i < nodes2.length; i++) {
                  var s = nodes2[i].start
                  var e = s + (nodes2[i].node.nodeValue || '').length
                  if (pos >= s && pos <= e) return { node: nodes2[i].node, offset: pos - s }
                }
                return null
              }
              end = loc(closeEnd)
            } else {
              // 未闭合（还在流式，或模型漏了收尾标签）：只换开标签自己。
              end = { node: open.node, offset: open.offset + (open.endOffset - open.offset) }
            }
            if (end && insertHtmlAtRange(body, { node: open.node, offset: open.offset }, end, cardMatch)) return
            body.innerHTML = muvParaKeepHtml(html)
            return
          }

          // ② 占位符：卡用 `<StatusPlaceHolderImpl/>` 而不是 `<Status_block>`
          var ph = findTextRange(body, STATUS_PH_TEST)
          if (ph && insertHtmlAtRange(body, { node: ph.node, offset: ph.offset },
            { node: ph.endNode, offset: ph.endOffset }, cardMatch)) return

          // ③ 找不到落点：最后手段（这一条会让 markdown 变平，但至少消息不是空的；
          //    段落保持兜底见 muvParaKeepHtml —— dsh-live31 实锤的"一大坨"就走的这里）
          body.innerHTML = muvParaKeepHtml(html)
        }

        /**
         * Find the character offset of a regex match inside an element's text,
         * walking text nodes in document order.
         * @param {Element} root
         * @param {RegExp} re
         * @returns {{node:Text, offset:number, endNode:Text, endOffset:number, start:number}|null}
         */
        function findTextRange(root, re) {
          var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
          var nodes = []
          var full = ''
          var n
          while ((n = walker.nextNode())) {
            var v = n.nodeValue || ''
            if (!v) continue
            nodes.push({ node: n, start: full.length })
            full += v
          }
          var m = re.exec(full)
          if (!m) return null
          var start = m.index
          var end = start + m[0].length
          var locate = function (pos) {
            for (var i = 0; i < nodes.length; i++) {
              var s = nodes[i].start
              var e = s + (nodes[i].node.nodeValue || '').length
              if (pos >= s && pos <= e) return { node: nodes[i].node, offset: pos - s }
            }
            return null
          }
          var a = locate(start)
          var b = locate(end)
          if (!a || !b) return null
          // Both endpoints must live in an element we can safely edit.
          if (!a.node.parentNode || !b.node.parentNode) return null
          return { node: a.node, offset: a.offset, endNode: b.node, endOffset: b.offset, start: start }
        }

        /**
         * Write the decorated result back into the message.
         *
         * Whole-body replacement is destructive: `beautifyMuv` works from plain
         * text, so its prose output carries no markdown — code blocks, tables and
         * emphasis DSH rendered get flattened, and any ordinary reply that merely
         * *mentions* `<Status_block>` would be rewritten too.
         *
         * So we delete exactly the text range spanned by the status block and
         * drop the card in its place, using a DOM Range. Working on text offsets
         * (rather than picking "the block element that contains the tag") matters:
         * DSH's markdown wraps these lines in arbitrary, often nested elements, so
         * element-level surgery leaves fragments of the tag text behind — which is
         * exactly the `角色状态]</summary> ...` debris that shipped in 0.3.3.
         * @param {Element} body
         * @param {string} html - decorated HTML produced from the plain text
         * @param {string} raw - the plain text that was decorated
         */
        function scheduleDecorate() {
          if (_decorRaf) return
          _decorRaf = window.requestAnimationFrame(function () {
            _decorRaf = 0
            decorateMessages()
          })
        }

        scheduleDecorate()
        _muvMsgObs = new MutationObserver(scheduleDecorate)
        _muvMsgObs.observe(document.body, { childList: true, subtree: true })

        // ★ 装饰扫摆（2026-09-24，真机实锤的兜底）：切会话时 React 的挂载常晚于
        //   MutationObserver 的最后一次回调 —— rAF 跑的时候新消息还没 commit，
        //   decorateMessages() 空转，之后不再有 mutation ⇒ 消息永久裸着
        //   （dsh-live6 自主诊断：同一会话反复切入，卡 iframe 时有时无）。
        //   低频扫摆把"漏触发"变成"最终一致"：_decorateOne 的 DECORATED_ATTR /
        //   muvHasOwnArtifacts / [data-streaming] 三重守卫保证已装饰的零成本跳过；
        //   取卡未决（muvCardFetchInconclusive）的消息不会被钉死，扫摆会救回来。
        //   3s 是成本取舍：再密了空扫开销可感，再疏了用户等待过久。
        _muvSweepTimer = setInterval(function () { scheduleDecorate() }, 3000)

        // Publish the entry points now that the DOM helpers exist.
        _decorateOneHook = _decorateOne
        _scheduleDecorateHook = scheduleDecorate
      })();      return function() {
        style.remove()
        if (_macroInputObserver) { _macroInputObserver.disconnect(); _macroInputObserver = null }
        // These live in the factory scope (declared above) so the cleanup can
        // actually reach them — inside the IIFE they were unreachable here.
        if (_muvMsgObs) { _muvMsgObs.disconnect(); _muvMsgObs = null }
        if (_muvSweepTimer) { clearInterval(_muvSweepTimer); _muvSweepTimer = null }
        if (_vrObs) { _vrObs.disconnect(); _vrObs = null }
      }
