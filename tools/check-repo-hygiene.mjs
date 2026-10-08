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
  { id: 'machine-home-path', re: /[A-Za-z]:\\{1,2}Users\\{1,2}(?!xxx|\.\.\.|user\b|username\b|<)[A-Za-z0-9_.-]{2,}|\/Users\/(?!xxx|\.\.\.|user\b|username\b|<)[A-Za-z0-9_.-]{2,}/, why: '本机绝对路径（含真实用户名）' },
  { id: 'session-id-ish', re: /\bsession[._-]?(?:id)?["'\s:=]+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, why: '真实会话 id' },
  // ⚠️ 赋值右侧的值里**不许出现 `+` 或换行**：否则规则会跨字符串边界误报。
  //   实测本仓 `verify-card-compat.mjs` 有 `' 引导脚本含专属 token=' + rtProbe.hasFit + …`，
  //   朴素写法会把 `token=' + rtProbe.hasFit +  '` 当成"password/token 赋了一个很长的字面量"。
  //   真凭据不会长在一个拼接表达式里 ⇒ 收紧到"同一行、无 `+` 的纯字面量"（不误报，也不放水）。
  { id: 'auth-assignment', re: /["']?(?:token|_authToken|password|passwd|api[_-]?key)["']?\s*[:=]\s*["'][^"'+\n]{16,}["']/i, why: '疑似把凭据写进配置/代码' },
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

/** 只扫文本；超过这个大小或含 NUL 的跳过（不猜二进制）。 */
const MAX_SCAN = 2 * 1024 * 1024
const looksBinary = (buf) => buf.includes(0)

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

/** 扫一批文件（路径为仓库相对路径）。@returns 违规列表 */
export function scan(files, { readFromIndex = false } = {}) {
  const issues = []
  for (const rel of files) {
    const norm = rel.replace(/\\/g, '/')
    for (const p of PATH_RULES) if (p.re.test(norm)) issues.push({ file: norm, kind: 'path/' + p.id, why: p.why })
    let buf
    try {
      if (readFromIndex) {
        const r = spawnSync('git', ['show', ':' + norm], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
        if (r.status !== 0) continue
        buf = r.stdout
      } else {
        buf = fs.readFileSync(path.join(REPO, norm))
      }
    } catch { continue }
    if (buf.length > MAX_SCAN || looksBinary(buf)) continue
    const text = buf.toString('utf8')
    for (const c of CONTENT_RULES) {
      const m = text.match(c.re)
      if (m) issues.push({ file: norm, kind: 'content/' + c.id, why: c.why, hit: String(m[0]).slice(0, 12) + '…' })
    }
  }
  return issues
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
  const issues = scan(files, { readFromIndex: staged })
  if (issues.length) {
    console.error('❌ 仓库卫生检查不通过（' + issues.length + ' 处）—— ' + (staged ? '这次提交被拦下了' : '仓库里不该有这些东西') + '：')
    for (const i of issues) console.error('   ' + i.file + '  [' + i.kind + '] ' + i.why + (i.hit ? '  ' + i.hit : ''))
    console.error('\n   凭据请立刻吊销/轮换（GitHub PAT、npm token）；会话记录/用户数据/临时产物请移出仓库并 gitignore。')
    process.exit(1)
  }
  console.log('✅ 仓库卫生检查通过：' + files.length + ' 个' + (staged ? '暂存' : '已跟踪') + '文件，无凭据/会话记录/本机路径/临时产物')
}
