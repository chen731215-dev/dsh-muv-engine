// 从 SillyTavern PNG 卡里解出 chara 块，落地成 JSON，供后续调查使用。
// 只读，不改任何原文件。
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'
const OUT = 'C:\\dsh-muv-engine\\_vid-invest\\cards'
fs.mkdirSync(OUT, { recursive: true })

function readPngChara(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  let off = 8
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const dataStart = off + 8
    if (type === 'tEXt' || type === 'iTXt') {
      const chunk = buf.subarray(dataStart, dataStart + len)
      const z = chunk.indexOf(0)
      if (z < 0) { off = dataStart + len + 4; continue }
      const keyword = chunk.toString('latin1', 0, z)
      if (keyword !== 'chara') { off = dataStart + len + 4; continue }
      if (type === 'tEXt') {
        return chunk.toString('latin1', z + 1)
      }
      // iTXt: keyword \0 compFlag(1) compMethod(1) \0 langTag \0 transKeyword \0 text
      let p = z + 1
      const compFlag = chunk[p]; const compMethod = chunk[p + 1]
      p += 2
      p = chunk.indexOf(0, p) + 1
      p = chunk.indexOf(0, p) + 1
      const text = chunk.subarray(p)
      if (compFlag === 1) return null // 压缩的少见，先跳过
      return text.toString('utf8')
    }
    if (type === 'IEND') break
    off = dataStart + len + 4
  }
  return null
}

const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.png'))
const report = []
for (const f of files) {
  const full = path.join(DIR, f)
  let b64 = null
  try { b64 = readPngChara(fs.readFileSync(full)) } catch (e) { report.push({ f, error: String(e) }); continue }
  if (!b64) { report.push({ f, chara: 'NONE' }); continue }
  let json
  try { json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) } catch (e) {
    try { json = JSON.parse(b64) } catch (e2) { report.push({ f, error: 'json: ' + e }); continue }
  }
  const safe = f.replace(/[^\w\u4e00-\u9fff.-]/g, '_') + '.json'
  fs.writeFileSync(path.join(OUT, safe), JSON.stringify(json, null, 2), 'utf8')
  const d = json.data || json
  const scripts = (d.extensions && d.extensions.regex_scripts) || []
  report.push({
    f,
    saved: safe,
    name: d.name,
    scripts: scripts.length,
    keys: Object.keys(d),
  })
}
console.log(JSON.stringify(report, null, 2))
