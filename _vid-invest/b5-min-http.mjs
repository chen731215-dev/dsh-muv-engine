// B 步最小复现（HTTP 版，去掉 file:// 与 virtual-time 两个干扰因素）
//
// 判据：把真卡的视频 URL 放进 srcdoc iframe，在 4 种沙箱配置下判定
//   <video> 有没有进 DOM / readyState / networkState / error / duration / currentTime。
// 等待方式：页面里放一个 `/hold?ms=N` 的 <img>，服务端延迟 N 毫秒才应答 ⇒ load 事件被
//   推迟 ⇒ `--dump-dom` 会在结果就绪之后才抓（`--virtual-time-budget` 会秒过计时器，
//   `--timeout` 又不等，两者都测不出东西 —— 这是本轮踩过的坑）。
import { writeFileSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const OUT = path.join(os.tmpdir(), 'muv-vid-invest')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const IMGC = 'https://cdn.imgchest.com/files/52819694c39a.mp4'
const ZYX = 'https://zyxjack123.top/足控天堂/视频/主页视频/哈珂斯·贝尔丝.mp4'
const HOLD_MS = Number(process.env.MUV_HOLD || 40000)

const probe = (label, delay) => `<script>(function(){
function snap(){var out=[],vs=document.getElementsByTagName('video');
for(var i=0;i<vs.length;i++){var v=vs[i],r=v.getBoundingClientRect();
out.push({id:v.id||'',rs:v.readyState,ns:v.networkState,err:v.error?(v.error.code+':'+String(v.error.message||'').slice(0,50)):'',
paused:v.paused,vw:v.videoWidth,vh:v.videoHeight,dur:isFinite(v.duration)?Math.round(v.duration*10)/10:-1,
t:Math.round(v.currentTime*100)/100,disp:getComputedStyle(v).display,rect:Math.round(r.width)+'x'+Math.round(r.height),
cur:String(v.currentSrc||'').slice(-46)});}
var de=document.documentElement;
return {muv:'${label}',n:vs.length,origin:String(location.origin),
scripts:document.getElementsByTagName('script').length,imgs:document.getElementsByTagName('img').length,
docH:Math.max(de.scrollHeight, document.body?document.body.scrollHeight:0),videos:out};}
function post(t){try{var s=snap();s.muv=t;parent.postMessage(s,'*')}catch(e){
try{parent.postMessage({muv:'POST-THROW',msg:String(e&&e.message)},'*')}catch(_){}}}
try{post('${label}-t0')}catch(e){try{parent.postMessage({muv:'OUTER-THROW',msg:String(e&&e.message)},'*')}catch(_){}}
setTimeout(function(){post('${label}-t${delay}')},${delay});
})()</` + `script>`

const DOC = (label, delay) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222;color:#fff}</style></head><body>
<video id="v1" src="${IMGC}" controls preload="metadata"></video>
<video id="v2" src="${ZYX}" controls preload="metadata"></video>
${probe(label, delay)}
</body></html>`

const j = (s) => JSON.stringify(s).replace(/<\//g, '<\\/')
const CFG = [
  ['T1_allow-scripts', 'allow-scripts'],
  ['T2_allow-scripts+same-origin', 'allow-scripts allow-same-origin'],
  ['T3_no-sandbox', null],
  ['T4_sandbox-empty', ''],
]
const LABEL_DELAY = 7000

const page = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>min-http</title>
<style>html,body{margin:0;background:#111;color:#ddd;font:12px monospace}pre.o{position:fixed;left:0;background:#000;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%;z-index:9}</style>
</head><body>
<div id="stage"></div>
<img src="/hold" width="1" height="1" alt="">
<script>
(function(){
 var CFG = ${j(CFG)};
 var docs = ${j(CFG.map(c => [c[0], DOC(c[0], LABEL_DELAY)]))};
 var reports = [], lines = [], curFrame = null, idx = 0, startAt = Date.now();
 function paint(){
   ['rep','lin','meta'].forEach(function(id){ var e=document.getElementById(id); if(e) e.remove() });
   var a=document.createElement('pre'); a.id='rep'; a.className='o'; a.textContent=reports.join('\\n'); a.style.top='0'; a.style.color='#0ff';
   var b=document.createElement('pre'); b.id='lin'; b.className='o'; b.textContent=lines.join('\\n'); b.style.bottom='0'; b.style.color='#ff0';
   var c=document.createElement('pre'); c.id='meta'; c.className='o'; c.textContent='META elapsed='+(Date.now()-startAt)+'ms frames='+document.querySelectorAll('iframe').length; c.style.right='0'; c.style.top='0'; c.style.color='#8b93a1';
   document.body.appendChild(a); document.body.appendChild(b); document.body.appendChild(c);
 }
 window.addEventListener('message',function(ev){
   var d=ev.data; if(!d||!d.muv) return;
   reports.push('GET '+d.muv+' n='+d.n+' origin='+d.origin+' scripts='+d.scripts+' imgs='+d.imgs+' docH='+d.docH
     +(d.msg?(' MSG='+d.msg):'')
     +(d.videos||[]).map(function(v){return ' || '+v.id+' rs='+v.rs+' ns='+v.ns+' err='+(v.err||'-')+' paused='+v.paused+
       ' '+v.vw+'x'+v.vh+' dur='+v.dur+' t='+v.t+' disp='+v.disp+' rect='+v.rect+' cur='+v.cur}).join(''));
   paint();
 });
 function parentProbe(tag){
   try{
     var d = curFrame && curFrame.contentDocument;
     if(!d){ lines.push('PARENT '+tag+' contentDocument=null(跨源不可读)'); return }
     var vs=d.getElementsByTagName('video');
     var s='PARENT '+tag+' rs='+d.readyState+' nv='+vs.length;
     for(var i=0;i<vs.length;i++){var v=vs[i]; s+=' || '+(v.id||'')+' rs='+v.readyState+' ns='+v.networkState+
       ' err='+(v.error?v.error.code:'-')+' '+v.videoWidth+'x'+v.videoHeight+' dur='+(isFinite(v.duration)?Math.round(v.duration*10)/10:-1)+
       ' t='+Math.round(v.currentTime*100)/100+' cur='+String(v.currentSrc||'').slice(-40)}
     lines.push(s);
   }catch(e){ lines.push('PARENT '+tag+' THROW:'+e.message) }
 }
 function step(){
   if(idx>=docs.length){ lines.push('DONE'); paint(); return }
   var c=docs[idx], cfg=CFG[idx]; idx++;
   var stage=document.getElementById('stage'); stage.innerHTML='';
   var f=document.createElement('iframe'); f.id='f_'+c[0];
   if(cfg[1]!==null) f.setAttribute('sandbox',cfg[1]);
   f.setAttribute('style','width:640px;height:360px;border:1px solid #555');
   stage.appendChild(f); curFrame=f;
   reports.push('=== '+c[0]+' sandbox="'+String(cfg[1])+'" ===');
   lines.push('MOUNT '+c[0]+' sandboxAttr='+String(f.getAttribute('sandbox')));
   f.setAttribute('srcdoc', c[1]);
   paint();
   setTimeout(function(){ parentProbe(c[0]+'/p') }, 9000);
   setTimeout(step, 11000);
 }
 step();
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'min-http.html')
writeFileSync(file, page, 'utf8')

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0]
  if (u === '/hold') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' })
      res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'))
    }, HOLD_MS)
    return
  }
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page)
    return
  }
  res.writeHead(404); res.end('nope')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const url = `http://127.0.0.1:${port}/`
console.log('server: ' + url + '  (hold=' + HOLD_MS + 'ms)')

const domFile = path.join(OUT, 'min-http.dom.html')
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + path.join(OUT, 'prof-http-' + Date.now().toString(36)),
  '--dump-dom', url,
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'min-http.err.txt'), 'w')] })
server.close()

const dom = readFileSync(domFile, 'utf8')
const dec = s => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
console.log('\n--- REPORT（子文档探针）---')
for (const m of dom.matchAll(/<pre id="rep"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n--- LINES（父页）---')
for (const m of dom.matchAll(/<pre id="lin"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n--- META ---')
for (const m of dom.matchAll(/<pre id="meta"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
