# Changelog

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