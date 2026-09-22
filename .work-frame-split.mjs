// 多帧 zstd 会话日志读取器（按 frame magic 切开逐帧解）。
// 供本轮的门禁/取样脚本 import。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// fzstd 装在用户态的临时目录里（不在本仓 node_modules）。
const FZSTD_PATHS = [
  '<home>/.dsh/_tmp_zstd/node_modules/fzstd',
]
let fzstd = null
for (const p of FZSTD_PATHS) {
  try { fzstd = require(p); break } catch (e) { /* 继续找 */ }
}
if (!fzstd) throw new Error('找不到 fzstd 解压库')

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/** 按 zstd frame magic 把 buffer 切成若干帧。 */
export function splitFrames(buf) {
  const offs = []
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) offs.push(i)
  }
  if (!offs.length) return [buf]
  const out = []
  for (let k = 0; k < offs.length; k++) {
    const end = k + 1 < offs.length ? offs[k + 1] : buf.length
    out.push(buf.subarray(offs[k], end))
  }
  return out
}

/** 读一个 .jsonl.zstd 会话日志，返回解析后的 JSON 行数组。 */
export function readSessionLines(file) {
  const buf = fs.readFileSync(file)
  const frames = splitFrames(buf)
  const chunks = []
  let failed = 0
  for (const f of frames) {
    try { chunks.push(Buffer.from(fzstd.decompress(f)).toString('utf8')) }
    catch (e) { failed++ }
  }
  const text = chunks.join('')
  const lines = []
  for (const l of text.split('\n')) {
    const s = l.trim()
    if (!s) continue
    try { lines.push(JSON.parse(s)) } catch (e) { /* 半行，丢弃 */ }
  }
  return { lines, frames: frames.length, failed }
}

/** 枚举所有会话日志。 */
export function listSessionLogs(root = '<home>/.dsh/sessions') {
  const out = []
  const walk = (dir, depth) => {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1) }
      else if (e.name === 'session.v3.jsonl.zstd') out.push({ file: p, project: path.basename(path.dirname(dir)), session: path.basename(dir), mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size })
    }
  }
  walk(root, 0)
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** 从一行里抠出所有字符串字段（含嵌套），用于找助手正文。 */
export function stringsIn(obj, out = []) {
  if (obj == null) return out
  if (typeof obj === 'string') { out.push(obj); return out }
  if (Array.isArray(obj)) { for (const v of obj) stringsIn(v, out); return out }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) stringsIn(obj[k], out); return out }
  return out
}
