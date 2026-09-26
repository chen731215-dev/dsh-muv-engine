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

## 29. 第 29 轮：帧高对「媒体延迟加载」塌陷的修复（2026-09-22 深夜）· `2026-09-22p`

### 29.1 症状与三个嫌疑

足控天堂2 的「主页」（大片图片墙 + 2 分钟视频 + 可交互小手机 UI）ST 里完整一大片，
DSH 里同样的 iframe **被压成细长一条**（用户截图：只显示一条窄图片带）。三个嫌疑：
上限 12000 不够 / 棘轮只放行扩张不收敛 / 媒体异步加载后高度没跟上。

### 29.2 取证方法与结果（真卡 + 真 Edge + 真 cardHtmlIframe 链路）

1. **真卡时间线**（`.tmp-hfix-forensic.mjs`，CDP 真 OOPIF 会话逐秒读数）：主页卡在
   300ms 时 `extent()=0`（什么都不报，帧高不动）→ 1063ms 首报 1486 → 2124ms 报 1636
   （视频 metadata 到位后）→ 稳定 1636。报回 ~10 次、单调上升、宿主每次都采用。
2. **四档宽度**（640/760/900/1180，真卡 + 真 `cardHtmlIframe` 产物 + 真父页处理器）：
   全部收敛（窄宽度内容更高：2056 vs 1636），截图目验卡渲染完整。
3. **RO 判定性实验**（`.tmp-hfix-ro.mjs`）：在 `overflow:hidden!important` 体制下，
   内容 300→1500→800 变化时 RO(documentElement) 与 RO(body) 都 fire 3 次 ——
   **RO 对盒子尺寸变化是活的**（与"RO 在 hidden 下死了"的猜测相反）。
4. **卡的解剖**（`.tmp-hfix-anatomy.mjs`）：2 个 img（**无 width/height 属性**）+ 2 个
   video，但媒体盒全部被 CSS 预留尺寸（`.polaroid{aspect-ratio:…}` +
   `img{position:absolute;inset:0}`、`.hero-photo{height:340px}`、`.car-photo{aspect-ratio:1/1}`）；
   画廊 img 是**卡的 JS 运行时拼装**（`<img loading="lazy" … onload/error 切 display>`）。
5. 结论：**上限无辜**（实测最大 2056，远未到 12000）；**棘轮扩张方向无辜**（溢出观测到
   就无条件满足，既有门禁 + 本轮复核）；**单纯"媒体慢"也不足以解释**（本卡媒体盒预留，
   加载前后包围盒几乎不变）。

### 29.3 确切缺陷（本轮修的）

引导脚本的重测触发器只有：`load` / `DOMContentLoaded` / RO(**documentElement**) /
700·1600ms / 四次补量（2500+i×2800，**10.9s 止**）。**媒体事件从不触发重测**，而：

- RO 只在**盒子**（边框盒）尺寸变化时 fire。媒体引起的**包围盒**（`extent()` 对绝对定位
  元素单独取 `rect.top+height`）变化可以完全不改变任何盒子 —— 媒体元素自身
  `position:absolute` 时，媒体到位只改它自己的盒子，html/body 纹丝不动 ⇒ RO 不 fire，
  `extent()` 却变大。真卡画廊正是这个形状。
- 卡 JS 在 load 之后才把 img 插进 DOM（真卡画廊运行时拼装）：10.9s 之后插入的媒体
  没有任何触发器。

两者叠加「早期测量落在小包围盒 + 晚增长无人上报」⇒ 帧高被锁在小值 = 细长一条。
（塌陷本身在忠实夹具里未能复现 —— 见 29.5 只能真机验的部分。）

### 29.4 修法（保守小改，只动 `muvFrameBootstrap`）

- img `load`/`error`、video `loadedmetadata`/`loadeddata`/`durationchange` → `s()`
  （150ms 去抖；**error 也算**——404 的图塌成 0 高，包围盒同样要重量）。
- 运行时新插入的媒体由 MutationObserver 兜底补挂事件（**只挂事件、不额外测量**）。
- **铁律核对**：收缩方向滞回（孩子侧 24px×3 次、父侧 8px 死区）、12000 上限、
  装饰器守卫、变量管线（era/var-tracker）、`MUV_CARD_LIBS` 全部未动。
- `MUV_BUILD` → `2026-09-22p`。

### 29.5 门禁（全绿，数字）

`verify-frame-height.mjs` 新增第 7 节「媒体延迟加载」，**8 PASS / 0 FAIL**：

- **A 流内臂**：img src 延迟 300ms（子文档侧 setTimeout）→ 报回 824→**1200** 到位。
- **B 判别臂**：img `position:absolute`（RO 静默）+ src 在 **11.5s**（晚于最后一次补量
  10.9s+150ms 去抖）→ 1524→**1900**；修复前没有任何触发器能救。
- **★★★ 变异臂**：把媒体挂接 `mw` 砍成立即返回，B 必须**红**（实测卡在 1524）——
  判据测的正是媒体重报，不是空气。
- 其余：`verify-frame-ratchet.mjs` 全部通过 · `test-client-render.mjs` **275/0** ·
  `verify-decorate-dom.mjs` 全部通过 · `test-era-vars.mjs` **17 PASS/0** ·
  `verify-guard-tag-agnostic.mjs` **78/0**。

两个夹具教训（下次照抄）：
1. **父→子 postMessage 在 300ms 时会丢**（srcdoc 文档尚未就绪）：300ms 臂的 src 恒未
   设置、恒报 824。媒体场景的延迟触发一律放**子文档自己的 setTimeout**（真时间 CDP 下
   照常走；§6 的"子文档定时器不走"禁令只针对 `--virtual-time-budget` 通道）。
2. 探针页对 `/height:\d+px/` 的起始高度替换（§16.3.1 的坑）对卡文档文本依然敏感：
   夹具里所有高度都用运行时 style 设置，`top:1500px`/`width:600px` 不含该字面量，安全。

### 29.6 只能真机验的部分（如实记录）

- **塌陷本身未能在忠实夹具里复现**：真卡在 file:// 夹具 + 真实链路下收敛正常。
  本轮修的是与症状机制吻合的**确切缺口**（媒体事件重报缺失），最终效果需重启 DSH +
  硬刷新后真机目验「主页」是否恢复完整高度（构建号须为 `2026-09-22p`）。
- 若真机仍细长一条，下一步取证方向是 **DSH 宿主容器对 iframe 的外部约束**：
  本轮按 §22.1 尝试持签名 Cookie 只读挂 127.0.0.1:3080（`.tmp-hfix-live*.mjs`，
  secret 全程未打印），**鉴权被拒**（四种 authority/HMAC 变体都 401）——
  cookie 构造口径与 §22.1 记载有出入，下次先核 DSH 端校验代码再试。

## 30. 第 30 轮：卡脚本运行时（TavernHelper / 酒馆助手脚本真正执行）· `2026-09-22q`

### 30.1 症状 → 真因（用户实测）

魔女卡（魔法少女MVU测试）的契约书封面已经在 DSH 渲染出来，但 ST 里封面下面那条
**棕色状态栏（MVU 的 Status Hud）** 没有。

证据链（都是实测，不是推测）：

1. 卡里那两条消费 `<StatusPlaceHolderImpl/>` 的正则 —— `③ 隐藏状态栏占位符 · 显示` 与
   `④ 隐藏状态栏占位符 · 提示词` —— **`replaceString` 长度为 0**：它们只负责把占位符**删掉**，
   不产出任何界面。所以 HUD **不是正则产物**。
2. 卡的 `data.extensions.tavern_helper.scripts[0]` 内容是一行
   `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'`
   （该源实测 200，573,299 字节）。ST 里「酒馆助手」会执行卡里 enabled 的脚本 ⇒ bundle 起来
   ⇒ 由它订阅 `mag_variable_update_ended` 并在运行时画 HUD。
3. 我们此前**一条卡脚本都不执行** ⇒ bundle 不跑 ⇒ HUD 恒空。

这是与"沙箱 / 正则 / 替换串"那几类**并列**的独立原因，排查时要先分清。

### 30.2 卡脚本的来源结构（2026-09-23 从 PNG tEXt 'chara' 取证）

**字段路径**：`<卡 JSON>.data.extensions.tavern_helper.scripts[]`
（老式扁平卡退到顶层 `extensions`；`tavern_helper` 旁边还有一个 `variables` 键，与脚本无关）

**元素形状**：`{type:'script', enabled:boolean, name, id, content, info, button, data, export_with}`

| 卡 | 条数 | enabled | 形态 |
|---|---|---|---|
| 魔法少女MVU测试 | 8 | **6**（0/1/2/4/6/7；3、5 被关） | 混合：①97 字符纯 import ②`import {registerMvuSchema}` + 逻辑 ③~⑥85–186 KB 的 IIFE |
| _足控天堂2 | 3 | **3** | 清一色**单行** `import 'https://…'`（含 148 KB 的 ERA 变量框架 1.4.11） |

★ 被关掉的两条都是「**同一脚本的另一版**」，但**名字不可靠**：下标 3 与 2 的名字**逐字相同**
（都是「8.2·星辉MVU核心·等级能力一致性与比例数值」），下标 5 与 4 只差「无立绘 / 有立绘」
一个字。所以判据只能看**内容里的独有记号**，不能看名字 —— 门禁里就是按
`HIDE_INLINE_IMG = true` / `= false` 分的。

复跑取证：

```
node -e "import('dsh-muv-table/lib/png-card.js').then(m=>{
  const c=m.readPngCard('C:/MySpecialFolder/SillyTavern/data/default-user/characters/魔法少女MVU测试.png');
  console.log(c.data.extensions.tavern_helper.scripts.map(s=>[s.name,s.enabled,s.content.length]))})"
```

### 30.3 实现（三处）

| 项 | 值 |
|---|---|
| 开关 | **`var MUV_CARD_SCRIPTS = true`**（`lib/client.js`，默认**开**） |
| 读取口 | `muvCardScriptsOn()` / `muvCardScriptsNow()`（做成函数的理由同 `muvCardLibsOn`：门禁是逐字提取执行的，闭包变量不在提取物里） |
| 数据源 | 新 **`GET /api/muv-engine/card-scripts?cardName=…&presetDir=…`** ← 新模块 `lib/card-scripts.js` |
| 注入器 | `muvCardScriptTags()`（串） + `withCardScripts()`（落点） |
| 落点 | **最后一个不在 `<script>` 里的 `</body>` 之前** |
| 链上位置 | `muvInjectDoc` 的**最外层**（compat → reset → libs → 高度引导 → **卡脚本**） |
| 生效范围 | **只** `muvInjectDoc` 这一条链（= 卡 iframe；DSH 自己的 iframe 不经过） |

★ 为什么要有一个服务端源：`/api/muv-table/tavern-card` 只回变量/zod/initvar 那一层，
**不含**脚本；本轮只准改 `dsh-muv-engine`，所以按同一套口径自己定位卡文件：
`<预设>/muv-tables/card.json` → 预设内 PNG → 外部卡库（`DSH_MUV_CARD_DIRS` + ST 的
`data/<user>/characters` + `~/Downloads` + `~/Desktop`）。
与 muv-table 唯一的差别（有意）：外部目录先按**文件名**预判，不中时再按内容限量读 20 张 ——
避免每次渲染都把下载目录里几十 MB 的 PNG 逐个读完。

★ 为什么用 `<script type="module">`：卡里普遍是 ESM（`import '…'`），而 **module 天然 defer**
⇒ 不管落在文档的哪个位置，执行都排在所有经典脚本（compat 垫片 / reset / 前端库 / 高度引导）
**之后**。这是"垫片之后"这条要求的**结构性**满足，不依赖注入点顺序。
每条独立一个标签 ⇒ 一条 import 挂掉只死那一条。

### 30.4 错误留痕（module 的失败是抓不到的）

`import 'https://…'` 挂掉时：没有 try 能接到、不会冒泡到宿主的 `window.onerror`、只会
在不透明来源的 srcdoc 里自己炸一声 —— 用户看到的永远只是"界面缺一块"。所以注入了一段
**捕获阶段**的 `window.addEventListener('error', h, true)`（元素上那个 error **不冒泡**，
只在捕获阶段收得到）：

- `e.target` 是那个 `<script>` ⇒ 从 `data-muv-th` 读回脚本名；
- `e` 是 ErrorEvent（运行时报错）⇒ 名字只能报「（未知脚本）」（about:srcdoc 下所有 module
  共用一个 filename），但 message 有；
- **`unhandledrejection`**（`e.reason`）⇒ 报「（promise 未处理）」。★ 这一条不能省：
  module 的**顶层 await 被拒**不走 `error` 事件（MVU bundle 入口第一行就是
  `await checkVersion(...)`）—— 少了它，"整个框架没起来"完全无声。三个入口共用同一个
  计数器（合计上限 20 条）。

除 `console.warn('[muv-engine] 卡脚本报错：' + name, msg)` 外，还攒进 **`window.__muvScriptErrs`**
（≤20 条）—— 控制台要开 devtools 才看得到，这个数组能被门禁（CDP 求值）与真机排障直接读。

### 30.5 安全口径（写清，别让它看起来像任意代码执行）

1. 执行的脚本来自**用户自己导入的卡**，与 ST 同一信任级别（ST 也是无条件执行卡脚本）；
2. iframe 沙箱**仍是 `allow-scripts`**（没有 allow-same-origin，见 §9 事故）：摸不到 DSH 页面
   DOM、`localStorage` 是垫片给的内存实现、打 `/api/*` 也不带宿主凭据；
3. 内容里带 script 收尾标记（含 JS 字符串里写的那份）的条目**一律跳过** —— 内联会当场截断
   srcdoc（与 §18 的 `$'`、§21 的 `$&` 同类）。跳过时 `console.warn` 报名字；
4. 条数（20）与单条体积（2 MB）在服务端封顶；查询参数（`cardName` / `presetDir`）先消毒，
   不许带路径分隔符与 `..`。

### 30.6 与垫片 API 的关系（本轮核定的事件桥）

- **宿主 → 卡**：`era:queryResult` / `era:writeDone` / `mag_variable_update_ended` 早就有了
  （`muvEraPushNow`、`muvMvuReply`、`muvEraDeliver`），MVU 的刷新钩子挂的就是这些 —— **无需新增**。
- **卡 → 宿主**（`__muvEventOut`）：只认 ≤64 字符的名字，`muvEraAnswer` 对**非 ERA 名字直接
  return**（不回值）。这不是"丢弃"：卡内 `emit()` 已经先 `fire()` 派发过，**卡内监听者照旧收到**，
  父页只是不作答（父页也不知道该答什么）。MVU 上无害。
- 补的两处**真实**缺口：
  1. `Mvu.events` 的名字改成 MVU 真 bundle 的常量表 —— 原先 `BEFORE_MESSAGE_UPDATE` 是
     `mag_variable_update_before`，一个**谁都不会发射**的值（真名 `mag_before_message_update`），
     且缺 `VARIABLE_UPDATE_STARTED` / `COMMAND_PARSED` / `SINGLE_VARIABLE_UPDATED`。
  2. 新增 `getTavernHelperVersion()`（`→ '3.4.17'`）与 `toastr`（控制台版）。
     ★ `getTavernHelperVersion` 是**关键**：MVU bundle 入口第一行就是
     `await checkVersion('3.4.17', …)`，而这个函数在 bundle 里**没有定义**（属于酒馆助手）⇒
     缺了就 `ReferenceError` ⇒ 那个顶层 await 所在的 async IIFE 当场拒 ⇒ **后面一行都跑不到**。
     返回 3.4.17 而不是我们 `TH.version` 的 3.0.0：低了只会弹一条"请升级酒馆助手"的报错，
     而 DSH 里没有可升级的酒馆助手 —— 那是**误导**。真实覆盖范围写在 §25 与本文件里。

### 30.7 门禁（全绿，数字）

| 门禁 | 结果 |
|---|---|
| `verify-tavernhelper-scripts.mjs`（新） | **35 通过 / 0 失败** |
| `test-client-render.mjs` | **293 / 0**（新增 [23] 段：注入形态 / 开关 / 留痕三入口） |
| `verify-guard-tag-agnostic.mjs` | **78 / 0** |
| `test-era-vars.mjs` | 全部通过（真聊天文件不在 ⇒ SKIP） |
| `verify-card-compat.mjs --old-export` | after **46/0** · before 红 37（对照成立 ⇒ 绿灯） |
| `verify-frame-height.mjs` | 全部通过 |

`verify-tavernhelper-scripts.mjs` 的三节（都带对照臂，判据不是空转）：

- **[1] 服务端读真卡**：魔女 8 条里只出 6 条；同名的旧版那张按 `enabled` 被剔除（不是按条数
  截断）；足控天堂2 的三条全是单行 import；`enabled=false` 单元两档。
- **[2] 注入串**：一条一个 `<script type="module">`、顺序 = 卡里数组顺序、`import` 的绝对 URL
  原样保留、幂等、开关关掉与空清单都**逐字不动**、内容带收尾标记的条目被跳过但仍注入其余。
- **[3] 真浏览器三臂**（真 `allow-scripts` srcdoc + 真 OOPIF）：
  A 注入 ⇒ `window.__probeA === 1`、坏掉那条 `__probeB` 为 undefined（**一条挂了不拖垮其他**）、
  `__muvScriptErrs` 里有一条且**说到脚本名**；B 不注入、C 开关关 ⇒ `__probeA` 恒为 undefined。

### 30.8 只能真机验的部分（如实记录）

1. **新路由要重启 DSH**（`lib/index.js` 引了新模块 + 注册新路由，Node 模块缓存）。
2. 重启 + 硬刷新后看三件事：
   - 控制台 `[muv] 卡脚本「魔法少女MVU测试」：注入 6 条 / 卡里共 8 条（来源 library · 魔法少女MVU测试.png）`；
   - 封面下面那条棕色 HUD 出没出；
   - 有没有 `[muv-engine] 卡脚本报错：…`（或进卡 iframe 读 `window.__muvScriptErrs`）。
3. **HUD 仍不出时最可能的原因（下一轮第一顺位）**：卡脚本普遍用全局 **`_` (lodash)**
   —— 星辉 MVU 核心 110 处、有立绘状态栏 26 处、NPC 控制台 23 处。ST 由 `predefine.js` 的
   `window._ = window.parent._` 提供，我们的**不透明来源拿不到父页对象**。本轮按
   「不许动 `MUV_CARD_LIBS` 行为」的硬约束没有往库注入里加 lodash —— 保守选择，如实记录。
4. 另外两条已知缺口（不伪造，留给后面）：
   - MVU 框架本体的 `should_enable` 来自酒馆助手的**脚本启用态**
     （`getScriptId()` / `listenPreferenceState()`），我们没有等价物；伪造它等于凭空打开一个
     我们接不住的更新管线，所以**没有做**。卡脚本自己画的那些 UI 不受此限。
   - bundle 会 `_.set(window.parent, 'Mvu', …)` —— 跨源写父页属性在 strict 模式下会抛；
     这条要靠真机观察它是否被上层 `Promise.allSettled` 兜住。

## 31. 第 31 轮：补齐 ST `predefine.js` 的全局（lodash / zod）· `2026-09-22r`

### 31.1 上一轮留下的第一顺位，本轮做实

§30.8 第 3 条：HUD 仍不出时"最可能的原因"是卡脚本裸引用全局 **`_` (lodash)**，
而 ST 由 `predefine.js` 提供、我们跨源拿不到。本轮补上，并拿到**直接证据**（§31.6）。

### 31.2 ST 侧注入清单（只读源码逐条实测，2026-09-23）

出处：`C:\MySpecialFolder\SillyTavern\public\scripts\extensions\third-party\JS-Slash-Runner\`

`b1()`（iframe 文档模板，`dist/index.js` ~853393）注入了 4 个 `<script src>` +
`${v1}` 那一大块；这四个 src 常量由 `src/iframe/script_url.ts` 从 `?raw` 源码
`URL.createObjectURL` 出来（**不是** URL 路径，所以 `dist/` 里搜不到文件名）：

| b1 里的槽位 | 真身 | 注入了什么 |
|---|---|---|
| `${v1}` | 内联字符串 | FontAwesome CSS + Tailwind + jQuery + jQuery-UI(+theme CSS+touch-punch) + Vue(runtime) + Vue-Router |
| `${_1}` | `parent_jquery.js` | `window.$ = window.parent.$` / `window.jQuery = window.parent.jQuery` |
| （硬编码） | `node_modules/log.js` | 只覆盖 `console.*` 转发给面板（**无新全局**） |
| `${m1}` | **`predefine.js`** | ★ 本节重点，逐条见下表 |
| `${p1}` | `adjust_iframe_height.js` | 高度上报（用 `_.throttle`） |

`predefine.js` 逐条（文件行号为准）：

| # | 行 | 注入物 | ST 语义 |
|---|---|---|---|
| 1 | `:1` | **`window._`** | `= window.parent._`（ST 本体的 lodash） |
| 2 | `:11-19` | （消费方） | `_(window).merge(_.pick(parent,[…]))` 把父页一堆东西摊到 window |
| 3 | `:12` | **`EjsTemplate` `TavernHelper` `YAML` `showdown` `toastr` `z`** | 六个名字整份搬过来（`z` = zod） |
| 4 | `:13` | TavernHelper 的全部方法（去掉 `_bind`） | 摊成裸全局 |
| 5 | `:14-18` | `_bind` 表里的方法，**去掉前导 `_`** 后 `bind(window)` | ⇒ 裸全局 `eventOn / eventEmit / getVariables / triggerSlash / **waitGlobalInitialized** / …` |
| 6 | `:22-24` | `__VUE_PROD_DEVTOOLS__` / `__VUE_OPTIONS_API__` / `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` | 给 pinia 一类库看的 build flag |
| 7 | `:26-34` | `SillyTavern`（defineProperty getter） | `getContext()` + `writeExtensionField` |
| 8 | `:37-44` | `Mvu`（defineProperty getter，仅当父页有） | get 转发父页、**set 是空的**（comment：Mvu 脚本自己会 `_.set`） |
| 9 | `:2-10` | `__TH_IFRAME_ID` / `window.name` | iframe 身份（酒馆助手自己用） |
| 10 | `:46-48` | （消费方） | `$(window).on('pagehide', () => eventClearAll())` —— 名字对不上会当场抛 |

版本依据（两处都读的原始文件，不是猜）：
- lodash `4.18.1` ← `SillyTavern/node_modules/lodash/package.json` 的 `"version"`
  （jsdelivr 也有这个版本，73,234 字节）；
- zod `4.4.3` ← `JS-Slash-Runner/package.json:89` `"zod": "^4.4.3"`。

### 31.3 卡侧证据（没有它就不加 —— 本轮的口径）

从真卡 PNG 的 tEXt `chara`（**内容是 base64 的 JSON**，直接 `JSON.parse` 会抛）
取 `data.extensions.tavern_helper.scripts`，逐条 grep：

| 全局 | 裸引用 | 出处（哪一条脚本） |
|---|---|---|
| `_` | **151** | 星辉MVU核心 74 · 其余零散 |
| `z` | **143** | 单条「8.2·星辉zod·等级能力一致性与比例数值」 |
| `SillyTavern` | 34 | 状态栏 / NPC 控制台 |
| `TavernHelper` | 28 | —— |
| `Mvu` | 82 | —— |
| `toastr` | 16 | —— |
| `eventOn` | 25 | —— |
| `getVariables` | 13 · `triggerSlash` 8 · `replaceVariables` 2 · `insertOrAssignVariables` 2 | —— |
| `waitGlobalInitialized` | **8**（**探测式**，自带 typeof 兜底） | 星辉MVU核心 3 · 事件推进器 2 |
| `EjsTemplate` / `YAML` / `showdown` | **0 / 0 / 0** | —— |

★ `z` 那条最凶的细节：它 `import { registerMvuSchema } from '…/mvu_zod.js'`，
**从不 import `z`** —— `z.object/z.record/z.preprocess/z.coerce.string()/…prefault` 全是裸引用
⇒ 缺 `z` 时在**求值顶层 Schema 常量**时就 `ReferenceError`，`registerMvuSchema(Schema)`
永远跑不到。

### 31.4 补齐情况（表）

| ST 注入物 | 我们 | 做法 / 位置 |
|---|---|---|
| `_` lodash | ✅ **本轮** | `muvCardLibTags()` 里**三段**：`dash-save` → `lodash@4.18.1/lodash.min.js` → `dash-keep`。理由：lodash 的 UMD 收尾**无条件** `root._ = lodash`，而要求是"只在缺失时补"——三段是纯 HTML 层实现该语义的唯一办法。标记 `__muvDashPrev` 用完即删。 |
| `z` zod | ✅ **本轮** | 只能走 `<script type="module">`：实测 `zod@4.4.3` 的 npm 包**没有 UMD**（`dist/zod.umd.js`/`dist/index.umd.js` 全 404），只有 jsdelivr 现打的 `+esm`（328,955 字节）。`import * as MUVZ` + 三形态兜底 ⇒ `window.z`，**只在缺失时**落位。顺序仍对：module 天然 defer，它在 `<head>`、卡脚本在 `</body>` 前。 |
| `waitGlobalInitialized` | ✅ **本轮** | 放进 **compat 垫片**（不是库注入）—— 它属"ST 预定义宿主 API"那一族，跟 `toastr`/`getTavernHelperVersion` 同类，不该被"前端库开关"连坐。对已就位的全局立刻 resolve（我们的 `Mvu` 是同步就位 ⇒ 语义正确）；取不到名字**不 reject**。 |
| `$` / `jQuery` / Vue / Vue-Router / Tailwind / jQuery-UI / FA | 早已有 | §24（CDN + 钉版本） |
| `SillyTavern` / `TavernHelper` / `Mvu` / `toastr` / 事件总线 / `getTavernHelperVersion` | 早已有 | §30.6 |
| `EjsTemplate` / `YAML` / `showdown` | ❌ **故意不补** | 卡侧 0 处引用；给空壳会让卡以为"渲染成功了"从而写错数据，**比缺一个全局更坏**。真要用再按 31.2+31.3 的格式取证后补。 |
| Vue 三个 build flag | ❌ 不补 | `vue.global.prod.js` 已把这三个常量**构建期内联**，运行时设不设都不影响 Vue 本体；无卡侧证据 ⇒ 不加。 |
| `__TH_IFRAME_ID` / log.js 转发 | ❌ 不做 | 前者是酒馆助手内部身份（我们的错误留痕用自己的 `data-muv-th`）；后者是"把 iframe console 转发到面板"的观测层，与卡能否运行无关。 |

**开关关系**：lodash + zod **共用 `MUV_CARD_LIBS`**、同一注入点（`</head>` 之前）、同样钉版本
（不追 latest）；`waitGlobalInitialized` 在 compat 垫片里，与库开关无关。
`MUV_CARD_SCRIPTS`（§30）只管"卡脚本注入"，本轮**一行没动**。

### 31.5 门禁（全绿，数字）

| 门禁 | 结果 | 备注 |
|---|---|---|
| `verify-card-libs.mjs` | **37 / 0** | **从两臂扩到四臂** |
| `verify-card-lodash-bundle.mjs`（新） | **11 / 0** | 真实 bundle 端到端 |
| `verify-tavernhelper-scripts.mjs` | **35 / 0** | 未受影响 |
| `test-client-render.mjs` | **308 / 0** | [20] 段 8 库 + 三段顺序 + 2 对照臂；[16] 段垫片清单 |
| `test-era-vars.mjs` | 全部通过 | 真聊天文件不在 ⇒ SKIP（老规矩） |
| `verify-card-compat.mjs --old-export` | after **46/0** · before 红 **37** | 对照成立 ⇒ 绿灯（本轮没出时序偶发） |

**四臂设计的因果强度**（为什么值得多起两个 iframe）：
A 全量 / B 完全不注入 / **C 注入全部但只摘掉 lodash 三段** / **D 注入全部但只摘掉 zod 标签**。
A 与 B 之间差着十个标签 —— "`_` 是 lodash 带来的"在那两臂之间**证明不了**（§24 差点吃过的亏）。
实测：C 臂 `typeof _ === "undefined"` 而 zod 全在；D 臂 `z.object` 不可用而 `_` 与 jQuery 都在。
失败时门禁还会**再做一次 node 侧直连**，把「CDN 不可达」与「注入缺失」分开报。

两个被本轮门禁抓出来的**判据缺陷**（都改进了，记在这里免得后人重犯）：
1. `extractFunction()` 的提取物**包含函数体内的 `//` 注释**——拿源码断言"不含反引号"会把注释里的
   `` `_` `` 判成违规（假红）。现在：`</script>` 看**源码**（不许有字面量，收尾标签必须拼接），
   反引号看**运行时的 `tags`**（那才是"注入进 HTML 的字符串"）。
2. `tags.slice(iDash)` 从属性名处开始，配正则 `^<script …` 永远不匹配 —— 判据要盯
   "那个标签是**外链** `src=` 而不是内联"。

### 31.6 端到端实证：剥掉 lodash ⇒ 真 bundle 当场炸

新门禁 `verify-card-lodash-bundle.mjs`：把卡里那行
`import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'`
真的 import 进真沙箱 iframe，复刻 `muvInjectDoc` 的层序（compat → libs → 错误留痕 → 卡脚本）：

| 臂 | `window.__muvScriptErrs` |
|---|---|
| **Q（只摘掉 lodash 三段）** | `["（未知脚本） | Uncaught ReferenceError: _ is not defined"]` |
| **P（库齐全）** | `["（未知脚本） | Script error."]`（**没有** `_ is not defined`） |

★ Q 臂这一条同时是"bundle **真的加载并开始执行了**"的证据 —— 有它，P 臂的"没有那条错"才有意义
（否则可能只是 bundle 压根没加载）。
★ **如实记录**：P 臂仍有一条 `Script error.` —— CDN 脚本**跨源**、浏览器屏蔽了细节，
**不代表失败**；判据要盯的是具名 ReferenceError。真机排障时同理（`docs/04-排错手册.md` §L）。

### 31.7 环境陷阱：本机浏览器门禁**必须走非沙箱**

本轮踩到并已确认：在工具沙箱里跑 `verify-card-libs.mjs` 会报
`Error: CDP WebSocket 连不上`（`verify-shared.mjs:314`）。实测原因**不是**产品也不是 Edge：
沙箱里 `node` 被换成 **v26.8.2**（非沙箱是 **v22.22.2**），它的 undici WebSocket 连 Edge CDP
全部失败（`close=1006`）；非沙箱下同一份代码 `OPEN`。
⇒ 以后跑任何真浏览器门禁（card-libs / card-lodash-bundle / tavernhelper-scripts / card-compat /
visual / frame-height …）**都要在非沙箱下跑**；看到那句 `CDP WebSocket 连不上` 先查是不是跑在沙箱里。

### 31.8 只能真机验的部分

1. `lib/client.js` 改动**硬刷新即可**（本轮没动服务端路由 ⇒ **不用重启 DSH**）。
2. 硬刷新后看：`[muv-engine] client loaded 2026-09-22r`；封面下方那条**棕色 HUD**；
   有没有 `[muv-engine] 卡脚本报错：…`（或读卡 iframe 的 `window.__muvScriptErrs`）。
3. 仍不出时按 `04-排错手册.md` §L 排：标记 ≥ `2026-09-22r` → `__muvScriptErrs` 里有没有
   **具名** ReferenceError（`Script error.` 不算）→ 才是已知缺口那两条（框架启用开关、
   `_.set(window.parent,…)` 的跨源抛错）。
4. 真机未验：zod `+esm`（328 KB）在本机网络下的加载耗时（只会推迟卡脚本的**开始**，
   不会让谁失败）；bundle 那条跨源 `_.set` 是否被它自己的 `Promise.allSettled` 兜住。

## 32. 第 32 轮：补 `YAML` + 卡脚本注入过滤/留痕带名 · `2026-09-22s`

### 32.1 用户实测的三条控制台报错 → 本轮处置

| # | 症状（原样） | 判定 | 处置 |
|---|---|---|---|
| 1 | `Uncaught ReferenceError: YAML is not defined`（反复出现） | **真缺口**（§31 漏判） | **本轮补**（32.3） |
| 2 | `[muv-engine] 卡脚本报错：（未知脚本）脚本加载失败（本次不执行） http://127.0.0.1:3080/` | **两个缺陷叠加** | **本轮修**（32.4 / 32.5） |
| 3 | `Uncaught TypeError: Cannot read properties of undefined (reading 'object')`（index.js:1:372） | 与 YAML **无关** | **只定位不改**（32.7） |

第 3 条不是"疑似连带"：`ReferenceError`（标识符没定义）与 `TypeError`（属性读在 `undefined`
上）是**两个错误类**，前者不会变形成后者。定位结果见 32.7，位置级吻合。

### 32.2 ★ 教训：§31.3 的"卡侧 0 处"是**统计口径**错了，不是卡没在用

§31.3 的表格里 `EjsTemplate / YAML / showdown | **0 / 0 / 0**`，据此"故意不补"。错在哪：

> 那次只 grep 了**卡里内联脚本的正文**。而 §30.2 自己早就记过一种形态 ——
> **脚本文本只有一行 `import 'https://…'`，真代码在远端。**

换成"**跟到远端模块去数**"的口径，第一张卡就命中：

```
_足控天堂2 → 脚本[1]「外置手机」= import 'https://phone-ctn.pages.dev/index.js'
            该模块 3,150,415 字节 → 27 处裸引用 YAML（YAML.parse / YAML.stringify）
```

**规矩**：以后统计"某全局被引用几次"，**必须把 `import '<绝对URL>'` 型脚本的远端内容也拉下来数**
（本机 11 个带脚本的卡文件里，这一形态共 3 处：phone-ctn / tavern_resource 的自动更新 / 苍玄
auto-regex）。只数内联正文会系统性低估，而且低估的恰好是"框架类依赖"——最该补的那些。

### 32.3 补 `YAML`（`yaml@2.9.0`，不是 js-yaml）：ST 侧证据

`predefine.js:12` 那条 `_.pick(window.parent, ['EjsTemplate','TavernHelper','YAML','showdown',
'toastr','z'])` 只说明**名字**；父页那个全局的**真身**在酒馆助手里：

```js
// JS-Slash-Runner/dist/index.js（minified，原文）
function Qne(){globalThis.YAML=dV,globalThis.z=uk}
var dV=bn({Alias:()=>zL, CST:()=>zB, Composer:()=>wB, Document:()=>Lz, Lexer:()=>XB,
           LineCounter:()=>ZB, Pair:()=>OR, Parser:()=>aV, Scalar:()=>HL, Schema:()=>Fz,
           YAMLError:()=>zz, YAMLMap:()=>PR, YAMLParseError:()=>Bz, YAMLSeq:()=>IR,
           YAMLWarning:()=>Vz, …, parse:()=>js, parseAllDocuments:()=>Ps,
           parseDocument:()=>vt, stringify:()=>Ds, visit:()=>H, visitAsync:()=>be})
```

⇒ `YAML` = **`yaml@2` 的整包命名空间**。版本取 `JS-Slash-Runner/pnpm-lock.yaml` 的
`yaml@2.9.0`（其 `package.json:59` 声明 `"yaml": "^2.9.0"`）。ST 本体另有一份
`node_modules/yaml` = **2.8.3**，但那个**不是**父页被搬走的那个，所以钉 2.9.0。

| 决定 | 依据 |
|---|---|
| 用 `yaml` 而**不是** js-yaml | js-yaml 的全局叫 `jsyaml`，且没有 `parseDocument` / `YAMLMap` / `CST` —— 冒充会在卡真用 `yaml@2` 特性时**静默给错结果**，比缺全局更坏 |
| **不给** `dump` / `load` 别名 | 那是 js-yaml 的 API 名；ST 没有、卡侧 27 处只用 `parse`/`stringify`。加了会让 DSH 比 ST **更宽松**（在 ST 里会炸的卡在这里悄悄跑起来），按"两条腿"口径不加 |
| 走 `<script type="module">` | **先核实的**：`yaml@2.9.0` 的 npm 包里**没有 UMD/IIFE** —— `dist/index.js`（1,769 字节）/`dist/index.min.js`（1,892 字节）都只是 CJS 的 `require('./…')` 转发壳；能当全局的只有 jsdelivr 现打的 `+esm`（104,914 字节，源文件 = 官方浏览器入口 `/browser/index.js`，包内无 `require(`） |
| 落位写法 | `import * as MUVY` ⇒ `window.YAML = (typeof MUVY.parse === "function") ? MUVY : (MUVY.default || MUVY)`，**只在缺失时** |

顺序仍然安全（与 §30.3 的同一条结论）：module 天然 defer，本标签在 `<head>`、卡脚本在
`</body>` 之前 ⇒ 文档顺序决定它先执行。开关与注入点**与 lodash/zod 完全共用**
（`MUV_CARD_LIBS`、`</head>` 之前、钉版本）。

### 32.4 症状 2 的一半：content 是"地址片段而不是代码"

真机那条 URL `http://127.0.0.1:3080/` 就是**宿主自己** —— 内联进 srcdoc 后浏览器拿宿主页当
地址基准做相对解析。新增 `muvCardScriptBareSrc(c)`，**只认最保守的形态（宁可漏也不误杀）**：

| 判据 | 结果 | 为什么 |
|---|---|---|
| 去空白后为空 | **拦** | 空内容注进去只是个空标签，还会进清单签名/缓存键 |
| 含**任何**空白 | 放行 | `import 'https://…'`、几万字的 IIFE、一整段逻辑全有空白 —— 这条挡住最大的误杀面 |
| 以 `http(s)://` 开头 | 放行 | ST 生态的正常写法（真卡 9 条 enabled 里 8 条是这个形态），不在这里判生死 |
| 其余"单个 token"里：`/` `./` `../` `~/` `//` 开头，或整体是"文件名+已知扩展名" | **拦** | 这两类只可能是路径 |
| 含 `*` `(` `)` 等 | 放行 | 正则字面量 / 表达式，不是路径 |

★ 真卡实况：**9 条 enabled 一条都没被拦**（门禁 [1] 节有断言）。它是给**畸形卡 / 被工具改坏的卡**
准备的护栏，不是日常路径。空白 content 另走一条分支（过去 `if (!c)` 挡不住 `'   '`）。

### 32.5 症状 2 的另一半：留痕必须"说得清"

收集器（`muvCardScriptErrProbe`）本轮改了两处：

1. **唯一输出口 `rep(from,msg)`**：console 与 `window.__muvScriptErrs` 同口径、共用同一个
   20 条上限计数器。三条入口 + 卡脚本自报都走它，不会两处说法不一致。
2. **元素报错分脚本 / 非脚本**：`e.target` 上没有 `data-muv-th` 时不再一律「（未知脚本）」——
   先看 `tagName`，不是 `script` 就报 `（非脚本元素 <img>）` + `<img> 资源加载失败（不是卡脚本）`。
   ★ **门禁 E 臂真的复现了真机那条**：`<img src="">` 的 `src` 被解析成文档地址
   （真机 = `http://127.0.0.1:3080/`），实测留痕
   `（非脚本元素 <img>） | <img> 资源加载失败（不是卡脚本） file:///…/th.html`。
   ⇒ 真机那条"脚本加载失败（本次不执行） http://127.0.0.1:3080/"**极可能根本不是卡脚本**，
   而是一个无署名的元素（`src=""` 那一类）。**不要**再照着它去查卡的脚本清单。
3. **运行时错误带名字**：给**没有顶层 import/export** 的脚本包一层
   `try{…}catch(e){window.__muvThErr(e,"<脚本名>")}`。判据故意**极度保守**：内容里任何地方
   出现 `import` / `export` 就**不包** —— 顶层 `import` 放进 `try` 块里是**语法错误**，
   包错会把整条脚本当场弄死（**宁可少一个名字，不可少一条脚本**）。名字进 JS 字符串前把
   `<` 转成 `\u003c`，所以"名字里写收尾标记"也截断不了 srcdoc（门禁有断言）。
   门禁 D 臂实测：`壬·运行时就抛 | boom-壬`（过去这条只会是「（未知脚本） | boom-壬」）。

### 32.6 门禁（全绿，数字）与"去掉就红"的两种做法

| 门禁 | 结果 | 本轮变化 |
|---|---|---|
| `verify-card-libs.mjs` | **45 / 0** | 四臂 → **五臂**（新增 **E 臂 = 只摘掉 yaml 那一标签**）；A 臂新增 4 条 YAML 断言 |
| `verify-tavernhelper-scripts.mjs` | **54 / 0** | 新增 **[2.1] 节**（过滤/留痕/F 臂）+ **[3] 的 D/E 两臂** |
| `test-client-render.mjs` | **320 / 0** | [20] 段 8 库 → 9 库 + yaml 形状；[23] 段过滤与包壳 |
| `verify-card-compat.mjs --old-export` | after **46 / 0**（**偶发**，见下）· before 红 **37** | 对照成立 |

**★ `verify-card-compat` 的时序偶发：本轮复现并归因了（以后照这个流程走，别判成回归）**

```
本轮版本 7 次 after: 46/0 · 46/0 · 44/2 · 44/2 · 44/2 · 45/1 · 46/0    （0~2 条波动）
HEAD 版  同条件 2 次: 44/2 · 45/1                                       （也是那两条）
定点剔除 YAML 注入后: 44/2                                              （还是那两条）
```

- 红的一直是同两条：**⑧b**（隐藏收件箱 `#send_textarea` 还没装上）、**⑩g**（宿主推来的
  `mag_variable_update_ended` 还没被吸收）—— 都是"探针比被观察的动作先跑"。
- **归因步骤**（三步，缺一不可）：① 看是不是**同样那两条**（不是随机分布 ⇒ 先怀疑稳定原因）；
  ② **HEAD 对照** —— `git show HEAD:lib/client.js > 别处.js`，用
  `node verify-card-compat.mjs --old-export --src=<别处.js>` 在**同一时段**跑，
  HEAD 也红 ⇒ 与本轮改动无关（★ 这招**不必** `git stash`，见 §26.2）；
  ③ **定点剔除** —— 把自己新加的那一段文本去掉再跑（本轮去掉 YAML 仍红）。
- **不要**为了变绿去改这两条断言：⑩g 的语义就是"**同步**读立刻拿到新值"，
  给它加等待等于把判据废掉。**偶发就如实记，重跑到绿的那次为准并写明波动范围。**


**对照臂真的变红 —— 用了两种做法，都记下来供后人挑**：

1. **门禁内的因果臂**（推荐，可重复、随源码走）
   - **E 臂**：全量注入但从产物里**摘掉 yaml 那一标签** ⇒ `yamlFn` 实测 `undefined`、
     `yamlParse`/`yamlStr` 全 false，而 `_` / `z` / jQuery 都在（⇒ 不是"整篇没生效"的假红）。
   - **F 臂**（新招）：**把源码里那两道过滤逐字摘掉**再 `buildFrom` 提取**同一个真函数** ——
     同一条 `./index.js` 被注入、标签数 3 → 7。★ 关键设计：先断言"源码**真的**被摘动了"
     （`SRC_NO_FILTER !== SRC` 且两条正则都不再命中），**摘不动就自己变红**，
     绝不会退化成"对照臂什么都没摘、于是断言永真"的假绿。
   - 这招（**对源码做定点文本剔除 + 断言剔除生效**）比 `--old-export` 那种"拿旧提交"更稳：
     不依赖 git 对象库（§26.2 那次事故就是对象库坏了）。
2. **变异实验（改真代码，一次性）**：临时去掉 YAML 注入 ⇒ `verify-card-libs` 红 **7** 条
   （4 条 YAML 断言，`typeof window.YAML` 实测 `undefined`）；临时去掉相对地址过滤 ⇒
   `verify-tavernhelper-scripts` 红 **4** 条（"相对地址那条没有进文档"、标签数 3→6 等）。
   恢复后核对 `md5` 一致再重跑，全绿。**做变异实验前先 `cp lib/client.js` 到仓库外备份 +
   记 `md5`，恢复后核对**（不比 `git stash`，§26.2）。

### 32.7 症状 3 的定位（第 32 轮定位 → **第 33 轮已修**，见本节末 ★）

`Cannot read properties of undefined (reading 'object')` 的真因**不是**缺全局，而是
**我们给的 `window.z` 比 ST 窄一档**：

```
StageDog/tavern_resource → dist/酒馆助手/自动更新角色卡/index.js（2,744 字节，单行压缩）
  const n=z, r=n.z.object({角色卡名称:n.z.string(), …})
                      ↑ 偏移 367 ⇒ 报错里的 index.js:1:372 就在这儿
```

- `n = z` = 我们的全局；`n.z` = **undefined**（我们落位的是 `MUVZ.z`，**子对象**，没有 `.z`）
  ⇒ `undefined.object` ⇒ TypeError。
- ST 那边给的是**整包命名空间**：`uk = bn({$brand, $input, …, ZodAny, …})`（`globalThis.z=uk`），
  它**既有** `z.object` **也有** `z.z` ⇒ 两种写法都通吃。所以 §31 的落位是个**子集**。
- 同类第二处：`tavern_resource/dist/util/mvu_zod.js:553` 的 `r.z.object({stat_data:e})`
  —— 这条更常见（`变量结构` 那类脚本都 import 它）。

**改法一个字**：落位改成命名空间 `MUVZ`。已核实 jsdelivr 的 `zod@4.4.3/+esm` 导出表里
`mo as object` 与 `Os as z` **都在** ⇒ `window.z = MUVZ` 时 `z.object` / `z.z` / `z.record` /
`z.preprocess` / `z.coerce` **全部**成立，与 ST 的形状一致（纯超集，不是新行为）。

**为什么第 32 轮不改**：① 它改的是 §31 已经验证过的行为，该配自己的因果臂（照 §31.5 的
C/D/E 臂做法再加一条"只把落位换成命名空间"的臂）；② 用户那轮的清单里第 3 条只要
"说明是否消失 + 给新嫌疑"，没让它改。

#### ★ 第 33 轮落地（`2026-09-22t`，本节**已修**）

一行级改动，`lib/client.js` 的 `muvCardLibTags()` zod 标签：

```diff
- (MUVZ&&MUVZ.z)||(MUVZ&&MUVZ.default)||MUVZ
+ (MUVZ&&typeof MUVZ.object==="function")?MUVZ:((MUVZ&&MUVZ.default)||MUVZ)
```

- **口径不变**：仍然**只在缺失时**补；仍是全篇唯一 `type="module"`；`MUV_CARD_LIBS` 开关、
  钉版本（`zod@4.4.3/+esm`）、注入点（`</head>` 之前）**一行没动**。`MUV_BUILD` → `2026-09-22t`。
- **因果臂**（就是上一段说的"再来一条臂"，做在 `verify-card-libs.mjs` 的 **A 臂**里）：
  新增 3 条**落位形状**断言 ①`typeof window.z.object === "function"`
  ②`typeof window.z.z === "object"` ③`window.z.z.object` 是函数。
  ②③ 就是"落位是命名空间还是子对象"这一个变量的判据。
- **数字**：`verify-card-libs` **48 / 0**（45 → 48）；`verify-tavernhelper-scripts` **54 / 0**；
  `test-client-render` **320 / 0**；`verify-card-compat --old-export` after **46 / 0** · before 红 **37**
  （本轮**没出**时序偶发，故未走 §32.6 的三步归因）。
- **对照臂真变红**（照 §32.6 的"变异实验"，**不用** `git stash`）：临时把落位改回
  `(MUVZ&&MUVZ.z)||…` ⇒ **46 / 2**，红的正好是新增的 ②③（实测 `z.z`=`undefined`、
  ③=`false`），而 ①（`z.object` 是函数）**仍绿** ⇒ 不是"整篇没生效"的假红。
  改前 `cp lib/client.js` 到仓库外 + 记 `md5`（`4ae4bc99…`），恢复后 `md5` 逐字一致再重跑。
- **没做的事**：`EjsTemplate`/`showdown` 仍未补（口径同 §31.4）；没动 `verify-card-compat`
  那两条时序偶发断言的**语义**。

### 32.8 只能真机验的部分

1. `lib/client.js` 改动**硬刷新即可**（第 32 轮没动服务端路由 ⇒ **不用重启 DSH**；
   第 33 轮同样只改客户端）。
2. 硬刷新后看：`[muv-engine] client loaded 2026-09-22t`（第 33 轮起）；
   ① 控制台**不该**再有 `YAML is not defined`；
   ② `_足控天堂2` 的「外置手机」那条 `import 'https://phone-ctn.pages.dev/index.js'` 应该能跑下去
   （它 27 处 `YAML.parse/stringify` 现在有得用了）；
   ③ 那条 `脚本加载失败（本次不执行） http://127.0.0.1:3080/` 应变成
   `（非脚本元素 <img>） | <img> 资源加载失败（不是卡脚本） …` —— **看到这个就说明它不是卡脚本**；
   ④ `Cannot read properties of undefined (reading 'object')` 在 **`2026-09-22t`** 上应当
   **消失**（第 32 轮的 `2026-09-22s` 上仍会出现 —— §32.7 已修）。
3. 真机未验：`yaml@2.9.0/+esm`（105 KB）在本机网络下的加载耗时（只会推迟卡脚本的**开始**）；
   以及"包壳后的 try/catch 会不会把某条脚本本该冒泡的错误吃掉"（按设计不会：
   `__muvThErr` 立刻把它记进 `__muvScriptErrs` 并 `console.warn`）。

---

## 33. 第 33 轮：「空白渲染」专项取证（现象 1/2/3）· **无代码改动**（`2026-09-22t` 原样）

### 33.1 本轮口径

用户实测 3 个现象，要求"**先取证、再决定改什么；不要凭猜动手**"，并允许
"若指向已随构建 t 解决或卡自身的页面设计，就**不改代码**、把证据写进文档"。
本轮**没改任何代码**：三现象全部落到「卡正则 × 模型输出结构」或「卡设计」或「已随 t 解决」。
`MUV_BUILD` 仍是 `2026-09-22t`（客户端一行未动）。

取证都在**真机**（cookie 进 `127.0.0.1:3080`，点侧边栏足控天堂2「开始」会话）+
**离线复现**（真卡正则经 `applyCardScripts`）两路做，数字如下。

### 33.2 现象 1「ERA 状态栏主体一片紫色空白」——**不复现**

真机 `楼1`（2 条已装饰消息里的第 2 条）逐帧读数：

| 帧 | srcdoc | 高度 | textLen | 主体填充 |
|---|---|---|---|---|
| 主页封面 | 226 KB | 2058 | 362 | 正常（「进入事务所」按钮在） |
| **ERA 状态栏** | 226 KB | 1021 | **775** | **全填**：`res-val 9/9`、`res-chip 9/9`、`choice-text 3/3`（真实选项文字）、`choice-meta 3/3`、`sense-label 5/5`、`pv-cell 3/3`、`home-title 3/3`；关键词 `地图/选项/画廊/CG` 全在 |
| **正文美化** | 183 KB | 1108 | **41** | **空**（只有标题条） |
| ERA 状态栏 | 226 KB | 1021 | 775 | 全填（同上） |

- **ERA 状态栏（那条 210 KB 深紫整页）在 DSH 上是画满的**：页签（世界/主角/公司/因特网/道具/
  事件/角色/CG画廊/地图）+ 因特网流水 + 世界信息（`2026年8月26日…·临江市·公司办公室`）+
  五官感受（嗅觉/味觉/触觉/视觉/听觉）+ 三个选项（选项一/二/三）**都在**（截图为证）。
  故"ERA 状态栏主体空白"**无法复现** —— 与 §32 的口径一致：补完 `YAML`/`zod` 后卡脚本能跑，
  数据就填上了（**已随构建 t 解决**）。
- **唯一真正空白的那一页是「正文美化」**（标题 `♪ 足控天堂 Ⅱ · FOOT HEAVEN` + `A−`/`A+` +
  一个橙色圆钮，下方整片深紫空）—— 正是用户描述的"**仅顶部标题与三个圆钮在**"。

**正文美化空白的真因（卡正则 × 模型输出结构，我们侧无缺陷）**：

- 卡 `[正文美化（带音乐）]` 的 `findRegex` 是**非贪婪 + 首个闭合标签**：
  `/<(?:content|TXT|正文|response|gametext|geme|maincontent|now_plot)>([\s\S]*?)<\/(?:…同前…)>/is`
  ⇒ `$1` 只截到**第一个** `</…>` 之前。
- 真机阅读页的 `#readingContent` 实测 = `\n<now_plot> <audio>日常</audio>\n`（**不含故事**），
  故事文本本身仍渲染在消息正文里（父页 innerText 头就是 `周三上午十点。老城区幸福里…`）。
- **离线复现逐字命中**：拿真卡正则跑
  `<content> <now_plot> <audio>日常</audio> </now_plot> ## 【主页】 <img>…</img> STORY </content>`
  ⇒ `readingContent` 头 = `"<now_plot> <audio>日常</audio>"`（与真机**一字不差**），
  故事在阅读页之外。
- **对照组**：把故事放进捕获块内（`<content>…STORY…</content>`）⇒ `readingContent` **27799 字**，
  完整填入 ⇒ **引擎忠实执行卡正则，没有丢内容**。
- ⇒ 判定：模型把 `<now_plot>` **提前闭合**、故事落在捕获块外，卡正则只截到 `<now_plot><audio>` 前缀。
  **不是 DSH 渲染缺陷**。

### 33.3 现象 2「封面/状态栏反复出现」——卡设计 + 渲染介质差异

- 真机 `楼0`：2 个 `.muv-statusbar-wrap`（2058 / 1021 px）；`楼1`：4 个（1110 / 2058 / 1021 / 1021 px）。
- 机制：`withStatusPlaceholder`（`lib/client.js:4036`）按设计**给每条 AI 消息尾部**补
  `<StatusPlaceHolderImpl/>`；卡的 `[ERA 状态栏]` `findRegex = /<StatusPlaceHolderImpl\/>/gsi`
  （`g` 全局）把**每个**占位符换成一整页 226 KB 文档 ⇒ 每条消息各自渲染一份，**每份 1021 px**。
- ST 同样每楼一份（`withStatusPlaceholder` 的语义就是对齐 ST），只是 ST 紧凑。
  ⇒ 判定：**卡设计如此**（每楼一份）+ 我们以整页 iframe 承载 ⇒ 占屏大。非缺陷。

### 33.4 现象 3「插图上下大片空白」——卡设计（`width=50%` + 居中）

- 真机插图 `img`：`client 384×384` / `natural 1536×1536`（**方图，aspect 保持，无变形**）；
  另一张 `384×24` 是装饰条。
- 卡 `[CG插图]` 的 repl：`<img … style="display:block; margin:0 auto; max-width:3…">`；
  另一卡 `[6]插图DLC` 的 repl：`<center><img src=https://files.catbox.moe/$1 width=50% /></center>`。
- 苍玄界 `[16]插图` 实测 **`disabled=true`**（**根本不跑**）。
  ⇒ 判定：`width=50%` + 居中 + 容器留白 = **卡自身的页面设计**；图片本体加载正常。非缺陷。

### 33.5 顺带取证到的**真实缺口**：`tavern_events` / `errorCatched`（本轮**不改**）

真机**每一个**卡 iframe 都抛：

```
Uncaught ReferenceError: tavern_events is not defined   at about:srcdoc:4847:54992
Uncaught ReferenceError: errorCatched is not defined    at …/StageDog/tavern_resource…
```

- **卡侧证据**：`_足控天堂2` 的脚本 `[0]ERA变量框架1.4.11` 引用 `tavern_events` **×18**、
  `SillyTavern` ×5（顶层就用 `tavern_events.APP_READY` 组事件名数组）。
- **ST 侧证据**（只读源码）：`function/index.ts:478 globalThis.TavernHelper = getTavernHelper()`，
  而该对象**含** `tavern_events`（event 段）；`iframe/predefine.js:13`
  `result.merge(_.omit(window.parent.TavernHelper,'_bind'))` ⇒ 把 `tavern_events` **merge 进卡 window**；
  同文件 `14–18` 行把 `_bind._errorCatched` 去掉前导 `_` ⇒ 暴露成全局 **`errorCatched`**。
- **我们的现状**：**已有**事件总线 `eventOn/eventEmit/eventOnce/eventClearAll`（`client.js:2333`）
  与 `TavernHelper` 垫片（`client.js:2554`），但**缺** `tavern_events` 常量表与 `errorCatched`。
- **关键结论**：**它没有阻断本轮任何一个现象** —— 恰恰是引用它的那张卡的 ERA 状态栏，
  在 DSH 上把主体**填满了**。故本轮按"有取证支撑才动语义"的口径**不动** `MUV_CARD_LIBS`。
- 列为**下一轮第一顺位候选**：补 `tavern_events` 需要把 ST 的事件名映射到我们的 `eventOn` 事件面
  （属事件/管线语义），要单独取证，不能顺手加个空对象（会静默吞掉"监听没生效"）。

### 33.6 门禁（全绿，数字；**本轮无代码改动，仍全跑一遍作为回归**）

- `test-client-render.mjs` **320 / 0**
- `verify-frame-height.mjs` **全部通过**（含"媒体事件重报"变异臂）
- `verify-frame-ratchet.mjs` **全部通过**
- `verify-tavernhelper-scripts.mjs` **54 / 0**
- `verify-card-libs.mjs` **48 / 0**
- `verify-card-compat.mjs --old-export` after **46 / 0** · before 红 **9 / 37**（连跑 3 次一致；
  本轮**没出** §32.6 记的 `44/2` 时序偶发，故未走三步归因）
- 环境口径：**必须非沙箱**（照 §31.7）；`MUV_EDGE` 要 **Windows 风格正斜杠路径**
  （`C:/Program Files (x86)/…/msedge.exe`）—— 用 POSIX `/c/…` 会 `existsSync` 判否、门禁报
  `找不到浏览器`。

### 33.7 结论与「用户该看什么」

1. **现象 1（ERA 状态栏空白）**：**已随构建 t 解决**（脚本跑起来→数据填上）。
   硬刷后开足控天堂2，ERA 状态栏应完整显示页签 + 因特网 + 世界信息 + 五官感受 + 三个选项。
   若仍空：看控制台有没有 `YAML is not defined`（有=没吃到 `2026-09-22t`）。
2. **现象 1 里那条真正的深紫空白是「正文美化」页**：真因是**模型把 `<now_plot>` 提前闭合**、
   故事落在卡正则的捕获块之外（`$1` 只截到 `<now_plot><audio>`）。**我们侧无缺陷**。
   用户侧可做：让模型把 `<content>…故事…</content>` 写全、且**故事包在 `<now_plot>` 内**；
   或请卡作者把该正则的"首个闭合"改成"最后一个闭合"。
3. **现象 2（反复出现）**：卡设计（每楼一份，ST 亦同）。想少占屏得改卡，或另立口径关掉
   `withStatusPlaceholder`（本轮不动，属装饰器守卫语义）。
4. **现象 3（插图上下空）**：卡设计（`width=50%` 居中 + 容器留白）；图片本体正常、不变形。
   苍玄界 `[16]插图` 是 `disabled=true`，**根本不跑**，别拿它当复现样本。
5. 想让 era 的**事件驱动更新**更稳，**下一轮**再谈 `tavern_events`/`errorCatched`（见 §33.5）。

## 34. 第 34 轮：帧高「测量修正通道」——修「卡界面下方一大片空白」（2026-09-23）· `2026-09-22u`

### 34.1 症状与主嫌疑

用户实测：某张卡的封面页（greeting 正则产物：整页 HTML + 一张大图 + 三个按钮）渲染后
**下方留出一大片空白**（iframe 高度远大于内容，占满整屏）。主嫌疑是 §29（`2026-09-22p`）
那轮加的**媒体事件重测**与**棘轮**的相互作用：图片加载中布局异常 → 上报过大 → 棘轮回不来。

本轮口径：**先取证再改**；复现不出来就如实报告、不硬改。

### 34.2 取证方法与工具

真时间 CDP 夹具（`.tmp-hs-forensic*.mjs`，临时脚本，未入库）。两个要点（都是踩出来的）：

1. **子文档探针必须插在"卡原始 HTML"里再走 `cardHtmlIframe`**。`cardHtmlIframe` 的
   `srcdoc` 值被 `escAttr` 整体转义（`<` → `&lt;`），产物文本里**没有**字面量 `</body>`
   ⇒ `verify-frame-ratchet.mjs` 里那句 `doc.replace(/<\/body\s*>/, …)` 是**空操作**，
   它那份子文档快照一直是 `null`（本轮顺手查出来的，见 §34.6 待办）。
2. 探针除了复刻 `extent()`（`raw`，**含** min-height 地板），还额外量一个
   `content`＝**纯元素包围盒**（**不含** min-height 地板）。帧高 vs 真实内容高必须用后者比，
   否则"地板撑出来的高度"会被当成"内容高度"，把两类问题搅成一团。

### 34.3 取证一：真卡 10 份围栏整页文档，**没有**棘轮型永久留白

| 真卡文档 | 帧高最终 | raw（含地板） | **纯内容** | 帧高−纯内容 | 真内容高(docEl.scrollHeight) |
|---|---|---|---|---|---|
| `_足控天堂2`·主页 | 1636 | 1636 | 1636 | 0 | 1636 |
| `_足控天堂2`·ERA 状态栏 | 900 | 898 | 898 | +2 | 900 |
| `_足控天堂2`·正文美化（带音乐） | 900 | 900 | **309** | **+591** | 900 |
| `异世界农场`·角色状态双端 | 349 | 349 | 349 | 0 | 349 |
| `异世界农场`·双端 | 210 | 210 | 210 | 0 | 210 |
| `涩涩提瓦特`·一体式美化状态栏 | 363 | 363 | 363 | 0 | 363 |
| `涩涩提瓦特`·美化状态栏（只） | 249 | 249 | 249 | 0 | 249 |
| `食人世界`·开场白 | 900 | 900 | 800 | **+100** | 900 |
| `食人世界`·开场白2 | 649 | 629 | 629 | +20 | 649 |
| `魔法少女MVU测试`·星盟契约开场白（108KB） | 1396 | 1440 | 1440 | **−44** | 1396 |

上报序列（逐条实测，摘 `星盟契约`）：`1334 → 1334 → 1271 → 1334 → 1334 → 1353 → 1396`，
宿主**逐条采用**（1271 那次是真的收缩，父侧 8px 死区放行）；`主页`：`1486 → 1636` 单调收敛。
⇒ **两张真卡都没复现"棘轮卡在高位"**：棘轮的**收缩路径是活的**（`1271` 就是证据）。

### 34.4 取证到的**第二机制**（真卡，本轮**不动**）

上表两处留白的成因**不是棘轮**，是 `rewriteVhMinHeight` 把 `min-height:100vh` 烤成
**父页视口高**（`ST-IFRAME-SPEC.md` §5：`--TH-viewport-height = window.parent.innerHeight`）
⇒ **短页面**的帧高被这块地板顶到父页视口高（本轮夹具 900）。ST 同构（ST 的帧高也
`≥ --TH-viewport-height`）⇒ **是 ST 平价，不是本轮缺陷**。

- 判别方法（用户可自查）：卡页面的 `body`/`html` 有没有 `min-height:100vh`？留白高度是不是
  ≈（聊天视口高 − 内容高）？两条都"是" ⇒ 命中本条。
- 本轮**不动**的理由：它是 §29 之前就立好、且 `verify-frame-height.mjs` **有断言**的既有决策
  （"正文美化钉在父页视口地板"）。改它＝翻既有语义，要单独取证（用户是否真的不接受"卡至少
  和聊天区一样高"），不在"补一条测量修正通道"的范围里。
- 但它确实是"封面页下方一大片空白"的**第一顺位嫌疑**（`正文美化` 实测 591px，`食人世界·开场白`
  100px），**下一轮第一件事**。

### 34.5 取证二：合成「先大后小」**复现**了永久留白（本轮修的）

夹具：`img` 用 `width/height` **属性**预留 600×2000 的高盒子（占位期内容 300+2000=2300，
**那次读数是对的**），真实图片是 600×200 的**扁**图 ⇒ 加载后内容缩到 500；`src` 在
**11.5s**（晚于引导脚本最后一次补量 `2500+3×2800=10900ms` +150ms 去抖）才设。

| 时刻 | 上报高度 | 宿主采用 | 真实内容 | 差 |
|---|---|---|---|---|
| 0.8s·1.0s·1.3s·2.2s·3.1s·5.9s·8.7s | 2300 ×7 | 2300 | 2300 | 0 |
| 11.5s（`src` 落定） | 2300 | 2300 | 2300 | 0 |
| 11.65s（媒体事件 + 150ms 去抖） | **2300** | 2300 | **500** | **+1800** |
| 12.2s 起（此后无任何触发） | — | — | 500 | **+1800 永久** |

**对照臂**：同一份文档把 `src` 提前到 **400ms** ⇒ 帧高 `2300 → 500`，正常回落
（靠 2500/5300/8100 三次低频补量凑够 3 次）。⇒ 判别量就是"媒体落定发生在最后一次补量之前
还是之后"。

### 34.6 确切缺陷（本轮修的）

收缩方向的常规路径要求**连续 3 次**观测（`__muvHReset>=3`）才清零重学。而**媒体落定引起的
收缩往往只有一次观测机会**：定时补量到 10.9s+150ms 就停；RO 只在**盒子**尺寸变化时 fire，
而媒体引起的**包围盒**变化可以完全不动盒子（§29.3 已记）。§29 加的媒体事件重测恰好提供了
**那一次**观测 —— 但一次不够计数器走到 3 ⇒ 棘轮 `__muvHFit` 永久停在 2300。

⇒ 结论：**既不是"棘轮只增不减"（它能降，真卡 1271 就是降），也不是"媒体事件没用"**
（它确实是唯一的晚触发面）。缺的是"**媒体落定后的那次修正，一次就该算数**"。

### 34.7 修法（保守小改，只动 `muvFrameBootstrap`）

语义分界（这是本轮最重要的口径，写进 `lib/client.js` 的注释里了）：

| | **内容增长**（棘轮） | **测量修正**（新通道） |
|---|---|---|
| 判据 | **观测到**溢出（`bOver\|\|dOver`） | 媒体**全部落定** + **没有**观测到溢出 |
| 生效 | **无条件**提升，无阈值无等待 | 已学值高出实测内容 24px 以上才动 |
| 需要几次观测 | 1 次（溢出是硬证据） | **1 次**（媒体落定是终态信号） |
| 为什么 | reset 是 `overflow:hidden!important`，溢出的像素不立刻补就是永久裁掉 | 落定后不会再有一次**由媒体引起**的重排，等第 2/3 次＝等一个不会再来的事件 |

实现（三处，全在引导脚本文本里）：

1. `MS()`：`img.complete` 全真 + `video.readyState>=1` 全真 ⇒ "媒体全部落定"。读不到按未落定
   处理（宁保守）。
2. `extent(mf)`：收缩分支里 `if(mf&&MS()){棘轮清零}`，否则走原来的 `rc>=3` 三次确认。
   **增长分支一个字符没动**；24px 阈值、3 次确认、父侧 8px 死区**全部保留**。
3. `m()` 读走一次性令牌 `__muvHMediaFix`（consume-once），`sf()`（媒体事件处理器）
   挂令牌 + `s()`，并在 **+700ms** 再挂一次令牌重量一次（**修正的安全复核**：修正量若偏小，
   那次走增长分支无条件补上，不会因这条通道把内容永久裁掉）。

**铁律核对**：收缩方向滞回**没被拆**（只多了一条满足四个边界条件的通道）；12000 上限、
`RL` 首帧闸、装饰器守卫、变量管线、`MUV_CARD_LIBS`/`MUV_CARD_SCRIPTS` **一行未动**。
`MUV_BUILD` → `2026-09-22u`。

### 34.8 门禁（3 绿 1 红：数字与真因）

- `verify-frame-height.mjs`：新增第 8 节「测量修正通道」——**先撑到 ≥2000**（防恒真）·
  **媒体落定后回落到 ≤600**（修复前 2300）· **变异臂**（`if(mf&&MS())` → `if(false)`）
  必红（2300）。其余各节 + §29 的媒体臂全部仍绿。**全部通过**。
- `verify-frame-ratchet.mjs`：**8 项失败**，**全部是既有问题**（下面 §34.8.1 是这一轮最值钱的发现）。
  "有没有破坏棘轮语义"的判据见 §34.8.2 —— **逐字一致，未触碰**。
- `test-client-render.mjs`：**320 / 0**（引导脚本的形态断言——只发一个数字 / 无裸 `</script>` /
  `if(e>0)window.parent.postMessage` / `setTimeout(m,150)` 全部保持）。
- `verify-decorate-dom.mjs`：**全部通过**。
- 环境口径：浏览器门禁**必须非沙箱**；`MUV_EDGE` 用 **Windows 正斜杠路径**（§33.6）。

#### 34.8.1 ★ `verify-frame-ratchet.mjs` 一直没在测东西（本轮修夹具，未改判据）

四个叠加的夹具缺陷（**改动前后的源码表现完全一致**，已用 `git show b536cb4:lib/client.js` 对照）：

1. **语法错 ⇒ 空表假绿**：生成的父页内联脚本多了一个 `}`
   （`'…c.clampedMax=h;}}}' + '}, false);'` 一共闭 4 层，`function(e){…for(…){if(…){…}}}` 只要 3 层）
   ⇒ `SyntaxError: missing ) after argument list` ⇒ **整段脚本一行都不执行** ⇒ 没有监听器、
   没有 `#out`、`parsed={}` ⇒ `byName` 为空 ⇒ **所有判据一条都不跑，直接打印"全部通过"**。
   这解释了 §29.5 / §33.6 里那两行"`verify-frame-ratchet.mjs` 全部通过"：
   **那两次也是空表**。
2. **子文档探针从未注入**：`doc.replace(/<\/body\s*>/, …)` 打在被 `escAttr` 整体转义的 srcdoc 上
   （产物里只有 `&lt;/body&gt;`）⇒ 第 1 节的 `extent` / `走的路径` / `内容底` 三列恒为 `?`，
   两条判据（有没有走 `body.scrollHeight` 回退 / 内容底边是否可见）**恒真**。
3. **固定 `sleep(6500)` 等不到 `report()`**：`report()` 挂在父页 `load`+5000ms，而 `load` 要等
   3 个真卡 iframe 的远程资源（字体/图/视频）全部落定，在这个夹具里可能**永远不 fire**。
4. **缺 `window.innerHeight` 桩**：Node 侧 `rewriteVhMinHeight` 静默跳过 ⇒ 卡里的
   `min-height:100vh` 变成"随 iframe 自身高度伸缩"的真·不动点（`正文美化` 报 600/900/1500）
   —— 这正是 `verify-frame-height.mjs` 早已记过的教训（那里的修法是传 `{innerHeight: PROBE_VH}`）。

本轮修了 1（少一个 `}`）/ 2（按转义形态注入探针）/ 3（轮询到有连报再收数）+ 4（传 `window` 桩），
并加一条**防空表假绿**的断言（`读到逐实例读数`）。**判据一条没动**。

修好后的真实读数：**8 项失败**，归因三类：

| 类别 | 条数 | 说明 |
|---|---|---|
| **真·产品发现（既有，未修）** | 1 | 「`height:100vh` + 任意 top 偏移」的对抗载荷**每测一次长高 40px**（序列 `2120→2160→2200→2240`，起始 600 档涨到 2240）—— 老法师的棘轮推理**命中**。真卡用 `min-height:100vh`（已重写）⇒ 线上暴露面有限，但确属未修风险，**下一轮单独处理** |
| **陈旧判据** | 2 | `正文美化` 的 `<400` 阈值 —— 姊妹门禁早已按"钉在父页视口地板 ≈900"更新口径，这条没跟上 |
| **夹具时序** | 5 | `内容底边可见` 用的是**取快照那一刻**的子文档 `innerHeight`，父页刚改完高度、子文档还没重排（`主页@1500` 报"文档 1635 > 帧 1500"，而父页最终值就是 1636） |

#### 34.8.2 本轮真正要证的那件事：棘轮语义未动（对照臂）

把**改动前**（`git show b536cb4:lib/client.js`）与**改动后**两份源码喂给**修好的同一条门禁**：

- 第 1 节逐实例读数：**逐字一致**（唯一差异是 §34.8.1 那条失控臂的时序数值 2320 vs 2240）；
- 失败集合：**逐字一致**（都是 9 项，含同一条失控臂）。

⇒ 本轮改动**未触碰棘轮语义**。棘轮的"只增不减 / 收缩必须回落"由 `verify-frame-height.mjs`
第 6 节（含"把 reset 拆成只增不减"的变异臂）在真浏览器里全绿 —— 那才是这条语义的正式判据。

### 34.9 只能真机验的部分 / 用户该看什么

- **合成留白已修**（1800px → 0），**真卡没有一份复现过棘轮型留白** —— 所以：
  1. 重启 DSH + 硬刷新，确认构建是 **`2026-09-22u`**（控制台 / `html[data-muv-engine]`）；
  2. 若"下方一大片空白"仍在，**先量两件事**：① 那张卡的 `body` 有没有 `min-height:100vh`；
     ② 空白高度是否 ≈ 聊天视口高 − 内容高。两条都"是" ⇒ 命中 §34.4 的 vh 地板，
     **不是本轮修的那条**，下一轮单独处理（别在这条上归因到棘轮）。
  3. 若那张卡里有**远程大图**（含 404 的图）且空白是在图加载完之后出现的 ⇒ 命中 §34.5/34.6，
     本轮修的就是它。
- **待办（下一轮）**：`verify-frame-ratchet.mjs` 的子文档快照一直是 `null`（§34.2 第 1 条，
  `doc.replace(/<\/body\s*>/)` 打在不含字面量的转义产物上）—— 它的 `extent / 走的路径 / 内容底边`
  三列一直是 `?`。修它要动既有门禁文件，本轮没顺手改。


## 35. 第 35 轮：文本级状态栏 —— 无占位符的卡也能把元信息渲染成状态栏 · `2026-09-22v`

### 35.1 症状（用户实测 + 已取证）

真卡 **川上富江**（`C:/MySpecialFolder/SillyTavern/data/default-user/characters/川上富江.png`，
实测 `regex_scripts: 0`、无酒馆助手脚本）。用户贴出的正文开头是**裸文本**：

```
[时间:5月14日|星期三][季节:初夏][天气:夜间大雨][时间段:晚上20:41][地点:暮川市·旧片区·富江的独宅·厨房][环境布置:镜子前的木凳空了…][怪谈女性角色:川上富江(高中水手制服…)]
她把他从自己腿间推开的时候…
```

正文里还夹着 `<details><summary>[角色状态]</summary> ```- 😃 川上富江的状态…```</details>`
（代码块裸露）。用户期望：元信息渲染成**状态栏**、折叠块渲染成**折叠 UI**。

### 35.2 真因：级联的**触发条件**只有一条（占位符）

`lib/status-cascade.js` 的四级识别（card / yaml / free / loose，含 `[角色状态]` section）
在本仓库里**只从 `STATUS_PH_TEST`（`<StatusPlaceHolderImpl/>`）那条路被调用**：

```
client.js: if (!sbHtml && STATUS_PH_TEST.test(result)) sbHtml = buildDefaultStatusBar(regText)
           … result = await cascadeStatusBlock(result, cardJson)   // 也要求 <Status_block>
```

⇒ 卡里既没有占位符、又没有 `<Status_block>` 时，**级联一次都不会跑**。而 ST 生态里
「模型把状态写成消息开头一串 `[键:值]`」是一大类常见形态（本仓库历轮取证过的真卡里就出现过
`[时间:…]`、`[角色状态]`、`- 😃 名字的状态` 这些写法）。这不是级联能力不足，是**入口只有一个**。

### 35.3 判据（保守优先：**宁可漏，不可误伤**）

| 判据 | 值 | 出处 / 为什么这么设 |
|---|---|---|
| 位置 | **消息开头**（去首尾空白后 ≤ 16 字「引子」以内，引子不得含换行/方括号） | 正文中段的 `[注:…]` 绝不能被动 |
| 对数 | **≥ 2 个连续对**（两对之间只许空白） | 单个 `[时间:…]`、`[注:…]`、`[1]` 一律不认；对照臂实测：放宽成 ≥1 对 ⇒ 门禁当场变红 |
| 键 | 必须**整体**落在词表里（`muvTextStatusProbe` 内，逐条标出处） | 词表＝误伤面的唯一闸门 |
| 形状 | 每对**不跨行**、值非空、整段 ≤ 600 字 | 折行与长度是把正文吞进来的两个方向 |
| 折叠块 | summary 文本必须是**状态类**标签（角色状态/NPC状态/人物状态/登场角色/状态栏/状态/角色/人物/NPC/Character Status/Status） | `<details><summary>主页</summary>` 那类是**整页文档**路径的活（`renderFencedHtml`），不能被这里吃掉 |

**词表（可扩展，新增键必须写出处）** —— 四个来源：

1. **用户实测**（川上富江）：`时间 时间段 季节 天气 地点 环境布置 怪谈女性角色`；
2. **既有级联**（`status-cascade.js` 的 `extractHeaderFields` 与 loose 的 section 名，保持一致
   才不会出现"卡里有、这里不认"的分叉）：`日期和时间 日期 当前时间 时间点 时段 时刻 位置 场景
   当前地点 所在地 气候 角色状态 NPC状态 登场角色 在场角色`；
3. **生态常见**（本仓库历轮取证过的真卡正文/门禁夹具）：`环境 氛围 场景布置 角色 NPC 人物 主角
   怪谈角色 女性角色 男性角色 行动 心理 内心 衣着 穿搭 状态 情绪 好感度 关系`；
4. **英文**（loose 已认）：`Status`、`Character Status`。

**故意不收**：`备注` / `说明` / `提示` / `旁白` 这类口语词 —— 它们出现在正文里的概率远高于
出现在状态前缀里的概率（误伤面 > 漏掉的收益）。

### 35.4 与既有路径的优先级（**没动**）

`muvStatusAlreadyRendered(text, sbHtml)`：下面任一条命中 ⇒ 文本级兜底**一个字符都不动**

1. 消息里还有 `<StatusPlaceHolderImpl/>`（占位符路径的既有语义）；
2. 产物里已经有 `.muv-statusbar-wrap`（占位符已被消费并替换）；
3. `d.statusBarHtml` 非空（卡自带状态栏皮肤）—— 卡级联"产出过"就别做文本级推断（保守选择）；
4. 消息里有 `<Status_block>`（结构化级联）。

开关 `MUV_TEXT_STATUS`（默认**开**）：关掉 ⇒ 无占位符的卡**恢复裸文本**（= 本轮之前的行为）。
它是客户端常量（`lib/client.js`），改 `true`→`false` 后**页面重载**即可，不需要重启 DSH。

### 35.5 实现要点（三个"看起来能省但省不得"的决定）

1. **落点信息写进产物自己**：状态栏容器带 `data-muv-ts` / `-raw` / `-look`，
   `applyDecoratedHtml` 新增 `①.5` 分支解析它、把正文里那段原文**逐段换掉**。
   不靠模块级状态 ⇒ 并发装饰多条消息不会串（与 `extractStatusWrap` 的"生成什么就解析什么"同口径）。
   `-raw` 由 `innerHTML` 解析还原（`escAttr` 转义过），不手写反转义（`&amp;` 与 `&#38;` 都要对）。
2. **落点匹配要容忍空白差异**（`muvFlexRegExpSource`）：**`innerText` 是渲染投影** —— 门禁夹具里
   那段折叠块在 700px 容器里软折了一行，`innerText` 给出的原文就在折行处**多了一个 `\n`**，
   而 DOM 文本节点里那位置只是一个空格。照原文逐字匹配 ⇒ 失败 ⇒ 退回整条替换 ⇒ **markdown 被
   抹平**（实测 `strong/h2/pre/li` 全 0，这一条是门禁抓出来的）。所以空白处一律 `\s*`，其余逐字。
3. **折叠块的内容不自己解析**：`<details>` 那套形状（去围栏/去标签/section/角色块/字段行）在
   `status-cascade.js` 的 loose 级里已经实现过一整个版本（含一串踩过的坑），重写必然分叉。
   所以只把**判定过的块体**发给 `/api/muv-engine/render-status` 的新 `body` 入口
   （显式字段：**不做**"没有 Status_block 就把整条消息当 body" —— 那等于让 yaml/loose 去读任意
   散文，误伤面不可接受）。服务端不可达时返回空 ⇒ **不动原文**（宁可留着裸块，也不许删内容）。

替换串铁律照旧：两处大段 HTML 拼接全部用**函数式替换**（见 `muvFrameBlock` 的长注释）。

### 35.6 门禁（全绿，数字）与两条**真变红**的对照臂

| 门禁 | 结果 |
|---|---|
| `node verify-statusbar-layout.mjs` | **全部通过**（2 阶段实测 PASS；真 CSS 2865 字） |
| `node verify-statusbar-fence.mjs` | **2 通过, 0 失败** |
| `node test-client-render.mjs` | **344 通过, 0 失败**（新增 24 条） |
| `node verify-decorate-dom.mjs` | **全部通过**（10 条用例 + 9 条对照臂/安全断言；第 35 轮新增 `I_textstatus` / `J_notstatus` + 关闸页 6 条） |
| `node test-era-vars.mjs` | **全部通过**（39 PASS / 1 SKIP＝找不到真聊天文件） |
| 顺带回归（本轮改到了守卫行） | `verify-guard-tag-agnostic.mjs` **80 通过 0 失败**、`verify-no-redouble.mjs` 4/0、`verify-header-fold.mjs` 全部通过 |

**夹具 = 用户那段真实文本**，四条断言：

| # | 断言 | 实测 |
|---|---|---|
| ① | 7 个连续方括号被识别、渲染成状态栏、正文里**不再有**裸方括号/裸围栏 | `tsBars=2 sbDetails=1 rawBrackets=0 nakedFence=0`，且 markdown 存活（`strong/h2/pre/li` 全在） |
| ② | 对照臂：正常行文里的**单个** `[时间:…]` + `[1]` + `[注:…]` 不被误伤 | `tsBars=0 keepBracket=1 rawBrackets=1` |
| ③ | 折叠块不再裸 ```，且交出给服务端的块体里带着角色名 | `sbDetails=1 nakedFence=0 tsReqHasName=1` |
| ④ | 关闸页（`MUV_TEXT_STATUS=false`，同夹具同源码另跑一页）恢复裸文本 | `tsBars=0 rawBrackets=1 nakedFence=1 tsReqHasName=0` |

**对照臂真变红（实测两处）**：
- 判据从「≥2 对」放宽成「≥1 对」⇒ `J_notstatus` **FAIL**（`tsBars=1`、单个 `[时间:…]` 被吞）；
- 关闸页 ⇒ `I_textstatus` 的 `tsBars=0 / rawBrackets=1`（要求"状态栏必须出现"的那条随之变红）。

### 35.7 顺带修好的一条**既有**门禁空洞（不是本轮引入的）

`verify-guard-tag-agnostic.mjs` 的 `--break=guard-enum` / `--break=guard-never` 两条破坏臂
**在本轮之前就已经抛异常**（用 HEAD 的 `lib/client.js` 复现过）：

```
guardLiteralOf(SRC) / shortBoundsOf(SRC)   ← 从**被破坏臂改写过的**源码里取守卫块
                                           而破坏臂恰恰把那一块换成了旧枚举单行
⇒ Error: 找不到 muvHasTag 定义行（提取阶段抛，断言根本没跑到）
```

这正是 §22.3「门禁自己也有洞」那一类：**报错盖住真正的失败项**。修法：三个提取口改读 `SRC_RAW`
（未改写原文），BEFORE 臂固定从 `SRC_RAW` 生成。两条破坏臂现在正常变红（**69/11**、**67/13**）。
同时把守卫行的匹配放宽成「前缀固定 + 任意多个 `&& !名字`」—— 本轮加的第三项判据
（`!muvTsShaped`）不会再让行匹配失效（下次再加一项也一样）。

### 35.8 只能真机验的部分（如实记录）

- 川上富江那张卡的真模型输出与 DSH 渲染后的 `innerText` 空白差异（夹具按用户原文 + 「标签当文本
  铺开」的既有事实搭，**没有**真机重放这张卡的会话）。
- 关掉开关后确实是裸文本（客户端常量 + 页面重载，不需要重启 DSH）。
- 如果某张卡的前缀**超过 600 字**、或键不在词表里 ⇒ 本轮**故意不认**（判据宁可漏）。遇到就把
  那张卡的原文贴出来放宽词表/上限，不要关开关。

## 36. 第 36 轮：卡脚本报错双修 —— `errorCatched`/`tavern_events` + 垫片补 `SillyTavern.saveChat` · `2026-09-22w`

本轮的输入就是用户真机控制台（构建 `2026-09-22v`，卡 **异世界农场**）的六行，四条有效
（两条图床 `ERR_CONNECTION_RESET` 是用户侧网络，不在本项目范围内）：

```
[muv-engine] 卡脚本报错：（未知脚本）Uncaught ReferenceError: errorCatched is not defined   ← 反复出现，阻断卡脚本
lodash.min.js:84 Uncaught TypeError: Expected a function
[muv-engine] 卡脚本报错：（未知脚本） Script error.                                        ← 跨源脚本错误（无细节）
mvu_zod.ts:201 变量结构注册成功                                                          ← 部分脚本是跑起来的
```

第 4 行是关键旁证：`变量结构注册成功` 就是 `mvu_zod.js` 的 `console.info`（用户控制台里那条），
它证明**卡脚本确实跑起来了** —— 所以本轮的病不是"卡脚本没注入"（§30/§31 修好的那条路是通的），
而是**垫片少了两个 ST 会给的全局** + **垫片的 `SillyTavern` 少一个方法**。

### 36.1 `errorCatched`（ST 真语义，逐条照抄）

出处（只读源码 `JS-Slash-Runner`）：

| ST 位置 | 内容 |
| --- | --- |
| `src/function/util.ts:17` | `export function errorCatched(fn)` —— 纯函数版 |
| `src/function/util.ts:43` | `export function _errorCatched(fn)` —— iframe 绑定版（`this: Window`） |
| `src/function/index.ts:161/166/261/433` | 两个都导出；`:433` 挂到 `TavernHelper` 上 |
| `src/iframe/predefine.js:13` | `_.omit(TavernHelper,'_bind')` 整包 merge 进卡 window |
| `src/iframe/predefine.js:14-18` | `_bind` 表逐项 `[key.replace('_','')]: value.bind(window)` ⇒ 卡 window 上拿到的是**去掉前导下划线的裸全局 `errorCatched`** |

语义（`util.ts:17-42` 逐字读出来的四条）：

1. **入参是函数、返回一个包装函数**（不是就地执行）；
2. 包装函数被调用时：`fn.apply` 同步抛 ⇒ `onError(error)`，而 `onError` 里
   `toastr.error('<pre style="white-space: pre-wrap">…</pre>', error.name, {escapeHtml:false})`
   之后 **`throw error`** —— 即 **rethrow**，不吞；
3. `fn` 返回 thenable（`isPromise(result)`）⇒ `result.then(undefined, onError)`；
   因为 `onError` 里 rethrow，**包装结果仍是被拒的 promise**；
4. 绑定版比纯函数版多两处：标题带 `[${iframe_name}] ` 前缀、并且 `this._th_impl._log(...)`
   往 iframe 日志面板写一条。我们**没有** iframe 日志面板 ⇒ 等价物是控制台留痕（见 `warnShim`）。

卡侧实证（本机真卡 `异世界农场`）：三条正则（`【美化】完整变量更新` 576 / `角色状态双端` 21,200 /
`双端` 12,120 字符）里两条状态栏产物**末尾都是 `$(errorCatched(init));`** ——
jQuery 的 `$(fn)` 是 ready 回调 ⇒ **返回值必须是函数**（这就是上面第 1 条在真卡上的兑现；
如果实现成"就地执行并返回 fn 的结果"，jQuery 会拿到非函数 ⇒ 另一条报错）。

### 36.2 `tavern_events`（82 条常量表）

出处：`src/function/event.ts:180`（`export const tavern_events = {…}`，文件共 515 行），
`src/function/index.ts:46/311` 导出并挂 `TavernHelper` ⇒ 经 `predefine.js:13` 同一路 merge 成**裸全局**。

- 表里有一组**同值别名**：`SMOOTH_STREAM_TOKEN_RECEIVED` 与 `STREAM_TOKEN_RECEIVED` **都等于**
  `'stream_token_received'`。这是 ST 自己留的，**删任何一个**都会让走它的卡拿到 `undefined`，
  所以逐字照抄（本轮的表就是照抄的，不是"简写版"）。
- 大小写怪例也照抄：`CHARACTER_DELETED: 'characterDeleted'`、
  `CHARACTER_MANAGEMENT_DROPDOWN: 'charManagementDropdown'`、
  `CHAT_CHANGED: 'chat_id_changed'`、`GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS'`。
- 卡侧实证：MVU `artifact/bundle.js`（573,299 字节，`异世界农场` 与 `魔法少女MVU测试` 两条卡脚本
  都 import 它）里 `tavern_events` **×17**，且**顶层**就有（`kt(tavern_events.MESSAGE_DELETED, …)`）
  ⇒ 缺它整个 bundle 一行都跑不到。
- 同一份 bundle 里 **`iframe_events` ×0**、本机真卡里也是 0 处 ⇒ **故意不补**
  （与 §32「卡不用的 API 加了只会让 DSH 比 ST 更宽松」同一口径；真遇到再取证）。

### 36.3 我们怎么补的（`lib/client.js` 的 §8.1.5）

- `errorCatched`：上面四条语义逐条实现（`isP` 判 thenable、`onError` 里 toastr + `throw`）。
- `tavern_events`：82 条逐字常量表。
- 两者都挂 `TavernHelper`（ST `index.ts:311/433` 本来就有），并**在卡 window 上以裸全局落位**。
- **落位判据（只在缺失时补）**：
  ```js
  if (typeof window.errorCatched !== 'function') def('errorCatched', errorCatched)
  if (!window.tavern_events || typeof window.tavern_events !== 'object') def('tavern_events', tavernEvents)
  ```
  判据是 `typeof` 而不是真假值 —— 卡自己写了一个同名变量（哪怕 `null`）我们都不动它。
  门禁 `verify-card-compat.mjs` ⑪ 有一条专门的断言盯这个（预置哨兵函数/对象 ⇒ 跑完必须原封不动）。
- **语义边界（如实记，别当它是事件系统）**：补的是**常量表与工具函数**，不是事件的**发生源**。
  卡的 `eventOn(tavern_events.MESSAGE_RECEIVED, …)` 从此能**注册成功**（此前连注册那一步都因
  ReferenceError 跑不到），但宿主目前只在 ERA / MVU 那几条链路上广播（`__muvEvent`）⇒
  ST 那批**原生命名事件多数仍然不会响**。"事件名 → 我们的事件面"的映射需要单独取证，本轮不做。

### 36.4 lodash `Expected a function` —— 真因是垫片缺 `SillyTavern.saveChat`

取证（**先取证再改**，没有猜版本）：

| 证据 | 结论 |
| --- | --- |
| `lodash@4.18.1/lodash.min.js:84` 的 `if(typeof n!="function")throw new pl(en)`，`pl=TypeError`、`en="Expected a function"`，该行**只此一处** | 抛这句的函数是 **`_.debounce`**（不是 `_.throttle`、不是 `_.memoize`） |
| 核对了 CDN 那份 = 标准 lodash 4.18.1，与 ST 本体同版本 | **不是 lodash 版本问题**（不升/不换版本） |
| MVU `bundle.js` 顶层 `_.debounce(SillyTavern.saveChat, 1e3)` | 喂进守卫的是 `SillyTavern.saveChat` |
| ST `src/iframe/predefine.js:26-34`：`SillyTavern` 是 `defineProperty(get: () => ({...getContext(), getContext}))`，而 ST 的 context **有** `saveChat` | ST 里它是函数 |
| 我们的垫片原来只给了 `{ getContext }` | ⇒ `undefined` 进守卫 ⇒ TypeError ⇒ **整个 bundle 模块求值中断** |

⇒ **我方垫片缺口**，不是卡侧用法问题、更不是 lodash 的锅。至于卡侧旁证：农场卡自己的
`变量结构` 脚本（953 字符）只用了 `z` 与 `_`（`_.clamp` 在两处 transform 里），
**没有**调用任何"首参必须是函数"的 lodash 方法 —— 也就是说这张卡上的 lodash 报错**不是它自己调的**。

修法两处：

1. 补 `SillyTavern.saveChat`（返回**已完成** Promise；DSH 没有等价的落盘动作，
   首次调用 `warnShim` 留痕说清楚"聊天与变量由 DSH 自己持久化"）；
2. `SillyTavern` 的落位从 `def`（固定值）改成新加的 **`defGet`**（每次取值都重算的 getter）。
   为什么必须换：`hostChat` 会被宿主用 `__muvChat` 消息**整条替换**，用 `def` 固定成快照会让
   `SillyTavern.chat` 永远停在初始的**空数组**上 —— 这是**静默的假数据**，比 `undefined` 更坏。
   `verify-card-compat.mjs` ⑪ 有一条断言钉"`SillyTavern.chat` 与 `getContext().chat` 是同一个引用"。

### 36.5 ★ 本轮自己踩的坑（值得单独记）：一个 `;` 让整段垫片不执行

给 `tavern_events` 加表时，表尾那条写成了 `'}' +` （应该 `'};' +`）。后果不是"少个分号"这么轻：

- 整条垫片最终拼成**一行**；
- 自动分号插入（ASI）只在「下一个词元**前面有换行**」或「下一个词元是 `}`」时才补分号；
- 这里 `}` 后面**同一行**紧跟 `var TH={` ⇒ 两条都不满足 ⇒ `SyntaxError: Unexpected token 'var'`；
- 而且**从那一句起整段垫片都不执行** —— `TavernHelper`(TH) / `Mvu` / `toastr` /
  `waitGlobalInitialized` / 收尾的 `mvuReq()` **全丢**，等于垫片废掉一大半。

**怎么发现的**：自检脚本报"产物不可解析"。第一反应是"自检脚本的宿主写法不对"（把 IIFE 当函数体喂
`new Function`）—— **那是误判**：同一份产物 `node --check` 也报同样的错。改用两组机械定位才钉住：
① 与 `HEAD` 的产物**差分**（HEAD 可解析、工作区不可解析 ⇒ 确定是自己引入的）；
② 在产物里做**配对深度二分**（先把语句边界标出来，再二分第一个"加上就解析不了"的语句）。
定位过程写在这里是因为它比结论更值钱：**"测试写错了"是最容易骗过自己的解释**。

**门禁现在盯住了**：`verify-card-compat.mjs` ⑪ 的第一条就是「垫片产物在 Node 侧可解析」，
并带一条**变异臂** —— 把产物里 `};var TH=` 的 `;` 摘掉 ⇒ 必须**真的**不可解析（否则那条是永真）。

### 36.6 「暗色主题下发白的 `<html>` 行」取证（**无代码改动**）

用户的嫌疑是"整页 HTML 源码块没被 iframe 化/隐藏"。用真卡 `异世界农场` 的**三条真正则产物**
（`【美化】完整变量更新` 576 / `角色状态双端` 21,200 / `双端` 12,120 字符，均 `markdownOnly=true`）
跑**真渲染链**（`renderFencedHtml` → `wrapLoneDocuments` → `muvHidePageSourceBlocks`），三种用例：

| 用例 | 产物 | iframe 容器 | 残留行首围栏 | 残留裸 `<html>`/`<!doctype` 行 |
| --- | --- | --- | --- | --- |
| 带占位符 | 52,883 字符 | **1** | **0** | **0** |
| 只有正文 | 56 字符 | 0 | 0 | 0 |
| 占位符在开头 | 52,883 字符 | **1** | **0** | **0** |

另跑一条"围栏被剥掉后的形态"（≈ DSH 把它渲染成 `<pre>` 后 `innerText` 拿到的样子）也是
**0 行裸 `<html>`**。⇒ **没有"我们漏隐藏"的证据** ⇒ 本轮**不改**（有实锤再修）。
最可能的解释（保守、不臆断）：暗色主题下那个源码观感来自**卡 iframe 区域内**（卡自己把整页源码
当正文渲染进了页面）或输入侧痕迹；两者都不在本引擎的判据范围内。

> 记这条路的意义：§33 那轮已经立过规矩 —— **判据保守 + 有实锤才修**。这里再次按它办，
> 没有为了让"用户报的那一行"消失而去放宽 `muvIsPageSourceText`（那会开始误吞正常正文）。

### 36.7 门禁

```
export MUV_EDGE='C:/Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node verify-card-libs.mjs             →  54 通过 /  0 失败   （原 49 → 新增 F 臂 5 条）
node verify-tavernhelper-scripts.mjs  →  54 通过 /  0 失败
node verify-guard-tag-agnostic.mjs    →  80 通过 /  0 失败   （含浏览器臂）
node test-client-render.mjs           → 344 通过 /  0 失败   （原 343/1 → 见 36.8）
node verify-card-compat.mjs --old-export → after 64 / 0 · before 9 / 38 · 结论「绿灯（对照成立）」
node verify-no-redouble.mjs           →   4 通过 /  0 失败（before 臂 SKIP，见 36.8）
```

主门禁连跑两次都是「绿灯（before 臂红 38 条）」，本轮**没有**遇到 §34/§35 记的那类时序偶发。

**新增的两条对照臂（都真变红）**：

1. `verify-card-libs.mjs` **F 臂**（`arm-libs-compat` = 库 + 垫片，与 `muvInjectDoc` 同序）：
   - A 臂（真 lodash、**没有垫片**）⇒ `debounceMVU = "THROW:Expected a function"` —— **真机同款**；
   - F 臂（真 lodash **+ 垫片**）⇒ 同一行 `"ok"`；两臂只差"垫片"这一个变量；
   - B 臂（一个库都没有）⇒ 报 `"没有 lodash"` ⇒ 证明这条判据真的在调 `_.debounce`，不是恒真字符串。
2. `verify-card-compat.mjs` **⑪ 垫片契约**（纯 Node，**在起浏览器之前**跑，18 条）：
   after 臂全绿；before 臂 **6 条红**（`errorCatched` / `tavern_events` / `TavernHelper` 两成员 /
   `SillyTavern` 形状 / `saveChat` / `chat` 同引用）；外加**产物变异臂**。

### 36.8 两处如实记录（不是本轮引入的）

- `test-client-render.mjs` 原有 1 条 `★ 垫片已有的 ST predefine 全局仍在` 断言写死了
  `def("SillyTavern"` 这个**字符串形态**。本轮 `SillyTavern` 必须从 `def` 换成 `defGet`（36.4 的理由），
  所以把判据放宽成「`def(` 或 `defGet(` 之一」，并把**行为判据**放到 `verify-card-compat.mjs` ⑪
  （"同引用 + 逐次重算"）与 `verify-card-libs.mjs` F 臂上 —— 行为判据比字符串形态强，不是把断言改弱。
- `verify-no-redouble.mjs` 的 before 臂 **SKIP**：`a7031dc` 已随 §26.2 那次 git 对象库事故丢失
  （`git cat-file -t a7031dc` ⇒ `Not a valid object name`）。该脚本本来就写着「取不到就如实报 SKIP，
  不伪造对照」，所以这是**既存状态**，与本轮改动无关。

### 36.9 环境事实（会咬人的）

- **本环境里 Node 起外部进程会 `EBUSY`**：`verify-card-compat.mjs --old-export` 内部走
  `spawnSync('git', …)` ⇒ 直接抛 `Error: git show 7623ffa 失败:`（`stderr` 为空、`status===null`，
  实际是 `spawnSync git EBUSY`，同一个 `node -e "spawnSync('git',…)"` 可复现）。
  **不伪造对照**：用 bash 侧 `git show 7623ffa:lib/client.js > .tmp-old-client-7623ffa.js`
  再 `--src=.tmp-old-client-7623ffa.js` —— `buildArms` 里 `--old-export` 与 `--src` 走的是
  **同一行**（`OPTS.src ? path.resolve(OPTS.src) : exportOldSource()`），所以是字节等价的同一臂。
  在能正常 spawn 的 shell 里直接 `--old-export` 即可。
- 沙箱里跑浏览器门禁会失败（起 Edge 被拦），必须**非沙箱**跑。

### 36.10 只能真机验的部分（如实记录）

- 真机上 `errorCatched is not defined` / `Expected a function` **是否真的消失**（本轮只做到：
  ST 语义逐条对齐 + 真浏览器真 lodash 的 F 臂 + 真卡三条正则产物进渲染链）。
- `tavern_events` 补上之后，**哪些** ST 原生事件在 DSH 里真的会响 —— 本轮只保证"注册那一步不再抛"
  （36.3 的语义边界）。要回答"响了没"，得先做事件名映射，再上真机看卡的刷新钩子。
- 「暗色主题下发白的 `<html>` 行」的真机截图（本轮按判据取证 ⇒ 无实锤 ⇒ 未改，见 36.6）。
  如果用户再看到，需要的是一张截图 + 那条消息的原文（是不是在 iframe 区域内）。

## 37. 第 37 轮（2026-09-24 凌晨）：透明浮层过滤 + 大幅下修通道 —— 与 ratchet 三档收敛的语义冲突（未决）

### 37.1 改动（提交 ef049b3 之后的本提交）
-  跳过  的透明浮层（苍玄界  同形：
  不跳过则包围盒被撑大 ~400px，封面下方一大片白）。**双条件**：只看 opacity 会误伤入场动画
  前的内容（vh-E 真卡实测 79px）。
- 宿主收缩滞回加**大幅下修通道**：落差 ≥300px 的收缩不受 8px 滞回限制、直接采纳
  （vh-F 夹具：extent 报 500 一次、宿主帧高停 900 ⇒ 不放行就永久留白）。

### 37.2 效果（verify-frame-height 实测）
- vh-F（opacity:0 浮层）900 → **收敛到 500** ✓；vh-E（真卡正文美化）79px → 收敛 ✓。

### 37.3 ⚠ 未决冲突：verify-frame-ratchet 9 项失败
- 「真卡·主页」三档 1636/1486/1486、「ERA 状态栏」898/900/**1500**（极差 602）——
  **1500 档停在起始值** = 棘轮收缩在真卡上本就不收敛（夹具修好假绿后第一次真跑暴露）；
- 「对抗·100vh」系列三档全部不收敛；
- frame-height 的 SCENARIO 棘轮臂（收缩/增长各 3 档）在 w 构建时 PASS、x 构建 FAIL ——
  两个变量（extent 过滤 / 300 通道）哪个导致、还是时序抖动，**本轮未定位**。
- 处置：修复有效果（vh-E/F），**先提交让真机做最终判据**；ratchet 判据与新语义的调和列下一轮
  第一顺位。vh-fix 工兵的大改（vh 重写多形态 +extent 重构）因棘轮 12 臂全红已回滚，
  patch 备份在 。

## 38. 第 38 轮：MVU JSONPatch（第四种变量格式）+ 元素形态显示泄漏 —— 变量终于生效、正文不再糊（2026-09-24）· `2026-09-22y`

### 38.1 真机实锤：第四种格式长什么样

DSH 会话 `session-7347d5f7`（ST 角色卡），模型**正式输出**（非 reasoning）里出现了 MVU 标准的
第四种变量写入格式 —— `<UpdateVariable>` 里不再包 `<initvar>` YAML：

```
<UpdateVariable>
<Analysis>
- time passed: about 15 minutes since the door was pushed open (11:27 to 11:42)
- dramatic updates allowed: no, this is a first-contact scene
- variables: time initialized; race affinity for 凛原族 set to base 5
</Analysis>
<JSONPatch>
[
  { "op": "insert", "path": "/时间", "value": { "日期": "09-12", "时刻": "11:42" } },
  { "op": "insert", "path": "/种族好感度", "value": { "凛原族": 5 } },
  { "op": "insert", "path": "/个人好感度", "value": {} }
]
</JSONPatch>
</UpdateVariable>
```

同一条消息里**还有** `<VariableThink>` / `<VariableEdit>` / `<era_data>` —— 四种来源真的会同楼混发。
提取工具：`node "C:/deepseek harness/tools/_probe-uv.mjs"`（zstd 多帧解压代码可直接抄）。
两个用户可见后果：① 变量全没生效（extract 端点一个 op 都收不到）；② `<Analysis>` 英文行 +
JSON 数组裸文本糊在正文里。

### 38.2 服务端：`parseVariableOps` 第四来源（`lib/var-tracker.js`）

ops 映射表（④ JSONPatch → 我们的变量树；与 ①②③ 同一账本、同一套顺序/重放语义）：

| MVU op | 我们的 kind | 语义 |
|---|---|---|
| insert / add | `jpadd` | 对象路径 = 设键（已存在则覆盖）；**目标本身是数组**或**父层是数组**或路径以 `/-` 结尾 = 追加到末尾（`/-` 父层缺失时建成数组）；数组追加**先 clone 再 push**（杜绝别名） |
| replace | `jpadd` | RFC 6901 要求已存在；MVU 实卡不保证 ⇒ 保守：缺失也落为设值，次数记 `jsonPatch.byOp.replace` |
| remove | `jpremove` | 删键 / 数组按下标 splice；目标不存在 = 无操作（重放幂等） |
| move | `jpmove` | 从 `from` 搬到 `path`；值 JSON 往返深拷贝；源不存在 = 无操作 |
| delta | `jpdelta` | 数值路径累加；缺失从 0 起算（与 ③ `_.add` 同约定）；**已存在**的非数字路径跳过 |

- JSON Pointer（RFC 6901）转义：`~1`→`/`、`~0`→`~`；导航按**精确键**（不走点分拆分，键带 `.` 不劈开）。
- `<Analysis>` **先整块剔掉**再找补丁体 —— 它是给模型的思考痕迹，绝不进变量，而且里面
  可能恰好有 `[1,2,3]` 这类 JSON 形状文本，不剔会被宽容分支误吃。
- `<initvar>` 形态的 UV 块**不碰**（① 的地盘，不误计 bad）。
- 宽容双认：`<JSONPatch>` 包裹的标准形态 + Analysis 后直接跟 JSON 数组的裸形态。
  数组形状守卫：每一项必须是"有字符串 `op` 字段的对象"，防止把普通 JSON 数组吃进变量。
- 已消费的 UV 块从 ②③ 扫描源里**等长空白化**剔除（位置不偏移，`at` 时间轴不乱），
  块内嵌套的 `<VariableEdit>` / `_.set` 不会被两个来源重复解析。
- 坏块/坏 op：跳过并计数（`bad` + `jsonPatch.bad` + `jsonPatch.byOp`），不抛、不整批失败。
- 响应包新增 `jsonPatch: {blocks, ops, bad, byOp}`（`/api/muv-engine/extract`）。

### 38.3 显示层：泄漏机制实锤与修法（`lib/client.js`）

**复现**（`C:/deepseek harness/tools/_probe-leak.mjs`，真 Edge + 真模块 + 真块三形态）：

| 形态 | HEAD 实测 | 结论 |
|---|---|---|
| 转义文本（`&lt;UpdateVariable&gt;…`，单行） | `varedit=1` 不泄漏 | 既有 E_variable 夹具覆盖的就是这种 |
| 转义文本 + 多行真实块 | `varedit=1 jsonpatch=1` 不泄漏 | 文本形态连嵌套块也能收 |
| **元素形态**（标签被 DSH 渲染成真元素） | `varedit=0 / analysisLeak=1 / patchLeak=1` | **实锤泄漏机制** |

机制：DSH 把标签渲染成**真元素**时（§20.4 实测两种形态之一），字面标签文本不在任何
文本节点里（`muvTextWithBreaks` 只走文本节点）⇒ 两条折叠正则永远打不中 ⇒ 内部内容裸露。

修法：`muvRenderVariableBlocks` 新增**元素形态 pass**（先于文本 pass 跑）：
`querySelectorAll('updatevariable, variableedit, variableinsert, variablethink, analysis, jsonpatch')`
—— 变量块/推演/JSONPatch → `muvDetailsBlock` 折叠卡（与酒馆路径同 class）、`analysis` → 删除；
只处理仍挂在本根上的元素（外层整块折叠后内层随之摘除）；内容一律 textContent。
双路径集合对齐：酒馆路径 `_tavernRenderTags` 本来就有 JSONPatch（5029）/变量块（5066）/
Analysis 隐藏（5118），本轮补齐的是原生 DOM 路径的**元素形态**这一面。
`muvFeedVariables` 收集正则**没动**：它收 innerHTML（两种形态都在）且**先于**折叠跑（§20.4）。

### 38.4 门禁（全绿，数字）

- `test-era-vars.mjs`：+ [8] 节 20 条，全部通过（真实块夹具 / insert×3 落树 / Analysis 不进
  变量 / era_data 照常取键 / 幂等 / 坏 op 计数 / delta / 数组追加 / Pointer 转义 / move /
  remove 幂等 / initvar 不误计 / Analysis 形状文本不误吃 / 键序重放乱序一致 / ④②混合不重复 /
  结构对照臂——砍掉 `JSONPATCH_TAG_RE` 即红）。
- `test-client-render.mjs`：**347 通过 / 0 失败**（+3 条元素形态断言）。
- `test-regex-engine.mjs`：26 通过 / 0 失败；`test-snapshots.mjs`：全部通过；
  `test-client-source.mjs`：exit 0。
- `verify-decorate-dom.mjs`：12 用例全 PASS —— 新增 **K**（转义多行真实块）与 **L**
  （**元素形态**真实块），判据 `variableBlocks≥1 + jpLeak=0`（Analysis 英文行 / `"op"` 不许裸露）；
  markdown 存活照旧双向钉。
- `verify-guard-tag-agnostic.mjs`：80 通过 / 0 失败（含浏览器臂）。
- `verify-era-bridge.mjs`：after 臂 **21 通过 / 0 失败**（连跑 3 次全绿；期间出现过 17/4 的
  时序波动、HEAD 对照同红同绿 ⇒ §26.1 归因环境时序，与 card-compat 0/1/3 波动同口径）。
- `verify-varblocks-dom.mjs`：全部通过。card-compat 未跑（任务口径允许，0/1/3 波动不强制）。

### 38.5 顺带修的两个门禁基建问题（非本轮引入）

- `verify-era-bridge.mjs` 的 `OLD_REV = '324b751'` 已随 §26.2 git 事故丢失（`git show` 必炸）
  ⇒ 照 §27.4 对 card-compat 的同一处置改 `7623ffa`（可 `MUV_OLD_REV` 覆盖）。
- WorkBuddy 宿主的 node shim 里 `spawnSync('git')`（连 `cmd.exe`）一律 **EBUSY**（git 本身
  没问题，bash 里正常）⇒ `exportOldSource` 加容错：旧源码导出文件已存在就直接复用
  （手工 `git show <rev>:lib/client.js > .tmp-era-old-client-<rev>.js`，内容可 md5 核对）。

### 38.6 只能真机验的部分 / 用户该看什么

- 同一张卡再跑一轮：正文里不应再有 `<Analysis>` 英文行 / JSON 数组裸文本；
  MUV 面板应能看到 `时间 = {日期: 09-12, 时刻: 11:42}`、`种族好感度.凛原族 = 5`。
- 折叠卡（🔧 变量更新 / 🔧 变量补丁）可展开核对原始数据。
- 若某楼变量仍没生效：看 extract 响应里的 `jsonPatch` 计数（blocks/ops/bad）定位是
  "没喂到"还是"解析失败"。

## 39. 第 39 轮（2026-09-24 凌晨）：自主诊断定型 + 开场白/白边四连修（6606288，构建 d）

### 39.1 自主诊断工具（效率质变）
- `C:\deepseek harness\tools\dsh-live*.mjs` 三件套定型：`_dsh-cookie.json` 的 cookie（有效期至 9-29）
  注入 → openPage → 会话枚举/点击（`.YDXeBa_sessionRow`）→ iframeSessions 逐元素诊断。
- **DSH 服务端对 client.js 是逐请求读盘**（rev 随内容变）——客户端改动硬刷新即生效，无需重启。

### 39.2 四连修（全部真机实锤后动手）
1. **开场白钉死**：苍玄界 greeting 正则 `maxDepth:0`；ST 播种不传深度（script.js:7660），
   DSH 重渲染旧会话首楼 depth>0 ⇒ 拒替换 ⇒ 钉死。beautifyMuv 内：微小响应（≤400B）+
   短占位符（≤300）+ depth>0 ⇒ depth 0 重打一次。真机验证 retry-depth0 → iframe 出现。
2. **装饰触发不可靠**：观察器单次触发 + React 晚挂载 ⇒ 永不重试。3s 兜底扫摆。
3. **取卡未决不钉死**：muvCardFetchInconclusive（权威解析失败/网络失败）时跳过 DECORATED_ATTR。
4. **白边第二层**：.cx-modal{opacity:0;inset:0} 遮罩内 1575px 表单——opacity 不继承，
   逐元素过滤漏祖先隐藏子树。extent() 用 checkVisibility({checkOpacity,checkVisibilityCSS})。
   真机：iframe 1575 → 610px。
5. 全链路留痕：muvBeautifyTrace（enter/card/apply/retry/exit）+ 三处吞异常 catch 改告警。

### 39.3 未决
- verify-frame-ratchet 5 FAIL（真卡三档收敛 / 100vh 对抗臂）——§37.3 既有冲突缩小（9→5），归因未完成。
- 卡脚本 `_.debounce(SillyTavern.saveChat)` 之外的 `Expected a function` 是否随 saveChat 垫片消失，待真机。

## §40 2026-09-24 三轮速记（构建 j 止；工作区有 build k 半成品，详证见 `C:\deepseek harness\docs\41-0924晚交接.md`）

### 40.1 已收编（5 提交，全在本地无远端）
- `eee4eb8`（f）：模型自创 `<content>…</content>` 信封被原生 markdown 透传，inline+normal 折叠段间换行 ⇒ 正文一大坨。`muvFixEnvelopeBlocks`（block+pre-wrap 纯展示兜底）+ sanitize 第一步 + `isMuvMessageBody` 探针加 content。
- `30eeb8e`（g）：垫片补 12 全局（取证=解卡 PNG + 拉远端 import + ST `_bind` 全表 34 名普查）：`updateVariablesWith`/`deleteVariable`/`getButtonEvent`（**缺它整条 ERA 脚本不执行**）/eventClearEvent·MakeFirst·MakeLast·RemoveListener/`getCurrentMessageId`/按钮族+`replaceScriptInfo`（半途 no-op）。`messageData` 0 证据不垫；`listenPreferenceState` 铁律不垫。
- `fee1d21`（h）：封面楼 full-bleed——真凶是 DSH 消息列 `.EvIC1a_column` 920px 居中（像素级排除了封面/iframe/注入）。`:has(>iframe.muv-iframe)` + 100vw + clip。**该判据随即被证伪（见 56889fa）**。
- `56889fa`（i）：状态栏与封面楼 wrap **完全同构**（class/data-*/父级零差异）⇒ 结构判据不可行，改楼位判据 `muv-fullpage`（isOldestFloor + 扫摆）——**仍不完美**：农场这类"首楼=状态栏"的卡被误伤（用户实锤），工作区 build k 已改打标点到 `renderFencedHtml` 产出路径。
- `744c6a0`（j）：装饰产物缓存秒开 20×（127ms→6ms，apply-regex-card 2~3 次→0）。key=权威会话 id+compatKey+depth+fullpage；**只缓存 iframe 产物楼，`.muv-sb`/文本状态栏楼现算**（变量永不冻结）。img/iframe lazy 实测否决（img 打红 visual 逐字 parity、iframe 断棘轮）。图片本就 memory cache 0 重取（例外：21.5MB r2.dev 图 CDN 头不可缓存）。

### 40.2 工作区未收编（build 2026-09-23k，+297/-152 混合半成品）
- 工兵 A（装饰链）：fullpage 打标唯一化到 `renderFencedHtml` 产出路径、删 isOldestFloor/扫摆猜测、`muvParaKeepHtml`（整条替换保段）、信封泛化；`test-client-render.mjs` 两处断言配套。**未跑门禁未真机**。
- 工兵 B（垫片）：KV 暗色持久化修复（卡 localStorage→跨会话栅栏的 init 时序/落盘问题），**已过门禁差真机闭环**。
- 未跟踪 `_dsh-tok.txt` 含页面 token，**收编前必须 gitignore/删除**。
- 收编流程与三 bug 断点：见 `docs/41-0924晚交接.md` §2-§3。

### 40.3 同日 tavern-v2 `d353b06`（跨仓库）
预设宏管线：保存时 `{{setvar}}×338/{{getvar}}×290/{{random}}×46` 被 `cleanObjectStrings` 剥空（变量组 3180→2 字符）+ `{{char}}` 曾换成玩家名 + 顺序未按 ST `prompt_order` ⇒「预设文风词条不生效/不是一个模型在输出」。修：`expandStMacros()` 出口求值、保存不清洗、`{{char}}`→角色名、破限前置收窄按模块名。tavern-lite presets.json 已按 prompt_order 重建（备份 `.bak-st-refill-20260924`）。架构级待拍板：depth 注入 / 采样参数 per-preset / CARD_MAX 分片。

### 40.4 基线更新
- verify-frame-ratchet：**8 FAIL**（§39.3 的 5 漂移而来，HEAD 对照臂同 8 = 既有未决）。
- verify-visual：早先简报 83/14 已过期，**当日 HEAD 两臂同 50 FAIL（0 新增）**，归因一律以当日 HEAD 对照为准。

## §41 第 41 轮（2026-09-25）：卡首屏遮蔽 —— 足控天堂「切回从夜晚跳回白天」· `docs/47`

**现象**（用户实锤）：「在足控天堂里，切换回去的时候，感觉要渲染很多次，每次切回去都要从夜晚切回到白天模式」。
**定位**（全部真机/夹具数字，详见 `C:\deepseek harness\docs\47-足控天堂主题闪烁-定位实录.md`）：
- **不是"没存住"**：同会话另两个命名空间（`k30222287-337ee` / `kd00119e3-337ed`）的种子注入成功**且在增长**
  ⇒ `muvKvP` 持久层 + 种子 + 垫片这条链是通的 ⇒ 判定为**闪烁**（甲/乙两读法里的乙），**原假设"卡写 night 覆盖 day"证否**。
- 根因三段：① 卡文档 `<body data-theme="night">` 是**写死的**默认值；② 已保存主题**只在卡的 `DOMContentLoaded` 里落**；
  ③ 那一刻被**卡自己注册的 TavernHelper 脚本链**（35 条 CDN 请求，最慢 `phone-ctn.pages.dev/index.js` 2.1–5.2s）拖到
  `domContentLoadedEventEnd` **4.3–6.8s**；而我们的产物**每次切回都要重建这份文档**（`applyDecoratedHtml` 整条替换）。
- 夹具（真卡 srcdoc 原文 + 种子改成 `day`）：**闪烁窗口 2.1–3.0 秒**（冷/热缓存两轮）；遮蔽对照臂**显形时主题已是 `day`**。
- **"保活 iframe 节点"实证不可行**：沙箱 iframe 一旦 `appendChild`/`insertBefore`/detach 重插，**帧内 `__alive` 重新从 1 开始**
  且重新报 `parse`+`dcl` ⇒ 搬移即重建（`_scratch/fixture-iframe-move.mjs`）。

**改动**（客户端 5 处，`lib/client.js`）：
1. 垫片新增第 0 段：`DOMContentLoaded` + `setTimeout(…,0)` → `post({__muvReady:1})`。**必须排后报**（垫片是最早的脚本，
   它的监听器排在卡的前面；timeout 回调排在全部监听器之后 ⇒ 报出去时卡的主题已落好）。
2. `muvCardShow(frame)`（写 `data-muv-shown="1"`，幂等）+ `ensureCardMask()`（捕获期 `load` 兜底 + `MUV_CARD_MASK_MAX=15000` 绝对上限）。
3. 宿主样式：`iframe.muv-iframe[data-muv-mask]{opacity:0;transition:opacity .12s linear}` + `[data-muv-shown="1"]{opacity:1}`。
4. `cardHtmlIframe()`：`body`/`html` 上有 `data-theme=` 才打 `data-muv-mask="1"` ⇒ **波及面收窄**（ERA 状态栏、苍玄界封面照旧不遮蔽）。
5. `onMuvCardCompatMessage()`：认 `__muvReady`（只认 source 确实是我们的卡 iframe）→ 显形后**立即 return**。

**铁律（别改回去）**：遮蔽只能用 `opacity`。帧内高度引导脚本按 `getComputedStyle(el).visibility === "hidden"` 跳过元素
（`client.js:1442`），把宿主 iframe 改成 `visibility:hidden` 会让**帧内所有元素**被判不可见 ⇒ 整卡测成 0 高、高度塌掉。

**验收**：
- `node test-client-render.mjs` → **385 通过 / 0 失败**（exit 0；本项新增 21 条护栏）。
- **护栏能红 9/9**（`_scratch/test-mask-guards-red.mjs`）；其中一条抓出**真缺陷**：遮蔽规则的 CSS 正则第一个匹配
  落在**注释里的示例**上（护栏一直在看注释）⇒ 现在护栏要求"规则在源码里只出现一次"，注释示例也改了。
- **真机 5 条判据全过**（`_scratch/verify-mask-live2.mjs`）：遮蔽窗口存在（`mask=1 shown=null`）→ 显形距主题帧出现 **1992ms**
  （远早于 15s 上限 ⇒ 走 ready 主路）→ 遮蔽期间高度 **900→2438→4749px** 正常收敛 → 切回种子 `{"L:zkt2-theme":"day"}`
  → 除主题帧外只有 1 个 iframe 被遮蔽。
- **生效方式：刷新页面**（客户端插件按请求从磁盘读，不用重启 DSH）。

**残留**：那 2–6 秒变成**空框**（卡的初始化时长本身没变）；**方案 C（hook `document.addEventListener` 让卡的回调提前跑）未做** ——
它能把 2–6 秒也砍掉，但会改变"卡的回调在 TavernHelper/MVU 框架加载完之后才跑"这条语义，必须带开关 + 在四张真卡上验。

## §42 0925-0926：0.3.10 发布 + GitHub 备份（wip 分叉为脱敏版）· `docs/48`

### 42.1 v0.3.10 已上 npm（`chencheng810`）
- `8943db9`（contenteditable 适配：DSH 输入框是 `[contenteditable=true]` 非 textarea，`muvDeliverUserText` 三级选择器全落空静默丢弃 → caret+insertText 追加不清空+InputEvent+60ms 发送）+ `1f764e7`（版本 bump/CHANGELOG/triggerSlash `/send` 剥尾 + 门禁夹具）。构建 `2026-09-25a`。
- 真机冒烟 7 判据全 PASS（`_scratch/_probe-smoke7.mjs`，合成 MessageEvent source=contentWindow 绕 iframe CDP 上下文丢失）。

### 42.2 GitHub 备份现状（github.com/chen731215-dev/*，token 已验证 `chen731215-dev`）
- `master` = `47244dc`（本地已 fetch ff 对齐，远端曾多 1 个 §16 快照 docs 提交）。
- `wip/card-interactive`：**远端是 API 管线脱敏版 `e3134c52`，本地原版 `1f764e73`——历史不同构，别直接 pull**。
  原因：29 个新提交全带 `.work-census-rows.json`（10.8MB）内含 **11 个历史真实 token**（2 ghp_ + 9 npm_），push protection 对 git push 与 API 建 blob 都 422（仓库公开）。上传管线对该文件原地 REDACTED（脱敏 blob `1095c692→9ce306f4`，断言+远端终验无残留）；**本地仓库未动，本地历史仍含真 token**。29 条 SHA 映射全表见 `docs/48` §3.4。
- tavern-v2（main `8ce705a` / wip `675075d` / card-skill-compiler `99c2e54`）与 muv-table（master `9cd3a3a` / wip `30461e7`）直推成功，与本地一致。

### 42.3 工具链铁律（本轮实测）
- 推 git：`env -u http_proxy … git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1`（**HTTP/2 本机必 OOM malloc 500MB，与仓库大小无关**；全局 proxy 7897=Clash 常没开；github.com 直连间歇 SNI 阻断，**api.github.com 直连基本一直活**）。
- API 上传管线：`_scratch/_ghapi-push-muvengine-v2.mjs`（单进程 `cat-file --batch` 读 blob；逐 blob spawn 244 次会卡死；commit 时区必须 RFC3339 带冒号 `+08:00`）。同步 muv-engine 时改 TIP 常量重跑即可。
- 本地历史 11 个旧 token + 本轮聊天明文 token，**建议全部轮换**（`docs/48` §4.2）。

## §43 第 43 轮（2026-09-26）：状态栏行动选项点击无反应根治 + 一次点击插两份 · `docs/49`

承接 48 号文档的遗留项 1（"contenteditable 修复真机复测：用一张带选项的卡点选项"）——真机复测
结果：**还是没反应**，而且顺手抓出第二个缺陷。

### 43.1 根因一：点击委托漏了 `.muv-sb-opt`（`6d748b5`，构建 `2026-09-26c`）

- `status-cascade.js` 的 `renderOptions()` 产出 `<button class="muv-sb-opt">` —— 就是
  `<Status_block>` 里那份「行动选项」（涩涩提瓦特等全部走这条）；而 `client.js` 里
  `exports.apply` 的全局点击委托只匹配 `.muv-choice-btn, .tavern-option-btn`。
  按钮**可见、有 hover、零处理器** ⇒ 点击静默无反应。
- 0.3.10 修的是「卡 iframe → 宿主 `muvDeliverUserText`」那一环；**宿主自己**这条级联状态栏
  按钮路径当时没被覆盖，所以用户看到的仍然是"修了还是没反应"。
- 修法：委托选择器补 `.muv-sb-opt`；删掉委托里那套旧 textarea-only 覆盖逻辑（DSH 真机 0 个
  textarea，必然落空，且绕过 contenteditable 追加 / InputEvent / 真发送钮），三条入口统一走
  `muvDeliverUserText(text, 'send')`。字母前缀**只在确实有徽标时剥**（`.muv-choice-letter`
  子元素 / `data-opt-letter`）—— 旧的无条件 `/^[A-D]\s*/` 会把选项原文 `A new day…` 吃掉首字母。

### 43.2 根因二：一次点击把选项文本插**两份**（0.3.10 遗留，被本轮修复放大）

- 真机时间线（`_probe-sbopt8.mjs` 在输入框上挂 MutationObserver）：点击后 52 字的选项原文在
  框里变成 104 字。
- 机理：`execCommand('insertText')` **自己就会派发原生 `input`**，宿主（React 受控编辑器）
  据此更新模型；随后我们又无条件补了一个带 `data` 的合成 `InputEvent`，宿主把它当成
  "再插一次"的指令。
- 修法：插入期间监听 `input`，**原生事件已到就不再补**合成事件（真的一个都没到才补，保留
  React 感知兜底）；另把兜底 `appendChild` 的判据改成看**文本长度是否增长**，而不是
  `execCommand` 的返回值（真机存在"插入成功却返回 false"）。

### 43.3 门禁（`verify-user-send.mjs` 23/0，三条红臂各自精确变红）

- 场景④ 真实 `.muv-sb-opt` 点击：投递 / 追加不覆盖 / InputEvent / **原文只出现一次** /
  字母剥离不误伤 `A new day…` / 旧两类按钮不回归 / 非选项元素零副作用。
- 场景⑤ `execCommand` 插入却返回 false 时仍只插一份。
- 场景⑥ **受控编辑器仿真**（合成 InputEvent 会让宿主再插一次）—— 真机两份的离线复现位。
- 红臂：`--break=sb-opt-selector`（13 通过 10 失败）、`--break=ce-append-fallback`、
  `--break=ce-synthetic-input`。
- 回归：`test-client-render` 385/0、`test-status-cascade` 84/0、`verify-choices-dom` 全过、
  `verify-frame-height` 全过；`verify-frame-ratchet` **8 项失败 = 改动前 HEAD 实测同值**
  （对照实测，非本轮漂移；`docs/48` 记的 10/7 是更早的树状态）。

### 43.4 真机验收（零污染口径，可复用）

- `_scratch/_probe-sbopt8.mjs`：**全程真鼠标**（`Input.dispatchMouseEvent`）—— 真点侧栏分组行
  → 逐个真点会话行直到 DOM 里出现 `.muv-sb-opt` → 真点第 1 个选项的中心坐标。V1–V9 全 PASS：
  构建戳 / 原文进框 / 原生 input / 桥日志两条 / 发送钮真实 click / `POST api/session/prompt` /
  框里只有**一份**。
- ★ 新增零污染口径：`--block-post` 用 `Fetch.enable` + `Fetch.failRequest` 把 `session/prompt`
  拦在浏览器里 —— 全链路照跑、**服务器收不到**，不往用户会话里塞测试消息。
  副作用提示：发送被拦后宿主会把草稿**还原**进输入框（`+172ms` 那条 mutation 就是它），
  所以"点了之后框里应该留字"这类断言必须配 `--block-post` 才成立。
- ★ 排障经验：宿主页里 patch `document.execCommand` / `document.createTextNode` / `console.info`
  **都拦不到插件的调用**（插件在自己的执行世界里），主世界探针只能看 DOM 结果 —— 指望
  "hook 一下就定位"会白跑；改用"改一处 → 看 DOM 结果"的二分法最快。

### 43.5 发布

- npm `dsh-muv-engine@0.3.11`（`chencheng810`）；GitHub `wip/card-interactive` 用 API 管线
  重传脱敏版（`_scratch/_ghapi-push-muvengine-v3.mjs`，TIP 常量 + PATCH ref）。
