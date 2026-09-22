# SillyTavern 卡 iframe 权威规格（从 ST 源码逐字提取）

> 出处：`C:\MySpecialFolder\SillyTavern\public\scripts\extensions\third-party\JS-Slash-Runner\`
> 提取方式：直接读 `dist/index.js`（1,088,340 字符）与 `src/iframe/*.js` 原文，**不是推测**。
> 提取时间：2026-09-20。用途：把 DSH 的卡 iframe 对齐到 ST 的真实行为。

---

## 0. 一句话结论

ST 的卡 iframe **没有任何 `sandbox` 属性**（= 同源），宽度 `class="w-full"`，
高度由**子文档自己**用 `body.scrollHeight` 写 `frameElement.style.height`，
html/body 的 overflow 是 **`hidden!important`**，
并且 ST 把消息里**所有非 iframe 子元素加 `hidden!` 隐藏**（原始 `<pre><code>` 源码不显示）。

DSH 的偏离（已知、且是安全决策）：
- 用了 `sandbox="allow-scripts"` ⇒ 不透明源 ⇒ `localStorage` 抛 `SecurityError`、`window.parent.document` 被拒
- 高度走 `postMessage` 而不是 `frameElement.style.height`（跨源够不着）
- `muvCardResetCss` 给的是 `overflow:auto`（**ST 是 hidden**）

---

## 1. iframe 元素属性（逐字）

`dist/index.js` 位置 ~855496，`Iframe.vue` 的 render：

```js
S1 = [`id`, `name`];
function C1(e, t, n, r, i, a) {
  return z(), B(`iframe`, Rc({
    id: r.prefixed_id,
    ref: `iframe_ref`,
    name: r.prefixed_id,
    loading: `lazy`
  }, r.src_prop, {
    class: `w-full`,
    frameborder: `0`,
    onLoad: r.onLoad
  }), null, 16, S1)
}
```

要点：
- `class="w-full"` ⇒ **满宽**（Tailwind `w-full` = `width:100%`）
- `frameborder="0"`
- `loading="lazy"`
- **无 `sandbox`**

---

## 2. 源码 `<pre><code>` 的处理（★ 图二「一大段裸文本」的正解）

`dist/index.js` 位置 ~854594：

```js
let r = $(n.element),            // 消息容器
    i = r.children(`pre`),       // 里面的 <pre>
    a = Wo(`iframe`);
ns(() => { r.find(`iframe`).remove() });

// ★★ 关键：把**非 iframe** 的直接子元素全部隐藏
rs(() => {
  r.children()
   .filter((e, t) => !$(t).is(`iframe`))
   .addClass(`hidden!`)
});

// 取 <pre><code> 的 textContent 作为 iframe 的文档
let o = G(e => {
  e?.src && URL.revokeObjectURL(e.src);
  let t = b1(i.find(`code`).text(), n.useBlobUrl);
  return n.useBlobUrl
    ? { src: URL.createObjectURL(new Blob([t], { type: `text/html` })) }
    : { srcdoc: t }
});
```

⇒ **ST 不删除源码块，而是给它加 `hidden!` 类隐藏。** 源码块仍在 DOM 里（可被用户展开），
但视觉上只显示 iframe。**只把文档搬进 iframe 而不隐藏源码块 ⇒ 裸文本照旧可见。**

---

## 3. iframe 文档模板 `b1(e, t)`（逐字，★ 核心）

`dist/index.js` 位置 ~853393：

```js
function b1(e, t) {
  e = y1(e);                       // ← vh 重写，见 §4
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${t ? `<base href="${window.location.origin}"/>` : ``}
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}
.user_avatar,.user-avatar{background-image:url('${eA()}')}
.char_avatar,.char-avatar{background-image:url('${tA()}')}
</style>
${v1}
<script src="${_1}"><\/script>
<script src="https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner/src/iframe/node_modules/log.js"><\/script>
<script src="${m1}"><\/script>
<script src="${p1}"><\/script>
</head>
<body>
${e}
</body>
</html>
`
}
```

要点（**每一条都是我们目前缺或做错的**）：
1. `e = y1(e)` —— 先做 vh 重写
2. `<meta name="viewport" content="width=device-width, initial-scale=1.0">` —— 我们**没有**
3. `*,*::before,*::after{box-sizing:border-box;}` —— 我们**没有**
4. **`html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}`**
   —— ★ `overflow:hidden` 不是 `auto`；我们给的是 `auto`（图一右侧那条卡内滚动条即由此而来）
5. `${e}` 被放进 `<body>`（不是塞在 head 前）
6. 注入 4 个脚本：`${v1}`（内联）、`log.js`、`${m1}`、`${p1}`

`t = useBlobUrl`：为 `true` 时用 `blob:` URL 而不是 `srcdoc`（注释提到 Firefox 会移除 srcdoc iframe）。

---

## 4. vh 重写器 `y1(e)`（逐字，★ 核心）

`dist/index.js` 位置 ~852298：

```js
function y1(e) {
  let t = /min-height\s*:\s*[^;{}]*\d+(?:\.\d+)?vh/gi.test(e),
      n = /style\s*=\s*(["'])[\s\S]*?min-height\s*:\s*[^;]*?\d+(?:\.\d+)?vh[\s\S]*?\1/gi.test(e),
      r = /(\.style\.minHeight\s*=\s*(["']))([\s\S]*?vh)(\2)/gi.test(e)
        || /(setProperty\s*\(\s*(["'])min-height\2\s*,\s*(["']))([\s\S]*?vh)(\3\s*\))/gi.test(e);

  if (!t && !n && !r) return e;            // ← 三处都没有 vh ⇒ 原样返回

  let i = e => e.replace(/(\d+(?:\.\d+)?)vh\b/gi, (e, t) => {
    let n = parseFloat(t);
    if (!isFinite(n)) return e;
    let r = `var(--TH-viewport-height)`;
    return n === 100 ? r : `calc(${r} * ${n / 100})`;
  });

  e = e.replace(/(min-height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?vh)(?=\s*[;}])/gi,
                (e, t, n) => `${t}${i(n)}`);
  e = e.replace(/(style\s*=\s*(["']))([^"']*?)(\2)/gi, (e, t, n, r, a) =>
                /min-height\s*:\s*[^;]*vh/i.test(r) ? `${t}${i(r)}${a}` : e);
  // …（第三处：JS 赋值）
  return e;
}
```

语义（**照抄，别自己发明**）：
- **只重写 `min-height`**（不碰 `height`/`max-height`）
- **`100vh` → `var(--TH-viewport-height)`**；
  **其他值 → `calc(var(--TH-viewport-height) * n/100)`**（如 `50vh` → `calc(var(--TH-viewport-height) * 0.5)`）
- 覆盖**三个位置**：① CSS 的 `min-height:` 声明 ② 内联 `style="…"` 属性 ③ **JS 赋值**
  （`.style.minHeight = '…vh'` 与 `setProperty('min-height','…vh')`）
- **门禁**：三处都没匹配到 ⇒ 原样返回（`if(!t&&!n&&!r) return e`）
- 测试到 `!isFinite(n)` 时保留原文

---

## 5. 视口高度变量 `--TH-viewport-height`（逐字）

`dist/index.js` 位置 ~839862，常量 `l1`（= `src/iframe/adjust_viewport.js`）：

```js
$('html').css('--TH-viewport-height', `${window.parent.innerHeight}px`);
window.addEventListener('message', function (event) {
  if (event.data?.type === 'TH_UPDATE_VIEWPORT_HEIGHT') {
    $('html').css('--TH-viewport-height', `${window.parent.innerHeight}px`);
  }
});
```

★ **`--TH-viewport-height` = `window.parent.innerHeight`** —— 是**宿主（父页）的视口高**，
不是 iframe 自己的高度。这就是 ST 里 `min-height:100vh` 的含义：**至少和聊天视口一样高**。

父页在 `window.resize` 时通知子文档：

```js
Dd(window, `resize`, () => {
  a.value?.contentWindow?.postMessage({ type: `TH_UPDATE_VIEWPORT_HEIGHT` }, `*`)
});
```

---

## 6. 高度机制（逐字）

`src/iframe/adjust_iframe_height.js`（1127 字节，全文）：

```js
(function () {
  let scheduled = false;

  function measureAndPost() {
    scheduled = false;
    try {
      const doc = window.document;
      const body = doc.body;
      const html = doc.documentElement;
      if (!body || !html) return;

      let height = 0;
      height = body.scrollHeight;              // ★ 就是 body.scrollHeight
      if (!Number.isFinite(height) || height <= 0) return;

      frameElement.style.height = `${height}px`;   // ★ 直接写 frameElement（同源才够得着）
    } catch { /* */ }
  }
  const throttledMeasureAndPost = _.throttle(measureAndPost, 500);

  function postIframeHeight() {
    if (scheduled) return;
    scheduled = true;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(measureAndPost);
    } else {
      throttledMeasureAndPost();
    }
  }

  function observeHeightChange() {
    const body = document.body;
    if (!body) return;
    const resize_observer = new ResizeObserver(entries => { postIframeHeight() });
    resize_observer.observe(body);
  }

  $(() => {
    postIframeHeight();
    observeHeightChange();
  });
})();
```

要点：
- 度量为 **`body.scrollHeight`**（不是 bounding box）
- 写入 **`frameElement.style.height`**（同源；我们跨源只能用 `postMessage`）
- `ResizeObserver` 观察 **body**
- rAF 调度 + `_.throttle(…, 500)`
- 测量失败（非有限 / ≤0）⇒ **不动**（不猜）

---

## 7. 注入脚本清单与来源

**常量已定位**（`dist/index.js`）：

| 常量 | 内容 | 位置 |
|---|---|---|
| `v1` | **一大块注入资源**，含：fontawesome CSS、`/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js`、`testingcf.jsdelivr.net` 上的 **jquery、jquery-ui、jquery-ui-touch-punch、vue.runtime.global.prod、vue-router.global.prod** | ~852298 之前 |
| `u1` | `window.$ = window.parent.$;\nwindow.jQuery = window.parent.jQuery;\n` | ~849872 |
| `d1` | **`predefine.js` 全文**（`window._ = window.parent._` 等） | ~849872 |
| `c1` | **`adjust_iframe_height.js` 全文**（`measureAndPost` 那一段） | ~838620 |
| `l1` | **`adjust_viewport.js` 全文**（`--TH-viewport-height` 那个） | ~839862 |
| `iee` | 另一段（`const parentJQuery = window.parent.$` / `originalParent`），用于 pagehide 清理 | ~839862 之后 |

★ **重大保真度含义**：`b1` **无条件**把 `${v1}` 注入**每一个**卡 iframe ⇒
ST 里的卡 HTML **天然拥有 Tailwind 工具类、jQuery、jQuery-UI、Vue、Vue-Router、FontAwesome**。
写卡的人会依赖这些（例如卡里直接用 `class="w-full"`、`$()`、Vue 组件）。

**我们目前一个都没有。** 这是"卡里东西出不来"的另一条独立原因。
（沙箱 iframe 里**可以**加载 CDN 脚本 —— 网络不受 sandbox 限制。）

**同源依赖**：`u1`/`d1` 都读 `window.parent.$` / `window.parent._`。我们在不透明源下**拿不到**，
所以若要给卡提供 `$`/`_`/`SillyTavern`，必须**在 iframe 内部自建或从 CDN 加载**，
**不能转发父页对象**（跨源够不着）。

---

## 8. 我们当前实现的偏离清单（按用户可见症状排序）

| # | ST 行为 | 我们的行为 | 用户可见症状 |
|---|---|---|---|
| 1 | html/body `overflow:hidden!important` | `overflow:auto` | 图一：**卡内出现自己的滚动条**；内容被裁成 ~230px |
| 2 | 源码 `<pre><code>` 加 `hidden!` | 依赖 iframe 替换，未显式隐藏 | 图二：**一大段裸文本** |
| 3 | iframe `class="w-full"` | `width:100%`（等价，已在） | 宽度 OK（实测 77.7%） |
| 4 | 高度 = `body.scrollHeight` → `frameElement.style.height` | bounding box + `postMessage` + 夹取 `[160,2400]` | **小窗口**（实测露 ~1/8） |
| 5 | `--TH-viewport-height` = **父页 innerHeight** | 用自己的窗口尺寸 | `min-height:100vh` 语义可能不等价 |
| 6 | 无 sandbox（同源） | `allow-scripts`（安全决策，**不改**） | 卡 app 的 `localStorage`/`parent.*` 全废 ⇒ 画廊/18 个媒体不显示 |
| 7 | `<meta name="viewport">`、`box-sizing:border-box` | 缺失 | 移动分支/盒模型差异 |
| 8 | 无 sandbox | `allow-scripts` | 卡 app 的 `localStorage`/`parent.*` 全废 ⇒ 画廊/18 个媒体不显示 |

---

## 9. 待确认（下次读源码时补齐）

- `${m1}`、`${p1}`、`${_1}`、`${v1}` 的**确切**常量定义
- vh 重写器第三处（JS 赋值）的完整正则
- `useBlobUrl` 的触发条件
- `y1` 之外是否还有别的 HTML 预处理

---

## 10. 复现命令（下次不用重新找）

```powershell
$f = "C:\MySpecialFolder\SillyTavern\public\scripts\extensions\third-party\JS-Slash-Runner\dist\index.js"
$t = Get-Content $f -Raw -Encoding UTF8
$i = $t.IndexOf('function y1');      # vh 重写器
$i = $t.IndexOf('function b1');      # iframe 文档模板
$i = $t.IndexOf('srcdoc');           # iframe 构造点
$i = $t.IndexOf('TH_UPDATE_VIEWPORT_HEIGHT')
```
