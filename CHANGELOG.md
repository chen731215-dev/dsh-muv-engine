# Changelog

## v0.2.0 (2026-08-27)

### ✨ 新功能
- **宏展开引擎**：`{[random::A::B::C]}` `{[pick::key::A::B::C]}` `{[roll::NdM+K]}` 三种方括号宏语法
  - `random`：每次随机选一个选项
  - `pick`：同页面固定结果，缓存键为 key，支持 `_tavernRerollPick(key)` 重抽
  - `roll`：标准 RPG 骰子记法，支持调整值（如 `{[roll::2d6+3]}`）
- **输入拦截器**：自动查找聊天输入框，拦截 Enter 和 form submit，在消息发送前展开宏
- **服务端宏展开 API**：`POST /api/muv-engine/expand-macros` 和 `/api/muv-engine/reroll-pick`
- **全局调试接口**：`_tavernExpandMacros()` `_tavernRerollPick()` `_tavernListPicks()`

### 🎨 CSS 美化增强
- 表演标签独立颜色：`<speech>` 斜体灰、`<action>` 绿色 `#9dd898`、`<thought>` 紫色 `#c49ce8`、`<char>` 金色 `#ffdd99`、`<feeling>` 粉色 `#ff9eaa`、`<pose>` 天蓝 `#94d2e8`
- `<dialogue>` 蓝色左边框、`<location>` 深紫背景卡片
- 游戏卡片独立配色：赏令金、盲盒紫、拍卖青、道友蓝、飞剑青绿、自由橙

### 🔧 改进
- `_tavernRenderTags` 开头自动调用 `_expandMacros`，宏展开后渲染标签
- 游戏卡片渲染增加 `data-card` 属性，支持独立 CSS 配色

---

## v0.1.0 (2026-08-26)

- 初始版本：正则脚本引擎、变量状态追踪、StatusPlaceHolderImpl iframe 渲染、LaTeX 渲染、通用标签转译