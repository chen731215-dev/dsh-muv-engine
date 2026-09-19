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

## 7. 凭据

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
