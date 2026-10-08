#!/usr/bin/env node
/**
 * `dsh-muv-engine` 的 **client.js 拼装器 / 新鲜度判据**（S2 walking skeleton）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★ 读之前先记住这一条（最容易把整套设计误读的地方）：
 *
 *   **「逐字节」是【分片 ↔ 产物】之间，不是「产物 ↔ 历史」。**
 *
 *      拼装(分片) === lib/client.js          ← **恒成立、永远有效**，与"是否搬过函数"无关
 *
 *   而"把函数从分片 A 挪到分片 B"会改变分片顺序 ⇒ **产物字节必然变**。
 *   ⇒ 若把"逐字节"误读成"产物不许变"，第③步（批量搬）会被**永久锁死**。
 *   ⇒ 本工具保证的是"产物 == 它的分片"，不是"产物 == 某个历史版本"。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 唯一真相源 ────────────────────────────────────────────────────────────
 *   · **分片是源**（`src/client/part-NN.js`），**`lib/client.js` 是派生物**。
 *   · 改产物必须"先改分片、再跑本工具重新生成"。**不许直接编辑产物** ——
 *     直接改产物会让 `--check` 报红（这是**故意**的：产物与分片不一致时，
 *     仓内数十个按源码文本读产物的门禁会"绿着测错东西"）。
 *     ⚠️ 这条**不能**靠产物内的生成标记来声明：加任何头注释都会改变字节、
 *       破坏逐字节相等。所以只能靠：① 本文件的注释与报错文案；② `AGENTS.md`；
 *       ③ `package.json` 里存在 `build:client` / `check:client-freshness` 两个脚本。
 *   · 分片**不进发布包**（`package.json.files` 不含 `src`）⇒ 发布面与拆分之前逐字节相同，
 *     `exports["./client"]` 仍指 `lib/client.js` ⇒ 加载契约不变。
 *
 * ── 分片**不能**独立解析（这一点先前的表述是错的，已作废）────────────────
 * 分片是 `factory` 体 / 启动 IIFE 体里的**片段** ⇒ 不能按 ESM 解析
 * （`check-syntax` 因此**不扫 `src/`**，我们也不改它的扫描面）。
 * ★ 曾经想用 `new Function('{'.repeat(depth) + 分片 + '}'.repeat(depth))` 来"放回嵌套深度解析"，
 *   **实测不可行**：首片含 `window.__ModuleLoader__.load({` 与 `(function () {`，
 *   它的闭合需要 `})()` —— 补花括号补不平圆括号，12 片里 10 片解析失败。
 *   ⇒ 该口径**不可满足**，已换成"**边界合法性**"（见 tests/test-client-parts.mjs 的 boundaryReport）：
 *     ① 边界不许劈开任何 token（切在字符串/模板/正则/注释中间）；
 *     ② 边界必须落在语句之间（上一 token 是 `;` 或 `}`）；
 *     ③ 每片非空。
 *   "合并后整体可解析"另有独立判据：`check-syntax` 按 ESM 解析产物。
 * 清单里仍记着每片两端的 `depthAtStart` / `depthAtEnd`（嵌套深度）—— 供边界自检与人工审阅用。
 *
 * 用法：
 *   node tools/build-client.mjs            # 用分片重新生成 lib/client.js
 *   node tools/build-client.mjs --check     # 只校验，不写盘（CI 用）
 *   node tools/build-client.mjs --list      # 列分片与清单
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tokenize } from './client-scope.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PARTS_DIR = path.join(REPO, 'src', 'client')
export const MANIFEST_PATH = path.join(PARTS_DIR, 'MANIFEST.json')
export const ARTIFACT_PATH = path.join(REPO, 'lib', 'client.js')

/** ★ 分片数的预期值 —— 加/减分片必须显式改这里（防"悄悄多切一片"逃过判据）。 */
export const EXPECTED_PARTS = 19

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

/**
 * 只在**对比清单**时用的行尾归一化。
 *
 * ★ 为什么"清单对比"要归一化、而"分片 ↔ 产物"对比**不**归一化：
 *   · 清单记的是**内容**（sha256 / 字节数）；而"内容"在版本控制语义里就是 **blob（LF）**。
 *     本仓 `.gitattributes` 已把 `lib/client.js` 与 `src/client/**` 都钉成 LF，但
 *     **别人机器上的一次普通 `git clone` 可能在 attribute 生效前就检出了 CRLF**
 *     （本会话反复踩过这一类）⇒ 清单对比若按原始字节较真，会在**默认 clone** 上假红。
 *   · "分片 ↔ 产物"**必须**逐字节、**不许**归一化 —— 归一化就不是逐字节了，
 *     而那正是这条判据存在的意义。两侧同形态时它天然成立（`.gitattributes` 负责同形态）。
 *   ⇒ 一句话：**清单比"内容"，产物比"字节"。**
 */
const lf = (s) => String(s).replace(/\r\n/g, '\n')

/**
 * **拼装**（纯函数）：分片文本首尾**直接相接**。
 * 约定：第 1..N-1 片自带行尾；最后一片不带（与产物的"无尾随换行"一致）。
 * ⇒ 不需要任何分隔符逻辑，`join('')` 就是全部。
 */
export function assemble(partTexts) {
  return partTexts.join('')
}

/** 取前 `n` 个字符的上下文（用于报"差异在哪"，只说红不说哪等于没红）。 */
const ctx = (s, at, n) => JSON.stringify(s.slice(Math.max(0, at - n), at + n))

/**
 * ★ **判据本体（纯函数）** —— 不碰文件系统 ⇒ 反证可以喂**合成夹具**，
 * 不必真改仓库文件、也不污染工作树。
 *
 * ★ 它**重算**一切，不信任清单里的声明：清单只是"上一次生成时的记录"，
 *   改了分片却忘了更新清单（或反过来）都必须被抓到。
 *
 * @param {object} o
 * @param {Array<{path:string, text:string}>} o.parts   按清单顺序的分片**实际内容**
 * @param {string} o.artifact                            产物**实际内容**
 * @param {object} o.manifest                            清单（只用于比对，不作依据）
 * @returns {{ok:boolean, problems:string[], firstDiff:object|null, stats:object}}
 */
export function freshnessReport({ parts, artifact, manifest }) {
  const problems = []
  const firstDiff = { offset: null, artifactCtx: null, partsCtx: null }

  // ① 清单自身与"实际分片"是否一致（重算 bytes/sha256/lines）
  const declared = Array.isArray(manifest && manifest.parts) ? manifest.parts : []
  if (parts.length !== declared.length) {
    problems.push('分片数不符：实际 ' + parts.length + ' ≠ 清单 ' + declared.length)
  }
  if (declared.length !== EXPECTED_PARTS) {
    problems.push('分片数 = ' + declared.length + ' ≠ 期望 ' + EXPECTED_PARTS
      + ' ⇒ **若这是有意的**（本段搬入/移除了模块片），请显式修改 `tools/build-client.mjs` 里的 '
      + '`EXPECTED_PARTS` 常量并说明理由；**若你本想保持片数不变**，请检查是否漏写/多写了分片文件。'
      + '（本仓口径：不允许静默改变分片数 —— 这个常量就是那道必须显式跨过的小门。）')
  }
  for (let i = 0; i < Math.min(parts.length, declared.length); i++) {
    const p = parts[i], d = declared[i]
    if (p.path !== d.path) { problems.push('第 ' + (i + 1) + ' 片路径不符：' + p.path + ' ≠ ' + d.path); continue }
    // ★ 清单比"内容"（归一化后），见 lf 的长注释：默认 clone 可能是 CRLF，按原始字节较真会假红
    const norm = lf(p.text)
    const bytes = Buffer.byteLength(norm, 'utf8')
    const sha = sha256(norm)
    if (bytes !== d.bytes) problems.push(p.path + ' 字节数不符：实际 ' + bytes + ' ≠ 清单 ' + d.bytes)
    if (sha !== d.sha256) problems.push(p.path + ' sha256 不符（清单声明的是上一次生成时的内容）')
  }

  // ①b 分片**连续性**（清单内部自洽 + 与产物行数口径对齐）。
  //    ★ 为什么必须有：`depthAtStart/depthAtEnd` 与 `startLine/endLine` 若没有判据复查，
  //      它们就是"写给人看的字段"（本仓明令禁止）。这里让它们各自被一条断言盯着：
  //      · 逐片首尾相接（`endLine + 1 === 下一片 startLine`）⇒"分片覆盖了整份产物"不是假象；
  //      · 边界深度连续（`depthAtEnd === 下一片 depthAtStart`）⇒ 同一处的深度只有一个说法；
  //      · 行数之和 == 产物 `split('\n')` 的长度 ⇒ 把清单口径与产物对齐
  //        （产物**末行无尾随换行** ⇒ 行数比 `\n` 个数多 1，见 MANIFEST.json 的 linesNote）。
  for (let i = 0; i + 1 < declared.length; i++) {
    const a = declared[i], b = declared[i + 1]
    if (typeof a.endLine === 'number' && typeof b.startLine === 'number' && a.endLine + 1 !== b.startLine) {
      problems.push('分片不连续：' + a.path + ' 结束于第 ' + a.endLine + ' 行，下一片 ' + b.path + ' 却从第 ' + b.startLine + ' 行开始')
    }
    if (typeof a.depthAtEnd === 'number' && typeof b.depthAtStart === 'number' && a.depthAtEnd !== b.depthAtStart) {
      problems.push('边界深度不连续：' + a.path + ' 结束深度 ' + a.depthAtEnd + ' ≠ ' + b.path + ' 起始深度 ' + b.depthAtStart)
    }
  }
  if (declared.length && declared.every((d) => typeof d.lines === 'number')) {
    const sumLines = declared.reduce((s, d) => s + d.lines, 0)
    const artLines = artifact.split('\n').length
    if (sumLines !== artLines) {
      problems.push('清单 lines 之和 ' + sumLines + " ≠ 产物 split('\\n') 长度 " + artLines
        + '（产物末行无尾随换行 ⇒ 行数比 \\n 个数多 1，见 MANIFEST 的 linesNote）')
    }
  }

  // ② 拼装（实际分片）== 产物（实际产物）—— 逐字节，**不归一化**（归一化就不是逐字节了）
  const built = assemble(parts.map((p) => p.text))
  const builtBuf = Buffer.from(built, 'utf8')
  const artBuf = Buffer.from(artifact, 'utf8')
  const byteSum = parts.reduce((s, p) => s + Buffer.byteLength(p.text, 'utf8'), 0)
  if (byteSum !== artBuf.length) {
    problems.push('各分片字节数之和 ' + byteSum + ' ≠ 产物字节数 ' + artBuf.length + '（拼装吞了或漏了）')
  }
  if (!builtBuf.equals(artBuf)) {
    let at = 0
    const min = Math.min(builtBuf.length, artBuf.length)
    while (at < min && builtBuf[at] === artBuf[at]) at++
    firstDiff.offset = at
    firstDiff.artifactCtx = ctx(artifact, at, 40)
    firstDiff.partsCtx = ctx(built, at, 40)
    problems.push('拼装结果与产物**不逐字节相等**：首个差异在第 ' + at + ' 字节'
      + '（产物 ' + artBuf.length + ' 字节 / 拼装 ' + builtBuf.length + ' 字节）\n'
      + '        产物侧: ' + firstDiff.artifactCtx + '\n'
      + '        拼装侧: ' + firstDiff.partsCtx)
  }

  // ③ ★ **form-free 不变式**：`sha256(归一化后的 concat(分片)) == 清单里记的产物 sha256`。
  //
  //   为什么单独立这一条（它与 ② 的"逐字节"不重复）：
  //     · ② 比的是**工作树两侧的原始字节** ⇒ **依赖检出形态**（要靠 `.gitattributes` 把两侧钉同形态）；
  //     · ③ 比的是**归一化后的内容摘要** ⇒ **与检出形态无关**，而且它把"清单里那句
  //       `artifact.sha256` 到底是不是真的"也验了 —— 否则那是一个**没人复查的声明**。
  //     · 两边都留：③ 是 form-free 的"内容指纹"，② 是对开发者更严的"逐字节"。
  //   ★ 这条原先只靠**人工每批手算**（Lead 转述审核方），现在进 `freshnessReport` ⇒
  //     本地 `npm test` 与 CI 的 `--check` **每批都会跑**。
  //   `manifest.artifact.sha256` 就是按归一化内容记的（见 loadFromDisk 的生成端），所以这里比得上。
  const builtSha = sha256(lf(built))
  const declaredArtSha = manifest && manifest.artifact && manifest.artifact.sha256
  if (typeof declaredArtSha === 'string' && declaredArtSha) {
    if (builtSha !== declaredArtSha) {
      problems.push('★ form-free 不变式不成立：sha256(归一化 concat(分片)) = ' + builtSha.slice(0, 16)
        + '… ≠ 清单里的产物 sha256 = ' + declaredArtSha.slice(0, 16) + '…'
        + '（清单那句 `artifact.sha256` 是个**声明**，这条断言是它的唯一复查）')
    }
  } else {
    problems.push('清单缺少 `artifact.sha256` ⇒ form-free 不变式无从复核（它是那条不变式的右端）')
  }

  return {
    ok: problems.length === 0,
    problems,
    firstDiff: firstDiff.offset === null ? null : firstDiff,
    stats: {
      parts: parts.length, byteSum, artifactBytes: artBuf.length,
      byteExact: builtBuf.equals(artBuf), builtSha, declaredArtSha: declaredArtSha || null,
    },
  }
}

/** 从盘上读齐三样东西（分片按清单顺序）。 */
export function loadFromDisk() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const parts = (manifest.parts || []).map((d) => ({
    path: d.path,
    text: fs.readFileSync(path.join(REPO, d.path), 'utf8'),
  }))
  const artifact = fs.readFileSync(ARTIFACT_PATH, 'utf8')
  return { parts, artifact, manifest }
}

/** 给失败者一条**可执行**的下一步（只说红、不说怎么办，等于把活推给下一个人）。 */
export const FIX_HINT = [
  '  下一步（二选一，看你改的是哪一侧）：',
  '    · 你改的是【产物】lib/client.js  → 别改产物：把改动挪回 src/client/part-NN.js，然后跑 `node tools/build-client.mjs`',
  '    · 你改的是【分片】src/client/*   → 跑 `node tools/build-client.mjs` 重新生成产物（分片才是源）',
].join('\n')

/**
 * ★ **刷新清单**（纯函数）：按"当前分片内容"重算每片的 bytes/sha256/lines，并重算产物的 bytes/sha256。
 *
 * 为什么它必须存在、且必须被断言盯着：生成路径若只重写产物、不刷新清单，那么
 * "改了分片 → 重新生成 → 清单里的 artifact.sha256 还是旧的" ⇒ form-free 不变式立刻报红，
 * 而使用者会以为是**产物**错了（其实错的是清单）。
 * 口径与生成端一致：**按归一化内容**记 bytes/sha256（见 `lf` 的长注释）。
 * @param {object} o
 * @param {Array<{path:string, text:string}>} o.parts
 * @param {string} o.built 拼装结果（= 要落盘的产物内容）
 * @param {object} o.manifest 现有清单（返回**新的**对象，不改入参）
 */
export function refreshedManifest({ parts, built, manifest }) {
  const out = JSON.parse(JSON.stringify(manifest))
  const byPath = new Map(parts.map((p) => [p.path, p.text]))
  for (const decl of out.parts || []) {
    const t = byPath.get(decl.path)
    if (typeof t !== 'string') continue
    const norm = lf(t)
    decl.bytes = Buffer.byteLength(norm, 'utf8')
    decl.sha256 = sha256(norm)
    // ★ 行数口径：分片文件**以换行结尾**（除最后一片），`split('\n')` 会多出一个空尾元素
    //   ⇒ 必须减 1。否则"lines 之和 == 产物行数"这条断言整体偏大（实测 13 片偏 +12），
    //   而且会让生成**不幂等**（每次生成都改 lines ⇒ 下次 --check 仍红）。
    decl.lines = t.endsWith('\n') ? t.split('\n').length - 1 : t.split('\n').length
  }
  out.artifact.bytes = Buffer.byteLength(built, 'utf8')
  out.artifact.sha256 = sha256(lf(built))
  return out
}

/**
 * ★ **层级纯度**判据（S2 ③ 的"搬迁前置检查"）。
 *
 * 为什么必须有一条：把函数搬到**不同嵌套深度**的模块里会**改变闭包** ——
 * 深度 d 的代码能看到深度 ≥ d 的外层绑定；跨层搬 = 可见性变化 = 可能直接炸、
 * 也可能静默改变行为（更糟）。段1 搬的三个都在工厂体（深度 2）；段2/3 的候选散在深度 3/4，
 * **不能混搬**。
 *
 * 判据：每个 `mod-*.js` 模块内部的具名函数声明必须落在**同一个绝对深度**上
 * （绝对深度 = 清单里该模块的 `depthAtStart` + 它在模块内的相对深度）。
 * 它不检查"意图"，只检查一个**结构事实** —— 而跨层正是最危险的那类结构事实。
 *
 * @param {object} o
 * @param {Array<{path:string, text:string}>} o.parts
 * @param {object} o.manifest 提供每个模块的 `depthAtStart`
 * @returns {{ok:boolean, problems:string[], modules:Array}}
 */
export function moduleLevelReport({ parts, manifest }) {
  const declOf = new Map(((manifest && manifest.parts) || []).map((d) => [d.path, d]))
  const problems = []
  const modules = []
  for (const p of parts) {
    if (!/(^|\/)mod-[^/]+\.js$/.test(p.path)) continue
    const decl = declOf.get(p.path)
    const base = decl ? decl.depthAtStart : undefined
    const toks = tokenize(p.text)
    let d = 0
    const found = []
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (t.type === 'punct') { if (t.value === '{') d++; else if (t.value === '}') d--; continue }
      if (t.type === 'ident' && t.value === 'function') {
        const idt = toks[i + 1]
        if (idt && idt.type === 'ident') found.push({ nm: idt.value, rel: d })
      }
    }
    const abs = found.map((f) => (typeof base === 'number' ? base + f.rel : f.rel))
    const layers = [...new Set(abs)]
    modules.push({ path: p.path, base, layers, fns: found.map((f, i) => ({ nm: f.nm, rel: f.rel, abs: abs[i] })) })
    if (layers.length > 1) {
      problems.push(p.path + ' 内部函数**跨层**（绝对深度 ' + layers.join('/') + '）：'
        + found.map((f, i) => f.nm + '@' + abs[i]).join(', ') + ' —— 跨层搬会改变闭包可见性')
    }
    if (found.length === 0) problems.push(p.path + ' 里没有任何具名函数声明（模块片的语义可疑）')
  }
  if (modules.length === 0) problems.push('没有任何 mod-* 模块片（层级纯度无从判定）')
  return { ok: problems.length === 0, problems, modules }
}

/**
 * ★ **模块函数的全局唯一性**判据。
 *
 * 为什么它值得单独一条（它是我给"读父提交做 diff 分类"那条建议的 **git-free 替代**）：
 *   · 搬迁最经典的错法是"**搬了但忘了删原处**" ⇒ 产物里同一个函数出现**两次**。
 *     后定义的会覆盖先定义的，于是行为看起来正常、但另一处调用的是"另一个函数"
 *     —— 这是极难发现的一类（本会话已经栽过一次同族的"看起来接上了其实没接上"）。
 *     "diff 逐行分类"能抓它，但**要读父提交** ⇒ 依赖 git 历史，与 form-free 那条原则有张力；
 *   · 这条**只读当前状态**（产物 + 分片）即可：`mod-*` 模块里声明的每个函数名，
 *     在整个产物里的**声明次数必须恰好 1**。断言更弱，但**依赖更少**，且对每次搬迁都成立。
 *   ★ 注意**不能**要求"全产物函数名唯一"：本仓有 272 处具名函数声明、只有 195 个不同名字
 *     （不同 IIFE 里的同名内部辅助是合法的）⇒ 判据必须**只针对模块片里的函数**。
 *
 * @param {object} o
 * @param {Array<{path:string, text:string}>} o.parts
 * @param {string} o.artifact
 */
export function moduleUniquenessReport({ parts, artifact }) {
  const problems = []
  // 用**词法**数声明（不扫正则）：字符串/注释里的 `function foo(` 不算数
  const declNames = (text) => {
    const toks = tokenize(text)
    const out = []
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
      let j = i + 1
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === '*') j++
      const idt = toks[j]
      if (idt && idt.type === 'ident') out.push(idt.value)
    }
    return out
  }
  const total = new Map()
  for (const nm of declNames(artifact)) total.set(nm, (total.get(nm) || 0) + 1)
  const mods = parts.filter((p) => /(^|\/)mod-[^/]+\.js$/.test(p.path))
  if (mods.length === 0) problems.push('没有任何 mod-* 模块片（唯一性无从判定）')
  for (const p of mods) {
    const names = declNames(p.text)
    if (names.length === 0) problems.push(p.path + ' 里没有具名函数声明')
    for (const nm of names) {
      const c = total.get(nm) || 0
      if (c !== 1) {
        problems.push(p.path + ' 的 `' + nm + '` 在产物里声明了 ' + c + ' 次（应恰好 1 次）'
          + '——搬了就必须删掉原处，否则另一处调用的是"另一个函数"')
      }
    }
  }
  return {
    ok: problems.length === 0, problems,
    moduleFns: mods.map((p) => ({ path: p.path, names: declNames(p.text) })),
  }
}

/**
 * ★ **模块迁移账本**判据（审核方建议的低成本补强）。
 *
 * 它补的是"唯一性判据抓不到的那一类"：函数被**挪到同层别的模块**、或模块里的函数被改动。
 *   唯一性只问"声明了几次"；账本问"**这个函数还在这个模块里吗、文本还是当初那一份吗**"。
 *
 * 形态与 `artifact.sha256` **完全同构**（一个声明 + 它的唯一复查），而且**不读 git**：
 * 账本记的是"迁移完成时，该模块里每个函数的文本 sha256"；判据只复查
 * "现在该模块里这个函数的文本 sha256 是否仍等于账本值"。
 *
 * ★ 账本里**只放被判的东西**（函数名 -> 文本摘要）。来源信息（从哪个 rev 的哪几行搬来）
 *   属于**历史**，写在提交信息/交接文档里 —— 放清单里就会变成"没人复查的字段"（本仓明令禁止）。
 *
 * @param {object} o
 * @param {Array<{path:string, text:string}>} o.parts
 * @param {object} o.manifest 需要 `manifest.modules`
 */
export function moduleLedgerReport({ parts, manifest }) {
  const problems = []
  const ledger = (manifest && manifest.modules) || null
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    return { ok: false, problems: ['清单缺少 `modules` 迁移账本（模块函数的文本摘要无从复查）'], entries: [] }
  }
  const declNames = (text) => {
    const toks = tokenize(text)
    const out = []
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
      let j = i + 1
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === '*') j++
      const idt = toks[j]
      if (idt && idt.type === 'ident') out.push(idt.value)
    }
    return out
  }
  /** 抠出某个具名函数的源码文本（按 token 配平，字符串/注释里的不算）。
   *  ★ 调用方必须传**已归一化**的文本（见下 `normPart`）。 */
  const fnText = (text, nm) => {
    const toks = tokenize(text)
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'ident' || toks[i].value !== 'function') continue
      let j = i + 1
      if (toks[j] && toks[j].type === 'punct' && toks[j].value === '*') j++
      const idt = toks[j]
      if (!idt || idt.type !== 'ident' || idt.value !== nm) continue
      let d = 0, close = -1
      for (let k = j + 1; k < toks.length; k++) {
        const q = toks[k]
        if (q.type !== 'punct') continue
        if (q.value === '{') d++
        else if (q.value === '}') { d--; if (d === 0) { close = k; break } }
      }
      if (close < 0) return null
      return text.slice(toks[i].start, toks[close].end)
    }
    return null
  }
  const entries = []
  for (const [modPath, spec] of Object.entries(ledger)) {
    const part = parts.find((p) => p.path === modPath)
    if (!part) { problems.push('账本里的模块片不存在：' + modPath); continue }
    // ★★ **入口先归一化，且让 token 与切片来自同一份文本**。
    //   为什么必须在**提取之前**归一化，而不是提取完再 lf()：
    //   实测（CRLF 形态）——在 CRLF 文本上做 token 提取，`function` 关键字的 `start` 会**偏一个字符**
    //   （提取结果以空格开头），于是切出来的片段两端各错一位、长度也变了；
    //   这时候**再 `lf()` 也修不回来**（长度已错），账本必然报"摘要不符"。
    //   ⇒ 与 `tools/client-scope.mjs` 里 `lf` 的长注释是同一条规矩：
    //     "喂进来的文本"与"拿来切片的文本"必须是同一份。我先前只归一化了**哈希输入**，
    //     没归一化**提取输入** —— 这正是那条规矩在**消费者**身上被违反的形态。
    const normPart = lf(part.text)
    const declared = declNames(normPart)
    const fns = (spec && spec.functions) || {}
    const names = Object.keys(fns)
    if (names.length === 0) problems.push('账本条目 ' + modPath + ' 里没有函数（无从复查）')
    for (const nm of names) {
      if (!declared.includes(nm)) {
        problems.push(modPath + ' 里**没有** `' + nm + '`（账本说它在这里）——'
          + '多半是被挪到了别的模块，或搬迁时漏了它')
        continue
      }
      const got = sha256(lf(fnText(normPart, nm) || ''))
      if (got !== fns[nm]) {
        problems.push(modPath + ' 的 `' + nm + '` 文本摘要与账本不符：按**当前内容**算出 ' + got.slice(0, 16) + '…，'
          + '账本记的是 ' + String(fns[nm]).slice(0, 16) + '… ⇒ 要么你改动了它（那么请同步账本），'
          + '要么它被别的东西顶替了')
      }
    }
    entries.push({ path: modPath, declared: declared.length, ledgered: names.length })
  }
  return { ok: problems.length === 0, problems, entries }
}

/**
 * ★★ **P1 + P2**：模块集合的「声明清单 + 非空下限」（P1）与「搬前作用域记账」（P2）。
 *
 * P1 为什么必须单独判：`moduleUniquenessReport` / `moduleLedgerReport` 都是**遍历"从 parts 里筛出来的
 *   `mod-*` 片"**。档 B 之后模块不再是"产物的一段连续区间"，而是**带接线的单元** ⇒ 若它不再作为
 *   `parts` 里的条目存在，这两个判据遍历的就是**空集** ⇒ **双双恒真**（一个都不违背 = 绿）。
 *   ★ 而我们刚把"模块数/函数数"改成**派生断言** —— 那正好让这次退化**看不见**。
 *   ⇒ 所以模块集合必须由**声明清单**给出（不靠 parts 里筛），并且**为空即红**。
 *
 * P2 为什么必须"动刀前"落：档 B 用 IIFE / 模块头**显式接收依赖**，包装器会把**作用域同质化** ——
 *   任何东西塞进去都"同作用域" ⇒ "同段函数必须共享同一 enclosing scope"这条保护**不会红、只是不再保护**。
 *   ⇒ 唯一的补救是**记录"搬前的作用域归属"**；而**事后补记无据**（那时原作用域已经看不见了）。
 *
 * @param {object} o
 * @param {Array<{path:string,text:string}>} o.parts
 * @param {object} o.manifest
 */
export function moduleRegistryReport({ parts, manifest }) {
  const problems = []
  const modEntries = (manifest && manifest.modules) || {}
  const paths = Object.keys(modEntries)
  // ── P1（非空下限）──
  if (paths.length < 1) problems.push('模块声明清单为空（≥1 个模块是下限）⇒ 遍历空集会让"每个模块都合规"恒真')
  const modParts = parts.filter((p) => /(^|\/)mod-[^/]+\.js$/.test(p.path))
  if (modParts.length < 1) problems.push('按 parts 筛出来的模块片为空（≥1 是下限）')
  if (paths.length !== modParts.length) {
    problems.push('声明清单 ' + paths.length + ' 个 ≠ parts 里筛出的模块片 ' + modParts.length + ' 个'
      + ' ⇒ 两者必须一致（否则判据遍历的对象与实际模块不是同一批）')
  }
  let fnTotal = 0
  for (const p of paths) {
    const spec = modEntries[p] || {}
    const n = Object.keys(spec.functions || {}).length
    fnTotal += n
    // ── P2（搬前作用域记账，必须非空）──
    if (!spec.preMoveScope || typeof spec.preMoveScope !== 'string') {
      problems.push(p + ' 缺 `preMoveScope`（搬前的作用域归属）—— ★ 档 B 的包装器会把作用域同质化，'
        + '这条一旦事后补记就**无据可查**；必须在动刀前落')
    }
    if (n === 0) problems.push(p + ' 的 functions 为空（每个模块至少要有 1 个函数）')
  }
  if (fnTotal < 1) problems.push('全部模块合计 0 个函数（≥1 是下限）')
  return { ok: problems.length === 0, problems, stats: { modules: paths.length, functions: fnTotal } }
}

/**
 * ★★ **P3**：模块的接线声明里**不许值捕获 / 不许顶层求值**。
 *
 * 为什么它能抓别人抓不到的：`wiringReport`（左端 missing）与 `landingReport`（右端 unlanded）判的都是
 * **名字**，**都不看取值时机** ⇒ `x: MUV_X`（值捕获）与 `x: () => MUV_X`（访问器）**两端一样绿**。
 * ⇒ 这是"五件等价性证据"里**唯一能抓"拿快照"**的一条（活变量全是 `var`，`muvFullpageFloor`
 *   有 4 个净赋值点 ⇒ 快照**已经**会改语义）。
 *
 * 判定口径（**看值不看词**）：接线块里形如 `name: IDENT`（直接捕获）或 `name: IDENT(...)`（顶层求值）
 * 一律**红**；只允许 `name: () => IDENT` / `name: function () { … }` 这类**延迟取值**的形态。
 * 接线块的认法：`/* wiring *​/` 标记的注释块，或 `const __wiring = { … }` 形式的单层对象字面量。
 * 没有接线块的模块（档 A）**不适用**，直接通过。
 *
 * @param {object} o
 * @param {Array<{path:string,text:string}>} o.parts
 */
export function moduleWiringCaptureReport({ parts }) {
  const problems = []
  let checked = 0
  for (const p of parts) {
    if (!/(^|\/)mod-[^/]+\.js$/.test(p.path)) continue
    const m = /\/\*\s*wiring\s*\*\/([\s\S]*?)\n\s*\}\s*$/.exec(p.text)
      || /const\s+__wiring\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(p.text)
    if (!m) continue                       // 档 A 模块没有接线块 ⇒ 不适用
    checked++
    for (const line of m[1].split('\n')) {
      const km = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+?),?\s*$/.exec(line)
      if (!km) continue
      const rhs = km[2].trim()
      const lazy = /^\(\s*\w*\s*\)\s*=>/.test(rhs) || /^function\b/.test(rhs)
      if (!lazy) {
        problems.push(p.path + ' 的接线声明 `' + km[1] + ': ' + rhs + '` **是值捕获/顶层求值**'
          + '（活变量全是 var，快照会改语义）⇒ 必须写成访问器 `() => ' + rhs.replace(/\(.*\)\s*$/, '') + '`')
      }
    }
  }
  return { ok: problems.length === 0, problems, stats: { modulesWithWiring: checked } }
}

// ── CLI ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
// ★ 入口判定必须用 `pathToFileURL`，**不能**手拼 `'file://' + argv[1]`：
//   Windows 上 argv[1] 是 `C:\…\build-client.mjs`，手拼得到 `file://C:/…`（两斜杠），
//   而 import.meta.url 是 `file:///C:/…`（三斜杠）⇒ **永不相等** ⇒ CLI 块整段不执行，
//   `--check` 于是静默 exit 0 —— 一次"免费绿灯"（实测踩到：`--list` 一行都不打印才发现）。
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { parts, artifact, manifest } = loadFromDisk()
  if (argv.includes('--list')) {
    console.log('清单：' + MANIFEST_PATH)
    for (const p of manifest.parts) {
      console.log('  ' + p.path.padEnd(28) + ' 行 ' + String(p.startLine).padStart(5) + '-' + String(p.endLine).padStart(5)
        + '  ' + String(p.bytes).padStart(7) + ' 字节  深度 ' + p.depthAtStart + '->' + p.depthAtEnd)
    }
    console.log('产物：' + manifest.artifact.path + '  ' + manifest.artifact.bytes + ' 字节');
  }
  if (argv.includes('--ledger')) {
    const lg = moduleLedgerReport({ parts, manifest })
    for (const e of lg.entries) console.log('  ' + e.path.padEnd(26) + ' 账本 ' + e.ledgered + ' 个函数 / 实际声明 ' + e.declared + ' 个')
    if (lg.ok) { console.log('✅ 模块迁移账本：每个模块里的函数都在、文本摘要都对得上'); process.exit(0) }
    console.error('❌ 模块迁移账本不成立：')
    for (const p of lg.problems) console.error('  · ' + p)
    process.exit(1)
  }
  if (argv.includes('--uniqueness')) {
    const uq = moduleUniquenessReport({ parts, artifact })
    for (const m of uq.moduleFns) console.log('  ' + m.path.padEnd(26) + ' ' + m.names.join(', '))
    if (uq.ok) { console.log('✅ 模块函数唯一性：模块内的函数在产物里各只声明 1 次'); process.exit(0) }
    console.error('❌ 模块函数唯一性不成立（多半是"搬了没删原处"）：')
    for (const p of uq.problems) console.error('  · ' + p)
    process.exit(1)
  }
  if (argv.includes('--levels')) {
    const lv = moduleLevelReport({ parts, manifest })
    for (const m of lv.modules) {
      console.log('  ' + m.path.padEnd(26) + ' 基准深度 ' + m.base + '  绝对深度层 ' + JSON.stringify(m.layers)
        + '   ' + m.fns.map((f) => f.nm + '@' + f.abs).join(', '))
    }
    if (lv.ok) { console.log('✅ 模块层级纯度：' + lv.modules.length + ' 个模块都是单层的'); process.exit(0) }
    console.error('❌ 模块层级纯度不成立（跨层搬会改变闭包可见性）：')
    for (const p of lv.problems) console.error('  · ' + p)
    process.exit(1)
  }
  const report = freshnessReport({ parts, artifact, manifest })
  if (argv.includes('--check')) {
    if (report.ok) {
      console.log('✅ 客户端产物与分片**逐字节一致**：' + report.stats.parts + ' 个分片 / '
        + report.stats.byteSum + ' 字节（= 产物 ' + report.stats.artifactBytes + ' 字节）')
      process.exit(0)
    }
    console.error('❌ 客户端产物与分片**不一致**（分片是源、产物是派生物）：')
    for (const p of report.problems) console.error('  · ' + p)
    console.error(FIX_HINT)
    process.exit(1)
  }
  // 默认：生成（= 用分片重写产物 **并刷新清单**）
  if (report.ok && !argv.includes('--force')) {
    console.log('✅ 产物已是最新（' + report.stats.artifactBytes + ' 字节），无需重写。')
    process.exit(0)
  }
  // ★ 生成**必须同时刷新清单**：否则"改了分片 → 重新生成 → 清单里的 artifact.sha256 还是旧的"
  //   ⇒ form-free 不变式立刻报红，而用户会以为是产物错了（其实错的是清单）。
  //   刷新口径与生成端一致：每片按**归一化内容**记 bytes/sha256（见 lf 的长注释），
  //   产物同理。清单位于 src/client/MANIFEST.json，**不是**产物的一部分，改它不影响逐字节。
  const built = assemble(parts.map((p) => p.text))
  fs.writeFileSync(ARTIFACT_PATH, built)
  const fresh = refreshedManifest({ parts, built, manifest })
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(fresh, null, 2) + '\n')
  console.log('✍️  已用 ' + parts.length + ' 个分片重新生成 ' + path.relative(REPO, ARTIFACT_PATH)
    + '（' + fresh.artifact.bytes + ' 字节）并刷新清单（parts 的 bytes/sha256/lines + artifact 的 bytes/sha256）')
  process.exit(0)
}
