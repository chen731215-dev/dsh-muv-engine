// verify-guard-samples.gen.mjs
//
// 从**真实会话存档**里抠出本门禁要用的三段助手正文，写成 `verify-guard-samples.json`。
//
// 为什么单独留一个生成器（而不是把样本抄进门禁里）：
//   本项目反复栽在「测的不是被测对象」上。样本必须可追溯到**具体会话 + 具体判据**，
//   而不是"某次手抄的一段文本"。生成器把「哪一条、按什么判据抠出来的、抠出来多少字、
//   SHA-256 是多少」全部写进 JSON；门禁只读 JSON 并核对哈希，README 式的样板不再漂移。
//
// 存档格式：`<sessions>/<project>/<session-id>/session.v3.jsonl.zstd`，
//   多帧 zstd（按 frame magic 0x28B52FFD 切开逐帧解），每行一个 JSON 事件。
//
// 三段样本（全部来自同一个真实角色扮演会话 `session-c98dfb13-…`，
//   卡 = `_足控天堂2`（10 条正则脚本），见 `.AGENT-BRIEF.md` / card-dump）：
//
//   audioOnly      判据：正文含 `<audio>欢快</audio>`、且不含 `<content>`/`<now_plot>`
//                  ⇒ 旧枚举守卫**整轮跳过**的那一轮（用户报的"纯文本"）。
//   mediaEnvelope  判据：正文含 `<content>` + `<video>` + `<img>`
//                  ⇒ 旧枚举守卫放行的那一轮（同一会话的上一轮，媒体/整页美化都生效）。
//   proseOnly      判据：以 `#### ` 场景表头开头、正文里一个 `<` 都没有、长度 > 600、非开发文本形态
//                  ⇒ "纯散文也必须被跳过"的反向用例（同一会话的另一轮真实角色扮演正文）。
//
// 运行：node verify-guard-samples.gen.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SESSIONS = process.env.MUV_SESSIONS || 'C:/Users/21334/.dsh/sessions'
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'verify-guard-samples.json')
const FZSTD_CANDIDATES = [
  'C:/Users/21334/.dsh/_tmp_zstd/node_modules/fzstd',
  'fzstd',
]

function loadFzstd() {
  for (const p of FZSTD_CANDIDATES) {
    try { return require(p) } catch (_) { /* 继续找 */ }
  }
  return null
}

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
export function splitFrames(buf) {
  const offs = []
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offs.push(i)
  }
  if (!offs.length) return [buf]
  const out = []
  for (let k = 0; k < offs.length; k++) out.push(buf.subarray(offs[k], k + 1 < offs.length ? offs[k + 1] : buf.length))
  return out
}

export function readSessionLines(file, fzstd) {
  const frames = splitFrames(fs.readFileSync(file))
  let text = ''
  let failed = 0
  for (const f of frames) {
    try { text += Buffer.from(fzstd.decompress(f)).toString('utf8') } catch (_) { failed++ }
  }
  const lines = []
  for (const l of text.split('\n')) {
    const s = l.trim()
    if (!s) continue
    try { lines.push(JSON.parse(s)) } catch (_) { /* 半行丢弃 */ }
  }
  return { lines, frames: frames.length, failed }
}

export function listSessionLogs(root) {
  const out = []
  const walk = (dir, depth) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1) }
      else if (e.name === 'session.v3.jsonl.zstd') out.push({ file: p, session: path.basename(dir), project: path.basename(path.dirname(dir)) })
    }
  }
  walk(root, 0)
  return out
}

const DEV = /\[(PASS|FAIL|OK|warn)\]|^\s*(Now|Let me|I'll|The |Arm |Both )|```(js|javascript|mjs|json)\b|已发给父代理|报告已发给|probe|fixture|正则|源码|行号|grep/m

export function extractSamples(target = 'c98dfb13') {
  const fzstd = loadFzstd()
  if (!fzstd) return { error: 'fzstd 不可用（找不到解压库）' }
  const out = { audioOnly: null, mediaEnvelope: null, proseOnly: null, candidates: { prose: 0, scans: 0 } }
  for (const l of listSessionLogs(SESSIONS)) {
    if (l.session.indexOf(target) < 0) continue
    const { lines } = readSessionLines(l.file, fzstd)
    out.source = { session: l.session, project: l.project, file: l.file }
    for (const line of lines) {
      if (line.type !== 'assistant/message') continue
      const content = line.data && line.data.message && line.data.message.content
      if (!Array.isArray(content)) continue
      for (const part of content) {
        if (!part || part.type !== 'text') continue
        const t = String(part.text || '')
        if (t.length < 30) continue
        out.candidates.scans++
        if (!out.audioOnly && /<audio>欢快<\/audio>/.test(t) && !/<content/.test(t) && !/<now_plot/.test(t)) out.audioOnly = t
        if (!out.mediaEnvelope && /<content/.test(t) && /<video>/.test(t) && /<img>/.test(t)) out.mediaEnvelope = t
        if (!out.proseOnly && /^####\s/.test(t) && t.indexOf('<') < 0 && t.length > 600 && !DEV.test(t)) out.proseOnly = t
      }
    }
  }
  return out
}

const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16)

if (process.argv[1] && /verify-guard-samples\.gen\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const s = extractSamples()
  if (s.error) { console.log('FAIL ' + s.error); process.exit(1) }
  console.log('来源会话: ' + s.source.session + '  (' + s.source.project + ')')
  console.log('扫过助手正文段: ' + s.candidates.scans)
  const doc = {
    _provenance: {
      note: '真实角色扮演会话里的助手正文，非合成、非开发文本。由 verify-guard-samples.gen.mjs 生成。',
      session: s.source.session,
      project: s.source.project,
      file: s.source.file,
      card: '_足控天堂2（10 条正则脚本；与 card-dump/ 里那份一致）',
      criteria: {
        audioOnly: 'text 含 <audio>欢快</audio> 且不含 <content>/<now_plot>（= 旧枚举守卫整轮跳过的那一轮）',
        mediaEnvelope: 'text 含 <content> + <video> + <img>（= 旧枚举守卫放行的那一轮）',
        proseOnly: 'text 以 "#### " 场景表头开头、正文里一个 "<" 都没有、长度 > 600、非开发文本形态（= 纯散文反向用例）',
      },
      sha256_16: {},
    },
    audioOnly: s.audioOnly,
    mediaEnvelope: s.mediaEnvelope,
    proseOnly: s.proseOnly,
  }
  for (const k of ['audioOnly', 'mediaEnvelope', 'proseOnly']) {
    doc._provenance.sha256_16[k] = doc[k] ? sha(doc[k]) : null
    console.log('  ' + k.padEnd(14) + ' len=' + (doc[k] ? doc[k].length : 0) + ' sha16=' + doc._provenance.sha256_16[k])
  }
  if (!doc.audioOnly || !doc.mediaEnvelope || !doc.proseOnly) { console.log('FAIL 有样本没抠出来'); process.exit(1) }
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1), 'utf8')
  console.log('\n-> ' + OUT)
}
