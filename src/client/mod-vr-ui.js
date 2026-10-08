    // ── mod-vr-ui：视觉渲染面板 UI（S2 段2 从工厂体内搬来，函数内容逐字未改） ──
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
