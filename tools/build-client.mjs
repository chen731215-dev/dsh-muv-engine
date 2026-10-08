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
export const EXPECTED_PARTS = 13

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
    problems.push('分片数 ≠ 预期 ' + EXPECTED_PARTS + '（增减分片必须显式改 build-client.mjs 的 EXPECTED_PARTS）')
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
