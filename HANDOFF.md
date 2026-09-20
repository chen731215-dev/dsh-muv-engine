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
写回 `innerHTML` 后不可逆）。真实命中率很高：`异世界农场` 的 `**` 有 352 处、`涩涩提瓦特` 604、`食人世界` 792。
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

### 16.3 已知未覆盖（有意留着，不是遗漏）

1. **卡牌专属游戏标签**（赏令接取 / 赏令完成 / 拍卖购入 / 盲盒开启 / 道友收录 / 飞剑回信 / 自由开局）：
   酒馆路径对它们是「按卡字段渲染信息卡」（上百行 + 每卡色板），**原生路径仍会露成裸标签**。单列一类。
2. `applyDecoratedHtml` 的**整条替换兜底仍在**（找不到落点时的最后手段）——
   这是**设计保留**，不是遗留缺陷。它在「装饰先于卫生 pass 的极端时序」下仍可能触发（代码里有说明，未观测到）。
3. §15.8 那行裸属性文本（`{"era-message-key"=…}`）。
4. §11.4 `parseInitvar` 保留 YAML 单引号（既有行为，未改）。

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
