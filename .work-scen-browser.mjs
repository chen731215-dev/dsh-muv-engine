// 临时诊断：合成场景文档的 iframe 到底有没有 postMessage？（真无头 Edge + 记所有 message）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openPage, evalJson, sleep } from './verify-shared.mjs'
import { loadClientRenderers } from './test-client-source.mjs'

const R = loadClientRenderers()
const SCEN = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<style>html,body{margin:0;padding:0;height:100%}#big{background:#223}</style>' +
  '</head><body><div id="big">BIG</div>' +
  '<scr' + 'ipt>(function(){var b=document.getElementById("big");b.style.height="1200px";' +
  'try{parent.postMessage({__probeAlive:1},"*")}catch(e){}' +
  'function kick(){try{window.dispatchEvent(new Event("load"))}catch(e){}}' +
  'var n=0;var iv=setInterval(function(){kick();if(++n>30)clearInterval(iv)},150);' +
  'setTimeout(function(){b.style.height="40px"},2000);})();</scr' + 'ipt></body></html>'

const iframe = R.cardHtmlIframe(SCEN).replace(/height:\d+px/, 'height:600px')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-scendiag-'))
const page = path.join(tmp, 'p.html')
fs.writeFileSync(page, '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + iframe +
  '<pre id="out"></pre>' +
  '<scr' + 'ipt>var all=[];window.addEventListener("message",function(e){' +
  'var d=e.data;all.push({keys:d&&Object.keys(d).join("+"),h:d&&d.__muvFrameHeight,alive:d&&d.__probeAlive,src:!!e.source});' +
  'document.getElementById("out").textContent=JSON.stringify(all.slice(-40));});' +
  '</scr' + 'ipt></body></html>', 'utf8')

const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const { cdp, pageSession, close } = await openPage(EDGE, { url: 'file:///' + page.replace(/\\/g, '/'), outDir: tmp, windowSize: '1200,900' })
const ev = (x) => evalJson(cdp, x, pageSession)
try {
  await sleep(2500)
  console.log('2.5s: ' + JSON.stringify(await ev('JSON.stringify({n:document.querySelectorAll("iframe").length,h:document.querySelector("iframe").style.height,msg:(document.getElementById("out").textContent||"").slice(0,500)})')))
  await sleep(4000)
  console.log('6.5s: ' + JSON.stringify(await ev('JSON.stringify({h:document.querySelector("iframe").style.height,msg:(document.getElementById("out").textContent||"").slice(0,900)})')))
  const sc = await ev('document.querySelector("iframe").getAttribute("srcdoc")')
  const s = String(sc)
  console.log('srcdoc 含 __muvHFitProbe=' + (s.indexOf('__muvHFitProbe') >= 0) + ' 含 __probeAlive=' + (s.indexOf('__probeAlive') >= 0) +
    ' sandbox=' + s.slice(0, 0) + (await ev('document.querySelector("iframe").getAttribute("sandbox")')))
  // 直接把 iframe 的 srcdoc 里那段脚本位置打出来
  const i = s.indexOf('__probeAlive')
  console.log('srcdoc 里 __probeAlive 上下文: ' + JSON.stringify(s.slice(Math.max(0, i - 120), i + 80)))
} finally {
  close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
}
