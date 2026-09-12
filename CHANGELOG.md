# Changelog

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