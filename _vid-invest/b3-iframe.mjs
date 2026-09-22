// B 步 v3：用**真实的 MuvEngine.beautify()** 产出 cardHtmlIframe，再
//  ① 矩阵测沙箱（allow-scripts / +same-origin / 无沙箱 / 空沙箱）下 srcdoc 里 <video> 的
//     readyState / networkState / error / currentTime；
//  ② 宿主重渲染（只重写内容、不动外层元素）后 iframe 的 identity 与视频进度。
// 运行：node _vid-invest/b3-iframe.mjs
import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const OUT = path.join(os.tmpdir(), 'muv-vid-invest')
mkdirSync(OUT, { recursive: true })
const EDGE = process.env.MUV_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const CLIENT = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
const CARD = JSON.parse(readFileSync(path.join(HERE, 'cards', '_足控天堂2.png.json'), 'utf8'))
const R = (CARD.data || CARD).extensions.regex_scripts
const HOME = String(R[0].replaceString || '')                // 主页：含 cover-vid(140.5s) + carVid
const ERA = String(R[2].replaceString || '')                 // 状态栏：cgFsVid + JS 建的 cg-*-thumb

const PROBE = `<script>(function(){
function snap(){
  var out=[],vs=document.getElementsByTagName('video'),as=document.getElementsByTagName('audio');
  for(var i=0;i<vs.length;i++){var v=vs[i],r=v.getBoundingClientRect();
    out.push({id:v.id||'',attr:String(v.getAttribute('src')||'').slice(-46),cur:String(v.currentSrc||'').slice(-46),
      rs:v.readyState,ns:v.networkState,err:v.error?(v.error.code+':'+String(v.error.message||'').slice(0,44)):'',
      t:Math.round(v.currentTime*100)/100,paused:v.paused,muted:v.muted,vw:v.videoWidth,vh:v.videoHeight,
      dur:isFinite(v.duration)?Math.round(v.duration*10)/10:-1,disp:getComputedStyle(v).display,
      rect:Math.round(r.width)+'x'+Math.round(r.height)});}
  return {videos:out,nv:vs.length,na:as.length,imgs:document.getElementsByTagName('img').length,
    scripts:document.getElementsByTagName('script').length,origin:String(location.origin),
    h:(document.body?document.body.scrollHeight:0),txt:document.body?String(document.body.innerText||'').length:0};
}
function post(tag){ try{ var s=snap(); s.muv=tag; parent.postMessage(s,'*') }catch(e){} }
window.addEventListener('message',function(ev){ var d=ev.data; if(d&&d.muvQ){ post(d.muvQ) } });
window.addEventListener('error',function(e){ try{parent.postMessage({muv:'JS-ERROR',msg:String(e.message).slice(0,110)},'*')}catch(_){}} );
window.addEventListener('unhandledrejection',function(e){ try{parent.postMessage({muv:'JS-REJECT',msg:String(e.reason&&e.reason.message||e.reason).slice(0,110)},'*')}catch(_){}} );
try{ post('t0') }catch(e){}
setTimeout(function(){post('t1')},1000);
setTimeout(function(){post('t2')},4000);
setTimeout(function(){post('t3')},9000);
})()</` + `script>`

const withProbe = (doc) => {
  const i = doc.lastIndexOf('</body>')
  return i < 0 ? doc + PROBE : doc.slice(0, i) + PROBE + doc.slice(i)
}
// 把卡文档塞进「正文 + 围栏整页文档」的消息文本（与真消息形状一致：围栏不在第 0 位）
const mkText = (fencedRaw) => '<maintext>顶栏后的正文一段。</maintext>\n\n' + fencedRaw.trim() + '\n\n后置正文。'
const HOME_TXT = mkText('```\n' + withProbe(HOME.replace(/^\s*```[a-z]*\s*\r?\n/, '').replace(/\r?\n```\s*$/, '')) + '\n```')
const ERA_TXT = mkText('```\n' + withProbe(ERA.replace(/^\s*```[a-z]*\s*\r?\n/, '').replace(/\r?\n```\s*$/, '')) + '\n```')

const SANDBOXES = [['S1_allow-scripts', 'allow-scripts'], ['S2_+same-origin', 'allow-scripts allow-same-origin'],
  ['S3_no-sandbox', null], ['S4_empty', '']]
const j = (v) => JSON.stringify(v).replace(/<\//g, '<\\/')

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>b3-iframe</title>
<style>html,body{margin:0;background:#111;color:#ddd;font:13px system-ui}pre.o{position:fixed;left:0;z-index:2^31-1;background:#000;color:#0f0;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%}</style>
</head><body>
<div id="box"></div>
<script>window.__ModuleLoader__={load:function(m){window.__mod=m}};</script>
<script>${CLIENT.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function(){
  var CARD=${j(CARD)}, HOME_TXT=${j(HOME_TXT)}, ERA_TXT=${j(ERA_TXT)}, SANDBOXES=${j(SANDBOXES)};
  var notes=[], reports=[], lines=[];
  function paint(){
    var ids=['rep','lin','not'];
    for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]); if(e) e.remove()}
    var a=document.createElement('pre'); a.id='rep'; a.className='o'; a.textContent=reports.join('\\n'); a.style.top='0'; a.style.color='#0ff';
    var b=document.createElement('pre'); b.id='lin'; b.className='o'; b.textContent=lines.join('\\n'); b.style.bottom='0'; b.style.color='#ff0';
    var c=document.createElement('pre'); c.id='not'; c.className='o'; c.textContent='NOTES '+notes.join(' | '); c.style.right='0'; c.style.bottom='0'; c.style.color='#8b93a1'; c.style.maxWidth='58%';
    document.body.appendChild(a); document.body.appendChild(b); document.body.appendChild(c);
  }
  window.addEventListener('message',function(ev){
    var d=ev.data; if(!d||!d.muv) return;
    var tag='?';
    try{var f=document.querySelectorAll('iframe'); for(var i=0;i<f.length;i++) if(f[i].contentWindow===ev.source) tag=f[i].getAttribute('data-tag')||('f'+i)}catch(_){}
    reports.push('F='+tag+' t='+d.muv+' nv='+d.nv+' na='+d.na+' img='+d.imgs+' sc='+d.scripts+' origin='+d.origin+' bodyH='+d.h+' bodyTxt='+d.txt+(d.msg?(' MSG='+d.msg):'')+
      (d.videos||[]).map(function(v){return ' || id='+v.id+' rs='+v.rs+' ns='+v.ns+' err='+(v.err||'-')+' t='+v.t+' paused='+v.paused+' muted='+v.muted+' '+v.vw+'x'+v.vh+' dur='+v.dur+' disp='+v.disp+' rect='+v.rect+' cur='+v.cur}).join(''));
    paint();
  });
  window.fetch=function(url,opts){
    try{ var u=String(url);
      if(u.indexOf('/api/muv-table/tavern-card')>=0) return Promise.resolve({json:function(){return Promise.resolve({ok:true,cardJson:CARD})}});
      if(u.indexOf('/api/muv-engine/apply-regex-card')>=0){var b=JSON.parse((opts&&opts.body)||'{}');
        return Promise.resolve({json:function(){return Promise.resolve({ok:true,text:b.text,applied:0,statusBarHtml:null})}}) }
    }catch(e){}
    return Promise.reject(new Error('stub'));
  };

  var exports, homeHtml='', eraHtml='';
  try{ exports=window.__mod.factory(function(){return{}}); exports.apply(); notes.push('apply=ok') }catch(e){ notes.push('boot=THROW:'+e.message) }
  paint();

  setTimeout(function(){
    Promise.resolve().then(function(){ return window.MuvEngine.beautify(HOME_TXT) }).then(function(h){ homeHtml=String(h||''); return Promise.resolve(h)})
      .then(function(){ return window.MuvEngine.beautify(ERA_TXT) }).then(function(h){ eraHtml=String(h||'')
        var nf=function(s){return (s.match(/<iframe\\b/g)||[]).length}, nd=function(s){return (s.match(/<!doctype/gi)||[]).length}, nbt=function(s){return (s.match(/\`{3,}/g)||[]).length};
        lines.push('BEAUTIFY 主页: len='+homeHtml.length+' iframes='+nf(homeHtml)+' rawDoctype='+nd(homeHtml)+' backticks='+nbt(homeHtml)+' hasCoverVid='+(homeHtml.indexOf('cover-vid')>=0)+' hasCarVid='+(homeHtml.indexOf('carVid')>=0)+' changed='+(homeHtml!==HOME_TXT));
        lines.push('BEAUTIFY 状态栏: len='+eraHtml.length+' iframes='+nf(eraHtml)+' rawDoctype='+nd(eraHtml)+' backticks='+nbt(eraHtml)+' hasCgFsVid='+(eraHtml.indexOf('cgFsVid')>=0));
        notes.push('beautify=ok');
        paint();
        var box=document.getElementById('box');
        var sb=document.createElement('div'); sb.id='stage'; box.appendChild(sb);
        sb.innerHTML = homeHtml;
        var f0=document.querySelector('iframe');
        lines.push('MOUNT 主页 iframe='+(f0?'yes sandbox="'+f0.getAttribute('sandbox')+'" srcdocLen='+String(f0.getAttribute('srcdoc')||'').length:'NO'));
        notes.push('mount=ok');
        paint();
        startMatrix();
      }).catch(function(e){ notes.push('beautify=THROW:'+(e&&e.message)); paint() });
  }, 400);

  var si=0;
  function startMatrix(){
    if(si>=SANDBOXES.length){ rebuildTest(); return }
    var cfg=SANDBOXES[si++];
    var sb=document.getElementById('stage'); if(!sb){ notes.push('stage gone'); paint(); return }
    sb.innerHTML = homeHtml;                                  // 每次都是一颗全新的 iframe
    var f=document.querySelector('iframe');
    if(!f){ lines.push('MATRIX '+cfg[0]+' NO-IFRAME'); paint(); startMatrix(); return }
    f.setAttribute('data-tag', '主页/'+cfg[0]);
    if(cfg[1]===null) f.removeAttribute('sandbox'); else f.setAttribute('sandbox', cfg[1]);
    var doc=f.getAttribute('srcdoc'); f.setAttribute('srcdoc','');
    reports.push('=== 主页 沙箱 '+cfg[0]+' sandbox="'+String(cfg[1])+'" ===');
    setTimeout(function(){ f.setAttribute('srcdoc',doc) }, 50);
    setTimeout(function(){ startMatrix() }, 8500);
  }

  function rebuildTest(){
    var sb=document.getElementById('stage');
    sb.innerHTML = homeHtml;
    var fA=document.querySelector('iframe');
    fA.setAttribute('data-tag','重建前(主页)');
    reports.push('=== 重渲染 identity 测试（主页）===');
    setTimeout(function(){
      try{ fA.contentWindow.postMessage({muvQ:'BEFORE'},'*') }catch(_){}
    }, 400);
    setTimeout(function(){
      lines.push('REBUILD before: iframeTag='+fA.tagName+' connected='+fA.isConnected+' srcdoc里含coverVid='+(String(fA.getAttribute('srcdoc')||'').indexOf('cover-vid')>=0));
      // 模拟宿主一次“只重写消息内容”的重渲染：把 stage 的子节点全部替换成同一份 html
      sb.innerHTML = homeHtml;
      var fB=document.querySelector('iframe');
      lines.push('REBUILD after-host-render: sameNode='+(fB===fA)+' oldConnected='+fA.isConnected+' newTag='+(fB?fB.getAttribute('data-tag'):'none'));
      if(fB) fB.setAttribute('data-tag','重建后(主页)');
      paint();
      setTimeout(function(){ try{ if(fB) fB.contentWindow.postMessage({muvQ:'AFTER'},'*') }catch(_){} 
        // ERA 文档单独挂一次：看它的 JS 有没有真的建出 video
        sb.innerHTML = eraHtml;
        var fE=document.querySelector('iframe'); if(fE) fE.setAttribute('data-tag','状态栏(ERA)');
        lines.push('ERA mounted='+!!fE);
        paint();
        setTimeout(function(){ lines.push('DONE'); paint() }, 9000);
      }, 3500);
    }, 3000);
  }
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'b3-iframe.html')
writeFileSync(file, page, 'utf8')
console.log('fixture: ' + file + ' (' + page.length + ')')

const domFile = path.join(OUT, 'b3-iframe.dom.html')
const profDir = path.join(OUT, 'prof3-' + Date.now().toString(36))
execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=140000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'b3.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const dec = s => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const grab = id => [...dom.matchAll(new RegExp('<pre id="' + id + '"[^>]*>([\\s\\S]*?)</pre>', 'g'))].map(m => dec(m[1])).join('\n')
console.log('\n===== 字符串层 =====\n' + grab('lin'))
console.log('\n===== iframe 内部探针 =====\n' + grab('rep'))
console.log('\n===== NOTES =====\n' + grab('not'))
console.log('\n产物: ' + domFile)
