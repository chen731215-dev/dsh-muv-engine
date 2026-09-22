# 交接文档 · DSH 酒馆渲染链

> 写于 2026-09-20。读者是「换电脑后的你自己」或接手的人。
> 代码已推送到 GitHub，本地快照也在，两条路任选。

---

## 1. 这是什么

三个 DSH 插件，让 DeepSeek Harness 能像 SillyTavern 一样跑角色卡：

| 包 | 仓库 | 本地路径 | 分支 | 版本 |
|---|---|---|---|---|
| `dsh-muv-engine` | chen731215-dev/dsh-muv-engine | `C:\dsh-muv-engine` | `master` | 0.3.4 |
| `dsh-muv-table` | chen731215-dev/dsh-muv-table | `C:\dsh-muv-table` | `master` | 0.2.6 |
| `dsh-tavern` | chen731215-dev/dsh-tavern-v2 | `C:\dsh-tavern-v2` | `main` | 2.4.0 |

依赖方向：`tavern → muv-engine → muv-table`（muv-table 对 muv-engine 是 **optional peer**，可单独装）。

---

## 2. 换机后怎么恢复

### 方式 A：从 GitHub（推荐）

```powershell
cd C:\
git clone https://github.com/chen731215-dev/dsh-muv-engine.git dsh-muv-engine
git clone https://github.com/chen731215-dev/dsh-muv-table.git  dsh-muv-table
git clone https://github.com/chen731215-dev/dsh-tavern-v2.git  dsh-tavern-v2
```

### 恢复步骤是否真的可用？—— 已实测

本节这套步骤**不是推测出来的**：`verify-handoff-restore.mjs` 会克隆到全新临时目录
（不碰开发树）逐项验证，然后清理。跑一次就知道文档有没有过时：

```powershell
node C:\dsh-muv-engine\verify-handoff-restore.mjs
```

2026-09-20 实测结果（15/15 通过）：三个仓库均可克隆、关键文件齐全、
`node_modules` 未被带进来、克隆出来的树上测试全通过
（engine 84 + 32、table 28 + 56 + 30）、`diag.mjs` 能找到 `dsh-muv-table`。

> 首次运行时它抓到过一个真问题：`test-client-render.mjs` **提交了但没推送**，
> 克隆拿不到 —— 换机时那个文件会丢。**所以改完记得 push，光 commit 不够。**
### 方式 B：从本地快照

如果 GitHub 不可达，用 `C:\dsh-handoff\` 下的快照包（见同目录）。

### 恢复后必做：重建 junction

`dsh-muv-engine` 通过 **junction** 引 `dsh-muv-table`，junction 不能跨机器复制，
**必须重建**，否则 muv-engine 找不到 muv-table：

```powershell
# 先删掉可能存在的残留，再建
cmd /c rmdir "C:\dsh-muv-engine\node_modules\dsh-muv-table" 2>nul
cmd /c mklink /J "C:\dsh-muv-engine\node_modules\dsh-muv-table" "C:\dsh-muv-table"
```

### 挂进 DSH profile

三个都是 dev tree，用 junction 链进 web profile（原本就是这么做的）：

```
~/.dsh/profiles/web/node_modules/dsh-muv-engine -> C:\dsh-muv-engine
~/.dsh/profiles/web/node_modules/dsh-muv-table  -> C:\dsh-muv-table
~/.dsh/profiles/web/node_modules/dsh-tavern     -> C:\dsh-tavern-v2
```

### 最后：重启 DSH

**改动只有在重启后才生效** —— Node 在启动时缓存 ES 模块。
用 `node C:\dsh-muv-engine\diag.mjs` 可以确认「是否需要重启」。

---

## 3. 本次改了什么（都是「静默失败」，不报错）

### 3.1 状态栏级联（`dsh-muv-engine`）

| 现象 | 根因 | 修法 |
|---|---|---|
| 行动选项整段消失 | yaml 级只认 `- `/`• ` 前缀、free 级只认 `1.`、loose 级**没有选项概念**，`A.`/`B.`/`C.` 被静默丢弃 | 三级统一走 `stripOptionMarker`，支持 `A.` `A、` `1.` `-` `•` 与无前缀 |
| `## 行动选项` 不识别 | markdown 装饰（`#`、`**`）导致标签失配，整个列表退化成普通字段行 | 先剥装饰再匹配 |
| **整张卡只剩一个头部条** | ① 条目被要求行首是 `- 用户:`，而实际文本首条前挂着 `用户列表:` 前缀 → 整条角色丢失；② 字段被写死成 `名字/行动/内心/衣着` 四个 → `穿搭/小穴/胸部/肛门/阳具/最近性行为` 全丢 | 按 `- 用户:`/`- 角色:`/`- NPC:` 标记切分（行内任意位置）；按 `标签: "值"` **通用提取**，不再有白名单 |
| 选项挤一行拆不开 | 只按 `\n` 切分 | 同时按引号项与行内标记切分 |
| `名字:` 被当成第一个选项 | `行动选项: 名字: "X" 选项: …` 里的名字被引号匹配抓到 | 从 `选项:` 起才算选项 |

### 3.2 消息渲染（`dsh-muv-engine`）

| 现象 | 根因 | 修法 |
|---|---|---|
| **图片不显示 + 满屏 `<UpdateVariable>`/`<JSONPatch>`** | `fetchTavernCard()` 只用 `sessionId` 定位卡；三种兜底全落空时不带参数，服务端回退到别的预设 → **拿到别人的卡 → 卡的正则全部静默不执行** | 优先用 tavern DOM 上的当前预设（`#tavern-session-preset-label` 等），`sessionId` 作补充 |
| 纯 `<choices>` 回复不渲染 | 入口闸门只认状态栏类标记 | 闸门接受 `<choices>`，并在返回前显式渲染 |
| 选项只出一个按钮 | `innerText` 在 DSH 把整块渲染进同一个 `<p>` 时会把换行折叠成空格 | 同时按行内选项标记断行 |
| 误伤文件类型图标 | `[class*="_markdown"]` 与文件类型图标模块同类名 | 形状匹配 `_markdown_<hash>_<n>` + 块级子节点判定 |
| 变量块糊屏 | 不认 `<VariableInsert>`/`<VariableEdit>`/`<VariableThink>`/`<Abstract>` | 识别并收进折叠卡片；JSON 美化缩进 |

### 3.3 卡读取（`dsh-muv-table`）

- **新增 PNG 卡读取**（`lib/png-card.js`）：从 PNG 的 `tEXt`/`iTXt` 里解 `chara` 块。
  SillyTavern 的卡就是 PNG + base64 卡数据；DSH 自己的导入器只留 `{name,desc,first}`，
  **正则/世界书/tavern_helper 全丢**。现在直接读原始 PNG。
- 卡库搜索接入 `<SillyTavern>/data/<user>/characters`（可用 `DSH_SILLYTAVERN_DIR` 覆盖）。
- **变量面板显示错卡**：① 面板无 `presetId` 时服务端回退到硬编码的 `tavern-lite`
  （那个预设的 `muv-tables/card.json` 是 8 月留下的**苍玄界**，而它自己的 `characters.json`
  早已是川上富江）；② 面板把首次解析出的预设**缓存住永不更新**，切换预设后卡住。
  现在：新增 `/api/muv-table/active-preset`、面板每次轮询重读 DOM、managed 副本卡名
  不一致时不予采用。
- 新增 `extractMuvFromCharactersJson`：从 `characters.json` 提取变量表（酒馆把导入的卡存在这里）。

---

## 4. 怎么验证

```powershell
node C:\dsh-muv-engine\diag.mjs            # 一条命令体检（先跑这个）
node C:\dsh-muv-engine\diag.mjs --tests    # 附带跑回归
node C:\dsh-muv-engine\test-status-cascade.mjs   # 84 项
node C:\dsh-muv-table\test-png-card.mjs          # 12 项
```

`diag.mjs` 会检查：服务器是否加载了新代码（源码 vs 进程启动时间）、每个预设绑的哪张卡、
SillyTavern PNG 卡库、实时 API 返回、最近会话各自绑的预设。

**把一段消息过一遍渲染管线**（最有用的功能）：

```powershell
node C:\dsh-muv-engine\diag.mjs --preset <预设id> --msg-file <消息文本文件>
```

它会报：用了哪张卡、正则是否命中、有没有残留原始标签、生成的 `<img>`、以及外链图片是否可达。

---

## 5. 本机环境坑（换机后照抄）

| 坑 | 表现 | 对策 |
|---|---|---|
| **系统代理** | 代理在 `127.0.0.1:7897`；**Node 的 `fetch` 和 `git` 都不读系统代理** | git 要 `git config --global http.proxy http://127.0.0.1:7897`；探活外链走 PowerShell 或给 git 配代理。否则会报「图片挂了」「连不上 GitHub」的**假警报** |
| **`npm.ps1` 被拦** | 执行策略禁止运行脚本 | 一律用 `npm.cmd`，不要用 `npm` |
| **`.ps1` 文件也被拦** | 同上 | 命令内联跑，别写 `.ps1` 再执行（或改 ExecutionPolicy） |
| **端口** | DSH 在 **3080**，SillyTavern 在 **8000** | 别搞混；打错端口会看到 `Invalid CSRF token`（那是 SillyTavern 的 csrf-sync，不是 DSH） |
| **改动不生效** | Node 启动时缓存 ES 模块 | 改完必须重启 DSH；`diag.mjs` 会告诉你 |

---

## 6. 还没做的（下一步）

1. **视频 / 富 HTML 渲染**（原 t2，未开始）
   - 卡的 `主页` / `正文美化` / `ERA状态栏` 三条正则的 replaceString 合计约 **307 KB**，
     内含 `<script>` / `<iframe>` / `<video>` / CDN fetch（jsdelivr 的 Vue + Pinia）
   - muv-engine 现在把卡自带 HTML 塞进 `<iframe sandbox="allow-scripts">`，**缺 `allow-same-origin`**，
     CDN fetch 与脚本运行受限
   - `<audio>` 目前只渲染成文字占位「🎵 …」，没有真实媒体元素
   - 这是让它真正追上 SillyTavern 的关键一步，也是**深水区**（安全含义要想清楚）
2. 交叉验证任务（原 t3/t4）未执行 —— AgentTeams 成员 spawn 失败，已由队长接手
3. `tavern-lite/muv-tables/card.json` 是 8 月遗留的苍玄界，与它自己的 `characters.json` 不符 ——
   已被逻辑忽略，但**文件还在**，可清理
4. tavern-v2 远端有 11 个旧布局遗留文件（根目录的 `client.manager.bundle.js`、
   `find_unprotected*.js` 等），合并时**有意保留未删** —— 是否清理由你决定

---

## 7. 子代理（`@aiwayds/dsh-subagent-registry`）

三个预置 agent 在 `~/.dsh/agents/`：`oldfox.md`（老法师/审查）、`rubber-duck.md`（小黄鸭/视觉）、
`workhorse.md`（牛马狗/干活）。

**换机后这三个文件不会自己跟过来** —— 它们不在任何 git 仓库里。要么把 `~/.dsh/agents/`
整个目录拷过去，要么让插件重新植入预置（只在目录为空时植入）。

### 踩过的三个坑（都已修好，换机后要照做）

**① `tools.restrict() names unknown global tool "subagent"` —— 三个 agent 全部调不起来**

插件硬编码了叶子禁用列表：

```js
// node_modules/@aiwayds/dsh-subagent-registry/lib/tool-run-agent.js
export const SPAWN_TOOL_NAMES = ['subagent', 'subagent_fork', 'workflow', 'ralph'];
// deep:0 → deny = [...SPAWN_TOOL_NAMES, toolName]
```

而本部署**没有 `subagent` 这个工具**（只有 `subagent_fork`），`tools.restrict()` 遇到未知
工具名直接抛错。**修法**：在 `~/.dsh/profiles/web/cordis.patch.yml` 加 id 定向配置覆盖
（非空 `leafDenyTools` 会整体替换默认列表）：

```yaml
- id: dsh-subagent-registry
  config:
    leafDenyTools: [subagent_fork, workflow, ralph, use_agent]
```

需要重启生效。

**② agent 文件里的 provider 根本不存在**

预置文件写的是 `volc-ark-plan/...` 和 `digitalvolvo/...`，但本机注册的只有四个 provider：

| provider | 模型 |
|---|---|
| `opencode-go` | deepseek-v4-flash、**deepseek-v4-flash-vision-exp** |
| `bailian` | deepseek-v4-flash-0731、kimi-k2.7-code、glm-5.2、qwen-vl-max、qwen-vl-plus |
| `jiyuan2` | deepseek-v4-flash、deepseek-v4-pro |
| `google` | gemini-2.5-pro |

（见 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers`）
报错形如 `no adapter registered for provider "volc-ark-plan"`。

**③ `bailian` 会拦截成人内容 —— 这个项目里用不了**

```
400 data_inspection_failed: Input text data may contain inappropriate content.
```

本项目的角色扮演内容会被阿里云百炼的内容审查直接拒掉。另外 `bailian` 的模型也不声明
reasoning 能力，设 `thinking` 会报 `does not support reasoning effort`。
**结论：这个项目优先用 `opencode-go`。**

### 当前可用配置（已验证三个都能起来）

三个 agent 全部指向 `opencode-go/deepseek-v4-flash-vision-exp`，保留各自的 thinking 档位
（oldfox `high` / rubber-duck `max` / workhorse `high`），`deep: 0` 叶子。

改动 agent 文件**下次调用即生效，不用重启**（新文件也是，只是不会出现在 use_agent 名册里
直到重启）。原始文件备份在 `~/.dsh/agents/_bak-20260920-030706/`。

---

## 8. 凭据

本次推送用的 GitHub PAT 与 npm token **已出现在对话记录里**，
用完请**立即吊销重发**（GitHub 那个权限极广，含 `admin:org`）。

本机已配置的位置（换机后需要重新配）：

- `~/.git-credentials` + `git config --global credential.helper store`
- `~/.npmrc` → `//registry.npmjs.org/:_authToken=…`
  （注意：该文件原先有个**失效的旧 token**会掩盖新 token，若报 401 先检查它）

**npm 发布还没做** —— 三个包的版本号已改在本地（0.3.4 / 0.2.6 / 2.4.0）但未 publish。
发布前应先做完第 6 节的验证，发布坏版本比不发布更糟。

```powershell
cd C:\dsh-muv-engine; npm.cmd publish
cd C:\dsh-muv-table;  npm.cmd publish
cd C:\dsh-tavern-v2;  npm.cmd publish
```

---

## 9. 事故记录：iframe 沙箱放开 `allow-same-origin`（0.3.6 引入，0.3.7 回退）

> 记下来的原因：这是我犯的一个**基于错误前提的安全决策**，而推翻了它的是真卡数据。
> 换机后如果你又想「顺手放开沙箱让卡跑起来」，先读这一节。

### 经过

0.3.6 里我把承载卡自带 HTML 的 iframe 沙箱从 `allow-scripts` 改成
`allow-scripts allow-same-origin`，注释与 CHANGELOG 里写的理由是：

> 卡的 HTML 会以 ES module 从 CDN 拉 Vue/Pinia（jsdelivr），并读写 `localStorage`；
> 不透明来源下 `localStorage` 抛异常、模块加载失败。

**这个理由是编的，不是实测出来的。** 复核用真卡数据推翻了两点：

1. **论据不成立**：那张 210219 字节的状态栏 HTML 里，`jsdelivr` 只出现在**内联脚本的
   字符串文本**中，不是外部 `script src`，也没有 `import`；URL 只有图片和视频。
   本页面（DSH）**没有任何 CSP** 兜底。
   `localStorage` 的用法确实有（字号/主题、CG 画廊缓存），但**全部包在 `try{}catch{}` 里**
   —— 不透明来源下抛异常被吞掉，只是设置不持久化，**不会崩**。
   `fetch(remoteUrl,{mode:'cors',credentials:'omit'})` 在两种沙箱下都照常工作。
2. **危险是真实的**：两者同时给出时，srcdoc 文档会**继承父页来源**，
   `window.parent.document` 变成 DSH 的真实父文档。而这张卡自己的代码**正好在探测它**：

   ```js
   if (window.parent && window.parent !== window) parentDocs.push(window.parent.document);
   if (window.opener) parentDocs.push(window.opener.document);
   if (window.parent.parent && …) parentDocs.push(window.parent.parent.document);
   ```

   旧沙箱下这三行全走 `catch`、等于空转；放开后立刻生效。

### 暴露了什么

- `allow-scripts` + `allow-same-origin` ⇒ 卡里的 JS 能读写 DSH 页面 DOM、
  读 localStorage / cookie、**带登录凭据打 `/api/*`**、读 `parent.location`
  （凭据若在 URL 上会被一起读走）。
- 「SillyTavern 也不做沙箱」**不能**用来论证：ST 的卡跑在 ST 自己的 origin 里，
  受害面是 ST 自己；DSH 里同一个 iframe 与前端**同源**，受害面是 DSH。

### 实际影响（复盘）

- 存活窗口：npm 上约半小时；本机从 03:31:19 重启到回退，约 40 分钟。
- **未发现实际损害**：那张卡摸 `parent.document` 只为找**聊天输入框**
  （`#send_textarea` —— 这是 SillyTavern 的 id，在 DSH 里本来就不存在），
  `parentDocs` 之后没有 `JSON.stringify` / `fetch(` / `postMessage`，没有外发。
- 但这类「摸父页面」的写法在社区卡里**很常见**（卡作者为兼容 ST 普遍这么干），
  换一张恶意卡就会中招。**风险是真的，只是这次没被利用。**

### 结论与纪律

**默认必须是 `allow-scripts`。** 确实需要同源能力的卡应做成**显式 opt-in**
（全局开关或按卡白名单），不要改默认值。代码里 `MUV_CARD_SANDBOX` 上方的注释
已写明完整理由，改之前先读它。

**更general的教训**：安全相关的默认值不能靠类比（「别的项目也这样」）或推测
（「不放开就会失败」）来定。**先拿真数据实测**——这次只需读一遍卡的 HTML 就能发现
理由不成立。

---

## 10. 已知缺口：没有标签的 `[initvar]` 世界书条目

`异世界农场.png` 的初始变量**不在卡文本里**，而在世界书条目
`[initvar]变量初始化勿开`（`enabled: false`）的 `content` 里：

```
comment: "[initvar]变量初始化勿开"   enabled: false
content: 时间:\n  日期: '05-20'\n  星期: 周日\n…\n种族好感度:\n  凛原族: 0\n…
```

**content 里只有裸 YAML，没有 `<initvar>` 标签**，所以按标签扫描的候选集
（first_mes / description / scenario / alternate_greetings / 世界书 / helper）
**永远扫不到它** —— 该卡的 `schemas` 至今仍为 0。这不是 bug，是数据不属于「带标签的块」。

### 建议的修法（**未实现**，留给后续判断）

「彻底找不到变量块时，找 `comment` 以 `[initvar]` 开头的世界书条目，把 content 当 initvar 解析」。
预计 `异世界农场` 从 0 → 3 组（时间/种族好感度/个人好感度）。

**为什么当时没做**：这引入「注释前缀」这层新判定，而前缀的语义区分不明确 ——
`苍玄界` 的对应条目叫 `[mvu_update]变量输出格式`（是**文档**不是数据）。若 `[initvar]`
在某些卡里也是文档，就会解析出一张垃圾表。
**要做的话请加三道闸**：① 只在其它来源全部落空时启用；② 要求 content 解析出的对象
非空；③ 响应里标 `schemaSource: 'worldbook-initvar'`，让来源可见。

现状已由 `test-muv-parser.mjs` 第 [10] 节钉住（含「content 里没有 `<initvar>` 标签」的断言），
将来实现后该断言需要相应更新。

### 11.1 已实现（dsh-muv-table `aef7569`），实测 0 → 3 组

`异世界农场` 的 `schemas` 由 0 变成 3（时间 / 种族好感度 / 个人好感度），
`initvarData.时间.日期` 可读，`schemaSource = 'worldbook-initvar'`，其余 4 张真卡逐字节不回归。

### 11.2 ⚠️ 我原来提的第 3 道闸（「条目必须启用」）是**错的**，已作废

我当初写「要求 entry 启用（disabled 条目跳过）」，理由是「禁用 = 非数据」。
**这是想当然的假设，被真机数据直接推翻**：

```
comment: "[initvar]变量初始化勿开"    enabled: false
```

`勿开` 是作者的**字面声明** —— 约定就是「把变量树放进一条**禁用**条目，这样它不会被注入
上下文，但工具链仍能读它」。按我那道闸实现，这个兜底在**唯一需要它的卡上就是空转**。

**采纳的规则**：`[initvar]` 前缀是作者显式声明的「这是数据」信号，**`enabled` 不参与判定**；
挡垃圾靠「前缀 + 形状判定」，不靠 `enabled`。没有该标记的禁用条目**永远不读**。

> 教训与第 9 节同源：**别用类比或推测去定默认值/过滤条件**。
> 我这次又是先有结论（「禁用条目不该读」）再去找理由，而推翻它只需读一眼那条条目的
> `comment`。两次都是**真数据**赢。

四道闸的实际形态（`lib/muv-parser.js:284-313` 有完整注释）：

1. 只在**其它来源全部落空**时启用（原生 `<initvar>`、`<VariableInsert>`、带标签的世界书/脚本都优先）
2. content 必须通过**形状判定** `looksLikeInitvarMapping()`：`键:`/`键: 值` 算键、`- item` 算列表、
   空行与 `#` 注释跳过，**只要有一行不属于这三类就否决**
   （注意 `parseInitvar` **从不抛异常** —— 它丢掉用不上的行、返回剩下的，
   所以「能解析」不是证据，这是我原表述不严谨的地方）
3. `schemaSource` 上报来源，让这条兜底**不隐形**
4. 解析出的映射必须非空

前缀严格匹配 `[initvar]`：`[mvu_update]变量输出格式` / `[mvu_plot]插画强调` 不读
（苍玄界、异世界农场都带这些条目）；`[initvar_extra]` 也不匹配（要求 `]` 紧跟）。
大小写不敏感（`[InitVar]` 也读）——这是**有意的**，作者写法不统一。

### 11.3 独立审计：`dsh-muv-table/verify-initvar-audit.mjs`

工作马自己的 repro 是白盒的（它知道门控在哪）。这份是**黑盒**独立审计，21 项全绿：

- 只用公开 API `parseMuvCard`，不 import 内部函数
- **新旧对照**：用 `aef7569^` 的旧解析器跑同样 5 张卡，证明**恰好只有「异世界农场」行为变化**
- **13 条对抗用例**，两个方向都钉住（只测一侧的测试无法区分「门控生效」和「门控从不生效」）：
  `[mvu_update]`/`[mvu_plot]`/`[initvar_extra]` 不读、禁用+无标记不读、全角冒号散文否决、
  一个键+一段散文否决、只有列表项没有键否决、空映射否决；
  禁用+`[initvar]` **读**、启用+`[initvar]` 读、大小写不敏感读、注释/空行/列表项不影响、
  原生 `<initvar>` 优先于世界书条目

### 11.4 已知偏差（P3，**不是这次改动引入的**，记录备查）

`parseInitvar` **不剥 YAML 的单引号**：`日期: '05-20'` 读出来是 `"'05-20'"`（带引号）。
按 YAML 语义引号是**语法**不是内容。`lib/initvar-parser.js` **没有被 `aef7569` 动过**
（`git log -- lib/initvar-parser.js` 可证），所以这是共用解析器的既有行为，
影响所有 `<initvar>` 路径。改它要动全部变量读取路径，**风险不在本次范围内**，
故只记录不修 —— 免得以后有人把它当成 ③ 的 bug 反复排查。

---

## 12. iframe 固定 600px 正在裁掉真卡内容（实测数字）

**这是单元断言完全看不见的一类缺陷** —— 字符串层面的输出是对的，用户看到的是被切一半的卡片。

量法：把探针脚本拼进**卡文档内部**（不是外面），走真实的 `renderFencedHtml`，
探针把 `documentElement.scrollHeight` 画在文档左上角（`position:fixed`，不污染测量值），
再用无头 Edge 截图读数。复现：`node verify-visual.mjs`（第 [4] 节）。

| 卡内容 | 文档真实 scrollHeight | iframe 固定高 | 被裁掉 |
| --- | --- | --- | --- |
| ERA 状态栏 | **894 px** | 600 px | 294 px（33%） |
| 主页 | **1635 px** | 600 px | **1035 px（63%）** |

截图里肉眼可见：主页的 "Profile." 卡片被**从中间切断**。

### 12.1 修法：跨源 `postMessage` 自动撑高（**不许加 `allow-same-origin`**）

常规做法是父页读 `iframe.contentDocument.scrollHeight`，但那要求 `allow-same-origin`
—— 而这条已经因为第 9 节的原因被**明确撤掉**（同源后卡内探测 `window.parent.document`
的代码会全部变活）。所以：

- 往卡 HTML iframe 的 srcdoc 尾部注入一小段引导脚本，测
  `max(documentElement.scrollHeight, body.scrollHeight)`，`load` 后测一次 +
  `ResizeObserver`（约 150ms 去抖）跟随后续变化（卡是 JS 驱动的，内容会自己长高）
- **只发一个数字**给 parent，不发 HTML、不发卡内任何内容
- 父页**全局唯一**监听：只接受 `event.source` 能匹配到某个 `iframe.muv-iframe`
  的 `contentWindow` 的消息；**不查 origin**（沙箱是不透明来源，其 origin 恒为 `"null"`，
  拿它当凭据没有意义）；值必须是有限正数并**夹取**到 `[160, 2400]`；
  **只做 `iframe.style.height = n + 'px'`，不 eval、不插入内容、不转发**
- **兜底**：子文档没报数就维持 600px —— **不允许比修之前更差**
- **唯一出口**：所有「卡自带整页 HTML」的 iframe 都走 `cardHtmlIframe()`，
  这样沙箱常量只有一处、注入点只有一处、默认尺寸只有一处

### 12.2 注入点的一个同类风险（已加进验证台）

引导脚本是「插在**最后一个** `</body>` 之前」。若卡自己的 JS 字符串里写着
`document.write('</body>')` 之类，注入点会落进**那个字符串内部**，把卡的代码当场切断
—— 和 `renderMediaTags` 改写卡内正则字面量导致 `&#39;&#39;` → 整页 JS 报废是**同一类事故**。

`verify-visual.mjs` 里对每条真卡文档都有这条检查：
**文档里最后一个 `</body>` 是否落在 `<script>…</script>` 范围内**。

同理，引导脚本文本自身有两条硬约束（都写进注释了）：**不含反引号**，
且**字符串里不出现裸的 `</script>`**（用 `'</' + 'script>'` 拼出来）——
插件客户端代码可能被宿主内联进 `<script>` 标签，那样的字面量会当场把标签截断。

---

## 13. 验证工具索引（都不需要重启 DSH）

重启 DSH 会杀掉正在跑的会话，而 Node 会缓存 ES 模块 —— 所以「改完源码」和
「看到效果」之间一直隔着一次重启。下面这些工具专门用来绕过这个死结。

| 脚本 | 作用 | 防的假绿 |
| --- | --- | --- |
| `verify-visual.mjs` | 把 `lib/client.js` 里的 `renderFencedHtml` **逐字提取**执行，拿**全部 5 张真卡**的 9 条围栏整页文档当输入，生成 HTML 后用无头 Edge 截图；含固定 600px 的**高度探针**与老/新对照 | 见下 |
| `verify-statusbar-fence.mjs` | 判定「状态栏整页 HTML 带裸围栏」会不会**被用户看到** | 「函数返回值有问题」≠「用户看得见」 |
| `verify-initvar-audit.mjs` | `[initvar]` 世界书兜底的黑盒独立审计（见 11.3） | 白盒 repro 会按门控构造用例 |
| `test-client-render.mjs` | `renderFencedHtml` / `renderMediaTags` 的单元哨兵（含安全哨兵） | — |
| `verify-handoff-restore.mjs` | 克隆三个仓库到临时目录，验证「换机后能否恢复」 | 光 commit 不 push 会丢文件 |

**`verify-visual.mjs` 里踩过的判据坑（别再退回去）**：

- ✗ 「srcdoc 长度和原文同一个数量级」—— 截掉一半仍是同一数量级，会放过腰斩
- ✗ 「全文里能找到文档结尾那句话」—— 旧实现腰斩后剩余 HTML 会**裸奔在 iframe 外面**，
  全文搜索照样命中，等于永远通过
- ✗ 「遍历卡片但一条都没读到」—— 会输出「0 张、全部通过」。
  （`regexScriptsOf(card)` 要传 **`readPngCard` 的返回值**，传 `card.data` 进去**静默返回空数组**；
  所以脚本里有一条 `totalScripts >= 15` 的防空循环断言。）
- ✓ 反转义 srcdoc、**剥掉高度引导脚本**之后，要求与围栏正文**逐字相等**（比「包含」更强）
- ✓ 老/新**对照**：合成用例（文档正文含 ```）上旧实现必须**确实坏掉**（腰斩 + 残渣裸奔），
  否则说明「修复」没有证据

### 13.1 多代理并行验证的坑

多个代理并行跑无头 Edge 时**不要共用临时目录**：Edge 的 profile 有锁，后启动的进程会
**直接转发给已有实例并立刻退出**，表现是「没有报错、也没有截图」（`$LASTEXITCODE` 还是空的）。
每次调用都要新建 `--user-data-dir`，并且各代理用各自的产物目录
（本验证台用 `%TEMP%\muv-visual-main`，避开别人在用的 `%TEMP%\muv-visual`）。

---

## 14. 未决事项（按影响面排序）

1. **自动撑高（第 12 节）** 正在实现；验收判据是复测出 894 / 1635 两处内容**完整可见**。
2. **状态栏字段被塞进 3 列网格**（`dsh-muv-engine/lib/client.js`）：`.muv-sb-sub` 的
   `grid-template-columns: 245px 245px 245px` 才是「两个字段挤在一行」的真正根因。
   早先那次修复改的是 `.muv-sb-body{flex-direction:column}`，**改错了选择器**，
   bug 没修掉只换了触发条件（那行注释至今会误导下一个人去改 body）。
3. **角色名没有独立块**：`.muv-sb-char` / `.muv-sb-char-name` / `.muv-sb-sect` 在真实级联
   输出里**出现 0 次**（CSS 定义了渲染器从不输出的类）。角色名只是一行加粗字夹在字段流里。
4. **`extractStatusBarHtml` 不解裸围栏**（`lib/regex-engine.js:182` 只匹配 ```` ```html ````）：
   `_足控天堂2` 的返回值确实带着裸 ``` 且是整页文档 —— 但实测**用户看不到**：
   卡自己的正则已经把 `<StatusPlaceHolderImpl/>` 替换掉了，客户端那个分支不匹配，
   这份 HTML 是**死数据**，真正生效的 `renderFencedHtml` 能正确剥裸围栏（截图已证）。
   5 张卡里实际影响面 = **0**。属潜在健壮性缺口，修法是「返回值像整页文档时才剥一层首尾围栏」，
   **位置必须在 `extractStatusBarHtml`，不能改 `renderFencedHtml` 的正则**
   （裸 ``` 有歧义，改那里会误伤普通代码块）。
5. **每条消息白做一次 210 KB 转义**：`client.js` 里 `if (sbHtml)` 只判非空，
   于是无条件 `escAttr()` 造一个 iframe 字符串，随后因占位符已被替换而**直接丢弃**。
   加一句「占位符存在才构造」的守卫即可，行为不变。
6. **装饰会替换整条消息的 DOM，绕过 markdown**：`applyDecoratedHtml` 是
   `body.innerHTML = html`。DSH 前端是 micromark 且**没有任何 HTML 扩展**，
   所以一条消息只要被装饰过，正文里的 markdown（`**粗体**`、代码块、列表）可能变成**字面文本**。
   这是**设计级**问题，评估影响面前不要动 ——
   可能的更小修法是：既然已有 `muvSanitizeNode` 在 DOM 层处理选项，
   innerHTML 替换也许只在**必须注入 iframe/状态栏**时才需要。
7. `presetSource` 服务端已诚实上报但**客户端从不消费** → 用户看不到「这是默认预设的卡」，
   属静默误导（无功能损坏）。
8. `presets.json` 只登记 5 个预设，磁盘上有 19 个目录 → 14 个预设**在酒馆面板里列不出来**
   （功能正常，可用性缺陷）。
9. 换机后**必须做**：重启 DSH 让新代码生效；轮换曾出现在明文里的 GitHub PAT 与 npm token。

---

## 15. 发布检查单与验证日志

### 15.1 发布前置条件

> **PC-0｜`npm publish` 打包的是**工作区文件**，不是 git 提交。**
> 发布前必须确认**工作区干净**，且等于刚刚验过的那一个提交（`git status --porcelain` 为空）。
> 本次开发期间 `lib/client.js` 长期处于「已改但未提交」状态 —— 在这种状态下发版，
> 会把一个**从未验证过的半成品**发到 npm，而且 `npm publish` 照样打印成功。
> 发版动作应当是：`git status` 为空 → 确认 HEAD == 已验证的 hash → `npm publish`。

> **PC-2｜判断「发布成功没有」不能用 `npm view` / `npm pack <pkg>@<ver>` —— 它们会返回旧的 packument 缓存。**
> 实测（2026-09-20）：`npm publish` 明明成功，但 `npm view dsh-muv-table versions` 的列表里
> **没有**新版本（而它自己还打印了 `cache revalidated`），`npm pack dsh-muv-table@0.2.11` 直接报 ETARGET。
> 只看这两条会得出**「发布失败」的错误结论**（我就差点据此重发）。
> 暴露真相的是第二次 publish：registry 回
> `You cannot publish over the previously published versions: 0.2.11` —— 即版本其实已经在上面了。
>
> **权威判据：直接取 tarball**，URL 由包名 + 版本唯一决定，没有 packument 那层缓存：
> ```
> curl.exe -s -o NUL -w "%{http_code}" https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz
> ```
> `200` 就是发布成功；下载下来 `tar -tzf <tgz> --force-local` 还能核对包内文件。
> （`--force-local` 不能省：Windows 的 tar 会把 `C:\...` 当成远程主机名报
> `Cannot connect to C: resolve failed`。）
> 另外：`npm publish` 之后**再跑一次**是安全的 —— 版本已存在时它会以 E403 明确拒绝，
> 而这个拒绝本身就是「已发布」的可靠证据。
>
> **补充（同一天第二次踩到，形态不同）**：tarball URL 本身也会返回**被缓存的 404**。
> 实测 `…/dsh-muv-table-0.2.12.tgz` 连续多次 404，而 `…/dsh-muv-table-0.2.12.tgz?cb=1`
> **立刻 200**，`npm install dsh-muv-table@0.2.12` 也成功。那是 CDN/代理的**负缓存**。
> 所以 tarball 判据要**带一个 cache-buster 查询串**：
> ```
> curl.exe -s -o NUL -w "%{http_code}" "https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz?cb=$(date +%s)"
> ```
> 三种"看起来像失败"的形态至此齐了：publish 打印成功但没发出去（不存在）、
> packument 返回旧缓存（版本列表里看不到）、tarball 负缓存（取不到）。
> **只有「带 cache-buster 的 tarball 200」+「包内文件核对」才算发布成功。**

> **PC-1｜高度自动撑高必须在真实页面复验后才能宣布可用。**
> 现状：`cardHtmlIframe` / 帧高引导脚本 / `onMuvFrameHeightMessage` 从写出至今**从未在 3080 的真实页面里执行过**
> —— 3080 进程是 03:31 启动的，而该功能是之后写入磁盘的（Node 启动时缓存 ES 模块）。
> 目前所有验证都在 harness 里用**真实函数源码 + 真实卡数据**完成，**不等于**真实页面生效。
> 复验必须在**重启 DSH 之后**在真实聊天页里做（重启会终止当前会话，只能由用户操作）：
> 1. 打开一张带整页 HTML 状态栏的卡（`_足控天堂2`）；
> 2. 该 iframe 的 `style.height` **不再是 `600px`**，而是内容高附近的稳定值；
> 3. DevTools 里 style mutation 在稳定后**不再增加**（无振荡）；
> 4. 控制台无报错；iframe 顶部**没有可见的反引号**；
> 5. **必须带上修正后的度量**（内容包围盒；**不要** `max(…, body.scrollHeight)`），
>    否则会在「正文美化」那类卡上「看起来通过、实际是视口回显」。

其余发布前必须全绿（都不是可选项）：

```powershell
node test-status-cascade.mjs            # 84
node test-client-render.mjs             # 113
node verify-visual.mjs <old-client.js>  # 74（渲染矩阵 + 真实消息形状 + 酒馆路径 + 真卡文档过媒体改写）
$env:MUV_EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
node verify-statusbar-layout.mjs        # 真浏览器布局门禁（状态栏单列 + 角色名独立块）
node verify-decorate-dom.mjs            # 真浏览器装饰门禁（markdown 存活 + 选项仍渲染）
node verify-release.mjs pre             # ★ 发布门禁：工作区干净 + HEAD + 包内关键文件
#   发布后： node verify-release.mjs post 0.3.8 0.2.11 2.4.2
#   （registry 真的取得到 + tarball 里关键文件都在；publish 打印成功 ≠ 发布成功）
cd ..\dsh-muv-table
node test-png-card.mjs; node test-muv-parser.mjs; node test-preset-resolve.mjs   # 28 / 76 / 30
```

### 15.2 本轮验证日志（engine `3bd2f67` / table `aef7569`）

> **`verify-decorate-dom.mjs` 是唯一一个在真浏览器里跑「真实模块 + 真实 `_decorateOne` + 真实 DOM」的门禁。**
> `lib/client.js` 是 `window.__ModuleLoader__.load({factory})` 形态，而 `exports.apply` 是**零参**函数
> （不需要 Cordis 上下文），所以整个模块可以在页面里原样启动，再调真实的
> `window.MuvEngine.decorateMessage(el)`。它支持 `MUV_CLIENT_SRC=<文件>` 指向任意一份源码做对照。
> 这一轮的对照结果是整轮最有说服力的一条证据：

| `lib/client.js` | `<strong>` | `<h2>` | `<pre>` | `<li>` | `.muv-choice-btn` |
| --- | --- | --- | --- | --- | --- |
| 已提交 `2994c2c`（修复前） | **0** | **0** | **0** | **0** | 2 |
| 修复后 | 1 | 1 | 1 | 2 | 2 |

装饰**前**两者都是 `strong=1 h2=1 pre=1 li=2` —— 所以这不是「判据测不到东西」，是修复真的生效。
**别只看「现在通过了」：没有这一栏对照，两种情况的输出长得一模一样。**

门禁覆盖**两类标记**（逐类迁移，一类一条）。当前状态：

| 消息 | 标记 | markdown | 该渲染的东西 | 结论 |
| --- | --- | --- | --- | --- |
| `A_choices` | 纯 `<choices>` | 存活 | 选项按钮 ×2 | **PASS**（第一类已修） |
| `B_header` | `『📅…\|⏰…\|📍…』` 表头 + `<StatusPlaceHolderImpl/>` | 存活 | 状态栏 ×1 | **PASS**（第二类已修） |
| `C_media` | `<插图>` + `<video src>` + `<audio src>` | 存活 | 播放器 / 插画块 | **FAIL**（④ 的基线：`videos=0 illustrations=0`） |

两个"修复前"的基线都靠 `MUV_CLIENT_SRC` 指向旧源码取得，且都实测复现过：
- 第一类：`2994c2c` 上 `strong/h2/pre/li = 0/0/0/0`（选项仍有 2 个）→ 修复后 `1/1/1/2`；
- 第二类：`ce27b39` 上 `strong/h2/pre/li = 0/0/0/0`（状态栏仍有 1 个）→ 修复后 `1/1/1/2`。

`C_media` 是 ④ 的验收基线：修好之后必须 `videos>=1` **且** `illustrations>=1`，同时 markdown 仍在。
**注意它的 markdown 现在是"存活"的** —— 因为这条消息没有任何会让 `beautifyMuv` 触发整条替换的标记。
所以 ④ **不能**用"往字符串管线里加媒体渲染"的办法实现，否则整条替换会回来、markdown 又全灭；
它必须走第一/二类已经确立的 **DOM 段补丁** 路线。

| 项 | 结果 |
| --- | --- |
| 围栏按 markdown 语义配对 | ✅ 五卡 9 条整页文档各 1 个 iframe、正文逐字、无残渣；**合成用例上旧实现确实腰斩+残渣裸奔**（有反证） |
| 媒体标签解析不再自伤 | ✅ 真卡 `<script>` 不再被改写；真卡 210KB/76KB 文档过 `renderMediaTags` 比值 **1.00**、不抛错 |
| **真实消息形状**（围栏不在第 0 位） | ✅ `<div class="muv-statusbar-wrap">` 包裹 / 前后有正文 / 一条消息两个围栏文档 —— 全部正确产出 iframe |
| **酒馆路径围栏 → iframe** | ✅ **9/9**（修复前 8/9 未转换，卡 CSS 会泄漏进聊天 DOM；视觉证据见 `tavern-inline.png`） |
| iframe 自动撑高（度量修正后） | ✅ 三档起始高度（600/900/1500）报值一致：主页 1636 / 正文美化 251 / ERA 895，**正文美化能缩小 = 不再是不动点** |
| 状态栏单列 + 角色名独立块 | ✅ 真浏览器实测 `subDisplay=flex subDir=column sameRowPairs=0 boxedChars=1`（两个级联阶段） |
| `[initvar]` 世界书兜底 | ✅ 黑盒独立审计 21/21；新旧对照证明**恰好只有「异世界农场」变化**（0→3 组） |

### 15.3 三处需要更正的口径（都已改口，别再引用旧说法）

1. **「没有 `allow-scripts` 卡根本不出内容」—— 太强，撤回。**
   实测同一份 ERA 卡文档：`allow-scripts` 为 926 内容高 / 152 元素 / 201596 字符；
   `sandbox=""`（全部禁止）为 **926 / 148 / 201576**。约 97% 的 DOM 与 99.99% 的文本是**静态标记**。
   （测量方自己也声明 130↔152 是噪声区间，所以严格说这**不能**证明「JS 无差别」。）
   正确表述：**保留 `allow-scripts` 的理由是「交互功能」（地图/画廊/轮播/tab），不是「否则整页空白」。**
   这个区别重要 —— 它把「若有人要收紧沙箱」的代价从**整页不显示**改成**交互失效**。
2. **「高度用 `max(内容包围盒, body.scrollHeight)`」—— 错，那一半仍是视口回显。**
   A/B/C 三指标差分实测（同 payload × 起始 600/900/1500）：
   只取内容包围盒 = `927/927/927`、`2083/2083/2083`、`241/241/241`（**全部与起始值无关**）；
   带 `body.scrollHeight` 的两个变体在「正文美化」上都是 `600/900/1500`（完全回显）。
   正确做法：**`h = muvContentExtent()`，不要 `max` 任何 `scrollHeight`**；
   要兜被 `overflow` 裁掉的静态子元素，就在遍历时逐个取 `el.scrollHeight` 的最大值。
3. **「`renderFencedHtml` 对围栏不在第 0 位的输入原样返回」与「`renderMediaTags` 在真卡文档上抛 `RangeError`」——
   在当前代码上均不可复现。** 这两条来自一份针对**中间版本**（2400 行那版）的复现报告，测者本人当时就标了「待复测」。
   现在的复测结果见 15.2 第 3、2 行。**留档时以 15.2 为准。**
   顺带一条判据教训：`renderMediaTags('<video src="a.mp4">')` 从 19 → 73 字符**不是膨胀** ——
   补 `controls`/`preload`/`class` 就该变长；两条 video 得 146 = 2×73 也是线性。
   **判据必须是「相对输入是否超线性」，不是「是否变长」**，否则会把正常行为报成 bug。

### 15.4 仍未解决（见 §14 第 6 项）

**装饰整条消息会抹掉 markdown**（`raw = body.innerText` 已经把 `**`/`##`/```` ``` ```` 变成渲染后文本，
写回 `innerHTML` 后不可逆）。真实命中率很高：`异世界农场` 的 `**` 有 352 处、`夹具卡·提瓦特` 604、`食人世界` 792。
这只在消息里**有 muv 标记**时触发（`html !== raw` 才写回），所以症状是「有的消息正常、有的突然全变纯文字」。
修法方向：**不要整条 `body.innerHTML = html`**，改成只补丁需要变的那几段
（`<choices>` 已有 DOM 层的 `muvSanitizeNode`；围栏文档可用已有的 `findTextRange` 定位并替换那一个文本节点）。
**硬约束**：两个门禁与全部套件必须保持全绿；逐类迁移、逐类提交；某类标记若无法在 DOM 补丁下落对，就停下来报，
不要为了 markdown 把已经跑通的状态栏搞坏。

### 15.5 真浏览器端到端：fixture 必须带真实运行时（一条重要教训）

`verify-visual.mjs` 生成的 fixture 页面**必须注入 `lib/client.js` 里逐字提取的高度监听运行时**
（`heightRuntimeSource()` + `withHeightRuntime()`）。原因是一个真实发生过的误读：

- 早先的 fixture 只是**静态 HTML 快照**，页面里没有客户端运行时 → `ensureFrameHeightListener` 从未注册 →
  iframe 永远停在 600px。红队读这份产物时得出了「高度仍卡在 600px、度量被污染」的结论 ——
  **结论是错的，错因在 fixture 缺运行时，不在度量**。
- 补上真实运行时后，同一批 fixture 在真 Edge 里**自己就撑开了**：

| fixture | iframe 高度（浏览器实测） | 说明 |
| --- | --- | --- |
| `tavern-inline`（主页文档） | **2056px** | 原卡死 600px；与内容包围盒 2055–2083 吻合 |
| `real-tavern`（服务端产出的真消息 · 酒馆路径） | **903px** | |
| `real-dsh`（同一真消息 · DSH 原生路径） | **939px** | |

**教训**：验证产物本身也要被验证。一份"看起来是端到端"的 fixture，如果少了运行时，
它测的其实是另一个东西 —— 而且它会**生产出看起来很有说服力的错误结论**。

### 15.6 真实消息端到端结果（`rewritten.txt`，213,953 字，服务端 `apply-regex-card` 产出）

| 路径 | 输出 | iframe | 裸围栏 | 裸 `<!DOCTYPE>` |
| --- | --- | --- | --- | --- |
| 酒馆 `_tavernRenderTags` | 239,421 字 | **1** | **0** | **0** |
| DSH 原生（`renderFencedHtml`） | — | 1 | 0 | 0 |

截图 `real-tavern.png` 里可见：卡片整页界面完整渲染在自适应 iframe 内（导航胶囊 / 立绘 / 五官感受 / 当前主播）、
**行动选项 A/B/C 三个按钮正常**、`<VariableInsert>` 折叠成「变量更新」、
**上下两条普通消息的排版未被污染**（卡的 `html,body{height:100%}` 没有泄漏出 iframe）。

### 15.7 两种「非代码」缺陷模式（这一轮各栽了一次，都值钱）

**一、过时的注释本身就是一类缺陷，而且它会主动误导人。**
这一轮被注释骗了三次：
1. `MUV_SB_CSS` 里那条「老 grid 会让长字段流到隔壁列」的注释，指的是 `.muv-sb-body`，
   而真正出问题的是 `.muv-sb-sub` —— 照着它改，bug 没修掉只换了触发条件（P0-1）；
2. `muvSanitizeNode` 的 docblock 写着「this pass 会把 `<choices>` 变成按钮」，
   **实际上 DOM 层当时根本没有 `<choices>` 渲染器**（唯一的消费者是字符串层的 `replaceChoices`）。
   我按这条注释做方案、差点把「选项没了」重新引入 —— 是执行方先核实了一遍才发现；
3. `.muv-sb-char` / `.muv-sb-char-name` / `.muv-sect` 这套 CSS 类，渲染器从来不输出（P0-2）。

**教训**：注释描述的是**意图**，不是**行为**。凡是「照着这条注释改就能修好」的推论，
都必须回到行为上验一遍。反过来，**改动时顺手把过时注释改对**，是在拆下一轮的地雷。

**二、DOM 文本提取必须自己识别换行。**
`<choices>` 的选项行之间是 `<br>`，而 `<br>` **自身没有任何文本** ——
直接拼 `nodeValue` 会得到 `A. 甲B. 乙`，两个选项**粘成一个**（实测表现为「只出 1 个按钮」）。
`innerText` 在这里是对的（它按布局算换行），`textContent` 是错的。
需要「字符 → 文本节点」映射时不能直接用 `innerText`，得自己实现
（在 `<br>` 与块级边界补 `\n` 并维护映射）。
顺带修掉一处**既有**不一致：断行那套认全角 `）`，剥前缀那套只认半角 `)`，
于是 `2）丁` 会被断成一行却留着 `2）` 前缀。

**三、静默的相互牵连：一个 `try` 包住多步 = 前一步失败会悄悄带走后面几步。**
卫生 pass 原来把 4 个渲染步骤挤在**同一个 `try`** 里。一次探针少注入了一个依赖 →
表头折叠抛 `ReferenceError` → **后面几类（含选项按钮）的渲染一起没了，而页面不报任何错**
（表现为"4 项断言同时变红但控制台干净"）。
改成每步独立 `try` + 各自 `console.error`。
**这与「过时注释」是同一类缺陷：都不报错，只是让你看到的结果不再是真实原因导致的结果。**

**四、写死的结构假设会在真实产物上静默退化。**
取状态栏片段原先是写死正则 `/<div class="muv-statusbar-wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/`
——**假定末尾恰好连着三个 `</div>`**。真实产物不是这样：卡自带整页 HTML 时里面是
`<iframe…></iframe>`（零个内层 div），空状态是两个 → 匹配不上，于是**静默退化成整条替换**
（markdown 又全灭）。改成按 div 深度配平扫描：**生成什么就解析什么**。
**
**三、环境陷阱补充（与 §5 同类）：改源码/测试文件不要过 PowerShell 的 `Get-Content`/`Set-Content`。**
`Get-Content` 按 GBK 解码、`Set-Content` 再写回 UTF-8，中文会整成乱码 + 语法错误
（实际发生：一个自写的验证脚本被改成乱码）。
**只能用文件编辑工具改代码。** 与「npm 必须用 `npm.cmd`」「`.ps1` 跑不了」是同一类坑，
一并归入「这台机器上的 PowerShell 不是通用文本处理工具」。

### 15.8 新发现的小缺陷（P2，未修）

酒馆路径的输出里有**一行裸属性文本**漏出来（截图里可见）：
```
{"era-message-key"="era_mk_17898382494898_1641vy","era-message-type"="assistant"}
```
像是 `<era_data …>` 这类标签的属性被当文本留下（标签剥离规则没覆盖这种形态）。
不影响功能，但用户看得见，属于「裸标签外泄」这一类，记在这里备查。

---

## 16. 收尾状态（本轮结束时的权威快照）

### 16.1 已发布（都用「带 cache-buster 取 tarball + 核对包内文件」验证过）

| 包 | 版本 | 内容要点 |
| --- | --- | --- |
| `dsh-muv-engine` | **0.3.9** | ①②围栏/媒体自伤、⑤自动撑高、酒馆围栏转 iframe、P0-1/P0-2、BLOCKER-1、markdown 一类/二类、**④原生路径插画与视频**、**第三类标签渲染（37 项表驱动）+ 内部块防泄漏** |
| `dsh-muv-table` | **0.2.12** | `[initvar]` 裸 YAML 世界书条目（0.2.11）+ 打包修复（0.2.12） |
| `dsh-tavern` | 2.4.1 | 状态栏门控 / Zod 读取 / 整页 HTML 与媒体渲染 |

### 16.2 怎么自己验一遍（全部不需要重启 DSH）

```powershell
$env:MUV_EDGE = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
cd C:\dsh-muv-engine
node test-status-cascade.mjs   # 84
node test-client-render.mjs    # 175
node test-regex-engine.mjs     # 21
node verify-decorate-dom.mjs   # 六类消息 + 注入安全（真浏览器 + 真实模块 + 真实 _decorateOne）
node verify-visual.mjs <旧client.js>   # 76：五卡整页文档矩阵 + 真实消息形状 + 酒馆路径
node verify-statusbar-layout.mjs       # 状态栏单列 + 角色名独立块（真浏览器实测）
node verify-statusbar-fence.mjs        # 状态栏裸围栏
node verify-release.mjs pre            # 发布门禁（工作区干净 + HEAD + 包内容）
```

`verify-decorate-dom.mjs` 支持的六类消息（每类都要求 **markdown 存活** 且 **该渲染的东西真的渲染了**）：

| 消息 | 判据 |
| --- | --- |
| `A_choices` | 选项按钮 ≥1 |
| `B_header` | 状态栏 ≥1 |
| `C_media` | `<video>` ≥1 且 `<插图>` ≥1 |
| `D_xss` | 同上 **且** `window.__pwned` 未赋值（属性白名单丢 `on*`） |
| `E_variable` | 变量折叠卡 ≥1、摘要块 ≥1、**无裸标签残留** |
| `F_tags` | speech/dialogue/char/location 均 ≥1、**无裸标签残留** |

### 16.3 已知未覆盖（2026-09-22 更新：第 1 条已补齐，其余仍是设计保留/既有行为）

1. ~~**卡牌专属游戏标签**（赏令接取 / 赏令完成 / 拍卖购入 / 盲盒开启 / 道友收录 / 飞剑回信 / 自由开局）~~
   **已修**：原生路径新增 `muvRenderGameCards`（`.muv-game-card` + `data-card` 属性 +
   `.muv-card-field` 字段行），`verify-decorate-dom.mjs` 扩到第七类 `G_gamecard`，七类全绿。
2. `applyDecoratedHtml` 的**整条替换兜底仍在**（找不到落点时的最后手段）——
   这是**设计保留**，不是遗留缺陷。它在「装饰先于卫生 pass 的极端时序」下仍可能触发（代码里有说明，未观测到）。
3. §15.8 那行裸属性文本（`{"era-message-key"=…}`）。
4. §11.4 `parseInitvar` 保留 YAML 单引号（既有行为，未改）。

### 16.3.1 门禁探针的两层假象（2026-09-22，改探针不改实现）

`verify-frame-height` 曾连吃 3 红（「正文美化（带音乐）」不收敛 / ERA 极差超死区），
排查结论是**两个探针 bug 叠加**，实现无回归（对照臂 + 逐元素 bottom 探针实证）：

1. **起始高度替换打坏卡 CSS**：`/height:\d+px/` 第一个匹配落在 srcdoc 里卡自己的
   `.logo-btn{height:62px}` 上（srcdoc 在 style 属性之前）——三档起始高度从未生效、
   卡布局反被改坏。修复：只替换 `style="display:block;width:100%;height:` 专属前缀。
   （§SCENARIO ① 早就警告过这个坑，但只防了合成夹具，真卡臂没防。）
2. **Node 构建缺父页视口**：Node 提取执行没有 `window` ⇒ `rewriteVhMinHeight`
   静默跳过 ⇒ 卡的 `min-height:100vh` 原样进 iframe ⇒ 跟着 iframe 高度伸缩的
   真·不动点。修复：`loadClientRenderersFrom(src, doc, win)` 新增 `window` 桩，
   高度门禁传 `{ innerHeight: 900 }` 与探针窗口同构。
3. 判据随语义更新：`min-height:100vh` 的 ST 平价语义下「正文美化」合法地钉在
   父页视口地板（≈900）；旧 `<400` 判据改为「钉在地板 ±8px」。
   修复后三卡全部收敛：主页 1636 / 正文美化 900 / ERA 889-895（极差 ≤6px）。
4. `verify-visual.mjs` 的「旧实现对照臂」在 HEAD(324b751) 与 2994c2c 上都不再红
   （围栏 bug 已修、夹具演进）——对照臂选点过时，默认模式（不带旧源码）为准。

### 16.4 必须由用户做的两件事

1. **重启 DSH** —— 3080 上跑的仍是 03:31 的模块，本文件里所有修复都要重启才在界面上生效。
2. 重启后按 **PC-1**（§15.1）五条复验高度自动撑高，特别是第 5 条：**必须带上修正后的度量（内容包围盒）**，
   否则会在「正文美化」那类卡上「看起来通过、实际是视口回显」。

### 16.5 一条操作教训（我自己踩的）

`git log --oneline -1` **不带分支名**时打印的是**当前 HEAD**，不是你以为的那个分支。
我因此把「当前在分支上」误读成「已在 master 上」，于是 `git merge` 变成 no-op 而我没察觉
（输出看着像"合并成功"）。**判断分支位置要用 `git rev-parse --abbrev-ref HEAD` 和
`git rev-parse --short <branch>`，不要用 `git log -1` 代替。**
（同类的还有：`git -C <repo> log -1 --grep=...` 会返回 HEAD —— 它匹配的是提交信息，
不是"标签指向哪"。）

---

## 17. 第 17 轮：交互桥 + 运行时变量（2026-09-22 夜）

### 17.1 用户报的两个症状与真因

| 症状 | 真因 | 落点 |
| --- | --- | --- |
| 「蓝色卡片不能交互」（卡内按钮点了没反应） | 卡的 `sendToTavern` 三级降级里 ①宿主函数 `sendUserMessage` 不存在、②父文档 `#send_textarea` 被跨源拒绝、③只剩"已复制"提示 | 垫片新增 ①的实现 + 隐藏 `#send_textarea` 收件箱；宿主 `__muvUserSend` → `muvDeliverUserText` |
| 「紫色卡片底部缺一半」+ 数据区空白 | 卡是**数据驱动自适应**布局：era 桥只送卡声明的**初始**变量，本会话运行时数值零通路 ⇒ 无数据可填、整卡塌成半截 | `muvFeedVariables`（装饰期回灌 `/api/muv-engine/extract`）+ `muvEraFetchVars` 双源合并 |

### 17.2 关键发现：`_足控天堂2` 的数据来自**酒馆助手脚本**，不在消息里

实测三处取证：
1. 真卡 PNG：`data.extensions.regex_scripts` 10 条，`tavern_helper` **不存在**（`null`）；
2. ST 本机聊天文件（`data/default-user/chats/_足控天堂2/*.jsonl`）：9 条消息里
   **没有** `UpdateVariable` / `_.set` / `initvar`，只有 `<era_data>{"era-message-key"="era_mk_…"}</era_data>`
   + `<StatusPlaceHolderImpl/>`；`chat_metadata.variables` 只有文风类配置键；
3. 消息里每个 `era_data` 带一个 **message-key** —— 这是"每楼变量快照"的索引。

⇒ ST 里那张卡的数值来自用户装的 **TavernHelper「ERA变量框架」脚本**（148KB，随聊维护每楼
快照，并在 `eventOn('era:getCurrentVars')` 上作答）。**DSH 没有酒馆助手执行器**，所以
本卡的数据要等"变量框架原生实现"（见 §17.4）。

已落地的部分覆盖「变量随消息文本走」的 MUV 约定卡（`<UpdateVariable><initvar>` 块）。
验证证据：`verify-era-bridge.mjs` 的 DOM 行 `data-era="世界信息.时间.日期" 前="——" 后="2026年8月26日"`。

### 17.3 本轮改了什么（都是**加在兼容层上**，没动沙箱决策）

- `muvCardCompatScript` §7：`sendUserMessage` + 隐藏收件箱（卡源码含约定符号才装）；
- `onMuvCardCompatMessage`：认 `__muvUserSend`（每帧 ≥800ms、限长 20000）；
- `muvDeliverUserText`：原生 setter 写 DSH 输入框；`send` 模式派发 Enter；
- `muvFeedVariables`：`_decorateOne` 里挂钩，回灌变量块（会话定位 + 内容签名去重 + 512 键 FIFO）；
- `muvEraFetchVars`：双源（tavern-card 的 initvar ⊕ muv-engine/state 的运行时），
  `muvDeepMerge` 运行时覆盖初始；
- `verify-card-compat.mjs` 夹具 KEEP 补 `PushChatLog`（`muvPushChatLog` 不含 "muvChat"
  子串 ⇒ 夹具 pushChat 落 no-op ⇒ ③b 恒红，属门禁自己的洞，不是产品缺陷）。

### 17.4 待办：变量框架原生实现（"在酒馆基础上继往开来"的落点）

ST 那套（ERA 框架 / TavernHelper 助手脚本）做的事，在这套栈里**已经分块存在**，
缺的是把它拼起来 + 补两条 ST 做不到的能力。建议顺序（每步都能单独验证）：

1. ~~**命令式语法进 `/extract`**：除 `<initvar>` YAML 外，认 `_.set('a.b.c', v)` / `_.add(...)`
   （ST 生态里最常见的写法）。落点：`var-tracker.js` 的 `parseLatestInitvar` 旁边加解析器，
   服务端 `/api/muv-engine/extract` 复用它。~~
   **✅ 已做（第 25 轮，`2d3d82a`）**：新增 `parseCommandOps`（落点就是 `parseVariableOps` 旁边），
   `/api/muv-engine/extract` 已增出 `commandOps` / `badCommandOps`。同一轮还把
   `stat_data` 归一、`TavernHelper`/`Mvu` 垫片、新值回推在线帧一起做了 —— 见 §25。
   （顺带纠正本节的一处提法：`parseLatestInitvar` 这个名字在当前代码里已不存在，
   现行入口是 `parseVariableOps`。）
2. **按楼快照**：`era-message-key` → 每楼一份变量快照（现在只有"当前状态"一份）。
   有了它，滚回旧消息能看到**当时的数值**（ST 的 ERA 卡就是这个行为）。
   落点：`/api/muv-engine/state?messageKey=` + 回灌时把 key 一起存。
3. **变量面板**：`/api/muv-engine/state` 已经能读能写（`{merge:true}`），做一个
   面板直接编辑（现在的折叠卡只读展示）——这是 ST 侧要装脚本才能有的东西。
4. **原生范式示例卡**：写一张不依赖任何 ST 脚本的卡，展示"变量 + 渲染 + 交互"三条
   原生通路（`UpdateVariable` → var-tracker → era 桥 → iframe；`sendUserMessage` → 输入框）。
   这一步才是真正的"继往开来"：不是继续兼容 ST，而是给出更好的写法。
   注意**不要**为了它破坏现有 ST 卡通路（沙箱 + 垫片 + 兼容层是资产，不是负债）。

---

## 18. 第 18 轮：卡脚本被替换串 `$'` 打坏（2026-09-22 深夜，**必修级**）

### 18.1 症状与危害

用户报"DSH 里卡完全不能交互、数据全空、tab 点不动"，但 **HTML/CSS 渲染正常**；
控制台只有一行（出现两次）：

```
about:srcdoc:4102  Uncaught SyntaxError: Invalid or unexpected token
```

危害等级：**卡的 JS 全废**。而 HTML/CSS 不经 JS 解析，所以界面"看起来是对的"——
这是最容易被误判成"数据/接口问题"的一类缺陷。

### 18.2 根因（定位到字符，不是推测）

卡的 `[2]「ERA 状态栏」` 正则，**替换串就是一整页 210KB HTML**；文档里的卡 JS 写着
`function isTemplate(key){return key&&key.charAt(0)==='$'}`。
我们此前用 `String.replace(re, replaceString)` 做替换 —— 替换串里的 **`$'`** 被 JS 当成
"**匹配之后的文本**"引用，于是那行变成：

```
坏: function isTemplate(key){return key&&key.charAt(0)==='      ← 引号被吃掉，字符串未闭合
    <StatusPlaceHolderImpl/>}'                                   ← 占位符文本被插进来
净: function isTemplate(key){return key&&key.charAt(0)==='$'}
```

同类危险序列：`$&`（整个匹配）、`` $` ``（匹配之前的文本）、`$$`。

### 18.3 修法与铁律

照抄 ST 的**函数式替换**（`public/scripts/extensions/regex/engine.js:419-442`）：
用 `text.replace(re, function (match, ...groups) {...})`，只**显式**展开
`$1…$99` 与 `$<name>`（外加 `{{match}}` → `$0`），其余 `$` 一律字面量。

> **铁律**：`lib/regex-engine.js` 里**不许**再出现 `text.replace(regex, replaceString)`
> 这种字符串替换。卡的正则替换串是**数据**（经常是一整页 HTML），不是模板。
> 回归哨兵：`test-regex-engine.mjs` 的「替换串里的 $ 序列」五条。

### 18.4 复现/验证脚本（已随修复清理，需要时按此重建）

1. 取真消息（含 `<video>` 那条）+ 真卡脚本 → `applyCardScripts(text, scripts, 'display', {depth:0})`
2. 产物过 `renderFencedHtml` → 取 `srcdoc=` → **单遍**解码 HTML 实体
   （⚠ 不能用链式 `replace` 解码：会二次解码 `&amp;#39;`，掩盖真问题）
3. 逐段 `<script>` 跑 `new vm.Script(code)` → 报错会给出**段内行号**，加上段起始行即文档行号

### 18.5 ★★ 本环境的 git 陷阱（与 §16.5 同类，比它更硬）

**`git commit` / `git update-ref` 写引用在本环境会被静默吞掉**（lockfile+rename 不持久），
后果有两种形态，都很难发现：

- `git log` 报 `your current branch '…' does not have any commits yet`（引用没落地）；
- **更坏的一种**：提交在**未出生分支**上发生 ⇒ 变成一个**孤儿根提交**（无父），
  历史被"截断"，而 `git commit` 照样打印成功。

**可靠做法**：用 `tools/commit-direct.mjs`（本仓库自带）：

```powershell
node tools/commit-direct.mjs            # 内部：git add -A → write-tree → commit-tree -p <父> → fs 直写 refs
```

它**只创建对象 + 直接写引用文件**，绕开 lockfile+rename。要点：
- 父提交必须显式给（脚本里写死那几个 sha，按需改）；
- 写完在**下一个命令**里复核 `git rev-parse --short HEAD`，确认引用真的落地了；
- 发现孤儿提交（reflog 里 `00000000 → <sha>  commit (initial)`）时：把内容保留在工作区，
  `reset --soft <真父>` 后重提，或用 `commit-tree -p <真父>` 重建。

其它同类事实：`.git/logs/HEAD`（reflog）是**可靠**的 —— 它是 append 写入，不吃 rename 的亏；
所以**引用丢了就翻 reflog**，非空即可完整复原。

## 19. 第 19 轮：帧高两处裁剪缺陷 + 「卡到底活没活」的取证法（2026-09-22 深夜）

### 19.1 「卡里什么都没有」的正确归因顺序（★ 先跑这条，别再猜）

用户的观感（状态栏没变量 / tab 点不动 / 选项没反应 / 视频不出现）**可以全部由「卡脚本死了」
一条解释**。所以排查第一步永远是：**卡里的 JS 到底跑没跑**。

取证法（真浏览器 + 真协议 + 真数据，一次跑完）：

1. `GET /api/muv-table/tavern-card?sessionId=<会话>` → 拿 `initvarData`（**活的**变量树）
2. 从真卡 PNG 取围栏文档 → `R.cardHtmlIframe(doc)`（`loadClientRenderers(undefined,{innerHeight:900})`）
3. 探针页里内联**逐字提取**的 `heightRuntimeSource(src)` + `muvEraSend` + `muvEraDeliver`，
   用 `muvEraDeliver(frame,'era:getCurrentVars',initvarData)` 按**真实协议**投递
4. `openPage()` 起真 Edge（`windowSize 1200,1000`）→ **实时**等 8~9s（⚠ 不能用
   `--virtual-time-budget`：OOPIF 里的 `setTimeout` 不跟虚拟时间走）
5. 读数：父页 `iframe.style.height`；**在 OOPIF 会话里** `Runtime.evaluate` 读
   `document.body.innerText`（找得到变量值 = 数据到位）；父页挂 `Runtime.exceptionThrown`
   收卡内异常（`sid === pageSession` 分辨父/子）

实测结论（`_足控天堂2` 的 ERA 状态栏）：**异常 0 条**、innerText 含 `2026年8月26日` /
`龙国` / 因特网面板全部舆情条目 ⇒ 数据链路本来就是通的。

⚠ 一个坑：`Runtime.enable` 要在 `Target.setAutoAttach` 之后、且**在 OOPIF 会话上再 enable 一次**，
否则卡内异常收不到（看着"零异常"，其实是没订阅）。

### 19.2 缺陷 A：`MUV_FRAME_H_MAX` 2400 → 12000

ST 本体**无上限**（`body.scrollHeight` 原样进 `frameElement.style.height`，ST-IFRAME-SPEC §6）。
2400 会静默截断（且 reset 里 `overflow:hidden!important` ⇒ 连滚动条都没有）。
真卡实测已到 2056 / 2083。语义改为「只拦畸形值」。
**判据不写死数字**：一律 `R.muvFrameHeightLimits().max`。

### 19.3 缺陷 B：父页 8px 死区无差别吞掉「增长」（★ 最容易漏的一条）

`onMuvFrameHeightMessage` 原本 `Math.abs(cur - h) < 8 → return`。
孩子侧的溢出学习是对的（`need = body.scrollHeight`，精确值），但那份精确值在父页被死区丢掉。
实测：**内容 894 / 帧 889** —— 卡底部永久少 5px。

为什么"最后几个像素"只有滚动区看得见：`extent()` 遍历元素取 `top + max(rect.height, scrollHeight)`，
而 **`getBoundingClientRect()` 不含 margin** —— 末尾元素的 margin-bottom 只在 `body.scrollHeight` 里。

修法：`if (isFinite(cur) && h <= cur && (cur - h) < 8) return`。
**铁律统一**：滞回（孩子侧的 `__muvHReset`、父侧的这 8px）**只能作用在收缩方向**；
增长方向只要孩子报了就必须立刻满足。

### 19.4 一条观察（不是缺陷，别去"修"）

`主页` 卡是**浅色底卡片**：正文 `rgb(40,73,92)`，根节点与 `html/body` 背景**全透明**。
它假定宿主背景是浅色。ST 同样不注入背景（§4 的 reset 只有 margin/padding/overflow/max-width），
所以深色主题下两边都"看不见字"。要改也得先问用户（注入白底会破坏深色卡的观感）。

### 19.5 本轮改动的文件

- `lib/client.js`：`MUV_FRAME_H_MAX`、`muvFrameHeightLimits()`、`onMuvFrameHeightMessage` 死区
- `test-client-render.mjs`（196 通过）/ `repro-frame-height.mjs` / `verify-frame-height.mjs` /
  `verify-frame-ratchet.mjs`：上限判据改为从实现读 + 新增增长回归

## 20. 第 20 轮：接上 ERA 增量块（`<VariableEdit>`）—— 卡的数据区终于活了（2026-09-22 深夜）

### 20.1 症状 → 真因（一件根因，三个症状）

用户报"选项里没有内容，而且视频也没有"。真因**只有一个**：我们从没解析过社区卡
（TavernHelper「ERA 变量框架」）的**每楼增量块**。

- 卡里 `<span class="choice-text" data-era="剧情选项.选项1">`，而卡的**声明式**初始变量里
  `剧情选项 = {选项1:"",选项2:"",选项3:""}` ⇒ 卡把空串填进选项 ⇒ 看着"选项没内容"；
- 数值（好感度/压力值/五感）同理停在初值；
- 卡源码 `/* NSFW 视频需好感度 100 才可解锁 */` ⇒ 好感度不对，**CG 画廊的视频全锁着**
  —— 用户说的"视频没有"就是这条，不是消息里的 `<video>`（那条实测是正常的，见 §20.5）。

### 20.2 ★ 怎么找到它的（定位法，下次照抄）

用户的 ST 界面一切正常 ⇒ **数据一定在** ST 的某个存储里。所以不要读我们的代码猜，
去 ST 的数据目录按标签名逐个搜：

```
grep -r "era_mk_" data/            # 只有聊天文件命中
grep -o "VariableEdit" <chat>.jsonl
```

**大小写是关键**：`grep UpdateVariable` 返回 **0**，而它叫 **`<VariableEdit>`**（大写 V）。
一次 grep 用错大小写，会让整个数据源看起来"不存在"。

真形态（`_足控天堂2`，消息正文末尾）：

```
<VariableThink>…（模型对变量改动的思考，里面会**引用标签名**）…</VariableThink>
<VariableEdit>
{ "世界信息": {"时间":{"时间详情":"20:00"}, "区域地点":"红玉膳房包间"},
  "剧情选项": {"选项1":"继续品尝她的脚。","选项2":"…","选项3":"…"},
  "主播档案": {"超天酱": {"数值": {"好感度": -50, "压力值": 95}}} }
</VariableEdit>
<Status_block>…（给卡渲染的状态文本）…</Status_block>
<era_data>{"era-message-key"="era_mk_1789928712211_a6czp6","era-message-type"="assistant"}</era_data>
<StatusPlaceHolderImpl/>
```

★ `era_data` 里用的是 **`=`** 不是 `:` ⇒ 不是合法 JSON，**不能 JSON.parse**，要用正则抓键。
★ 键里的第一段是**毫秒时间戳** ⇒ 天然可排序，这就是"按楼重放"的依据。

### 20.3 实现（两侧各一处）

- **服务端** `var-tracker.js`：`parseVariableOps()` + `applyVariableMessage()`。
  `applyVariableMessage` 是**记账 + 重放**，不是"到场即合并"——
  装饰异步乱序，旧消息可能后到，而每楼 JSON 是**绝对值**；到场即合并会让字段回退。
  重放排序用消息键的时间戳 ⇒ 与送达顺序无关、重复送达幂等。
- **客户端** `client.js`：`muvFeedVariables` 收第二种数据源 + **喂 `body.innerHTML`**
  （见 §20.4）+ 新增 `muvEraPushToFrames()` 主动把新状态推给在线卡帧
  —— 卡的查询周期只有"加载后 1200ms 那一次"，回灌却发生在装饰期，不推就停在初值。

### 20.4 两个坑（★ 都会**静默**失败，无异常无请求）

1. **喂 `innerText` 会永远匹配不到标签**：DSH 把消息渲染成元素时，`<VariableEdit>` 的
   标签名不在 innerText 里（只剩 JSON 文本）。⇒ 必须喂 `body.innerHTML`，
   **并且做实体解码**（`&lt;VariableEdit&gt;` 形态也要能命中；`&amp;` 最后解）。
2. **模型会在 `VariableThink` 里"提及"标签名**（"生成一个 `<VariableEdit>` 块来更新…"）。
   直接扫标签会从这句提及一路吃到**真块**的收尾标签 ⇒ `Unexpected token '\`'`。
   实测 4 条真消息里 3 条踩。修法：先整块剔掉 `VariableThink`；再用"内容必须以 `{`/`[` 开头"
   拒绝错配，并把扫描位置**退回开标签之后**重来 —— 算成 `bad` 跳过会把后面的真块一起漏掉。

### 20.5 视频那条的实测结论（别再往这条上查）

消息里的 `<video>NSFW/东雪莲/舔小穴1</video>` 经真引擎 → 变
`<video src="https://zyxjack123.top/足控天堂/视频/NSFW/东雪莲/舔小穴1.mp4" controls>`
→ 落在「正文美化」围栏文档的 `<div class="reading-content">$1</div>` 里 → 进 iframe。
真浏览器实测：`readyState=4 / err=0 / 610×610 / display:inline`，**能播**。
用户说"视频没有"指的是 **CG 画廊的 NSFW 视频锁着**（§20.1 第三条）。

### 20.6 新门禁 `test-era-vars.mjs`（17 条）

合成用例覆盖"提及错配 / 三种块 / 乱序一致 / 幂等 / 无键块"，真聊天文件在场时再跑一遍真数据
（取不到就 SKIP）。**"倒序送达 = 顺序送达"这条当场抓出了 `touchSession` 先 delete 后 get 的 bug**
（等于每次调用都新建账本 ⇒ 只剩最后一条消息的效果）—— 顺序无关的断言值得为每个有状态组件写一条。

### 20.7 已知限制（如实记录，不假装等价）

- 没有 `<era_data>` 键的老格式块：只能按**到达顺序**追加。
- 装饰只覆盖 **DOM 里存在的消息**；若 DSH 对消息列表虚拟滚动，滚出去的历史楼层不会被重放。
- `VariableThink` / `VariableEdit` 目前渲染成**折叠块**（`🔧 变量更新`）。
  ST 那边是 TavernHelper 把它们**吃掉**（所以 ST 里看不到）—— 要不要跟着隐藏，等用户表态。

## 21. 第 21 轮：客户端同源 `$&` bug（2026-09-22 深夜，**必修级**）

### 21.1 症状与排查顺序（★ 值得背下来）

推送日志显示 `era push → 10 棵树 → 2 帧`（状态确实进了卡），服务端状态也是真值，
**但卡上选项仍空白**。此时正确的下一步不是继续加推送，而是**问"卡还活着吗"**：

- **界面渲染正常 + 功能全废** ⇒ 九成是**卡内脚本死了**（HTML/CSS 不经 JS 解析）。
- 判断法：卡内 `console.log` 是否出现（这些行会以 `about:srcdoc:LINE` 出现在宿主控制台）；
  或按 §19.1 的办法在 OOPIF 会话里读 `document.body.innerText` / 挂 `Runtime.exceptionThrown`。

### 21.2 根因：`String.replace` 的**字符串替换**语义（与服务端第 4 轮同源）

客户端把 210KB 卡文档拼进替换串：

```js
result = result.replace(STATUS_PH_ALL, '<div class="muv-statusbar-wrap">' + frame + '</div>')
```

卡自己的 ERA 脚本里有 `key.charAt(0)===&#39;$&#39;` —— `$` 后紧跟 `&`（`&#39;` 的首字符）
⇒ 被当成 **`$&`（整个匹配）** ⇒ 那行变成 `===&#39;<<StatusPlaceHolderImpl/>#39;}`
⇒ **卡脚本语法错误** ⇒ 卡的 JS 全废。

**铁律（与服务端 §18.3 同一条，两端都要守）**：
> 凡是把"别人的一大段文本"（卡 HTML、正则替换结果、消息正文）拼进替换串，
> **一律用函数式替换** `replace(re, function () { return … })`，不要用字符串替换。

### 21.3 修法与门禁

- 抽 `muvFrameBlock(frame)`；**三处**（`STATUS_PH_ALL` ×2、`Status_block` ×1）全改函数式。
- `test-client-render` 第 **[17]** 段（6 条）：
  - 行为：函数式替换对含 `$&` / `$'` / `` $` `` / `$1` 的载荷**逐字安全**；
  - **对照臂**：同样的载荷换成字符串替换**确实会被改写**（证明判据能红，不是空转）；
  - 源码：三处调用点不许退回字符串形态。
- 实测（真卡 241KB frame）：字符串替换改写在**位置 199284**（正是那行 `isTemplate`）；
  函数式替换后 frame 逐字不变。

### 21.4 同类风险清单（下次 grep 的入口）

在 `lib/client.js` 里搜 `.replace(` 且**第二个参数是字符串拼接**的地方。
已知安全/已修的：`muvFrameBlock` 三处（已改）、`muvRenderTagRules`（本来就是函数式）、
`renderFencedHtml`（构造 segments 再 join，不经 replace）。

## 22. 第 22 轮：运行时状态少剥一层信封（2026-09-22 深夜）★ 现场取证

### 22.1 ★★ 怎么"直接看到用户的控制台"（本轮解锁的能力，以后常用）

用户问"能不能让你直接观看到控制台"。能 —— DSH 的 Web 鉴权支持**持久签名 Cookie**：

1. 签名密钥在 `~/.dsh/.credentials.yaml` → `records.client-connection/browser-session`
   （`kind: grant`，`payload.secret`，32 字节 base64url）；
2. Cookie 名 = `dsh-auth-` + base64url(sha256(**authority**))，authority 就是 `127.0.0.1:3080`；
3. 值 = `v1.<base64url(JSON payload)>.<base64url(hmacSha256(secret, body))>`，
   payload = `{version:1, authority, issuedAt, expiresAt}`（毫秒整数）；
4. 用 `Network.setCookie` 塞进无头 Edge，就能 `Page.navigate` 打开本地 DSH，
   **开 Runtime/Log 域拿到控制台、用 `Runtime.evaluate` 进 OOPIF 读卡内 DOM**、
   数 `Target.attachedToTarget`（type=iframe）来量化"一直闪"。
5. 切到指定会话：`localStorage['dsh.sessions.current'] = {"sessionId":"session-…"}` 后重载。

⚠ 两条纪律：① **只读**，不要在这条通道里发消息/改状态；
② `.credentials.yaml` 里还有用户的 API Key —— 读取时**必须按缩进层级打码**，
   本轮的打码正则写漏了缩进层级，把 key 明文打进了工具输出（已当场告知用户轮换）。
   教训：**打码要用"白名单键"而不是"黑名单值"**，宁可只打印键名。

### 22.2 症状 → 根因（又一个"看起来像个别字段"的假象）

17 个 `data-era` 填上 14 个，只有 `剧情选项.选项1/2/3` 空着、时间停在 initvar 的 `10:00`。
看起来像"个别字段没填"，其实**整份运行时状态都没接上**：填上的那些字段 `initvarData`
本来就有默认值，而 `剧情选项` 的默认值恰好是空串。

根因：`/api/muv-engine/state` 回的是 `stateStore` 记录本身
`{ ok:true, state:{ data:{…}, updatedAt } }`，客户端原来 `return d.state`
⇒ 值被塞进**深一层** `stat.data.*`。**现场证据**：卡内 `currentStat` 的键里多出
`data` 与 `updatedAt`。修法：剥一层（`s.data` 优先，兼容两种形状）。

### 22.3 ★ 门禁自己也有洞（一起补了）

`verify-era-bridge` 的 fetch 桩**对所有 URL 返回同一份** payload ⇒ "取运行时状态"那条分支
永远 `d.state === undefined` ⇒ 静默退回 base ⇒ **"信封有没有剥"根本测不到**；
而断言只查 initvar 本来就有的字段，所以一直绿。
补法：把运行时状态挂进**同一份信封**（不改桩，零风险），并新增两条**能红的**断言：
运行时值覆盖初始值（`23:59` vs initvar `10:00`）、initvar 为空的字段必须被运行时填上。
两条在 nobridge / before 对照臂上都是红的 —— 判据不是空转。

### 22.4 现场复验（用户会话，真实数据）

```
csKeys: [世界信息…主播档案]      ← 信封键 data/updatedAt 已消失
csChoice: {选项1:"把足控榜和歌回数据并排放给超天酱看，直说这公司得换条路走", …}
csTime: 时间详情 "10:15"          ← 运行时值
empty: []                        ← 没有空字段
```

### 22.5 一条顺带确认的事实

**客户端改动不需要重启 DSH**：只改 `lib/client.js` 后，页面重载就拿到新构建标记
（本轮实测页面直接加载到 `2026-09-22i`）。服务端改动（`lib/index.js`、`var-tracker.js`）才必须重启。





---

## 23. 绝不把自己的产物当成原文再跑一遍（重复装饰）

### 23.1 症状 → 真凶

症状：正文中段凭空出现 `📖 时间：… 摘要内容 …`、`💭 变量推演`、`✏️` 三段文字
（用户："这个时间出现的地方不对劲"）。

真凶不在卡、也不在正则引擎，而在**装饰器自己的输入源**：

```
_decorateOne:  raw = body.innerText        ← 输入是"渲染后的 DOM 文本"
               …而我们的产物（.muv-statusbar-wrap / .muv-abstract / .muv-varthink /
               酒馆注入的 ✏️ 按钮）就在那个 DOM 里
```

重复装饰一次，`innerText` 拿到的就是**我们自己渲染出来的文字**：

- 卡正则 `<(?:content|TXT|正文|response|game …)>…</…>` 仍然命中（字面量还在）⇒ 文档照建；
- `<Abstract>` 的**标签**已被换成 `<div class="muv-abstract">` ⇒ card `[7]`
  `/^\s*<Abstract>[\s\S]*?<\/Abstract>\s*$/gm`（**大小写敏感 + 行锚 + `gm`**）必然落空
  ⇒ 摘要正文（时间/地点/摘要内容）永久露在正文里，并被当成正文塞进整页文档。

**识别指纹**：那段文字在文档 `body.innerHTML` 里是**裸文本**（非标签），且
`时间：`/`地点：` 并成了一行 —— 这是"过了 `innerText` 的 HTML 空白折叠"的特征。
反证：拿同一份原文打服务端 `/api/muv-engine/apply-regex-card`，产物里
`摘要内容 / 时间： / 📖 / 💭 / 变量推演` 全是 **0**（`applied=6`）。

### 23.2 铁律

1. **取文之前先摘掉产物**：`innerText` 是"渲染投影"，不是原文。凡是要把 DOM 文本当原文的
   地方，都必须先把**非正文节点**（含我们自己的）从文本源里排除。
2. **装饰器不信任调用方**：目标可能是消息根、也可能是 DSH 的侧边面板。一律走
   `muvMessageBodyOf()` 归一/拒绝 —— 实测面板（`_surface_*` / `_pane_*` / `_paneBody_*`）
   曾被当成消息装饰，**面板内容被吃掉**。
3. **"已经装饰过"的判据要看产物，不要只看标记属性**：React 重渲染会丢属性，
   而产物（`[class*="muv-"]` / `iframe.muv-iframe`）是硬证据。
4. 用**前缀选择器**（`[class*="muv-"]`）而不是枚举类名 —— 枚举漏项这个坑本项目已栽三次
   （见 §18/§20 两次与 §21 的 `$&` 坑）。

### 23.3 门禁

`verify-no-redouble.mjs`（真浏览器 + 真 `_decorateOne`）：
- A 档（干净正文）必须被装饰 —— 防"守卫把整条链掐死"；
- B 档（已含 iframe / 📖 摘要框 / 💭 变量推演 / ✏️ 按钮）**一个字符都不许动**；
- C 档（面板，无正文容器）不许碰；
- **before 臂**（`git show <BEFORE_REV>:lib/client.js`）B 档**必须被再装饰**，且读到的
  "原文"必须含 📖/💭/✏️ —— 否则判据是永真。实测 before 臂逐字复现了线上那段垃圾文本。

### 23.4 「日常」没声音 —— 预设列表与 CDN 命名不一致（**不是我们的偏差**）

卡模板 `processAudio()`：`<audio>日常</audio>` → `${BASE_URL}音频/${n}.mp3`。实测 CDN：

| 名字 | HTTP |
|---|---|
| `日常.mp3` / `搞笑.mp3` / `欢快.mp3` / `暧昧.mp3`（预设 `#音乐列表` 里就是这些） | **404** |
| `日常1.mp3` / `日常2` / `日常3` / `搞笑1` / `欢快1` / `暧昧1` | **200** |

⇒ 模型照预设列表写裸名，卡拼出的一定是 404；ST 侧同一张卡同一 URL **同样静默**。
垫片加了出错兜底（`verify-audio-fallback.mjs` 五档）：失败时试 `<名字>1/2/3.mp3`、
已带序号不猜、别名记号挂元素、改写要清 `<source>` 再设 `src`（只改 `source.src`
**不会重新触发选源** —— 实测重试一次后就不再报错）。

### 23.5 同类风险的 grep 入口

- `lib/client.js` 里搜 `innerText` / `textContent`：每一处都要问"这里面会不会有我们自己的产物"。
- 搜 `data-muv-decorated` 的**写入点**：只应落在正文容器上。
- 卡 iframe 内的媒体：搜 `__muvAudioFix`。

---

## 24. 第 24 轮：ST `b1` 无条件注入前端库 —— 我们也注入了（2026-09-22）

### 24.1 事实（这次是从 ST 源码里逐字取的，不是类比/推测）

`ST-IFRAME-SPEC.md` §3 那条 `b1()` 里的 `${v1}`，在
`C:\MySpecialFolder\SillyTavern\public\scripts\extensions\third-party\JS-Slash-Runner\dist\index.js`
里是一个**纯字符串模板**（搜 `npm/@fortawesome/fontawesome-free/css/all.min.css` 就能定位）：

```
<link rel="stylesheet" href="…/@fortawesome/fontawesome-free/css/all.min.css">
<script src="…/lib/tailwindcss.min.js">              （就是 @tailwindcss/browser@4.1.12）
<script src="…/jquery/dist/jquery.min.js">
<script src="…/jquery-ui/dist/jquery-ui.min.js">
<link  rel="stylesheet" href="…/jquery-ui/themes/base/theme.min.css">
<script src="…/jquery-ui-touch-punch">
<script src="…/vue/dist/vue.runtime.global.prod.min.js">
<script src="…/vue-router/dist/vue-router.global.prod.min.js">
```

ST 用的是 `testingcf.jsdelivr.net`（国内镜像）；我们用规范域名 `cdn.jsdelivr.net` + **钉版本**。

⇒ **ST 里的卡 HTML 天然拥有 Tailwind / jQuery / jQuery-UI / Vue / Vue-Router / FontAwesome**，
写卡的人从不自己引。我们此前一个都没有 —— 这是「卡里东西出不来」的一条**独立**原因，
与沙箱、变量、替换串那几类是**并列**的：

- Tailwind 类没有任何 CSS 规则 ⇒ 布局塌掉（`class="w-full"`、`hidden`、`flex` 全是空类）；
- `$` / `Vue` 未定义 ⇒ 卡的脚本第一行就抛 ⇒ **界面照常渲染、功能全废**
  ——和 §18（`$'`）、§21（`$&`）那两次**症状一模一样**，排查时先分清是哪一类。

### 24.2 我们的实现（开关、位置、顺序）

| 项 | 值 |
|---|---|
| 开关 | **`var MUV_CARD_LIBS = true`**（`lib/client.js`，默认**开**） |
| 读取口 | `muvCardLibsOn()` —— 做成函数是为了「逐字提取执行」的门禁（闭包变量不在提取物里） |
| 标签 | `muvCardLibTags()`：FA CSS → Tailwind → jQuery → jQuery-UI → Vue → Vue-Router |
| 注入点 | `withCardLibs()`：插在 **`</head>` 之前**（不是 `<head>` 之后） |
| 调用点 | 唯一：`muvInjectDoc()`（= 我们自己的卡 iframe 那条路，DSH 自己的 iframe 不经过） |
| 沙箱 | **没动**，仍是 `allow-scripts`（见 §9：加库不是放开 `allow-same-origin` 的理由） |

★ 注入点为什么是 `</head>` 之前：它仍在 `<body>` 之前（卡的脚本拿得到 `jQuery`/`Vue`，
与 ST 时序一致），但排在 compat 垫片与 reset **之后** ⇒ CDN 慢/挂时不会把我们自己那两段
一起推迟 —— 最坏只是"库没到"，不是"卡不渲染"。

版本钉死（FA 6.7.2 / Tailwind 4.1.12 / jQuery 3.7.1 / jQuery-UI 1.13.3 / Vue 3.5.13 /
Vue-Router 4.5.0）：卡的写法是针对某一代库调过的，让 CDN 的 latest 自己往前走会引入
**无法复现**的回归。

### 24.3 与 ST 的两处**有意**差异（别当成 bug 修）

1. **Vue 用完整构建** `vue.global.prod.js`，不是 ST 的 `vue.runtime.global.prod`
   （runtime 版不含模板编译器）。完整版是它的**超集**：ST 能跑的这里都能跑，
   额外还能跑 `template:` ⇒ 只会多救几张卡，不会少。
2. **省略** jquery-ui 的 `theme.min.css` 与 `jquery-ui-touch-punch`（ST 有）：
   两者只影响 `.ui-*` 控件与触屏拖拽；每多一个远程资源就多一份失败面。
   真遇到依赖它们的卡再照 ST 的顺序补（theme 在 jquery-ui 之后）。

### 24.4 会因此变好的卡（判据，不是许诺）

满足**任一**条的卡，视觉/交互都会变（此前是"少了样式/少了脚本"）：

1. 文档里出现 Tailwind 工具类（`w-full` / `hidden` / `flex` / `grid` / `text-*` /
   `p-4` / `rounded-*` …）—— 此前这些类**没有任何 CSS 规则**；
2. 卡脚本里出现 `$(` / `jQuery(` / `$.ajax` / `$(...).dialog(`（jQuery-UI）；
3. 卡是 Vue 应用（`Vue.createApp` / `createRouter` / `v-if` / `{{ }}`）；
4. 图标用 `fa-solid` / `fa-brands` / `fa-*`。

**反过来，会因此"变化"的卡也要盯一眼**：Tailwind v4 自带 **preflight**
（`* { margin:0; border:0 solid; box-sizing:border-box }`），所以一张**没用** Tailwind、
只靠浏览器默认样式的卡，注入后 margin/边框会消失 —— 这在 ST 里**同样发生**
（ST 也注入 Tailwind），所以是"更接近 ST"，不是回归；真要排查就把 `MUV_CARD_LIBS`
设成 `false` 对比一次。

### 24.5 门禁与已知依赖

- `verify-card-libs.mjs`（新增，真浏览器 + 真沙箱 + 真 CDN，23 项）：
  A 臂实测 `jQuery 3.7.1 / $.ui / Vue.createApp / VueRouter.createRouter /
  "Font Awesome 6 Free" / .hidden→none / .flex→flex / body{margin:0}`；
  B 臂（不注入）**全部不是** —— 没有这个对照臂，A 臂的断言全是永真。
  ⚠ **它依赖网络**（真下载 CDN）。离线会红，那是真实信号，不要改成"跳过"。
- `verify-visual.mjs` 的 `stripInjected()` 现在要剥**四段**（reset + 垫片 +
  **前端库** + 引导脚本）。只剥三段时「正文逐字相等」会**恒定差 691 字**、
  首处不同恒在 `</head>` 之前 —— 看到这个数字不要往浏览器抖动上想。
- `test-client-render.mjs` 第 **[20]** 段（22 项）钉住：开关默认开、六个 URL 与顺序、
  不含裸 `</script>` 与反引号、注入位置、幂等、关闭时逐字不变、以及
  「卡脚本字符串里的 `</head>` 不被当成落点」。

### 24.6 已知风险（如实记录）

- **CDN 挂起（不是失败）会推迟卡的解析**：`<script src>` 是阻塞式的，与 ST 一致。
  失败（DNS/404）是快的、无影响；**无响应**会让卡空白直到超时。
  要彻底规避只能改 `defer/async`，但那会让卡的内联脚本拿不到 `$`/`Vue`
  —— 与 ST 的时序不等价，**故意不改**。
- Vue 的**完整构建**比 ST 的 runtime 版大约 50KB，且允许 `template:` 字符串
  ⇒ 理论上会多执行一些卡内代码。这些代码原本在 ST 里也会执行（只是会报错），
  执行面没有扩大到 ST 之外。

### 24.7 顺带：隐藏与 iframe 重复的整页源码块（ST 的 `hidden!`）

同一轮做的第二件事，写在 §24.7 是因为它**同属"ST 有而我们没有"**这一族：
ST 给消息里残留的 `<pre><code>` 加 `hidden!`（§2 / §8 第 2 条）。我们靠
"整页 HTML 换成 iframe"绕过了大部分情况，但**卡正则没产出整页文档**时，
那一大段源码仍会露成裸文本。

实现（`lib/client.js`，刻意做小做保守）：

| 函数 | 作用 |
|---|---|
| `muvIsPageSourceText(t)` | 判据**窄**：`<!doctype html>` + `<html`/`<head`/`<body`；或 `<head`+`<body`；或含 `__muvReset`；外加长度 ≥ 200 |
| `muvHidePageSourceBlocks(body)` | 只动 `<pre>`；跳过落在我们自己产物里的；内联 `display:none!important` + `data-muv-src-hidden` 记号 |
| 挂点 | `_decorateOne` 的**最后一步**（装饰成功与否都跑） |

★ 两条纪律（改这条前先读）：
1. **不许无差别隐藏代码块** —— 用户正常的 ``` 代码块必须原样活着。判据只能加严，不能放宽。
2. **不用 `hidden` 属性**，用内联 `display:none!important` —— 属性会被 DSH/卡给 `pre`
   设过的 `display` 盖掉（属性 vs CSS 优先级，本项目在别处吃过同类的亏）。

门禁：`test-client-render.mjs` 第 **[21]** 段（含**变异对照臂**：把判据摘掉 ⇒
一块都不隐藏）；`verify-decorate-dom.mjs` 第八类 `H_source`（真浏览器 + 真
`_decorateOne`，改动前的源码上**实测 FAIL**：`srcHidden=0 / srcLeak=1 / preVisible=3`）。

---

## 25. 第 25 轮：变量内核四项打通（命令式写 / `stat_data` 归一 / 宿主 API 垫片 / 新值回推）· `2d3d82a`

### 25.1 症状 → 四个独立原因（一个症状，四条根因）

用户导入的新 MVU 卡：**界面渲染正常，但一个数字都不动、按钮点了没反应、控制台无异常无请求**。
这类"看起来像一件事"的症状，本轮拆出**四条互不相干**的原因（每一条单独存在都会造成同样的观感）：

| # | 原因 | 证据 |
|---|---|---|
| ① | 命令式写（`_.set('a.b',v)`）从没进解析器 | 卡的 `_.set(` × **39**；`var-tracker.js` 只认 `<initvar>` YAML 与 ERA 增量块 |
| ② | `stat_data` 路径对不上 | 卡的读链是 `pickStat(o)` ⇒ 只认**非空** `o.stat_data`（从 `1.txt` 逐字抠出）；我们存的是平铺树 |
| ③ | 卡要的宿主 API 我们一个都没提供 | 卡的 `stat_data × 105`、`Mvu. × 53`、`getVariables( × 17`、`triggerSlash( × 6` |
| ④ | 回灌后在线卡帧仍停在加载时那次查询的旧值 | 回灌只写服务端状态，没有"再推一次"给**已经站在页面上的**帧 |

### 25.2 ★ 本轮最值钱的一条教训：判据必须照**真卡的实际形状**写

我一度按"二手转述"给父页探测写成 `window.parent.TavernHelper || window.TavernHelper`，
门禁红。**回去取证**（`C:\deepseek harness\_scratch\probe2.out.txt`，从 `1.txt` 抠出的原文）
才看到真卡是：

```js
function resolveTH() {
  var c = [];
  try { c.push(window.TavernHelper); } catch (e) {}
  try { c.push(W.TavernHelper); } catch (e) {}          // W = (…window.parent.document ? window.parent : window)
  try { c.push(window.parent && window.parent.TavernHelper); } catch (e) {}
  try { c.push(window.top && window.top.TavernHelper); } catch (e) {}
  for (var i = 0; i < c.length; i++) if (c[i] && typeof c[i].getVariables === 'function') return c[i];
  return null;
}
```

三条事实（都影响实现，不是风凉话）：
1. 探针**各自 `try` 包住** ⇒ 父页取不到不会炸卡；
2. **`window.X` 排第一** ⇒ 只要同名对象在**卡自己的 window** 上，就命中；
3. 沙箱是不透明来源 ⇒ `window.parent.X` 是**抛 `SecurityError`**，不是"返回 `undefined`"，
   更不是能靠 `||` 短路的东西。

⇒ 结论：垫片把同名对象定义在**卡自身 window** 上即可；**绝不为迁就 `window.parent.X` 放宽沙箱**。
门禁的 ⑩d 也改成"照真卡形状的探针链 + 断言 `W === window` + 断言父页确实被拒"，
而不是断言一个**在沙箱下不可能成立**的表达式。

### 25.3 实现（两个文件各一层）

**`lib/var-tracker.js`（服务端，①②）**
- 新增 `parseCommandOps(text)` → `{ops, bad, bytes}`；`CMD_CALL_RE` 的前缀要求是
  **非标识符字符**（否则 `foo_.set(` 会被误认）；
- 新增 `readLiteral` 一族的字面量读取（字符串含转义；反引号含 `${` 直接判失败；JSON 单引号键判失败）；
- 新增 `normalizeStatData(data)`：`{chat:{"0":{variables:{stat_data:…}}}}` ⇒ `{stat_data:…}`；
  **本来就是**顶层 `stat_data` 或**平铺树** ⇒ 原样返回（★ 平铺树不包一层，否则 ERA 卡路径全断）；
- `parseVariableOps` 先收块、再接命令 op，**按文本先后统一排序**后 push（有键走键序重放，无键按到达顺序）；
- `applyOps` 增 `set` / `add` 分支（`add` 当前值非有限数字则从 0 起算）；
- `setState` / `mergeState` 入口统一过 `normalizeStatData`。

**`lib/client.js`（客户端，③④）**
- 垫片第 8 节：`TavernHelper` / `Mvu` / 裸全局同名 / 父页探测（照 §25.2）；
- `triggerSlash` 白名单 `/send` `/setvar` `/getvar` `/echo`，名单外只 `console.warn`（**不执行**）；
- 新增通道 `__muvMvuReq`（卡问一次 MVU 数据）/ `__muvVarWrite`（卡写回，整树 replace、增量 merge）；
- `muvEraPushNow` 每帧推两条：`era:getCurrentVars` + `mag_variable_update_ended({stat_data:…})`；
- 卡内 `__muvAbsorb` 把入站事件**同步吸进** `mvuData` 缓存
  （`Mvu.getMvuData()` 是同步读 ⇒ 不吸缓存就只能回初始值）。

### 25.4 两个坑（★ 都会在门禁上现原形，别绕过）

1. **入站事件仍走 `fire`（卡内派发）而不是 `emit`** —— 用 `emit` 宿主回灌的事件会被再转发回宿主，
   一个来回就成正反馈。`verify-era-bridge.mjs` 的「防环」断言逐字盯着 `…__muvEvent.name)fire(`
   这个形状。我一度把 `fire` 和 `__muvAbsorb` 合进一条 `if` 的 `{}` 里 ⇒ **那条断言直接红**。
   改法是**两条并列 `if`**，而不是去把门禁的 needle 改松 —— 门禁口径是资产。
2. **`_.set(` 的 `(` 位置**：正则含前缀字符，开括号在 `m[0]` 的**最后一个字符**，
   `m.index + m[0].length` 会指向 `(` 之后 ⇒ 从值中间开始读 ⇒ 6 条命令全 `bad`。
   正确是 `m.index + m[0].length - 1`。（这类差一位的 bug 症状是"全 bad"，不是"报错"。）

### 25.5 门禁（全绿，数字）

| 命令 | 结果 |
|---|---|
| `node test-era-vars.mjs` | 全部通过（新增 [4] 命令式 / [5] 混排顺序 / [6] `stat_data` 归一 + 对照臂） |
| `node test-client-render.mjs` | 264 通过 / 0 失败 |
| `node test-regex-engine.mjs` | 26 通过 / 0 失败 |
| `node verify-era-bridge.mjs` | after **21 通过 / 0 失败**；对照臂 nobridge 13/8 红、before 6/15 红 |
| `node verify-card-compat.mjs --old-export` | after **46 通过 / 0 失败**；对照臂 before 9/37 红 |
| `node verify-no-redouble.mjs` | 6 通过 / 0 失败 |
| `node verify-decorate-dom.mjs` | 全部通过（**需先 `$env:MUV_EDGE` 指向 msedge.exe**，否则只生成 fixture 不打分） |

`verify-card-compat.mjs` 新增的 ⑩ 组（⑩ ~ ⑩p）是给垫片配的**三层判据**：
对象在不在 / 卡的**真实读写链**走不走得通 / 名单外命令**不执行**。
before 臂上整组 ⑩ 全红 ⇒ 判据不是空转。

### 25.6 只能真机/实测确认的部分（如实记录，不假装等价）

- `formatAsTavernRegexedString` 现为**原样返回**（实测新卡里计数为 0 ⇒ 先按最小实现兜存在性）；
- `getChatMessages()` 返回宿主喂进来的消息文本数组（不含完整 ST `chat` 字段集）；
- 名单外命令（含卡真用到的 `/inject`）**不执行** ⇒ 只靠 `/inject` 注入变量的卡，那部分功能不生效
  （但会打印 `triggerSlash 未支持：…`，可观测，不会假装成功）；
- 卡若用 lodash 形态 `_.set(对象, 路径数组, 值)`，**不会被**提取（计 `bad`，`/extract` 响应里看得见）。

### 25.7 本轮改动的文件

`lib/var-tracker.js`（346 行）/ `lib/client.js`（303）/ `lib/index.js`（12）/
`test-era-vars.mjs`（125）/ `verify-card-compat.mjs`（160）—— 合计 **+925 / -21**；
`MUV_BUILD` → `2026-09-22l`。
**未动**：`lib/regex-engine.js`、`_decorateOne` 的三条守卫、`<VariableEdit>` 现有解析、另一仓库 `C:\dsh-tavern-v2`。

## 26. 第 26 轮：按楼快照/时间旅行 + git 对象库事故（2026-09-22 晚）· `41c21d8`

### 26.1 按楼快照（时间旅行）
- `applyVariableMessage` 应用完带键消息后取样：`recordSnapshot`（每会话 200 条、按
  `era_mk_<epochms>` 淘汰最旧、超 200KB 存 `data:null` 占位、JSON 往返独立副本防别名）。
- `stateAsOfEpoch` **定向重放**：快照 = "键序 ≤ 该楼"的树，乱序晚到不污染旧楼（unkeyed op 不参与）。
- `GET /api/muv-engine/state`：`?snapshots=1`（清单，时间正序）/ `?messageKey=`（单楼，形状同普通
  GET；键不存在 404 `{ok:false,error:'snapshot-not-found'}`）。**无参形状不变**。
- 快照为**会话级内存态**（LRU 淘汰/重启即失），未引入新存储。
- 面板侧「⏱ 按楼回看」在 dsh-tavern-v2（`5dadf42`，探测式，回看只读、拒绝写回）。
- 测试：`test-snapshots.mjs` 28 项；card-compat 偶发失败经 3 次重跑 + HEAD 对照归因为环境时序，
  与本轮改动无关。

### 26.2 ⚠ git 事故：objects 全灭 + 副本救回
- `git stash` 被环境 SIGTERM 打断 ⇒ `.git/objects` 只剩 1 blob + 无 `.pack` 的 idx、`refs/` 消失。
  v0.3.9 后的提交对象（`26d87c0`/`f3dadd0`/`2d3d82a`/`167d55e`）不可找回。
- 从 `muv-release3` 发布副本（9-20，v0.3.9）恢复对象库与历史，其上一个提交（`41c21d8`）
  收编两天全部工作区成果 —— **代码零丢失**，只丢中间提交粒度。
- **规矩**：① 重要提交尽快 push；② **不要清 `Temp/muv-release*`**（最后救命稻草）；
  ③ 本环境 `git stash` 等会改写 objects/refs 的操作被 SIGNAL 打断可能造成上述损坏 ——
  恢复手法：拷副本 objects + refs、`mkdir refs/heads/wip`、直写分支 ref、`rm .git/index` 重建。

## 27. 第 27 轮：守卫第三次漏 —— 占位符 greeting（2026-09-22 晚）

### 27.1 机制图：first_mes 占位 → 显示层正则 → ```html 整页 → iframe

```
角色卡 JSON
 ├─ first_mes: "【主页】"                ← 7 字占位符，纯文本、无任何 HTML 标签
 ├─ alternate_greetings: ["星盟契约开场白"] ← 魔女卡同款
 └─ data.extensions.regex_scripts[0]「主页」
      findRegex: "【主页】"   markdownOnly: true
      replaceString: "```\n<!DOCTYPE html>…整页界面…</html>\n```"

SillyTavern：首楼文本 = first_mes → 显示层跑 markdownOnly 正则 → 整页 HTML → 渲染卡 UI ✓
我们（修前）：beautifyMuv 守卫 `if (!/<标签>/.test(text)) return text`
             ⇒ "【主页】" 无标签 ⇒ **整楼在取卡之前被跳过** ⇒ 正则从未消费 ⇒ 首楼只有 4 个字
我们（修后）：守卫多一条"短文本放行" ⇒ 取卡 → apply-regex-card 命中 [0]
             → 产物是 ``` 包裹的整页文档 → renderFencedHtml → 卡 iframe ✓（与 ST 平价）
```

### 27.2 守卫的第三次漏与修法

前两次漏（`<content>`/`<now_plot>`、`<video>`/`<img>`）都靠"标签无关形状判据"解决；
第三次漏的根本不同：**这次连标签都没有**。形状判据再怎么扩也认不出「【主页】」，
所以修法换了维度 —— **长度**：

```js
var muvHasTag = /<[!\/]?[a-zA-Z_\u4e00-\u9fa5][^<>]*>/.test(text)
var muvTrimmedLen = String(text).trim().length
var muvShortOk = muvTrimmedLen > 0 && muvTrimmedLen <= 300
if (!muvHasTag && !muvShortOk) return text
```

- **为什么 ≤ 300**：长散文（模型正文主力）不该多付一次取卡成本；greeting 占位符都是几个字。
  阈值写进门禁时**从源码提取**（`shortBoundsOf`），不复制数字。
- **为什么无副作用**：脚本全落空时 `normalized === text ⇒ 原样交回`（§23 兜底不变）。
- **为什么空白不放行**：没有任何可装饰的东西。
- 原 §3488 注释里"仍然不在判据里的：`【主页】`，实测没有只带它的一轮"—— **赌输了**，
  占位符 greeting 楼恰恰就是。已改写注释（过时注释会主动误导人，§15.7 教训第三次兑现）。

### 27.3 ```html 围栏剥壳：已支持，别重复造

`renderFencedHtml` 的围栏配对本来就认 ```` ```html ````/``` + `<!DOCTYPE`/`<html` 开头的
围栏体（`info` 合法信息串 + 文档头判定）→ `cardHtmlIframe`。真卡「主页」（```）与
「正文美化」（```html）都在这条路上。普通 ```` ```html ```` **代码示例**（围栏体不是文档）
原样不动 —— 判据是"围栏体是不是整页文档"，不是"有没有 html 信息串"。

### 27.4 门禁与两处判据更新（都带对照臂）

- `verify-guard-tag-agnostic.mjs`：②b 决策臂（greeting 放行 / 301 字不放行 / 空白不放行 /
  旧决策对照臂必须拦）+ **B7**（真 Edge：G 用例「【主页】」AFTER 取卡+命中+iframe，BEFORE 全 0）。
  78 通过 / 0 失败；`--break=guard-enum` / `--break=guard-never` 仍期望红。
- **判据漂移归因（本轮顺手修，先对照 HEAD 再动手）**：B1/B2/B6 五条在 HEAD 上就是红的
  （HEAD 版门禁 + HEAD 版源码 = 62/5，同一集合）—— `withStatusPlaceholder` 占位符补齐加入后，
  A 楼放行会被卡 [2] 消费出 ERA iframe，旧的「A 的 DOM 不变 / 裸 <audio> 还在」判据过时；
  apply 归属的字数 ±6 容差也被打死（占位符 +25、表头折叠 −151）。已按当前真实行为重写
  （归属改**期望长度最近邻**，阈值 100；A/F 同文不可分 —— F 两臂都不取卡，不影响）。
- `verify-card-compat.mjs`：`OLD_REV = 324b751` 已随 git 事故丢失（§26.2），改 `7623ffa`
  （现存最老 v0.3.9，无垫片；可 `MUV_OLD_REV` 覆盖）。before 臂 9/37 红（对照有效 ✓）。
  after 臂 2~4 条波动失败，**HEAD 源码对照同样红** ⇒ 按 §26.1 口径归因环境时序偶发，不修。

### 27.5 本轮改动文件

`lib/client.js`（守卫块 + 注释改写 + `MUV_BUILD` → `2026-09-22m`）/
`verify-guard-tag-agnostic.mjs`（提取器按块 + 决策臂 + G/B7 + B1/B2/B6 重写）/
`test-client-render.mjs`（[22] 守卫短文本段 + 围栏两例）/
`verify-decorate-session-isolation.mjs` / `repro-native-media-path.mjs`（守卫行提取同步）/
`verify-card-compat.mjs`（OLD_REV）；文档：`CHANGELOG.md`、本节、
`C:\deepseek harness\docs\04-排错手册.md`（I 条）与 `INDEX.md`。

### 27.6 只能真机验的部分

- 魔女卡 / `_足控天堂2` 的**真实首楼**要重启 DSH + 硬刷新后目验：首楼应出现完整卡界面 iframe
  （构建标记须为 `2026-09-22m`）。
- 门禁 G 用例用的是 `_足控天堂2` 的「主页」正则；魔女卡的「星盟契约开场白」正则形状
  （findRegex 是否也认占位符全文）**没验过** —— 若它认的是别的形态，放行已由守卫保证，
  命中与否取决于卡自己的 findRegex。

### 27.7 用户消息桥的发送通道矩阵（send-bridge，2026-09-22o）

**背景**：卡里 `sendUserMessage(msg)` → postMessage → 宿主 `muvDeliverUserText(text,'send')` 代发。
用户实测「卡里提交后 DSH 没生成下文」。桥路其余段（垫片、postMessage、textarea 查找、原生 setter 填值）
已验证畅通，失效集中在**最后一步「合成事件能否真触发 DSH 发送」**。

**取证结论（只读 DSH 本体 `@deepseek-ai/dsh` v0.1.5-rc.2 的 web-frontend bundle）**：
- DSH 聊天界面是 **React 应用**；发送绑定在「发送按钮」（`IconSendOutline` 图标，onClick 与
  onKeyDown Enter/Space → 发送回调）与「输入框 onKeyDown(Enter)」两处。
- 全链路**无 `e.isTrusted` 校验**（bundle 里 `isTrusted:0` 是 React SyntheticEvent 默认字段，不是守卫）
  ⇒ 合成事件可被接受。
- **无 window 级可编程发送入口**（仅 `window.__ModuleLoader__` 内部加载器）→ 「直接调全局函数」通道不可用。
- React `getEventKey` 把 `keyCode 13 → "Enter"`；合成 `KeyboardEvent` 的 `keyCode/which` 取构造参数。
  旧实现只带 `key:'Enter'`（keyCode/which=0）⇒ 处理器若读 keyCode/which 则静默落空 —— **头号嫌疑**。

**发送通道矩阵（按优先级，逐级降级，见 `lib/client.js` 的 `muvUserSendFire`）**：

| 优先级 | 通道 | 触发条件 | 备注 |
|---|---|---|---|
| ① | **真实 `click()` 发送按钮** | 从输入框向上爬父链（≤6 层）收集 `button`：优先 aria-label/title/textContent 含 `发送/Send/submit` 者；否则取末位可见且未禁用 button | 直接调发送回调，不吃事件形态，**最稳**；日志显示命中了哪个 button |
| ② | **完整键盘序列** | 输入框派 `keydown+keypress+keyup`，`key:'Enter'`+`code:'Enter'`+`keyCode:13`+`which:13`（keyCode/which 用 `Object.defineProperty` getter 兜底） | 覆盖读 keyCode/which 的处理器；无按钮场景的兜底 |
| —— | **绝不清空输入框** | 两通道都试过后仍不清除 `textarea.value` | 宁可字留在框里让用户手动按一下，也不能吞字（旧实现失败即不可见） |

- **填值路径**（原生 setter + input 事件 + focus）已验证工作，**不动**。
- 每通道 `console.info('[muv-engine] 用户消息桥：…')` 留痕，回报时看日志哪个通道命中。
- `MUV_BUILD` → `2026-09-22o`。

**门禁**：`verify-user-send.mjs`（真 Edge + 真 DOM + 逐字提取的 `muvDeliverUserText`/`muvUserSendFire`；
假 DSH 输入框+发送按钮+iframe 调 `sendUserMessage`；场景①有按钮命中通道①、场景②无按钮命中通道②）
全绿 6/0；`--break=send-channel` **真变红对照臂**（砍发送通道后 B/D 断言必红、exit≠0）。
`test-client-render.mjs` [16] 断言改为多通道矩阵（275/0）。

**只能真机验的部分**：DSH 真实发送按钮的 aria-label 中/英文与图标类名需真机确认（多通道已兼容）；
合成 Enter 在真机是否稳定触发「生成下文」取决于 DSH 是否已将输入框标成受控就绪（60ms 延时即为此留）。

## 28. 第 28 轮：全局正则扩展库 —— ST 全局脚本层补齐（2026-09-22 晚）· `2026-09-22n`

### 28.1 背景与来源形态

正则管道已是 ST 形态（`applyRegexScript` 函数式替换、`placementAllows`、`depthAllows`、
`matchesMode`），但只吃卡级脚本。ST 生态的**全局正则扩展**（用户装的、独立于卡的美化/净化
脚本）此前没有任何承接 —— 用户装过的全局脚本全部失效。

ST 全局正则导出 JSON 的真实形态不止一种，导入端**宽容解析四种**（`extractGlobalScripts`）：

```
① 裸数组  [ {scriptName, findRegex, replaceString, placement:[…], disabled,
             markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth} ]
② { scripts: […] }                                  ← 最常见
③ { data: { extensions: { regex_scripts: […] } } }   ← 与卡级同构
④ ②/③ 外再包一层 { compatibility: … }               ← 部分导出工具的包装（递归进里层）
```

认不出 → 空数组 → API 层给 `400 no-scripts-found`。ST 的 `placement` 数字数组**只保留不解释**
（本引擎的 placement 语义是 markdownOnly/promptOnly，见 `regex-engine.js` 注释）。

### 28.2 存储与合并顺序

- **落盘路径**：`<引擎包根>/data/global-regex.json`（开发机 `C:\dsh-muv-engine\data\global-regex.json`；
  可用 `MUV_ENGINE_DATA_DIR` 覆盖，测试就是这么隔离的）。这是引擎**第一个落盘数据**——
  此前的状态/快照全是内存态（var-tracker 注释里有明说），没有可跟随的持久化先例。
  格式 `{ version:1, savedAt, scripts:[…] }`，临时文件 + rename 原子写；损坏按空库处理但 stderr 喊出声。
- **合并顺序 = 全局（先）+ 卡级（后），顺序即优先级**。卡级脚本是卡作者针对这张卡调的，
  比用户装的全局宽泛替换更具体；后跑的作用在先跑的产出上。合并发生在
  `/api/muv-engine/apply-regex-card` 外层（`[...loadGlobalScripts(), ...cardScripts]`），
  **没有改** `applyAllRegexScripts` 的签名与行为；全局脚本走同一条管道，disabled /
  placement / depth 过滤全部复用 `matchesMode`。
- **`statusBarHtml` 仍只从卡级提取**（保守选择）：`<StatusPlaceHolderImpl/>` 是卡的契约，
  卡级皮肤不该被用户的全局脚本抢走。
- ⚠ 顺序语义是**顺序作用在同一份演进文本上**（与 ST 相同）：全局 'A'→'B' + 卡级 'B'→'C'，
  合并序 ⇒ 'C'，颠倒 ⇒ 'B'。卡级的 findRegex 若匹配不到全局的**产出**，它不会"压过"全局——
  这不是 bug，是顺序作用的本义。门禁对照臂用的就是这对可分序用例。

### 28.3 API 口径（示例）

```
GET  /api/muv-engine/global-regex
  → 200 { ok:true, scripts:[ { id:"gr_09111b…", scriptName, findRegex, … } ] }   （落库原序）

POST /api/muv-engine/global-regex            （body 即 ST 导出件本身；四种形态都认）
  ?mode=append                                （同名同式跳过；缺省 upsert=覆盖为新版）
  → 200 { ok:true, added, replaced, skipped, invalid, total, reasons }
  → 400 { ok:false, error:"capacity-exceeded: …" }   库将超 200 条，整批拒绝
  → 400 { ok:false, error:"no-scripts-found" }       四种形态都没认出来

DELETE /api/muv-engine/global-regex?id=gr_…   （或 POST {action:'delete', id}，等价）
  → 200 { ok:true, deleted:"gr_…" }  /  404 { ok:false, error:"not-found" }
```

- 去重键 = `scriptName + findRegex` **逐字相等**；upsert 覆盖保留原位置与原 id。
- `id` 确定性：`gr_` + sha1(scriptName+findRegex) 前 12 位 —— 重导/重装 id 稳定。
- 编译校验与 `applyRegexScript` 同口径（`/…/flags` 壳或裸模式）；坏条目跳过并计数
  （invalid + reasons），不抛、不整批失败 —— var-tracker bad 计数同纪律。

### 28.4 容量纪律

| 项 | 值 | 超限行为 |
|---|---|---|
| 库总量 | 200 条 | **整批拒绝**（400 capacity-exceeded；不做部分导入——半批入库会让"再导一次补齐"变成盲目猜） |
| 单条 findRegex | 256 KB | 该条跳过，计入 skipped + reasons，其余照常入库 |
| 单条 replaceString | 256 KB | 同上 |

### 28.5 门禁（全绿，数字）

新 `test-global-regex.mjs` **35 通过 / 0 失败**，覆盖：四种导入形态 / 去重统计（upsert+append）/
非法 findRegex 跳过计数 / **合并顺序含真变红对照臂**（链式用例 全局'A'→'B' + 卡级'B'→'C'：
合并序 'C'，颠倒序 'B'——顺序若颠倒，④a 断言必红）/ disabled 不跑 / promptOnly·minDepth
过滤复用 / API 形状（GET·POST·DELETE·405·404·400 no-scripts-found）/ 容量两档 /
apply-regex-card API 层合并（含 statusBarHtml 卡级来源不变）。

其余门禁：`test-regex-engine.mjs` 26/0 · `test-client-render.mjs` 275/0 ·
`test-era-vars.mjs` 18 PASS/0 · `test-snapshots.mjs` 14 PASS/0 ·
`verify-guard-tag-agnostic.mjs` 78/0 · `verify-no-redouble.mjs` 4/0。

### 28.6 本轮改动文件

`lib/global-regex.js`（新）/ `lib/index.js`（三路由 + apply-regex-card 合并）/ `lib/client.js`
（仅 `MUV_BUILD` → `2026-09-22n`）/ `test-global-regex.mjs`（新）/ `.gitignore`（`data/`）/
`README.md`（API 表）/ 文档：`CHANGELOG.md`、本节、`C:\deepseek harness\docs\03-取精华-小白X与酒馆助手.md`、`INDEX.md`。

### 28.7 只能真机/实测确认的部分

- 服务端路由生效需要**重启 DSH**（Node 模块缓存；客户端无改动，硬刷新只为读新构建号）。
- 真实 ST 导出件（用户手里的全局脚本 JSON）只验过形态假设 + 单元探针；**真机导入一次**
  看去重统计与渲染效果是最终确认。
- 全局脚本与真卡的相互作用（全局净化跑在卡级之前会不会吃掉卡正则的锚文本）取决于
  具体的 findRegex 集合，只能用真实卡 + 真实全局脚本实测。




