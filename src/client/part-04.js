    /**
     * 注入到每个卡 HTML iframe 尾部的引导脚本。
     *
     * 两条硬约束都是踩过的坑：
     *  - **不含反引号**，且**字符串里不出现裸的 `</script>`**：插件客户端代码可能被
     *    宿主内联进 `<script>` 标签，那样的字面量会当场把标签截断、整个插件报废。
     *    收尾标签用 `'</' + 'script>'` 拼出来。
     *  - **只发一个数字**，不发 HTML、不发卡内任何内容——父页因此永远不需要相信
     *    卡里的东西，收到多少都只是"多高"。
     *
     * ★ 量什么：**内容包围盒**，不是 `scrollHeight`。
     * 这些卡普遍写着 `html,body{height:100%}`，实测 `documentElement.scrollHeight` 与
     * `body.scrollHeight` **都等于视口高**（也就是 iframe 当前高度）。拿它当结果报回去
     * 是个**不动点**：起始 600 报 600、起始 900 报 900。实测「正文美化」的内容只有
     * ~241px，却被永远留在起始值上（起始 600/900/1500 → 报 600/900/1500，逐行相等）。
     * 所以这里遍历 body 后代算 `top + max(height, scrollHeight)` 的最大值：
     *  - 排除 `fixed` / `sticky`（视口相关，会把视口高算成内容高）；
     *  - 排除 display:none / visibility:hidden / 零尺寸元素；
     *  - 每个元素取 `max(rect.height, el.scrollHeight)`，这样被父级 `overflow` 裁掉的
     *    静态子元素也被算进去（这正是当初想用 `body.scrollHeight` 兜的那一类）。
     * 包围盒量不出来（`extent()===0`，例如主视觉全是 `position:fixed`）时**不报任何值**、
     * 帧高保持不动 —— **不用 `body.scrollHeight` 兜底**，那是视口回声（§15.3 第 2 条禁用它）。
     * 见 `muvFrameBootstrap` 里 `function m()` 上方的长注释。
     * 起始高度 600/900/1500 三档实测收敛到同一值，见 verify-frame-height.mjs。
     *
     * 遍历放在 150ms 去抖后的 setTimeout 里（不在 ResizeObserver 回调里同步跑），
     * 卡再大也不会把滚动/改高的那帧拖住。
     *
     * 重测触发面：`load` / `DOMContentLoaded` / `ResizeObserver(documentElement)` /
     * 700·1600ms / 四次低频补量（到 10.9s）/ **媒体落定事件**（img `load`·`error`、
     * video `loadedmetadata`·`loadeddata`·`durationchange`）。
     * 最后那一类带一枚一次性令牌，让这次测量可以走**测量修正通道**（棘轮一次丢弃、报真实值）
     * —— 语义、边界与实测数字见 `extent()` 里「测量修正通道」那段注释。
     * @returns {string}
     */
    function muvFrameBootstrap() {
      return '<script>(function(){' +
        'if(window.__muvH)return;window.__muvH=1;' +
        'var t=0;' +
        // ★ 棘轮的"首帧已过"闸。为什么要它：`load` 之前 `getBoundingClientRect()` 对未 decode
        //   的远程插图返回 0 或占位高，此时记下的值就是坏读数，而 reset 是
        //   `overflow:hidden!important` ⇒ 坏读数会变成**永久裁切**。
        //
        //   ★★ 但闸门**也不能放宽**。试过两版"更宽容"的闸，**都实测更差**：
        //     `document.readyState!=="loading"`（`interactive` 就记账）
        //        → `verify-frame-size` 稳定 **30 通过 / 2 失败**（3 次以上复现）
        //     同一版再加"6 秒超时提闸"
        //        → **31 通过 / 1 失败**、**30 通过 / 2 失败**（两次）
        //     只有回到 `==="complete"` 才是 **32 通过 / 0 失败**。
        //   所以**记账的判据就是 `complete`**，不加例外、不加超时。
        //
        //   ★★★ "complete 永远不到"那个担忧**没有实测支持**：真卡（含 7 处远程插图 +
        //   一支 28.5MB 的 PV）在夹具里都能到 `complete`。既然放宽有代价、而收益未被观测到，
        //   就不放 —— 宁可某张卡一直不记账（帧高停在报告值上，只是不高），
        //   也不要记一个**偏小的**值把内容永久裁掉（reset 是 `overflow:hidden!important`）。
        //   写成函数、每次测量时**现读**（不是启动时算一次的快照）——读不到 `readyState`
        //   的环境（逐字提取执行的门禁里的假 document）按"已过闸"处理，保持旧行为。
        'function RL(){try{return String(document.readyState)==="complete"}catch(e){return true}}' +
        // ★★ 媒体落定判据 `MS()`：这张卡里**所有**媒体都已"内容尺寸定死"了吗？
        //   它是「测量修正通道」的**前置条件**（见下面 extent() 里那段长注释），只在这一条
        //   通道上用，别的路径一概不看它。
        //   - `img.complete`：图已 load 或已 error（**无 src / 尚未取源的 lazy 图是 false**）；
        //   - `video.readyState>=1`：已 HAVE_METADATA（拿到时长/尺寸）。
        //   有意**不看** `naturalHeight>0`：404 的图 `complete===true` 且 `naturalHeight===0`，
        //   它的盒子会塌成 0 高 —— 那正是需要被修正的一种形态，不能把它排除在外。
        //   读不到（假 document、异常）一律按"未落定"处理 ⇒ 退回老的 3 次观测语义，宁保守。
        //   ★ 已知的**收窄**（有意接受，不是遗漏）：`preload="none"` 的 video 永远到不了
        //   `readyState>=1`、`loading="lazy"` 且从未取源的 img `complete===false`
        //   ⇒ 这类卡上这条通道**一直关闭**，行为与 `2026-09-22t` 完全一致（只是没修好，
        //   不会更坏）。宁可少修几张卡，也不要放宽判据去动收缩方向的语义。
        'function MS(){try{' +
        'var a=document.getElementsByTagName("img");' +
        'for(var i=0;i<a.length;i++){if(!a[i].complete)return false}' +
        'var v=document.getElementsByTagName("video");' +
        'for(var j=0;j<v.length;j++){if(!(v[j].readyState>=1))return false}' +
        'return true}catch(e){return false}}' +
        'function extent(mf){' +
        'var body=document.body;if(!body)return 0;' +
        'var de=document.documentElement;' +
        'var all=body.getElementsByTagName("*"),y=window.scrollY||0,maxB=0;' +
        'for(var i=0;i<all.length;i++){var el=all[i],cs=getComputedStyle(el);' +
        'if(cs.position==="fixed"||cs.position==="sticky")continue;' +
        'if(cs.display==="none"||cs.visibility==="hidden")continue;' +
        // ★ 透明浮层不贡献"可见"高度（2026-09-23 苍玄界实测）：`.cx-detail-page` 是
        //   opacity:0 **且** pointer-events:none 的隐藏详情浮层，内含 max-width:850px 大盒子 ——
        //   不跳过它，内容包围盒被撑大 ~400px，封面下方一大片白。
        //   判据必须**两条件同时满足**：只看 opacity==="0" 会误伤"入场动画前的内容"
        //   （vh-E 真卡实测被误伤 79px）；加 pointer-events:none（隐藏浮层标配）后只命中真浮层。
        //   ★★ 2026-09-24 第二层实锤：**祖先链**。苍玄界「开局」弹窗
        //   `.cx-modal{position:absolute;inset:0;opacity:0;pointer-events:none}` 里装着
        //   1575px 的角色创建表单（.cx-modal-box）—— **opacity 不继承**，子元素自身
        //   computed opacity=1，逐元素检查放过了整棵被祖先隐藏的子树 ⇒ 幽灵高度撑满
        //   视口 ⇒ iframe 永远等于视口高。改用 `checkVisibility({checkOpacity:true,
        //   checkVisibilityCSS:true})`（沿祖先链累计，Chromium 105+），老浏览器回退到
        //   元素自身双条件判断。
        'if(el.checkVisibility?!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):(cs.opacity==="0"&&cs.pointerEvents==="none"))continue;' +
        'var r=el.getBoundingClientRect();' +
        'if(r.height===0&&r.width===0)continue;' +
        'var b=r.top+y+Math.max(r.height,el.scrollHeight||0);' +
        'if(b>maxB)maxB=b}' +
        // ★① body / html **自己**的 `min-height`：卡把 `min-height:100vh` 写在 body 上（我们已在
        //   rewriteVhMinHeight 里改写成 px），而上面那个循环是 `body.getElementsByTagName("*")`，
        //   **不含 body 自己** ⇒ 整卡被报矮到内容高度、再被 body 的 min-height 撑开 ⇒ 永远是内部
        //   滚动条（实测：正文美化 报 251 / 文档 1198）。只取 **px** 值：`100vh` 那种视口相对
        //   阈值正是刚消掉的东西，拿它当结果会把不动点带回来。
        'var bmh=parseFloat(getComputedStyle(body).minHeight);' +
        'if(isFinite(bmh)&&bmh>maxB)maxB=bmh;' +
        'var hmh=de?parseFloat(getComputedStyle(de).minHeight):0;' +
        'if(isFinite(hmh)&&hmh>maxB)maxB=hmh;' +
        // ★② 溢出学习：观测到文档滚得动时，记下当时的 scrollHeight 当作高度下界。收掉两类任何
        //   DOM 遍历都看不见的溢出：CSS 伪元素（`::after` 撑出去的），以及子元素 margin 折叠出
        //   body 的（实测 正文美化 差 118px、开场白 差 5px、开场白2 差 20px。逐个 CSS 开关的隔离
        //   实验见 verify-frame-gap.mjs）。`extent()` 取每个元素的 `max(rect, scrollHeight)`
        //   只覆盖能遍历到的元素；伪元素与折叠 margin 生成的溢出没有对应元素，只有滚动区自己知道。
        //
        //   为什么要"记住"而不是每次现算：**不溢出时 scrollHeight 等于视口高**，现算会得到
        //   「内容高 → 收缩 → 又溢出 → 再长高」的来回振荡（振幅就是那 118px，一眼可见的抽动）。
        //
        // ★ 但这把尺子**必须能降**（原来不能，是一把只增不减的棘轮，两个真实反例）：
        //   ① 内容缩小后帧高永不回落：棘轮记下 1200 → 用户折叠了卡里面板、内容只剩 300 →
        //      `bOver` 为假、`__muvHFit` 仍是 1200 ⇒ 卡片底下常年一大片死白。
        //   ② 一次坏读数把高度锁死（更危险）：`load` 之前远程插图还没 decode、
        //      `getBoundingClientRect()` 高度是 0 或占位高，首帧就记下一个偏小值；而 reset 是
        //      `overflow:hidden!important` ⇒ 内容被**永久裁掉**，且此后再没有降回路径。
        //   所以记的三个条件缺一不可：**只在「首帧已过」之后记**（见下面 `RL` 那道闸）、
        //   连续 3 次「不溢出且内容比已学值小 24px 以上」才清零重学并用 24px 滞回防抖、
        //   判据用 `extent()`（真实内容高，见③）而不是 `body.scrollHeight`。
        //   收缩方向的门禁见 verify-frame-height.mjs（内容缩小后报数必须回落）。
        //
        //   ★★ 滞回**只作用在收缩方向**。只要 `bOver||dOver` 为真（**观测到**溢出），
        //   `need > fit` 就**无条件**提升 —— 没有阈值、没有等待、没有"下次再说"。
        //   这是硬要求：reset 是 `overflow:hidden!important`，溢出的那几像素如果没被
        //   立刻补上就是**永久裁掉**（实测 `ERA 状态栏` 内容 929 / 帧高 923，差 5px）。
        //   反过来，这 5px 也是"棘轮为什么必须存在"的活例子：`extent()` 量到 923 而真实
        //   内容要 929，只有滚动区自己（body 溢 5px）看得见。
        //
        // ★ body 与 html **两个**滚动区都要看：reset 把两者都啃成了 `overflow:hidden!important`
        //   （照 ST），于是 body 是独立滚动容器，它的溢出**不再传导**到
        //   `documentElement.scrollHeight` —— 只看 html 会漏（实测 ERA 状态栏：html 报 923、
        //   body 自己滚到 929）。`overflow:hidden` 只是不显示滚动条，**`scrollHeight` 依旧报告
        //   溢出距离**，所以这两个比较照旧有效。而"有没有溢出"这个**前提**仍然是必须的：body
        //   若是 `height:100%`，`body.scrollHeight` 就等于视口高，无条件采用它就回到不动点。
        'var bOver=body.scrollHeight>body.clientHeight+1;' +
        'var dOver=de?(de.scrollHeight>de.clientHeight+1):false;' +
        'var need=Math.max(body.scrollHeight,de?de.scrollHeight:0);' +
        'var fit=window.__muvHFit||0;' +
        'if(RL&&(bOver||dOver)){if(need>fit){window.__muvHFit=need;fit=need}window.__muvHReset=0}' +
        'else if(RL&&fit>0&&maxB>0&&(fit-maxB)>24){' +
        // ★★★ 测量修正通道（2026-09-22u）。与上面那条"内容增长"的棘轮**语义并列、互不干扰**：
        //
        //   · **内容增长**（棘轮，铁律不动）：只要**观测到**溢出（`bOver||dOver`）就无条件提升，
        //     没有阈值、没有等待 —— 因为 reset 是 `overflow:hidden!important`，溢出的那几像素
        //     不立刻补上就是**永久裁掉**。上面那个分支一个字符没变。
        //   · **测量修正**（本条）：媒体**全部落定**（`MS()`）+ 「首帧已过」（`RL`）+ **没有**
        //     观测到溢出 + 已学值比实测内容高 24px 以上 ⇒ 这次收缩是**修正一次坏读数**，不是
        //     内容真的缩了，所以**一次就够**，直接把棘轮丢掉、报真实内容高。
        //
        //   为什么必须有这条（真卡/合成取证见 HANDOFF §34，数字是实测的）：
        //   收缩方向的常规路径要求**连续 3 次**观测（下面 `rc>=3`）才清零重学，而媒体落定
        //   引起的收缩常常**只有一次**观测机会 —— 引导脚本的定时补量到 10.9s+150ms 就停了，
        //   而 RO 只在**盒子**尺寸变化时 fire（本节上文已记：媒体引起的包围盒变化可以完全
        //   不动任何盒子）。合成夹具实测（img 用 `width/height` 属性预留 600×2000 的高盒子、
        //   真实图片是 600×200 的扁图、src 在 11.5s 才设）：
        //     帧高先被撑到 **2300**（内容确实是 2300，没记错），图片到位后内容缩到 **500**，
        //     此后**再也没有第二次观测** ⇒ 帧高永久停在 2300 ⇒ **1800px 死白**
        //     （同一文档把 src 提前到 400ms → 靠 2500/5300/8100 三次补量能凑够 3 次 → 正常回落）。
        //   ⇒ 这条通道不是把滞回拆掉，是**给"媒体落定"这个终态信号补上一次它本来就该有的修正**：
        //     媒体事件是浏览器给的"这个元素的内容尺寸定了"的同步信号，落定之后不会再有一次
        //     **由媒体引起**的重排，等第 2、第 3 次观测就是等一个不会再来的事件。
        //
        //   边界（缺一不可，任何一条不满足都退回老的 3 次语义）：
        //   ① `mf` —— 本次测量必须由**媒体事件**触发（`sf()` 挂的一次性令牌）。定时补量、
        //      RO、卡自己的 JS 引起的测量都不带它 ⇒ **非媒体**的异步收缩照旧 3 次确认；
        //   ② `MS()` —— 媒体全部落定；只要还有一张图在加载（含 lazy 未取源），这条通道关闭；
        //   ③ `RL` + `!bOver && !dOver` —— 与老路径同一条闸门：**观测到溢出就绝不收缩**；
        //   ④ 只有**收缩**方向有这条通道，增长方向一个字没动。
        //
        //   修正之后的**安全复核**：`sf()` 在 +700ms 还会再挂一次令牌重量一次（见 `sf` 的注释）
        //   —— 万一这次修正量偏小（内容其实还要更多），那一次会走增长分支无条件补上，
        //   不会因为这条通道把内容永久裁掉。
        'if(mf&&MS()){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{' +
        'var rc=(window.__muvHReset||0)+1;' +
        'if(rc>=3){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{window.__muvHReset=rc}}}' +
        'else{window.__muvHReset=0}' +
        'if(fit>maxB)maxB=fit;' +
        'return Math.ceil(maxB)}' +
        // ★ 量不出来（`extent()===0`）时**什么都不报**，帧高保持不动。
        //
        // 原来这里回退到 `document.body.scrollHeight` —— 那正是 HANDOFF §15.3 第 2 条
        // **明确禁用**的值：卡普遍写着 `html,body{height:100%}`，此时 body.scrollHeight
        // **等于 iframe 当前高度**（视口回声）。拿它当结果报回去就是把起始值当答案，
        // 而且它会和下一轮"按内容改高度"打架 ⇒ 帧高在 视口高 ↔ 内容高 之间来回跳。
        //
        // 这条路径不是理论上的：`extent()` 会跳过 `position:fixed/sticky` 的元素
        // （它们是视口相关的，算进去会把视口高当成内容高），而真卡 `_足控天堂2` 的
        // ERA 状态栏里有 **9 处 `position:fixed`**。所以「整卡主视觉都是 fixed」时
        // `extent()` 就是 0 —— 正是最容易踩到它的卡。
        //
        // `h>0` 这个条件本来就在（原来写的是 `var h=e>0?e:(…scrollHeight)`，把 0 换成了猜测）。
        // 现在 0 就是 0：**不报**。帧高停在已有值上，等下一次（700ms / 1600ms / RO / load）
        // 量出来再改。宁可暂时矮/高一点，也不写一个错的、会自我放大的值进去。
        //   ★ 记账只在 `readyState==='complete'` 之后（`load` 已触发、远程插图已 decode）：
        //   `load` 之前 `getBoundingClientRect()` 对未 decode 的插图返回 0 或占位高，此时记下的
        //   任何值都是坏读数 —— 而 reset 是 `overflow:hidden!important`，坏读数会变成永久裁切。
        //   ★ 记账只在「首帧已过」（`RL`，见上面那段）之后；`m()` 仍然照报 ——
        //   早报一次能让帧高尽快贴近内容，只是那一次**没有棘轮可记**。
        'function m(){try{' +
        // ★ 一次性令牌：本次测量是不是由**媒体落定事件**触发的？
        //   读走就清（consume-once）—— 下一个定时/RO 触发的测量绝不会继承它，
        //   否则"测量修正"会退化成"任何测量都能一次收缩"，那正是要避免的语义漂移。
        'var mf=window.__muvHMediaFix?1:0;window.__muvHMediaFix=0;var e=extent(mf);' +
        'if(e>0)window.parent.postMessage({__muvFrameHeight:e},"*");' +
        // ★ 注入判据用的**专属 token**（见 withFrameHeightBootstrap 的守卫注释）：
        //   它只出现在引导脚本里，卡自己的 `window.__muvH=1` 或 `__muvHello` 都**不含**它，
        //   所以"注入了几次"数这个才数得准（数 `window.__muvH=1` 会被卡自己的拷贝污染，
        //   断言会**因为错误的原因通过**）。它是 `postMessage(…)` 语句的一部分，任何
        //   `"*"` 结尾的 postMessage 断言照旧成立。
        'window.__muvHFitProbe=1;' +
        '}catch(err){}}' +
        'function s(){if(t)clearTimeout(t);t=setTimeout(m,150)}' +
        'window.addEventListener("load",function(){m();s()});' +
        'document.addEventListener("DOMContentLoaded",s);' +
        'try{if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement)}catch(e){}' +
        // ★ 媒体事件重测（2026-09-22p）。为什么 RO 不够（取证见 HANDOFF §29）：
        //   RO 只在**盒子**（边框盒）尺寸变化时 fire，而媒体引起的**包围盒**变化可以完全不
        //   动任何盒子 —— 两种真实形态（真卡 _足控天堂2「主页」两条都占）：
        //   ① 媒体元素自身 position:absolute（该卡画廊 `.polaroid img{position:absolute;inset:0}`，
        //      父盒用 aspect-ratio 预留尺寸）：媒体加载只改绝对定位元素自己的盒子，
        //      html/body 的盒子纹丝不动 ⇒ RO 一次都不 fire；而 `extent()` 对绝对定位元素
        //      单独取 `rect.top + height`，媒体到位后包围盒**确实变大** —— 帧高却不跟。
        //   ② 卡的 JS 在 load 之后才把 img 插进 DOM（该卡画廊就是运行时拼的）：
        //      固定补量到 10.9s 就停，之后插入的媒体没有任何触发器。
        //   媒体事件是浏览器给「这个元素的内容尺寸定了/变了」的同步信号（error 也算——
        //   404 的图会塌成 0 高，包围盒同样要重量），接到就 sf() 走 150ms 去抖。
        //   对已有元素挂一遍；卡运行时再插入的媒体由 MutationObserver 兜底补挂
        //   （只挂事件，不额外测量 —— 测量仍由 s() 统一去抖）。
        //
        //   ★★ 为什么走 `sf()` 而不是直接 `s()`（2026-09-22u）：媒体事件触发的这一次测量
        //   要带上一枚**一次性令牌** `__muvHMediaFix`，让 extent() 知道"这次读数来自媒体落定、
        //   可以走一次测量修正"（语义与边界见 extent() 里那段长注释）。令牌由 m() 读走即清。
        //   `sf()` 另外还在 **+700ms** 补挂一次同样的令牌重量一次：这一次是**修正的安全复核**
        //   —— 落定瞬间的布局若还没走完（transition/字体替换），修正量可能偏小，那次复核会走
        //   增长分支把它补回来。定时器用同一个句柄去重，媒体再多也只留一个待复核。
        'function sf(){window.__muvHMediaFix=1;s();' +
        'if(window.__muvHMediaT)clearTimeout(window.__muvHMediaT);' +
        'window.__muvHMediaT=setTimeout(function(){window.__muvHMediaFix=1;s()},700)}' +
        'function mw(el){try{' +
        'if(el.tagName==="IMG"){el.addEventListener("load",sf);el.addEventListener("error",sf)}' +
        'else if(el.tagName==="VIDEO"){el.addEventListener("loadedmetadata",sf);el.addEventListener("loadeddata",sf);el.addEventListener("durationchange",sf)}' +
        '}catch(e){}}' +
        'try{var mqs=document.getElementsByTagName("img"),mqvv=document.getElementsByTagName("video");' +
        'for(var mqi=0;mqi<mqs.length;mqi++)mw(mqs[mqi]);' +
        'for(var mqv=0;mqv<mqvv.length;mqv++)mw(mqvv[mqv])}catch(e){}' +
        'try{if(window.MutationObserver)new MutationObserver(function(mrs){' +
        'for(var mra=0;mra<mrs.length;mra++){var mrn=mrs[mra].addedNodes||[];' +
        'for(var mrb=0;mrb<mrn.length;mrb++){var mre=mrn[mrb];if(mre.nodeType!==1)continue;' +
        'if(mre.tagName==="IMG"||mre.tagName==="VIDEO")mw(mre);' +
        'if(mre.querySelectorAll){var mrq=mre.querySelectorAll("img,video");for(var mrc=0;mrc<mrq.length;mrc++)mw(mrq[mrc])}}}})' +
        '.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}' +
        'setTimeout(m,700);setTimeout(m,1600);' +
        // ★ 后期补量（有限次，到点就停）。为什么需要：内容**在最后一次测量之后**还在长高时
        //   （远程插图 decode 完、字体替换、卡自己的定时器改 DOM），棘轮就一次都没观测到那次
        //   溢出，而 reset 是 `overflow:hidden!important` ⇒ 那几像素**永久裁掉**，表现为
        //   「同一张卡、同一份源码，跑两次一次红一次绿」的间歇性失败
        //   （实测 `ERA 状态栏` 内容 929 / 帧高 923，差 5px，只在部分运行里出现）。
        //   700/1600 两次太早：真卡的主视觉要 2~3 秒才落定。这里补四次低频补量覆盖到 11 秒；
        //   RO 已经覆盖"内容一长高就报"，所以这四次只是**兜底**，不是主路径。
        //   有意不写成 `setInterval`：稳态之后每秒重扫整棵子树是纯浪费，而棘轮已经收敛，
        //   没有新信息可拿。
        'for(var i=0;i<4;i++)setTimeout(m,2500+i*2800);' +
        '})();</' + 'script>'
    }

    /**
     * 把引导脚本插到**不在任何 `<script>` 里的最后一个** `</body>` 之前；
     * 没有这样的 body 就接在末尾。
     *
     * 两个"只做末尾追加、绝不改卡内内容"的约束：
     *  - 绝不去改卡自己的 `<script>` —— 那正是 renderMediaTags 踩过的坑
     *    （正则改写卡内 JS → `&#39;&#39;` → 语法错误 → 整页脚本报废）；
     *  - 注入点也只认**不在 `<script>` 范围内**的 `</body>`：卡自己的 JS 里完全可能
     *    写着 `document.write('</body>')` 这样的字符串，插进去就把卡的代码切断了。
     * @param {string} html
     * @returns {string}
     */
    function withFrameHeightBootstrap(html) {
      var s = String(html == null ? '' : html)
      // ★ 守卫查的是**引导脚本专属 token**（`__muvHFitProbe` 只出现在上面那个 postMessage 语句里），
      //   **不是** `window.__muvH=1` —— 后者是卡随时能写的公共标记：
      //   卡的原始 HTML 里只要出现 `window.__muvH=1`（模型跑题、作者抄别家 shim、卡里内嵌文档），
      //   整段引导脚本就被**静默跳过**，iframe 再也不发 `__muvFrameHeight`，高度永远停在
      //   cardHtmlIframe 的默认 900px。检查这个 token 时按**整句**匹配（带上后半句），
      //   卡的拷贝要一字不差才会误命中。
      //
      //   ★ 真正的根治在**父页记账**（见 cardHtmlIframe 的 `__muvInjectCache`）：同一个 `raw`
      //   只在这里组装一次，重复调用直接命中缓存。子文档侧这条守卫只是第二道保险。
      //   注入链见 cardHtmlIframe：compat 在内层先跑，产物里没有这个 token，不会互相顶掉。
      if (s.indexOf('__muvHFitProbe=1;') !== -1) return s
      var ranges = scriptRangesOf(s)
      var re = /<\/body\s*>/gi
      var m, last = null
      while ((m = re.exec(s))) {
        if (!rangesContain(ranges, m.index)) last = m
      }
      if (!last) return s + muvFrameBootstrap()
      return s.slice(0, last.index) + muvFrameBootstrap() + s.slice(last.index)
    }

    /**
     * 安装父页监听。全局只装一次；装饰器重跑、反复建 iframe 都无害。
     *
     * 幂等标记挂在 `window` 上（而不是闭包变量），理由同 muvFrameHeightLimits()：
     * 这个函数会被回归测试从源码里提取执行，闭包变量在提取物里不存在。
     *
     * ★ 标记存的是**监听器本身**，不是 `true`（brief P2）：插件重载后这个函数会被新的闭包
     *   重新求值，`onMuvFrameHeightMessage` 是新函数对象，而**旧监听器仍挂在页面上**。
     *   只写 `true` 的话旧监听器永远不被解绑、也永远不被识别 ⇒ 它继续处理消息（写进旧的
     *   孤儿状态），而且旧闭包永不回收。存引用就能看出"换了人"：不一致时先解绑旧的。
     * @returns {void}
     */
    function ensureFrameHeightListener() {
      try {
        if (typeof window === 'undefined' || !window.addEventListener) return
        var old = window.__muvFrameHListener
        if (old === onMuvFrameHeightMessage) return
        if (typeof old === 'function') {
          try { window.removeEventListener('message', old, false) } catch (_) {}
        }
        window.addEventListener('message', onMuvFrameHeightMessage, false)
        window.__muvFrameHListener = onMuvFrameHeightMessage
      } catch (_) {}
    }

    /**
     * 父页收到子文档报来的高度后，只做一件事：改那个 iframe 的高度。
     *
     * 安全约束（红队会照这几条打）：
     *  - `event.source` 必须**就是**某个 `iframe.muv-iframe` 的 contentWindow，否则丢弃；
     *    伪造的、别的窗口/扩展发的消息都进不来（不查 origin：沙箱是不透明来源，
     *    它的 origin 恒为 "null"，拿它当凭据没有意义）；
     *  - 只接受有限正数，并夹到 [160, 12000]，畸形卡不能把页面撑到不可用；
     *  - **不 eval、不插入内容、不转发、不读卡内任何东西**。
     * @param {MessageEvent} ev
     * @returns {void}
     */
    function onMuvFrameHeightMessage(ev) {
      var data = ev && ev.data
      if (!data || typeof data !== 'object' || data.__muvFrameHeight === undefined) return
      var n = Number(data.__muvFrameHeight)
      if (!isFinite(n) || n <= 0) return
      var frames
      try { frames = document.querySelectorAll('iframe.muv-iframe') } catch (_) { return }
      var frame = null
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === ev.source) { frame = frames[i]; break }
      }
      if (!frame) return
      var lim = muvFrameHeightLimits()
      var h = Math.round(n)
      if (h < lim.min) h = lim.min
      if (h > lim.max) h = lim.max
      // ★ 死区**只作用在收缩方向** —— 与孩子侧棘轮同一条铁律（见 muvFrameBootstrap 里
      //   「滞回只作用在收缩方向」那段）。
      //
      //   为什么增长必须无条件生效：孩子侧报上来的"溢出学习"值是 `body.scrollHeight`
      //   （**精确**的溢出下沿，不是估值）。实测真卡 `_足控天堂2` 的 ERA 状态栏：
      //   内容 894 / 帧 889 —— 差 5px，被这个 8px 死区丢掉 ⇒ **卡底部永久少一条**
      //   （reset 把 html/body 啃成 `overflow:hidden!important`，连滚动条都没有）。
      //   `extent()` 量到的是元素包围盒（**不含 margin**），所以"最后那几个像素"只有
      //   滚动区自己看得见 —— 那正是死区最容易吃掉的一段。
      //   收缩方向照旧留 8px：亚像素抖动、卡内动画的 ±几像素不该引发连续重排。
      //
      //   ★ 但有一个例外通道（2026-09-23 苍玄界实测）：**大幅下修**（落差 ≥ 300px）不受
      //     滞回限制、直接采纳。理由：extent() 的可见性过滤（透明浮层跳过）或媒体落定
      //     会让测量值**一次性**回落几百像素 —— 这不是抖动，是结构修正；而滞回要求
      //     连续多次观测，浮层类页面往往只给一次机会 ⇒ 不放行就永久留白
      //     （实测：vh-F 夹具 extent 报 500 一次，宿主帧高停在 900）。
      //     300px 阈值远大于任何合理抖动；误触发最多让帧高贴合真实内容，无破坏面。
      var cur = parseFloat(frame.style.height)
      if (isFinite(cur) && h <= cur && (cur - h) < 8 && (cur - h) < 300) return
      try { frame.style.height = h + 'px' } catch (_) {}
    }

    /**
     * 把卡文档里 `min-height:…vh` 的声明**重写成固定像素**。
     *
     * ★ 这是「卡片塌成默认高度 + 框里永远有滚动条」的**根因**，也是照 ST 平价的关键一条。
     *
     * 循环定义长这样：卡的 CSS 写 `#app{min-height:100vh}`（`主页` / `正文美化` / `食人世界·开场白`
     * 三份都有）。`100vh` 在我们的 iframe 里 = **iframe 自己的高度**，而我们又要「以内容包围盒
     * 决定 iframe 的高度」—— 两边互为因果：iframe 起手 900 ⇒ vh=900 ⇒ 内容至少 900 ⇒ 报 900 ⇒
     * 不动点；可一旦某次报小了（高度测量有漏算，见 verify-frame-gap.mjs），内容跟着缩，
     * **再也长不回去**。用户的观感就是"卡片塌了、立绘很小、框里还有滚动条"。
     *
     * ST 的做法（`C:\_st_spec\SPEC.md`，另一个人真机实测抽出）：把 `min-height:100vh` 改写成
     * `min-height:var(--TH-viewport-height)`，值取**父窗口的 innerHeight**。我们照做，但直接落成
     * 像素值、不用 CSS 变量（少一层依赖，也少一处可能取不到变量的地方）：
     *
     *   vh 的取用顺序：**父窗口 innerHeight** → 拿不到就**不重写**。
     *   宁可不改，也不写一个错的固定值 —— 写错比不改更糟（卡会被钉死在错误高度上）。
     *
     * 只改 `min-height`，**不动** `max-height:…vh` / `height:…vh`（与 ST 一致，实测残留
     * `max-height:86vh` 是正常的）。`<script>` 里的同名文本**不碰**：卡自己可能在拼样式字符串，
     * 改了会让它的逻辑与实际样式不一致。
     * @param {string} html 卡自带的整页 HTML
     * @returns {string}
     */
    function rewriteVhMinHeight(html) {
      var s = String(html == null ? '' : html)
      var vh = 0
      try {
        if (typeof window !== 'undefined' && window.innerHeight) vh = Number(window.innerHeight) || 0
      } catch (_) {}
      if (!(vh >= 200)) return s          // 拿不到可信视口高：宁可保持原样
      var ranges = scriptRangesOf(s)
      var out = ''
      var last = 0
      var hits = 0
      var lower = s.toLowerCase()
      var i = 0
      // ★ 这里用**逐字符扫描**而不是正则字面量，是有原因的（踩过，别改回去）：
      //   `test-client-source.mjs` 与 `verify-shared.mjs` 都要把本函数**逐字提取出来执行**，
      //   而它们的词法扫描器按「`/` 在代码位置就是正则开头」处理。本函数里有
      //   `vh * parseFloat(x) / 100` 这个**除号**，于是扫描器进正则态、一路吃到后面某处，
      //   切片越界到下一个函数 ⇒ `new Function` 报
      //   `SyntaxError: Unexpected token 'function'`（报错位置在 test-client-source.js 里，
      //   看起来像源码坏了，真因在这行除号）。
      //   改成纯字符串扫描后，**两个提取器都不再需要词法判断**，同时也省掉了
      //   每次循环重建 RegExp 对象。`rewriteVhMinHeight` 因此可以逐字被提取验证。
      // 行为与原来的 `min-height\s*:\s*([0-9.]+)\s*(vh|dvh|svh|lvh)\b` 等价：
      //   大小写不敏感（这里靠整串 toLowerCase 后比对）、允许空白、值必须是数字，
      //   单位后**不接标识符字符**（`vhx` 不算）。只改 min-height，
      //   `max-height:…vh` / `height:…vh` 一律不碰（与 ST 一致）。
      while (i < s.length) {
        var at = lower.indexOf('min-height', i)
        if (at < 0) break
        var j = at + 10
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        if (s[j] !== ':') { i = at + 10; continue }
        j++
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        var numStart = j
        while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++
        if (j === numStart) { i = at + 10; continue }
        var numText = s.slice(numStart, j)
        while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++
        var unitStart = j
        while (j < s.length) {
          var cu = lower[j]
          if (cu >= 'a' && cu <= 'z') j++
          else break
        }
        var unit = lower.slice(unitStart, j)
        // 值与单位必须是**同一个** `min-height` 声明里的东西：单位后不许再接标识符字符
        // （`min-height:100vhx` / `min-height:100vh_foo` 都不算），这正是原正则 `\b` 的作用。
        // ⚠ `_` 也属于标识符字符。少了它，`100vh_foo` 会被当成**命中**并写成 1080px
        //   （差分测试抓到的唯一一处不一致）。
        if (!(unit === 'vh' || unit === 'dvh' || unit === 'svh' || unit === 'lvh')) { i = at + 10; continue }
        if (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) { i = at + 10; continue }
        var tokenEnd = j
        if (rangesContain(ranges, at)) { i = tokenEnd; continue }   // 落在 <script> 里：跳过，但别打乱切片
        // ★ 写成 `* 0.01` 而不是 `/ 100`：**本函数里不能出现代码位置的除号**。
        //   测试的 `sliceBalanced`（test-client-render.mjs / test-client-source.mjs /
        //   verify-shared.mjs）在 code 态看到 `/` 就进正则态，一路吃到下一个 `/`，于是
        //   花括号配平跑偏、切片错位，`extractFunction('rewriteVhMinHeight')` 抛
        //   `Invalid regular expression: missing /`。而 `buildFrom` 的自动发现是
        //   `try{…}catch(_){ null }` ⇒ **静默跳过**这个依赖，最后表现为
        //   `cardHtmlIframe` 在 eval 沙箱里 `ReferenceError: rewriteVhMinHeight is not defined`
        //   （报错位置指向 cardHtmlIframe，真因在这个除号 —— 极难反查）。
        //   本函数开头的注释已经记过一次这个坑，这里是当时漏改的第二处。别改回去。
        var px = Math.round(vh * parseFloat(numText) * 0.01)
        out += s.slice(last, at) + 'min-height:' + px + 'px'
        last = tokenEnd
        hits++
        i = tokenEnd
      }
      return hits ? out + s.slice(last) : s
    }

    // 主题快照缓存。**故意放在函数之前**（`var` 提升在这里不能靠）：
    // 回归测试会把 `dswThemeSnapshotCss` 的函数体逐字提取出来执行，闭包外的变量在
    // 提取物里不存在 —— 放在同一段顶层源码里，提取器才能把它们一起带上。
    var __muvThemeCss = ''
    var __muvThemeSig = ''

    /**
     * 宿主主题变量 `--dsw-alias-*` 的**当前值快照**，供 srcdoc 里的卡使用。
     *
     * 为什么需要：iframe 不继承父页的 CSS 变量 —— 卡里写 `var(--dsw-alias-bg-l1)` 会
     * 全部落到 fallback（或者干脆是空/黑），于是**今天所有 iframe 化的卡都没有主题**
     * （宿主主题只作用于宿主 DOM）。用户看到的就是"卡片和外面的聊天气泡不像一套东西"。
     *
     * 只取**有值的**变量：`getComputedStyle` 对未声明的自定义属性返回空串，把空串原样
     * 写进 `:root{--x:}` 会让这条声明变成无效声明，反而把卡自己的 fallback 链条弄脏。
     *
     * 值做一道**去尖括号**：`<style>` 里出现 `</style>` 会当场把样式表截断并把后面
     * 整段当 HTML 解析。主题变量是我们自己的调色板、正常不会带尖括号，但这条防线
     * 成本为零，而且它防的是"渲染整页毁掉"这个量级的后果。
     *
     * 结果按连接串缓存：只在**首次**注入时算一次（单个 iframe 内调一次 `getComputedStyle`
     * 够用，省掉每个 frame 重新枚举一遍全部变量）。
     * @returns {string} `:root{…}` 形式，取不到就返回空串
     */
    function dswThemeSnapshotCss() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined' || !document.documentElement) return ''
        var cs = window.getComputedStyle(document.documentElement)
        if (!cs) return ''
        var names = []
        for (var i = 0; i < cs.length; i++) {
          var p = cs[i]
          if (typeof p === 'string' && p.indexOf('--dsw-alias-') === 0) names.push(p)
        }
        if (!names.length) return ''
        var sig = names.join(',')
        if (__muvThemeSig === sig && __muvThemeCss) return __muvThemeCss
        var out = ''
        for (var k = 0; k < names.length; k++) {
          var v = cs.getPropertyValue(names[k])
          if (typeof v !== 'string') continue
          v = v.replace(/[<>]/g, '').trim()
          if (!v) continue
          out += names[k] + ':' + v + ';'
        }
        __muvThemeCss = out ? ':root{' + out + '}' : ''
        __muvThemeSig = sig
        return __muvThemeCss
      } catch (_) { return '' }
    }

    /**
     * 注入卡文档的 **reset 样式**（照 ST 平价，`C:\_st_spec\SPEC.md` 真机实测抽出）。
     *
     * ST 原文（`ST-IFRAME-SPEC.md` §3，`b1()` 里那一段，逐字）：
     *   `*,*::before,*::after{box-sizing:border-box;}`
     *   `html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}`
     *
     * ★ `overflow` 从 `auto` 改回 **ST 的 `hidden`**（原来那一版是 `overflow-y:auto`）。
     *
     * 旧那版留了 `auto` 当"退路"：怕跨源的高度是估的、估短了会静默裁掉内容。
     * 但那条退路的**代价**是用户真的会看到：卡自己的滚动条出现在卡片里面（截图里右侧那条），
     * 而且 `body` 一旦是可滚动容器，`body.scrollHeight` 与帧高的关系就被搅乱。
     * 现在的取舍是：`hidden` + **保证帧高 ≥ 内容高**（见 `muvFrameBootstrap` 的度量：
     * 内容包围盒 ∪ 观测到的 `body.scrollHeight` 溢出 ∪ body/html 的 px `min-height`，
     * 三者取最大；**只要有任何一项超过帧高就抬帧高**）。
     * 也就是说裁切不再可能：报给父页的值**只会 ≥ 真实内容高**。
     * 实测 9 份真卡 × 3 档起始高度：内容底边 ≤ 帧高 全部成立（verify-frame-size.mjs /
     * verify-frame-height.mjs）。横向一直是 `hidden`（照 ST），没变。
     * @returns {string}
     */
    /**
     * 卡 iframe **画布的底色** —— 从宿主（DSH）当前主题里取，烘进 reset。
     *
     * ★ 为什么要这一段（第 40 轮真机对照实验，`tools/dsh-live22.mjs`）：
     *   iframe 是**独立文档**，宿主页面的 `--dsw-alias-*` 与 `data-ds-dark-theme`
     *   都传不进去；而 srcdoc 文档只要**没有声明任何背景**，UA 就会按自己的默认
     *   画一张**白画布**。宿主是深色时实测三个探针（`sandbox=allow-scripts`、
     *   父页 `background:transparent`，宿主页面本身 rgb(21,21,23)）：
     *     · 不声明背景          ⇒ 画布 rgb(253,253,253)  ← 就是用户说的「白框」
     *     · `background:transparent` ⇒ 画布 rgb(252,252,252)（**没用**，UA 画布照白）
     *     · `html{background:#151517;color-scheme:dark}` ⇒ 画布 rgb(24,24,26) ✓
     *   也就是说「白框」和 §39.2 修的「白边（幽灵高度）」是两件事：那一处是高度被
     *   隐藏弹窗顶高，这一处是**画布本身是白的**。
     *
     * ★ 为什么不硬编码深色值：只给 `html` 一个**低优先级**声明（插在 `<head>` 最前，
     *   且**不带** `!important`），卡自己的 `html{background}` / `body{background}`
     *   仍然照旧赢 —— 卡的配色不动（ST 保真度）。只有**没自带背景**的卡才吃到这个
     *   兜底，那种卡本来就是一块刺眼的白。
     *
     * ★ `color-scheme` 同源：它决定 iframe 内的滚动条/表单控件的 UA 配色，跟着宿主
     *   走才不会出现「深色页里嵌一条浅色滚动条」。
     * @returns {string} 空串表示取不到（测试里没有真 document 时）——那就保持 ST 原样。
     */
    function muvCardResetCss() {
      // ★ 宿主皮肤兜底（同上）：整段**内联**而不是拆成第二个函数 —— `buildFrom` 只把
      //   列进依赖表的函数抽出来求值，多一层函数声明在那些门禁里会是 ReferenceError。
      var skin = ''
      try {
        if (typeof document !== 'undefined' && document.body && typeof getComputedStyle === 'function') {
          var dark = document.body.hasAttribute('data-ds-dark-theme')
          var de = document.documentElement
          if (!dark && de && de.style && de.style.colorScheme === 'dark') dark = true
          var cs = getComputedStyle(document.body)
          var bg = (cs.getPropertyValue('--dsw-alias-bg-base') || '').trim()
          if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = cs.backgroundColor
          if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = dark ? '#151517' : '#ffffff'
          skin = 'html{background:' + bg + ';color-scheme:' + (dark ? 'dark' : 'light') + '}'
        }
      } catch (_) { skin = '' }
      return '*,*::before,*::after{box-sizing:border-box}' +
        'html,body{margin:0!important;padding:0;max-width:100%!important;' +
        'overflow:hidden!important}' + skin
    }

    /**
     * ★ 卡 iframe 的 **ST 同款前端库**注入开关（Tailwind / jQuery / jQuery-UI /
     * Vue / Vue-Router / FontAwesome）。**默认开 —— 不要顺手关掉。**
     *
     * 事实依据（`ST-IFRAME-SPEC.md` §3 / §7；这次是直接从 ST 的 `dist/index.js`
     * 里把 `v1` 常量原文取出来的，不是推测）。ST 的 iframe 文档模板 `b1()`
     * **无条件**把 `${v1}` 塞进**每一个**卡 iframe，`v1` 的原文是：
     *
     *   <link rel="stylesheet" href="…/@fortawesome/fontawesome-free/css/all.min.css">
     *   <script src="…/lib/tailwindcss.min.js">            （= @tailwindcss/browser@4.1.12）
     *   <script src="…/jquery/dist/jquery.min.js">
     *   <script src="…/jquery-ui/dist/jquery-ui.min.js">
     *   <link rel="stylesheet" href="…/jquery-ui/themes/base/theme.min.css">
     *   <script src="…/jquery-ui-touch-punch">
     *   <script src="…/vue/dist/vue.runtime.global.prod.min.js">
     *   <script src="…/vue-router/dist/vue-router.global.prod.min.js">
     *
     * ⇒ ST 里的卡 HTML **天然拥有** Tailwind 工具类（`class="w-full"`）、`$()`、
     * `$.ui`、Vue / Vue-Router、`fa-solid fa-xxx` 图标。写卡的人**直接依赖**这些、
     * 从不自己引 —— 所以「卡里东西出不来」有一条**独立**原因就是我们一个都没注入：
     *   · Tailwind 类没有任何 CSS 规则 ⇒ 布局按"没有样式"塌掉；
     *   · `$` / `Vue` 未定义 ⇒ 卡的脚本第一行就抛 ⇒ **界面照常渲染、功能全废**
     *     （与 §18 / §21 那两次 `$'` / `$&` 打坏卡脚本是同一类观感，极难查）。
     *
     * 关掉会发生什么：部分卡布局缺失、交互失效（"显示不全 / 点了没反应"）。
     * 只在**确认**某张卡被这些库干扰时才关；关法就是把这个常量改成 `false`，
     * **不要删代码**（删了就再也回不到 ST 平价）。
     *
     * 为什么走 CDN 而不是打包进插件：这六个库合计 ~600KB，打包会让每条消息多背
     * 一份；而卡的 iframe 本来就在拉远程图片/视频，网络能力不是新增的攻击面。
     * 失败形态是**安全的**：`script src` 取不到只是该全局为 `undefined`，卡里
     * 现成的 `typeof $ !== 'undefined'` 检测照旧短路 —— 不会比"从不注入"更差。
     * @type {boolean}
     */
    var MUV_CARD_LIBS = true

    /**
     * 库注入开关的读取口。
     *
     * 做成**函数**而不是直接引用常量：回归门禁是「从源码里逐字提取函数体再执行」
     * 的，闭包变量不在提取物里，裸引用 `MUV_CARD_LIBS` 会 `ReferenceError`
     * （这一片的每个 helper 都保持自足，测的才是真实代码）。
     * `typeof` 保护让它在"没有那个闭包"的提取场景下退回**默认开**。
     * @returns {boolean}
     */
    function muvCardLibsOn() {
      try { if (typeof MUV_CARD_LIBS !== 'undefined') return !!MUV_CARD_LIBS } catch (_) {}
      return true
    }

    /**
     * ST `v1` 的等价物 —— 六个库，**顺序照抄 ST**：先 CSS 后 JS，jQuery 在 Vue 前
     * （Vue-Router 依赖全局 `Vue`，jQuery-UI 依赖全局 `jQuery`，顺序错了就是静默
     * 少一个库）。版本**钉死**而不是用 latest：卡的写法是针对某一代库调过的，
     * 让 CDN 的 latest 自己往前走会引入无法复现的回归。
     *
     * 与 ST 的两处**有意**差异（都在注释里留痕，别当成 bug 修）：
     *  - Vue 用**完整构建** `vue.global.prod.js` 而不是 ST 的 `vue.runtime.global.prod`
     *    （runtime 版不含模板编译器）。完整版是它的**超集**：ST 能跑的写法这里都能跑，
     *    额外还能跑 `template:` 字符串 —— 只会多救几张卡，不会少。
     *  - 省略 jquery-ui 的 `theme.min.css` 与 `jquery-ui-touch-punch`（ST 有）：
     *    两者只影响 `.ui-*` 控件与触屏拖拽，而每多一个远程资源就多一份失败面。
     *    真遇到依赖它们的卡再补，补的时候照 ST 的顺序插（theme 在 jquery-ui 之后）。
     *
     * ★★ 2026-09-23（第 31 轮）追加两项 —— 它们**不在** ST 的 `v1` 里，而在
     *    `predefine.js` 里（下表每行都是"ST 侧证据 + 卡侧证据"两条腿，缺一条就别加）：
     *
     *    | 全局 | ST 侧证据（只读源码） | 卡侧证据（真卡 grep，2026-09-23） |
     *    |---|---|---|
     *    | `_` (lodash) | `src/iframe/predefine.js:1` `window._ = window.parent._;` | 151 处裸引用 |
     *    | `z` (zod)    | 同文件 `:12` `_.pick(window.parent, [...,'z'])` | 143 处裸引用（同一条脚本） |
     *    | `YAML` (yaml) | 同文件 `:12` 的同一个 `_.pick` 清单里就有 `'YAML'` ★ | 27 处（见下，**第 32 轮**补） |
     *
     *    · `_`：ST 本体依赖 `lodash@4.18.1`（`SillyTavern/node_modules/lodash/package.json`
     *      的 `"version": "4.18.1"`）⇒ **CDN 上也钉 4.18.1**（实测 jsdelivr 有这个版本，
     *      73,234 字节，与 npm 的 latest 同物）。`predefine.js` 第 11–19 行整段用
     *      `_.merge/_.pick/_.omit/_.get/_.set` 装配 `TavernHelper` ⇒ 它自己第一步就需要 `_`；
     *      另有 `src/iframe/adjust_iframe_height.js:26` 的 `_.throttle(measureAndPost, 500)`。
     *      卡侧：`星辉MVU核心` 一条就 74 处（`_.get(stat,'账本.待结算',{})` 这类）——
     *      §30 记的「bundle 110 处用 `_`」就是同一件事的另一种统计口径。
     *    · `z`：父页的 `z` 来自酒馆助手的 zod（`JS-Slash-Runner/package.json:89`
     *      `"zod": "^4.4.3"`）。卡侧最凶的是「8.2·星辉zod·等级能力一致性与比例数值」：
     *      它 `import { registerMvuSchema } from '…/mvu_zod.js'` 却**从不 import `z`**，
     *      `z.object/z.record/z.preprocess/z.coerce/…prefault` 全是裸引用 ⇒ 缺 `z` 时
     *      在**求值顶层 Schema 常量**时就 `ReferenceError`，`registerMvuSchema(Schema)`
     *      永远跑不到。
     *
     *    · `YAML` ★ **第 32 轮补上**（上一轮记的是"卡侧 0 处引用、故意不补"，本轮被两路
     *      新证据推翻）：① **ST 侧** —— ST 父页的 `window.YAML` 是**酒馆助手自己**装的
     *      （`JS-Slash-Runner/dist/index.js` 里 `function Qne(){globalThis.YAML=dV,…}`，
     *      `dV` 就是 `yaml@2` 的 ESM 命名空间：`parse/parseDocument/parseAllDocuments/
     *      stringify/Document/YAMLMap/CST/…`）；版本取 `JS-Slash-Runner/pnpm-lock.yaml`
     *      的 `yaml@2.9.0`（它 `package.json:59` 声明 `"yaml": "^2.9.0"`；ST 本体另有一份
     *      `node_modules/yaml` = 2.8.3，但**父页那个全局来自酒馆助手的 bundle**，所以钉 2.9.0）。
     *      ② **卡侧** —— `_足控天堂2` 的「外置手机」那条脚本是一行
     *      `import 'https://phone-ctn.pages.dev/index.js'`，该远端模块（3,150,415 字节）里
     *      有 **27 处裸引用 `YAML`**，全是 `YAML.parse(...)` / `YAML.stringify(...)` ——
     *      控制台那条 `Uncaught ReferenceError: YAML is not defined` 就是它。上一轮
     *      "卡侧 0 处"只 grep 了**卡里的内联脚本正文**，漏了「脚本文本只是一行 import、
     *      真代码在远端」这一形态（§30.2 记过这种形态，本轮把它算进来）。
     *    · 为什么不给 `dump` / `load`：ST 的 `YAML` 是 `yaml@2` 命名空间，**没有** `dump`
     *      / `load`（那是 js-yaml 的 API 名）；卡侧 27 处只用 `parse` / `stringify`。
     *      加别名会让 DSH 比 ST 更宽松（在 ST 里会炸的卡在这里悄悄跑起来），按本仓库
     *      "ST 侧 + 卡侧两条腿"的口径**不加**。真遇到用 `YAML.dump` 的卡再按同样格式取证。
     *
     * ⚠ 同一个 `_.pick` 里的 `EjsTemplate` / `showdown`：卡侧实测 0 处引用，
     *   所以**仍然故意不补**。它们分别是要宿主配合才跑得起来的 EJS 渲染 / markdown
     *   渲染；给个空壳会让卡以为"渲染成功了"从而写错数据，比缺全局更坏。
     *   真遇到依赖它们的卡再照 ST 补 —— 补之前先按上表的格式取证。
     *
     * 两条硬约束（与 `muvFrameBootstrap` 同源）：**不含反引号**；字符串里
     * **不出现裸的 `</script>`**（收尾标签用 `'</' + 'script>'` 拼出来）。
     * @returns {string}
     */
    function muvCardLibTags() {
      var CDN = 'https://cdn.jsdelivr.net/npm/'
      return '<link data-muv-libs="fa" rel="stylesheet" href="' + CDN + '@fortawesome/fontawesome-free@6.7.2/css/all.min.css">' +
        '<script data-muv-libs="tw" src="' + CDN + '@tailwindcss/browser@4.1.12/dist/index.global.js"></' + 'script>' +
        '<script data-muv-libs="jq" src="' + CDN + 'jquery@3.7.1/dist/jquery.min.js"></' + 'script>' +
        '<script data-muv-libs="jqui" src="' + CDN + 'jquery-ui-dist@1.13.3/jquery-ui.min.js"></' + 'script>' +
        '<script data-muv-libs="vue" src="' + CDN + 'vue@3.5.13/dist/vue.global.prod.js"></' + 'script>' +
        '<script data-muv-libs="vr" src="' + CDN + 'vue-router@4.5.0/dist/vue-router.global.prod.js"></' + 'script>' +
        // ── lodash：**三段**（存旧值 → 加载 → 还原），语义 = "只在缺失时补" ─────────
        // ★ 为什么不能只写一个 `<script src="…lodash.min.js">`：lodash 的 UMD 收尾是
        //   `root._ = lodash` —— **无条件**覆盖。而要求是"卡自己定义了 `_` 就不许动它"。
        //   三段的分工：加载前把已存在的 `_` 存进 `__muvDashPrev`；加载后若当初存过，
        //   就把它**放回去**。没存过（= 本来就没有 `_`）⇒ lodash 留下，正是我们要的。
        //   覆盖的场景是"卡在 `<head>` 里就定义了 `_`"（顺序上早于本注入点，会被 UMD
        //   盖掉）；卡在 `<body>` 里的赋值本来就晚于这里，天然是卡赢，三段不干涉它。
        //   `__muvDashPrev` 用完即删，不给卡留一个会困惑的全局。
        '<script data-muv-libs="dash-save">(function(){try{delete window.__muvDashPrev;if(typeof window._!=="undefined")window.__muvDashPrev=window._}catch(e){}})();</' + 'script>' +
        '<script data-muv-libs="lodash" src="' + CDN + 'lodash@4.18.1/lodash.min.js"></' + 'script>' +
        '<script data-muv-libs="dash-keep">(function(){try{if(Object.prototype.hasOwnProperty.call(window,"__muvDashPrev")){window._=window.__muvDashPrev;delete window.__muvDashPrev}}catch(e){}})();</' + 'script>' +
        // ── zod：**只能走 module** —— 实测 zod@4.4.3 的 npm 包里**没有 UMD/IIFE 构建**
        //    （`dist/zod.umd.js` / `dist/index.umd.js` 都是 404；只有 `+esm` 这种由
        //    jsdelivr 现打的 ESM，328,955 字节）。所以这里是全篇唯一一个 `type="module"`
        //    的库标签。
        // ★ 顺序仍然成立：module 天然 defer，而本标签在 `<head>` 里、卡脚本在 `</body>`
        //   之前 ⇒ 文档顺序决定它**先于**卡脚本执行（§30 那条"module 之间按文档顺序"
        //   的结论在这里第二次兑现）。代价与 jQuery 那类阻塞式 CDN 同级：zod 拉得慢会
        //   推迟卡脚本的**开始**，但不会让谁失败。
        // ★ `import * as` 而不是 `import { z }`：`+esm` 是 jsdelivr 现打的包，具名导出的
        //   名字不保证稳定（实测是 `object` / `z` + `default`）。落位取**命名空间本身**
        //   （形状判据 `typeof MUVZ.object === "function"`），兜底才退到 `default` —— 卡那边
        //   看到的是一个**能用的 zod 命名空间**，不是 `undefined`。
        // ★ 仍然只在缺失时落位（卡自己定义了 `z` 就尊重卡的）。
        // ★★ 第 32 轮定位 / 第 33 轮修（§32.7）：落位必须是**整个命名空间**，**不能**是
        //   `MUVZ.z` 这个**子对象**。ST 父页那个 `z` 是整包命名空间
        //   （`JS-Slash-Runner/dist/index.js` 的 `uk = bn({$brand,$input,…,ZodAny,…})`，
        //   `Qne(){globalThis.z=uk}`）—— 它同时有 `z.object` **和** `z.z`；`MUVZ.z` 子对象
        //   只有前者，于是**用 `z.z.object(...)` 写法**的模块抛
        //   `TypeError: Cannot read properties of undefined (reading 'object')` —— 实测两处：
        //   · `tavern_resource/dist/酒馆助手/自动更新角色卡/index.js`（单行压缩，`.object`
        //     在偏移 367 ⇒ 正好是用户报的 `index.js:1:372`；那条脚本是 `const n=z, r=n.z.object({…})`）；
        //   · `tavern_resource/dist/util/mvu_zod.js:553`（`r.z.object({stat_data:e})`，更常见）。
        //   jsdelivr 的 `+esm` 导出表里 `mo as object` 与 `Os as z` **都在** ⇒ 命名空间是子对象的
        //   **纯超集**：`z.object` / `z.z` / `z.record` / `z.preprocess` / `z.coerce` 全部成立，
        //   与 ST 的形状一致（不是新行为）。
        '<script type="module" data-muv-libs="zod">import * as MUVZ from "' + CDN + 'zod@4.4.3/+esm";' +
        'try{if(typeof window.z==="undefined")window.z=(MUVZ&&typeof MUVZ.object==="function")?MUVZ:((MUVZ&&MUVZ.default)||MUVZ)}catch(e){}</' + 'script>' +
        // ── YAML（第 32 轮补）：**也只能走 module**，理由与 zod 一字不差 ─────────────
        //   实测 `yaml@2.9.0` 的 npm 包里**没有 UMD/IIFE**：`dist/index.js`（1,769 字节）
        //   与 `dist/index.min.js`（1,892 字节）都只是 CJS 的 `require('./…')` 转发壳，
        //   真正能当全局用的只有 jsdelivr 现打的那份（`+esm`，104,914 字节，源文件就是
        //   `/npm/yaml@2.9.0/browser/index.js` = 官方的浏览器入口，包里没有任何 `require(`）。
        //   ST 那边也是 module（酒馆助手是 vite 应用），所以我们这条 module 标签与 ST 同源。
        // ★ 形状：`import * as MUVY` ⇒ 命名空间本身**就带 `parse`**（实测导出表里有
        //   `parse / parseAllDocuments / parseDocument / stringify / Document / YAMLMap /
        //   CST / Schema / Scalar / Pair / …`）。判据取 `MUVY.parse` 是不是函数而不是
        //   "拿得到东西"：`+esm` 是现打的包，具名导出万一变成只有 `default` 的形态，也
        //   要先落到 `default` 上，卡那边拿到的必须是一个**能 parse 的命名空间**。
        // ★ 与 zod 一样**只在缺失时**落位（卡自己做了一份 YAML 就尊重卡的），并且顺序
        //   同样安全：module 天然 defer、本标签在 `<head>`、卡脚本在 `</body>` 之前。
        '<script type="module" data-muv-libs="yaml">import * as MUVY from "' + CDN + 'yaml@2.9.0/+esm";' +
        'try{if(typeof window.YAML==="undefined")window.YAML=(MUVY&&typeof MUVY.parse==="function")?MUVY:((MUVY&&MUVY.default)||MUVY)}catch(e){}</' + 'script>'
    }
