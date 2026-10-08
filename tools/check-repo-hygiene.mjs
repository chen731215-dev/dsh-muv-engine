#!/usr/bin/env node
/**
 * 仓库卫生闸门：**git 跟踪的**文件里不许出现凭据 / 会话记录 / 本机路径 / 临时产物。
 *
 * 移植自 dsh-tavern-v2 的 tools/check-repo-hygiene.mjs，做了三处适配：
 *   ① 路径规则换成本仓的现实：`data/`（global-regex.json 等用户数据，见 .gitignore）
 *      与 `.tmp-*` 临时产物（分家/分析期的报告痕，容易夹带进基线提交）；
 *      去掉 tavern 专有的 `tavern-data/`、`_scratch/`。
 *   ② 内容规则原样保留（凭据 / 私钥 / 本机用户目录路径 / 会话 id / 疑似凭据赋值）。
 *   ③ 无条件扫描全部已跟踪文件（CI + `npm run check:hygiene`），`--staged` 供 pre-commit 用。
 *
 * 为什么要有它（而不是只靠 .gitignore）：.gitignore 只能挡"还没被跟踪的文件"，
 * 挡不住 `git add -f`、挡不住"先放进仓库再 gitignore"、也挡不住手滑把日志/临时报告拷进来。
 * 而**公开仓库里一旦提交，凭据就永久留在历史里**（删掉也还能被检索）。
 *
 * 用法：
 *   node tools/check-repo-hygiene.mjs            # 扫全部已跟踪文件（CI / npm run check:hygiene）
 *   node tools/check-repo-hygiene.mjs --staged   # 只扫暂存区（pre-commit 钩子）
 *   node tools/check-repo-hygiene.mjs --list     # 只列规则
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 内容规则：命中即失败。每条的 why 写清"为什么这东西不能进仓库"。 */
export const CONTENT_RULES = [
  { id: 'github-pat', re: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|gh[osu]_[A-Za-z0-9]{36})\b/, why: 'GitHub 令牌（凭据泄露）' },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/, why: 'npm 令牌（凭据泄露）' },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{20,}\b/, why: '形似 API key 的长串（凭据泄露）' },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: '私钥文件（凭据泄露，必须吊销/轮换）' },
  // ⚠️ 占位符不算：`xxx` / `...` / `user` / `<name>` 是文档与提示文案里的示意写法。
  //   同时吃两种写法：源码里的 `C:\\Users\\`（转义后双反斜杠）与真实路径 `C:\Users\`，以及 POSIX 的 `/Users/<name>/`。
  // ⚠️ 用户名段的下界**不许**写成 `{2,}`：单字符用户名是合法的，`{2,}` 会让**单字符用户名**的路径
  //   直接穿闸门（本机用户名就是单字符，实测过洞）。⇒ 下界 `{1,}`。
  { id: 'machine-home-path', re: /[A-Za-z]:\\{1,2}Users\\{1,2}(?!xxx|\.\.\.|user\b|username\b|<)[A-Za-z0-9_.-]{1,}|\/Users\/(?!xxx|\.\.\.|user\b|username\b|<)[A-Za-z0-9_.-]{1,}/, why: '本机绝对路径（含真实用户名）' },
  { id: 'session-id-ish', re: /\bsession[._-]?(?:id)?["'\s:=]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, why: '真实会话 id' },
  // ⚠️ 误报成因是「**空白 + 加号**」这个**拼接签名**（`' 引导脚本含专属 token=' + rtProbe.hasFit + '`），
  //   所以要否决的是**它**，不是加号本身 —— base64 / JWT 的真凭据**本身就含 `+`**，
  //   写成「值里不许有 `+`」会**漏掉真凭据**（那一档已被用例矩阵证伪）。
  //   口径：值里允许 `+`，只否决「空白+加号」；值必须同一行（`[^"'\r\n]`）。
  { id: 'auth-assignment', re: /["']?(?:token|_authToken|password|passwd|api[_-]?key)["']?\s*[:=]\s*["'](?![^"'\r\n]*[ \t]\+)[^"'\r\n]{16,}["']/i, why: '疑似把凭据写进配置/代码' },
]

/** 文件名规则：这些路径**不该被跟踪**（与 .gitignore 互补，且能挡住 `git add -f`）。 */
export const PATH_RULES = [
  { id: 'sessions-dir', re: /(?:^|\/)sessions?\//i, why: '会话记录目录（含私人对话、可能含凭据）' },
  { id: 'session-log', re: /\.(?:jsonl|zstd|jsonl\.zstd)$/i, why: '会话日志/压缩日志' },
  { id: 'dotenv', re: /(?:^|\/)\.env(?:\..*)?$/, why: '环境变量文件（常放凭据）' },
  { id: 'npmrc', re: /(?:^|\/)\.npmrc$/, why: 'npm 配置（可能含 _authToken）' },
  { id: 'token-file', re: /(?:^|\/)[^/]*(?:token|secret|credential|apikey|api-key)[^/]*$/i, why: '文件名里带 token/secret/credential' },
  { id: 'data-dir', re: /(?:^|\/)data\//i, why: '用户数据目录（global-regex.json 等，见 .gitignore）' },
  { id: 'tmp-artifact', re: /(?:^|\/)\.?tmp[-_.]/, why: '临时产物（分析脚本 / 报告），不该入库' },
  { id: 'backup', re: /(?:^|\/)[^/]*\.(?:bak|backup|old|orig)(?:[./]|$)/i, why: '备份文件' },
]

/** 只扫文本；超过这个大小或不是 UTF-8 文本的会**跳过，但必须出声**（见 scanDetailed）。 */
const MAX_SCAN = 2 * 1024 * 1024
const looksBinary = (buf) => buf.includes(0)
/** UTF-16（带 BOM 或不带 BOM 的 ASCII-in-UTF-16 形态）：闸门只扫 UTF-8 文本，这类要单独点名。 */
const looksUtf16 = (b) =>
  (b.length > 1 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) ||
  (b.length > 3 && ((b[1] === 0 && b[3] === 0) || (b[0] === 0 && b[2] === 0)))

function trackedFiles() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return null
  return r.stdout.split('\0').filter(Boolean)
}
function stagedFiles() {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return null
  return r.stdout.split('\0').filter(Boolean)
}

/**
 * 扫一批文件（路径为仓库相对路径）。
 *
 * ★ 为什么返回值里要带 `skipped`：**"0 处违规"只在"扫到的文件都对得起这个结论"时才成立**。
 *   超尺寸 / UTF-16 / 二进制会被跳过，静默跳过会让一句「✅ 通过」掩盖「N 个根本没看」。
 *   所以这里把跳过逐个记下来，由调用方**出声**（见下方 main）。
 *   区分两类：`binary`（真二进制，合法跳过，只告警）与 `oversize`/`utf16`（**文本却扫不了 ⇒ 判失败**）。
 * @returns {{issues: Array, skipped: Array<{file: string, kind: string, why: string}>}}
 */
export function scanDetailed(files, { readFromIndex = false } = {}) {
  const issues = []
  const skipped = []
  for (const rel of files) {
    const norm = rel.replace(/\\/g, '/')
    for (const p of PATH_RULES) if (p.re.test(norm)) issues.push({ file: norm, kind: 'path/' + p.id, why: p.why })
    let buf
    try {
      if (readFromIndex) {
        const r = spawnSync('git', ['show', ':' + norm], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
        if (r.status !== 0) { skipped.push({ file: norm, kind: 'unreadable', why: '拿不到索引内容（git show :<file> 失败）' }); continue }
        buf = r.stdout
      } else {
        buf = fs.readFileSync(path.join(REPO, norm))
      }
    } catch { skipped.push({ file: norm, kind: 'unreadable', why: '读不到工作树内容' }); continue }
    if (buf.length > MAX_SCAN) { skipped.push({ file: norm, kind: 'oversize', why: '> ' + Math.round(MAX_SCAN / 1024 / 1024) + ' MB（超扫描上限）' }); continue }
    if (looksUtf16(buf)) { skipped.push({ file: norm, kind: 'utf16', why: 'UTF-16（闸门只扫 UTF-8 文本）' }); continue }
    if (looksBinary(buf)) { skipped.push({ file: norm, kind: 'binary', why: '含 NUL（按二进制跳过）' }); continue }
    const text = buf.toString('utf8')
    for (const c of CONTENT_RULES) {
      const m = text.match(c.re)
      if (m) issues.push({ file: norm, kind: 'content/' + c.id, why: c.why, hit: String(m[0]).slice(0, 12) + '…' })
    }
  }
  return { issues, skipped }
}

/** 只返回违规列表（给只关心违规的调用方；跳过明细走 scanDetailed）。 */
export function scan(files, opts = {}) {
  return scanDetailed(files, opts).issues
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--list')) {
    for (const r of CONTENT_RULES) console.log('内容 ' + r.id + '：' + r.why)
    for (const r of PATH_RULES) console.log('路径 ' + r.id + '：' + r.why)
    process.exit(0)
  }
  const staged = argv.includes('--staged')
  const files = staged ? stagedFiles() : trackedFiles()
  if (files === null) { console.error('❌ 不是 git 仓库（拿不到文件清单）'); process.exit(1) }
  if (!files.length) { console.log('（' + (staged ? '暂存区' : '已跟踪文件') + '为空，跳过）'); process.exit(0) }
  const { issues, skipped } = scanDetailed(files, { readFromIndex: staged })

  // ★ 跳过必须出声：否则「0 处违规」会掩盖「N 个文件根本没扫」。
  //   分两类：真二进制是合法跳过（只告警）；**文本却扫不了**（超尺寸 / UTF-16 / 读不到）⇒ 判失败，
  //   因为那意味着这次的"通过"没有覆盖它们。
  if (skipped.length) {
    const byKind = {}
    for (const s of skipped) byKind[s.kind] = (byKind[s.kind] || 0) + 1
    console.error('⚠️ 跳过 ' + skipped.length + ' 个文件（**未扫描**）：' +
      Object.entries(byKind).map(([k, v]) => k + '×' + v).join('  '))
    for (const s of skipped) console.error('   · ' + s.file + '  [' + s.kind + '] ' + s.why)
    const hard = skipped.filter((s) => s.kind !== 'binary')
    if (hard.length) {
      console.error('\n❌ 其中 ' + hard.length + ' 个是**文本却扫不了** ⇒ 本次的"通过"覆盖不到它们：' +
        '请转成 UTF-8 文本、或把它们移出仓库（超尺寸/UTF-16 正是能藏东西的两类形态）。')
      process.exit(1)
    }
    console.error('   （以上都是真二进制，按设计跳过；下面这句"通过"不覆盖它们的内容）')
  }

  if (issues.length) {
    console.error('❌ 仓库卫生检查不通过（' + issues.length + ' 处）—— ' + (staged ? '这次提交被拦下了' : '仓库里不该有这些东西') + '：')
    for (const i of issues) console.error('   ' + i.file + '  [' + i.kind + '] ' + i.why + (i.hit ? '  ' + i.hit : ''))
    console.error('\n   凭据请立刻吊销/轮换（GitHub PAT、npm token）；会话记录/用户数据/临时产物请移出仓库并 gitignore。')
    process.exit(1)
  }
  console.log('✅ 仓库卫生检查通过：' + files.length + ' 个' + (staged ? '暂存' : '已跟踪') + '文件，无凭据/会话记录/本机路径/临时产物' +
    (skipped.length ? '（跳过 ' + skipped.length + ' 个二进制，见上）' : ''))
}
