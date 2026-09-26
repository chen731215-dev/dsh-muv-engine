// 门禁：卡 iframe 垫片里的「音频兜底」
//
// 背景（现场取证，2026-09-22）：那张卡的 `processAudio()` 按消息里的 `<audio>日常</audio>`
// 拼 `${BASE_URL}音频/日常.mp3`，而 CDN 上的实际文件名**带序号**：
//   音频/日常.mp3 → 404   音频/日常1.mp3 → 200（搞笑/欢快/暧昧 同样）
// 于是播放器一片空白（卡自己的 error 处理只是把提示调暗）。
//
// 垫片在**真的加载失败**时兜一次：`<名字><1..3>.mp3`。三档必测：
//   ① 裸名失败 ⇒ 改写为 <名字>1.mp3（`<source>` 形态与 `src` 属性形态都要覆盖）
//   ② 已经带序号的名字（日常1）⇒ **一个字符都不许改**（不许把正解猜坏）
//   ③ 候选全失败 ⇒ 最多试 3 次就停（不许无限重试打 CDN）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openPage, evalJson, sleep } from './verify-shared.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SRC = fs.readFileSync(path.join(HERE, 'lib/client.js'), 'utf8')

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name) } else { fail++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')) }
}

// ── 从 client.js 里把那段垫片代码逐字取出来（它就是若干字符串字面量的拼接）────
const lines = SRC.split('\n')
const iStart = lines.findIndex((l) => l.includes('var __muvAudioTried='))
let iEnd = -1
for (let i = iStart; i < lines.length; i++) if (lines[i].includes('addEventListener("error"')) { iEnd = i; break }
if (iStart < 0 || iEnd < 0) { console.log('FAIL 取不到垫片里的音频兜底代码'); process.exit(1) }
const expr = lines.slice(iStart, iEnd + 1).join('\n').replace(/\s+\+\s*$/, '')
const SHIM = new Function('return (' + expr + ')')()
check('从 client.js 取出垫片兜底代码（字符串拼接求值成功）', typeof SHIM === 'string' && SHIM.includes('__muvAudioFix'), String(SHIM).slice(0, 60))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-audio-'))
const audioDir = path.join(tmpDir, '足控天堂', '音频')
fs.mkdirSync(audioDir, { recursive: true })
// 造一个**真能加载**的最小 MP3（MPEG-1 Layer3 / 44.1kHz / 128kbps，10 帧静音）。
// 用途：验证"兜到能播的那个就停"，而不是一路兜到上限。
{
  const frame = Buffer.alloc(417)
  frame[0] = 0xFF; frame[1] = 0xFB; frame[2] = 0x90; frame[3] = 0x00
  fs.writeFileSync(path.join(audioDir, '成功1.mp3'), Buffer.concat(Array.from({ length: 10 }, () => frame)))
}
// 一个一定不存在的目录 —— 用 file:// 触发即时 404，别打真 CDN
const base = 'file:///' + audioDir.replace(/\\/g, '/') + '/'
const page = '<!DOCTYPE html><html><body>' +
  '<audio id="a" preload="auto"><source src="' + base + encodeURIComponent('日常') + '.mp3" type="audio/mpeg"></audio>' +
  '<audio id="b" preload="auto"><source src="' + base + encodeURIComponent('日常1') + '.mp3" type="audio/mpeg"></audio>' +
  '<audio id="c" preload="auto" src="' + base + encodeURIComponent('搞笑') + '.mp3"></audio>' +
  '<audio id="d" preload="auto"><source src="' + base + encodeURIComponent('无名') + '.mp3" type="audio/mpeg"></audio>' +
  '<audio id="e" preload="auto"><source src="' + base + encodeURIComponent('成功') + '.mp3" type="audio/mpeg"></audio>' +
  '<script>' + SHIM + '<\/script>' +
  '<script>' +
  'setTimeout(function(){["a","b","c","d","e"].forEach(function(id){var e=document.getElementById(id);try{e.load()}catch(_){}})},50);' +
  'window.__read = function(){' +
  'function srcOf(id){var e=document.getElementById(id);var s=e.querySelector&&e.querySelector("source");return (s&&s.getAttribute("src"))||e.getAttribute("src")||""}' +
  'return JSON.stringify({a:srcOf("a"),b:srcOf("b"),c:srcOf("c"),d:srcOf("d"),e:srcOf("e"),tried:JSON.stringify(window.__muvAudioTried||{}),eReady:document.getElementById("e").readyState})}' +
  '<\/script></body></html>'
const file = path.join(tmpDir, 'audio.html')
fs.writeFileSync(file, page, 'utf8')

const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1000,700' })
try {
  await sleep(3500)
  const q = await evalJson(rt.cdp, 'window.__read()', rt.pageSession)
  const o = typeof q === 'string' ? JSON.parse(q) : q
  const tried = JSON.parse(o.tried)
  const dec = (s) => { try { return decodeURIComponent(String(s)) } catch (_) { return String(s) } }
  console.log('\n  实测结果:')
  for (const k of ['a', 'b', 'c', 'd', 'e']) console.log('    ' + k + ' = ' + dec(o[k]))
  console.log('    重试计数 = ' + o.tried + '   e.readyState=' + o.eReady)

  check('★ 裸名 日常.mp3 失败 ⇒ 兜到 日常1.mp3（<source> 形态）',
    dec(o.a).endsWith('日常1.mp3') || dec(o.a).endsWith('日常3.mp3'), dec(o.a))
  check('★★ 已带序号 日常1.mp3 ⇒ 一个字符都没改',
    o.b === base + encodeURIComponent('日常1') + '.mp3', dec(o.b))
  check('★ src 属性形态（搞笑.mp3）同样兜住', /搞笑\d\.mp3$/.test(dec(o.c)), dec(o.c))
  check('★★ 候选全 404 ⇒ 最多试到 3 就停，不再打第 4 次',
    tried['无名'] === 3 && dec(o.d).endsWith('无名3.mp3'), o.tried + ' / ' + dec(o.d))
  check('★★ 兜到能播的那个就停（成功1.mp3 真实存在，readyState>0）',
    tried['成功'] === 1 && dec(o.e).endsWith('成功1.mp3') && o.eReady > 0,
    o.tried + ' / ' + dec(o.e) + ' / readyState=' + o.eReady)
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===')
process.exit(fail ? 1 : 0)
