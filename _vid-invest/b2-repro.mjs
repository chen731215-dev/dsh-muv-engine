// B 步 v2：真实 client.js 全链路（含 fetch 打桩给出真卡 → 围栏转 iframe → 卫生 pass 建媒体元素）
//  + iframe 沙箱矩阵（allow-scripts / +same-origin / 无沙箱 / 空沙箱）
//  + 「宿主重渲染是否摧毁 iframe、把视频打回 0」的 identity / currentTime 判据
//
// 运行：node _vid-invest/b2-repro.mjs
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
const HOME_DOC_RAW = String((CARD.data || CARD).extensions.regex_scripts[0].replaceString || '')
const SERVER_OUT = readFileSync(path.join(HERE, 'docs', 'server-out.txt'), 'utf8')

const IMGC = 'https://cdn.imgchest.com/files/52819694c39a.mp4'
const ZYX_OK = 'https://zyxjack123.top/足控天堂/视频/主页视频/哈珂斯·贝尔丝.mp4'
const ZYX_404 = 'https://zyxjack123.top/足控天堂/视频/日常1.mp4'

const PROBE = `<script>(function(){
function snap(){
  var out=[],vs=document.getElementsByTagName('video');
  for(var i=0;i<vs.length;i++){var v=vs[i],r=v.getBoundingClientRect(),cs=getComputedStyle(v);
    out.push({id:v.id||'',cur:String(v.currentSrc||'').slice(-44),attr:String(v.getAttribute('src')||'').slice(-44),
      rs:v.readyState,ns:v.networkState,err:v.error?(v.error.code+':'+String(v.error.message||'').slice(0,50)):'',
      t:Math.round(v.currentTime*100)/100,paused:v.paused,muted:v.muted,vw:v.videoWidth,vh:v.videoHeight,
      dur:isFinite(v.duration)?Math.round(v.duration*10)/10:-1,disp:cs.display,
      rect:Math.round(r.width)+'x'+Math.round(r.height)});}
  return out;
}
function post(tag){ try{ parent.postMessage({muv:tag,videos:snap(),n:document.getElementsByTagName('video').length,
  imgs:document.getElementsByTagName('img').length,scripts:document.getElementsByTagName('script').length,
  origin:String(location.origin),h:(document.body?document.body.scrollHeight:0)},'*') }catch(e){} }
window.addEventListener('message',function(ev){ var d=ev.data; if(d&&d.muvQ){ post(d.muvQ) } });
window.addEventListener('error',function(e){ try{parent.postMessage({muv:'JS-ERROR',msg:String(e.message).slice(0,120)},'*')}catch(_){}} );
window.addEventListener('unhandledrejection',function(e){ try{parent.postMessage({muv:'JS-REJECT',msg:String(e.reason&&e.reason.message||e.reason).slice(0,120)},'*')}catch(_){}} );
try{ post('t0') }catch(e){}
setTimeout(function(){post('t1')},1000);
setTimeout(function(){post('t2')},4000);
})()</` + `script>`

function withProbe(doc) {
  const i = doc.lastIndexOf('</body>')
  return i < 0 ? doc + PROBE : doc.slice(0, i) + PROBE + doc.slice(i)
}
const HOME_INNER = HOME_DOC_RAW.replace(/^\s*```[a-z]*\s*\r?\n/, '').replace(/\r?\n```\s*$/, '')
const HOME_FENCED = '```\n' + withProbe(HOME_INNER) + '\n```'

const CASES = [
  { id: 'A_srv', text: SERVER_OUT },
  { id: 'B_doc', text: '正文一段。\n```\n' + withProbe(HOME_INNER) + '\n```\n<choices>\nA. 继续\n</choices>' },
  { id: 'C_imgc', text: '看图。\n<video src="' + IMGC + '" controls preload="metadata"></video>\n完。' },
  { id: 'D_zyxok', text: '看视频。\n<video src="' + ZYX_OK + '" controls preload="metadata"></video>\n完。' },
  { id: 'E_zyx404', text: '看视频。\n<video src="' + ZYX_404 + '" controls preload="metadata"></video>\n完。' },
]

const SANDBOXES = [
  ['S1_allow_scripts', 'allow-scripts'],
  ['S2_plus_same_origin', 'allow-scripts allow-same-origin'],
  ['S3_no_sandbox', null],
  ['S4_empty', ''],
]

const j = (v) => JSON.stringify(v).replace(/<\//g, '<\\/')

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>b2-repro</title>
<style>html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:13px/1.6 system-ui}
body{padding:8px}.cap{font:11px monospace;color:#8b93a1;margin:8px 0 3px}
.host{border:1px dashed #3a4048;border-radius:6px;padding:6px}
pre.out{position:fixed;left:0;z-index:2147483647;background:#000;color:#0f0;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%}
</style></head>
<body>
${CASES.map(c => `  <div class="cap">${c.id}</div>\n  <div class="host"><div id="m_${c.id}" class="_markdown_abc123_7" data-role="assistant"></div></div>`).join('\n')}
<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${CLIENT.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function(){
  var CASES = ${j(CASES)};
  var CARD = ${j(CARD)};
  var SANDBOXES = ${j(SANDBOXES)};
  var notes = [], reports = [], outLines = [];
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function paint(){
    var old = document.getElementById('reports'); if (old) old.remove();
    var n = document.createElement('pre'); n.id='reports'; n.className='out';
    n.textContent = reports.join('\\n'); n.style.top='0'; n.style.color='#0ff';
    document.body.appendChild(n);
    var o2 = document.getElementById('outlines'); if (o2) o2.remove();
    var p = document.createElement('pre'); p.id='outlines'; p.className='out';
    p.textContent = outLines.join('\\n'); p.style.bottom='0'; p.style.color='#ff0';
    document.body.appendChild(p);
    var o3 = document.getElementById('notes'); if (o3) o3.remove();
    var q = document.createElement('pre'); q.id='notes'; q.className='out';
    q.textContent = 'NOTES ' + notes.join(' | '); q.style.right='0'; q.style.bottom='0'; q.style.color='#8b93a1'; q.style.maxWidth='62%';
    document.body.appendChild(q);
  }
  window.addEventListener('message', function(ev){
    var d = ev.data; if(!d || !d.muv) return;
    var tag = '?';
    try { var f = document.querySelectorAll('iframe'); for(var i=0;i<f.length;i++) if(f[i].contentWindow===ev.source) tag = f[i].getAttribute('data-tag')||('iframe'+i) } catch(_){}
    reports.push('F=' + tag + ' t=' + d.muv + ' n=' + d.n + ' img=' + d.imgs + ' sc=' + d.scripts +
      ' origin=' + d.origin + ' h=' + d.h + (d.msg ? (' MSG=' + d.msg) : '') +
      (d.videos||[]).map(function(v){ return ' || id=' + v.id + ' rs=' + v.rs + ' ns=' + v.ns + ' err=' + (v.err||'-') +
        ' t=' + v.t + ' paused=' + v.paused + ' muted=' + v.muted + ' ' + v.vw + 'x' + v.vh + ' dur=' + v.dur +
        ' disp=' + v.disp + ' rect=' + v.rect + ' cur=' + v.cur + ' attr=' + v.attr }).join(''));
    paint();
  });

  // ── fetch 打桩：给真卡 + 恒等 apply-regex ────────────────────────────
  window.fetch = function (url, opts) {
    try {
      var u = String(url)
      if (u.indexOf('/api/muv-table/tavern-card') >= 0) {
        return Promise.resolve({ json: function(){ return Promise.resolve({ ok: true, cardJson: CARD }) } })
      }
      if (u.indexOf('/api/muv-engine/apply-regex-card') >= 0) {
        var b = JSON.parse((opts && opts.body) || '{}')
        return Promise.resolve({ json: function(){ return Promise.resolve({ ok: true, text: b.text, applied: 0, statusBarHtml: null }) } })
      }
    } catch (e) {}
    return Promise.reject(new Error('stub: no server'))
  };

  // ① 先摆好“DSH 已经渲染好的消息 DOM”（块级子节点 + <br>，与 micromark 产出的形状一致），
  //    再启动插件 —— 这样插件自己的卫生 pass / 装饰器才会认这些元素。
  for (var i = 0; i < CASES.length; i++) {
    var el = document.getElementById('m_' + CASES[i].id)
    if (el) el.innerHTML = '<p>' + esc(CASES[i].text).replace(/\\n/g, '<br>') + '</p>'
  }
  notes.push('content=injected');
  try {
    var exports = window.__mod.factory(function () { return {} });
    notes.push('factory=ok');
    if (exports && typeof exports.apply === 'function') { exports.apply(); notes.push('apply=ok') }
  } catch (e) { notes.push('boot=THROW:' + e.message) }
  paint();

  function domeCase(phase){
    for (var i = 0; i < CASES.length; i++) {
      var el = document.getElementById('m_' + CASES[i].id); if (!el) continue;
      var vs = el.querySelectorAll('video'), fs = el.querySelectorAll('iframe');
      var line = 'DOMCASE[' + phase + '] id=' + CASES[i].id + ' videos=' + vs.length + ' iframes=' + fs.length +
        ' imgs=' + el.querySelectorAll('img').length + ' illus=' + el.querySelectorAll('.muv-illustration').length +
        ' videoPh=' + el.querySelectorAll('.muv-video-ph').length + ' audios=' + el.querySelectorAll('audio').length +
        ' choiceBtns=' + el.querySelectorAll('.muv-choice-btn').length +
        ' statusWrap=' + el.querySelectorAll('.muv-statusbar-wrap').length +
        ' decorated=' + el.getAttribute('data-muv-decorated') +
        ' textLen=' + (el.innerText||'').length;
      for (var k=0;k<vs.length;k++){
        var v=vs[k];
        line += ' ||v'+k+' id='+v.id+' src='+String(v.getAttribute('src')||'').slice(-40)+
          ' rs='+v.readyState+' ns='+v.networkState+
          ' err='+(v.error?(v.error.code+':'+String(v.error.message||'').slice(0,60)):'-')+
          ' paused='+v.paused+' muted='+v.muted+' '+v.videoWidth+'x'+v.videoHeight+
          ' dur='+(isFinite(v.duration)?Math.round(v.duration*10)/10:-1)+
          ' t='+Math.round(v.currentTime*100)/100+
          ' disp='+getComputedStyle(v).display+' rect='+Math.round(v.getBoundingClientRect().width)+'x'+Math.round(v.getBoundingClientRect().height);
      }
      outLines.push(line);
    }
  }
  function rawTextOf(id){ for(var i=0;i<CASES.length;i++) if(CASES[i].id===id) return CASES[i].text; return '' }

  // ② 沙箱矩阵：把 iframe 的 sandbox 换掉重载，看 srcdoc 里的 <video> 各是什么状态
  var sbIdx = 0;
  function nextSandbox(){
    if (sbIdx >= SANDBOXES.length) { step3(); return }
    var cfg = SANDBOXES[sbIdx++];
    var f = document.querySelector('iframe.muv-iframe');
    if (!f) { outLines.push('SANDBOX ' + cfg[0] + ' SKIP: 没有 iframe'); paint(); nextSandbox(); return }
    f.setAttribute('data-tag', cfg[0]);
    if (cfg[1] === null) f.removeAttribute('sandbox'); else f.setAttribute('sandbox', cfg[1]);
    var doc = f.getAttribute('srcdoc');
    f.setAttribute('srcdoc', '');
    reports.push('--- SANDBOX ' + cfg[0] + ' 开始（sandbox=' + String(cfg[1]) + '）---');
    setTimeout(function(){ f.setAttribute('srcdoc', doc) }, 50);
    setTimeout(function(){ nextSandbox() }, cfg[0] === 'S1_allow_scripts' ? 9000 : 7000);
  }

  // ③ 宿主重渲染 → iframe 是否被摧毁 / 视频是否被打回 0
  function step3(){
    var frameA = document.querySelector('iframe.muv-iframe');
    var elB = document.getElementById('m_B_doc');
    reports.push('--- 重渲染测试 ---');
    if (!frameA) { reports.push('REBUILD preroll: 没有 iframe，跳过'); paint(); return finish() }
    frameA.setAttribute('data-ident', 'orig');
    try { frameA.contentWindow.postMessage({ muvQ: 'before-rebuild' }, '*') } catch(_) {}
    setTimeout(function(){
      outLines.push('REBUILD iframeIdentityBefore=' + (frameA.isConnected ? 'connected' : 'detached') +
        ' sameNodeAfterHostRender=?');
      // 模拟 DSH 宿主的一次 React 重渲染：只重写消息**内容**，不动外层元素（外层仍带 data-muv-decorated）
      elB.innerHTML = '<p>' + esc(rawTextOf('B_doc')).replace(/\\n/g, '<br>') + '</p>';
      outLines.push('REBUILD hostRenderDone decoratedAttrStillOnOuter=' + elB.getAttribute('data-muv-decorated'));
      paint();
      setTimeout(function(){
        var frameB = document.querySelector('iframe.muv-iframe');
        outLines.push('REBUILD iframesNow=' + document.querySelectorAll('iframe.muv-iframe').length +
          ' sameNode=' + (frameB === frameA) + ' frameA_connected=' + frameA.isConnected +
          ' hostsStill=iframe?' + !!frameB);
        try { if (frameB) frameB.contentWindow.postMessage({ muvQ: 'after-rebuild' }, '*') } catch(_) {}
        paint();
        finish();
      }, 3000);
    }, 1500);
  }
  function finish(){ outLines.push('DONE'); paint() }

  setTimeout(function(){ domeCase('t3s'); paint() }, 3000);
  setTimeout(function(){ domeCase('t6s'); paint(); nextSandbox() }, 6000);
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'b2-repro.html')
writeFileSync(file, page, 'utf8')
console.log('fixture: ' + file + ' (' + page.length + ')')

const domFile = path.join(OUT, 'b2-repro.dom.html')
const profDir = path.join(OUT, 'prof2-' + Date.now().toString(36))
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=120000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'b2.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const dec = s => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const grab = id => [...dom.matchAll(new RegExp('<pre id="' + id + '"[^>]*>([\\s\\S]*?)</pre>', 'g'))].map(m => dec(m[1])).join('\n')
console.log('\n===== DOMCASE =====\n' + grab('outlines'))
console.log('\n===== iframe 内部探针 =====\n' + grab('reports'))
console.log('\n===== NOTES =====\n' + grab('notes'))
console.log('\n产物: ' + domFile)
