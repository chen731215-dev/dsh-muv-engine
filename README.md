# ⚙️ dsh-muv-engine

DSH 原生 MUV 引擎 —— 酒馆伴生插件。

> 🔗 依赖 [dsh-muv-table](https://github.com/chen731215-dev/dsh-muv-table)，配合 [dsh-tavern-v2](https://github.com/chen731215-dev/dsh-tavern-v2) 使用。

## 是什么

替代 MagVarUpdate 的 DSH 原生实现，提供：
- **正则引擎**：执行角色卡 `regex_scripts`，实时替换 LLM 输出
- **变量追踪**：跨对话轮次追踪变量状态，自动提取 `<UpdateVariable>` 块
- **状态栏渲染**：提取 `<StatusPlaceHolderImpl/>` 的 HTML，iframe 沙箱渲染

## 安装

```bash
dsh plugin --profile web add dsh-muv-engine
```

## API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/muv-engine/apply-regex` | POST | 对文本执行正则脚本 |
| `/api/muv-engine/apply-regex-card` | POST | 从卡片 JSON 执行正则 |
| `/api/muv-engine/state` | GET | 获取当前变量状态 |
| `/api/muv-engine/state` | POST | 更新变量状态 |
| `/api/muv-engine/extract` | POST | 提取 `<initvar>` 并生成 MUV 块 |
| `/api/muv-engine/generate` | POST | 编辑后生成 MUV 块 |
| `/api/muv-engine/status-bar` | POST | 提取状态栏 HTML |

## 协议

PolyForm-Noncommercial-Copyleft-1.0.0 — 详见 [LICENSE](./LICENSE)