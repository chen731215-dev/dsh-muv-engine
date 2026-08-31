# ⚙️ dsh-muv-engine

DSH 原生 MUV 引擎 —— 酒馆伴生插件。

> 🔗 依赖 [dsh-muv-table](https://github.com/chen731215-dev/dsh-muv-table)，配合 [dsh-tavern-v2](https://github.com/chen731215-dev/dsh-tavern-v2) 使用。

## 是什么

替代 MagVarUpdate 的 DSH 原生实现，v0.3.0 起融合了 dsh-visual-render：

### 🎮 变量与状态
- **正则引擎**：执行角色卡 `regex_scripts`，实时替换 LLM 输出
- **变量追踪**：跨对话轮次追踪变量状态，自动提取 `<UpdateVariable>` 块
- **状态栏渲染**：提取 `<StatusPlaceHolderImpl/>` 的 HTML，iframe 沙箱渲染

### 🎲 宏展开
聊天输入框内直接写宏，按 Enter 自动展开后发送给 AI：

```
{[random::去酒楼::去坊市::去洞府]}     → 每次随机选一个
{[pick::宝箱::灵石x50::剑谱::丹药]}    → 固定结果，缓存为「宝箱」
{[roll::2d6+3]}                       → 掷 2d6 加 3 调整值
```

- 支持调整值：`{[roll::1d20+5]}`、`{[roll::3d6-1]}`
- pick 缓存可用 `_tavernRerollPick('key')` 重抽（浏览器控制台）
- 控制台调试：`_tavernExpandMacros('...')` / `_tavernListPicks()`

### 🏷️ 标签渲染
AI 输出自动美化（`_tavernRenderTags` 钩子），支持**转义形态**（`&lt;标签&gt;`）：

| 标签 | 效果 |
|---|---|
| `<speech>` | 斜体灰色对白 |
| `<action>` | 绿色斜体动作 |
| `<thought>` / `<thinking>` | 紫色斜体内心 |
| `<char>` / `<character>` | 金色粗体角色名 |
| `<dialogue>` | 蓝色左边框 |
| `<赏令接取>` ~ `<自由开局>` | 独立配色游戏卡片（金/紫/青/蓝/青绿/橙） |
| `<Drama>` | 暗红渐变戏剧卡片（含 `.mys` 内容区样式） |
| `<choices>` | 选项按钮（按行解析，支持 `A、`/`1.`/`•`/无前缀） |
| `<style>` | 自动剥离（世界书模板 CSS 不展示） |
| `<inventory>` / `<背包>` / `<skill>` | 折叠列表卡片 |
| `<quote>` / `<引用>` | 引用块 |

### 🖼️ visual 代码块渲染（融合 dsh-visual-render）
聊天里 `` ```visual `` 代码块自动渲染为沙箱 HTML 界面：

- 信纸 / 终端 / 报纸 / 手机 / 浏览器组件
- `options` 代码块 → 可点击剧情选项按钮
- `aside` 代码块 → 淡色旁白
- `scene` 代码块 → 场景标题卡
- iframe `sandbox` 隔离，安全运行

### 🌠 LaTeX 渲染
`\(...\)` 公式自动渲染（含 array/fcolorbox/colorbox/textcolor/rule 等）。

## 安装

```bash
dsh plugin --profile web add dsh-muv-engine
```

## API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/muv-engine/expand-macros` | POST | 服务端展开宏（random/pick/roll） |
| `/api/muv-engine/reroll-pick` | POST | 清除 pick 缓存 |
| `/api/muv-engine/apply-regex` | POST | 对文本执行正则脚本 |
| `/api/muv-engine/apply-regex-card` | POST | 从卡片 JSON 执行正则 |
| `/api/muv-engine/state` | GET/POST | 获取/更新变量状态 |
| `/api/muv-engine/extract` | POST | 提取 `<initvar>` 并生成 MUV 块 |
| `/api/muv-engine/generate` | POST | 编辑后生成 MUV 块 |
| `/api/muv-engine/status-bar` | POST | 提取状态栏 HTML |

## 协议

PolyForm-Noncommercial-Copyleft-1.0.0 — 详见 [LICENSE](./LICENSE)