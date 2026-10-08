      return tag + s
    }

    /**
     * ── 卡 app 的 **ST 兼容层**（注入卡 iframe 内部的垫片） ────────────────────
     *
     * 背景：ST 的卡 iframe **没有 `sandbox`**（同源），所以卡作者的 app 顺手就用
     * `localStorage`、`SillyTavern.getContext()`、`window.parent`。我们的沙箱是
     * `allow-scripts`（不透明来源，安全决策见上面 `MUV_CARD_SANDBOX` 的长注释），
     * 于是这些 API 要么抛 `SecurityError`、要么够不着。
     *
     * 症状是**静默**的（真卡 `_足控天堂2` 实测）：`cgGetCache`/`cgSaveCache` 都被
     * `try{…}catch(e){}` 包着 ⇒ 不报错、永远返回空缓存 ⇒ CG 画廊永不解锁 ⇒
     * 那 18 个远程插图和视频永不显示。用户看到的只是"图/视频没出来"。
     *
     * 为什么不用 `allow-same-origin` 解决：那张卡的代码**主动探测** `window.parent.document`
     * （见 §9 事故记录）。同源后这三行立刻变活：
     *   `if(window.parent&&window.parent!==window)parentDocs.push(window.parent.document)`
     *   `if(window.opener)parentDocs.push(window.opener.document)`
     *   `if(window.parent.parent&&… )parentDocs.push(window.parent.parent.document)`
     * 卡就能读写 DSH 前端 DOM、带凭据打 `/api/*`。**所以只能垫片，不能放开沙箱。**
     *
     * ★ 关键的可行性依据（已实测，别丢）：卡的 `cgScanChat` 是从 `window` **起步**的 ——
     *   ```js
     *   var targetWindow=window;
     *   try{if(window.parent&&window.parent.SillyTavern)targetWindow=window.parent;}catch(e){}
     *   if(targetWindow.SillyTavern&&targetWindow.SillyTavern.getContext){ … }
     *   ```
     *   它只在 `window.parent.SillyTavern` 存在时才"升级"到父页。我们**跨源无法**给
     *   `window.parent` 挂属性，但**完全可以在 iframe 内部定义 `window.SillyTavern`** ⇒
     *   卡会采纳它。所以不用同源也能满足这条路径。
     *
     * 已实测**不需要**垫的两样（省掉就是少两处风险，理由都来自真数据）：
     *  - `$`/`jQuery`：全卡只有 2 处，且都写着 `if(typeof $ !== 'undefined' && $(el).length){…}`
     *    —— 已被 feature-detect 短路，没 jQuery 也不抛。
     *  - `indexedDB`：不透明源下 `indexedDB.open()` 是**同步抛** `SecurityError`
     *    （"access to the Indexed Database API is denied in this context"），
     *    而卡的 `cgImgDbOpen()` 正是 `try{…}catch(e){fail(e)}` —— 抛被接住、Promise reject、
     *    `cgLoadImg` 的 `.catch` 回退远程 URL。行为与 ST 只差"第二次打开走本地 blob 缓存"。
     *
     * 垫片的**形态约定**（沿用 `muvFrameBootstrap` 那两条硬约束，踩过）：
     *  - 整段是**单引号字符串**，所以内部一律用 `"` 引号，且**不含反引号**；
     *  - 字符串里**不出现裸的 `</script>`**（收尾标签用 `'</' + 'script>'` 拼）。
     * @returns {string} 只有 JS 正文，不含 script 标签
     */
    function muvCardCompatScript() {
      return '(function(){' +
        // 幂等标记用 `__muvCompatOn`（不是 `__muvCompat`）：它同时是父页守卫查的
        // **专属 token**，见 `withCardCompat` 的注释。卡自己写 `window.__muvCompat=1`
        // 不再能顶掉整段垫片。
        'if(window.__muvCompatOn)return;window.__muvCompatOn=1;' +
        'function S(v){return v==null?"":String(v)}' +
        'function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}' +
        // ── 0. 首屏遮蔽的「我初始化完了」信号（2026-09-25，足控天堂主题闪烁）──────
        // 宿主给"自带初始主题属性"的卡文档起了遮蔽（`iframe.muv-iframe[data-muv-mask]`
        // 的 `opacity:0`），免得用户看到卡的**未初始化态**。足控天堂实测：
        //   `<body data-theme="night">` 是写死的默认值，而**已保存的主题只在卡自己的
        //   DOMContentLoaded 里落** —— 那一刻又被卡自己的 35 条 CDN 模块链拖到
        //   4.3–6.8 秒 ⇒ 每次切回都先看 2–6 秒夜色、再跳白天（夹具把窗口量成 2.1–3.0s）。
        // ★ 为什么必须"排后报"：本垫片是文档里**最早**的脚本，所以我们的监听器排在卡的
        //   **前面**；而 `setTimeout(…,0)` 的回调排在**全部** DOMContentLoaded 监听器
        //   之后 ⇒ 消息发出去时卡的主题已经落好，"显形即终态"。
        //   （夹具 fixture-theme-flash.mjs 的 B 臂实证：显形那一刻 `data-theme` 已是 day。）
        // 只发一个字面量，不带任何卡内数据；宿主侧只把它当"可以显形了"用。
        'document.addEventListener("DOMContentLoaded",function(){setTimeout(function(){post({__muvReady:1})},0)},false);' +
        // ── 1. KV：localStorage / sessionStorage 的内存实现 ──────────────────
        // 命名空间靠**前缀**区分（"L:" / "S:"），前缀首字符就不同 ⇒ 不可能串键。
        'var seed=(window.__muvKvSeed&&typeof window.__muvKvSeed==="object")?window.__muvKvSeed:{};' +
        'var mem={};' +
        'for(var k0 in seed){if(Object.prototype.hasOwnProperty.call(seed,k0))mem[k0]=S(seed[k0])}' +
        'function keysOf(ns){var a=[];for(var k in mem){if(k.indexOf(ns)===0)a.push(k.slice(ns.length))}return a}' +
        'function push(op,k,v){var m={__muvKv:op,k:S(k)};if(op==="set")m.v=S(v);post(m)}' +
        'function makeStore(ns){' +
        'var api={};' +
        'api.getItem=function(k){try{k=S(k);return Object.prototype.hasOwnProperty.call(mem,ns+k)?mem[ns+k]:null}catch(e){return null}};' +
        'api.setItem=function(k,v){try{k=S(k);v=S(v);mem[ns+k]=v;push("set",k,v)}catch(e){}};' +
        'api.removeItem=function(k){try{k=S(k);delete mem[ns+k];push("remove",k)}catch(e){}};' +
        'api.clear=function(){try{var ks=keysOf(ns);for(var i=0;i<ks.length;i++)delete mem[ns+ks[i]];push("clear")}catch(e){}};' +
        'api.key=function(i){try{var ks=keysOf(ns);i=Number(i);if(!isFinite(i))return null;return(i>=0&&i<ks.length)?ks[i]:null}catch(e){return null}};' +
        'try{Object.defineProperty(api,"length",{configurable:true,get:function(){try{return keysOf(ns).length}catch(e){return 0}}})}catch(e){}' +
        'return api}' +
        // 只在**真 API 不可用**时才覆盖：这样万一哪天沙箱回到同源，真实存储不会被我们顶掉。
        // 覆盖走 defineProperty（`window.localStorage` 在 Chrome/Edge 下是**自有且
        // configurable** 的访问器 —— 已实测 `own configurable=true`），
        // 不是 try/catch 包一层，也不是裸赋值（卡里是 'use strict'）。
        'function def(name,val){' +
        'try{Object.defineProperty(window,name,{configurable:true,get:function(){return val},set:function(){}});return true}catch(e){}' +
        'try{window[name]=val;return true}catch(e2){}return false}' +
        // `defGet`：与 `def` 同一套口径，但落位的是**每次取值都重算**的 getter。
        // 为什么需要（第 36 轮）：ST 的 `iframe/predefine.js:26-34` 里 `SillyTavern` 就是
        // `Object.defineProperty(window,'SillyTavern',{get:()=>({...SillyTavern.getContext(),getContext})})`
        // —— 逐次重算。它的 `chat` 因此永远是**当前**那个数组；而我们的 `hostChat` 会被
        // 宿主整条替换（`hostChat=d.__muvChat.list`），用 `def` 固定成一个快照会让
        // `SillyTavern.chat` 永远停在初始的空数组上（静默的假数据，比 undefined 更坏）。
        'function defGet(name,getter){' +
        'try{Object.defineProperty(window,name,{configurable:true,get:getter,set:function(){}});return true}catch(e){}return false}' +
        'function usable(name){' +
        'try{var s=window[name];if(!s)return false;s.setItem("__muvP","1");var ok=s.getItem("__muvP")==="1";s.removeItem("__muvP");return ok}catch(e){return false}}' +
        'if(!usable("localStorage")){def("localStorage",makeStore("L:"))}' +
        'if(!usable("sessionStorage")){def("sessionStorage",makeStore("S:"))}' +
        // ── 2. window.SillyTavern：卡从 getContext().chat 里扫 <img> 解锁 CG ──
        // chat 由**宿主**通过 postMessage 送进来（宿主才有消息文本）。取不到就空数组，
        // **必须不抛错** —— 卡的 cgScanChat 只做 `ctx.chat||[]`。
        'var hostChat=[];' +
        // ── 2.1 `SillyTavern.saveChat`（第 36 轮补）与 `SillyTavern` 的**形状** ────────
        // 症状（同一条真机控制台）：`lodash.min.js:84 Uncaught TypeError: Expected a function`。
        // 取证的结论是它**不是** lodash 的问题，也不是卡"调了不存在的 lodash 方法"：
        //   MVU bundle（573,299 字节）顶层有一句
        //       const wt = _.debounce(SillyTavern.saveChat, 1e3);
        //   `SillyTavern` 在 ST 的卡 iframe 里是 `{...SillyTavern.getContext(), getContext}`
        //   （`iframe/predefine.js:26-34`），而 ST 的 context **有** `saveChat` ⇒ 传进 lodash 的
        //   是函数。DSH 这边我们的垫片只给了 `{getContext}` ⇒ 传进去的是 `undefined` ⇒
        //   lodash 的 `debounce` 守卫（`pl=TypeError`,`en="Expected a function"`，
        //   `lodash@4.18.1/lodash.min.js:84` 那一行**只此一处**抛它）当场抛 ⇒ **整个 bundle
        //   的模块求值中断**（就是"MVU 框架一行都没跑起来"）。
        //   ⇒ 修的是**我们垫片缺的能力**，不是 lodash。
        // 语义（如实说明）：ST 的 `saveChat` 把当前聊天落盘到 ST 的会话存储。DSH 里聊天与
        //   变量都**由 DSH 自己持久化**（变量走 `__muvVarWrite` → 宿主落库），这里没有第二份
        //   要写的账 ⇒ 最小实现 = **不落盘、返回一个已完成的 Promise**（卡的 `.then()` 链
        //   不会因为返回值不是 thenable 而崩），并**在第一次调用时留一条痕**（不静默）。
        'var __stSaveChatWarned=false;' +
        'function stSaveChat(){try{if(!__stSaveChatWarned){__stSaveChatWarned=true;' +
        'warnShim("SillyTavern.saveChat：DSH 没有等价的落盘动作（聊天与变量由 DSH 自己持久化），本次只返回已完成")}}catch(e){}' +
        'return Promise.resolve()}' +
        'function getContext(){' +
        'try{return{chat:hostChat,name1:"User",name2:"",characters:[],characterId:0,chatId:"",' +
        'eventSource:null,eventTypes:{},extensionSettings:{},getRequestHeaders:function(){return{}},' +
        'getCharacters:function(){return hostChat},saveChat:stSaveChat}' +
        '}catch(e){return{chat:[],saveChat:stSaveChat}}}' +
        // 形状按 ST：`{...getContext(), getContext}`，逐次重算（`defGet`）。
        'if(!window.SillyTavern)defGet("SillyTavern",function(){' +
        'try{var o=getContext();o.getContext=getContext;return o}' +
        'catch(e){return{chat:[],saveChat:stSaveChat,getContext:getContext}}});' +
        // ── 3. 事件总线：eventOn/eventEmit/eventOnce/eventClearAll ────────────
        // 卡用这套协议收发 ERA 数据（它只 emit 请求，应答者另有其人）。
        // `eventClearAll` 这个名字是 ST 的 `predefine.js` 第 47 行要求的：
        // `$(window).on("pagehide",function(){eventClearAll()})` —— 名字对不上会当场抛。
        // ★ `on` 返回**取消订阅函数**（ST/酒馆助手同口径）：实测新卡
        //   `var unsub = on(name, handler); _eventBindings.push({name, unsub: typeof unsub === 'function' ? unsub : null})`
        //   —— 它自己就带 null 兜底，所以返回值只是"能用上更好"，不影响老卡。
        'var handlers={};' +
        'function on(n,f){try{n=S(n);if(typeof f!=="function")return undefined;(handlers[n]=handlers[n]||[]).push(f);return function(){try{off(n,f)}catch(e){}}}catch(e){return undefined}}' +
        'function off(n,f){try{var a=handlers[S(n)]||[];var i=a.indexOf(f);if(i>=0)a.splice(i,1)}catch(e){}}' +
        'function once(n,f){try{var w=function(d){try{off(n,w)}catch(e){}try{f(d)}catch(e){}};on(n,w)}catch(e){}}' +
        // 派发只在**卡内**做。宿主回灌的事件走这里，**不走 emit** —— 否则一个来回就成正反馈
        // （宿主 → 卡 → 转发回宿主 → 宿主再回 …），所以两处入口必须分开。
        'function fire(n,d){try{var a=(handlers[S(n)]||[]).slice();for(var i=0;i<a.length;i++){try{a[i](d)}catch(e){}}}catch(e){}}' +
        // 卡的 `eventEmit` = 卡内派发 + 把请求**转发给宿主**。
        // ★ 为什么必须转发：ERA 的数据在宿主那一侧（卡的 `eraGet()` 只读卡内的 `currentStat`，
        //   而 `currentStat` 完全靠事件喂）。宿主不在 iframe 里、也进不去（不透明来源），
        //   所以子 → 父这一跳是唯一的通路。
        'function emit(n,d){fire(n,d);out(n,d)}' +
        'function out(n,d){' +
        'try{' +
        'if(typeof n!=="string"||!n||n.length>64)return;' +
        // 只送可结构化克隆的纯数据：函数/DOM 节点/循环引用会让 postMessage 当场抛。
        // 先 stringify 再 parse，顺带得到一个体积上限（恶意卡不能靠一个巨大的 detail 撑爆父页）。
        'var s=null;try{s=JSON.stringify(d===undefined?null:d)}catch(e){s=null}' +
        'if(s===undefined)return;' +
        'if(s!==null&&s.length>65536)return;' +
        'var v=null;if(s!==null){try{v=JSON.parse(s)}catch(e){v=null}}' +
        'post({__muvEventOut:{name:n,detail:v}})' +
        '}catch(e){}}' +
        'function clearAll(){try{handlers={}}catch(e){}}' +
        'if(typeof window.eventOn!=="function")def("eventOn",on);' +
        'if(typeof window.eventEmit!=="function")def("eventEmit",emit);' +
        'if(typeof window.eventOnce!=="function")def("eventOnce",once);' +
        'if(typeof window.eventOff!=="function")def("eventOff",off);' +
        'if(typeof window.eventClearAll!=="function")def("eventClearAll",clearAll);' +
        // ── 4. 视口变量（ST §5 的 --TH-viewport-height）────────────────────
        'function setVh(px){try{px=Number(px);if(!isFinite(px)||px<200)return;document.documentElement.style.setProperty("--TH-viewport-height",Math.round(px)+"px")}catch(e){}}' +
        'setVh(window.__muvVH);' +
        // ── 5. 收宿主的消息 ────────────────────────────────────────────────
        // 只认 `window.parent` 发来的（沙箱里子文档的 origin 是 "null"，拿 origin 当凭据
        // 没有意义；用 source 比对才是有效凭据）。
        'window.addEventListener("message",function(ev){' +
        'try{' +
        'if(ev.source!==window.parent)return;' +
        'var d=ev.data;if(!d||typeof d!=="object")return;' +
        'if(d.__muvVH!==undefined)window.__muvVH=d.__muvVH;' +
        'if(d.type==="TH_UPDATE_VIEWPORT_HEIGHT"||d.__muvVH!==undefined)setVh(window.__muvVH);' +
        'if(d.__muvKvSeed&&typeof d.__muvKvSeed==="object"){var s2=d.__muvKvSeed;for(var k2 in s2){if(Object.prototype.hasOwnProperty.call(s2,k2))mem[k2]=S(s2[k2])}}' +
        'if(d.__muvChat&&d.__muvChat.list&&typeof d.__muvChat.list.length!=="undefined")hostChat=d.__muvChat.list;' +
        // 宿主→卡的事件注入：宿主 postMessage 这个形状，卡的 eventOn("era:queryResult")
        // 就收到（不需要同源）。
        // ★ 走 `fire` 而**不是** `emit`：这是「防环」的唯一开关。用 emit 的话宿主回灌的事件会被
        //   再转发回宿主，宿主照协议再回一次 —— 一个来回就成正反馈，父页被自己打满。
        // ★ 同一个 detail 再喂一份给**变量缓存**（`__muvAbsorb`）：MVU 卡的
        //   `Mvu.getMvuData()` / `TavernHelper.getVariables()` 是**同步**读，不喂缓存的话
        //   它们只能回初始值 —— 就是"服务端有真值、卡上是空的"那个症状。
        //   写成两条并列 if 而不是一条 if 里塞两句：`…__muvEvent.name)fire(` 这个形状是
        //   verify-era-bridge 的「防环」断言逐字盯着的（它认的就是"入站直接 fire"），
        //   合并成 `{fire(...);…}` 会把那条断言打红 —— 别为了少几个字节去动既有门禁口径。
        'if(d.__muvEvent&&d.__muvEvent.name)fire(d.__muvEvent.name,d.__muvEvent.detail);' +
        'if(d.__muvEvent&&d.__muvEvent.name)__muvAbsorb(d.__muvEvent.name,d.__muvEvent.detail);' +
        '}catch(e){}},false);' +
        // ── 5.5 音频兜底：CDN 文件名带序号，而预设「音乐列表」写的是裸类别名 ──
        // 实测（2026-09-22，直接 HEAD 那个 CDN）：
        //   `音频/日常.mp3` = **404**，而 `音频/日常1.mp3` / `日常2` / `日常3` = 200；
        //   搞笑 / 欢快 / 暧昧 同样（裸名 404、带序号 200）。
        // 而卡模板的 `processAudio()` 就是按消息里 `<audio>日常</audio>` 拼
        // `${BASE_URL}音频/日常.mp3` ⇒ 必然 404，播放器一片空白（卡自己的 error
        // 处理只是把提示语调暗）。ST 侧同一张卡、同一个 URL，同样会静默 —— 这一条
        // **不是我们的偏差**，但既然命名规律是确定的，就顺手兜住。
        // 策略：只在**真的加载失败**时兜，且只对"不以数字结尾"的 .mp3 名字动手，
        // 依次试 `<名字>1 / 2 / 3`；名字已经带序号（日常1）时**不猜**，绝不改坏正解。
        'var __muvAudioTried={};' +
        'function __muvAudioFix(el){' +
        'try{' +
        'var a=el;if(a&&String(a.tagName||"").toLowerCase()==="source")a=a.parentNode;' +
        'if(!a||String(a.tagName||"").toLowerCase()!=="audio")return;' +
        'var sEl=a.querySelector?a.querySelector("source"):null;' +
        'var src=(sEl&&sEl.getAttribute("src"))||a.getAttribute("src")||"";' +
        'var m=/^(.*\\/)([^\\/]+)\\.mp3$/i.exec(String(src).split("?")[0]);' +
        'if(!m)return;' +
        'var name="";try{name=decodeURIComponent(m[2])}catch(e){name=String(m[2])}' +
        // 别名记号挂在**元素自己**身上（`a.__muvAudioBase`），不能用全局名字表：
        // 全局表会让另一个元素上**合法**的 `日常1.mp3` 被当成我们的候选，被继续改掉
        // （门禁 B 档实测抓到的）。名字带数字结尾时**不猜** —— 除非它就是本元素上一轮兜出来的。
        'var base=a.__muvAudioBase||name;' +
        'if(!a.__muvAudioBase&&/\\d$/.test(name))return;' +
        'var n=__muvAudioTried[base]||0;' +
        'if(n>=3)return;__muvAudioTried[base]=n+1;' +
        'var cand=m[1]+encodeURIComponent(base+(n+1))+".mp3";' +
        // 改写方式很讲究：**只改 `<source>` 的 src 再 `load()` 不会重新触发**资源选择算法
        // （实测：重试一次之后就不再报错，等于没重试）。规范里媒体元素**有 `src` 属性时
        // 会忽略 `<source>` 子节点**，所以清空子节点 + 直接设 `src` 才能保证真的重新选源，
        // 而且之后的错误会打在媒体元素上（本函数的两个分支都收）。
        'if(sEl){try{while(a.firstChild)a.removeChild(a.firstChild)}catch(e){}}' +
        'a.setAttribute("src",cand);' +
        'try{a.__muvAudioBase=base}catch(e){}' +
        'try{console.log("[muv-engine] 音频兜底 "+name+".mp3 → "+name+(n+1)+".mp3")}catch(e){}' +
        'try{a.load()}catch(e){}' +
        'try{var p=a.play();if(p&&p.catch)p.catch(function(){})}catch(e){}' +
        '}catch(e){}}' +
        'document.addEventListener("error",function(ev){__muvAudioFix(ev&&ev.target)},true);' +
        // ── 6. 开工：向宿主报名（要 chat / 视口高 / KV 快照）─────────────────
        'post({__muvHello:1});' +
        // ── 7. 用户消息桥：卡里「发送到酒馆」的首选路径 ─────────────────────
        // 真卡 sendToTavern 的三级降级（ERA 状态栏 2998-3054 行实测）：① 宿主注入的
        // 全局函数 sendUserMessage(msg)（首选）② DOM 直插父文档 #send_textarea +
        // #send_but（跨源必被拒）③ 剪贴板。①在这里兑现：postMessage 给宿主，由宿主
        // 填 DSH 的聊天输入框（mode=send 再代发，mode=fill 只填不发送）。
        // 另一类卡（主页.html 的 fillSendTextarea）先搜**自己文档**里的 #send_textarea：
        // 给它一个隐藏收件箱，卡用原生 setter 写值 + input/change 事件时这里捕获后按
        // fill 转发 —— 卡自己的提示语就是「已填入消息输入框，请检查后手动发送」。
        // 收件箱只在卡源码真的用到这套约定时才装（避免无关卡里多一个幽灵元素）。
        'function __muvUserSend(msg,mode){try{var s=S(msg);if(!s||s.length>20000)return false;' +
        'post({__muvUserSend:{text:s,mode:mode==="fill"?"fill":"send"}});return true}catch(e){return false}}' +
        'if(typeof window.sendUserMessage!=="function")def("sendUserMessage",function(m){return __muvUserSend(m,"send")});' +
        'function __muvInbox(){try{' +
        'var src="";try{src=document.documentElement.innerHTML}catch(e){}' +
        'if(src.indexOf("send_textarea")===-1&&src.indexOf("sendUserMessage")===-1&&src.indexOf("fillSendTextarea")===-1)return;' +
        'if(document.getElementById("send_textarea"))return;' +
        'var t=document.createElement("textarea");t.id="send_textarea";t.setAttribute("data-muv-inbox","1");' +
        't.style.cssText="position:absolute!important;left:-9999px!important;top:0;width:10px;height:10px;opacity:0!important;pointer-events:none!important";' +
        'document.body.appendChild(t);' +
        'var h=function(){if(!t.value)return;__muvUserSend(t.value,"fill")};' +
        't.addEventListener("input",h);t.addEventListener("change",h);}catch(e){}}' +
        'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",__muvInbox)}else{__muvInbox()}' +
        // ── 8. 变量宿主 API 垫片：window.TavernHelper / window.Mvu / 裸全局 ──────────
        // 形态来源是**实测**（2026-09-22，新卡 `1.txt` 的 DOM 快照 + 依赖计数），不是照文档想象：
        //   · 卡里 `var W = (function(){ try{ return window.parent && window.parent.document ?
        //     window.parent : window; }catch(e){ return window; } })();`
        //     —— 跨源时 `window.parent.document` **抛异常** ⇒ `W === window` ⇒ 卡的
        //     `W.TavernHelper` / `W.Mvu` **正好落到我们这一份**。这就是"父页探测回落"
        //     能成立的原因（不需要、也做不到去写父页的对象）。
        //   · 卡的 `pickStat(o)` 只在 `o.stat_data` 是**非空对象**时才算数 ⇒ 我们缓存/回送的
        //     必须是 `{stat_data:{…}}` 形状（宿主侧 `muvMvuWrap` 负责包；平铺路径由
        //     `readVar` 的第二跳兜底命中）。少了这一层包装 ⇒ 卡的读链四跳全落空 ⇒ 面板空。
        //   · 卡的读链：`Mvu.getCurrentMvuData()` → `Mvu.getMvuData(scope)` →
        //     `TH.getVariables(scope)` → `ST.chat[i].variables[sw].stat_data`；
        //     写链：`Mvu.replaceMvuData(full, scope)` → `TH.replaceVariables(full, scope)` →
        //     `TH.insertOrAssignVariables(payload, scope)`。所以这四个方法都要有。
        //   · 卡用 `Mvu.events.VARIABLE_UPDATE_ENDED` / `'mag_variable_update_ended'` /
        //     `'mag_variable_initialized'` 订阅刷新 ⇒ 宿主在状态变化后 emit
        //     `mag_variable_update_ended`（见 `muvEraPushNow`），这里吸收进缓存。
        //   · 裸全局 `insertOrAssignVariables(payload,{type:"global"})` 与 `W.triggerSlash` 也是
        //     卡的真实调用点（酒馆助手在 ST 里就是注入裸全局的）⇒ 一并提供。
        'var mvuData={stat_data:{}};' +
        'function mergeDeep(a,b){try{var o={};var k;for(k in a){if(Object.prototype.hasOwnProperty.call(a,k))o[k]=a[k]}for(k in b){if(!Object.prototype.hasOwnProperty.call(b,k))continue;var x=o[k],y=b[k];if(y&&typeof y==="object"&&!Array.isArray(y)&&x&&typeof x==="object"&&!Array.isArray(x)){o[k]=mergeDeep(x,y)}else{o[k]=y}}return o}catch(e){return b}}' +
        'function cloneDeep(v){try{return JSON.parse(JSON.stringify(v))}catch(e){return v}}' +
        'function getPath(root,p){try{if(p==null||p==="")return root;var a=S(p).split(".");var c=root;for(var i=0;i<a.length;i++){if(c==null||typeof c!=="object")return undefined;c=c[a[i]]}return c}catch(e){return undefined}}' +
        'function setPathIn(root,p,v){try{var a=S(p).split(".");if(!a.length||!a[0])return root;var out=(root&&typeof root==="object"&&!Array.isArray(root))?cloneDeep(root):{};var c=out;for(var i=0;i<a.length-1;i++){var k=a[i];if(!c[k]||typeof c[k]!=="object")c[k]={};c=c[k]}c[a[a.length-1]]=v;return out}catch(e){return root}}' +
        // 变量树视图：整体优先；查路径时先整体、再退到 `stat_data` 里（卡两种写法都能命中）。
        'function readVar(p,def){var v=getPath(mvuData,p);if(v===undefined&&mvuData&&mvuData.stat_data)v=getPath(mvuData.stat_data,p);return v===undefined?def:v}' +
        'function mvuWrap(tree){try{var t=(tree&&typeof tree==="object"&&!Array.isArray(tree))?tree:{};if(t.stat_data&&typeof t.stat_data==="object")return t;return {stat_data:t}}catch(e){return {stat_data:{}}}}' +
        'function mvuSet(tree){try{mvuData=mvuWrap(tree)}catch(e){}}' +
        // 事件里的变量树：`era:queryResult` / `era:writeDone` 是宿主**已经算好**的那份，
        // `mag_variable_update_ended` 是 MVU 口径的推送（宿主已包过一层，这里再包是幂等的）。
        'function __muvAbsorb(n,d){try{if(n==="era:queryResult"&&d&&d.result&&d.result.stat){mvuSet(d.result.stat);return}if(n==="era:writeDone"&&d&&d.statWithoutMeta){mvuSet(d.statWithoutMeta);return}if(n==="mag_variable_update_ended"&&d){mvuSet(d);return}}catch(e){}}' +
        // MVU 数据是**宿主**持有的（卡内没有第二份真值）⇒ 先问一次；节流防卡循环问。
        'var mvuReqAt=0;' +
        'function mvuReq(){try{var n=Date.now();if(n-mvuReqAt<1000)return;mvuReqAt=n;post({__muvMvuReq:1})}catch(e){}}' +
        // 写回：只发"要写什么"，落库由宿主做（`__muvVarWrite` → POST /api/muv-engine/state）。
        // `replace=true` 只在"载荷自带 stat_data"时用 —— 那说明它是**整棵树**（见宿主侧注释）。
        'function varWrite(data,replace){try{if(!data||typeof data!=="object")return false;post({__muvVarWrite:{data:data,replace:!!replace}});return true}catch(e){return false}}' +
        'function warnShim(m){try{console.warn("[muv-engine] "+S(m))}catch(e){}}' +
        // ── 8.1 TavernHelper 的最小可用集 ────────────────────────────────────
        // ★ `getAllVariables()`（第 40 轮补，**本次两个硬故障之一**）：
        //   真机控制台 `Uncaught ReferenceError: getAllVariables is not defined`
        //   （`about:srcdoc` 的 `populateData`，`异世界农场` 卡的状态栏 HUD）——
        //   卡的 HUD 入口就是 `const all_vars = getAllVariables();
        //   const data = _.get(all_vars,'stat_data',{})`，**第一行就抛** ⇒ HUD 永远空。
        //   ST 侧签名（只读源码）：`JS-Slash-Runner/src/function/variables.ts:106`
        //     `export function _getAllVariables(this: Window): Record<string, any>`
        //     —— **同步**、**无参**、返回 `global → character → script → chat` 四层
        //     `_.assign` 合并后的**整棵变量树**（不是 `stat_data` 子树；子树由卡自己 `_.get`）。
        //     挂法：`src/function/index.ts:252` 把它放进 `TavernHelper._bind` 表，
        //     `src/iframe/predefine.js:14-18` 用 `key.replace('_','')` 去掉前导下划线后
        //     `value.bind(window)` ⇒ 卡里同时存在**裸全局**与 `TavernHelper.getAllVariables`
        //     两种写法（与既有 `getVariables` / `waitGlobalInitialized` 同一族）。
        //   我们只有一份树（`mvuData`）⇒ 直接回它（形状已是 `{stat_data:{…}}`，
        //   卡的 `_.get(all_vars,'stat_data')` 命中）。scope 差异照 §8.1 口径忽略。
        //   与 `getMvuData` 一样先 `mvuReq()` 问一次宿主（节流内 ⇒ 不会打满）。
        'function thGetAllVariables(){try{mvuReq();return mvuData}catch(e){return {}}}' +
        // `getVariables(scopeOrPath, opts)`：**两种调用形态都要认**（实测卡里两种都有）：
        //   `TH.getVariables({type:"message",message_id:"latest"})` ⇒ 回整树（卡的 pickStat 走这条）；
        //   `TH.getVariables("公司.总现金", {defaultValue:0})`    ⇒ 回路径值。
        // scope 的 type（global/character/chat/message）**我们只有一份树** ⇒ 一律忽略，
        // 在注释与文档里写明（这是与 ST 的**已知差异**，不是等价实现）。
        'function thGetVariables(a,b){try{' +
        'if(a&&typeof a==="object")return mvuData;' +
        'if(a===undefined||a===null||a==="")return mvuData;' +
        'var d=(b&&typeof b==="object"&&Object.prototype.hasOwnProperty.call(b,"defaultValue"))?b.defaultValue:undefined;' +
        'return readVar(a,d)' +
        '}catch(e){return undefined}}' +
        // 写 API 的落库口径（写在注释与文档里）：
        //   · 载荷自称整树（顶层有 stat_data）⇒ `replace`（宿主整树替换）；
        //   · 否则（平铺/增量）⇒ `merge`（深合并，**不抹**另一来源的键）。
        // 本地缓存**一律深合并** —— 缓存少一个键就会让卡的同步读链瞬间变空。
        'function thReplaceVariables(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,!!(obj.stat_data&&typeof obj.stat_data==="object"))}catch(e){return false}}' +
        'function thInsertOrAssign(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,false)}catch(e){return false}}' +
        'function getLastId(){try{return hostChat.length?hostChat.length-1:-1}catch(e){return -1}}' +
        'function findMsg(all,id){try{if(typeof id==="number"){var i=id<0?all.length+id:id;return (i>=0&&i<all.length)?all[i]:null}if(typeof id==="string"){for(var j=0;j<all.length;j++){if(String(all[j].message_id)===id)return all[j]}return null}return null}catch(e){return null}}' +
        'function chatMsgs(){try{var out=[];for(var i=0;i<hostChat.length;i++){var m=hostChat[i]||{};out.push({message_id:i,name:m.name||"",mes:String(m.mes==null?"":m.mes),is_user:!!m.is_user,role:m.is_user?"user":"assistant"})}return out}catch(e){return []}}' +
        // `getChatMessages`：形态尽量贴 ST（number/string ⇒ 单条；数组 ⇒ 子集；无参 ⇒ 全部；
        // 负下标从尾部数）。数据源是宿主喂进来的 `hostChat`（**只有文本**，没有 swipe /
        // 变量 / 时间戳 —— 那些键一律不出现，别伪造）。
        'function thGetChatMessages(ids){try{var all=chatMsgs();if(ids===undefined||ids===null)return all;if(Array.isArray(ids)){var out=[];for(var i=0;i<ids.length;i++){var h=findMsg(all,ids[i]);if(h)out.push(h)}return out}return findMsg(all,ids)}catch(e){return Array.isArray(ids)?[]:null}}' +
        // `formatAsTavernRegexedString`：**最小实现 = 原样返回**。为什么不做真正则：
        //   ST 那个 API 要按消息深度跑卡的正则脚本，我们这边**同步**函数里没有可用的
        //   服务端往返（它是同步签名，卡拿返回值直接用）。原样返回是**保守正确**：
        //   不假装渲染过，也不会把文本改坏。真正需要正则渲染的卡请走消息管线本身。
        'function thFormatRegex(t){return S(t)}' +
        // ── 8.2 triggerSlash：**白名单**（不在名单里的一律不执行） ────────────
        // 名单：`/send <文本>`（走已有的用户消息桥）、`/setvar k=v`、`/getvar k`、`/echo <文本>`。
        // `/send` 的 rest 会带卡的复合命令尾巴（真卡写法 `/send 选项|/trigger`，2026-09-25 实测
        // 涩涩提瓦特状态栏选项），必须把 `|` 后跟另一条 `/命令` 的部分剥掉，否则脏尾巴会
        // 一起发出去；文本里真正的 `|`（后面不是 `/命令`）保留。
        // 其余（含实测卡里在用的 `/inject`）**只警告、不执行**：`triggerSlash` 在 ST 里能驱动
        // 宿主做很多事（注入提示词、改楼层、触发生成），我们没有等价能力，就**如实不做**——
        // 静默装作做过会让卡以为成功、后面每一步都错。
        'function parseScalar(s){try{var t=S(s).trim();if(/^-?(?:\\d+\\.?\\d*|\\.\\d+)$/.test(t))return Number(t);if(t==="true")return true;if(t==="false")return false;if(t==="null")return null;var m=/^(["\'])([\\s\\S]*)\\1$/.exec(t);if(m)return m[2];return t}catch(e){return s}}' +
        'function triggerSlash(cmd){' +
        'try{' +
        'var s=S(cmd).trim();' +
        'var m=/^\\/([A-Za-z_][A-Za-z0-9_]*)\\s*([\\s\\S]*)$/.exec(s);' +
        'if(!m){warnShim("triggerSlash 未支持："+s);return Promise.resolve(null)}' +
        'var name=m[1].toLowerCase();var rest=m[2]||"";' +
        'if(name==="send"){var seg=rest;var pi=seg.indexOf("|");while(pi!==-1){var nxt=seg.slice(pi+1).replace(/^\\s+/, "");if(nxt.charAt(0)==="/"){seg=seg.slice(0,pi);break}pi=seg.indexOf("|",pi+1)}__muvUserSend(seg,"send");return Promise.resolve("")}' +
        'if(name==="echo"){try{console.log("[muv-engine] /echo "+rest)}catch(e){}return Promise.resolve("")}' +
        'if(name==="setvar"){' +
        'var eq=/^([^=\\s]+)\\s*=?\\s*([\\s\\S]*)$/.exec(rest);' +
        'if(!eq){warnShim("triggerSlash /setvar 缺参数："+rest);return Promise.resolve(null)}' +
        'var v2=parseScalar(eq[2]);mvuData=setPathIn(mvuData,eq[1],v2);' +
        'var w=setPathIn({},eq[1],v2);varWrite(w,false);' +
        'return Promise.resolve("")}' +
        'if(name==="getvar"){var gv=readVar(rest.trim(),"");return Promise.resolve(gv===undefined||gv===null?"":String(gv))}' +
        'warnShim("triggerSlash 未支持："+s);' +
        'return Promise.resolve(null)' +
        '}catch(e){warnShim("triggerSlash 异常："+S(e&&e.message));return Promise.resolve(null)}}' +
        // ── 8.1.5（第 36 轮）两个 ST 有、我们缺的全局：`errorCatched` / `tavern_events` ──
        //
        // 症状（用户真机控制台，构建 2026-09-22v，**异世界农场**那张卡）：
        //   [muv-engine] 卡脚本报错：（未知脚本）Uncaught ReferenceError: errorCatched is not defined
        //   （反复出现 —— 每渲染一条消息、状态栏那个 iframe 就再抛一次）
        //   Uncaught ReferenceError: tavern_events is not defined（§33.5 记的同一个缺口）
        // 两条都是**顶层**裸引用 ⇒ 该脚本/该模块**整段不执行**（不是"少个功能"）。
        //
        // ── ST 侧证据（只读源码 `JS-Slash-Runner`）───────────────────────────
        // · `errorCatched`：`src/function/util.ts:17` 是**纯函数版**，`:43` 是同名的
        //   **iframe 绑定版** `_errorCatched`；`src/iframe/predefine.js:14-18` 把 `_bind`
        //   表的每个键 `key.replace('_','')` 再 `value.bind(window)` ⇒ 卡 window 上拿到的是
        //   **去掉前导下划线的裸全局 `errorCatched`**（= 绑定版）。
        //   语义（两个版本一致，逐条照抄）：
        //     ① 入参是函数、**返回一个包装函数**（不是就地执行！）；
        //     ② 包装函数调用时：同步抛 ⇒ `toastr.error(堆栈, 名字)` 之后 **rethrow**（不吞）；
        //     ③ 返回值是 thenable ⇒ 走 `then(undefined, onError)`（成功后原值透传，
        //        被拒时同样 toastr + 抛出 ⇒ **返回的 promise 变成 rejected**）；
        //     ④ 绑定版比纯函数版多一步「写进 iframe 日志」（`this._th_impl._log`）与
        //        `[iframe_name]` 前缀 —— 我们没有 iframe 日志面板，等价物是控制台留痕。
        //   卡侧证据（本机真卡）：`异世界农场` 的两条状态栏正则产物（`角色状态双端` 21,200 字符
        //   / `双端` 12,120 字符）末尾都是 `$(errorCatched(init));` —— jQuery 的 `$(fn)` 是
        //   ready 回调 ⇒ **返回值必须是函数**（这就是上面 ① 在真卡上的兑现）。
        //
        // · `tavern_events`：`src/function/event.ts:180` 的常量表；`src/function/index.ts:311`
        //   把它挂在 `TavernHelper` 上，而 `predefine.js:13` 用 `_.omit(TavernHelper,'_bind')`
        //   把整个对象 merge 进卡 window ⇒ 卡里同样是**裸全局**。
        //   卡侧证据：MVU bundle（`MagicalAstrogy/MagVarUpdate/artifact/bundle.js`，573,299 字节，
        //   `异世界农场` 与 `魔法少女MVU测试` 两条卡脚本都 import 它）里 `tavern_events` **×17**，
        //   顶层就有（`kt(tavern_events.MESSAGE_DELETED, …)`）⇒ 缺它整个 bundle 一行都跑不到。
        //   同一份 bundle 里 `iframe_events` **×0**、本机真卡里也是 0 处 ⇒ **故意不补**
        //   （与 §32「卡不用的 API 加了只会让 DSH 比 ST 更宽松」同一口径，真遇到再取证）。
        //
        // ── 语义边界（如实写在这里与 HANDOFF 里）─────────────────────────────
        // 这里补的是**常量表与工具函数**，不是事件的发生源。卡的
        // `eventOn(tavern_events.MESSAGE_RECEIVED, …)` 从此能**注册成功**（此前连注册那一步
        // 都因 ReferenceError 跑不到），但宿主目前只在 ERA / MVU 那几条链路上广播
        // （`__muvEvent`）⇒ ST 那批**原生命名**的事件**多数仍然不会响**。
        // 那是"事件名 → 我们的事件面"的映射工作，需要单独取证（§33.5 的结论不变），本轮不做。
        'function errorCatched(fn){' +
        'function isP(v){return v!=null&&(typeof v==="object"||typeof v==="function")&&typeof v.then==="function"}' +
        'function onError(error){' +
        'try{' +
        'var e=error||{};' +
        'var msg=(e.stack?String(e.stack):String(e.message||e));' +
        'if(window.toastr&&typeof window.toastr.error==="function")window.toastr.error(msg,"[card] "+String(e.name||"Error"));' +
        'warnShim("errorCatched 接住的报错："+msg)' +
        '}catch(x){}' +
        'throw error}' +
        'return function(){' +
        'try{' +
        'var result=fn.apply(null,arguments);' +
        'if(isP(result))return result.then(undefined,function(error){return onError(error)});' +
        'return result' +
        '}catch(error){return onError(error)}' +
        '}}' +
        // 表体见下（逐字照抄 ST，82 条，含 `SMOOTH_STREAM_TOKEN_RECEIVED` / `STREAM_TOKEN_RECEIVED`
        // 这种**取值相同的别名** —— 别名是 ST 自己留的，删掉任何一个都会让走它的卡拿到 undefined）。
        'var tavernEvents={' +
        '"APP_READY":"app_ready",' +
        '"EXTRAS_CONNECTED":"extras_connected",' +
        '"MESSAGE_SWIPED":"message_swiped",' +
        '"MESSAGE_SENT":"message_sent",' +
        '"MESSAGE_RECEIVED":"message_received",' +
        '"MESSAGE_EDITED":"message_edited",' +
        '"MESSAGE_DELETED":"message_deleted",' +
        '"MESSAGE_UPDATED":"message_updated",' +
        '"MESSAGE_FILE_EMBEDDED":"message_file_embedded",' +
        '"MESSAGE_REASONING_EDITED":"message_reasoning_edited",' +
        '"MESSAGE_REASONING_DELETED":"message_reasoning_deleted",' +
        '"MESSAGE_SWIPE_DELETED":"message_swipe_deleted",' +
        '"MORE_MESSAGES_LOADED":"more_messages_loaded",' +
        '"IMPERSONATE_READY":"impersonate_ready",' +
        '"CHAT_CHANGED":"chat_id_changed",' +
        '"GENERATION_AFTER_COMMANDS":"GENERATION_AFTER_COMMANDS",' +
        '"GENERATION_STARTED":"generation_started",' +
        '"GENERATION_STOPPED":"generation_stopped",' +
        '"GENERATION_ENDED":"generation_ended",' +
        '"SD_PROMPT_PROCESSING":"sd_prompt_processing",' +
        '"EXTENSIONS_FIRST_LOAD":"extensions_first_load",' +
        '"EXTENSION_SETTINGS_LOADED":"extension_settings_loaded",' +
        '"SETTINGS_LOADED":"settings_loaded",' +
        '"SETTINGS_UPDATED":"settings_updated",' +
        '"MOVABLE_PANELS_RESET":"movable_panels_reset",' +
        '"SETTINGS_LOADED_BEFORE":"settings_loaded_before",' +
        '"SETTINGS_LOADED_AFTER":"settings_loaded_after",' +
        '"CHATCOMPLETION_SOURCE_CHANGED":"chatcompletion_source_changed",' +
        '"CHATCOMPLETION_MODEL_CHANGED":"chatcompletion_model_changed",' +
        '"OAI_PRESET_CHANGED_BEFORE":"oai_preset_changed_before",' +
        '"OAI_PRESET_CHANGED_AFTER":"oai_preset_changed_after",' +
        '"OAI_PRESET_EXPORT_READY":"oai_preset_export_ready",' +
        '"OAI_PRESET_IMPORT_READY":"oai_preset_import_ready",' +
        '"WORLDINFO_SETTINGS_UPDATED":"worldinfo_settings_updated",' +
        '"WORLDINFO_UPDATED":"worldinfo_updated",' +
        '"CHARACTER_EDITOR_OPENED":"character_editor_opened",' +
        '"CHARACTER_EDITED":"character_edited",' +
        '"CHARACTER_PAGE_LOADED":"character_page_loaded",' +
        '"USER_MESSAGE_RENDERED":"user_message_rendered",' +
        '"CHARACTER_MESSAGE_RENDERED":"character_message_rendered",' +
        '"FORCE_SET_BACKGROUND":"force_set_background",' +
        '"CHAT_DELETED":"chat_deleted",' +
        '"CHAT_CREATED":"chat_created",' +
        '"GENERATE_BEFORE_COMBINE_PROMPTS":"generate_before_combine_prompts",' +
        '"GENERATE_AFTER_COMBINE_PROMPTS":"generate_after_combine_prompts",' +
        '"GENERATE_AFTER_DATA":"generate_after_data",' +
        '"WORLD_INFO_ACTIVATED":"world_info_activated",' +
        '"TEXT_COMPLETION_SETTINGS_READY":"text_completion_settings_ready",' +
        '"CHAT_COMPLETION_SETTINGS_READY":"chat_completion_settings_ready",' +
        '"CHAT_COMPLETION_PROMPT_READY":"chat_completion_prompt_ready",' +
        '"CHARACTER_FIRST_MESSAGE_SELECTED":"character_first_message_selected",' +
        '"CHARACTER_DELETED":"characterDeleted",' +
        '"CHARACTER_DUPLICATED":"character_duplicated",' +
        '"CHARACTER_RENAMED":"character_renamed",' +
        '"CHARACTER_RENAMED_IN_PAST_CHAT":"character_renamed_in_past_chat",' +
        '"SMOOTH_STREAM_TOKEN_RECEIVED":"stream_token_received",' +
        '"STREAM_TOKEN_RECEIVED":"stream_token_received",' +
        '"STREAM_REASONING_DONE":"stream_reasoning_done",' +
        '"FILE_ATTACHMENT_DELETED":"file_attachment_deleted",' +
        '"WORLDINFO_FORCE_ACTIVATE":"worldinfo_force_activate",' +
        '"OPEN_CHARACTER_LIBRARY":"open_character_library",' +
        '"ONLINE_STATUS_CHANGED":"online_status_changed",' +
        '"IMAGE_SWIPED":"image_swiped",' +
        '"CONNECTION_PROFILE_LOADED":"connection_profile_loaded",' +
        '"CONNECTION_PROFILE_CREATED":"connection_profile_created",' +
        '"CONNECTION_PROFILE_DELETED":"connection_profile_deleted",' +
        '"CONNECTION_PROFILE_UPDATED":"connection_profile_updated",' +
        '"TOOL_CALLS_PERFORMED":"tool_calls_performed",' +
        '"TOOL_CALLS_RENDERED":"tool_calls_rendered",' +
        '"CHARACTER_MANAGEMENT_DROPDOWN":"charManagementDropdown",' +
        '"SECRET_WRITTEN":"secret_written",' +
        '"SECRET_DELETED":"secret_deleted",' +
        '"SECRET_ROTATED":"secret_rotated",' +
        '"SECRET_EDITED":"secret_edited",' +
        '"PRESET_CHANGED":"preset_changed",' +
        '"PRESET_DELETED":"preset_deleted",' +
        '"PRESET_RENAMED":"preset_renamed",' +
        '"PRESET_RENAMED_BEFORE":"preset_renamed_before",' +
        '"MAIN_API_CHANGED":"main_api_changed",' +
        '"WORLDINFO_ENTRIES_LOADED":"worldinfo_entries_loaded",' +
        '"WORLDINFO_SCAN_DONE":"worldinfo_scan_done",' +
        '"MEDIA_ATTACHMENT_DELETED":"media_attachment_deleted",' +
        // ⚠ 这里的 `;` **不能省**：整条垫片最终拼成**一行**，而自动分号插入（ASI）
        // 只在「下一个词元前面有换行」或「下一个词元是 `}`」时才补分号。`}` 后面直接
        // 跟同一行的 `var TH=` 不满足任何一条 ⇒ `SyntaxError: Unexpected token 'var'`，
        // 而且**从这一句起整段垫片都不执行**（TH / Mvu / toastr / 收尾的 mvuReq() 全丢）。
        // 第 36 轮踩过一次：`verify-card-libs.mjs` 的「产物必须可解析」断言就是为此加的。
        '};' +
        'var TH={version:"3.0.0",getVariables:thGetVariables,getAllVariables:thGetAllVariables,' +
        'replaceVariables:thReplaceVariables,' +
        'insertOrAssignVariables:thInsertOrAssign,updateVariablesWith:thUpdateVariablesWith,' +
        'deleteVariable:thDeleteVariable,triggerSlash:triggerSlash,' +
        'eventOn:on,eventEmit:emit,eventOnce:once,eventOff:off,eventClearAll:clearAll,' +
        'getChatMessages:thGetChatMessages,formatAsTavernRegexedString:thFormatRegex,' +
        'getLastMessageId:getLastId,getCurrentChatId:function(){return ""},getContext:getContext,' +
        // ST 的 `TavernHelper` 上这两个成员**本来就有**（index.ts:433 / :311）⇒ 一并给上，
        // 让 `TavernHelper.errorCatched(...)` / `TavernHelper.tavern_events.X` 两种写法都能跑。
        // `getScriptId` 的**定义**在 8.4.0（与占位 id 常量写在一起），此处只挂引用 ——
        // 整段垫片最终拼成**一行**顺序执行，定义在对象字面量之前 ⇒ 不是 TDZ 问题。
        'errorCatched:errorCatched,getScriptId:thGetScriptId,tavern_events:tavernEvents};' +
        // 只在卡**自己没定义**时落位（卡若自带一套，尊重卡的）。
        'if(!window.TavernHelper)def("TavernHelper",TH);' +
        // 裸全局（ST 的 predefine.js 就是这么给的）：同样只在**缺失**时补。
        // 判据是 `typeof !== "function"` / 不是对象，而不是真假值 —— 卡自己写了一个同名
        // 变量（哪怕是 null）我们都不动它。
        'if(typeof window.errorCatched!=="function")def("errorCatched",errorCatched);' +
        'if(!window.tavern_events||typeof window.tavern_events!=="object")def("tavern_events",tavernEvents);' +
        // ── 8.3 window.Mvu 的最小可用集 ─────────────────────────────────────
        // `events` 的名字**逐字照抄** MVU 真 bundle 的那张常量表（2026-09-23 取证：
        // `MagVarUpdate@master/artifact/bundle.js` 里的
        //   {VARIABLE_INITIALIZED:'mag_variable_initialized',
        //    VARIABLE_UPDATE_STARTED:'mag_variable_update_started',
        //    COMMAND_PARSED:'mag_command_parsed',
        //    VARIABLE_UPDATE_ENDED:'mag_variable_update_ended',
        //    BEFORE_MESSAGE_UPDATE:'mag_before_message_update',
        //    SINGLE_VARIABLE_UPDATED:'mag_variable_updated'}）。
        // ★ 修前这里写的是 `BEFORE_MESSAGE_UPDATE:"mag_variable_update_before"` ——
        //   一个从没由任何一方发射过的值 ⇒ 卡一旦走 `Mvu.events.BEFORE_MESSAGE_UPDATE`
        //   （而不是退化到字符串字面量）就订阅到一个**永生不响**的事件。同一次取证还
        //   发现缺三个成员，卡片侧 `Mvu.events.X` 会拿到 undefined。
        'var Mvu={version:"3.0.0",' +
        'events:{VARIABLE_INITIALIZED:"mag_variable_initialized",' +
        'VARIABLE_UPDATE_STARTED:"mag_variable_update_started",' +
        'COMMAND_PARSED:"mag_command_parsed",' +
        'VARIABLE_UPDATE_ENDED:"mag_variable_update_ended",' +
        'BEFORE_MESSAGE_UPDATE:"mag_before_message_update",' +
        'SINGLE_VARIABLE_UPDATED:"mag_variable_updated"},' +
        'getMvuData:function(){mvuReq();return mvuData},' +
        'getCurrentMvuData:function(){mvuReq();return mvuData},' +
        'getMvuVariable:function(p,d){return readVar(p,d)},' +
        'replaceMvuData:function(obj){try{if(!obj||typeof obj!=="object")return false;mvuData=mergeDeep(mvuData,obj);return varWrite(obj,!!(obj.stat_data&&typeof obj.stat_data==="object"))}catch(e){return false}}};' +
        'if(!window.Mvu)def("Mvu",Mvu);' +
        // ── 8.4 裸全局（酒馆助手在 ST 里就是注入裸全局；实测卡里两种写法都有） ──
        // ★★ 8.4.0 `getScriptId()`（第 40 轮补，**本次两个硬故障之一**）：
        //   真机控制台 `Uncaught ReferenceError: getScriptId is not defined`。
        //   HANDOFF §30.8 / 排错手册 §L 曾把它记为「故意未伪造（我们没有等价物）」——
        //   那时的影响面是"框架级开关不开"；2026-09-23 真机实测是 **Uncaught ReferenceError**，
        //   即 MVU bundle 的**顶层**取它就抛 ⇒ 已从"功能缺失"升级成"硬故障"，故本轮补最小桩。
        //
        //   ST 侧签名（只读源码）：`src/function/util.ts:97`
        //     `export function _getScriptId(this: Window): string`
        //     —— 读 iframe 的 `id`/`window.name`，要求以 `TH-script--` 开头，否则
        //     `throw new Error('你只能在脚本 iframe 内获取 getScriptId!')`；
        //     返回 `iframe_name.replace(/TH-script--.+--/, '')`（**脚本库的真实 id**）。
        //     挂法同 `getAllVariables`：`_bind` 表 → 去前导下划线 → 裸全局 + `TavernHelper` 成员。
        //
        //   ⚠ 语义半途（如实记录，不掩盖）：我们**没有脚本库**，也没有 `TH-script--…` 命名
        //     的 iframe ⇒ 这里返回的是**稳定的占位 id**（同一张卡内恒定），
        //     **不是** ST 那个真实脚本库 id。它能顶住的用法：作为 key/命名空间/后缀拼接
        //     （bundle 里 `mvu_VariableUpdate_${getScriptId()}`、`div[script_id]`、
        //     `th_unique_check.*` 的去重集合）—— 只要**稳定且非空**就语义成立。
        //     它**顶不住**的用法：拿它去换"我是不是那个被启用的脚本"这类判定
        //     （bundle 里 `listenPreferenceState(e => d.value = e === getScriptId())`）。
        //     ★ `listenPreferenceState` **照旧不伪造**（铁律）：它一旦返回假值就等于凭空
        //       打开一条我们接不住的更新管线。它在本环境里仍然未定义 ⇒ 那条判定会抛，
        //       由 bundle 自己的 `Promise.allSettled` / `errorCatched` 兜住（真机观察项）。
        'var MVU_PLACEHOLDER_SCRIPT_ID="dsh-script";' +
        'function thGetScriptId(){return MVU_PLACEHOLDER_SCRIPT_ID};' +
        // ── 8.4.1 第 41 轮：updateVariablesWith + 脚本按钮族（取证 → 全部有真实裸调用）──
        //
        // 取证方法照 §8.4.0 / 排错手册 §L：解两张真卡（异世界农场 / _足控天堂2）的
        // tEXt chara，把卡里 `import '<绝对URL>'` 的远端脚本**拉下来一起数**（§31.2 铁律），
        // 再拿 ST `JS-Slash-Runner` 的 `_bind` 全表（src/function/index.ts ~229-260，34 个名字）
        // 对三条脚本做**系统化普查**（不是只看实录的那几个名字）。实录 + 普查的重合结论：
        //
        //   名字                          裸调用次数(bundle/ERA脚本/自动更新)   ST 定义处
        //   updateVariablesWith           8 / 3 / 0    variables.ts:203（非下划线版）+ :229（_bind 版）
        //   getButtonEvent                1 / 3 / 3    script.ts:54
        //   replaceScriptInfo             0 / 0 / 1    script.ts:143
        //   getScriptButtons              3 / 0 / 2    script.ts:58
        //   replaceScriptButtons          3 / 0 / 2    script.ts:71
        //   appendInexistentScriptButtons 1 / 0 / 0    script.ts:110
        //   eventClearEvent               0 / 0 / 2    event.ts:145
        //   eventMakeFirst / eventMakeLast 2+1 / 0 / 0 event.ts:88-107
        //   eventRemoveListener           6 / 4 / 0    event.ts:130（= 我们的 eventOff 同义）
        //   deleteVariable                1 / 0 / 0    variables.ts:281（返回 {variables, delete_occurred}）
        //   getCurrentMessageId           2 / 0 / 0    util.ts:105
        //
        // 卡里怎么用（实录对应的现场）：
        //   · ERA 变量框架顶层：`eventOn(getButtonEvent('写入变量修改'),…)` —— **顶层裸引用**，
        //     缺它整条框架脚本不执行（这就是用户实录的 ReferenceError）。
        //   · MVU bundle 初始化把按钮注册函数 push 进清理表：`appendInexistentScriptButtons(…)` →
        //     `eventOn(getButtonEvent(e.name),e.function)` → `getScriptButtons()` —— **同一条
        //     执行路径**，只补 getButtonEvent 会让它死在下一个名字上 ⇒ 按钮族一起补。
        //   · bundle 大量 `await updateVariablesWith(t=>{…mutate…return t},{type:'chat'|
        //     'message',message_id:…})`；自动更新脚本 `replaceScriptInfo(README文本)`。
        //
        // ST 侧挂载口径（照 §8.4.0 同一套）：`_bind` 表 → predefine.js 去前导下划线 ⇒
        // **裸全局**；其中 `updateVariablesWith` / `deleteVariable` 在 ST 的 TavernHelper
        // 对象上**本来就有成员**（index.ts:440 / variables 段）⇒ 一并挂 TH。
        // 按钮族四个 + replaceScriptInfo + eventMakeFirst/Last + eventRemoveListener +
        // eventClearEvent + getCurrentMessageId 在 ST 是 _bind 专属 ⇒ **只给裸全局**
        //（ST 的 TavernHelper 上本来就没有这些成员，挂上反而偏离）。
        //
        // ★ `updateVariablesWith(updater, option)`：ST 语义 = 取该 scope 变量树 → updater
        //   （同步或返回 Promise）→ replaceVariables 写回 → 返回 updater 的结果。
        //   我们只有一棵树（§8.1 已知口径）：updater 收 `cloneDeep(mvuData)`（它会在上面
        //   mutate），落库走与 thReplaceVariables 相同的 merge + varWrite 通道。
        //   ⚠ 已知偏差（如实）：ST 是整树 replace，我们是 merge ⇒ updater 里 `_.unset`
        //   的删除写不回缓存（bundle 的清理路径会受此影响；与 §8.1 replace/merge 口径一致，
        //   换 replace 会引入"旧楼 iframe 用陈旧快照整树覆盖"的串楼风险，两害取轻）。
        //   option 的 scope（type/message_id）照 §8.1 口径忽略（单树）。
        'function thUpdateVariablesWith(updater,opt){try{' +
        'if(typeof updater!=="function")return undefined;' +
        'var snap=cloneDeep(mvuData);var r=updater(snap);' +
        'function apply(x){try{if(x&&typeof x==="object"){mvuData=mergeDeep(mvuData,x);varWrite(x,!!(x.stat_data&&typeof x.stat_data==="object"))}}catch(e){}return x}' +
        'if(r&&(typeof r==="object"||typeof r==="function")&&typeof r.then==="function")return r.then(apply);' +
        'return apply(r)}catch(e){try{warnShim("updateVariablesWith 异常："+S(e&&e.message))}catch(x){}return undefined}}' +
        // ★ `getButtonEvent(button_name)`：ST = `getButtonId(getScriptId(), name)` =
        //   `script_id + '_' + getStringHash(name)`（store/iframe_runtimes/script.ts:6）。
        //   getStringHash 抄自 ST `public/scripts/utils.js:522`（murmur3 收尾，逐字复刻）⇒
        //   事件 id 与 ST **逐字节一致**（`dsh-script_<hash>`）。哈希只要求确定性 + 与
        //   `getAllEnabledScriptButtons` 那侧一致，我们没有按钮面板 ⇒ 无跨侧引用，但复刻零成本。
        'function thStrHash(str,seed){try{if(typeof str!=="string")return 0;var h1=0xdeadbeef^(seed||0),h2=0x41c6ce57^(seed||0),i,ch;' +
        'for(i=0;i<str.length;i++){ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677)}' +
        'h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);' +
        'h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);' +
        'return 4294967296*(2097151&h2)+(h1>>>0)}catch(e){return 0}}' +
        'function thGetButtonEvent(name){try{return String(MVU_PLACEHOLDER_SCRIPT_ID)+"_"+thStrHash(String(name),0)}catch(e){return String(MVU_PLACEHOLDER_SCRIPT_ID)+"_0"}}' +
        // ★ 按钮族三个：ST 在「脚本运行时不存在」时本来就是**静默退化分支**
        //   （script.ts:61/76 的 `if (!script) return []` / `return;`）—— 我们没有酒馆助手
        //   脚本面板 ⇒ 提供的正是这个分支：getScriptButtons 回 []（bundle 用
        //   `_.intersectionBy(getScriptButtons(),Fo,…)` 消费，[] 语义正确），
        //   replaceScriptButtons / appendInexistentScriptButtons 静默 no-op。
        //   按钮不会出现在任何 UI 是**如实**（我们没有面板可显示），不是伪造成功。
        'function thGetScriptButtons(){return []}' +
        'function thReplaceScriptButtons(){return undefined}' +
        'function thAppendInexistentScriptButtons(){return undefined}' +
        // ★ `replaceScriptInfo(info)`：script.ts:143 写 `script.info`（脚本面板的说明区）。
        //   我们没有脚本面板/脚本库 ⇒ 同上取 ST 的"无脚本"静默分支：no-op。
        //   ⚠ 语义半途（如实）：info 被丢弃，不持久化、不显示；自动更新脚本拿它写 README
        //   纯属面板展示，不影响任何数据/逻辑路径。
        'function thReplaceScriptInfo(){return undefined}' +
        // ★ `eventClearEvent(event_type)`：event.ts:145 = 移除该事件的**全部**监听器。
        //   对我们的 handlers 表就是整键删除（与 eventOn/off/emit 同一张表，语义精确对齐）。
        'function thEventClearEvent(n){try{delete handlers[S(n)]}catch(e){}}' +
        // ★ `eventMakeFirst/Last(event_type, listener)`：event.ts:88-107 = 把该监听器挪到
        //   派发序列的头/尾。我们的 handlers 数组就是派发序列 ⇒ 精确实现。
        //   **返回 undefined**（新版 ST 返回带 stop() 的句柄；bundle 侧是 `C?.stop()` 可选链，
        //   undefined 走短路，安全）。
        'function thEventMakeFirst(n,f){try{var a=handlers[S(n)];if(a&&a.length){var i=a.indexOf(f);if(i>0){a.splice(i,1);a.unshift(f)}}}catch(e){}}' +
        'function thEventMakeLast(n,f){try{var a=handlers[S(n)];if(a&&a.length){var i=a.indexOf(f);if(i>=0&&i<a.length-1){a.splice(i,1);a.push(f)}}}catch(e){}}' +
        // ★ `deleteVariable(variable_path)`：variables.ts:281，返回 `{variables, delete_occurred}`。
        //   在整树上删路径键（ST 就是删 scope 树根上的键）；删完 varWrite 整树（replace=true，
        //   因为载荷就是整棵树）。路径不存在 ⇒ 原样返回 + false（与 ST 的 _.unset 语义一致）。
        'function thDeleteVariable(p){try{var a=S(p).split("."),i;if(!a.length||!a[0])return {variables:mvuData,delete_occurred:false};' +
        'var root=cloneDeep(mvuData),c=root;for(i=0;i<a.length-1;i++){if(c==null||typeof c!=="object")return {variables:mvuData,delete_occurred:false};c=c[a[i]]}' +
        'if(c==null||typeof c!=="object"||!Object.prototype.hasOwnProperty.call(c,a[i]))return {variables:mvuData,delete_occurred:false};' +
        'delete c[a[i]];mvuData=root;varWrite(root,true);return {variables:mvuData,delete_occurred:true}}catch(e){return {variables:mvuData,delete_occurred:false}}}' +
        // ★ `getCurrentMessageId()`：util.ts:105 从 iframe 名 `TH-message--<id>--…` 解析本楼 id。
        //   ⚠ 语义半途（如实）：我们的卡 iframe 是每楼一份，但垫片拿不到楼层号 ⇒ 回最后一楼
        //   （getLastId）。消费方（bundle 的 getCurrentMvuData）走 getVariables(scope) 时
        //   scope 本来就被 §8.1 口径忽略 ⇒ 该偏差被现有口径吸收，不产生新行为差。
        'function thGetCurrentMessageId(){return getLastId()}' +
        'if(typeof window.getAllVariables!=="function")def("getAllVariables",thGetAllVariables);' +
        'if(typeof window.getScriptId!=="function")def("getScriptId",thGetScriptId);' +
        'if(typeof window.updateVariablesWith!=="function")def("updateVariablesWith",thUpdateVariablesWith);' +
        'if(typeof window.deleteVariable!=="function")def("deleteVariable",thDeleteVariable);' +
        'if(typeof window.getButtonEvent!=="function")def("getButtonEvent",thGetButtonEvent);' +
        'if(typeof window.getScriptButtons!=="function")def("getScriptButtons",thGetScriptButtons);' +
        'if(typeof window.replaceScriptButtons!=="function")def("replaceScriptButtons",thReplaceScriptButtons);' +
        'if(typeof window.appendInexistentScriptButtons!=="function")def("appendInexistentScriptButtons",thAppendInexistentScriptButtons);' +
        'if(typeof window.replaceScriptInfo!=="function")def("replaceScriptInfo",thReplaceScriptInfo);' +
        'if(typeof window.eventClearEvent!=="function")def("eventClearEvent",thEventClearEvent);' +
        'if(typeof window.eventMakeFirst!=="function")def("eventMakeFirst",thEventMakeFirst);' +
        'if(typeof window.eventMakeLast!=="function")def("eventMakeLast",thEventMakeLast);' +
        'if(typeof window.eventRemoveListener!=="function")def("eventRemoveListener",off);' +
        'if(typeof window.getCurrentMessageId!=="function")def("getCurrentMessageId",thGetCurrentMessageId);' +
        'if(typeof window.getVariables!=="function")def("getVariables",thGetVariables);' +
        'if(typeof window.replaceVariables!=="function")def("replaceVariables",thReplaceVariables);' +
        'if(typeof window.insertOrAssignVariables!=="function")def("insertOrAssignVariables",thInsertOrAssign);' +
        'if(typeof window.triggerSlash!=="function")def("triggerSlash",triggerSlash);' +
        'if(typeof window.getLastMessageId!=="function")def("getLastMessageId",getLastId);' +
        'if(typeof window.formatAsTavernRegexedString!=="function")def("formatAsTavernRegexedString",thFormatRegex);' +
        'if(typeof window.getChatMessages!=="function")def("getChatMessages",thGetChatMessages);' +
        // ── 8.5 两个"框架要开局先验明正身"的全局（缺了不是"少个功能"，是**整个框架不启动**）──
        // ★ `getTavernHelperVersion()`：MVU bundle 的入口第一行就是
        //   `await checkVersion('3.4.17', {message:…, title:…})`，内部
        //   `compare(await getTavernHelperVersion(), '3.4.17','<')` ——
        //   这个全局在 bundle 里**没有定义**（它属于酒馆助手），不提供就是
        //   `ReferenceError` ⇒ 那个顶层 `await` 所在的 async IIFE 直接拒 ⇒ 后面
        //   一行都跑不到（事件订阅、面板、变量钩子全部零）。MVU 的 HUD 就是这么没的。
        //   返回值取 **3.4.17**（MVU 要求的最低版本）而不是我们 TH.version 的 3.0.0：
        //   低了只会触发它那条"请先升级酒馆助手"的报错 toast，那是**误导**（DSH 里
        //   没有可升级的酒馆助手）。真实覆盖半途的地方都写在本文件与 HANDOFF 里。
        'if(typeof window.getTavernHelperVersion!=="function")def("getTavernHelperVersion",function(){return "3.4.17"});' +
        // ★ `toastr`：ST 宿主页的提示条库（bundle 里 78 处、真卡的 MVU 脚本里也有）。
        //   卡 iframe 里本来就没有那套 DOM ⇒ 最小实现 = **照发到控制台**
        //   （不假装弹过，也不让它在每个报错分支上再抛一次 TypeError）。
        'if(!window.toastr)def("toastr",{' +
        'info:function(m,t){try{console.log("[muv-engine] 卡提示 "+(t||"")+"："+m)}catch(e){}},' +
        'success:function(m,t){try{console.log("[muv-engine] 卡提示 "+(t||"")+"："+m)}catch(e){}},' +
        'warning:function(m,t){try{console.warn("[muv-engine] 卡警告 "+(t||"")+"："+m)}catch(e){}},' +
        'error:function(m,t){try{console.warn("[muv-engine] 卡报错 "+(t||"")+"："+m)}catch(e){}}});' +
        // ── 8.6 `waitGlobalInitialized`：ST 在 predefine.js 的 `_bind` 表里注入 ────
        //   ★ ST 侧证据：`dist/index.js` 的 `_bind` 表里有 `_waitGlobalInitialized`，
        //     `src/iframe/predefine.js:14-18` 用 `key.replace('_','')` 去掉前导下划线后
        //     `value.bind(window)` ⇒ 卡 iframe 里存在**裸全局** `waitGlobalInitialized`。
        //   ★ 卡侧证据：真卡 8 处**探测式**调用（`星辉MVU核心` 3 / 事件推进器 2 / …）：
        //       const wait = roots.map(x => x.waitGlobalInitialized).find(...)
        //         || (typeof waitGlobalInitialized === 'function' ? waitGlobalInitialized : null);
        //       if (wait) { await wait('Mvu'); }
        //     —— 它自带兜底，缺了**不抛**，所以这条不是"缺了就崩"那一类。
        //   补它的理由不是防崩，是让卡走 ST 的**主路径**：它等的是 `Mvu`，而我们的
        //   `Mvu` 垫片是**同步**就位的（数据由宿主推）⇒ 立即 resolve 是**语义正确**的，
        //   不是"假装就绪"。名字取不到时**不 reject**（最多轮询 2 秒后 resolve
        //   undefined）—— 卡的 `.then` 不会因我们而掉进 catch 分支。
        'if(typeof window.waitGlobalInitialized!=="function"){' +
        'var __wgi=function(name){try{var v=window[String(name)];if(v!==undefined&&v!==null)return Promise.resolve(v)}catch(e){}' +
        'return new Promise(function(res){var n=0;var t=setInterval(function(){try{var v=window[String(name)];n++;' +
        'if((v!==undefined&&v!==null)||n>=40){clearInterval(t);res(v)}}catch(e){clearInterval(t);res(undefined)}},50)})};' +
        'def("waitGlobalInitialized",__wgi);}' +
        // 开工就先问一次 MVU 数据（此刻宿主可能还没预热完 ⇒ 回来后走 `__muvMvuReq` 的补齐队列）。
        'mvuReq();' +
        '})();'
    }

    /**
     * 卡 iframe 的**跨 iframe KV 存储**（父页内存）。
     *
     * 为什么必须有这一层（不是"锦上添花"）：卡在**每条消息**里各有一个 iframe，
     * 而 CG 画廊状态 `ft2_cg_cache_v2` 正是在这些 iframe 之间流转的 ——
     * 「上一条消息的状态栏解锁了一张 CG，下一条消息的状态栏应该看得见」。
     * 只用内存垫片的话，每个 iframe 都是一座孤岛，画廊会一直空着（**和修之前一样**）。
     *
     * 键的取法：对**注入前的卡文档**做一个 32 位散列（`k` + 十六进制 + 长度）。
     * 同一张卡每次重建得到同一个键 ⇒ 状态能续上；不同的卡互不串。
     *
     * 安全约束（跨源消息是最容易被拿来做手脚的入口，照 `onMuvFrameHeightMessage` 的口径）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃；
     *  - 键**不从消息里取**，而是从那个 iframe 元素的 `data-muv-kv` 属性取 ——
     *    消息里的东西一律不可信，恶意卡不能借此写别的卡的命名空间；
     *  - 只接受字符串键/值，且键 ≤ 160 字符、值 ≤ 256 KB、单卡 ≤ 400 条 / 2 MB 总量，
     *    超限就拒绝（防止恶意卡把父页内存撑爆）；
     *  - **命名空间带会话栅栏**：真正落进来的键是 `muvKvKeyOf(key)`，即 `<卡键>@<会话 id>`
     *    —— 同一张卡在两个会话里各持一份互不可见的 KV。少了这道栅栏，B 会话的卡会看到
     *    A 会话解锁的 CG（CG 画廊状态在两个会话之间串）。
     *  - 只做 KV 读写与 chat 回送，**不 eval、不插入内容、不读卡内任何东西**。
     * @type {Object<string, Object>}
     */
    var muvKv = {}

    /**
     * `muvKv` 的 LRU 记账：`命名空间键 → 最近一次触碰的 ms`（brief P2）。
     *
     * 为什么必须有：400 条 / 2MB 是**每键**上限，**键的总数原先没有上限**，而键 = 卡内容散列
     * + 长度 —— 内容一变（编辑消息、流式重渲染）就是**新键**，旧键永远留着。`muvKv` 是
     * 页面级生命周期，没有 delete、没有清理钩子 ⇒ 30 个历史键 × 最坏 2MB = 60MB 常驻。
     * 现在按 16 键 / 8MB 两道上限做 LRU 淘汰；会话切换时另外清掉不可达的键（见 `muvKvGc`）。
     * 故意**声明成纯对象字面量**（理由同 `muvEraVars`：逐字提取的门禁要能内联它）。
     * @type {Object<string, number>}
     */
    var muvKvAt = {}

    /**
     * 已装饰过的消息文本。宿主把它回送给卡的 `getContext().chat`。
     *
     * 卡的 `cgScanChat` 两条路：① `SillyTavern.getContext().chat`（我们靠垫片顶上）；
     * ② 扫 DOM（要 `window.parent.document`，跨源被拒，没用）。所以①是唯一活路，
     * 而①的数据只能由宿主提供 —— 宿主手里就是这些消息文本。
     *
     * ★ 但它是**会话局部的**（brief P2）：原先这条缓冲是全局的，而 `muvReplyToFrame` 把
     *   **全量 80 条**发给**每一个**卡 iframe ⇒ A 会话的消息会出现在 B 会话卡的
     *   `getContext().chat` 里，卡的 `cgScanChat` 扫 `<img>名</img>` ⇒ **在 B 会话能解锁
     *   A 会话的 CG**，A 会话正文（含世界书文本）也被送进 B 会话 iframe。
     *   现在由 `muvChatFence()` 按 `currentSessionId()` 当栅栏：会话 id 一变就整条清空。
     *   故意**不是 const**：清空是重新绑定一个新数组（所有闭包读的都是同一个模块变量，
     *   不需要逐个通知）。
     * @type {Array<string>}
     */
    var muvChatLog = []

    /** chat 栅栏状态：上次观察到的会话 id（会话一变，`muvChatLog` 整条作废）。 */
    var muvChatSession = ''

    var MUV_KV_MAX_KEY = 160
    var MUV_KV_MAX_VAL = 262144
    var MUV_KV_MAX_ITEMS = 400
    var MUV_KV_MAX_TOTAL = 2097152
    /** KV 命名空间的**总数**上限（LRU）与全部命名空间的字节上限。 */
    var MUV_KV_MAX_NS = 16
    var MUV_KV_MAX_NS_TOTAL = 8388608
    var MUV_CHAT_MAX_ITEMS = 80
    var MUV_CHAT_MAX_ITEM = 40000
    var MUV_CHAT_MAX_TOTAL = 600000

    /** ERA 变量快照的复用窗口（ms）。同一批 iframe 的 `era:getCurrentVars` 共用一个请求。 */
    var MUV_ERA_TTL = 5000
    /** 同一帧的 ERA 应答上限（窗口内），防止卡用 `setInterval` 把父页的主线程刷满。 */
    var MUV_ERA_MAX_REPLIES = 8
    var MUV_ERA_WINDOW = 4000

    /**
     * ERA 变量快照的缓存。
     *
     * **故意声明成纯对象字面量**（字段运行时再挂）：`verify-shared.mjs` 的
     * `moduleVarStatements` 只内联「RHS 是纯字面量」的模块级 `var`，带标识符字段的对象字面量
     * 会被它跳过 —— 那样逐字提取出来的函数在门禁里就成了 `ReferenceError`。
     * `.locator` = 这份数据是**按谁**取的（会话 id 或预设 id），`.data` = 变量树（未就绪为 null），
     * `.at` = 取数时刻，`.inflight` = 正在取。
     * @type {Object}
     */
    var muvEraVars = {}
    /** 取数还没回来就收到的请求（帧 + 请求名），回来后一起兑现。 */
    var muvEraPending = []
    /** 按 iframe 的 KV 命名空间记账的应答滑动窗口。 */
    var muvEraGate = {}

    /**
     * `__muvHello` 的**每帧**节流时间戳（`data-muv-kv` → 上次回送的 ms）。
     *
     * 为什么必须有：hello 是卡**唯一**能主动反复触发的入口，而每次回送要付
     * `muvCompatSeedMap`（深遍历最多 400 条 KV 重建对象）+ `muvChatList`（80 条 / 600KB
     * 截断）+ 两次 `postMessage`（结构化克隆）。沙箱卡只要
     * `setInterval(function(){parent.postMessage({__muvHello:1},"*")},0)` 就能把父页主线程
     * 打满 —— 跨源消息的 source 校验挡不住它（它**就是**我们自己的卡）。
     * 200ms 是"比任何合理重绘都快、比 setInterval 慢两个数量级"的折中；
     * 第一次回送**不受限**（否则卡的首屏拿不到种子）。
     * 故意**声明成纯对象字面量**：`verify-shared.mjs` 的 `moduleVarStatements` 只内联
     * 「RHS 是纯字面量」的模块级 `var`，带标识符字段的对象字面量会被它跳过 ⇒ 逐字提取出来的
     * 函数在门禁里会 `ReferenceError`。键被删掉也没关系（下次当作首次）。
     * @type {Object<string, number>}
     */
    var muvHelloAt = {}
    /** 同帧两次 hello 回送的最小间隔（ms）。 */
    var MUV_HELLO_MIN_GAP = 200

    /**
     * 用户消息桥的每帧节流账本（`data-muv-kv` → 最近一次转发 ms）。
     * 声明口径同 `muvHelloAt`（纯对象字面量，供逐字提取的门禁内联）。
     * @type {Object<string, number>}
     */
    var muvUserSendAt = {}
    /** 同帧两次「用户消息」转发的最小间隔（ms）。 */
    var MUV_USERSEND_MIN_GAP = 800

    /**
     * 卡内**变量写 API** 的每帧节流账本（`data-muv-kv` → 最近一次落库 ms）。
     *
     * 为什么要节流：`Mvu.replaceMvuData` / `TavernHelper.insertOrAssignVariables` 是卡**能主动
     * 反复触发**的入口，每次都要写服务端 + 作废缓存 + 多档重推（三次取数 + 三次全帧 postMessage）。
     * 沙箱卡 `setInterval(…,0)` 就能把父页与服务端一起打满。声明口径同 `muvHelloAt`。
     * @type {Object<string, number>}
     */
    var muvVarWriteAt = {}
    /** 同帧两次「变量落库」的最小间隔（ms）。 */
    var MUV_VARWRITE_MIN_GAP = 200
    /** 单次 `__muvVarWrite` 的 JSON 体积上限（字符）：恶意卡不能靠一个巨型树撑爆服务端。 */
    var MUV_VARWRITE_MAX_BYTES = 524288

    /**
     * `__muvMvuReq` 的每帧节流账本（`data-muv-kv` → 最近一次应答 ms）。
     * 声明口径同 `muvHelloAt`。@type {Object<string, number>}
     */
    var muvMvuReqAt = {}
    /** 同帧两次 MVU 数据回送的最小间隔（ms）。 */
    var MUV_MVUREQ_MIN_GAP = 400

    /** 取数没回来就收到的 `__muvMvuReq`（帧），回来后用 `mag_variable_update_ended` 一起兑现。 */
    var muvMvuPending = []

    /**
     * 卡 → 宿主的「用户消息」落地：把文本写进 DSH 的聊天输入框。
     *
     * mode='fill' 只填不发送（主页卡的提示语是「已填入消息输入框，请检查后手动发送」，
     * 卡自己会 toast 提示）；mode='send' 填入后再代发一次（多通道，见 `muvUserSendFire`
     * 的取证结论与通道矩阵：① 真实 click 发送按钮 ② 完整 Enter 键盘序列）。
     * 找输入框的优先级与 `exports.apply` 里 muv-choice-btn 的点击委托一致：宏钩子标记 →
     * placeholder 关键词 → 兜底全量扫（可见、可写、rows≥2）。值必须走**原生 setter**
     * （DSH 的输入框是受控组件）——这条填值路径已验证工作，**本函数不改动**。
     * @param {string} text
     * @param {'fill'|'send'} mode
     * @returns {boolean} 是否找到了输入框并写入
     */

    /**
     * 用户消息桥 send 通道（多通道，逐级降级）。
     *
     * ★ 取证结论（DSH web-frontend @deepseek-ai/dsh v0.1.5-rc.2，dist/assets/index-*.js +
     *   vendor-*.js，只读未改本体）：
     *  - DSH 聊天界面是 **React 应用**；发送绑定在「发送按钮」与「输入框 onKeyDown(Enter)」
     *    两处（bundle 里有 `IconSendOutline` 发送图标按钮，onClick→发送、onKeyDown
     *    Enter/Space→发送；输入框走 `e.key === "Enter"` 判据）。
     *  - 全链路**没有任何 `e.isTrusted` 校验**（bundle 里出现的 `isTrusted:0` 是 React
     *    SyntheticEvent 的默认字段，不是守卫）——所以合成事件可被接受。
     *  - **没有任何暴露到 `window` 的可编程发送入口**（仅 `window.__ModuleLoader__` 内部
     *    加载器，不是发送 API）——故「直接调全局函数」这条通道不可用。
     *  - React 的 `getEventKey` 把 `keyCode 13 → "Enter"`，且合成 `KeyboardEvent` 的
     *    `keyCode/which` 取构造参数；若处理器读 `keyCode/which`（非常常见），旧实现只带
     *    `key:'Enter'`（keyCode/which=0）的合成事件会**静默落空**——这正是用户实测
     *    「卡里提交后 DSH 没生成下文」的头号嫌疑。
     *  ⇒ 加固为：① 真实 `click()` 发送按钮（最稳，直接调其发送回调，不吃事件形态）→
     *    ② 输入框派发**完整键盘序列** keydown+keypress+keyup，keyCode/which/code 全带上。
     *  ★ 铁律：**绝不清空输入框**——宁可消息留在框里让用户手动按一下，也不能吞字
     *    （旧实现曾因只派一个 keydown 且没留痕，失败时连「字还在」都不可见）。每通道留痕
     *    `console.info('[muv-engine] 用户消息桥：…')`，方便用户回报哪个通道命中。
     * @param {HTMLTextAreaElement|null} ta 已填好值的输入框
     */
    function muvUserSendFire(ta) {
      if (!ta) return
      function log(s) { try { console.info('[muv-engine] 用户消息桥：' + s) } catch (_) {} }
      // —— 通道①：发送按钮真实 click()（最可靠，绕过键盘事件形态差异）——
      var btn = null
      try {
        // 从输入框向上爬父链（≤6 层），收集同容器内所有 button；优先「带 发送/Send/Submit
        // 字样」的，否则回落到容器内最后一个可见且未禁用的 button（发送钮通常在输入框之后）。
        var chain = ta, lastBtn = null
        for (var i = 0; i < 6 && chain; i++) {
          var cands = chain.querySelectorAll ? chain.querySelectorAll('button') : []
          for (var j = 0; j < cands.length; j++) {
            var b = cands[j]
            if (!b || b.disabled || b.offsetParent === null) continue
            lastBtn = b
            var label = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')
            if (/发送|send|submit/i.test(label)) { btn = b; break }
          }
          if (btn) break
          chain = chain.parentElement
        }
        if (!btn && lastBtn) btn = lastBtn
      } catch (_) {}
      if (!btn) {
        try {
          var all = document.querySelectorAll('button')
          for (var k = 0; k < all.length; k++) {
            var x = all[k]
            if (x && !x.disabled && x.offsetParent !== null && /发送|send|submit/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '') + ' ' + (x.textContent || ''))) { btn = x; break }
          }
        } catch (_) {}
      }
      if (btn) {
        try { btn.click(); log('通道① 发送按钮 click() 已触发（' + (btn.getAttribute('aria-label') || btn.textContent || 'button') + '）'); return } catch (e) { log('通道① 发送按钮 click() 异常：' + (e && e.message)) }
      } else {
        log('通道① 未找到发送按钮，跳过')
      }
      // —— 通道②：完整键盘序列（keydown+keypress+keyup，keyCode/which/code 全带）——
      try {
        var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }
        var seq = ['keydown', 'keypress', 'keyup']
        for (var s = 0; s < seq.length; s++) {
          var ev = new KeyboardEvent(seq[s], opts)
          // 部分浏览器忽略构造参数里的 keyCode/which，强制补成 getter
          try { Object.defineProperty(ev, 'keyCode', { get: function () { return 13 } }) } catch (_) {}
          try { Object.defineProperty(ev, 'which', { get: function () { return 13 } }) } catch (_) {}
          ta.dispatchEvent(ev)
        }
        log('通道② 键盘序列 Enter(keydown+keypress+keyup, keyCode=13) 已派发')
      } catch (e) {
        log('通道② 键盘序列异常：' + (e && e.message) + '；回退最小 keydown')
        try { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); log('通道② 兜底 keydown 已派发') } catch (_) {}
      }
      // 注意：此处不 return —— 两个通道都试过，但**绝不**清空 ta.value（防吞字）。
    }

    function muvDeliverUserText(text, mode) {
      var textarea = null
      try {
        textarea = document.querySelector('textarea[data-muv-macro-hooked]') ||
          document.querySelector('textarea[placeholder*="消息"], textarea[placeholder*="Message"], textarea[placeholder*="输入"]')
      } catch (_) { textarea = null }
      if (!textarea) {
        try {
          var all = document.querySelectorAll('textarea')
          for (var i = 0; i < all.length; i++) {
            if (all[i].offsetParent !== null && !all[i].readOnly && all[i].rows >= 2) { textarea = all[i]; break }
          }
        } catch (_) { textarea = null }
      }
