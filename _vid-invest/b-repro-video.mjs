// B 步：最小复现 —— 把真卡的视频声明放进**真实 client.js 的渲染管线**，
// 在真 Edge 里判定 `<video>` 是否进 DOM、readyState / networkState / error 是什么；
// 并对 iframe 沙箱做 A/B/C（当前 allow-scripts / +allow-same-origin / 无沙箱 / 无脚本）。
//
// 运行：node _vid-invest/b-repro-video.mjs
// 产物：%TEMP%\muv-vid-invest\b-repro.html + .dom.html + .err.txt + .png

import { readFileSync, writeFileSync, mkdirSync, openSync, existsSync } from 'node:fs'
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
const INLINED = CLIENT.replace(/<\/script/gi, '<\\/script')

const card = JSON.parse(readFileSync(path.join(HERE, 'cards', '_足控天堂2.png.json'), 'utf8'))
const scripts = (card.data || card).extensions.regex_scripts
const HOME_DOC_RAW = String(scripts[0].replaceString || '')   // 带围栏的整页文档（57,618）
const SERVER_OUT = readFileSync(path.join(HERE, 'docs', 'server-out.txt'), 'utf8') // 服务端应用后的真产物

const IMGC = 'https://cdn.imgchest.com/files/52819694c39a.mp4'
const ZYX_V = 'https://zyxjack123.top/足控天堂/视频/主页视频/哈珂斯·贝尔丝.mp4'
const ZYX_FLAT = 'https://zyxjack123.top/足控天堂/视频/日常1.mp4'

// ── 卡文档内部探针：只回报数字/状态，不回传任何卡内容 ────────────────────────
const PROBE = `<script>(function(){
function snap(){
  var out=[],vs=document.getElementsByTagName('video');
  for(var i=0;i<vs.length;i++){var v=vs[i],r=v.getBoundingClientRect(),cs=getComputedStyle(v);
    out.push({id:v.id||'',attrSrc:String(v.getAttribute('src')||'').slice(-46),curSrc:String(v.currentSrc||'').slice(-46),
      rs:v.readyState,ns:v.networkState,err:v.error?(v.error.code+':'+String(v.error.message||'').slice(0,60)):'',
      paused:v.paused,muted:v.muted,vw:v.videoWidth,vh:v.videoHeight,dur:isFinite(v.duration)?Math.round(v.duration*10)/10:-1,
      disp:cs.display+(cs.visibility!=='visible'?'/'+cs.visibility:''),
      rect:Math.round(r.width)+'x'+Math.round(r.height)});}
  return out;
}
function post(tag){ try{ parent.postMessage({muv:tag,videos:snap(),n:document.getElementsByTagName('video').length,
  imgs:document.getElementsByTagName('img').length,scripts:document.getElementsByTagName('script').length,
  origin:String(location.origin),h:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)},'*') }catch(e){} }
window.addEventListener('error',function(e){ try{parent.postMessage({muv:'JS-ERROR',msg:String(e.message).slice(0,140),src:String(e.filename).slice(-40)+':'+e.lineno},'*')}catch(_){}} );
window.addEventListener('unhandledrejection',function(e){ try{parent.postMessage({muv:'JS-REJECT',msg:String(e.reason&&e.reason.message||e.reason).slice(0,140)},'*')}catch(_){}} );
try{ post('t0') }catch(e){}
setTimeout(function(){post('t1')},1200);
setTimeout(function(){post('t2')},5000);
setTimeout(function(){post('t3')},11000);
})()</` + `script>`

function withProbe(doc) {
  const i = doc.lastIndexOf('</body>')
  return i < 0 ? doc + PROBE : doc.slice(0, i) + PROBE + doc.slice(i)
}

// 主页文档：剥围栏、插探针、再包回围栏 —— 与真链路（renderFencedHtml）一致
const HOME_INNER = HOME_DOC_RAW.replace(/^\s*```[a-z]*\s*\r?\n/, '').replace(/\r?\n```\s*$/, '')
const HOME_FENCED = '```\n' + withProbe(HOME_INNER) + '\n```'

// 每条消息：(id, 说明, 文本是否要按“已转义文本”注入 DOM)
const CASES = [
  { id: 'A_server_out', text: SERVER_OUT },                                    // 服务端真产物（[6] 视频）
  { id: 'B_home_doc', text: '<choices>\nA. 继续\n</choices>\n\n' + HOME_FENCED }, // 围栏整页文档 → iframe
  { id: 'C_imgchest', text: '<video src="' + IMGC + '" controls preload="metadata"></video>' },
  { id: 'D_zyx_real', text: '<video src="' + ZYX_V + '" controls preload="metadata"></video>' },
  { id: 'E_zyx_flat', text: '<video src="' + ZYX_FLAT + '" controls preload="metadata"></video>' },
]

const page = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>b-repro-video</title>
<style>
 html,body{margin:0;padding:0;background:#16181d;color:#d7dae0;font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif}
 body{padding:10px}.cap{font:11px monospace;color:#8b93a1;margin:10px 0 4px}
 .host{border:1px dashed #3a4048;border-radius:6px;padding:8px}
 pre.verdict{position:fixed;left:0;background:#000;color:#0f0;font:10px monospace;padding:1px 3px;margin:0;white-space:pre-wrap;max-width:100%;z-index:2147483647}
</style></head>
<body>
${CASES.map((c) => `  <div class="cap">${c.id}</div>\n  <div class="host"><div id="msg_${c.id}" class="_markdown_abc123_7"></div></div>`).join('\n')}

<script>window.__ModuleLoader__ = { load: function (m) { window.__mod = m } };</script>
<script>${INLINED}</script>
<script>
(function(){
  var CASES = ${JSON.stringify(CASES).replace(/<\//g, '<\\/')};
  var notes = [];
  var reports = [];
  window.addEventListener('message', function(ev){
    var d = ev.data; if(!d || !d.muv) return;
    var src = '?';
    try { var f = document.querySelectorAll('iframe'); for (var i=0;i<f.length;i++){ if (f[i].contentWindow === ev.source) src = f[i].getAttribute('data-tag') || ('iframe'+i) } } catch(_) {}
    reports.push('REPORT frame=' + src + ' t=' + d.muv + ' videos=' + d.n + ' imgs=' + d.imgs +
      ' origin=' + d.origin + ' h=' + d.h +
      (d.msg ? (' MSG=' + d.msg + ' @' + d.src) : '') +
      (d.videos && d.videos.length ? d.videos.map(function(v){
        return ' | id=' + v.id + ' rs=' + v.rs + ' ns=' + v.ns + ' err=' + (v.err||'-') + ' paused=' + v.paused +
          ' muted=' + v.muted + ' ' + v.vw + 'x' + v.vh + ' dur=' + v.dur + ' disp=' + v.disp + ' rect=' + v.rect +
          ' cur=' + v.curSrc; }).join('') : ''));
    render();
  });
  function render(){
    var old = document.getElementById('reports'); if (old) old.remove();
    var n = document.createElement('pre'); n.id = 'reports';
    n.textContent = reports.join('\\n');
    n.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#001;color:#0ff;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%';
    document.body.appendChild(n);
  }

  try {
    window.fetch = function () { return Promise.reject(new Error('stub: no server in fixture')) };
    var exports = window.__mod.factory(function () { return {} });
    notes.push('factory=ok');
    if (exports && typeof exports.apply === 'function') { exports.apply(); notes.push('apply=ok') }
    else notes.push('apply=MISSING');
  } catch (e) { notes.push('boot=THROW:' + e.message) }

  // 用 textContent 注入：等价于“DSH 的 markdown 把卡的裸 HTML 转成了文本节点”
  setTimeout(function(){
    for (var i=0;i<CASES.length;i++){
      var el = document.getElementById('msg_' + CASES[i].id);
      if (el) el.textContent = CASES[i].text;
    }
    setTimeout(function(){
      for (var i=0;i<CASES.length;i++){
        var el = document.getElementById('msg_' + CASES[i].id);
        try { window.MuvEngine.decorateMessage(el) } catch(e){ notes.push('decorate(' + CASES[i].id + ')=THROW:' + e.message) }
      }
      setTimeout(function(){
        // 逐条判定：媒体元素进了 DOM 没有
        var lines = [];
        for (var i=0;i<CASES.length;i++){
          var el = document.getElementById('msg_' + CASES[i].id);
          if (!el) continue;
          var vs = el.querySelectorAll('video'), fs = el.querySelectorAll('iframe');
          var line = 'DOMCASE id=' + CASES[i].id + ' videos=' + vs.length + ' iframes=' + fs.length +
            ' imgs=' + el.querySelectorAll('img').length +
            ' illustrations=' + el.querySelectorAll('.muv-illustration').length +
            ' videoPh=' + el.querySelectorAll('.muv-video-ph').length +
            ' choiceBtns=' + el.querySelectorAll('.muv-choice-btn').length +
            ' len=' + (el.innerText||'').length;
          for (var k=0;k<vs.length;k++){
            var v = vs[k];
            line += ' ||v' + k + ' id=' + v.id + ' rs=' + v.readyState + ' ns=' + v.networkState +
              ' err=' + (v.error ? (v.error.code + ':' + String(v.error.message||'').slice(0,70)) : '-') +
              ' paused=' + v.paused + ' muted=' + v.muted + ' ' + v.videoWidth + 'x' + v.videoHeight +
              ' dur=' + (isFinite(v.duration) ? Math.round(v.duration*10)/10 : -1) +
              ' disp=' + getComputedStyle(v).display + ' rect=' + Math.round(v.getBoundingClientRect().width) + 'x' + Math.round(v.getBoundingClientRect().height) +
              ' cur=' + String(v.currentSrc||'').slice(-50) + ' attr=' + String(v.getAttribute('src')||'').slice(-50);
          }
          lines.push(line);
        }
        var pre = document.createElement('pre'); pre.id = 'domcases';
        pre.textContent = lines.join('\\n');
        pre.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;background:#100;color:#ff0;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:100%';
        document.body.appendChild(pre);
        // DSH 的行为：srcdoc 里若有裸文本反引号会显示出来 —— 顺手取一份文本样本
        var b = document.getElementById('msg_B_home_doc');
        if (b) {
          var bt = document.createElement('pre'); bt.id = 'btail';
          bt.textContent = 'B_HOME_DOC_TEXT_TAIL=' + JSON.stringify((b.innerText||'').slice(-160));
          bt.style.cssText = 'position:fixed;right:0;top:0;z-index:2147483647;background:#010;color:#8f8;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:60%';
          document.body.appendChild(bt);
        }
        // ── 沙箱 A/B/C：同一个 iframe，换 sandbox 重载 ───────────────────
        var frames = document.querySelectorAll('iframe.muv-iframe');
        var V = ${JSON.stringify([
          ['S1_allow-scripts', 'allow-scripts'],
          ['S2_plus_same_origin', 'allow-scripts allow-same-origin'],
          ['S3_no_sandbox', null],
          ['S4_empty_sandbox', ''],
        ])};
        var fi = 0, vi = 0;
        function nextFrame(){
          if (vi >= V.length) return;
          var cfg = V[vi++]; vi--;
          var c = V[vi]; vi++;
          var f = frames[fi];
          if (!f) return;
          f.setAttribute('data-tag', c[0]);
          if (c[1] === null) f.removeAttribute('sandbox'); else f.setAttribute('sandbox', c[1]);
          var doc = f.getAttribute('srcdoc');
          f.setAttribute('srcdoc', '');
          setTimeout(function(){ f.setAttribute('srcdoc', doc) }, 60);
          setTimeout(function(){
            vi++; fi = 0;
            if (vi < V.length) nextFrame();
          }, 13000);
        }
        if (frames.length) nextFrame();
        var np = document.createElement('pre'); np.id = 'notes';
        np.textContent = 'NOTES ' + notes.join(' | ') + ' ||| frames=' + frames.length;
        np.style.cssText = 'position:fixed;right:0;bottom:0;z-index:2147483647;background:#111;color:#8b93a1;font:10px monospace;padding:2px;margin:0;white-space:pre-wrap;max-width:60%';
        document.body.appendChild(np);
      }, 2600);
    }, 60);
  }, 60);
})();
<\/script>
</body></html>`

const file = path.join(OUT, 'b-repro.html')
writeFileSync(file, page, 'utf8')
console.log('fixture: ' + file + '  (' + page.length + ' chars)')

const domFile = path.join(OUT, 'b-repro.dom.html')
const profDir = path.join(OUT, 'prof-' + Date.now().toString(36))
const extra = (process.env.MUV_AUTOPLAY ? ['--autoplay-policy=no-user-gesture-required'] : [])
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--virtual-time-budget=70000',
  '--user-data-dir=' + profDir, '--dump-dom', 'file:///' + file.replace(/\\/g, '/'),
  ...extra,
], { stdio: ['ignore', openSync(domFile, 'w'), openSync(path.join(OUT, 'b-repro.err.txt'), 'w')] })

const dom = readFileSync(domFile, 'utf8')
const dec = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
console.log('\n=== DOMCASE（消息内媒体元素是否进 DOM）===')
for (const m of dom.matchAll(/<pre id="domcases"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n=== NOTES ===')
for (const m of dom.matchAll(/<pre id="notes"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n=== B 消息文本尾部（裸围栏是否外泄）===')
for (const m of dom.matchAll(/<pre id="btail"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n=== REPORT（iframe 内部探针，按沙箱分组）===')
for (const m of dom.matchAll(/<pre id="reports"[^>]*>([\s\S]*?)<\/pre>/g)) console.log(dec(m[1]))
console.log('\n产物：' + domFile)
