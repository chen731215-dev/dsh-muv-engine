# `tools/verify/` 的门禁：**各自依赖什么**（可跑性清单）

> **一句话结论**：这批门禁里有一批**依赖只存在于作者机器上的样本**（特定角色卡 / 卡集 / 真实模型回复 / Edge）。
> 换机器跑不动时**一律记「未验」**（`exit 2`）—— **不要把"没跑"读成"通过"**。
> 本清单的目的就是让接手人一眼知道：**这些"绿"是在什么前提下绿的。**

---

## 1. 缺样本时的退出码约定（task-21 起生效）

| 退出码 | 含义 | 该怎么读 |
|---|---|---|
| `0` | **跑完了**且没有失败断言 | 通过 |
| `1` | **跑完了**但有失败断言 | 真红灯（脚本自己判出来的） |
| `2` | **未验**：缺样本 / 环境前置不足 / 跑不起来 | **不是通过**，也区别于"失败"——它意味着**这次根本没得到结论** |

实现：`tools/verify/verify-unverified.mjs` 的 `unverified('<缺哪一项>', ['<怎么补上>'])`。

★ 为什么不能只是"打印一句 SKIP 然后 exit 0"：**出声还不够** —— 退出码 0 会让它在批处理、
CI、以及只看退出码的人眼里**与通过一模一样**。这正是「没跑被读成通过」的口子。

---

## 2. 逐脚本依赖（只列**实测**过的；未列出的 = 不需要真卡，自造夹具）

| 脚本 | 依赖 | 缺了会怎样 |
|---|---|---|
| `verify-frame-height.mjs` | `MUV_CARD`（真卡）、`MUV_EDGE` | **`未验` + exit 2**（本卡修的就是它原先 exit 0 的情形） |
| `verify-card-compat.mjs` | `MUV_CARD_DIR` + `MUV_CARD_FILE`（默认 `_足控天堂2.png`） | 抛错 ⇒ exit 1 |
| `verify-era-bridge.mjs` | 同上 | 抛错 ⇒ exit 1 |
| `verify-card-width.mjs` | `MUV_CARD_DIR` 里**至少 5 份**真卡界面 | 断言 FAIL ⇒ exit 1 |
| `verify-frame-gap.mjs` | 同上（**≥5 份**） | `提前终止` ⇒ exit 1 |
| `verify-frame-size.mjs` | 同上（**≥5 份**，且要有卡被重写） | 断言 FAIL ⇒ exit 1 |
| `verify-frame-ratchet.mjs` | 硬编码 `_足控天堂2.png`（**≥3 份**围栏文档） | 自带「防空矩阵假绿」守卫 FAIL ⇒ exit 1 |
| `verify-fence-residue.mjs` | `MUV_CARD`（卡 JSON）**且** `MUV_REAL_REPLY`（真实模型回复） | 抛错 ⇒ exit 1 |
| `verify-status-placeholder-era.mjs` | 需要那张**已删除**的「ERA 状态栏」卡 | 记**未验**（卡片已不在，属历史） |
| `verify-host-parity.mjs` | `MUV_BEFORE_SRC`（或 `MUV_BEFORE_REV`）**+ 真卡** | 缺对照臂 ⇒ 抛错 exit 1；缺卡 ⇒ 提前终止 |

### ★ 两个必须知道的坑

1. **硬编码卡名 vs `MUV_CARD`**：`verify-frame-height.mjs` / `verify-card-compat.mjs` /
   `verify-era-bridge.mjs` / `verify-frame-ratchet.mjs` 都在**自己找固定的卡文件名**
   （`_足控天堂2.png`），而 `verify-fence-residue.mjs` 用的是 `MUV_CARD`。
   ⇒ **换机器时先看这两个环境变量名对不对得上**：`MUV_CARD`（单卡）与 `MUV_CARD_DIR`（卡目录，另配 `MUV_CARD_FILE`）。
2. **有 5 个脚本压根不读 `MUV_EDGE`**：它们把 Edge 路径写成**候选数组 + `fs.existsSync` 取第一个存在者**
   （`verify-choices-dom.mjs` / `verify-header-fold.mjs` / `verify-media-dom.mjs` /
   `verify-tags-dom.mjs` / `verify-varblocks-dom.mjs`）。
   ⇒ 在**没装 Edge 的机器**上它们拿到 `undefined`；而它们的"缺 Edge"分支目前是 `exit(fail ? 1 : 0)`，
   `fail=0` 时**仍是 0** ⇒ **同族缺陷、尚未修**（本卡只修了 `verify-frame-height`）。
   ⇒ 换机器时请把这几条**记为未验**，别把它的 0 当通过。

---

## 3. 跑这批门禁时的操作口径（实测踩出来的）

```
1) 必须设 MUV_EDGE（无头 Edge 的绝对路径），否则大批脚本跑不起来。
2) ★ 输出要**重定向到文件**：`msedge --headless=new` 会再 fork，孙进程的 stdout **不进 PowerShell 管道**
   ⇒ 表现为"没报错、也没输出"（看起来像没跑，其实跑了）。
3) 真卡相关：MUV_CARD / MUV_CARD_DIR / MUV_CARD_FILE、MUV_REAL_REPLY 按上表给齐；
   给不齐就**接受它记未验**，不要为了"让它绿"去放松断言。
4) 默认 `npm test` **不跑这批**（跑的是 `tests/`）。它们是 `--all` 才进去的真机门禁。
```

---

## 4. 纪律

- **不许**为了让门禁"在别人机器上也绿"而**放松任何既有断言** —— 那会把真信号一起松掉。
- 缺样本时**只许**改"退出码与措辞"，**不许**改判据。
- 新增真机门禁时，请把它加进本表（依赖什么、缺了会怎样）。

---

## 5. 已知边界：**样本路径硬编码** 与 **卡版本漂移**（实测记录）

> 这三条都是 **Lead 用真卡实跑**量到的。写法一律是「**已知边界 + 换机器/卡版本漂移时一律记未验**」——
> **不要**为了让门禁在别的机器上跑得动而放松断言（那会把真信号一起松掉）。

### 5.1 ★ 硬编码绝对路径：`verify-frame-ratchet.mjs` 完全不看 `MUV_CARD`

```
tools/verify/verify-frame-ratchet.mjs:46
  const CARD = 'C:\MySpecialFolder\SillyTavern\data\default-user\characters\_足控天堂2.png'
⇒ **完全不读 MUV_CARD / MUV_CARD_DIR**（同族：card-compat / era-bridge 各自拼那张卡的文件名）
⇒ 换机器必然拿不到样本 ⇒ **载荷为空** ⇒ 读数退化（三档"高度"退化成三个帧宽 600/900/1500）
★ 实测对照：把卡按该路径放好之后，**载荷确实被读到** —— 会多出一条 FAIL
   （`「真卡·正文美化（选开）」能缩到内容量级（<400）`）
   ⇒ 说明"三档退化"确实是**缺样本**造成的，不是产品信号。
```

### 5.2 ★ 对照臂不自洽：`frame-ratchet` 的对抗组数字**不可解读**

```
即便样本到位，这条仍失败：
  「对抗·100vh无偏移(对照)」三档收敛（极差 900px）  600 / 900 / 1500
⇒ **"对照"自己都不收敛** ⇒ 该组对抗数字**没有可解读的基线**。
⇒ 这是**门禁自身的问题**（不是产品信号）。故 `verify-frame-ratchet` 记【**未验**】，
   理由 =「缺样本 **+** 门禁自身对照臂不自洽」。
```

### 5.3 卡版本漂移：`verify-status-placeholder-era.mjs` 硬断言脚本名与长度

```
它硬断言卡里有脚本名「ERA 状态栏」且长 **210219**；
而现存那张卡里叫「状态栏（电脑端选用）」、长 **213428** ⇒ **卡更新过**。
⇒ 门禁仍报"卡里找不到《ERA 状态栏》" —— 那是**卡版本漂移**，不是产品缺陷。
⇒ 记【未验】；要么按新卡名/新长度更新该脚本，要么把这张卡恢复成脚本期望的版本。
★ 同族的还有 `verify-frame-ratchet.mjs` 硬编码 `_足控天堂2.png`（见 5.1）。
```

**推断口径**：本节三条均为 Lead 真机实测 + 我按读码核对；凡"因此记未验"的结论，
一律标为**按代码与实测推导**，不冒充"在别的机器上复现过"。
