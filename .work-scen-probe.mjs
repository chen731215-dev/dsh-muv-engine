// 临时探针：为什么合成场景文档的 iframe 一条 __muvFrameHeight 都不报？
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
console.log('iframe HTML 长度 = ' + out.length)
console.log('含引导专属 token = ' + (out.indexOf('__muvHFitProbe') !== -1))
console.log('含 __muvFrameHeight = ' + (out.indexOf('__muvFrameHeight') !== -1))
console.log('含 __muvH=1 = ' + (out.indexOf('window.__muvH=1') !== -1))
console.log('height:NNNpx 出现处 = ' + JSON.stringify(out.match(/.{0,24}height:\d+px.{0,8}/g)))
// 起始高度改写是否命中了卡文档里的东西（而不是 wrapper）
const rewritten = out.replace(/height:\d+px/, 'height:600px')
console.log('首次替换命中片段 = ' + JSON.stringify(out.match(/.{0,40}height:\d+px.{0,6}/)[0]))
console.log('替换后与原文差异处数 = ' + (rewritten === out ? 0 : 1))
// srcdoc 里套了 script 结束标签吗
console.log('srcdoc 里 </scr' + 'ipt> 数 = ' + (out.match(/<\/scr/g) || []).length)
