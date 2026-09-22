// 临时：合成场景文档经 cardHtmlIframe 之后，srcdoc 里还是不是原样？（纯 Node，不用浏览器）
import { loadClientRenderers } from './test-client-source.mjs'

const R = loadClientRenderers()
const SCEN = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<style>html,body{margin:0;padding:0;height:100%}#big{background:#223}</style>' +
  '</head><body><div id="big">BIG</div>' +
  '<scr' + 'ipt>(function(){var b=document.getElementById("big");b.style.height="1200px";' +
  'function kick(){try{window.dispatchEvent(new Event("load"))}catch(e){}}' +
  'var n=0;var iv=setInterval(function(){kick();if(++n>30)clearInterval(iv)},150);' +
  'setTimeout(function(){b.style.height="40px"},2000);})();</scr' + 'ipt></body></html>'

const out = R.cardHtmlIframe(SCEN)
const m = /srcdoc="([\s\S]*?)"\s/.exec(out) || /srcdoc="([\s\S]*?)">/.exec(out)
const raw = m ? m[1] : ''
const un = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
console.log('srcdoc 抓到了吗 = ' + !!m + ' 长度=' + raw.length + ' 解码后=' + un.length + ' 原文档=' + SCEN.length)
// 剥掉注入链再逐字比较
function cutScript(s, token) {
  const i = s.indexOf(token); if (i < 0) return s
  const a = s.lastIndexOf('<scr', i); const b = s.indexOf('</scr', i)
  return a < 0 || b < 0 ? s : s.slice(0, a) + s.slice(b + 8)
}
let stripped = cutScript(cutScript(un, '__muvHFit'), '__muvKvSeed')
const rs = stripped.indexOf('<style data-muv-reset')
if (rs >= 0) {
  const rEnd = stripped.indexOf('</style>', rs) + 8
  const metaStart = stripped.lastIndexOf('<meta name="viewport"', rs)
  stripped = stripped.slice(0, metaStart < 0 ? rs : metaStart) + stripped.slice(rEnd)
}
console.log('剥后 === 原文档 ? ' + (stripped === SCEN))
if (stripped !== SCEN) {
  let i = 0
  while (i < Math.min(stripped.length, SCEN.length) && stripped[i] === SCEN[i]) i++
  console.log('首处不同 @' + i + '\n  剥后: ' + JSON.stringify(stripped.slice(Math.max(0, i - 60), i + 60)) +
    '\n  原文: ' + JSON.stringify(SCEN.slice(Math.max(0, i - 60), i + 60)))
}
