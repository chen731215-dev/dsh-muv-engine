// B 步最小复现（纯净版）：一个 srcdoc iframe，内含真卡的视频 URL。
// 判据：子文档里的 <video> 有没有、readyState/networkState/error/duration 是什么、
//       以及「沙箱是否影响 media 加载」「postMessage 是否可达父页」。
import { writeFileSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const OUT = path.join(os.tmpdir(), 'muv-vid-invest')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const IMGC = 'https://cdn.imgchest.com/files/52819694c39a.mp4'

const probe = (label) => `<script>(function(){
function snap(){var out=[],vs=document.getElementsByTagName('video');
for(var i=0;i<vs.length;i++){var v=vs[i],r=v.getBoundingClientRect();
out.push({id:v.id||'',attr:v.getAttribute('src')||'',rs:v.readyState,ns:v.networkState,
err:v.error?(v.error.code+':'+String(v.error.message||'').slice(0,60)):'',paused:v.paused,
vw:v.videoWidth,vh:v.videoHeight,dur:isFinite(v.duration)?Math.round(v.duration*10)/10:-1,
t:Math.round(v.currentTime*100)/100,disp:getComputedStyle(v).display,rect:Math.round(r.width)+'x'+Math.round(r.height)});}
return {muv:'${label}',n:vs.length,origin:String(location.origin),anc:location.ancestorOrigins?String(location.ancestorOrigins[0]):'',
scripts:document.getElementsByTagName('script').length,imgs:document.getElementsByTagName('img').length,videos:out};}
function post(t){try{var s=snap();s.muv=t;parent.postMessage(s,'*')}catch(e){
try{parent.postMessage({muv:'POST-THROW',msg:String(e&&e.message)},'*')}catch(_){}}}
try{post('${label}-t0')}catch(e){try{parent.postMessage({muv:'OUTER-THROW',msg:String(e&&e.message)},'*')}catch(_){}}}
setTimeout(function(){post('${label}-t2')},2000);
setTimeout(function(){post('${label}-t6')},6000);
})()</` + `script>`

const DOC = (label) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}</style></head><body>
<video id="v1" src="${IMGC}" controls preload="metadata"></video>
<video id="v2" src="https://zyxjack123.top/足控天堂/视频/主页视频/哈珂斯·贝尔丝.mp4" controls preload="metadata"></video>
${probe(label)}
</body></html>`

const j = (s) => JSON.stringify(s).replace(/<\//g, '<\\/')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CFG = [
  ['T1_allow-scripts', 'allow-scripts'],
  ['T2_allow-scripts+same-origin', 'allow-scripts allow-same-origin'],
  ['T3_no-sandbox', null],
  ['T4_sandbox-empty', ''],
]

const page = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>t</title>
<style>html,body{margin:0;background:#111;color:#ddd;font:12px monospace}pre.o{position:fixed;left:0;background:#000;color:#0f0;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%}</style>
</head><body>
<div id="stage"></div>
<script>
(function(){
 var DOCS = ${j(CFG.map(c => [c[0], DOC(c[0])]))};
 var CFG = ${j(CFG)};
 var reports = [], lines = [];
 function paint(){
   var i;
   for (i=0;i<['rep','lin'].length;i++){ var e=document.getElementById(['rep','lin'][i]); if(e) e.remove() }
   var a=document.createElement('pre'); a.id='rep'; a.className='o'; a.textContent=reports.join('\\n'); a.style.top='0'; a.style.color='#0ff';
   var b=document.createElement('pre'); b.id='lin'; b.className='o'; b.textContent=lines.join('\\n'); b.style.bottom='0'; b.style.color='#ff0';
   document.body.appendChild(a); document.body.appendChild(b);
 }
 window.addEventListener('message',function(ev){
   var d=ev.data; if(!d||!d.muv) return;
   reports.push('GET '+d.muv+' (source==frame? '+String(ev.source===curFrameWin)+') n='+d.n+' origin='+d.origin+' scripts='+d.scripts+' imgs='+d.imgs
     +(d.msg?(' MSG='+d.msg):'')
     +(d.videos||[]).map(function(v){return ' || '+v.id+' rs='+v.rs+' ns='+v.ns+' err='+(v.err||'-')+' paused='+v.paused+
       ' '+v.vw+'x'+v.vh+' dur='+v.dur+' t='+v.t+' disp='+v.disp+' rect='+v.rect}).join(''));
   paint();
 });
 var curFrameWin = null, idx = 0, curFrame = null;
 // 父页侧探测：能读到子文档就读（T3 无沙箱时应当可读），读不到就记 null
 function parentProbe(tag){
   try {
     var d = curFrame && curFrame.contentDocument;
     if (!d) { lines.push('PARENT-PROBE ' + tag + ' contentDocument=null(跨源)'); return }
     var vs = d.getElementsByTagName('video');
     var s = 'PARENT-PROBE ' + tag + ' readyState=' + d.readyState + ' nv=' + vs.length + ' bodyHTML=' + (d.body ? d.body.innerHTML.length : -1);
     for (var i=0;i<vs.length;i++){ var v=vs[i]; s += ' || ' + (v.id||'') + ' rs=' + v.readyState + ' ns=' + v.networkState +
       ' err=' + (v.error ? v.error.code : '-') + ' ' + v.videoWidth + 'x' + v.videoHeight + ' cur=' + String(v.currentSrc||'').slice(-40) }
     lines.push(s);
   } catch (e) { lines.push('PARENT-PROBE ' + tag + ' THROW:' + e.message) }
 }
 function step(){
   if (idx >= DOCS.length) { lines.push('DONE'); paint(); return }
   var c = DOCS[idx], cfg = CFG[idx]; idx++;
   var stage = document.getElementById('stage');
   stage.innerHTML = '';
   var f = document.createElement('iframe');
   f.id = 'f_' + c[0];
   if (cfg[1] !== null) f.setAttribute('sandbox', cfg[1]);
   f.setAttribute('style','width:640px;height:360px;border:1px solid #555');
   stage.appendChild(f);
   curFrame = f; curFrameWin = f.contentWindow;
   reports.push('=== ' + c[0] + ' sandbox-src="' + String(cfg[1]) + '" ===');
   f.setAttribute('srcdoc', c[1]);
   lines.push('MOUNT ' + c[0] + ' sandboxAttr=' + String(f.getAttribute('sandbox')));
   paint();
   setTimeout(function(){ parentProbe(c[0]+'/p1') }, 2500);
   setTimeout(function(){ parentProbe(c[0]+'/p2') }, 6000);
   setTimeout(step, 9000);
 }
 step();
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'min.html')
writeFileSync(file, page, 'utf8')
console.log('fixture: ' + file)
const domFile = path.join(OUT, 'min.dom.html')
const FLAGS = process.env.MUV_VT === '1'
  ? ['--virtual-time-budget=60000']
  : ['--timeout=25000']
console.log('edge flags: ' + FLAGS.join(' '))
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  ...FLAGS, '--user-data-dir=' + path.join(OUT, 'profmin-' + Date.now().toString(36)),
  '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'min.err.txt'), 'w')] })
const dom = readFileSync(domFile, 'utf8')
const dec = s => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
console.log('\n--- reports ---')
for (const m of dom.matchAll(/<pre id="rep"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n--- lines ---')
for (const m of dom.matchAll(/<pre id="lin"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
