# Changelog

## 0.3.11（2026-09-26 · 三十九 · 已发布 npm `chencheng810`）★ 状态栏行动选项点击无反应根治 + 一次点击插两份 · `2026-09-26c`

0.3.10 修的是「卡 iframe → 宿主 contenteditable」那一环，但**宿主自己**这条级联状态栏按钮路径
当时没被覆盖 —— 用户报的还是"选项点了没反应"。真机取证（`_scratch/_probe-sbopt8.mjs`，真鼠标
`Input.dispatchMouseEvent` 点真实会话里的可见选项）把两件事一起钉死。

### 1. 点击委托漏了 `.muv-sb-opt`（这就是"没反应"）

- `status-cascade.js` 的 `renderOptions()` 产出的是 `<button class="muv-sb-opt">`（`<Status_block>`
  里的「行动选项」，涩涩提瓦特等卡全走这条），而 `exports.apply` 里的全局点击委托只匹配
  `.muv-choice-btn, .tavern-option-btn` ⇒ 按钮**可见、有 hover、但零处理器**，点击静默无反应。
- 修：委托匹配 `.muv-sb-opt, .muv-choice-btn, .tavern-option-btn`；删掉委托里那套旧
  textarea-only 覆盖式逻辑（它在 DSH 真机 0 个 textarea 的前提下必然落空，还绕过了
  `muvDeliverUserText` 的 contenteditable 追加 / InputEvent / 真发送钮三件事），三条入口统一走
  `muvDeliverUserText(text, 'send')`。
- 字母前缀只在**确实渲染出徽标**时剥（`.muv-choice-letter` 子元素或 `data-opt-letter`）：
  旧代码无条件 `/^[A-D]\s*/` 会把状态栏选项原文里 `A new day…` 的首字母吃掉。

### 2. 一次点击把选项文本插**两份**（0.3.10 遗留，被本次修复放大）

- 真机时间线取证：点击后输入框里选项原文出现两份（52 字 ×2 = 104）。
- 根因：`execCommand('insertText')` 本身已触发**原生** `input` 事件、宿主受控编辑器据此更新模型；
  随后我们又无条件补了一个带 `data` 的合成 `InputEvent`，宿主把它当成"再插一次"的指令。
- 修：插入期间监听 `input`，**原生事件已到就不再补**合成事件（真的一个都没到才补，保留 React 感知兜底）。
- 附带加固：兜底 `appendChild` 的判据改成看**文本长度是否增长**，而不是 `execCommand` 的返回值
  （真机存在"插入成功却返回 false"）。

### 3. 门禁（全部可红）

- `verify-user-send.mjs`：新增场景④（真实 `.muv-sb-opt` 点击：投递 / 追加不覆盖 / InputEvent /
  **只出现一次** / 字母剥离不误伤 / 旧两类按钮不回归 / 非选项元素无副作用）、场景⑤（真机
  `execCommand` 插入却返回 false 时仍只插一份）、场景⑥（**受控编辑器仿真**：合成 InputEvent
  会让宿主再插一次 —— 真机两份的离线复现位）。**23/0**。
- 三条红臂：`--break=sb-opt-selector`（还原漏选择器 → 13 通过 10 失败）、
  `--break=ce-append-fallback`、`--break=ce-synthetic-input`（各自精确变红）。
- 回归：`test-client-render` 385/0、`test-status-cascade` 84/0、`verify-choices-dom` 全过、
  `verify-frame-height` 全过、`verify-frame-ratchet` 8 项失败 = **改动前基线**（对照 HEAD 实测，
  非本次漂移；文档里记的 10/7 是更早的树状态）。
- 真机验收（`_probe-sbopt8.mjs --block-post`，POST 被浏览器拦下 ⇒ **零污染**）：构建戳
  `2026-09-26c` / 选项原文进框 / 原生 input 事件 / 桥日志两条 / 发送钮真实 click /
  `POST api/session/prompt` / 输入框只留**一份** —— V1–V9 全 PASS。

## 0.3.10（2026-09-25 · 三十八）★ 用户消息桥 contenteditable 适配：卡选项点击无反应根治 · `2026-09-25a`

真机实锤（DSH 会话视图 DOM 取证）：DSH WebUI 会话视图**全页 0 个 `<textarea>`**，聊天输入框是
`[contenteditable=true]`（`uV2eYG_input` 类，发送按钮 `aria-label="发送消息"`）。而卡内行动选项的
回传链终点 `muvDeliverUserText` 只认 textarea（三级选择器全落空后 `return false` **静默丢弃**）——
用户点选项"毫无反应且无报错"。iframe 内全链路（点击 → triggerSlash → postMessage → 宿主监听）
本来就是通的，断在宿主最后一环。

### 1. `muvDeliverUserText` 补 contenteditable 分支

- textarea 三级探测全落空后改走 contenteditable：`document.querySelector('[contenteditable="true"]')`
  （排除隐藏收件箱 `data-muv-inbox`）；两皆无则打日志后如实放弃（不再无声）。
- 填值走**追加语义**（铁律：绝不清空输入框）：光标 Range 移到内容末尾 + `execCommand('insertText')`，
  失败兜底 `appendChild(textNode)`；随后派发 `InputEvent('input', {bubbles})` 让 React 感知
  （实测发送按钮从 disabled 变可点）。
- `mode === 'send'` 时 60ms 后 `muvUserSendFire(ce)`（通道① 发送按钮真实 click / 通道② Enter 序列，不变）。

### 2. `triggerSlash` `/send` 剥离 `|/命令` 脏尾巴

- 真卡写法 `/send 选项文本|/trigger`：旧代码把 `|/trigger` 一起当文本发出。现在只剥 `|` 后紧跟
  `/命令` 的尾巴；文本中真正的 `|` 保留（`a|b` → `a|b`；`a|/trigger|/x` → `a`；无尾巴原样）。

### 3. 门禁夹具补盲区（教训沉淀）

- `verify-user-send.mjs` 夹具原先用假 textarea → 门禁全绿但真机静默失败（**夹具必须贴真实 DOM**）。
- 新增场景③：contenteditable 输入框（`uV2eYG_input` 类 + `aria-label="发送消息"` 按钮），
  断言文本到达、发送通道触发、命中按钮通道、无 textarea 时不再静默 return false。

### 验证

- `test-client-render.mjs` 385 通过 0 失败；`verify-user-send.mjs` 10/10（含场景③ 4 条）；
  尾巴剥离 7/7 单元用例。
- 真机冒烟（headless Edge + CDP，真实 DSH 页 + 真卡会话 + 真桥监听）：桥日志两条全出
  （追加文本 + 通道① 发送按钮 click 已触发）、`POST api/session/prompt` 发出、模型开始生成
  —— 全链路闭环。

## （2026-09-24 · 三十七，随 0.3.10 首发到 npm）★ MVU JSONPatch：第四种变量格式解析 + 元素形态显示泄漏修复 · `2026-09-22y`

真机实锤（DSH 会话 `session-7347d5f7`，ST 角色卡）：模型**正式输出**里出现了 MVU 标准的
第四种变量写入格式 —— `<UpdateVariable>` 内含 `<Analysis>`（给模型的思考痕迹）+ `<JSONPatch>`
（JSON Patch 数组）。此前不认它，两个用户可见后果：**变量全部没生效**、`<Analysis>` 英文行与
JSON 数组**裸文本糊在正文里**。

### 1. 服务端：`var-tracker.js` 解析 ④ JSONPatch

- `parseVariableOps` 新增第四来源：`<UpdateVariable>` 内的 `<JSONPatch>`（或 Analysis 之后
  直接跟的 JSON 数组，宽容双认）。ops 映射：insert/add/replace → 设键（对象路径覆盖、
  目标/父层是数组或 `/-` 结尾 = 追加末尾、replace 缺失按保守策略也落为设值并计
  `byOp.replace`）；remove → 删键（缺失无操作，重放幂等）；move → 搬移（值深拷贝）；
  delta → 数值增量（缺失从 0 起算、非数字路径跳过）。
- JSON Pointer（RFC 6901）转义：`~1`→`/`、`~0`→`~`；路径按**精确键**导航（键里带 `.` 不被劈开）。
- `<Analysis>` 先整块剔掉再找补丁体（绝不进变量）；`<initvar>` 形态不碰（① 的地盘，不误计 bad）。
- 已消费的 UV 块从 ②③ 的扫描源里**等长空白化**剔除（位置不偏移），块内嵌套的
  `<VariableEdit>` / `_.set` 不被重复解析；坏块/坏 op 跳过并计数（`bad` + `jsonPatch.bad`），
  不抛、不整批失败。
- 顺序语义与既有三来源一致：带 `era_data` 消息键按键序重放，拿不到按到达顺序。
- 响应包新增 `jsonPatch: {blocks, ops, bad, byOp}` 可观测口径。

### 2. 客户端：`client.js` 元素形态显示泄漏（原生 DOM 路径）

- **泄漏机制实锤**（`tools/_probe-leak.mjs`，真 Edge + 真模块）：DSH 把标签渲染成**真元素**时
  （§20.4 实测两种形态之一），字面标签文本不在任何文本节点里，折叠正则永远打不中 ——
  实测 HEAD 上 `varedit=0 / analysisLeak=1 / patchLeak=1`；转义文本形态则不泄漏。
- 修法：`muvRenderVariableBlocks` 新增**元素形态 pass**（先跑）：`querySelectorAll` 认
  小写元素 `updatevariable/variableedit/variableinsert` → 整块折叠卡、`variablethink` → 推演卡、
  `jsonpatch` → 补丁卡、`analysis` → 删除（与酒馆路径 `_tavernRenderTags` 集合对齐，
  内容一律 textContent）。文本形态 pass 原样保留。
- `muvFeedVariables` 的收集正则**没动**（收集先于折叠，innerHTML 两种形态都吃）。

### 3. 门禁（全绿，数字）

- `test-era-vars.mjs`：+[8] 节 20 条（真实块夹具 / insert×3 / delta / Pointer 转义 / 追加 /
  move / remove 幂等 / 坏块跳过 / Analysis 不进变量 / 混合不重复解析 / 键序重放乱序一致 /
  结构对照臂）—— 全部通过（含既有 7 节）。
- `test-client-render.mjs`：347 通过 / 0 失败（+3 条元素形态源码断言）。
- `test-regex-engine.mjs`：26 通过 / 0 失败；`test-snapshots.mjs`：全部通过；
  `test-client-source.mjs`：exit 0。
- `verify-decorate-dom.mjs`：12 用例全 PASS（新增 K=转义多行真实块 / L=元素形态真实块，
  `jpLeak=0` + 折叠卡成型；`--break` 双向钉住 markdown 存活）。
- `verify-guard-tag-agnostic.mjs`：80 通过 / 0 失败（浏览器臂含）。
- `verify-era-bridge.mjs`：after 臂 21 通过 / 0 失败（连跑 3 次全绿；首轮曾现 17/4 时序波动，
  HEAD 对照同红同绿，按 §26.1 归因环境时序）。顺带修：`OLD_REV` 324b751 已随 §26.2 事故
  丢失，改 `7623ffa`（与 verify-card-compat §27.4 同一处置，可 `MUV_OLD_REV` 覆盖）+
  旧源码导出文件存在时直接复用（WorkBuddy 宿主 `spawnSync('git')` 一律 EBUSY 的容错）。
- `verify-varblocks-dom.mjs`：全部通过。构建号 `2026-09-22x` → `2026-09-22y`。

## 未发布（2026-09-23 · 三十六）★ 卡脚本报错双修：补 `errorCatched` / `tavern_events` + 垫片补 `SillyTavern.saveChat` · `2026-09-22w`

真机控制台（构建 `2026-09-22v`，卡 **异世界农场**）：

```
[muv-engine] 卡脚本报错：（未知脚本）Uncaught ReferenceError: errorCatched is not defined   ← 反复出现
lodash.min.js:84 Uncaught TypeError: Expected a function
mvu_zod.ts:201 变量结构注册成功                                                          ← 另一部分脚本是跑起来的
```

两条**都不是**卡的问题，也都不是 lodash 的问题 —— 是我们垫片缺了 ST 本来会给的东西。

### 1. `errorCatched` / `tavern_events`（按 ST 源码，只在**缺失**时补）

- **`errorCatched`**：ST `src/function/util.ts:17`（纯函数版）+ `:43`（iframe 绑定版 `_errorCatched`），
  经 `src/iframe/predefine.js:14-18` 的 `key.replace('_','')` 后成为卡 window 上的**裸全局**。
  语义照抄：**入参函数 → 返回包装函数**；包装函数同步抛 ⇒ `toastr.error` 后 **rethrow**；
  返回 thenable ⇒ `then(undefined, onError)`。
  卡侧实证：`异世界农场` 两条状态栏正则产物（`角色状态双端` 21,200 字符 / `双端` 12,120 字符）
  末尾都是 `$(errorCatched(init));` —— jQuery 的 `$(fn)` 是 ready 回调 ⇒ **返回值必须是函数**。
- **`tavern_events`**：ST `src/function/event.ts:180-263` 的 **82 条**常量表（含同值别名
  `SMOOTH_STREAM_TOKEN_RECEIVED` / `STREAM_TOKEN_RECEIVED`），`index.ts:311` 挂在 `TavernHelper` 上、
  `predefine.js:13` 再 merge 成裸全局。MVU bundle 里 `tavern_events` ×17 且**顶层**就引用 ⇒
  缺它整个 bundle 一行都跑不到。同份 bundle 里 `iframe_events` ×0 ⇒ 按 §32 口径**故意不补**。
- 两者同时挂 `TavernHelper`（ST 上本来就有），并在卡 window 上以**裸全局**落位。
  落位判据是 `typeof !== "function"` / 不是对象 —— 卡自己定义过就**不动它**。
- **语义边界（如实记）**：补的是常量表与工具函数，不是事件的**发生源**。
  `eventOn(tavern_events.X, …)` 从此能注册成功，但 ST 那批原生命名事件**多数仍不会响**
  （宿主目前只在 ERA / MVU 链路上广播）。事件名 → 我们事件面的映射**本轮不做**。

### 2. lodash `Expected a function` —— 真因是垫片缺 `SillyTavern.saveChat`

- 取证：`lodash@4.18.1/lodash.min.js:84` 的 `if(typeof n!="function")throw new pl(en)`
  在 `pl=TypeError` / `en="Expected a function"`，该行**只此一处**，所在函数是 **`_.debounce`**。
- 真因链：MVU `artifact/bundle.js` 顶层 `_.debounce(SillyTavern.saveChat, 1e3)`；ST 的
  `SillyTavern` 是 `{...getContext(), getContext}`，而 ST 的 context **有** `saveChat`，
  我们的垫片只给了 `getContext` ⇒ `undefined` 进 lodash 守卫 ⇒ TypeError ⇒
  **整个 bundle 模块求值中断**。
- 结论：**我方垫片缺口**，不是卡侧用法问题、**不是 lodash 版本问题**（不升/不换版本）。
- 修：垫片补 `saveChat`（DSH 没有等价落盘动作 ⇒ 返回已完成 Promise，**首次调用留痕**）；
  并把 `SillyTavern` 的落位从 `def`（固定值）改成新的 `defGet`（**逐次重算**的 getter）——
  ST `predefine.js:26-34` 就是 `defineProperty` getter。用固定值会把 `chat` 钉成初始空数组
  （宿主整条替换 `hostChat` 时不同步 ⇒ 静默的假数据，比 undefined 更坏）。

### 3. ★ 本轮自己踩的坑（门禁现在盯住了）

加代码时 `var tavernEvents={…}` 那条末尾漏了 `;`。整条垫片拼出来是**一行**，而 ASI 只在
「下一个词元前面有换行」或「下一个词元是 `}`」时才补分号 ⇒ `}` 后同一行跟 `var` 不满足任何一条，
`SyntaxError: Unexpected token 'var'`，而且**从那一句起整段垫片都不执行**（`TH` / `Mvu` /
`toastr` / 收尾的 `mvuReq()` 全丢）。此后 `verify-card-compat.mjs` 的 ⑪ 第一件事就是
「垫片产物必须可解析」，并带一条**变异臂**（把那个 `;` 摘掉 ⇒ 必须不可解析）。

### 4. 「暗色主题下发白的 `<html>` 行」取证（**无代码改动**）

用真卡三条正则产物跑真渲染链（`renderFencedHtml` → `wrapLoneDocuments` → `muvHidePageSourceBlocks`）：
产物里 **0 行**残留裸 `<html>`/`<!doctype`、**0 行**残留行首围栏、iframe **1 个**。
⇒ 没有"漏隐藏"的证据，本轮**不改**（有实锤再修）。疑点是暗色主题下 iframe **区域内**那段源码的
高对比观感，或输入侧痕迹；两者都不在本引擎的判据范围内。

### 门禁

```
verify-card-libs.mjs            54 通过 / 0 失败   （新增 F 臂：库+垫片，真浏览器真 lodash）
verify-tavernhelper-scripts.mjs 54 通过 / 0 失败
verify-guard-tag-agnostic.mjs   80 通过 / 0 失败
test-client-render.mjs         344 通过 / 0 失败
verify-card-compat.mjs          64 通过 / 0 失败（after）；49 / 7（before，必须红）
verify-no-redouble.mjs           4 通过 / 0 失败（before 臂 SKIP：a7031dc 随 §26.2 对象库事故丢失）
```

新增对照臂（都**真变红**）：

- `verify-card-libs.mjs` **F 臂** —— A 臂（真 lodash、无垫片）必须抛 `Expected a function`（真机同款）；
  F 臂（真 lodash + 垫片）**同一行**必须 `ok`。两臂只差"垫片"这一个变量。
- `verify-card-compat.mjs` **⑪ 垫片契约** —— after 臂 18 条全绿，before 臂 6 条红
  （`errorCatched`/`tavern_events`/`TavernHelper` 两成员/`SillyTavern` 形状/`saveChat`/`chat` 同引用），
  外加一条**产物变异臂**（摘掉 `};` 的 `;` ⇒ 必须不可解析）。

## 未发布（2026-09-23 · 三十五）★ 文本级状态栏 —— 无占位符的卡也能把元信息渲染成状态栏 · `2026-09-22v`

用户实测（真卡**川上富江**，`regex_scripts: 0`、没有酒馆助手脚本）：正文开头是**裸文本**

```
[时间:5月14日|星期三][季节:初夏][天气:夜间大雨][时间段:晚上20:41][地点:暮川市·旧片区·富江的独宅·厨房][环境布置:镜子前的木凳空了…][怪谈女性角色:川上富江(高中水手制服…)]
她把他从自己腿间推开的时候…
```

正文里还夹着 `<details><summary>[角色状态]</summary> ```- 😃 川上富江的状态…```</details>`
（代码块裸露）。用户期望：元信息**渲染成状态栏**（📅 05月14日 星期三 20:41 / 📍 地点 …）、
折叠块渲染成**折叠 UI**，而不是裸文本堆在正文里。

**为什么之前没渲染**：本引擎的状态级联（card/yaml/free/loose 四级，含 `[角色状态]` section）
**只在消息里出现 `<StatusPlaceHolderImpl/>` 时才被调用**（`STATUS_PH_TEST` 那条路）。这类卡
既没有占位符、也没有正则 ⇒ 级联永不触发。而 ST 生态里「模型自己往开头写一串 `[键:值]`」是
一大类常见形态（本仓库历轮取证过的真卡里就有 `[时间:…]`、`[角色状态]` 这些写法）。

### 修法（两件事，都不动既有优先级）

1. **文本级兜底**（`lib/client.js`）：在装饰链里加一级**最低优先级**的兜底 —— 当消息**不含**
   占位符、卡也**没有**自带状态栏皮肤、也**没有** `<Status_block>` 时，尝试识别：
   - **裸方括号前缀**：消息开头（去首尾空白后 ≤ 16 字引子以内）的**连续** `[键:值]`，键必须落在
     **已知词表**里、**≥ 2 个连续对**、每对不跨行、整段 ≤ 600 字；
   - **状态折叠块**：`<details><summary>[状态类标签]</summary>…</details>`（标签词表见源码）。
   命中的整段**从正文里移除**（用户最初抱怨的就是"同一份信息既在正文又在状态栏"），换成状态栏卡片；
   折叠块的内容仍交给服务端**既有的 loose 级联**渲染（不重写一份），外面还原成 `<details>` 折叠 UI。
2. **折叠块的渲染入口**（`lib/index.js`）：`/api/muv-engine/render-status` 新增显式 `body` 字段
   —— 调用方**已判定过**的状态体直接跑结构级联（没有 `<Status_block>` 包裹的形态）。
   **不做**"没有 Status_block 就把整条消息当 body"（那等于让 loose/yaml 去读任意散文，误伤面不可接受）。

### 判据（保守优先：宁可漏，不可误伤）

| 判据 | 值 | 为什么 |
|---|---|---|
| 位置 | 只在**消息开头**（≤ 16 字无换行/无方括号的引子以内） | 正文中间的 `[注:…]` 不该被动 |
| 对数 | **≥ 2 个连续对** | 单个 `[时间:…]` / `[注:…]` / `[1]` 一律不认 |
| 键 | 必须在**词表**内（表在 `muvTextStatusProbe` 里，逐条标了出处：用户实测 / 既有级联 / 生态常见 / 英文） | 词表是误伤面的唯一闸门，故意不收 `备注`/`说明`/`提示` 这类口语词 |
| 形状 | 每对不跨行、值非空、整段 ≤ 600 字 | 长度与折行是最容易把正文吞进来的两个方向 |
| 折叠块 | summary 必须是**状态类**标签（角色状态/NPC状态/状态/…#） | `<details><summary>主页</summary>` 那类是整页文档路径的活，不能被这里吃掉 |

### 与既有优先级的关系（**没动**）

占位符 / 卡自带状态栏皮肤 / `<Status_block>` 三条任一命中 ⇒ 文本级兜底**一个字符都不动**
（`muvStatusAlreadyRendered`）。开关 `MUV_TEXT_STATUS`（默认**开**）关掉 ⇒ 无占位符的卡
**恢复裸文本**（本轮之前的行为）。

### 落地时踩到并修掉的两件事（都记进代码注释）

- **`innerText` 是渲染投影**：门禁夹具里那段折叠块在 700px 容器里软折了一行，`innerText`
  给出的原文就在折行处**多了一个 `\n`**，而 DOM 文本节点里那位置只是一个空格 ⇒ 照原文逐字
  去 `findTextRange` 匹配不上 ⇒ 退回整条替换 ⇒ **markdown 被抹平**（实测 `strong/h2/pre/li`
  全 0）。修法：落点匹配按「逐字 + 空白处放宽成 `\s*`」（`muvFlexRegExpSource`）。
- **落点信息写进产物自己**（`data-muv-ts / -raw / -look`）：不靠模块级状态，并发装饰多条消息
  不会串（与 `extractStatusWrap` 的"生成什么就解析什么"同一口径）。手术失败时把原因写进
  `data-muv-ts-fallback` 留痕（那条路径是隐形的：用户只会看到 markdown 变平）。

### 门禁（全绿，数字）

| 门禁 | 结果 |
|---|---|
| `node verify-statusbar-layout.mjs` | **全部通过**（2 个阶段实测 PASS；真 CSS 2865 字） |
| `node verify-statusbar-fence.mjs` | **2 通过, 0 失败** |
| `node test-client-render.mjs` | **344 通过, 0 失败**（新增 **24** 条：第 24 节 21 条＝判据 + 10 类负例 + 折叠块 + 开关，第 22 节 3 条＝守卫第三项） |
| `node verify-decorate-dom.mjs` | **全部通过**（10 条用例 + 9 条对照臂/安全断言） |
| `node test-era-vars.mjs` | **全部通过**（39 条 PASS，1 条 SKIP=找不到真聊天文件） |
| 顺带跑了相邻门禁（改到了守卫行） | `verify-guard-tag-agnostic.mjs` **80 通过 0 失败**；`verify-no-redouble.mjs` 4/0；`verify-header-fold.mjs` 全部通过 |

新增用例用**用户这段真实文本做夹具**：① 7 个方括号被识别 + 状态栏渲染 + 正文里不再有裸方括号
（`rawBrackets=0`、`nakedFence=0`、`tsBars=2`、`sbDetails=1`）；② 对照臂 `J_notstatus`
（正常行文里的**单个** `[时间:…]` + `[1]` + `[注:…]`）一个状态栏都不许有、方括号必须留着；
③ 折叠块不再裸 ```；④ **关闸页**（把 `MUV_TEXT_STATUS` 逐字改成 false 另跑一页）：恢复裸文本。
**对照臂真变红**（实测）：把判据从「≥2 对」放宽成「≥1 对」⇒ `J_notstatus` 立刻 FAIL
（`tsBars=1` / 单个 `[时间:…]` 被吞）；关闸页 ⇒ `I_textstatus` 的 `tsBars=0`、`rawBrackets=1`。

### 顺带修好的一条**既有**门禁空洞

`verify-guard-tag-agnostic.mjs` 的 `--break=guard-enum` / `--break=guard-never` 两条破坏臂
**在改动前就是抛异常**（`guardLiteralOf(SRC)` / `shortBoundsOf(SRC)` 从一个被改写过的源码里取
守卫块，而破坏臂恰恰把那一块换掉了）—— 报错盖住真正的失败项（HANDOFF §22.3 那一类）。
本轮把三个提取口改成读 `SRC_RAW`、BEFORE 臂固定从 `SRC_RAW` 生成，两条破坏臂现在**正常变红**
（69 通过 11 失败 / 67 通过 13 失败）。

### 只能真机验的部分（如实记录）

- 川上富江那张真卡的**真模型输出**里前缀是否逐字长这样、以及 DSH 渲染后的 `innerText`
  与 DOM 文本的空白差异 —— 夹具按用户给的原文与「标签当文本铺开」的既有事实搭，但仍需真机确认。
- 关掉开关后确实是裸文本（客户端常量，改 `var MUV_TEXT_STATUS = true` → `false`，**页面重载**即可，
  不需要重启 DSH）。

## 未发布（2026-09-23 · 三十四）★ 媒体落定后的「测量修正通道」—— 修「卡界面下方一大片空白」 · `2026-09-22u`

用户实测：某张卡的封面页（整页 HTML 显示一张大图 + 三个按钮）在 DSH 里渲染后，**下面留出
一大片空白**（iframe 高度远大于内容）。主嫌疑是 §29（`2026-09-22p`）那轮引入的**媒体事件重测**
与**棘轮**的相互作用。本轮**先取证再改**，数字全部来自真卡 + 真 Edge 夹具（真时间 CDP）。

### 取证一：真卡 10 份围栏整页文档，帧高 vs **真实内容高**

| 真卡文档 | 帧高最终 | 纯内容包围盒 | 差 |
|---|---|---|---|
| `_足控天堂2`·主页 | 1636 | 1636 | **0** |
| `_足控天堂2`·ERA 状态栏 | 900 | 898 | +2 |
| `_足控天堂2`·正文美化（带音乐） | 900 | **309** | **+591** |
| `异世界农场`·角色状态双端 / 双端 | 349 / 210 | 349 / 210 | 0 / 0 |
| `涩涩提瓦特`·一体式 / 只状态栏 | 363 / 249 | 363 / 249 | 0 / 0 |
| `食人世界`·开场白 | 900 | 800 | **+100** |
| `食人世界`·开场白2 | 649 | 629 | +20 |
| `魔法少女MVU测试`·星盟契约开场白（108KB） | 1396 | 1440 | −44（内容比帧**高**） |

两处留白的成因**都不是棘轮**，是 `rewriteVhMinHeight` 把 `min-height:100vh` 烤成**父页视口高**
（ST 平价，`--TH-viewport-height = window.parent.innerHeight`，见 `ST-IFRAME-SPEC.md` §5）——
短页面的帧高被地板顶到 900。**本轮不动它**（那是有门禁的既有决策），见 HANDOFF §34.4。

### 取证二：合成「先大后小」**复现**了永久留白（这才是本轮修的）

`img` 用 `width/height` **属性**预留 600×2000 的高盒子（读到的 2300 是**真实**内容高，棘轮
没记错），真实图片是 600×200 的**扁**图、`src` 在 **11.5s**（晚于引导脚本最后一次补量
10.9s+150ms）才设：

| 时刻 | 上报 | 宿主采用 | 真实内容 | 差 |
|---|---|---|---|---|
| ~0.8s | 2300 | 2300 | 2300 | 0 |
| 11.65s（媒体落定） | 2300 | 2300 | **500** | **1800** |
| 之后 | 无 | 无 | 500 | **1800（永久）** |

根因：收缩方向的常规路径要求**连续 3 次**观测才清零重学，而媒体落定引起的收缩常常**只有
一次**观测机会（定时补量已停、RO 对 html/body 盒子不动时不 fire）。对照组把 `src` 提前到
400ms ⇒ 靠 2500/5300/8100 三次补量凑够 3 次 ⇒ 正常回落（帧高 500）。

### 改动（只在 `muvFrameBootstrap` 的引导脚本里，三处）

```diff
  'function RL(){...}' +
+ // MS()：所有 img.complete / video.readyState>=1 —— 测量修正通道的前置条件
+ 'function MS(){...}' +
- 'function extent(){'
+ 'function extent(mf){'
  ...
  'if(RL&&(bOver||dOver)){...无条件提升...}' +          // 内容增长：一个字符没动
  'else if(RL&&fit>0&&maxB>0&&(fit-maxB)>24){' +
+ 'if(mf&&MS()){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{' +   // ★ 测量修正：一次就够
  'var rc=(window.__muvHReset||0)+1;' +
  'if(rc>=3){window.__muvHFit=0;fit=0;window.__muvHReset=0}else{window.__muvHReset=rc}}}' +
- 'function m(){try{var e=extent();'
+ 'function m(){try{var mf=window.__muvHMediaFix?1:0;window.__muvHMediaFix=0;var e=extent(mf);'
- 'function mw(el){...el.addEventListener("load",s)...}'
+ 'function sf(){window.__muvHMediaFix=1;s();...+700ms 安全复核}'
+ 'function mw(el){...el.addEventListener("load",sf)...}'
```

- **「内容增长」（棘轮）语义一行未动**：只要**观测到**溢出（`bOver||dOver`）就无条件提升。
- **「测量修正」是新开的一条可控通道**，四个边界缺一不可，任一条不满足即退回老的 3 次语义：
  ① 本次测量由**媒体事件**触发（一次性令牌 `__muvHMediaFix`，`m()` 读走即清，定时/RO/卡 JS
  的测量都不带它）；② `MS()` —— 媒体**全部落定**；③ `RL` + **没有**观测到溢出；
  ④ 只作用于**收缩**方向。
- **不许把收缩方向的滞回拆掉**（那是既有防抖决策）：24px 阈值、3 次确认、父侧 8px 死区
  **全部保留**，只给"媒体落定后的修正"开一条通道。
- 修正后 `sf()` 在 **+700ms** 再挂一次令牌重量一次 —— 万一修正量偏小，那次走**增长**分支
  无条件补上，不会因这条通道把内容永久裁掉。
- `MUV_BUILD`：`2026-09-22t` → **`2026-09-22u`**。

### 门禁（3 绿 1 红，数字与真因）

| 门禁 | 结果 |
|---|---|
| `verify-frame-height.mjs` | **全部通过**（新增第 8 节「测量修正通道」3 条：先撑到 ≥2000 / 回落到 ≤600 / 变异臂砍掉通道后**必红**） |
| `verify-frame-ratchet.mjs` | **8 项失败 —— 全部是既有问题，与本次改动无关**（见下） |
| `test-client-render.mjs` | **320 / 0** |
| `verify-decorate-dom.mjs` | **全部通过** |

**⚠ 必须知道的四件事（本轮实测，`verify-frame-ratchet.mjs` 一直没在测东西）**：

1. **这条门禁此前是"空表假绿"**：它生成的父页内联脚本**多了一个 `}`**
   （`c.clampedMax=h;}}}' + '}, false);'` 一共闭 4 层，只需要 3 层）⇒
   `SyntaxError: missing ) after argument list` ⇒ **整段脚本一行都不执行** ⇒ 没有监听器、
   没有读数、`byName` 为空 ⇒ 所有判据一条都不跑，直接打印"全部通过"。
   **改动前后的源码表现完全一致**（已用 `git show b536cb4:lib/client.js` 对照）。
2. **它的子文档探针从未注入**：`doc.replace(/<\/body\s*>/, …)` 打在被 `escAttr` 整体转义的
   srcdoc 上（产物里没有字面量 `</body>`，只有 `&lt;/body&gt;`）⇒ 第 1 节的
   `extent` / `走的路径` / `内容底` 三列恒为 `?`，两条判据恒真。
3. **它的固定 `sleep(6500)` 等不到 `report()`**（挂父页 `load`+5s，而 `load` 要等 3 个真卡
   iframe 的远程资源全部落定，可能永远不 fire）⇒ 与第 1 条叠加成同一个"空表"。
4. **它缺 `window.innerHeight` 桩**：Node 侧 `rewriteVhMinHeight` 静默跳过 ⇒ 卡里的
   `min-height:100vh` 变成"随 iframe 自身高度伸缩"的真·不动点（`正文美化` 报 600/900/1500）
   —— 这正是 `verify-frame-height.mjs` 早已记过的那条教训。

本轮把 1/2/3/4 都修了（**只动夹具，不动判据**），并加了一条**防空表假绿**的断言。
修好后它给出真实读数：**8 项失败**，其中

- **1 项是真·产品发现（既有，未修）**：「`height:100vh` + 任意 top 偏移」的对抗载荷
  **每测一次长高 40px**（实测序列 `2120 → 2160 → 2200 → 2240`，起始 600 档涨到 2240；
  1500 档到 1540）—— 老法师当年那条棘轮推理**命中**。真卡用的是 `min-height:100vh`
  （已重写成父页视口常量），所以线上暴露面有限；但确实是一条未修的产品风险，**下一轮单独处理**。
- **2 项是陈旧判据**：`正文美化` 的 `<400` 阈值（姊妹门禁 `verify-frame-height.mjs` 早已按
  "钉在父页视口地板 ≈900"的口径更新过，这条没跟上）。
- **若干项是夹具时序**：`内容底边可见` 用的是**取快照那一刻**的子文档 `innerHeight`，父页刚
  改完高度时子文档还没重排（`主页@1500` 报 `文档 1635 > 帧 1500`，而父页最终值就是 1636）。

**"有没有破坏既有棘轮语义"的判据（本轮真正要证的那件事）**：把改动前后两份 `lib/client.js`
喂给**修好的**同一条门禁，第 1 节逐实例读数与失败集合**逐字一致**（唯一差异是上面那条失控臂的
时序数值 2320 vs 2240）。⇒ 本轮改动**未触碰**棘轮语义；棘轮的"只增不减 / 收缩必须回落"由
`verify-frame-height.mjs` 第 6 节（含变异臂）在真浏览器里全绿。

构建 `2026-09-22u`。

## 未发布（2026-09-23 · 三十三）★ zod 落位改成**整包命名空间** —— §32.7 的落地 · `2026-09-22t`

一行级修复：**上一轮定位、本轮落地**。真机那条
`Uncaught TypeError: Cannot read properties of undefined (reading 'object')`（`index.js:1:372`）
的**真因不是缺全局，而是我们给的 `window.z` 比 ST 窄一档**（HANDOFF §32.7）。

### 改动（就一处，`lib/client.js` 的 `muvCardLibTags()` zod 标签）

```diff
- 'try{if(typeof window.z==="undefined")window.z=(MUVZ&&MUVZ.z)||(MUVZ&&MUVZ.default)||MUVZ}catch(e){}'
+ 'try{if(typeof window.z==="undefined")window.z=(MUVZ&&typeof MUVZ.object==="function")?MUVZ:((MUVZ&&MUVZ.default)||MUVZ)}catch(e){}'
```

- **症状链**：卡脚本 `const n=z, r=n.z.object({角色卡名称:n.z.string(), …})` ——
  `n = z` 是我们的全局；落位是 `MUVZ.z`（**子对象**，只有 `z.object`）⇒ `n.z` 是 `undefined`
  ⇒ `undefined.object` 抛 TypeError。偏移 367 与真机报错 `index.js:1:372` 精确吻合。
  同类第二处：`tavern_resource/dist/util/mvu_zod.js:553` 的 `r.z.object({stat_data:e})`
  （`变量结构` 那类脚本都 import 它，更常见）。
- **改法**：落位取**命名空间本身**（`typeof MUVZ.object === "function"` 时），兜底才退 `default`。
  ST 父页那个 `z` 就是整包命名空间（`JS-Slash-Runner/dist/index.js` 的
  `uk = bn({$brand,$input,…,ZodAny,…})` / `Qne(){globalThis.z=uk}`），
  它同时有 `z.object` **和** `z.z`；jsdelivr 的 `zod@4.4.3/+esm` 导出表里
  `mo as object` 与 `Os as z` **都在** ⇒ 命名空间是子对象的**纯超集**，与 ST 形状一致
  （`z.object` / `z.z` / `z.record` / `z.preprocess` / `z.coerce` 全部成立，不是新行为）。
- **口径不变**：仍然**只在缺失时**补（卡自己定义了 `window.z` 就尊重卡的）；仍是全篇唯一的
  `type="module"` 库标签；`MUV_CARD_LIBS` 开关、CDN 钉版本、注入点（`</head>` 之前）一行未动。
- `MUV_BUILD`：`2026-09-22s` → **`2026-09-22t`**。

### 门禁（全绿，数字）

| 门禁 | 结果 | 变化 |
|---|---|---|
| `verify-card-libs.mjs` | **48 / 0** | 45 → 48：A 臂新增 3 条**落位形状**断言（`typeof window.z.object === "function"`、`typeof window.z.z === "object"`、`window.z.z.object` 是函数）—— 后两条就是 §32.7 的因果臂 |
| `verify-tavernhelper-scripts.mjs` | **54 / 0** | 未受影响 |
| `test-client-render.mjs` | **320 / 0** | 未受影响 |
| `verify-card-compat.mjs --old-export` | after **46 / 0** · before 红 **37** | 对照成立（本轮**没出**时序偶发） |

**对照臂真变红（照 §32.6 的"变异实验"做法，不用 `git stash`）**：临时把落位改回
`(MUVZ&&MUVZ.z)||…`（子对象）⇒ `verify-card-libs` **46 / 2**，红的**正好是新增的那两条**
（形状② 实测 `z.z` = `undefined`、形状③ = `false`），而形状①（`z.object` 是函数）**仍绿**
⇒ 不是"整篇没生效"的假红，因果收敛到"落位是命名空间还是子对象"这一个变量。
改前 `cp lib/client.js` 到仓库外备份 + 记 `md5`，恢复后 `md5` 逐字一致再重跑。

### 只能真机验的部分

硬刷新（或重启）后看控制台：`[muv-engine] client loaded 2026-09-22t`，
且那条 `Cannot read properties of undefined (reading 'object')` 应当**消失**；
`酒馆助手/自动更新角色卡` 与 `util/mvu_zod.js` 走的脚本不再在顶层求值处抛。

## 未发布（2026-09-23 · 三十二）★★ 补 `YAML` + 卡脚本注入过滤/留痕带名 · `2026-09-22s`

真机控制台报了三件事，本轮按证据逐条处置（第 1、2 条已修，第 3 条已**定位**但不改）：

| # | 真机症状 | 结论 |
|---|---|---|
| 1 | `Uncaught ReferenceError: YAML is not defined`（反复） | **真缺口**，本轮补上（§31 那次"卡侧 0 处"是**统计口径漏了**远端模块，见下） |
| 2 | `[muv-engine] 卡脚本报错：（未知脚本）脚本加载失败（本次不执行） http://127.0.0.1:3080/` | **两个缺陷叠在一起**：①有一条 content 不是代码而是相对/空地址，被内联后按宿主地址解析；②报错元素**没有署名**。两条都修 |
| 3 | `Uncaught TypeError: Cannot read properties of undefined (reading 'object')`（index.js:1:372） | **与 YAML 无关**（已证）；真因是 `window.z` 的**形状**比 ST 窄一档，位置级吻合，留给下一轮（见 HANDOFF §32.7） |

### 1. 补 `YAML`（`yaml@2.9.0`，**不是** js-yaml）

- **ST 侧的 `YAML` 是谁给的**：`predefine.js:12` 的
  `_.pick(window.parent, ['EjsTemplate','TavernHelper','YAML','showdown','toastr','z'])` 只是
  **搬运**；父页那个全局的真身是**酒馆助手自己**装的 —— `JS-Slash-Runner/dist/index.js` 里
  `function Qne(){globalThis.YAML=dV,globalThis.z=uk}`，而
  `dV = bn({Alias, CST, Composer, Document, Lexer, LineCounter, Pair, Parser, Scalar, Schema,
  YAMLError, YAMLMap, YAMLParseError, YAMLSeq, YAMLWarning, isAlias…, parse, parseAllDocuments,
  parseDocument, stringify, visit…})` —— **`yaml@2` 的整包命名空间**。
- **版本**：`JS-Slash-Runner/pnpm-lock.yaml` 的 `yaml@2.9.0`（它 `package.json:59` 声明
  `"yaml": "^2.9.0"`）。ST 本体另有一份 `node_modules/yaml` = 2.8.3，但**父页那个全局来自
  酒馆助手的 bundle**，所以钉 **2.9.0**。
- **为什么不是 js-yaml**：js-yaml 的全局名叫 `jsyaml` 且**没有** `parseDocument`/`YAMLMap`/`CST`
  —— 用 js-yaml 冒充会在"卡真的用了 `yaml@2` 特性"时静默给错结果，比缺全局更坏。
- **为什么不给 `dump` / `load`**：那是 js-yaml 的 API 名；ST 那个命名空间没有它们，卡侧实测
  27 处也只用 `parse` / `stringify`（见下）。加别名会让 DSH 比 ST **更宽松**（在 ST 里会炸的卡
  在这里悄悄跑起来），按本仓库"ST 侧 + 卡侧两条腿"的口径不加。
- **只能走 `<script type="module">`**（与 zod 同款处置，**先核实再选**）：实测 `yaml@2.9.0` 的
  npm 包里**没有 UMD/IIFE** —— `dist/index.js`（1,769 字节）与 `dist/index.min.js`（1,892 字节）
  都只是 CJS 的 `require('./…')` 转发壳；能当全局用的只有 jsdelivr 现打的那份
  `yaml@2.9.0/+esm`（104,914 字节，源文件就是官方的浏览器入口 `/browser/index.js`，
  包内无任何 `require(`）。
- **落位**：`import * as MUVY` ⇒ `window.YAML = (typeof MUVY.parse === "function") ? MUVY
  : (MUVY.default || MUVY)`，**只在缺失时**（卡自己有一份就尊重卡的）。顺序仍安全：
  module 天然 defer，本标签在 `<head>`、卡脚本在 `</body>` 之前。

### 2. 卡侧证据推翻 §31 的"YAML 0 处"（统计口径的教训）

§31.3 记的是"`EjsTemplate` / `YAML` / `showdown` 各 0 处"，那是**只 grep 了卡里内联脚本的正文**。
本轮换成"**连远端模块一起看**"的口径，第一张卡就命中：

```
_足控天堂2 → 脚本[1]「外置手机」= import 'https://phone-ctn.pages.dev/index.js'
            该远端模块 3,150,415 字节里有 **27 处裸引用 YAML**，全是
            YAML.parse(...) / YAML.stringify(...)
```

`§30.2` 早就记过"脚本文本只有一行 import、真代码在远端"这种形态 —— 但 grep 统计漏了它。
**教训写进 HANDOFF §32.2：统计"某全局被引用几次"时，`import '…'` 型脚本必须跟到远端去数。**

### 3. 卡脚本注入：两条过滤（都留痕带名字）

真机第 2 条症状的形态是"content 不是代码，而是一个相对/空地址"，内联后被浏览器按
**宿主页**当地址基准解析（`http://127.0.0.1:3080/` 就是宿主自己）。

- `muvCardScriptBareSrc(c)`（新）：**只认最保守的形态，宁可漏也不误杀** ——
  去空白后为空 ⇒ 拦；**含任何空白** ⇒ 放行（`import 'https://…'`、几万字的 IIFE 全有空白）；
  以 `http(s)://` 开头 ⇒ 放行（ST 生态的正常写法）；剩下的"单个 token"里只拦两类明显是路径的
  （以 `/` `./` `../` `~/` `//` 开头，或整体是"文件名+已知扩展名"）。带 `*` `(` `)` 的
  （正则字面量/表达式）一律不拦。
- 空白 content 也跳过（过去 `if (!c)` 挡不住 `'   '`：会多出一个空标签，还会进清单签名/缓存键）。
- **两条都 `console.warn` 留痕，且带脚本名 + 原因 +（地址那条）内容片段** —— 静默跳过正是
  这一轮要消灭的那类困惑。
- 真卡实况：9 条 enabled 脚本**一条都没被拦**（门禁 [1] 节有断言），它是给畸形卡准备的护栏。

### 4. 留痕带名字：元素报错分类 + 无 import 脚本包壳自报

- 收集器新增唯一输出口 `rep(from,msg)`（console 与 `window.__muvScriptErrs` 同口径、共用同一
  个 20 条上限计数器），三条入口与卡脚本自报都走它。
- **元素报错**：`e.target` 上没有 `data-muv-th` 时，不再一律写成「（未知脚本）」——
  先看 `tagName`：不是 `script` 就报 `（非脚本元素 <img>）` + `<img> 资源加载失败（不是卡脚本）`。
  ★ 门禁 E 臂真的复现了真机那条：`<img src="">` 的 `src` 被解析成**文档地址**
  （真机就是 `http://127.0.0.1:3080/`），过去被叫成"卡脚本报错"，完全误导排查。
- **运行时错误**：给**没有顶层 import/export** 的脚本包一层
  `try{…}catch(e){window.__muvThErr(e,"<脚本名>")}` ⇒ 这类脚本运行时报错也**说得出名字**。
  判据**极度保守**：内容里任何地方出现 `import` / `export` 就不包（顶层 `import` 放进 `try`
  块里是**语法错误**，包错会把整条脚本弄死 —— 宁可少一个名字，不可少一条脚本）。
  名字进 JS 字符串前把 `<` 转成 `\u003c`，名字里写收尾标记也截断不了 srcdoc。

### 5. 门禁（全绿，数字）

| 门禁 | 结果 |
|---|---|
| `verify-card-libs.mjs` | **45 / 0**（四臂 → **五臂**：新增 E 臂"只摘掉 yaml 标签"） |
| `verify-tavernhelper-scripts.mjs` | **54 / 0**（新增 [2.1] 节：过滤/留痕/**F 臂对照** + D/E 两臂真浏览器） |
| `test-client-render.mjs` | **320 / 0**（[20] 段 9 库 + yaml 形状；[23] 段过滤与包壳） |
| `verify-card-compat.mjs --old-export` | after **46 / 0**（**这一条有时序偶发**，见下）· before 红 **37** ⇒ 对照成立 |

**`verify-card-compat` 的时序偶发（如实记录，别当成回归）**：本轮这一条跑了 7 次，after 数字是
`46/0 · 46/0 · 44/2 · 44/2 · 44/2 · 45/1 · 46/0`（0~2 条波动）。红的两条一直是同两条：
⑧b（隐藏收件箱 `#send_textarea` 还没装上）与 ⑩g（宿主推来的 `mag_variable_update_ended` 还没被吸收）
—— 都是"探针比被观察的动作先跑"。
**HEAD 对照归因**：把**未含本轮改动的 `git show HEAD:lib/client.js`** 拿来跑**同一个门禁、同一个时段**，
after 同样是 `44/2 · 45/1`（也是 ⑧b / ⑩g）⇒ **与本轮改动无关**，是环境时序。
另做了一次定点剔除：去掉本轮新加的 YAML 注入后仍是 `44/2`（同样两条）⇒ 也不是 YAML 带来的。
**没有**为了变绿去改这两条断言（⑩g 的语义就是"**同步**读立刻拿到新值"，给它加等待等于把判据废掉）。

**对照臂真的变红了（两个都做了，"去掉就红"逐条成立）**：

1. **门禁内的因果臂**：E 臂（全量注入但**只摘掉 yaml 那一标签**）⇒ `window.YAML`/`YAML.parse`
   全 false 而 `_`/`z`/jQuery 都在；F 臂（**把源码里那两道过滤逐字摘掉**再提取同一个真函数）
   ⇒ 同一条 `./index.js` 被注入、标签数 3 → 7。F 臂还先断言"源码真的被摘动了"，
   摘不动就自己变红，不会退化成假对照。
2. **变异实验（改代码本身）**：临时去掉 YAML 注入 ⇒ `verify-card-libs` 红 **7** 条
   （其中 4 条是 YAML 断言，`typeof window.YAML` 实测 `undefined`）；临时去掉相对地址过滤 ⇒
   `verify-tavernhelper-scripts` 红 **4** 条（"相对地址那条没有进文档"等）。两次都恢复并核对
   `md5` 一致后重跑，全绿。

### 6. 第 3 条报错的定位（本轮**不改**，如实记录）

`Cannot read properties of undefined (reading 'object')` **与 YAML 无关**（不同错误类；
`ReferenceError` 不会变形成 `TypeError`）。位置级吻合的真因：

```
StageDog/tavern_resource → dist/酒馆助手/自动更新角色卡/index.js（2,744 字节，单行压缩）
  const n=z, r=n.z.object({角色卡名称:n.z.string(), …})
                      ↑ 偏移 367 ⇒ 正好是报错里的 index.js:1:372
```

`n = z`（我们的全局）⇒ `n.z` 是 **undefined**（我们落位的是 `MUVZ.z` 这个**子对象**，
它没有 `.z`）⇒ `undefined.object` 抛 TypeError。ST 那边给的是**整包命名空间**
（`uk = bn({$brand,…,ZodAny,…})`，既有 `z.object` 也有 `z.z`），所以两种写法都通吃。
同类第二处：`tavern_resource/dist/util/mvu_zod.js:553` 的 `r.z.object({stat_data:e})`。

**改法一个字**：落位改成命名空间 `MUVZ`（实测 jsdelivr `zod@4.4.3/+esm` 的导出表里
`mo as object` 与 `Os as z` **都在**，两形态都通吃，与 ST 形状一致）。本轮**故意没动** §31
已验证的 `z` 行为 —— 改它要配自己的因果臂，见 `HANDOFF §32.7`（下一轮第一顺位）。

## 未发布（2026-09-23 · 三十一）★★ 卡 iframe 补齐 ST `predefine.js` 的全局：lodash / zod · `2026-09-22r`

### 为什么（上一轮留下的第一顺位）
§30 让卡脚本真的跑起来了，但魔女卡的棕色 MVU 状态栏（HUD）**还是不出**，并在 §30.8 如实记了
下一条嫌疑：卡脚本普遍裸引用全局 **`_` (lodash)**，ST 由 `predefine.js` 提供，我们的不透明来源
拿不到。本轮把这条**做掉了**，而且拿到了直接证据（见下面「端到端实证」）。

### ST 侧取证（只读源码，逐条列，不是类比）
出处：`SillyTavern/public/scripts/extensions/third-party/JS-Slash-Runner/`

| 注入物 | ST 侧证据（文件:符号） | 我们 |
|---|---|---|
| `_` (lodash) | `src/iframe/predefine.js:1` `window._ = window.parent._;`；版本 = `SillyTavern/node_modules/lodash/package.json` 的 `"version": "4.18.1"`；同文件 `:11-19` 整段用 `_.merge/_.pick/_.omit/_.get/_.set` 装配 `TavernHelper`（⇒ 没有 `_` 时 predefine 自己第一步就抛）；`src/iframe/adjust_iframe_height.js:26` `_.throttle(measureAndPost, 500)` | **本轮补** |
| `z` (zod) | `src/iframe/predefine.js:12` `_.pick(window.parent, ['EjsTemplate','TavernHelper','YAML','showdown','toastr','z'])`；版本 = `JS-Slash-Runner/package.json:89` `"zod": "^4.4.3"` | **本轮补** |
| `$` / `jQuery` | `src/iframe/parent_jquery.js:1-2`（`_1` 那个 blob URL） | 已有（CDN jQuery 3.7.1） |
| Tailwind / jQuery-UI / Vue / Vue-Router / FontAwesome | `b1()` 的 `${v1}`（`dist/index.js` ~853393） | 已有（§24） |
| `SillyTavern` / `TavernHelper` / `Mvu` / `toastr` / 事件总线 / `getTavernHelperVersion` | `predefine.js:11-44` + `dist/index.js` 的 `_bind` 表 | 已有（§30） |
| `waitGlobalInitialized` | `dist/index.js` 的 `_bind` 表里是 `_waitGlobalInitialized`，`predefine.js:14-18` 用 `key.replace('_','')` 去掉前导下划线后 `bind(window)` | **本轮补** |
| `EjsTemplate` / `YAML` / `showdown` | 同一条 `predefine.js:12` | **故意不补**（见下） |

### 卡侧取证（2026-09-23，从真卡 PNG tEXt `chara`（base64）里的 `data.extensions.tavern_helper.scripts` 逐条 grep）
| 全局 | 卡里裸引用 | 出处 |
|---|---|---|
| `_` | **151 处** | 星辉MVU核心 74 · 状态栏/NPC控制台各 1 · …（§30 记的"110 处"是另一种统计口径） |
| `z` | **143 处** | 单条脚本「8.2·星辉zod·等级能力一致性与比例数值」，且它 `import { registerMvuSchema }` 却**从不 import `z`** |
| `waitGlobalInitialized` | 8 处（**探测式**：`typeof … === 'function'` 自带兜底） | 星辉MVU核心 3 · 事件推进器 2 · … |
| `EjsTemplate` / `YAML` / `showdown` | **0 处** | —— |

### 改了什么
- **`lib/client.js` · `muvCardLibTags()`**：
  - **lodash 4.18.1 三段**（经典 `script src`）：`dash-save`（把已存在的 `_` 存进 `__muvDashPrev`）
    → `lodash@4.18.1/lodash.min.js` → `dash-keep`（当初存过就**还原**，用完即删标记）。
    ★ 为什么不能只写一个 `<script src>`：lodash 的 UMD 收尾是**无条件** `root._ = lodash`，
    而需求是"**只在缺失时补**"。三段是纯 HTML 层实现该语义的唯一办法；卡在 `<body>` 里的
    赋值天然晚于注入点，所以卡的写法照旧赢。
  - **zod 4.4.3 走 `<script type="module">`**：实测 zod 的 npm 包里**没有 UMD/IIFE 构建**
    （`dist/zod.umd.js`、`dist/index.umd.js` 全 404），只有 jsdelivr 现打的 `+esm`（328,955 字节）。
    用 `import * as` + 三形态兜底挂 `window.z`，且**只在缺失时**落位。
    顺序仍成立：module 天然 defer，而它在 `<head>` 里、卡脚本在 `</body>` 之前。
  - 两条都**共用 `MUV_CARD_LIBS` 这一个开关**、同一个注入点（`</head>` 之前）、同样钉版本。
- **`lib/client.js` · `muvCardCompatScript()`**：补 `waitGlobalInitialized`（对已就位的全局
  **立刻 resolve** —— 我们的 `Mvu` 是同步就位，所以这是语义正确而不是假装；取不到名字时
  **不 reject**，最多轮询 2 秒后 resolve undefined，卡的 `.then` 不该因我们掉进 catch）。
- **`MUV_BUILD` → `2026-09-22r`**（卡 iframe 的库注入变了，构建标记必须能区分）。
- **没动**：变量管线语义、高度逻辑、装饰器守卫、`MUV_CARD_SCRIPTS` 注入逻辑本身。

### 刻意**不补**的三个（写在这里，免得后来人"顺手加上"）
`EjsTemplate` / `YAML` / `showdown` —— ST 的 `predefine.js:12` 确实注入了它们，但**卡侧实测
0 处引用**。它们分别是要宿主配合才跑得起来的 EJS 渲染 / yaml 解析 / markdown 渲染；
给个空壳会让卡以为"渲染成功了"从而写错数据，**比缺一个全局更坏**。真遇到依赖它们的卡再照
ST 补 —— 补之前先按上面的格式取证（ST 证据 + 卡侧证据，两条腿都要有）。

### 端到端实证（新 `verify-card-lodash-bundle.mjs`，真 bundle）
把卡里那行 `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'`
真的 import 进真沙箱 iframe，两臂对照：
- **Q 臂（只摘掉 lodash 三段）**：`window.__muvScriptErrs` = `["（未知脚本） | Uncaught ReferenceError: _ is not defined"]`
  ⇒ **§30.8 的第一顺位嫌疑被证实**：缺 `_` 就是 bundle 当场炸的直接原因。
- **P 臂（库齐全）**：`_` 是 function、`z` 可用、`Mvu/TavernHelper/getTavernHelperVersion/waitGlobalInitialized`
  全在，错误列表里**没有** `_ is not defined`。
  ★ 如实记录：P 臂仍会留一条 `（未知脚本） | Script error.` —— 那是 CDN 脚本**跨源**、
  浏览器屏蔽了细节，**不代表失败**；判据盯的是具名 ReferenceError。

### 门禁（全绿，数字）
| 门禁 | 结果 |
|---|---|
| `verify-card-libs.mjs`（**扩到四臂**） | **37 / 0** |
| `verify-card-lodash-bundle.mjs`（新，真 bundle 端到端） | **11 / 0** |
| `verify-tavernhelper-scripts.mjs` | **35 / 0** |
| `test-client-render.mjs` | **308 / 0**（[20] 段扩到 8 个库 + 三段顺序 + 两个对照臂；[16] 段加垫片清单） |
| `test-era-vars.mjs` | 全部通过（真聊天文件不在 ⇒ SKIP） |
| `verify-card-compat.mjs --old-export` | after **46 / 0** · before 红 **37**（对照成立 ⇒ 绿灯） |

`verify-card-libs.mjs` 的四臂是这轮新增的对照设计：**A** 全量 / **B** 完全不注入 /
**C** 注入全部但**只摘掉 lodash 三段** / **D** 注入全部但**只摘掉 zod 那一标签**。
没有 C/D 时，A 与 B 之间差着**十个标签**，"`_` 是 lodash 带来的"就证明不了（§24 差点吃过的亏）。
实测：C 臂 `typeof _ === "undefined"` 而 zod 全在；D 臂 `z.object` 不可用而 `_` 在。
另：失败时会**再做一次 node 侧直连**把「网络不可达」与「注入缺失」分开报。

两条被这轮门禁抓出来的**判据缺陷**（都已修，写下来备忘）：
- `extractFunction` 的提取物**包含函数体内的 `//` 注释** ⇒ 拿源码断言"不含反引号"会把注释里的
  `` `_` `` 判成违规。现在：`</script>` 看**源码**（不许有字面量），反引号看**运行时产物**。
- 自己写的正则 `^<script data-muv-libs="lodash" src="` 配 `tags.slice(iDash)` 永远不匹配
  （`iDash` 落在属性名处、不在 `<script` 处）—— 判据要盯"那个 URL 是外链而不是内联"。

### 只能真机验的部分（重要）
1. **`lib/client.js` 改动硬刷新即可生效**（不需要重启 DSH 服务端 —— 本轮没动服务端路由）。
2. 硬刷新后看三件事：
   - 控制台 `[muv-engine] client loaded 2026-09-22r`（构建标记对不对）；
   - 封面下面那条**棕色 HUD** 出没出；
   - 有没有 `[muv-engine] 卡脚本报错：…`，或进卡 iframe 读 `window.__muvScriptErrs`。
3. **HUD 仍不出时**按 `docs/04-排错手册.md` §L 的顺序排：先确认标记 ≥ `2026-09-22r`，
   再看 `__muvScriptErrs` 里有没有具名 ReferenceError（`Script error.` 那条**不算**），
   然后才是"框架启用开关"那条已知缺口。
4. 真机上**没验过**的：zod 的 `+esm` 在本机网络下的加载耗时（328 KB，module 会推迟卡脚本的
   **开始**但不会让谁失败）；以及 bundle `_.set(window.parent,'Mvu',…)` 的跨源抛错是否被它自己的
   `Promise.allSettled` 兜住。

## 未发布（2026-09-23 · 三十）★★ 卡脚本运行时：把角色卡的 TavernHelper 脚本真的跑起来 · `2026-09-22q`

### 为什么（用户实测缺口）
魔女卡（魔法少女MVU测试）的契约书封面在 DSH 已渲染成功，但 ST 里封面下面那条**棕色状态栏
（MVU 的 Status Hud）**没有。取证结论：那块 HUD **不是**卡的正则产物 —— 那两条消费
`<StatusPlaceHolderImpl/>` 的正则 `replaceString` 是**空串**（只负责把占位符删掉），
真正画它的是卡的 TavernHelper 脚本：

```
data.extensions.tavern_helper.scripts[0]
  content = import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'
```

ST 里「酒馆助手」插件执行卡里 enabled 的脚本 ⇒ bundle 起来 ⇒ HUD 出现。我们此前**一条都不
执行** ⇒ bundle 不跑 ⇒ HUD 恒空。与沙箱、正则、替换串那几类是**并列**的独立原因。

### 卡脚本的真实结构（2026-09-23 从 PNG 的 tEXt 'chara' chunk 实测）
路径 `<卡 JSON>.data.extensions.tavern_helper.scripts[]`，元素
`{type, enabled, name, id, content, info, button, data, export_with}`。

| 卡 | 条数 | enabled | 形态 |
|---|---|---|---|
| 魔法少女MVU测试 | 8 | **6**（下标 0/1/2/4/6/7） | 混合：1 条纯 import（97 字符）、1 条 `import { registerMvuSchema }` + 逻辑、4 条 85~186 KB 的 IIFE |
| _足控天堂2 | 3 | **3** | 清一色单行 `import 'https://…'`（含 148 KB 的 ERA 变量框架） |

### 改了什么
- **新 `lib/card-scripts.js`（服务端）**：按同一套口径自己定位卡（预设托管 `muv-tables/card.json`
  → 预设内 PNG → 外部卡库含 ST 的 characters 目录，先按文件名预判、不中再限量 20 张按内容），
  只回 **enabled** 的 `{name, id, content}`；结果按卡缓存（LRU 16）。
  `presetDir`/`cardName` 一律消毒后才允许进 `path.join`。
- **新路由 `GET /api/muv-engine/card-scripts?cardName=…&presetDir=…`**：
  回 `{ok, scripts, total, enabled, source, fileName, reason}`；找不到卡是 `scripts:[]` + reason
  （**不是** HTTP 错误 —— 没有脚本是卡的正常形态）。
- **`lib/client.js`**：新开关 `MUV_CARD_SCRIPTS`（默认**开**）；`withCardScripts` 把每条脚本各包一个
  `<script type="module">` 插在最后一个 `</body>` 之前（module 天然 defer ⇒ 一定跑在 compat 垫片 /
  reset / 前端库 / 引导脚本之后）；`_decorateOne` 在取卡后 `await` 取回清单（每卡一次网络）。
  **只对卡 iframe**（`muvInjectDoc` 这一条链，DSH 自己的 iframe 不经过）。
- **错误留痕**：module 的 import 失败不会被任何 `try` 接到 —— 注入一段**捕获阶段**的
  `window.addEventListener('error', …)`，除 `console.warn('[muv-engine] 卡脚本报错：'+name, msg)`
  外还攒进 `window.__muvScriptErrs`（≤20 条），门禁与真机排障可直接读。
  留痕有**三个入口**：`<script>` 元素上的加载失败（报得出脚本名）/ 运行时报错（ErrorEvent）/
  **`unhandledrejection`** —— 最后一个不能省：module 的**顶层 await 被拒**不走 error 事件
  （MVU bundle 入口第一行就是 `await checkVersion(...)`，缺了它"框架没起来"完全无声）。
- **事件桥核定**（只补缺口，不重构）：宿主侧本来就 emit `era:queryResult` / `mag_variable_update_ended`
  （`muvEraPushNow` / `muvMvuReply`）；卡侧 `eventEmit` 反向发事件时，`__muvEventOut` 对非 ERA 名字
  是"不回值"而不是报错（卡内 `fire()` 已经派发过，卡内监听者照旧收到）。补两处真实缺口：
  ① `Mvu.events` 的名字符合 MVU 真 bundle 常量表（原先 `BEFORE_MESSAGE_UPDATE` 是
  `mag_variable_update_before` —— 一个谁都不会发射的值，且缺三个成员）；
  ② 新增 `getTavernHelperVersion()`（MVU bundle 入口的第一个 `await` 就是它，缺了 ⇒ 那个
  async IIFE 当场拒 ⇒ 后面一行都跑不到）与 `toastr`（控制台版，卡 iframe 里没有那套 DOM）。
- `MUV_BUILD` → `2026-09-22q`。

### 安全口径
执行的脚本来自**用户自己导入的卡**（与 ST 同一信任级别）；沙箱仍是 `allow-scripts`
（**没有** allow-same-origin）⇒ 摸不到 DSH 页面 DOM、`localStorage` 是垫片给的内存实现。
额外两道：内容里带 script 收尾标记的条目**跳过**（内联会截断 srcdoc）；条数/体积在服务端封顶。

### 门禁（全绿）
`verify-tavernhelper-scripts.mjs`（新，**35/0**）：真卡 8→6 条 enabled / 同名旧版那张被剔除 /
端到端 disabled 进不到注入串 / 一条一签 · 顺序 · 幂等 / 开关关掉逐字不动；真浏览器三臂
（A 注入：`__probeA` 被写、`import` 挂的那条自己没跑、失败留痕说到脚本名；B 不注入、C 开关关
⇒ `__probeA` 恒为 undefined）。
`test-client-render.mjs` **293/0**（新增 [23] 段）· `verify-guard-tag-agnostic.mjs` **78/0** ·
`test-era-vars.mjs` 全部通过 · `verify-card-compat.mjs --old-export` after **46/0** / before 红 37
（对照成立）· `verify-frame-height.mjs` 全部通过。

### 只能真机验的部分（重要）
- **服务端新路由要重启 DSH 才生效**（`lib/index.js` 是新文件 + 新路由，Node 模块缓存）。
- 重启后看：控制台 `[muv] 卡脚本「魔法少女MVU测试」：注入 6 条 / 卡里共 8 条（来源 library …）`；
  状态栏 HUD 是否出现；有没有 `[muv-engine] 卡脚本报错：…`。
- **已知仍缺（下一轮）**：卡脚本普遍用全局 **`_` (lodash)**（星辉 MVU 核心 110 处、状态栏 26 处），
  ST 由 `predefine.js` 的 `window._ = window.parent._` 提供，我们的不透明来源拿不到；本轮按
  "不许动 `MUV_CARD_LIBS` 行为"的硬约束没有往库注入里加 lodash —— **这很可能就是 HUD 仍然不出的
  下一个原因**。另外 MVU 框架本体的 `should_enable` 依赖酒馆助手的脚本启用态
  （`getScriptId` / `listenPreferenceState`），我们没有等价物，未伪造。

## 未发布（2026-09-22 · 十八）★★ 帧高对「媒体延迟加载」的塌陷修复 · `2026-09-22p`

### 为什么（用户实测）
足控天堂2 的「主页」（图片墙 + 2 分钟视频 + 可交互小手机 UI）在 ST 里首楼完整一大片，
在 DSH 里同样的 iframe **被压成细长一条**。嫌疑集中在高度自适应对「媒体未加载完时初始
高度很小、媒体元数据到位后暴涨」处理不足。

### 取证（真卡 + 真 Edge + 真 cardHtmlIframe 链路，详见 HANDOFF §29）
- **上限 / 棘轮扩张方向 / 滞回语义全部无辜**：真卡「主页」在忠实夹具里稳定收敛
  1636~2056px（宽 640/760/900/1180 四档实测），报回 ~10 次、单调上升、未被 12000 夹取。
- **真卡的媒体盒全部"预留尺寸"**（`.polaroid{aspect-ratio}` + `img{position:absolute;inset:0}`、
  `.hero-photo{height:340px}`）：媒体加载前后包围盒几乎不变 —— 单纯"媒体慢"不足以解释塌陷。
- **找到确切缺陷**：引导脚本的重测触发器只有 load / DOMContentLoaded / RO(documentElement) /
  700·1600ms / 四次补量（10.9s 止）。**媒体事件从不触发重测**，而 RO 只看**盒子**（边框盒）
  变化 —— 媒体引起的**包围盒**变化可以完全不改变任何盒子：
  ① 媒体元素 `position:absolute`（真卡画廊正是如此）：媒体到位只改自己的盒子，html/body
     纹丝不动 ⇒ RO 一次不 fire，`extent()` 却实实在在变大；
  ② 卡 JS 在 load 后才插媒体进 DOM（真卡画廊运行时拼装）：固定补量停了，之后没有任何触发器。
  两者叠加「早测量落在小包围盒 + 晚增长无人上报」⇒ 帧高被锁在小值 = 用户看到的细长一条。

### 修复（`lib/client.js` · `muvFrameBootstrap`，保守小改）
- img 的 `load`/`error`、video 的 `loadedmetadata`/`loadeddata`/`durationchange` → `s()`
  （150ms 去抖重测；error 也算——404 的图塌成 0 高同样要重量）。
- 卡运行时**新插入**的媒体由 MutationObserver 兜底补挂事件（只挂事件、不额外测量）。
- **不动**：收缩方向滞回（孩子侧 24px×3 次 + 父侧 8px 死区）、12000 上限、装饰器守卫、
  变量管线、`MUV_CARD_LIBS`。`MUV_BUILD` → `2026-09-22p`。

### 门禁（全绿）
- `verify-frame-height.mjs` 新增第 7 节（**8 PASS / 0 FAIL**）：
  A 流内 img src 延迟 300ms → 824→**1200** 到位；B 判别臂（绝对定位 img + src 在 **11.5s**
  即全部补量结束之后）→ 1524→**1900**，修复前无任何触发器能救；
  ★★★ 变异臂（砍掉媒体挂接 `mw`）判别臂**必红**（实测卡在 1524）——判据不是空转。
  ⚠ 300ms 臂的 src 由**子文档侧** setTimeout 设置：父→子 postMessage 在 300ms 时会丢
  （srcdoc 文档未就绪），实测恒报 824。
- `verify-frame-ratchet.mjs` 全部通过 · `test-client-render.mjs` **275/0** ·
  `verify-decorate-dom.mjs` 全部通过 · `test-era-vars.mjs` **17 PASS/0**（真聊天文件不在，SKIP）
  · `verify-guard-tag-agnostic.mjs` **78/0**。

### 只能真机验的部分
- 塌陷在忠实夹具里**未能复现**（收敛正常）；修的是与症状机制吻合的确切缺口（媒体事件
  重报缺失），最终效果需重启 DSH + 硬刷新后在真机看「主页」是否恢复完整高度（构建号 `2026-09-22p`）。
- 若真机仍细长一条，下一步取证方向：DSH 宿主容器对 iframe 的外部 CSS 约束
  （本轮尝试持签名 Cookie 只读挂 127.0.0.1:3080 取证未成——鉴权被拒，脚本已留 `.tmp-hfix-live*.mjs`）。

## 未发布（2026-09-22 · 十七）★★ 用户消息桥 send 通道加固：多通道 + 真变红门禁 · `2026-09-22o`

### 为什么
卡里（如「足控天堂2」）`#playerInput`/`#castBtn` 走 `sendUserMessage(msg)` → postMessage → 宿主
`muvDeliverUserText(text,'send')` 代发。旧实现 send 段只派一个 `keydown{key:'Enter'}`（keyCode/which=0）。
**用户实测：卡里提交后 DSH 没生成下文**。引擎层桥路已验证畅通（垫片在、postMessage 在、textarea 能找到），
嫌疑集中在最后一步「合成 Enter 能否真触发 DSH 发送」。

### 取证（只读 DSH 本体 `@deepseek-ai/dsh` v0.1.5-rc.2 的 web-frontend bundle）
- DSH 聊天界面是 **React 应用**；发送绑定在「发送按钮」（`IconSendOutline` 图标，onClick / onKeyDown
  Enter·Space → 发送）与「输入框 onKeyDown(Enter)」两处。
- 全链路**无 `e.isTrusted` 校验**（bundle 里 `isTrusted:0` 是 React SyntheticEvent 默认字段，非守卫）
  ⇒ 合成事件可被接受。
- **无 window 级可编程发送入口**（仅 `window.__ModuleLoader__` 内部加载器）。
- React 的 `getEventKey` 把 `keyCode 13 → "Enter"`；若处理器读 `keyCode`/`which`（常见），只带
  `key:'Enter'` 的合成事件静默落空 —— 这是旧实现失效的头号嫌疑。

### 加固（`lib/client.js` · `muvDeliverUserText` + 新增 `muvUserSendFire`）
- **通道①** 真实 `click()` 发送按钮：从输入框向上爬父链（≤6 层）收集 button，优先带 `发送/Send/submit`
  字样者，否则末位可见且未禁用 button；命中即 `click()` 直接调其发送回调（不吃事件形态，最稳）。
- **通道②** 完整键盘序列 `keydown+keypress+keyup`，`keyCode:13 / which:13 / code:'Enter' / key:'Enter'`
  全带上（keyCode/which 用 `Object.defineProperty` getter 兜底），覆盖读 keyCode 的处理器。
- 每通道 `console.info('[muv-engine] 用户消息桥：…')` 留痕；**绝不清空输入框**（宁可字留在框里让用户手动按）。
- 填值路径（原生 setter + input 事件 + focus）保持不变（已验证工作）。
- `MUV_BUILD` → `2026-09-22o`。

### 门禁（全绿）
- 新 `verify-user-send.mjs` **6/0**：真 Edge + 真 DOM + 从 client.js 逐字提取的 `muvDeliverUserText`
  /`muvUserSendFire`；假 DSH 输入框（`data-muv-macro-hooked`）+ 发送按钮 + iframe 调 `sendUserMessage`；
  场景①有按钮命中通道①、场景②无按钮命中通道②；含 `--break=send-channel` **真变红对照臂**（砍掉发送通道后
  B/D 断言必红、exit≠0）。
- `test-client-render.mjs` [16] 断言改为「多通道矩阵」（含 `muvUserSendFire` + `.click()` + `keyCode:13`，
  且断言不清空输入框）→ 275/0。
- `test-era-vars.mjs` 全通过 · `verify-guard-tag-agnostic.mjs` 78/0 · `test-global-regex.mjs` 50/0。

### 只能真机验的部分
- DSH 真实聊天框的发送按钮选择器形态（aria-label 是中文「发送」还是英文「Send」、图标类名）需真机确认；
  多通道设计对两种都兼容，但通道①日志会显示命中了哪个 button。
- 合成 Enter 在**真机 DSH**是否稳定触发「生成下文」，取决于 DSH 当时是否把输入框标成受控组件已就绪
  （60ms 延时即为此留）；极端情况仍可能需用户手动按一下（字已填好、未吞）。

## 未发布（2026-09-22 · 十六）★★ 全局正则扩展库：ST 全局脚本层补齐 · `2026-09-22n`

### 为什么
引擎的正则管道已是 ST 形态（findRegex/replaceString、placement、markdownOnly/promptOnly、depth），
但此前**只吃卡级脚本**（`card.data.extensions.regex_scripts`）。ST 生态还有一层**全局正则扩展**
——用户装的、独立于卡的美化/净化脚本（"去星号注释"、全局排版美化等）——我们没有这一层，
用户装过的全局脚本全部失效。

### 新增（`lib/global-regex.js` + `lib/index.js` 三路由）
- **存储**：引擎第一个落盘数据。`<引擎包根>/data/global-regex.json`（可 `MUV_ENGINE_DATA_DIR`
  覆盖；`data/` 已进 .gitignore），格式 `{ version:1, savedAt, scripts:[…] }`，临时文件 + rename 原子写；
  损坏按空库处理但 stderr 喊出声。
- **API**（口径详见路由注释与 HANDOFF §28）：
  - `GET  /api/muv-engine/global-regex` → `{ ok, scripts:[…] }`
  - `POST /api/muv-engine/global-regex` → 导入。body 宽容解析**四种**形态（裸数组 /
    `{scripts}` / `{data.extensions.regex_scripts}` / 外包 `{compatibility}`）；
    按 `scriptName+findRegex` 逐字去重：默认 upsert 覆盖为新版（原位原 id），
    `?mode=append` 同名跳过；返回 `{ ok, added, replaced, skipped, invalid, total, reasons }`。
  - `DELETE /api/muv-engine/global-regex?id=…` 或 `POST {action:'delete', id}`（等价）。
- **校验纪律**：findRegex 必须 `new RegExp()` 可编译（`/…/flags` 壳或裸模式，与
  `applyRegexScript` 同口径），坏条目**跳过并计数**（invalid + reasons），不抛、不整批失败。
- **容量纪律**：库上限 200 条——将超限时**整批拒绝**（400 capacity-exceeded）；
  单条 findRegex/replaceString 各 256KB，超限条目跳过计数。
- **合并进管道**：`apply-regex-card` 生效脚本集 = **全局（先）+ 卡级（后）**，顺序即优先级
  （卡级更具体，后跑作用在全局产出上）。全局脚本走同一条 `applyAllRegexScripts` 管道，
  disabled / placement / depth 过滤**全部复用**（`matchesMode`），未改其签名与行为。
  `statusBarHtml` 仍只从**卡级**提取（`<StatusPlaceHolderImpl/>` 是卡的契约，保守选择）。
- `id` 确定性：`gr_` + sha1(scriptName+findRegex) 前 12 位，重导/重装 id 稳定。

### 门禁（全绿）
- 新 `test-global-regex.mjs` **35 通过 / 0 失败**：四种导入形态 / 去重统计（upsert+append）/
  非法 findRegex 跳过计数 / **合并顺序含真变红对照臂**（链式用例 全局'A'→'B' + 卡级'B'→'C'：
  合并序 'C'，颠倒序 'B'，两序可分）/ disabled 不跑 / promptOnly·minDepth 过滤复用 /
  API 形状（GET·POST·DELETE·405·404·400）/ 容量两档（256KB 跳过计数、201 条整批拒）/
  apply-regex-card API 层合并。
- `test-regex-engine.mjs` 26/0 · `test-client-render.mjs` 275/0 · `test-era-vars.mjs` 18 PASS/0 ·
  `test-snapshots.mjs` 14 PASS/0 · `verify-guard-tag-agnostic.mjs` 78/0 · `verify-no-redouble.mjs` 4/0。

## 未发布（2026-09-22 · 十五）★★ 守卫第三次漏：占位符 greeting（纯文本 first_mes）放行 · `2026-09-22m`

### 为什么（症状与机制）
社区卡大量使用「**占位符 greeting**」模式：`first_mes` 只是短占位文本（魔女卡的 7 字
「星盟契约开场白」、`_足控天堂2` 的「【主页】」），靠卡的 `markdownOnly` 显示层正则把它换成
```` ```html ```` 包裹的整页 HTML（「星盟契约 · 缔约书」界面）。ST 的首楼因此渲染出完整卡 UI；
而 `beautifyMuv` 的守卫只认 HTML 标签 ⇒ **纯文本占位符在取卡之前就被整楼跳过**，
greeting 楼的正则替换从未发生 —— 用户实测：魔女卡在 DSH 首楼只有正文+插图，没有契约书界面。

### 修法（最小改动，`lib/client.js`）
- 守卫从单行变小块：不含 HTML 标签、但去首尾空白后 **≤ 300 字符**的文本也放行去取卡
  （空白文本不放行）；**没有**退化成"所有文本都取卡"。
- 无副作用依据：脚本全部落空时既有兜底 `normalized === text ⇒ 原样交回 ⇒ 调用方不动 DOM`。
- 性能依据：长散文（模型正文主力）不付取卡成本；一条 greeting 楼多一次取卡，
  换它"本来就要整页渲染"的收益。
- 顺带修正守卫注释：原注释赌的「没有只带 `【主页】` 的一轮」已被占位符 greeting 推翻（第三次漏）。

### ```html 围栏 → iframe：确认已支持（不重复造）
`renderFencedHtml` 的围栏配对（`info` 合法信息串 + 围栏体以 `<!DOCTYPE`/`<html` 开头）
本来就认 ```` ```html ````/``` 包裹的整页文档并走 `cardHtmlIframe`；真卡「主页」的
replaceString（``` + 整页）与「正文美化」（```html + 整页）都在此路径上。
本轮补钉两条单元判据：```html+<!DOCTYPE → iframe；```html 普通代码示例（无文档形状）原样不动。

### 门禁
- `verify-guard-tag-agnostic.mjs`：提取器改按**守卫块**工作；新增 ②b 决策臂
  （占位符 greeting 放行 / 301 字长散文与纯空白不放行 / 旧决策对照臂）与 **B7**（G 用例
  「【主页】」：AFTER 取卡 + 卡 [0] 命中 + 产出 iframe；BEFORE 全 0）。**78 通过 / 0 失败**。
  同时按当前真实行为更新 B1/B2/B6（漂移归因：HEAD 上旧断言已红 —— `withStatusPlaceholder`
  占位符补齐加入后 A 楼会被卡 [2] 消费出 ERA iframe，旧的「DOM 不变」判据过时），
  apply 归属从字数 ±6 改为**期望长度最近邻**（占位符 +25 / 表头折叠 −151 把字数容差打死了）。
- `test-client-render.mjs` **275 通过 / 0 失败**（新增 [22] 守卫短文本段 + 围栏两例）。
- `verify-decorate-dom.mjs` 八类全过；`verify-no-redouble.mjs` 4/0；
  `test-regex-engine.mjs` 26/0；`test-era-vars.mjs`、`test-snapshots.mjs` 全过。
- `verify-card-compat.mjs`：对照臂原提交 `324b751` 已随 git 事故丢失，`OLD_REV` 改为
  现存最老的 v0.3.9 提交 `7623ffa`（可 `MUV_OLD_REV` 覆盖；before 臂 9 通过 / **37 失败 = 必须红** ✓）。
  after 臂 2~4 条波动失败，HEAD 源码对照同样红 ⇒ 按 §26.1 口径归因**环境时序偶发**，与本轮无关。

## 未发布（2026-09-22 · 十四）★★ 按楼快照/时间旅行 + ★★ git 对象库事故与恢复（`41c21d8`）

### 按楼快照（时间旅行的数据底座）
- `var-tracker.js`：`applyVariableMessage` 在**带键消息应用后**取样 —— `recordSnapshot` 存完整变量树
  （每会话 **200** 条上限，按键内毫秒时间戳 `era_mk_<epochms>_<rand>` 淘汰最旧；单条超 **200KB** 只存占位
  `{key, at, data:null}`，复用单消息口径）。树经 JSON 往返成**独立副本**，杜绝与账本/状态树别名共享。
- `stateAsOfEpoch` **定向重放**：快照取"键序 ≤ 该楼"的树 —— 乱序晚到的消息不会把"未来"数值掺进旧楼快照
  （比"到达即取样"更精确；unkeyed op 无楼层归属，不参与楼层快照）。
- `GET /api/muv-engine/state` 扩两个口径（**无参形状不变**）：
  - `?snapshots=1` → `{ ok, snapshots:[{key, at, data|null}] }`（按取样时间正序）；
  - `?messageKey=era_mk_…` → 与普通 GET 完全同形状（`state.data`=该楼树），键不存在 → 404 `{ok:false, error:'snapshot-not-found'}`。
- ⚠ 快照是**会话级内存态**：随会话 LRU 淘汰、重启即失（与状态容器同一命运，未引入新存储）。
- 测试：`test-snapshots.mjs` **28 项全过**；门禁 era-vars / client-render / regex-engine / era-bridge(after) /
  no-redouble / audio-fallback 全绿；`verify-card-compat` 偶发失败经 3 次重跑 + HEAD 对照确认与本次改动无关
  （失败数 1/0/3 波动，全落在 iframe 垫片域，时序敏感）。

### ⚠ git 对象库事故与恢复
- 9-22 晚 `git stash` 被环境 SIGTERM 打断，`.git/objects` 几乎全灭（剩 1 个 blob + 无 `.pack` 本体的 idx），
  `refs/` 整个目录消失 —— v0.3.9 之后的所有提交对象（`26d87c0` 卡库注入、`f3dadd0` 源码块隐藏、
  `2d3d82a` 变量内核、`167d55e` 文档等）**不可找回**。
- 从 `muv-release3` 发布副本（9-20 11:15，v0.3.9）恢复对象库与历史；其上以一个提交
  （`41c21d8`）收编 9-20~9-22 的全部工作区成果 —— **代码零丢失**，丢的只是中间提交粒度。
- 教训：本环境 git 写操作可能被 SIGTERM 打断并连带吞掉 objects/refs；重要提交尽快 push，
  发版副本（Temp/muv-release*）是最后的救命稻草 —— **不要清 Temp 里的 muv-release\***。

## 未发布（2026-09-22 · 十三）★★ 变量内核四项打通：命令式 `_.set`/`_.add`、`stat_data` 归一、`TavernHelper`/`Mvu` 垫片、新值回推在线帧

### 为什么（症状）
新导入的 MVU 卡（`stat_data × 105`、`Mvu. × 53`、`_.set( × 39`、`getVariables( × 17`）在 DSH 里
**界面渲染出来、但一个数字都不动、按钮点了没反应、控制台无异常无请求**。
四个独立原因各占一份：命令式写没进解析器、`stat_data` 路径对不上、
卡要的宿主 API（`TavernHelper`/`Mvu`）我们一个都没提供、回灌后在线卡帧仍停在加载时那次查询的旧值。

### ① 命令式写入（`lib/var-tracker.js`，新增 `parseCommandOps`）
- 认 `_.set('a.b.c', 值)` / `_.add('a.b', 数字)`，值支持数字 / 字符串 / 布尔 / `null` /
  JSON 对象数组字面量（含转义与 `\uXXXX`）；
- **不认**卡自带的 lodash 形态 `_.set(对象, 路径数组, 值)`（首参不是字符串字面量）——
  计入 `bad`，不猜、不抛，同一条消息里的好调用照常生效；
- 前缀必须是**非标识符字符**（`foo_.set(` 不认），否则会把 `xxx_.set(` 误当成命令式写；
- 值是变量引用（`_.set('a', someVar)`）**判失败**：服务端不求值，猜就是编数据；
- `_.add` 的增量非数字字面量同样判失败（不拼字符串）。
- **顺序与既有 ERA 增量块共用同一个 ops 序列**：先收两条来源的全部 op，再按**文本先后**排序
  统一重放。有消息键 ⇒ 走既有键序重放（乱序送达结果一致、重复送达幂等）；无键 ⇒ 按到达顺序追加。
- `/api/muv-engine/extract` 响应增出 `commandOps` / `badCommandOps`（可观测）。

### ② `stat_data` 语义归一（新增 `normalizeStatData`）
- `chat[i].variables.stat_data`（ST 的存储形态）⇒ 归成**顶层键 = `stat_data`** 的变量树，
  使卡里的 `stat_data.xxx` 路径对得上；
- 本来就是顶层 `stat_data` 的 MVU 形态、以及**平铺树**，**原样返回** ——
  ★ 平铺树**不**包一层 `{stat_data:…}`（无差别包会让既有 ERA 卡的路径全断，这是本次的对照臂）；
- 归一在 `setState` / `mergeState` 两个入口统一做，`parseVariableOps` 的块载荷也过一遍；
  ①②的既有行为未动。

### ③ 卡 iframe 宿主 API 垫片（`lib/client.js` 的卡兼容垫片，第 8 节）
- `window.TavernHelper`：`getVariables` / `replaceVariables` / `insertOrAssignVariables` /
  `triggerSlash` / `eventOn` / `eventEmit` / `eventOnce` / `eventOff` / `eventClearAll` /
  `getChatMessages` / `formatAsTavernRegexedString` / `getLastMessageId` / `eventClearAll`
  （+ `version` / `getContext`）；`window.Mvu`：`getMvuData` / `replaceMvuData` /
  `getMvuVariable` / `events`；**裸全局同名**也定义（实测卡两种写法都有）。
- 读口径对齐卡的 `pickStat`：读出来一律是 `{stat_data:…}` 形状（卡只认这个非空才算数）；
  `getVariables("a.b", {defaultValue})` 字符串路径形态也支持。
- `triggerSlash` **只走白名单**：`/send <文本>`、`/setvar`、`/getvar`、`/echo`；
  其余（含实测卡真的用到的 `/inject`）**不执行、只 `console.warn`** ——
  "假装做过"比"如实没做"更坏：卡会以为注入成功，后面每一步都错。
- 父页探测按**真卡的实际形状**实现（取证见 `docs/02-变量链路.md`）：
  卡的 `resolveTH/resolveST` 是「多条探针各自 `try` 包住、`window.X` 排第一」。
  沙箱是不透明来源 ⇒ `window.parent.X` **抛 `SecurityError`**（不是返回 `undefined`），
  所以同名对象定义在**卡自身 window** 上即可命中；**不放宽沙箱**去迁就 `window.parent.X`。
- `eventOn` 返回**取消订阅函数**（实测卡用 `var unsub = on(...)`）。
- 启动即向宿主问一次 MVU 数据（走新增通道 `__muvMvuReq`）。

### ④ 回灌后把新值推给在线帧
- `muvEraPushNow` 每帧推**两条**：`era:getCurrentVars`（既有 ERA 通道）+
  `mag_variable_update_ended`（MVU 事件，载荷 `{stat_data:…}`）；
- 卡内新增 `__muvAbsorb`：把入站事件的变量树**同步吸进** `mvuData` 缓存 ——
  `Mvu.getMvuData()` / `TavernHelper.getVariables()` 是**同步读**，不吸缓存它们只能回初始值；
- 入站事件仍走 `fire`（**卡内**派发）而不是 `emit`：`emit` 会把宿主回灌的事件再转发回宿主，
  一个来回就成正反馈。★ 这条是既有门禁逐字盯着的形状，故 `fire` 与 `__muvAbsorb` 写成
  **两条并列 `if`**（不改门禁口径去迁就代码风格）。
- 卡侧写回走**独立通道** `__muvVarWrite`（各自节流），口径：**整树（带 `stat_data`）用 replace、
  增量/平铺用 merge**；认不出会话或超体积则丢弃（宁可没写，也不写错会话）。

### 门禁（全绿，数字）
| 命令 | 结果 |
| --- | --- |
| `node test-era-vars.mjs` | 全部通过（新增 [4][5][6] 三节 + 对照臂） |
| `node test-client-render.mjs` | 264 通过 / 0 失败 |
| `node test-regex-engine.mjs` | 26 通过 / 0 失败 |
| `node verify-era-bridge.mjs` | after **21 通过 / 0 失败**；对照臂 nobridge 13/8 红、before 6/15 红 |
| `node verify-card-compat.mjs --old-export` | after **46 通过 / 0 失败**；对照臂 before 9/37 红 |
| `node verify-no-redouble.mjs` | 6 通过 / 0 失败 |
| `node verify-decorate-dom.mjs` | 全部通过（需 `MUV_EDGE`） |

新增行为都配了**能真的变红的对照臂**：`foo_.set(` / lodash 形态 / 变量引用 / 字符串增量四类坏调用、
平铺树不被包成 `{stat_data}` 、名单外 `/inject` 只 warn 不动输入框、before 臂上整组 ⑩ 全红。

### 未动（硬约束自检）
`lib/regex-engine.js`、`_decorateOne` 的三条守卫、`<VariableEdit>` 现有解析 —— 均未改动；
替换串仍一律走函数式替换；未触碰另一仓库 `C:\dsh-tavern-v2`。
客户端构建标记 `MUV_BUILD` → `2026-09-22l`。

### 已知边界（只能真机/实测确认的部分）
- `formatAsTavernRegexedString` 目前**原样返回**（实测新卡里计数为 0，先按最小实现兜住存在性）；
- `getChatMessages()` 返回宿主喂进来的消息文本数组（不含完整 ST `chat` 字段）；
- `/inject` 等名单外命令**不执行**：卡若只靠它注入变量，那部分功能不会生效（会打印 warning，可观测）；
- 卡若用 `_.set(对象, 路径数组, 值)` 这种 lodash 形态，**不会被**提取（计 `bad`，服务端日志可见）。

## 未发布（2026-09-22 · 十二）★★ 给卡 iframe 补上 ST 会注入的前端库（Tailwind/jQuery/jQuery-UI/Vue/Vue-Router/FontAwesome）

### 为什么（事实，不是推测）
`ST-IFRAME-SPEC.md` §3 / §7：ST 的 iframe 文档模板 `b1()` **无条件**把常量 `v1`
塞进**每一个**卡 iframe。`v1` 的原文（从 `JS-Slash-Runner/dist/index.js` 里逐字取出）：

```
<link rel="stylesheet" href="…/@fortawesome/fontawesome-free/css/all.min.css">
<script src="…/lib/tailwindcss.min.js">               （= @tailwindcss/browser@4.1.12）
<script src="…/jquery/dist/jquery.min.js">
<script src="…/jquery-ui/dist/jquery-ui.min.js">
<link  rel="stylesheet" href="…/jquery-ui/themes/base/theme.min.css">
<script src="…/jquery-ui-touch-punch">
<script src="…/vue/dist/vue.runtime.global.prod.min.js">
<script src="…/vue-router/dist/vue-router.global.prod.min.js">
```

⇒ ST 里的卡 HTML **天然拥有** Tailwind 工具类（`class="w-full"`）、`$()`、`$.ui`、
Vue / Vue-Router、`fa-solid fa-xxx` 图标，写卡的人**从不自己引**。
我们此前**一个都没有**，这是「卡里东西出不来」的一条**独立**原因：

- Tailwind 类没有任何 CSS 规则 ⇒ 布局按"没有样式"塌掉；
- `$` / `Vue` 未定义 ⇒ 卡的脚本第一行就抛 ⇒ **界面照常渲染、功能全废**
  （与 `$'` / `$&` 打坏卡脚本那两次是同一类观感，极难查）。

### 改了什么（`lib/client.js`）
- 新增常量 **`MUV_CARD_LIBS = true`**（默认**开**）+ `muvCardLibsOn()` /
  `muvCardLibTags()` / `withCardLibs()`；
- 注入点：**`</head>` 之前**（仍在 `<body>` 之前 ⇒ 卡的脚本拿得到这些全局，
  与 ST 时序一致；同时排在 compat 垫片与 reset **之后** ⇒ CDN 出问题时不会
  连带推迟我们自己那两段）；
- 顺序照抄 ST：**先 CSS 后 JS，jQuery 在 Vue 前**（Vue-Router 依赖全局 `Vue`、
  jQuery-UI 依赖全局 `jQuery`，顺序错了就是静默少一个库）；
- 版本**钉死**（不用 CDN 的 latest）：FA 6.7.2 / Tailwind(@tailwindcss/browser) 4.1.12 /
  jQuery 3.7.1 / jQuery-UI 1.13.3 / Vue 3.5.13 / Vue-Router 4.5.0，全部走
  `https://cdn.jsdelivr.net/npm/…`；
- 只作用于**我们自己生成的卡 iframe**（调用点唯一：`muvInjectDoc`），DSH 自己的
  iframe 根本不经过它；幂等守卫查 `data-muv-libs=`（带 `=`，卡的原文提到这几个字
  也不会被误判）；
- **沙箱没动**：仍是 `sandbox="allow-scripts"`，没有 `allow-same-origin`
  （加库不是放开同源的理由）。
- 客户端构建标记 `MUV_BUILD` → `2026-09-22k`。

### 与 ST 的两处**有意**差异
1. Vue 用**完整构建** `vue.global.prod.js` 而不是 ST 的 `vue.runtime.global.prod`
   （runtime 版不含模板编译器）。完整版是超集：ST 能跑的这里都能跑，额外还能跑
   `template:` —— 只会多救几张卡。
2. 省略 jquery-ui 的 `theme.min.css` 与 `jquery-ui-touch-punch`（ST 有）：
   两者只影响 `.ui-*` 控件与触屏拖拽，而每多一个远程资源就多一份失败面。

### 怎么关
把 `lib/client.js` 里的 `var MUV_CARD_LIBS = true` 改成 `false`（唯一的开关）。
**关掉的后果**：依赖 Tailwind 类的卡布局缺失、`$`/`Vue` 未定义 ⇒ 部分卡"显示不全 /
点了没反应"。只在确认某张卡被这些库干扰时才关，**不要删代码**。
CDN 取不到时失败形态是安全的：该全局为 `undefined`，卡里现成的
`typeof $ !== 'undefined'` 检测照旧短路 ⇒ 不会比"从不注入"更差。

### 新门禁 `verify-card-libs.mjs`（真浏览器 + 真沙箱 + 真 CDN，23 项）
A 臂（注入）实测：`jQuery 3.7.1` / `$.ui` / `Vue.createApp` / `VueRouter.createRouter` /
`Font Awesome 6 Free` 全部到位，`.hidden→none`、`.flex→flex`、`body{margin:0}`
（Tailwind preflight）全部生效，卡内容未被破坏。
B 臂（**不注入的对照**）：上面每一项都**不是** —— 没有它，A 臂的断言全是永真。

## 未发布（2026-09-22 · 十一）★ 隐藏与 iframe 重复的整页源码块（ST 的 `hidden!` 的等价物）

### 症状与出处
`ST-IFRAME-SPEC.md` §2 / §8 第 2 条：ST 把消息里残留的 `<pre><code>` 加 `hidden!`
隐藏（不删除，仍在 DOM 里）。我们靠「整页 HTML 换成 iframe」绕过了**大部分**情况，
但**卡正则没产出整页文档**时（围栏没被认出来、或那条正则没命中），那一大段源码
仍然露成裸文本 —— 用户看到的就是「一大段没渲染的 HTML」。

### 修法（`lib/client.js`，小而保守）
- `muvIsPageSourceText(t)`：判据**刻意窄**，只认整页文档 ——
  `<!doctype html>` 且同有 `<html`/`<head`/`<body` 之一；或 `<head` 与 `<body` 同现；
  或含 `__muvReset`（那是**我们注入过**的记号 ⇒ 这份文本就是卡文档）；外加长度 ≥ 200
  （挡掉正文里举例提一句 `<!DOCTYPE html>` 的短文）。
  **不是**"所有代码块" —— 用户正常的 ``` 代码块一个字符都不许动。
- `muvHidePageSourceBlocks(body)`：只动 `<pre>`；落在**我们自己产物**里的 `<pre>`
  （变量折叠卡 / 摘要框）跳过；隐藏用**内联 `display:none!important`**
  （`hidden` 属性会被 DSH/卡给 `pre` 设的 `display` 盖掉），并打
  `data-muv-src-hidden` 记号。
- 挂在 `_decorateOne` **最后一步**（装饰成功与否都跑，它是纯 DOM 操作）。

### 门禁
- `test-client-render.mjs` 第 **[21]** 段（13 项）：三类"认"、三类"不认"、
  真函数跑假 DOM（整页块被藏 / 普通块不动 / 我们自己的 `<pre>` 不动 / 幂等），
  外加**变异对照臂**（把判据摘掉 ⇒ 一块都不隐藏，证明判据能红）。
- `verify-decorate-dom.mjs` 新增第八类 `H_source`（真浏览器 + 真 `_decorateOne`）：
  `srcHidden=1`、`preVisible=2`（普通代码块 + markdown 的 pre 都还在）、`srcLeak=0`。
  **对照臂实测**：`MUV_CLIENT_SRC=<改动前的 client.js>` 时这一类
  `srcHidden=0 / srcLeak=1 / preVisible=3` ⇒ **FAIL**（判据不是空转）。

## 未发布（2026-09-22 · 十）★★ 我们把自己的产物当成原文又跑了一遍 —— 「时间/摘要」露在正文里的真凶

### 症状
用户：「这个时间感觉出现的地方不对劲」「那个日常也没有」。截图里正文中段凭空出现
一段蓝色块的文字：**📖 时间：2026年.08月.26日 10:00 ~ 10:15 地点：… 摘要内容 …**
外加 **💭 变量推演** 和 **✏️**。而这些字眼**卡自己一句都没写过**。

### 取证（这次在用户机器上、进 iframe 读 DOM）
- 现场那份「正文美化」整页文档的 `body.innerHTML` **尾部**是**裸文本**（不是标签）：
  `📖 时间：… 摘要内容 … 💭 变量推演 ✏️`，而且 `时间：`/`地点：` 被并成了一行
  （典型的"过了 `innerText` 的 HTML 空白折叠"指纹）。
- 对比服务端产物：拿**同一份 assistant 原文**打 `/api/muv-engine/apply-regex-card`，
  `applied=6`，产物里 `摘要内容 / 时间： / 📖 / 💭 / 变量推演` **全是 0** ⇒ 现场那份不是这条管线出的。
- 词源：`📖` 与 `💭 变量推演` 都是**我们自己**的标签（`muv-abstract` 的图标、
  `muv-varthink` 的 summary），`✏️` 是**酒馆插件注入的编辑按钮**。

### 根因
`_decorateOne` 的原文来自 **DOM 的 `body.innerText`**，而我们的装饰产物就长在那个 DOM 里。
一旦对同一个（或**包着它的**）元素再跑一遍：
- 卡正则 `<(?:content|…)>…</…>` 照旧命中（字面量还在）⇒ 文档照建；
- 但 `<Abstract>` 的**标签**已被换成 `<div class="muv-abstract">` ⇒ card `[7]`
  「对玩家隐藏摘要」（`/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`，大小写敏感 + 行锚）
  **必然落空** ⇒ 摘要正文永久露在正文里，还被当成"正文"塞进文档；
- 我们自己的标签文字（📖 / 💭 变量推演）和酒馆的 ✏️ 一并变成正文。

**两个附带发现**（同一处代码）：
1. `[data-muv-decorated]` 落在了 **3 个 DSH 侧边面板**上（`_surface_*` / `_pane_*` / `_paneBody_*`）——
   装饰器在往面板上跑，**面板内容被吃掉了**（实测其中一个是空文本）。
2. 目标元素可能是消息**根节点**而不是 `_markdown_*` 正文容器 —— 直接替换它的 `innerHTML`
   会毁掉 DSH 自己的正文元素。

### 修法（`lib/client.js`）
三条守卫 + 目标规范化 + 干净取文：
1. **`muvHasOwnArtifacts`**：`[class*="muv-"]`（一条前缀兜住全部，不再枚举类名）+
   `iframe.muv-iframe` / `[data-muv-kv]` / `[data-muv-inbox]`。命中即**拒绝装饰**。
2. **`muvMessageBodyOf`**：只认 `_markdown_*` 正文容器本身、或**恰好包着一个**它的元素；
   面板/侧栏 0 个 ⇒ 拒绝。并**归一到正文容器**再写（不写消息根）。
3. **`muvRawTextOf`**：取文前把非正文 DOM（`button` / `script` / `style` / `textarea` /
   我们的全部产物）**临时 `display:none`**，读 `innerText`，`finally` 还原。
   隐藏而非克隆 —— 脱离文档的克隆上 `innerText` 会退化成 `textContent`（块间无分隔符）。

### 新门禁 `verify-no-redouble.mjs`（真浏览器 + 真 `_decorateOne` + 可红对照臂）
三档夹具：A 干净正文 / B 已含我们产物 / C 面板。
`after`：A 被装饰、**B 一个字符都没动**、C 不碰。
`before`（`git show a7031dc:lib/client.js`）：B **确实被再装饰**，且读到的"原文"正是
线上那段垃圾 —— `📖 时间：2026年.08月.26日 10:00 ~ 10:15 摘要内容 主角在办公室核算现金
\n💭 变量推演\n✏️` —— **逐字复现**。C 也被吃了。

### 顺带：「日常」没有声音（**不是渲染问题**）
卡模板 `processAudio()` 按消息里的 `<audio>日常</audio>` 拼 `音频/日常.mp3`。直接 HEAD 那个 CDN：

| 名字 | 结果 |
|---|---|
| `日常.mp3` / `搞笑.mp3` / `欢快.mp3` / `暧昧.mp3`（预设 `#音乐列表` 里写的） | **404** |
| `日常1/2/3.mp3`、`搞笑1`、`欢快1`、`暧昧1` | **200** |

⇒ 预设的「音乐列表」与 CDN 的**实际命名（带序号）不一致**，模型照列表写裸名 ⇒ 播放器空白
（卡自己的 `error` 处理只是把提示调暗）。**ST 侧同一张卡、同一个 URL，同样静默。**
既然命名规律确定，垫片加了**出错兜底**：只在真的加载失败时试 `<名字>1/2/3.mp3`；
名字已带序号**不猜**；别名记号挂在**元素**上（全局表会改坏别的元素上合法的 `日常1.mp3`）；
改写时**清掉 `<source>` 子节点再设 `src`**（只改 `source.src` 不会重新触发选源 —— 实测重试一次后就不再报错）。
新门禁 `verify-audio-fallback.mjs` 五档：裸名兜住 / 已带序号一字不改 / `src` 属性形态 /
候选全 404 时上限 3 次 / **兜到能播的那个就停（`readyState=4`）**。

### 门禁
`test-client-render` **229/0**（新增 [18][19]）、`verify-no-redouble` 6/0、
`verify-audio-fallback` 6/0、`status-cascade` 84/0、`regex-engine` 26/0、`era-vars`、
`decorate-dom` 七类、`card-compat`（after 29/0 / before 红 21）、`era-bridge`、`frame-height`、
`visual` 全部复跑绿。构建标记 → **`2026-09-22j`**。

## 未发布（2026-09-22 · 九）★★ 运行时状态少剥一层信封 —— 选项/数值根本没接上（现场取证）

### 🔑 这一次是**在用户机器上直接取证**的

用户问"能不能让你直接观看到控制台"——能。DSH 的鉴权支持**持久签名 Cookie**
（`~/.dsh/.credentials.yaml` 里 `records.client-connection/browser-session` 的 secret），
用它签一个 cookie 就能让无头 Edge 打开本地 DSH，**在用户真实会话里**读卡内 DOM
（`Runtime.evaluate` 进 OOPIF），还能数 iframe 重建次数（"一直闪"的量化）。
以后这类"只有用户能看到的现场"都能这样拿证据。

### 🐞 症状（极有迷惑性）

`data-era` 一共 17 个，**填上了 14 个**，只有 `剧情选项.选项1/2/3` 是空的；
时间显示 initvar 的 `10:00` 而不是运行时的 `10:15`。
看起来像"个别字段没填"，其实**整份运行时状态都没接上**——因为那些填上的字段
`initvarData` 本来就有默认值，而 `剧情选项` 的默认值恰好是空串。

### 🎯 根因：`/api/muv-engine/state` 的 `{data, updatedAt}` 信封没剥

端点回的是 `stateStore` 里那条记录本身：

```
{ ok:true, state:{ data:{世界信息:…, 剧情选项:…}, updatedAt:… } }
```

客户端 `muvEraFetchVars` 原来直接 `return d.state` ⇒ 运行时值被塞进**深一层** `stat.data.*`，
而卡按 `stat.剧情选项.选项1` 读到的仍是 initvar 的空串。
现场证据：卡内 `currentStat` 的键里**多出 `data` 与 `updatedAt`** 两个键。

### 🛠 修法

剥一层：`(s.data && typeof s.data === 'object') ? s.data : s`（两种形状都兼容）。

### 门禁（★ 这条门禁自己也有洞，一起补了）

`verify-era-bridge` 的 fetch 桩**对所有 URL 返回同一份** payload，于是"取运行时状态"那条分支
永远拿到 `d.state === undefined` ⇒ 静默退回 base ⇒ **"信封有没有剥"根本测不到**；
而原来的断言只查 initvar 本来就有的字段，所以一直绿。
现在把运行时状态挂进同一份信封，并新增两条**能红的**断言：

- ★★ 运行时值覆盖初始值（时间详情 = `23:59`，不是 initvar 的 `10:00`）
- ★★ initvar 为空的字段（`剧情选项.选项1`）必须被运行时值填上（= 用户报的"选项里没有内容"）

实测：`after 21 通过 / 0 失败`；两条对照臂（nobridge / before）在这两条上**都是红的**。
`test-client-render` **208 通过 / 0 失败**。构建标记 → **2026-09-22i**。

### 现场复验（用户会话 `session-9a1dede5`，真实数据）

```
csKeys: [世界信息…主播档案]           ← data/updatedAt 信封键已消失
csChoice: {选项1:"把足控榜和歌回数据并排放给超天酱看，直说这公司得换条路走", …三条真文本}
csTime: 时间详情 "10:15"              ← 运行时值
empty: []                             ← 没有空字段
```

## 未发布（2026-09-22 · 八）★★ 客户端同源 `$&` bug —— 卡脚本被自己的文档打坏（选项空白的真凶）

### 🐞 症状

推送已经成功（控制台 `[muv-engine] era push → 10 棵树 → 2 帧`），服务端状态也是真值，
但**卡上的选项仍然空白**、数值仍是初值；卡的界面**渲染得好好的**，只是功能全废。

### 🎯 真因：`String.replace` 的**字符串替换**语义（与服务端第 4 轮同源，另一端）

客户端把 210KB 的卡文档拼进替换串：

```js
result = result.replace(STATUS_PH_ALL, '<div class="muv-statusbar-wrap">' + frame + '</div>')
```

而卡自己的 ERA 脚本里有这一行：

```js
function isTemplate(key){return key&&key.charAt(0)===&#39;$&#39;}
```

`$` 后面紧跟 `&`（`&#39;` 的实体首字符）⇒ 被 `String.replace` 当成 **`$&`（整个匹配）**
⇒ 那行变成 `===&#39;<<StatusPlaceHolderImpl/>#39;}` ⇒ **卡的脚本语法错误** ⇒ 卡的 JS 全废。
HTML/CSS 不经 JS 解析，所以**界面照常**、只有功能死掉 —— 与第 4 轮的服务端 bug 一模一样的迷惑性。

实测（真卡 241KB frame）：字符串替换在**位置 199284**（正是那行 `isTemplate`）改写；
函数式替换后 frame **逐字不变**。

### 🛠 修法

抽 `muvFrameBlock(frame)`，**三处**占位符/状态块拼接全部改成**函数式替换**
（`replace(re, function () { return muvFrameBlock(frame) })`）—— 函数式替换不做任何 `$` 解释。
铁律与第 4 轮统一：**凡是把"别人的一大段文本"拼进替换串，一律用函数式替换。**

### 门禁

`test-client-render` **208 通过 / 0 失败**（新增 [17] 段 6 条）：函数式替换逐字安全 +
**对照臂证明字符串替换确实会改写**（判据不是空转）+ 三处调用点的源码形态不许退回字符串写法。
构建标记 → **2026-09-22h**。

## 未发布（2026-09-22 · 七）★ 多档重推：卡不再停在初始值（选项终于有字）

### 🐞 症状

服务端状态**已经有真值**（`剧情选项` 三条真文本、`时间详情` 10:15、`好感度` 38），
但卡上还是空选项 / 10:00 / 好感度初值。用户："选项还是没有字"。

### 🎯 真因：时序，不是数据

卡 iframe 是**消息渲染时**才创建的，而变量回灌发生在渲染**之前** —— 最后一次回灌完成时
`querySelectorAll('iframe.muv-iframe')` 数到 **0 个帧**，那一次推送落空；
而卡只在自己加载约 1200ms 时查一次变量 ⇒ **永久停在初始值**。
（上一版的 `muvEraPushToFrames` 是"回灌完成推一次"，正好落进这个洞。）

### 🛠 修法

`muvEraPushNow()` + `muvEraSchedulePush()`：状态变化后按 **0 / 1.5s / 4s** 三档重推，
分别覆盖「已存在的帧 / 刚创建还在跑初始化的帧 / 滚动懒渲染才出现的帧」；取数走 `muvEraWarm` 复用缓存。
并打一条**可观测日志**：`[muv-engine] era push → N 棵树 → M 帧`
（原来症状完全不可观测 —— "卡上没反应"分不出是没推、推了没帧、还是卡没收）。

门禁：`test-client-render` **202 通过 / 0 失败**（新增 3 条）。构建标记 → **2026-09-22g**。

### 🚫 同轮实测排除的两条（都不是我们的 bug，记下来免得重复查）

1. **"时间出现的地方不对劲"** = **模型的思考（reasoning）内容**在聊天里显示出来了。
   从 DSH 会话存储取出的原文就是它在自我说明输出格式（"需要：- `<content>`包裹正文
   - `<Abstract>摘要 …"）。不是卡渲染的，也不是正则漏删 —— 我们的引擎对真消息
   `<Abstract>` 残留恒为 0（各深度实测）。
2. **"日常下是空白"** = 模型写的是 `<audio>日常</audio>`，而 CDN 上的素材名是 `日常1.mp3`。
   实测 `音频/日常1.mp3` → **200**，`音频/日常.mp3` → **404**。模型写错名字，不是渲染问题。

## 未发布（2026-09-22 · 六）★ 接上 ERA 增量块 —— 选项/数值/CG 视频一起活了

### 🎯 用户报的三个症状，同一个根因

> "你这个选项里没有内容，而且视频也没有"

| 症状 | 真因 |
|---|---|
| 选项（选项1/2/3）空白 | 卡里写的是 `<span class="choice-text" data-era="剧情选项.选项1">`，而**卡的声明式初始变量里 `剧情选项` 是空串**；真值只在模型每楼发的 `<VariableEdit>` JSON 里 |
| 数值（好感度/压力值/五感）不动 | 同上 —— 我们只解析过 MUV 原生的 `<initvar>` YAML，**从没解析过社区卡的增量块** |
| CG 画廊的 NSFW 视频不出来 | 卡源码写着 `/* NSFW 视频需好感度 100 才可解锁 */` —— 好感度停在初值 ⇒ 视频锁着 |

**定位方法**（值得抄）：用户的 ST 界面里一切正常，所以数据**一定在**ST 的某个存储里。
顺着 `era_data` / `variableinsert` / `VariableEdit` 三个标签在 ST 数据目录里逐个搜，
最后在真聊天文件的**消息正文**里找到 `<VariableEdit>{…JSON…}</VariableEdit>`。
注意大小写：`grep UpdateVariable` 返回 0，因为它叫 **`VariableEdit`**。

### 🛠 实现（两侧各一处，加一个新门禁）

**服务端 `lib/var-tracker.js`**
- `parseVariableOps(text)`：解析 `<VariableInsert|VariableEdit|VariableDelete>` 的 JSON 载荷
  （深合并 / 深删），并取 `<era_data>` 里的消息键。
- `applyVariableMessage(sid, {key, epoch, ops})`：**记账 + 按消息键重放**。
  ★ 为什么不"到场即合并"：装饰是**异步乱序**的（滚动/重渲染会让旧消息后到），
  而每楼 JSON 带的是**绝对值** ⇒ 旧编辑盖在新编辑之后，被覆盖的字段会**回退**（好感度倒着走）。
  账本按 `era_mk_<epochms>_<rand>` 的时间戳升序重放 ⇒ 与送达顺序无关、重复送达无副作用。
- 会话级 LRU（64 会话 / 500 楼）+ 单消息 200KB 上限：内存态不能无界长。

**客户端 `lib/client.js`**
- `muvFeedVariables`：收第二种数据源 + 实体解码 + 喂 `body.innerHTML`（不是 `innerText`）。
- 新增 `muvEraPushToFrames()`：回灌完成后**主动把新状态推给在线卡帧**。
  卡的查询周期只有"加载后 1200ms 那一次"，而回灌发生在装饰期 ⇒ 不推的话卡停在初值。

### 📌 两个真实世界的坑（都是实测踩出来的）

1. **模型会在 `<VariableThink>` 里"提及"标签名**（"生成一个 `<VariableEdit>` 块来更新…"）。
   直接扫标签会从这句提及一路吃到真块的收尾标签 ⇒ `Unexpected token '\`'`。
   实测 3/4 条真消息全踩。修法：先整块剔掉 `VariableThink`，再用"内容必须是 JSON"拒绝错配，
   并把扫描位置**退回开标签之后**重来（算成 bad 跳过会把后面的真块一起漏掉）。
2. **`touchSession` 里先 `delete` 再 `get`** ＝ 每次调用都新建账本（`_qa` 的"倒序一致"断言当场抓出）。

### 门禁

- 新增 `test-era-vars.mjs`（**17 条**）：合成用例覆盖"提及错配/三种块/乱序一致/幂等"，
  另在真聊天文件在场时跑真数据（取不到就 SKIP，不假装通过）。
- `test-client-render` **200 通过 / 0 失败**（新增 4 条：喂 innerHTML、两种数据源、实体解码、主动推送）。
- `verify-card-compat`（after 29/0，before 红 21）、`verify-era-bridge`、`verify-frame-height` 全绿。

### 端到端实证

真聊天文件 → 重放状态（`剧情选项 = {"选项1":"开始品尝这道"花瓣沙拉"。"…}`、`好感度 = -80`）
→ 按真实协议投递 → 卡内读到 `["开始品尝这道"花瓣沙拉"。","用叉子将一块"花瓣"喂到东雪莲嘴边。",
"命令侍者清理现场，准备离开。"]`；截图 `shot-era-with-vars.png`（因特网舆情、世界信息 21:15 /
红玉膳房包间、超天酱五感、三个真选项全在）。

### ⚠ 已知限制（如实记录）

- 没有 `<era_data>` 消息键的老格式块：只能按**到达顺序**追加（有键的走重放，顺序无关）。
- 装饰只覆盖 **DOM 里存在的消息** —— 若 DSH 对消息列表做虚拟滚动，滚出去的历史楼层不会被重放。

## 未发布（2026-09-22 · 五）★ 帧高两处裁剪缺陷：上限 2400 与父页 8px 死区

### 🎯 真卡的实测证据（一次性探针，`_era-*`，跑完即删）

把**真实变量数据**（`/api/muv-table/tavern-card` 的 `initvarData`）按**真实协议**
（`muvEraDeliver` 逐字来自 lib/client.js）喂进真卡的 ERA 文档，在真浏览器里读数：

| 观测量 | 修复前 | 修复后 |
|---|---|---|
| 卡内异常 | 0 条（`$'` 修复生效，卡脚本活着） | 0 条 |
| 卡内数据 | 有：`2026年8月26日` / `龙国` / 因特网面板全有值 | 同 |
| iframe 帧高 | **889**（卡内 `body.scrollHeight` = 894） | **895 = 卡内 895** |

⇒ 「什么变量都不显示 / 不能交互」是 §四 那个 `$'` bug 的**下游症状**，卡一活数据就出来了
（截图见 `shot-era-ERA_状态栏.png`：九个 tab、因特网/世界信息/五宫感受都有值、底部输入区完整）。

### 🐞 缺陷 1：`MUV_FRAME_H_MAX = 2400` 会**静默截断**

ST 本体的高度是 `body.scrollHeight` 原样写进 `frameElement.style.height`，**没有任何上限**
（ST-IFRAME-SPEC §6）。我们跟了个 2400，而真卡实测已到 2056 / 2083（距上限 13%）——
`verify-frame-ratchet.mjs` 自己的注释就写着「超限的表现是**静默截断**」，而 reset 里是
`html,body{overflow:hidden!important}` ⇒ 被夹掉的部分**连滚动条都没有**。
→ 提到 **12000**（≈900px 视口下的 13 屏），语义改成「只拦畸形值，不给内容封顶」。

### 🐞 缺陷 2：父页 8px 死区**无差别**吞掉「增长」

`onMuvFrameHeightMessage` 里 `Math.abs(cur - h) < 8 → return`。孩子侧已经按「滞回只作用在
收缩方向」实现了溢出学习（报的是 `body.scrollHeight` 精确值），却在父页被死区吃掉：
实测 ERA 状态栏 **内容 894 / 帧 889**，那 5px 就是**卡底部永久少一条**。
`extent()` 量的是元素包围盒（**不含 margin**），所以"最后那几个像素"只有滚动区自己看得见
—— 正是死区最容易吃掉的一段。
→ 改成 `h <= cur && (cur - h) < 8`：**增长无条件生效**，收缩仍留 8px 防抖。

### 门禁

- `test-client-render` **196 通过 / 0 失败**（新增 ★★ 增长 5px 必须生效；收缩用例改成真收缩方向）
- `verify-frame-height` 全过：正文美化三档收敛 900（钉在父页视口地板）、ERA 三档一致收敛 **895**
- `verify-frame-ratchet` 全过（含「内容底边在帧内可见」与变异臂对照）
- `repro-frame-height` / `verify-decorate-dom` / `verify-visual` / `verify-card-compat` /
  `verify-era-bridge` 全过
- 上限判据一律改成**从 `muvFrameHeightLimits()` 读**，不写死数字 —— 写死会让"上限该多大"
  只能靠改测试来表达（2400 就是这么熬到真卡贴边的）

### 📌 一条留给后人的观察（不是缺陷）

`主页` 卡是**浅色底卡片**：正文色 `rgb(40,73,92)`，而根节点与 `html/body` 背景**全透明**
（文档里也没有媒体 URL，插图由卡 JS 拼）。它假定宿主背景是浅色 —— ST 同样不注入背景
（ST-IFRAME-SPEC §4 的 reset 只有 margin/padding/overflow/max-width），所以深色主题下
两边都会"看不见字"。**这是卡作者的设计假设，不是我们的偏差**，别去"修"成注入白底。

## 未发布（2026-09-22 · 四）★ 卡脚本被替换串 `$'` 打坏 —— 真凶修复

### 🐞 症状：卡 HTML/CSS 正常显示，但**卡的 JS 全废**

tab 切不动、数据不渲染、按钮点了没反应；控制台只有一行
`about:srcdoc:4102 Uncaught SyntaxError: Invalid or unexpected token`（出现两次）。

### 🎯 根因（实测定位到字符）

卡的正则 `[2]「ERA 状态栏」` 的**替换串就是一整页 210KB HTML**，而文档里的卡 JS 写着
`key.charAt(0)==='$'`。我们此前用 `String.replace(re, replaceString)` 做替换 ——
替换串里的 `$'` 被 JS 当成"**匹配之后的文本**"引用，于是那行变成
`key.charAt(0)==='<StatusPlaceHolderImpl/>'`：**引号错位 → 整段卡脚本语法错误**。
实测证据（真消息走完"服务端正则 → 客户端围栏 → srcdoc"整条链）：

```
坏: function isTemplate(key){return key&&key.charAt(0)==='   ← 引号没闭合
    <StatusPlaceHolderImpl/>}'
净: function isTemplate(key){return key&&key.charAt(0)==='$'}
```

HTML/CSS 不经过 JS 解析，所以**看起来"卡渲染对了"**，只是功能全废 —— 这类症状极难定位。

### ✅ 修法：照抄 ST 的**函数式替换**（`SillyTavern/public/scripts/extensions/regex/engine.js:419-442`）

ST 用 `rawString.replace(findRegex, function (match) { … })`，只**显式**展开 `$1…$99` 与
`$<name>`（外加 `{{match}}` → `$0`），其余 `$` 一律字面量。我们的 `applyRegexScript` 改成同一口径。

### 🧪 回归哨兵（test-regex-engine 26 通过）

`$'` / `$&` / `` $` `` 逐字入文、`$1` 与 `$<name>` 仍按捕获组展开、`{{match}}` 展开 —— 五条钉死。

## 未发布（2026-09-22 · 三）

### 🔍 客户端构建标记（解决「重启了但看起来没变」）

`MUV_BUILD='2026-09-22c'` 写进 `document.documentElement[data-muv-engine]` 并打到控制台
（`[muv-engine] client loaded …`）。DSH 重启换的是**服务端模块**；浏览器里已打开的标签页
仍在跑**加载时注入**的那份客户端 bundle —— 这是"重启后界面毫无变化"最常见的原因。
有这行标记就能一眼分辨「页面没重载」与「加载了但效果不对」。

### 🧪 交互桥真浏览器端到端门禁（verify-card-compat 第 ⑧ 段）

真垫片 + OOPIF 内触发 + 宿主输入框断言：垫片定义 `sendUserMessage`、隐藏收件箱装上、
两条触发（`send` / `fill`）都真的落进宿主聊天输入框。after 29 通过 / 0 失败，
before 臂 21 条红（对照成立）。

### 🔎 三项症状的实测结论（供复查）

| 症状 | 结论 | 证据 |
| --- | --- | --- |
| 卡内不能交互 | **已修**（待页面重载生效） | 真浏览器 e2e：`[{"text":"MUVPROBE-A","mode":"send"},{"text":"MUVPROBE-B","mode":"fill"}]` |
| 无视频 | **链路正常** | 真实正则引擎对真消息 `applied=8`，产物 `<video src="https://zyxjack123.top/足控天堂/视频/NSFW/东雪莲/舔小穴1.mp4">`；该域名 HEAD 200 `video/mp4` |
| 数据区空白（因特网/世界信息/五宫感受） | **未解决** | 该卡消息里只有 `<era_data era-message-key=…>`，**没有** `UpdateVariable`/`_.set` ⇒ 数值由酒馆助手「ERA变量框架」脚本维护，需 §17.4 的原生变量框架 |

## 未发布（2026-09-22 · 二）

### ✨ 卡 → 宿主交互桥（卡内按钮终于能驱动 DSH 输入框）

真卡的「发送到酒馆」是三级降级：① 宿主注入的全局函数 `sendUserMessage(msg)`（首选）
② DOM 直插父文档 `#send_textarea` + `#send_but`（我们的沙箱下**必然**被跨源拒绝）
③ 剪贴板。此前 ①② 全空、③ 只有"已复制"提示 ⇒ 用户看到的就是"蓝色卡片不能交互"。
现在：
- 垫片定义 `window.sendUserMessage`（ERA 卡的 ① 直接命中）→ postMessage 给宿主；
- 垫片给「先搜自己文档 `#send_textarea`」的卡（主页.html 的 `fillSendTextarea`）注入一个
  **隐藏收件箱**（`data-muv-inbox`，卡源码含约定符号才装）：卡用原生 setter 写值 +
  input/change 事件时捕获，按 `mode=fill`（只填不发送，与卡自己的提示语一致）转发；
- 宿主侧 `onMuvCardCompatMessage` 认 `__muvUserSend`（每帧 ≥800ms 节流、限长 20000），
  `muvDeliverUserText` 用原生 setter 写 DSH 输入框；`mode=send` 再派发 Enter 键代发
  （与 muv-choice-btn 委托同一口径）。

### ✨ 运行时变量回灌 → era 桥双源合并（卡的数据区不再空白）

此前 era 桥只送**卡声明的初始变量**（`/api/muv-table/tavern-card` 的 `initvarData`），
本会话跑出来的运行时数值没有任何通路（`/api/muv-engine/extract` 零调用方）——
卡里 世界树/世界信息/数值区 全空、数据驱动的自适应布局塌成半截（"底部缺一半"的根因之一）。
现在：
- 装饰管线（`_decorateOne`）在消息含 `<UpdateVariable>`/`<initvar>` 块时把它们 POST 给
  `/api/muv-engine/extract`（服务端 `mergeState` 进会话状态；按会话+内容签名去重，
  定位不到会话**宁可回灌**不污染 default）；
- `muvEraFetchVars` 升级为双源：初始变量（base）⊕ `/api/muv-engine/state` 的运行时状态
  （`muvDeepMerge`，运行时覆盖初始），era 桥投递合并后的变量树。
- 局限（如实记录）：ST 里 `_足控天堂2` 的数据其实来自**用户装的酒馆助手「ERA变量框架」
  脚本**（每楼快照，DSH 没有酒馆助手执行器跑不了它）——本修复覆盖"变量随消息文本走"
  的 MUV 约定卡；框架脚本型卡要等变量框架原生实现（见 HANDOFF 待办）。

### 🧪 门禁
- `verify-card-compat.mjs`：夹具 KEEP 正则补 `PushChatLog`（`muvPushChatLog` 不含
  "muvChat" 子串此前匹配不到 ⇒ 夹具 pushChat 落 no-op ⇒ ③b 恒红）。`--old-export` 下
  after 24/0、before 红 16 条，对照成立。
- `test-client-render.mjs` 扩到 195（+[16] 交互桥/回灌/双源断言）。
- 全门禁复跑绿：status-cascade 84 · client-render 195 · regex-engine 21 ·
  decorate-dom 七类 · visual 77 · era-bridge（`世界信息.时间.日期` 前=—— 后=2026年8月26日）
  · card-compat · frame-height/ratchet · statusbar-layout/fence · tags-dom。

## 未发布（2026-09-22）

### ✨ 游戏卡标签的原生路径渲染（G_gamecard 门禁转绿）

`赏令接取 / 赏令完成 / 拍卖购入 / 盲盒开启 / 道友收录 / 飞剑回信 / 自由开局`
七个卡牌专属标签此前**只有酒馆路径**渲染；原生路径（DSH 消息美化）整段露成裸文本
（HANDOFF §16.3 已知未覆盖第 1 条）。现在走与媒体/标签渲染同一套 DOM 段替换：
`muvRenderGameCards` 把配对标签替换为 `.muv-game-card`（`data-card` 属性 +
`.muv-game-card-title` 标题 + `.muv-card-field` 字段行），配色沿用已有的
`[data-card="…"]` 属性选择器 CSS，全部内容走 textContent 不解析 HTML。
真浏览器门禁 `verify-decorate-dom.mjs` 扩到第七类 `G_gamecard`（gameCards≥1、
无裸标签残留），七类全绿。

### 🧪 门禁探针修正（两层假象层叠出的「回归」）

- **起始高度替换打坏卡 CSS**：`verify-frame-height` / `verify-frame-ratchet` 探针用
  `/height:\d+px/` 的**第一个**匹配改写 iframe 起始高度，而真卡 CSS 里的
  `height:62px`（srcdoc 内、style 属性之前）会先被命中 —— 起始高度从未生效、
  卡布局反被改坏，「不收敛/视口回显」其实是探针自己制造的。现在只替换
  `style="display:block;width:100%;height:` 这一专属前缀后的高度。
- **Node 构建缺父页视口**：真实 DSH 在浏览器里构建 iframe，`rewriteVhMinHeight`
  读得到 `window.innerHeight`，把 `min-height:100vh` 烤成父页视口常量；Node 提取
  执行没有 `window` ⇒ 重写静默跳过 ⇒ 卡的 vh 在探针里跟着 iframe 高度伸缩 ⇒
  真·不动点。`loadClientRenderersFrom(src, doc, win)` 新增 `window` 桩参数，
  高度类门禁传 `{ innerHeight: 900 }`（探针窗口同构）。
- **判据随语义更新**：`min-height:100vh` 的 ST 平价语义下，`正文美化` 卡合法地
  钉在父页视口地板上（≈900），旧的 `<400` 与「不停在起始高度」判据改为
  「钉在地板 ±8px 死区」与「600/1500 档不得停在起始值」。
- `test-client-render.mjs` 两处与实现决策相反的断言更正（包围盒量不出来时
  **不报数**——§15.3 禁用 body.scrollHeight 视口回声兜底；iframe 自身 style
  无 max 上限——srcdoc 内 reset CSS 的 `max-width:100%` 不该连坐断言）。

### ✅ 门禁状态（2026-09-22 全绿）

test-status-cascade 84 · test-client-render 183 · test-regex-engine 21 ·
verify-decorate-dom 七类全过（含 G_gamecard）· verify-visual 77 ·
verify-frame-height / frame-ratchet / statusbar-layout / statusbar-fence /
tags-dom / choices-dom / media-dom / varblocks-dom / era-bridge 全部通过。

## v0.3.9 (2026-09-20)

### ✨ 原生路径补上「插画与视频」—— 目标里明确要求的那两项

在此之前，媒体渲染（`renderMediaTags`）与 `<插图>` **只存在于酒馆路径**的
`_tavernRenderTags` 里；DSH 原生消息路径上模型写 `<video src="…">` / `<插图>…</插图>`
**一个渲染器都没有**，用户直接看到裸标签文本。
现在原生路径走 **DOM 段替换**（`muvRenderMediaTags` / `muvRenderIllustrations`）：
`<video>`/`<audio>` → 带 `controls` 的真实元素，`<插图>` → 占位块，
`<img>` → `img.muv-img`（只带 `src`/`alt` + 惰性属性）。

**为什么不复用字符串管线**：媒体渲染产物里**没有**状态栏片段 ⇒ `applyDecoratedHtml`
会落到最后手段 `body.innerHTML = html`，而它的输入是 `innerText` ⇒ **markdown 立刻又全灭**。
（这条是实测出来的，不是推断；因此 ④ 与后面几类一律走 DOM 段替换。）

### 🔒 媒体/插图渲染的属性白名单（安全）

媒体标签文本**来自模型或角色卡，属不可信输入**。直接 `innerHTML` 等于把
`onerror=` 请进 DSH 自己的同源页面。现在的做法：用 `DOMParser` 解析**离线文档**，
再按 `MUV_MEDIA_ATTRS` 白名单逐属性拷贝，**`on*` 一律丢弃**；`<插图>` 的名字走
`createTextNode`，不解析 HTML。
独立验证（真浏览器，标签带 `onerror="window.__pwned=1"`、src 指向不存在的域名 ⇒
只要处理器活着就必然触发）：**`window.__pwned` 未被赋值**；同时确认媒体元素**确实被建出来了**
（否则「没执行 on*」会因为「压根没渲染」而假绿）。

### ✨ 原生路径的标签渲染（原来大量标签外泄成裸文本）

之前原生路径只处理 `<choices>`/状态栏/变量赋值那几类，其余标签**原样显示给用户**
（等于把提示词外壳泄漏出去）。现在改成**表驱动**的 `MUV_TAG_RULES`（一处定义，集合不会漂移）：

- **展示类**：`<speech>` `<dialogue>` `<引用|quote>` `<char|character>` `<inner>` `<Drama>`
  `<story>` `<narrative>` `<action>` `<thought|thinking>`(💭) `<feeling|emotion>` `<expression>`
  `<pose|posture>` `<location|scene>`(📍) `<time>`(⏰) `<weather>`(🌤️) `<CG>`(🎨)
  `<inventory|背包>`(🎒折叠卡) `<skill|技能>`(⚔️折叠卡) `<JSONPatch>`(折叠卡) `<sep>` `<hr>`
- **变量块**：`<UpdateVariable>` / `<VariableEdit>` / `<VariableInsert>` → 折叠卡
  （原来整块 JSON 糊在屏幕上）
- **`<Abstract>`** → 摘要块
- **内部块整段删除**：`<rule_check>` `<rule_*>` `<dungeon_engine>` `<user_setting>`
  `<system_prompt>` `<status_current_variable>` `<Analysis>` `<style …>`
  （只删**整块配对**的形态；没有收尾标签的宁可留着，不误删正文）

### 🧩 markdown 保全（延续 0.3.8 的两类，本版再多两类）

这些新增渲染**全部**走 DOM 段替换，只替换标签所在的那一段文本，消息里其余 DOM 原样保留
⇒ 整条消息的 markdown（`**粗体**`/`##`/代码块/列表）不再被 `body.innerText` → `innerHTML`
的往返抹掉。真浏览器门禁 `verify-decorate-dom.mjs` 现在覆盖**六类消息**，
每类都要求 **markdown 存活** 且 **该渲染的东西真的渲染了**（两个方向都钉）：

| 消息 | 判据 |
| --- | --- |
| `A_choices` | 选项按钮 ≥1 |
| `B_header` | 状态栏 ≥1 |
| `C_media` | `<video>` ≥1 且 `<插图>` ≥1 |
| `D_xss` | 同上 **且** `window.__pwned` 未赋值 |
| `E_variable` | 变量折叠卡 ≥1 且摘要块 ≥1 **且无裸标签残留** |
| `F_tags` | speech/dialogue/char/location 均 ≥1 **且无裸标签残留** |

### 修复：卫生 pass 一个 `try` 包住多步 → 前一步失败静默带走后面几步

一次探针少注入一个依赖 → 表头折叠抛 `ReferenceError` → 选项按钮等后面几类**一起没渲染**，
而页面不报任何错。现在每步独立 `try` + 各自 `console.error`。

### 测试

`test-client-render` 137 → **175**；`test-status-cascade` 84；`test-regex-engine` 21。
真浏览器门禁：`verify-decorate-dom`（六类 + 注入安全）、`verify-visual` 76、`verify-statusbar-layout`；
新增 `verify-tags-dom` 17 项、`verify-varblocks-dom`、`verify-media-dom` 10 项。

### 已知未覆盖

卡牌专属的**游戏标签**（赏令接取 / 赏令完成 / 拍卖购入 / 盲盒开启 / 道友收录 / 飞剑回信 / 自由开局）：
酒馆路径对它们是「按卡字段渲染信息卡」（上百行 + 每卡色板），原生路径**仍会露成裸标签**，
单列一类，未做。

## v0.3.8 (2026-09-20)

> 说明：v0.3.7 是 `allow-same-origin` 的安全回退版，记录在下面 v0.3.6 一节里。

### 🔴 修复：酒馆面板里「卡的整页 HTML 被内联进聊天 DOM，卡样式泄漏到整个面板」

`renderFencedHtml`（把围栏整页文档转成 iframe）**只挂在 DSH 原生消息路径上**；
酒馆面板走的是另一条 `_tavernRenderTags`，它不做这一步，而面板是
`contentEl.innerHTML = html`。于是卡文档里的 `<style>`（全局生效）和
`html,body{height:100%}` 直接落进聊天 DOM —— 这就是「状态栏只剩一个头部条 / 满屏代码文本 /
内容列被压扁」的机制。
实测：**9 条真卡整页文档里 8 条**在这条路径上没有被转成 iframe。
修法是一行，插在**转义还原之后**（DSH 若把标签转义成 `&lt;!DOCTYPE`，放在还原之前会认不出来）。
进 srcdoc 之后卡自己的标记全被转义，后续媒体/标签正则再也碰不到卡页面内部。

### 🔴 修复：装饰消息会把整条消息的 markdown 抹掉

`_decorateOne` 用 `body.innerText` 取文本再 `body.innerHTML = html` 写回。
`innerText` 返回的是**渲染后**的文本 —— `**粗体**` 读出来就是 `粗体`、`##` 读出来就是标题、
代码块读出来是裸代码，**格式信息在写回时已经不存在了，不可逆**。
真实命中率：`异世界农场` 的 `**` 有 352 处、`涩涩提瓦特` 604、`食人世界` 792。
只对**含 muv 标记**的消息触发，所以症状是「有的消息正常、有的突然全变纯文字」。

改成分两类逐类处理（**只补丁需要变的那一段，其余 DOM 原样留着**）：
1. **纯 `<choices>` 消息**：补上 DOM 层的选项渲染器 `muvRenderChoices`，然后让
   `beautifyMuv` 在 `normalized === text` 时原样返回，整条替换根本不触发。
   （注：`muvSanitizeNode` 的 docblock 早就写着「这一步会把 `<choices>` 变按钮」，
   但**当时 DOM 层并没有这个渲染器** —— 注释描述的是意图，不是事实。）
2. **带 `『📅…|⏰…|📍…』` 表头 / `<StatusPlaceHolderImpl/>` 的消息**：
   表头折叠搬到 DOM 层（`muvFoldStatusHeader`，规则与 `normalizeStatusHeader` 复用同一份），
   `applyDecoratedHtml` 增加「占位符文本段」的落点。

**验证方式（`verify-decorate-dom.mjs`，真浏览器 + 真实模块 + 真实 `_decorateOne` + 真实 DOM）**：

| 消息 | 修复前 | 修复后 |
| --- | --- | --- |
| 纯 `<choices>` | `strong/h2/pre/li = 0/0/0/0`（选项仍有 2） | `1/1/1/2` + 选项 2 |
| 表头 + 占位符 | `0/0/0/0`（状态栏仍有 1） | `1/1/1/2` + 状态栏 1 |

### 修复：iframe 固定 600px 会裁掉真卡内容

实测（内容包围盒，与起始高度无关）：`ERA 状态栏` 926px、`主页` 2082px、`正文美化` 241px
—— 而 iframe 写死 600px，`主页` 被裁 **约 71%**，截图里 "Profile." 卡片被从中间切断。
改成**跨源 `postMessage` 自动撑高**（**不加 `allow-same-origin`**：同源后卡内探测
`window.parent.document` 的代码会全部变活，见 HANDOFF §9）：
子文档自己量、只回一个数字；父页校验 `event.source` 就是某个 `iframe.muv-iframe` 的
`contentWindow`（不查 origin —— 沙箱是不透明来源，其 origin 恒为 `"null"`），
值夹取 `[160, 2400]`，差值 < 8px 不动，**只改高度、不 eval/不插入/不转发**；
收不到报数就维持 600px，**不会比修之前更差**。

⚠️ 度量指标是关键：`documentElement.scrollHeight` / `body.scrollHeight` 在
`html,body{height:100%}` 的卡上**等于视口高**，会形成不动点（正文美化内容仅 241px，
却会把你给它的任何高度原样报回）。必须用**内容包围盒**。

### 修复：状态栏字段被塞进三列网格 / 角色名没有独立块

- `.muv-sb-sub` 的 `grid-template-columns: 245px 245px 245px` 是「两个字段挤在一行」的真正根因。
  早先那次修复改的是 `.muv-sb-body{flex-direction:column}` —— **改错了选择器**，bug 没修掉只换了触发条件。
- `.muv-sb-char` / `.muv-sb-char-name` 这套 CSS 类**渲染器从来不输出**（yaml / free 两个级联都没用），
  角色名只是一行夹在字段流里的加粗字。现在两个级联都输出独立角色块。
- 顺带清掉一个死类 `.muv-sb-empty`：卡没有状态栏正则、变量也读不到时，
  `<StatusPlaceHolderImpl/>` 会原样留在消息里被用户看见。

### 修复：`extractStatusBarHtml` 不剥「无语言标记」的裸围栏

真卡写的是裸 ```` ``` ````，而原实现只匹配带 `html` 语言标记的围栏，
于是首尾反引号被带进 srcdoc，卡页面上多出两行反引号文本。
现在只在**同时满足**「围栏包住整串」且「剥出来确实是整页文档」时才剥一层 ——
普通 js 代码块、非整页文档、只有单边围栏都不动。

### 修复：媒体标签解析会改写卡自己的代码 / 吞掉属性里的 `>`

- 卡自带 `<script>` 里的 `<audio>/<video>` 是**代码不是标记**，老实现照改不误：
  实测把 `const AUDIO_RE = /<audio>(.*?)<\/audio>/g;` 改成了 div，还把
  `let lastName = '';` 转义成 `&#39;&#39;`（**JS 语法错误，整页脚本报废**）。
  现在 `<script>…</script>` 范围内一律不动。
- `<video data-x="a>b" src="m.mp4">` 里的 `>` 在引号内，不算标签结束（`readStartTag` 引号感知）。
- 「有属性但没 src」的媒体元素（由卡的 JS 随后赋 src，如 `<video id="carVid">`）
  **原样保留** —— 降级成占位会让卡里的 `getElementById` 拿不到元素。只有**一个属性都没有**的
  裸提示词才降级成占位。

### 修复：围栏配对按 markdown 语义（不再被文档内部的代码围栏腰斩）

收尾围栏要求反引号数 ≥ 开围栏且独占一行；开围栏必须独占一行、信息串不含反引号。
四反引号围栏、CRLF 都覆盖。旧实现在文档正文含三反引号时会**腰斩 + 让剩余 HTML 裸奔在 iframe 外面**。

### 修复：卫生 pass 一个 `try` 包住多步 → 前一步失败静默带走后面几步

一次探针少注入一个依赖 → 表头折叠抛 `ReferenceError` → 选项按钮等后面几类**一起没渲染**，
而页面不报任何错。改成每步独立 `try` + 各自 `console.error`。

### 修复：取状态栏片段的写死正则

原为 `/<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/`，
**假定末尾恰好连着三个 `</div>`**；真实产物里卡自带整页 HTML 时是 `<iframe…></iframe>`
（零个内层 div）、空状态是两个 → 匹配不上就静默退化成「整条替换」（markdown 又全灭）。
改成按 div 深度配平扫描。

### 测试

`test-client-render` 71 → **137**、新增 `test-regex-engine` **21**、`test-status-cascade` **84**。
真浏览器门禁：`verify-visual.mjs` **76**、`verify-statusbar-layout.mjs`、`verify-decorate-dom.mjs`。

## v0.3.6 (2026-09-20)

### 🔴 更正：llow-same-origin 已回退（0.3.6 引入的安全回归）

0.3.6 曾把 `MUV_CARD_SANDBOX` 放开为 `'allow-scripts allow-same-origin'`，
**理由是错的，已回退为 'allow-scripts'**。复核推翻了两点：

1. **论据不成立**：当时称「卡要以 ES module 从 CDN 拉 Vue/Pinia、要读写 localStorage，
   不透明来源会失败」。实测那张 210219 字节的状态栏 HTML 里，`jsdelivr` 只出现在
   **内联脚本的字符串文本**中，不是外部 script src，也没有 `import`；URL 只有图片与
   视频。本页面也**没有任何 CSP** 兜底。
2. **危险是真实的**：`allow-scripts` + `allow-same-origin` 同时给出会让 srcdoc
   文档**继承父页来源**，`window.parent.document` 变成 DSH 的真实父文档。而卡自己的
   代码**正好就在探测它**（`window.parent.document` / `window.opener.document` /
   `window.parent.parent.document` 三段）——旧沙箱下全走 catch、等于空转，放开后立刻
   生效：可读写 DSH 页面 DOM、带登录凭据打 `/api/*`、读 `parent.location`。

「SillyTavern 也不沙箱」不能用来论证：ST 的卡跑在 ST 自己的 origin 里，受害面是 ST；
DSH 里同一个 iframe 与前端**同源**，受害面是 DSH。

仍需要同源能力的卡，请做成**显式 opt-in**（全局开关或按卡白名单），不要改默认值。

### ✨ 让角色卡自带的整页 HTML 真的渲染出来

社区卡（如「足控天堂」）的 `主页` / `正文美化` / `ERA状态栏` 三条正则，产出的
是**一整个 HTML 文档**（实测 56 / 45 / 205 KB），并用 markdown 围栏包起来：

    ```\n<!DOCTYPE html>\n<html>…几十 KB…</html>\n```

**问题**：在 SillyTavern 里这是「把这段当 HTML 渲染」的约定，但 DSH 的 markdown
渲染器会老实把它当**代码块**——用户看到的是几十 KB 原始 HTML 文本，界面完全出不来。

**修法**：新增 `renderFencedHtml()`，只挑**确实是 HTML 文档**的围栏（内容以
`<!DOCTYPE` 或 `<html` 开头）改走 iframe `srcdoc` 渲染；普通代码块
（```js / ```python / 无语言标记）**原样不动**——误伤代码块比不渲染更糟。

### ✨ `<video>` / `<audio>` 渲染成真实播放器

- 带 `src` 的标签原样保留为可播放元素，并补 `controls` 与 `preload="metadata"`
  （卡里可能一次给多个媒体，默认 `preload=auto` 会把整段都预载下来）
- 只有模型随手写的**裸提示词**（`<audio>轻快的BGM</audio>`，无 src）才降级成文字占位
- 抽成具名函数 `renderMediaTags()`，便于回归测试直接取源码执行


## v0.3.5 (2026-09-20)

### 📦 发布内容修正

- **把 `diag.mjs` 与 `test-status-cascade.mjs` 纳入 npm 包**。0.3.4 的 README 让用户跑
  `node diag.mjs` / `node test-status-cascade.mjs`，但 `files` 字段没列这两个文件，
  从 npm 安装的人根本拿不到 —— 文档与包内容不一致。现在一并发布，按 README 的说明
  即可直接在本机复现诊断与回归。
- `README.md` 显式列入 `files`（npm 本来也会自动带上，写明是为了让发布内容一目了然）。

> 0.3.4 的功能改动见下。

## v0.3.4 (2026-09-20)

### 🐛 修复：状态栏只剩一个头部条（YAML 形态丢角色与字段）

瑟瑟提瓦特那类 `标签: "值"` 的结构化状态栏，渲染后**只剩时间地点一行**，
角色、字段、选项全没了。两个原因：

- **条目被要求在行首**：旧实现按行匹配 `^-\s*用户:`，而实际文本里第一条前面
  挂着 `用户列表:` 前缀（`用户列表: - 用户: 名字: "🎀 安柏" …`），于是**第一条
  角色整条丢失**。现在按 `- 用户:` / `- 角色:` / `- NPC:` 标记切分，标记出现在
  行内任意位置都算。
- **字段被写死**：旧实现只提取 名字/行动/内心/衣着 四个字段，而卡片实际会给出
  穿搭、小穴、胸部、肛门、阳具、最近性行为…… 全部被丢掉。现在按
  `标签: "值"` 通用提取，标签是什么就渲染什么。

同时修掉选项解析的两个问题：选项挤在一行时（`选项: - "1.…" - "2.…"`）无法拆分，
以及 `行动选项: 名字: "柊木" 选项: …` 里的名字被误当成第一个选项。

### 🐛 修复：取错角色卡导致正则全不执行（图片 / 隐藏块失效）

`fetchTavernCard()` 只用 `sessionId` 定位角色卡。当会话服务未暴露、URL 不带 id、
数据属性也缺失时（三种兜底全落空），请求就不带任何参数，服务端回退到默认预设 ——
**于是拿到的是别人的卡**。后果不是报错，而是**卡的全部正则静默不执行**：

- `<img>下雨天打伞9gvycu.png</img>` 不被替换，图片不显示
- 卡自带的「隐藏记账块」正则不生效，`<UpdateVariable>` / `<JSONPatch>` /
  `<Analysis>` 连同 JSON 一起糊在屏幕上

现在改为**优先用 tavern DOM 上的当前预设**（`#tavern-session-preset-label` 等，
与酒馆自身认定的单一事实来源一致），`sessionId` 作为补充。实测两张卡都能正确
带出各自的图片规则。

### 🐛 修复：行动选项整段消失

- **字母选项被丢弃**：状态栏里的 `行动选项:` 后面写 `A. 搭话` / `B. 离开` 时，
  整段选项会被解析器静默丢掉。原因是 yaml 级只认 `- `/`• ` 前缀，free 级只认
  `1.` 前缀，而 loose 级压根没有选项概念。现在三级都走同一套
  `stripOptionMarker`，支持 `A.` `A、` `1.` `1、` `-` `•` 以及无前缀的裸选项。
- **`## 行动选项` 不识别**：模型（和 markdown 渲染）常给这个标题加 `#`/`**`
  装饰，之前会导致标签失配、整个列表变成普通字段行。现在会先剥掉装饰再匹配。
- **选项被状态栏重写抹掉**：消息装饰器用 `innerHTML` 整体替换后，`<choices>`
  已经被 sanitize 渲染出的按钮会被冲掉，且元素带着 `data-muv-sanitized` 标记
  永远不会再处理。现在重写后对该元素清标记并重跑一次 sanitize。

### ✨ 适配更多角色卡

- 选项标题支持英文：`Options` / `Choices` / `Actions` / `Select`。
- 章节标签不再重复渲染（`[Character Status]` 之前会同时作为章节和普通行出现两次）。

### 🔌 让「导入任意角色卡」真的成立（两个静默失败的缺口）

- **纯 `<choices>` 回复不渲染**：`beautifyMuv` 的入口闸门只认状态栏类标记，
  于是「一段剧情 + 一组选项、没有状态栏」这种社区卡最常见的回复会被整体跳过，
  选项永远不出现（不报错、页面无异常，所以像是凭空消失）。现在闸门接受
  `<choices>`，并在返回前显式渲染选项——因为这类消息没有 `<Status_block>`
  给级联替换。
- **`innerText` 把选项压成一行**：装饰器按 `innerText` 取文本，而 DSH 把整个
  `<choices>` 块渲染在同一个 `<p>` 里时，`innerText` 会把换行折叠成空格
  （`<choices> A. 搭话 B. 离开 </choices>`），按 `\n` 分行就只解析出一个选项。
  现在同时按行内选项标记（`A.`/`A、`/`1.`/`•`）断行。
- **消息定位改用形状匹配**：`muvSanitize` 原先用 `[class*="_markdown"]`，既会
  误伤同名的文件类型图标模块，又依赖会随 DSH 重建变化的 CSS Modules 哈希。
  现按 `_markdown_<hash>_<n>` 形状 + 块级子节点判定（与酒馆客户端同一套规则），
  并补上 `[data-role="assistant"]` 等显式标记退路，旧版外壳同样能命中。

### 🔌 支持「变量编辑块」类角色卡

- **新增标签识别**：`<VariableInsert>`（卡里定义的）、`<VariableEdit>`（模型实际发出的）、
  `<UpdateVariable>`（MUV 原生）现在都会被识别并收进折叠卡片，而不是把 JSON 与标签
  整块糊在屏幕上。`<VariableThink>` 折叠为「变量推演」，`<Abstract>` 渲染成剧情摘要。
- **入口闸门同步放宽**，否则含这些标签的消息根本进不了渲染函数（静默失败）。
- 这些块是给变量面板吃的，不是给用户读的正文，所以默认折叠、JSON 内容美化缩进。
- 根因说明：社区卡常在开场白里用 `<VariableInsert>` 示范一次变量结构，却不写输出
  格式约定，模型便自行推演出 `<VariableEdit>`/`<VariableThink>`/`<Abstract>` 等名字。
  插件的别名兼容负责兜底，预设里写死输出协议才是根治（见 muv-table 的对应改动）。

### 🧪 测试

- 回归用例 46 → 71，新增「四种选项标记」「预设理想格式端到端」「英文/markdown
  装饰标签」三组；另用无头 Edge 在真实 DOM 形状下验证了目标选择与按钮布局。

## v0.3.3 (2026-09-13)

### 🐛 修复

- **`<choice>` 单数标签不渲染**：选项解析写死了 `/<choices>…<\/choices>/`，
  而相当多的角色卡写的是单数 `<choice>…</choice>`（例如从 SillyTavern 导入的卡），
  结果整块选项**原样当文本显示**、点不了。改为 `/<choices?>…<\/choices?>/` 同时兼容单复数。
- **第 5 个及以后的选项会露出编号**：前缀剥离只认 `A-D` / `1-4`，超出范围的选项会带着
  `5. ` 一起渲染。放宽到 `A-H` / `1-9` / 一~九。

### ✨ 新功能：没有「状态栏」正则脚本也能渲染内置状态栏

以前 `<StatusPlaceHolderImpl/>` 必须靠角色卡里的「状态栏」正则脚本提供 HTML，
卡片不带这条脚本就什么都渲染不出来（占位符原样留着）。现在引擎自己会**兜底**：
从 `<UpdateVariable>` 里把变量抽出来，直接生成一张状态栏卡片。

自动读到的变量与呈现方式：

| 变量 | 呈现 |
| --- | --- |
| `系统.日期[0]` / `系统.时间[0]` / `系统.地点[0]` | 顶部一行 📅 🕒 📍 |
| `user.位置[0]` / `user.当前状态[0]` | 胶囊标签「🧍 你 · 位置 · 状态」 |
| `*.位置[0]` | 胶囊标签「👥 名字·位置 …」 |
| `*.好感度[0]` | 进度条，按数值分三档换色 |

一个变量都没抽到时**返回空字符串**，不会留一张空卡片。

### 🎨 美化：状态栏卡片重做

- 圆角卡片 + 细边框 + 轻微投影，顶部一行换成柔和的紫→粉渐变底。
- 好感度从单列的窄条改成 **自适应多列网格**（`minmax(215px, 1fr)`），
  14 个角色不再堆成一长条。
- 好感度进度条按数值分档配色：**≥80 粉红**、**≥50 紫粉**、**<50 蓝紫**，
  一眼能看出谁跟你关系近。
- 名字过长自动省略号，数值用等宽数字右对齐，不再抖行。
- 全部样式内联在注入的 `<style>` 里，不依赖主题变量（都带 fallback）。

### 📝 注意：状态栏需要卡片里带「状态栏」正则脚本

`<StatusPlaceHolderImpl/>` 要渲染成 iframe 状态栏，必须能从角色卡里取到 HTML 模板：

```js
extractStatusBarHtml(scripts)
  // 需要 scriptName 含「状态栏」且 findRegex === '<StatusPlaceHolderImpl/>'，
  // 取它的 replaceString 作为 HTML
```

只写占位符、没有这条正则脚本的卡片，会走上面描述的**内置兜底状态栏**；
如果连 `<UpdateVariable>` 变量都没有，占位符才会被原样保留。

---

## v0.3.2 (2026-09-13)

### 🐛 修复

- **跨包导入路径错误会导致 DSH 完全无法启动**：`lib/index.js` 与 `lib/var-tracker.js`
  使用了 `'../../muv-table/lib/*.js'`。从 `node_modules/dsh-muv-engine/lib/` 回退两级会解析到
  `node_modules/muv-table/`，但依赖包名是 **`dsh-muv-table`**，npm 上也不存在名为 `muv-table` 的包。

  实测三种布局全部失败：

  ```
  flat 布局      -> Cannot find module '...\node_modules\muv-table\lib\muv-parser.js'
  pnpm 符号链接  -> Cannot find module '...\.pnpm\dsh-muv-engine@0.3.1\node_modules\muv-table\...'
  hoisted 布局   -> Cannot find module '...\node_modules\muv-table\lib\initvar-parser.js'
  ```

  后果不止于本插件：模块 import 失败会让该 loader 行激活失败，而 DSH 的 `boot()` 末尾会执行
  `assertEntriesActivated()`，**任何一行未激活就抛错并销毁上下文 —— 整个 DSH 起不来**。
  而 `dsh plugin add` 会把所有声明了 `dsh.bundle` 的依赖自动加入 `dsh.profile.bundles`，
  所以 README 里的安装命令执行后重启必然失败。

  改为裸包名 `dsh-muv-table/lib/*`。

### 📦 依赖

- 新增 `dsh-muv-table: ^0.2.2`。此前只有 optional `peerDependencies`，
  安装本包时不会带上依赖，导致上面的导入必然解析失败。

---

## v0.3.0 (2026-08-31)

### ✨ 新功能（融合 dsh-visual-render）
- **visual 代码块渲染**：聊天里的 ` ```visual ` 代码块自动渲染为沙箱 HTML 界面（信纸/终端/报纸/手机/浏览器组件），iframe sandbox 隔离
- **options 代码块**：渲染成可点击的三选一剧情选项按钮
- **aside 代码块**：淡色小字旁白
- **scene 代码块**：场景标题卡片
- **视觉渲染状态面板**：侧边栏显示渲染数量与说明

### 🆕 标签渲染增强
- **`<choices>` 宽松解析**：按行分割选项，支持 `A、` / `1.` / `•` / 无前缀，渲染为可点击按钮
- **`<Drama>` 戏剧卡片**：暗红渐变卡片 + 折叠标题 + `.mys` 内容区预置样式
- **`<style>` 剥离**：世界书格式模板的 CSS 块渲染时自动移除，不展示给用户
- **转义形态兼容**：`&lt;标签&gt;` 转义文本还原为真实标签再渲染（DSH 可能转义 LLM 输出的 XML）

### 🎨 CSS 美化
- 表演标签独立颜色：`<speech>` 斜体灰、`<action>` 绿、`<thought>` 紫、`<char>` 金、`<feeling>` 粉、`<pose>` 天蓝
- 游戏卡片独立配色：赏令金/盲盒紫/拍卖青/道友蓝/飞剑青绿/自由橙（`data-card` 属性驱动）

### 🔧 改进
- `_tavernRenderTags` 开头自动展开宏 + 还原转义标签
- 服务端宏展开 API：`POST /api/muv-engine/expand-macros` 与 `/reroll-pick`

---

## v0.2.0 (2026-08-27)

### ✨ 新功能
- **宏展开引擎**：`{[random::A::B::C]}` `{[pick::key::A::B::C]}` `{[roll::NdM+K]}` 三种方括号宏语法
  - `random`：每次随机选一个选项
  - `pick`：同页面固定结果，缓存键为 key，支持 `_tavernRerollPick(key)` 重抽
  - `roll`：标准 RPG 骰子记法，支持调整值（如 `{[roll::2d6+3]}`）
- **输入拦截器**：自动查找聊天输入框，拦截 Enter 和 form submit，在消息发送前展开宏
- **全局调试接口**：`_tavernExpandMacros()` `_tavernRerollPick()` `_tavernListPicks()`

---

## v0.1.0 (2026-08-26)

- 初始版本：正则脚本引擎、变量状态追踪、StatusPlaceHolderImpl iframe 渲染、LaTeX 渲染、通用标签转译