// **客户端产物 / 分片的常驻判据**（S2 walking skeleton）。
//
// 两件事，各自都有非空跑下限与「坏样本必须报红」的反证：
//   ① **新鲜度**：`拼装(分片) === lib/client.js`（逐字节，**不归一化**），且清单声明必须与
//      实际分片重算一致。**双向**反证：改分片 ⇒ 红；**只改产物 ⇒ 也红**（防真相源漂移）。
//   ② **分片可解析**：每个分片必须能在它被拼进后所处的**嵌套深度**里解析成功
//      （曾经想"放回嵌套深度解析"，**实测不可满足**：首片的闭合需要 `})()`，补花括号补不平圆括号；）
//       已换成 ③ 的"边界合法性"。）
//
// ★ 两条都是**纯函数**判据（吃内存里的对象/文本）⇒ 反证喂**合成夹具**，
//   不必真改仓库文件、也不污染工作树。
// ★ 「逐字节」是**分片 ↔ 产物**之间，**不是**"产物 ↔ 历史" —— 见 tools/build-client.mjs 头注：
//   第③步（批量搬）会改变分片顺序、从而改变产物字节，但"产物 == 它的分片"永远成立。
//
// 运行：node tests/test-client-parts.mjs

import { freshnessReport, loadFromDisk, assemble, refreshedManifest, moduleLevelReport, moduleUniquenessReport, moduleLedgerReport, moduleRegistryReport, moduleWiringCaptureReport, EXPECTED_PARTS } from '../tools/build-client.mjs'
import { tokenize } from '../tools/client-scope.mjs'

/** 非空跑下限（实测：12 个分片 / 556776 字节）。低于它说明"什么都没分析到"。 */
const MIN_PARTS = 8
const MIN_BYTES = 400000

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

/**
 * ★ 边界合法性判据（纯函数 ⇒ 反证可喂合成夹具）。
 *
 * 为什么**不**判"每片能独立解析"：那对 byte-preserving 的切片**不可满足** ——
 * 首片含 `window.__ModuleLoader__.load({` 与 `(function () {`，它的闭合需要 `})()`；
 * 只补**花括号**补不平**圆括号**，任何"包一层"的写法都解析不了（实测 12 片里 10 片失败）。
 * ⇒ 改为判**真正会出错的两类**：
 *   ① 边界**劈开了一个 token**（切在字符串 / 模板 / 正则 / 注释中间）—— 词法可判、且一旦发生就是硬伤；
 *   ② 边界**不落在语句之间**（切在表达式中间，例如上一 token 是 `+`）。
 * "合并后整体可解析"另有独立判据：`check-syntax` 按 ESM 解析产物 + 本节 ④ 的 `new Function(产物)`。
 * @param {{partTexts:string[], fullText:string}} o
 */
export function boundaryReport({ partTexts, fullText }) {
  // ★ 边界合法性是**结构性质**（token 有没有被劈开、是不是落在语句之间），**与行尾形态无关**
  //   ⇒ 一律在**归一化后**的文本上判。
  //   —— 这与"分片 ↔ 产物要比原始字节"并不矛盾：那条是**字节性质**，这条是**结构性质**。
  //   （第一版没归一化：默认检出是 LF 时全绿，而 CRLF 夹具里同一批边界被误报"劈开 token /
  //     上一 token 是注释" —— 因为 CRLF 下注释 token 会把末尾的 `\r` 吃进去，
  //     字节偏移与 token 边界就不再对齐。根因是"拿字节偏移去问结构问题"。）
  const lf = (s) => s.replace(/\r\n/g, '\n')
  const normParts = partTexts.map(lf)
  const toks = tokenize(lf(fullText))
  const offs = []
  let acc = 0
  for (let i = 0; i < normParts.length - 1; i++) { acc += normParts[i].length; offs.push(acc) }
  const problems = []
  // ★ 空输入必须报红：否则"什么都没切"会被当成"边界全合法"（空绿）
  if (partTexts.length === 0) problems.push('没有分片可判（空输入不许当绿）')
  for (const b of offs) {
    if (toks.some((t) => t.start < b && b < t.end)) {
      problems.push('边界 ' + b + ' 劈开了一个 token（切在字符串/模板/正则/注释中间）')
    }
    let prev = null
    // ★ 取"前一个**有效** token"时**跳过注释**：注释不是语句，边界落在一条完整注释之后
    //   仍然算"落在语句之间"。原实现把注释也当 token ⇒ 边界前面若有一条 `/** … */`
    //   会被误判成"不落在语句之间"（实测：段4 的模块插入点正好紧跟一条块注释，报红的就是它）。
    //   "切在注释**内部**"那种真错由上面的 `insideToken` 管，不会被这条放宽漏掉。
    for (const t of toks) {
      if (t.end <= b) { if (t.type !== 'comment') prev = t; continue }
      break
    }
    // 判红条件：**前面确有一个有效 token**，且它不是语句终结符（`;` / `}`）。
    // ★ 前面**没有**任何有效 token 时不算红 —— 那是"文件/块的起点"，本来就落在语句之间
    //   （原实现写的是 `!prev || …`，把"没有前驱"也判红 ⇒ 实测：边界在开头时误红）。
    if (prev && !(prev.type === 'punct' && (prev.value === ';' || prev.value === '}'))) {
      problems.push('边界 ' + b + ' 不落在语句之间（上一有效 token = ' + prev.value + '）')
    }
  }
  for (const [i, p] of partTexts.entries()) if (!p) problems.push('第 ' + (i + 1) + ' 片为空')
  return { ok: problems.length === 0, problems, boundaries: offs.length }
}

const disk = loadFromDisk()
const { parts, artifact, manifest } = disk

console.log('\n① 真实仓库自证：产物 == 它的分片（逐字节）')
{
  const r = freshnessReport({ parts, artifact, manifest })
  check('★ 当前仓库：拼装(分片) 与 lib/client.js **逐字节一致**',
    r.ok, r.problems.join(' | '))
  check('逐字节标志为真（不是靠字节数相等蒙混）', r.stats.byteExact === true)
  check('分片数 ' + r.stats.parts + ' ≥ ' + MIN_PARTS + '（非空跑下限）', r.stats.parts >= MIN_PARTS, String(r.stats.parts))
  check('各分片字节数之和 == 产物字节数（拼装没吞没漏）',
    r.stats.byteSum === r.stats.artifactBytes, r.stats.byteSum + ' vs ' + r.stats.artifactBytes)
  check('总量 ≥ ' + MIN_BYTES + ' 字节（非空跑下限）', r.stats.artifactBytes >= MIN_BYTES, String(r.stats.artifactBytes))
  check('分片数 == 预期常量 ' + EXPECTED_PARTS + '（增减分片必须显式改工具）',
    r.stats.parts === EXPECTED_PARTS, String(r.stats.parts))
  check('清单里每片都记了 sha256 / 字节数 / 深度（否则判据无从重算）',
    manifest.parts.every((p) => /^[0-9a-f]{64}$/.test(p.sha256) && p.bytes > 0 &&
      typeof p.depthAtStart === 'number' && typeof p.depthAtEnd === 'number'))
}

console.log('\n② ★ 双向反证：两个方向都必须红（防真相源漂移）')
{
  const clone = () => ({ parts: parts.map((p) => ({ ...p })), artifact, manifest: JSON.parse(JSON.stringify(manifest)) })

  // 正向：改【分片】一个字符 ⇒ 红 + 点名该分片
  {
    const c = clone()
    c.parts[3].text = c.parts[3].text.replace('var', 'var'.replace('a', 'a')) // 占位，下面是真改动
    const i = c.parts[3].text.indexOf('function')
    c.parts[3].text = c.parts[3].text.slice(0, i) + 'function ' + c.parts[3].text.slice(i + 'function'.length)
    const r = freshnessReport(c)
    check('正向：改了分片 ⇒ 报红', r.ok === false)
    check('正向：**点名**是哪个分片（sha256 不符）',
      r.problems.some((p) => p.includes(c.parts[3].path) && p.includes('sha256')),
      r.problems.join(' | '))
    check('正向：给出首个差异偏移（只说红不说哪等于没红）', typeof r.firstDiff?.offset === 'number')
  }

  // 反向：**只改产物**不改分片 ⇒ 同样必须红（这是关键方向）
  {
    const c = clone()
    c.artifact = c.artifact.replace('dsh-muv-engine client', 'dsh-muv-engine CLIENT')
    const r = freshnessReport(c)
    check('★ 反向：**只改产物**不改分片 ⇒ 同样报红（真相源不许漂）', r.ok === false)
    check('反向：偏移落在被改处', r.firstDiff?.offset === c.artifact.indexOf('CLIENT'),
      String(r.firstDiff?.offset) + ' vs ' + String(c.artifact.indexOf('CLIENT')))
    check('反向：两侧上下文都被打印出来（可定位）',
      typeof r.firstDiff?.artifactCtx === 'string' && typeof r.firstDiff?.partsCtx === 'string')
  }

  // 截断整个分片 ⇒ 字节数之和也不符
  {
    const c = clone()
    c.parts[0].text = c.parts[0].text.slice(0, 10)
    const r = freshnessReport(c)
    check('截断一个分片 ⇒ 红（且报"字节数之和 ≠ 产物字节数"）',
      r.ok === false && r.problems.some((p) => p.includes('字节数之和')), r.problems.join(' | '))
  }

  // 清单说谎（改分片但忘了更新清单）⇒ 被重算抓住
  {
    const c = clone()
    c.manifest.parts[2].bytes = c.manifest.parts[2].bytes + 1
    const r = freshnessReport(c)
    check('★ 清单与实际分片不符（改了分片忘更新清单）⇒ 红（判据**重算**，不信任清单）',
      r.ok === false && r.problems.some((p) => p.includes('字节数不符')), r.problems.join(' | '))
  }

  // 分片数被悄悄改动 ⇒ 红
  {
    const c = clone()
    c.manifest.parts.push({ ...c.manifest.parts[0], path: 'src/client/part-99.js' })
    const r = freshnessReport(c)
    check('分片数与清单/预期不符 ⇒ 红', r.ok === false, r.problems.join(' | '))
  }

  // ★ 连续性：让 `depthAtStart/depthAtEnd` 与 `startLine/endLine` 各自被一条断言盯着，
  //   而不是当"写给人看的字段"（本仓明令禁止那种字段）。
  {
    const c = clone()
    c.manifest.parts[3].startLine = c.manifest.parts[3].startLine + 1
    const r = freshnessReport(c)
    check('★ 分片不连续（行区间断档）⇒ 红并点名',
      r.ok === false && r.problems.some((p) => p.includes('分片不连续')), r.problems.join(' | '))
  }
  {
    const c = clone()
    c.manifest.parts[5].depthAtEnd = c.manifest.parts[5].depthAtEnd + 1
    const r = freshnessReport(c)
    check('★ 边界深度不连续 ⇒ 红并点名',
      r.ok === false && r.problems.some((p) => p.includes('边界深度不连续')), r.problems.join(' | '))
  }
  {
    const c = clone()
    c.manifest.parts[0].lines = c.manifest.parts[0].lines + 1
    const r = freshnessReport(c)
    check('★ 清单 lines 之和 ≠ 产物行数 ⇒ 红（把清单口径与产物对齐）',
      r.ok === false && r.problems.some((p) => p.includes('lines 之和')), r.problems.join(' | '))
  }
  {
    // 口径自证：8831 / 8832 的差值是"末行无尾随换行"，不是矛盾
    const artLines = artifact.split('\n').length
    const nlCount = (artifact.match(/\n/g) || []).length
    check('口径自证：产物行数 = \\n 个数 + 1（末行无尾随换行）—— ' + artLines + ' = ' + nlCount + ' + 1',
      artLines === nlCount + 1)
  }

  // 空输入不许空绿
  const empty = freshnessReport({ parts: [], artifact: '', manifest: { parts: [] } })
  check('空输入 ⇒ 红（不许"什么都没分析到"当绿）', empty.ok === false, empty.problems.join(' | '))

  // ★ EOL 形态无关性：把**产物与全部分片统一**改成 CRLF（= 模拟"attribute 没生效的检出"）⇒ 仍必须绿。
  //   —— 这是"清单比内容（归一化）、产物比字节（不归一化）"那条口径的直接证据。
  {
    // ★ toCrlf 必须**幂等**：在 CRLF 形态的夹具里，从盘上读到的分片**本来就是 CRLF**，
    //   无脑 replace 会做出 `\r\r\n` ⇒ 合成样本被自己弄坏，然后判据"报红"报的是夹具的错。
    //   （第一版就是这么错的：CRLF 夹具里 2 条断言红，查下来是我的夹具，不是工具。）
    const toCrlf = (s) => (s.includes('\r\n') ? s : s.replace(/\n/g, '\r\n'))
    const c = clone()
    c.parts = c.parts.map((p) => ({ ...p, text: toCrlf(p.text) }))
    c.artifact = toCrlf(c.artifact)
    const r = freshnessReport(c)
    check('★ 产物与分片**统一**改成 CRLF ⇒ 仍然绿（判据不吃检出形态）', r.ok, r.problems.join(' | '))
  }
  // 反向：**只有一侧**是 CRLF（形态不一致）⇒ 必须红 —— .gitattributes 存在的理由
  {
    const c = clone()
    c.artifact = c.artifact.replace(/\n/g, '\r\n')
    const r = freshnessReport(c)
    check('★ 只有**产物**一侧是 CRLF（形态不一致）⇒ 红（.gitattributes 存在的理由）',
      r.ok === false, r.problems.join(' | '))
  }

  // ★ form-free 不变式：`sha256(归一化 concat(分片)) == 清单的 artifact.sha256`
  //   —— 它**与检出形态无关**，且它是"清单里那句 sha256 声明"的**唯一复查**
  //      （原先只靠人工每批手算 ⇒ 现在本地与 CI 每批都跑）。
  {
    const r = freshnessReport({ parts, artifact, manifest })
    check('★ form-free：sha256(归一化 concat) == 清单的 artifact.sha256',
      !!r.stats.builtSha && r.stats.builtSha === r.stats.declaredArtSha,
      (r.stats.builtSha || '') + ' vs ' + (r.stats.declaredArtSha || ''))
  }
  {
    // 反证：把清单里那句 sha256 改坏 ⇒ 必须红（证明这条断言真的在看那个声明）
    const c = clone()
    c.manifest.artifact.sha256 = 'deadbeef'.repeat(8)
    const r = freshnessReport(c)
    check('反证：清单的 artifact.sha256 被改坏 ⇒ 红并点名 form-free 不变式',
      r.ok === false && r.problems.some((p) => p.includes('form-free')), r.problems.join(' | '))
  }
  {
    // 反证：清单里**没有** artifact.sha256 ⇒ 也要红（不许"没有右端"就当绿）
    const c = clone()
    delete c.manifest.artifact.sha256
    const r = freshnessReport(c)
    check('反证：清单缺 artifact.sha256 ⇒ 红（不许"没有右端"当绿）',
      r.ok === false && r.problems.some((p) => p.includes('无从复核')), r.problems.join(' | '))
  }
  {
    // form-free 的直接证据：产物与分片**统一**改 CRLF 后，这条摘要**不变**
    const toCrlf = (s) => (s.includes('\r\n') ? s : s.replace(/\n/g, '\r\n'))
    const c = clone()
    c.parts = c.parts.map((p) => ({ ...p, text: toCrlf(p.text) }))
    c.artifact = toCrlf(c.artifact)
    const r = freshnessReport(c)
    check('★ 统一改 CRLF 后 form-free 摘要不变（这就是"form-free"的含义）',
      r.stats.builtSha === r.stats.declaredArtSha,
      (r.stats.builtSha || '') + ' vs ' + (r.stats.declaredArtSha || ''))
  }
}

console.log('\n③ 分片边界合法性（"每片独立解析"不可满足 ⇒ 已作废，见 boundaryReport 注释）')
{
  const partTexts = parts.map((p) => p.text)
  const r = boundaryReport({ partTexts, fullText: artifact })
  check('★ 全部分片边界：既不劈开 token、也落在语句之间（' + r.boundaries + ' 个边界）',
    r.ok, r.problems.join(' | '))
  check('边界数 == 分片数 − 1', r.boundaries === parts.length - 1, String(r.boundaries))
  check('分片数 ≥ ' + MIN_PARTS + '（非空跑下限，否则"全部通过"是空话）', parts.length >= MIN_PARTS, String(parts.length))
  check('清单里每片都记了起始/结束深度（供边界自检用）',
    manifest.parts.every((p) => typeof p.depthAtStart === 'number' && typeof p.depthAtEnd === 'number'))

  // 反证 ①：把边界切在**字符串中间** ⇒ 必须报红并说明"劈开了 token"
  {
    const full = "const a = 'xy'\nconst b = 2\n"
    const bad = boundaryReport({ partTexts: ["const a = 'x", "y'\nconst b = 2\n"], fullText: full })
    check('反证：切在字符串中间 ⇒ 报红（劈开 token）',
      bad.ok === false && bad.problems.some((p) => p.includes('劈开')), bad.problems.join(' | '))
  }
  // 反证 ②：把边界切在**表达式中间**（上一 token 是 `+`）⇒ 必须报红
  {
    const full = 'const a = 1 +\n2\n'
    const bad = boundaryReport({ partTexts: ['const a = 1 +\n', '2\n'], fullText: full })
    check('反证：切在表达式中间 ⇒ 报红（上一 token 不是 ; 或 }）',
      bad.ok === false && bad.problems.some((p) => p.includes('不落在语句之间')), bad.problems.join(' | '))
  }
  // 反证 ③：空分片 ⇒ 报红
  check('反证：空分片 ⇒ 报红',
    boundaryReport({ partTexts: ['', 'x\n'], fullText: 'x\n' }).ok === false)
  // ★ 反证（段4 实测踩到的形态）：边界紧跟一条**完整注释** ⇒ 算合法（注释是透明的）
  check('★ 边界紧跟一条完整块注释 ⇒ **合法**（注释不算"上一个语句 token"）',
    boundaryReport({
      partTexts: ['/** 说明 */\n', 'const a = 1;\n'],
      fullText: '/** 说明 */\nconst a = 1;\n',
    }).ok === true)
  // 反向：上一有效 token 是运算符 ⇒ 仍必须红（放宽注释后没有把这条一起放掉）
  check('反向：上一**有效** token 是 `+` ⇒ 仍必须红（放宽注释没把真错一起放过）',
    boundaryReport({ partTexts: ['const a = 1 +\n', '2\n'], fullText: 'const a = 1 +\n2\n' }).ok === false)
  // 反向自证：合法切法必须过（判据没被收废）
  check('反向自证：合法切法能过（判据没被收废）',
    boundaryReport({ partTexts: ['const a = 1;\n', 'const b = 2;\n'], fullText: 'const a = 1;\nconst b = 2;\n' }).ok === true)
  // 空输入不许空绿
  check('空输入 ⇒ 报红（不许"什么都没切"当绿）',
    boundaryReport({ partTexts: [], fullText: '' }).ok === false)
}

console.log('\n④ 拼装是"直接相接"（没有分隔符魔法）')
{
  check('assemble 就是 join(\'\')（分片自带行尾，最后一片不带）',
    assemble(['a\n', 'b']) === 'a\nb')
  const r = freshnessReport({ parts, artifact: assemble(parts.map((p) => p.text)), manifest })
  check('用分片自己拼出来的产物喂判据 ⇒ 绿（恒成立：产物 == 它的分片）', r.ok === true, r.problems.join(' | '))
}

console.log('\n⑤ 生成路径的"刷新清单"逻辑也被判据盯着（不许有未经验证的路径）')
{
  // 场景：改了分片 → 该跑一次生成。生成必须**同时**刷新产物与清单，
  // 否则"清单里的 artifact.sha256 还是旧的" ⇒ form-free 变式报红，而使用者会以为产物错了。
  const clone = () => ({ parts: parts.map((p) => ({ ...p })), artifact, manifest: JSON.parse(JSON.stringify(manifest)) })
  const c = clone()
  const edited = c.parts[2].text + '\n// 注入的一行（模拟"改了分片"）\n'
  c.parts[2] = { ...c.parts[2], text: edited }
  const built = assemble(c.parts.map((p) => p.text))
  c.artifact = built                                  // 生成会重写产物
  check('刷新前：清单是旧的 ⇒ 必然红（这就是为什么生成必须刷新清单）',
    freshnessReport({ parts: c.parts, artifact: c.artifact, manifest: c.manifest }).ok === false)

  const fresh = refreshedManifest({ parts: c.parts, built, manifest: c.manifest })
  const after = freshnessReport({ parts: c.parts, artifact: built, manifest: fresh })
  check('★ 刷新清单后：`--check` 转绿（生成路径自洽）', after.ok, after.problems.join(' | '))

  // 幂等：同样的输入再刷新一次，结果必须逐字相同（否则生成永不收敛）
  const again = refreshedManifest({ parts: c.parts, built, manifest: fresh })
  check('★ 刷新是**幂等**的（同样输入两次 → 结果逐字相同）',
    JSON.stringify(again) === JSON.stringify(fresh))

  // 行数口径：以换行结尾的分片，lines 不得把尾随空元素算进去
  const endsNl = c.parts.filter((p) => p.text.endsWith('\n'))
  const declOf = (path) => fresh.parts.find((d) => d.path === path)
  check('★ lines 口径：以换行结尾的分片，lines == split(\'\\n\').length − 1',
    endsNl.length > 0 && endsNl.every((p) => declOf(p.path).lines === p.text.split('\n').length - 1),
    endsNl.length + ' 片以换行结尾')
  check('lines 之和 == 产物行数（刷新后仍成立）',
    fresh.parts.reduce((s, d) => s + d.lines, 0) === built.split('\n').length,
    fresh.parts.reduce((s, d) => s + d.lines, 0) + ' vs ' + built.split('\n').length)

  // 不许改入参（纯函数）
  const snapshot = JSON.stringify(c.manifest)
  refreshedManifest({ parts: c.parts, built, manifest: c.manifest })
  check('刷新是纯函数（不改入参清单）', JSON.stringify(c.manifest) === snapshot)
}

console.log('\n⑥ 模块层级纯度（S2 ③ 的搬迁前置检查：跨层搬会改变闭包可见性）')
{
  const lv = moduleLevelReport({ parts, manifest })
  check('★ 真实仓库：每个 mod-* 模块内部函数都是**单层**的', lv.ok, lv.problems.join(' | '))
  check('至少存在 1 个模块片（否则"层级纯度"是空判定）', lv.modules.length >= 1, String(lv.modules.length))
  const mt = lv.modules.find((m) => m.path.endsWith('mod-text.js'))
  check('mod-text.js 的基准深度 = 2 且三个函数绝对深度全为 2（段1 是同层搬迁）',
    !!mt && mt.base === 2 && mt.layers.length === 1 && mt.layers[0] === 2,
    JSON.stringify(mt && { base: mt.base, layers: mt.layers }))
  check('mod-text.js 里认出了 3 个函数（splitArgs / findClosingFence / readStartTag）',
    !!mt && mt.fns.length === 3, mt ? mt.fns.map((f) => f.nm).join(',') : 'missing')

  // 反证 ①：模块内部**跨层** ⇒ 必须红并点名
  {
    const mixed = [
      '// mod-x',
      'function topLevelA() { return 1 }',
      'function wrapper() {',
      '  function innerB() { return 2 }',
      '  return innerB()',
      '}',
    ].join('\n')
    const r = moduleLevelReport({
      parts: [{ path: 'src/client/mod-x.js', text: mixed }],
      manifest: { parts: [{ path: 'src/client/mod-x.js', depthAtStart: 2 }] },
    })
    check('反证：模块内部跨层（topLevelA@2 与 innerB@3）⇒ 红并点名两个层',
      r.ok === false && r.problems.some((p) => p.includes('跨层') && p.includes('innerB@3')), r.problems.join(' | '))
  }
  // 反证 ②：模块里没有函数声明 ⇒ 语义可疑，必须红
  {
    const r = moduleLevelReport({
      parts: [{ path: 'src/client/mod-y.js', text: 'var onlyAVar = 1\n' }],
      manifest: { parts: [{ path: 'src/client/mod-y.js', depthAtStart: 2 }] },
    })
    check('反证：模块里没有具名函数声明 ⇒ 红（语义可疑）',
      r.ok === false && r.problems.some((p) => p.includes('没有任何具名函数声明')), r.problems.join(' | '))
  }
  // 反证 ③：一个模块都没有 ⇒ 不许空绿
  {
    const r = moduleLevelReport({
      parts: [{ path: 'src/client/part-01.js', text: 'function a() {}\n' }], manifest: { parts: [] },
    })
    check('反证：没有任何 mod-* 模块 ⇒ 红（不许"没得判"当绿）',
      r.ok === false && r.problems.some((p) => p.includes('没有任何 mod-* 模块片')), r.problems.join(' | '))
  }
  // 反向自证：单层模块必须过（判据没被收废）
  check('反向自证：单层模块能过（判据没被收废）',
    moduleLevelReport({
      parts: [{ path: 'src/client/mod-z.js', text: 'function a() {}\nfunction b() {}\n' }],
      manifest: { parts: [{ path: 'src/client/mod-z.js', depthAtStart: 4 }] },
    }).ok === true)
}

console.log('\n⑦ 模块函数的全局唯一性（"搬了忘了删原处"的 git-free 守卫）')
{
  const uq = moduleUniquenessReport({ parts, artifact })
  check('★ 真实仓库：模块里的函数在产物里各只声明 1 次', uq.ok, uq.problems.join(' | '))
  // ★ 派生断言（**不硬编码模块数/函数数**）：每加一段这两个数都会变，写死会让"段N 的测试"在
  //   "段N+1"里报红 —— 那不是真问题，却会训练人忽略红灯。改成与"实际存在的模块片"对齐。
  const modParts = parts.filter((p) => /(^|\/)mod-[^/]+\.js$/.test(p.path))
  check('唯一性判据覆盖了**全部** ' + modParts.length + ' 个模块片（派生，不写死数字）',
    uq.moduleFns.length === modParts.length && modParts.length >= 3,
    JSON.stringify(uq.moduleFns.map((m) => m.path + ':' + m.names.length)))

  // 反证 ①：搬了但**没删原处** ⇒ 产物里声明两次 ⇒ 必须红并点名
  {
    const modText = '// mod-dup\nfunction movedFn() { return 1 }\n'
    const dupArtifact = 'function movedFn() { return 1 }\nfunction movedFn() { return 2 }\n'
    const r = moduleUniquenessReport({ parts: [{ path: 'src/client/mod-dup.js', text: modText }], artifact: dupArtifact })
    check('反证：搬了没删原处（产物里声明 2 次）⇒ 红并点名',
      r.ok === false && r.problems.some((p) => p.includes('movedFn') && p.includes('2 次')), r.problems.join(' | '))
  }
  // 反向自证：只声明 1 次 ⇒ 过
  check('反向自证：只声明 1 次 ⇒ 过（判据没被收废）',
    moduleUniquenessReport({
      parts: [{ path: 'src/client/mod-ok.js', text: 'function onlyOnce() {}\n' }],
      artifact: 'function onlyOnce() {}\n',
    }).ok === true)
  // 词法口径：字符串/注释里的 `function foo(` 不算声明 ⇒ 不许因此误判
  {
    const r = moduleUniquenessReport({
      parts: [{ path: 'src/client/mod-str.js', text: 'function realFn() {}\n' }],
      artifact: "function realFn() {}\nvar s = 'function realFn() {}'\n// function realFn() {}\n",
    })
    check('词法口径：字符串/注释里的 `function realFn(` **不算**声明（不许把它数成第 2 次）',
      r.ok === true, r.problems.join(' | '))
  }
  // 不许要求"全产物唯一"：不同 IIFE 里的同名内部辅助是本仓合法现状
  check('反向自证：同名函数在**别的非模块片**里合法存在时，本条判据不管它（只管模块片）',
    moduleUniquenessReport({
      parts: [
        { path: 'src/client/mod-a.js', text: 'function shared() {}\n' },
        { path: 'src/client/part-99.js', text: 'function other() {}\n' },
      ],
      artifact: 'function shared() {}\nfunction other() {}\nfunction other() {}\n',
    }).ok === true)
}

console.log('\n⑧ 模块迁移账本（"函数被挪到同层别的模块 / 被顶替"的守卫，且不读 git）')
{
  const lg = moduleLedgerReport({ parts, manifest })
  check('★ 真实仓库：每个模块里的函数都在、文本摘要都对得上', lg.ok, lg.problems.join(' | '))
  // ★ 同样是派生断言：账本必须覆盖**全部**模块片，且每个模块的"账本条数 == 实际声明数"
  const modParts2 = parts.filter((p) => /(^|\/)mod-[^/]+\.js$/.test(p.path))
  const ledgerKeys = Object.keys(manifest.modules || {})
  check('账本覆盖了**全部** ' + modParts2.length + ' 个模块片、且条数与实际声明数一致（派生）',
    ledgerKeys.length === modParts2.length && modParts2.length >= 3 &&
    lg.entries.every((e) => e.ledgered === e.declared) &&
    lg.entries.every((e) => e.ledgered > 0),
    JSON.stringify(lg.entries.map((e) => e.path + ':' + e.ledgered + '/' + e.declared)))

  const modText = parts.find((p) => p.path.endsWith('mod-text.js'))
  const others = () => parts.filter((p) => p.path !== modText.path)

  // 反证 ①：模块里的函数文本被改动/顶替 ⇒ 必须红
  {
    const tampered = { ...modText, text: modText.text.replace('function splitArgs(src) {', 'function splitArgs(src, extra) {') }
    const r = moduleLedgerReport({ parts: [...others(), tampered], manifest })
    check('反证：模块内函数文本被改（顶替/改动）⇒ 红并点名该函数与两串摘要',
      r.ok === false && r.problems.some((p) => p.includes('splitArgs') && p.includes('不符')), r.problems.join(' | '))
  }
  // 反证 ②：账本记的函数从模块里消失（被挪走）⇒ 必须红
  {
    // ★ 夹具必须**形态无关**：判据本身会归一化，但**我的合成夹具**若直接在 CRLF 文本上跑
    //   `\n\s*function …` 这种正则，会**匹配不上**（`\r\n` 挡住它）⇒ "strip" 没发生 ⇒
    //   判据（正确地）说 ok ⇒ 而我的断言要求"必须红" ⇒ 这一格**在 CRLF 形态下红**。
    //   实测就是这么被抓到的（CRLF 夹具里唯一失败的一格）。修：先在归一化文本上做改动。
    const lfLocal = (s) => String(s).replace(/\r\n/g, '\n')
    const stripped = { ...modText, text: lfLocal(modText.text).replace(/\n\s*function splitArgs[\s\S]*?\n\s*\}\n/, '\n') }
    const r = moduleLedgerReport({ parts: [...others(), stripped], manifest })
    check('反证：账本记的函数从模块里消失（被挪走）⇒ 红并点名',
      r.ok === false && r.problems.some((p) => p.includes('splitArgs')), r.problems.join(' | '))
  }
  // 反证 ③：整个 `modules` 账本都没了 ⇒ 不许空绿
  {
    const r = moduleLedgerReport({ parts, manifest: { parts: manifest.parts } })
    check('反证：清单缺 `modules` 账本 ⇒ 红（不许"没得比"当绿）',
      r.ok === false && r.problems.some((p) => p.includes('缺少 `modules`')), r.problems.join(' | '))
  }
  // 反证 ④：账本指向不存在的模块片 ⇒ 红
  {
    const r = moduleLedgerReport({
      parts,
      manifest: { ...manifest, modules: { ...manifest.modules, 'src/client/mod-gone.js': { functions: { x: 'ab' } } } },
    })
    check('反证：账本条目指向不存在的模块片 ⇒ 红',
      r.ok === false && r.problems.some((p) => p.includes('mod-gone.js')), r.problems.join(' | '))
  }
  // 反向自证：内容与账本一致 ⇒ 过（判据没被收废）
  check('反向自证：内容与账本一致 ⇒ 过',
    moduleLedgerReport({ parts: [modText], manifest: { modules: { [modText.path]: manifest.modules[modText.path] } } }).ok === true)
}

console.log('\n⑨ P1/P2/P3：模块**声明清单 + 非空下限 + 搬前作用域记账 + 不许值捕获**（档 B 前置）')
{
  const rg = moduleRegistryReport({ parts, manifest })
  check('★ P1/P2：真实仓库 —— 声明清单与 parts 筛出的模块片一致、且非空', rg.ok, rg.problems.join(' | '))
  check('P1 非空下限：模块 ≥1 且函数 ≥1', rg.stats.modules >= 1 && rg.stats.functions >= 1, JSON.stringify(rg.stats))
  const noScope = Object.fromEntries(Object.entries(manifest.modules).map(([k, v]) => {
    const c = { ...v }; delete c.preMoveScope; return [k, c]
  }))
  const rg2 = moduleRegistryReport({ parts, manifest: { ...manifest, modules: noScope } })
  check('★ P2 反证：任一模缺 `preMoveScope` ⇒ 红并点名（事后补记无据，所以必须在动刀前落）',
    rg2.ok === false && rg2.problems.some((p) => p.includes('preMoveScope') && p.includes('无据可查')),
    rg2.problems.slice(0, 2).join(' | '))
  const rg3 = moduleRegistryReport({ parts, manifest: { ...manifest, modules: {} } })
  check('★ P1 反证：模块声明清单为空 ⇒ 红（"每个模块都合规"不许在空集上恒真）',
    rg3.ok === false && rg3.problems.some((p) => p.includes('为空')), rg3.problems.join(' | '))
  const rg4 = moduleRegistryReport({ parts: parts.filter((p) => !/mod-vr-ui/.test(p.path)), manifest })
  check('P1 反证：清单数与 parts 筛出的模块片数不一致 ⇒ 红',
    rg4.ok === false && rg4.problems.some((p) => p.includes('≠ parts 里筛出')), rg4.problems.join(' | '))

  const w0 = moduleWiringCaptureReport({ parts })
  // ★★ 2026-10-09 task-31（笔 B）：**断言随真实仓库演进更新**（原断言写死了"还没有任何模块带接线块"）。
  //   原句：`w0.ok === true && w0.stats.modulesWithWiring === 0` —— 在 `mod-status-css.js` 落地**之前**成立。
  //   笔 B 真搬 `ensureStatusCss` 后，该模块**首次**带上档 B 接线块 ⇒ `modulesWithWiring` 从 0 → 1
  //   ⇒ 原断言**必红**（CI #32 实测正是这一条 + ④-2）。
  //   ★ 这不是"为了过 CI 而放宽"——是**把快照改成契约**：本判据的**本义**是
  //     "真实仓库里凡带接线块的模块都必须是**访问器**（不许值捕获）"，而不是"不许有接线块"。
  //     ⇒ 现在断言：真实仓库**至少 1 个**带块（下限，防"全都不带"变回假绿）+ `ok === true`（全访问器）。
  //   ★ 若将来**没有任何**模块带接线块（例如全部回退），下面这条会因 `≥1` 下限**正确地**红
  //     —— 那时应显式把它改回"不适用"形态并说明原因，**不许**把下限删掉。
  check('P3：真实仓库里带接线块的模块**全部**是访问器（≥1，下限防假绿）',
    w0.ok === true && w0.stats.modulesWithWiring >= 1, JSON.stringify(w0.stats))
  check('P3：真实仓库**确有一个**带接线块的模块（`mod-status-css.js`，笔 B 落地）',
    w0.stats.modulesWithWiring === 1, JSON.stringify(w0.stats))
  const bad = 'const __wiring = {\n  sbCss: MUV_SB_CSS,\n}\nfunction f() { return __wiring }\n'
  const w1 = moduleWiringCaptureReport({ parts: [{ path: 'src/client/mod-probe.js', text: bad }] })
  check('★ P3 反证：`sbCss: MUV_SB_CSS`（值捕获）⇒ 红并点名',
    w1.ok === false && w1.problems.some((p) => p.includes('值捕获')), w1.problems.join(' | '))
  const good = 'const __wiring = {\n  sbCss: () => MUV_SB_CSS,\n}\nfunction f() { return __wiring }\n'
  const w2 = moduleWiringCaptureReport({ parts: [{ path: 'src/client/mod-probe2.js', text: good }] })
  // ★★ 审核方 ④-1：P3 的空跑下限（与 P1 同族 —— 找不到块不许全绿）
  check('④-1 P3 无 mod-* 片 ⇒ 红（无可评估对象，不许空集恒真）',
    moduleWiringCaptureReport({ parts: [{ path: 'tests/x.mjs', text: '' }], manifest }).ok === false)
  const declaredNoBlock = { modules: { ...manifest.modules, 'src/client/mod-x.js': { functions: { f: 'a' }, preMoveScope: 'x', preMoveScopeEvidence: 'reconstructed', wiring: { sbCss: { kind: 'accessor', target: 'MUV_SB_CSS' } } } } }
  check('④-1 反证：**声明了接线但块不可识别** ⇒ 红（保护不许静默消失）',
    moduleWiringCaptureReport({ parts, manifest: declaredNoBlock }).ok === false,
    moduleWiringCaptureReport({ parts, manifest: declaredNoBlock }).problems.join(' | '))
  // ★★ 审核方 ④-2：preMoveScope 必须标注证据强度
  const noEv = Object.fromEntries(Object.entries(manifest.modules).map(([k, v]) => { const c = { ...v }; delete c.preMoveScopeEvidence; return [k, c] }))
  check('④-2 反证：缺 `preMoveScopeEvidence` ⇒ 红并点名（不标注会让两种证据强度看起来一样）',
    moduleRegistryReport({ parts, manifest: { ...manifest, modules: noEv } }).ok === false &&
    moduleRegistryReport({ parts, manifest: { ...manifest, modules: noEv } }).problems.some((x) => x.includes('preMoveScopeEvidence')),
    '')
  check('④-2 正向：真实仓库每条都标了 pre-knife 或 reconstructed',
    rg.ok && Object.values(manifest.modules).every((v) => ['pre-knife', 'reconstructed'].includes(v.preMoveScopeEvidence)))
  check('★ P3 正向：`sbCss: () => MUV_SB_CSS`（访问器）⇒ 通过',
    w2.ok === true && w2.stats.modulesWithWiring === 1, w2.problems.join(' | '))
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
