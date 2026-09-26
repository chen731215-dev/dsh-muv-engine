// 门禁：卡里 **enabled 的 TavernHelper 脚本** 会不会被真的执行到。
//
// ── 为什么要有这条 ──────────────────────────────────────────────────────
// 用户实测缺口：ST 里「魔法少女MVU测试」封面下面那条棕色 **MVU 状态栏（Status Hud）**
// 在 DSH 里没有。取证结论：它不是卡的正则产物（那两条消费 `<StatusPlaceHolderImpl/>`
// 的正则 replaceString 是**空串**），而是卡的 TavernHelper 脚本在运行时画的 ——
// `data.extensions.tavern_helper.scripts[0]` 的内容就是一行
//   import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@master/artifact/bundle.js'
// ST 里「酒馆助手」执行卡的脚本 ⇒ bundle 起来 ⇒ HUD 出现。我们此前一条都不执行。
//
// ── 这条门禁盯的六件事 ──────────────────────────────────────────────────
//   ① 服务端读出的是**真确那一批**（真卡：8 条里只注入 6 条，disabled 的不出）；
//   ② 注入串里每条脚本各占一个 `<script type="module">`，顺序 = 卡里数组顺序；
//   ③ 真浏览器 + 真沙箱（`allow-scripts` srcdoc）里 **enabled 的真的跑起来了**；
//   ④ **一条挂了不拖垮别人**（故意塞一条 import 不存在的 URL），且失败**留痕**；
//   ⑤（第 32 轮）**过滤**：空白 content 与"相对/裸地址"content 被跳过**且留痕带名字**；
//   ⑥（第 32 轮）**留痕带名字**：没有顶层 import/export 的脚本被 try/catch 包一层，
//      于是"运行时报错"也能说到是哪一条（过去一律「（未知脚本）」）。
//
// 对照臂（没有它们，上面每一条都可能永真）：
//   B 臂 = 同一份文档**不注入** ⇒ `__probeA` 必须是 undefined；
//   C 臂 = 同一个开关下把 `MUV_CARD_SCRIPTS` 关掉 ⇒ 同样必须是 undefined；
//   **F 臂（第 32 轮）= 把源码里那两道过滤逐字摘掉再提取同一个真函数** ⇒ 同一条
//   `./index.js` 必须被注入进去（这才是"去掉过滤 ⇒ 断言必红"的真对照；
//   摘不动源码时门禁自己变红，不会静默退化成假绿）。
//   （③+④ 的分离断言：坏的那条进了 `__muvScriptErrs`，好的那条照样写了变量。）
//
// 运行：node verify-tavernhelper-scripts.mjs
// ⚠ 需要浏览器（MUV_EDGE 或系统里的 Edge）；真卡那一节依赖本机 ST 角色目录，
//   卡文件不在时会明确标成 SKIP（不计通过），不会拿"没读到"冒充"读对了"。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openPage, evalJson, sleep, buildFrom, readEngineSource } from './verify-shared.mjs'
import { listCardScripts, enabledScriptsOf, resetCardScriptCache } from './lib/card-scripts.js'

let pass = 0, fail = 0, skip = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name) }
  else { fail++; console.log('  FAIL ' + name + (detail === undefined ? '' : '  -> ' + detail)) }
}
function skipped(name, why) {
  skip++
  console.log('  SKIP ' + name + '  -> ' + why)
}

const SRC = readEngineSource()
const CARD_DIR = process.env.MUV_CARD_DIR || 'C:\\MySpecialFolder\\SillyTavern\\data\\default-user\\characters'

// ── 1. 服务端：真卡的脚本清单（enabled 过滤 + 字段路径）────────────────────
//
// 字段路径（2026-09-23 从 PNG 的 tEXt 'chara' chunk 取证，不是猜的）：
//   `<卡 JSON>.data.extensions.tavern_helper.scripts[]`
//   元素 = {type, enabled, name, id, content, info, button, data, export_with}
// 复跑取证的办法：node -e "import('dsh-muv-table/lib/png-card.js').then(m=>
//   JSON.stringify(Object.keys(m.readPngCard('<png 路径>').data.extensions)))"
console.log('=== [1] 服务端读真卡：enabled 脚本清单 ===')
{
  const names = (r) => r.scripts.map((s) => s.name)
  if (!fs.existsSync(CARD_DIR)) {
    skipped('真卡目录存在', '找不到 ' + CARD_DIR + '（设 MUV_CARD_DIR）')
  } else {
    const mvu = listCardScripts({ cardName: '魔法少女MVU测试' })
    const hasMvu = fs.existsSync(path.join(CARD_DIR, '魔法少女MVU测试.png'))
    if (!hasMvu) skipped('魔法少女MVU测试', '卡文件不在本机')
    else {
      check('★★ 魔女卡：卡里共 8 条脚本（字段路径 data.extensions.tavern_helper.scripts 认对了）',
        mvu.total === 8, String(mvu.total))
      check('★★ 魔女卡：只返回 6 条 enabled（disabled 的一条都不出）',
        mvu.scripts.length === 6, String(mvu.scripts.length) + ' :: ' + names(mvu).join(' / '))
      check('★ 第 [0] 条就是 MVU 框架那行纯 import',
        /^\s*import\s+'https:\/\/testingcf\.jsdelivr\.net\/gh\/MagicalAstrogy\/MagVarUpdate/.test(mvu.scripts[0]?.content || ''),
        (mvu.scripts[0]?.content || '').slice(0, 80))
      // 被关掉的那两条与 enabled 的两条**同名**（同脚本的旧版本），所以判据只能看
      // **内容里的独有记号**，不能看名字：
      //   script[4]「有立绘状态栏」enabled  —— 独有记号 ★ v1.3：立绘仅在状态栏图片…
      //   script[5]「无立绘状态栏」disabled —— 独有记号 var HIDE_INLINE_IMG = false;
      const hasEnabledOne = mvu.scripts.some((s) => /HIDE_INLINE_IMG\s*=\s*true\s*;/.test(s.content))
      const hasDisabledOne = mvu.scripts.some((s) => /HIDE_INLINE_IMG\s*=\s*false\s*;/.test(s.content))
      check('★★ 按 enabled 过滤而不是按条数截断（同名的旧版那张不在，新那张在）',
        hasEnabledOne && !hasDisabledOne, '有立绘在=' + hasEnabledOne + ' / 无立绘在=' + hasDisabledOne)
      check('★ 每条都带 name 与 content（前端要用 name 给 data-muv-th 署名）',
        mvu.scripts.every((s) => typeof s.name === 'string' && s.content.length > 0))
    }

    const ft = listCardScripts({ cardName: '_足控天堂2' })
    if (!fs.existsSync(path.join(CARD_DIR, '_足控天堂2.png'))) skipped('_足控天堂2', '卡文件不在本机')
    else {
      check('★★ 足控天堂2：3 条全 enabled（这类卡是清一色的单行 import）',
        ft.total === 3 && ft.scripts.length === 3, ft.total + '/' + ft.scripts.length)
      check('★ 三条都是「一行 import 外源」的形态',
        ft.scripts.every((s) => /^\s*import\b/.test(s.content) && s.content.split('\n').length === 1),
        ft.scripts.map((s) => s.content.split('\n').length).join(','))
      check('★ 含 ERA 变量框架那条', names(ft).some((n) => n.indexOf('ERA变量框架') >= 0), names(ft).join(' / '))
    }

    // ── 第 32 轮：过滤护栏不许误杀真卡 ─────────────────────────────────────
    //   新加的"相对/裸地址"过滤是为**畸形卡 / 被工具改坏的卡**准备的护栏。真卡里
    //   一条都不该命中 —— 命中了就是误杀（真卡那三条单行 import 全是绝对 https）。
    const bareSrc = buildFrom(SRC, ['muvCardScriptBareSrc'], {}, 'muvCardScriptBareSrc')
    const realOnes = []
    for (const cn of ['魔法少女MVU测试', '_足控天堂2']) {
      if (fs.existsSync(path.join(CARD_DIR, cn + '.png'))) realOnes.push(...listCardScripts({ cardName: cn }).scripts)
    }
    if (!realOnes.length) skipped('真卡不被新过滤误杀', '两张真卡都不在本机')
    else {
      const killed = realOnes.filter((s) => bareSrc(s.content)).map((s) => s.name)
      check('★★ 真卡里 ' + realOnes.length + ' 条 enabled 脚本**一条都没被**"相对/裸地址"过滤命中' +
        '（护栏只拦畸形卡，不误杀真卡）', killed.length === 0, killed.join(' / '))
      check('★★ 真卡里没有一条 content 去空白后为空（否则新过滤会静默少跑脚本）',
        realOnes.every((s) => String(s.content || '').trim().length > 0),
        realOnes.filter((s) => !String(s.content || '').trim()).map((s) => s.name).join(' / '))
    }

    // enabled=false 的语义单元两档
    const fake = {
      data: {
        extensions: {
          tavern_helper: {
            scripts: [
              { type: 'script', enabled: true, name: '上', content: '/*A*/' },
              { type: 'script', enabled: false, name: '下', content: '/*B*/' }
            ]
          }
        }
      }
    }
    check('★★ enabled=false 被剔除（ST 面板里关掉的脚本不许被喂给卡）',
      enabledScriptsOf(fake).length === 1 && enabledScriptsOf(fake)[0].name === '上')
    check('★ 卡没有 tavern_helper ⇒ 空数组（不是 undefined、不抛）',
      Array.isArray(enabledScriptsOf({ data: {} })) && enabledScriptsOf({ data: {} }).length === 0)
    resetCardScriptCache()
  }
}

// ── 2. 字符串层：注入点了没有 / 顺序 / 开关 ────────────────────────────────
console.log('\n=== [2] 注入串：一条一签、按序、开关 ===')
const SCRIPT_A = '/* A */\nwindow.__probeA = 1;\n'
const SCRIPT_B = "import 'https://127.0.0.1:1/muv-必挂.js';\nwindow.__probeB = 1;\n"
const LIST = [
  { name: '甲·写变量', content: SCRIPT_A },
  { name: '乙·import 不存在的 URL', content: SCRIPT_B }
]

const withCardScripts = buildFrom(SRC, ['withCardScripts'], { MUV_CARD_SCRIPTS: true }, 'withCardScripts')
const withCardScriptsOff = buildFrom(SRC, ['withCardScripts'], { MUV_CARD_SCRIPTS: false }, 'withCardScripts')

const CARD = '<!DOCTYPE html>\n<html>\n<head>\n<title>ARM</title>\n</head>\n<body>\n' +
  '<div id="keep">KEEPME</div>\n</body>\n</html>'
const injected = withCardScripts(CARD, LIST)
{
  check('★ 注明两个 script type=module（一条一个，不是合成一坨）',
    (injected.match(/<script type="module"/g) || []).length === 2,
    String((injected.match(/<script type="module"/g) || []).length))
  check('★ 每条都带 data-muv-th 署名（报错时才能说到哪一条）',
    /data-muv-th="[^"]*甲[^"]*"/.test(injected) && /data-muv-th="[^"]*乙[^"]*"/.test(injected))
  check('★★ 顺序 = 卡里数组的顺序（甲在乙之前）',
    injected.indexOf('__probeA') < injected.indexOf('__probeB'),
    [injected.indexOf('__probeA'), injected.indexOf('__probeB')].join('/'))
  check('★ 落点在 body 内部（最后一个 </body> 之前，不是接在文档外）',
    injected.indexOf('<script type="module"') < injected.lastIndexOf('</body>'),
    [injected.indexOf('<script type="module"'), injected.lastIndexOf('</body>')].join('/'))
  check('★ import 的绝对 URL 原样保留（不走代理、不改写）',
    injected.indexOf("https://127.0.0.1:1/muv-必挂.js") > -1)
  check('★ 错误收集器在最前面（"__muvScriptErrs" 早于任何卡脚本）',
    injected.indexOf('__muvScriptErrs') < injected.indexOf('__probeA'))
  check('★★ 开关关闭 ⇒ 逐字不动（一个字符都不加）', withCardScriptsOff(CARD, LIST) === CARD)
  check('★ 空清单 ⇒ 逐字不动', withCardScripts(CARD, []) === CARD)
  check('★★ 幂等：注入两次 ⇒ 第二次不变', withCardScripts(injected, LIST) === injected)
  check('★ 卡正文没被吃掉', injected.indexOf('KEEPME') > -1)
  // 内容里真的出现脚本收尾标记 ⇒ 一律跳过（拼出来是为了不在这个夹具文件里留裸的那个串）
  const CLOSER = String.fromCharCode(60) + '/script>'
  const bad = { name: '坏', content: 'var s = "' + CLOSER + '";' }
  const good = { name: '好', content: 'window.__probeOk=1;' }
  const docBad = withCardScripts(CARD, [bad, good])
  check('★★ 内容里带脚本收尾标记的条目被跳过，其余照常注入（内联会截断 srcdoc）',
    docBad.indexOf('坏') === -1 && docBad.indexOf('__probeOk') > -1,
    '坏在=' + (docBad.indexOf('坏') > -1) + ' / 好在=' + (docBad.indexOf('__probeOk') > -1))
  // 端到端：服务端过滤 → 注入器。disabled 的那条连 srcdoc 都进不去。
  const picked = enabledScriptsOf({
    data: {
      extensions: {
        tavern_helper: {
          scripts: [
            { type: 'script', enabled: false, name: '丙·被禁用', content: 'window.__probeDisabled = 1;' },
            { type: 'script', enabled: true, name: '丁·启用', content: 'window.__probeD = 1;' }
          ]
        }
      }
    }
  })
  const chained = withCardScripts(CARD, picked)
  check('★★ 端到端：disabled 的那条进不到注入串（服务端过滤 → 注入器）',
    chained.indexOf('__probeDisabled') === -1 && chained.indexOf('__probeD') > -1,
    'disabled 在=' + (chained.indexOf('__probeDisabled') > -1))
}

// ── 2.1（第 32 轮）过滤：空白 / 相对地址，且留痕**带名字**─────────────────────
//
// 症状来源（用户真机控制台，两条都取证过）：
//   ① `Uncaught ReferenceError: YAML is not defined`（见 verify-card-libs.mjs 的 yaml 节）；
//   ② `[muv-engine] 卡脚本报错：（未知脚本）脚本加载失败（本次不执行） http://127.0.0.1:3080/`
//      —— content 不是代码而是一个相对/空地址时，浏览器拿**宿主页**当地址基准去解析，
//      请求直接打到 DSH 自己身上；而"（未知脚本）"是因为那个报错元素**没有署名**。
console.log('\n=== [2.1] 过滤（空白 / 相对地址）与留痕带名字 ===')
const FILTER_LIST = [
  { name: '甲·空白', content: '   \n\t ' },
  { name: '乙·相对地址', content: './index.js' },
  { name: '丙·裸斜杠', content: '/' },
  { name: '丁·协议相对', content: '//cdn.example/x.js' },
  { name: '戊·绝对导入', content: "import 'https://example.invalid/x.js';" },
  { name: '己·无导入', content: 'window.__probeF = 1;' },
  { name: String.fromCharCode(60) + '/script', content: 'window.__probeG = 1;' }
]
let outFiltered = ''
{
  // 留痕走 console.warn（另一条是 __muvScriptErrs）。抓下来断言**名字与原因都在** ——
  // 只断言"文档里少了一条"是不够的：静默跳过正是这一轮要消灭的东西。
  const warns = []
  const realWarn = console.warn
  console.warn = function () { warns.push([].slice.call(arguments).join(' ')) }
  try { outFiltered = withCardScripts(CARD, FILTER_LIST) } finally { console.warn = realWarn }
  const tagsN = (outFiltered.match(/<script type="module"/g) || []).length
  const find = (re) => warns.filter((w) => re.test(w))

  check('★★ 七条里只注入 3 条（4 条坏 content 被拦下：空白 / ./index.js / / / //cdn…）',
    tagsN === 3, String(tagsN))
  check('★★ 相对地址那条**没有**进文档（否则浏览器会拿宿主地址去取它）',
    outFiltered.indexOf('./index.js') === -1 && outFiltered.indexOf('cdn.example') === -1)
  check('★★ 留痕带名字：空白那条报的是「甲·空白」而不是「（未命名）」',
    find(/内容为空或只有空白/).some((w) => w.indexOf('甲·空白') >= 0) && !find(/（未命名）/).length,
    warns.join(' || ').slice(0, 200))
  check('★★ 留痕带原因 + 带名字 + 带内容片段（相对地址那条要能一眼看出它是什么）',
    find(/相对\/裸地址/).length === 3 && find(/乙·相对地址/).length === 1 &&
    find(/\.\/index\.js/).length === 1,
    find(/相对\/裸地址/).join(' || ').slice(0, 240))
  check('★ 内容**非空**的条目照旧注入（过滤没有扩大化：\n' +
    '      戊·绝对导入 / 己·无导入 / 名字里带收尾标记的三个都在）',
    outFiltered.indexOf("https://example.invalid/x.js") > -1 &&
    outFiltered.indexOf('__probeF') > -1 && outFiltered.indexOf('__probeG') > -1)
  check('★★ 名字里的 `<` 一律转义，注入串里**每个 `</script>` 都是我们自己的收尾**' +
    '（名字里写收尾标记不能截断 srcdoc）',
    (outFiltered.match(/<\/script>/g) || []).length === 4 &&
    (outFiltered.match(/<script type="module"/g) || []).length === 3,
    String((outFiltered.match(/<\/script>/g) || []).length))
  check('★ 注入串不含反引号（运行时产物，与 muvCardLibs 的口径一致）',
    outFiltered.indexOf('`') === -1)
  check('★★ 没有顶层 import/export 的脚本被 try/catch 包一层，catch 里**带着脚本名**自报' +
    '（这样"运行时报错"也说到哪一条，不再一律「（未知脚本）」）',
    outFiltered.indexOf('window.__muvThErr(e,"己·无导入")') > -1)
  check('★ 有顶层 import 的脚本**不包壳**（import 放进 try 块里是语法错误，包错会当场弄死脚本）',
    /data-muv-th="戊·绝对导入">import '/.test(outFiltered))
  check('★ 自报口由错误收集器提供（不是凭空调用）',
    outFiltered.indexOf('window.__muvThErr=function') > -1 &&
    outFiltered.indexOf('window.__muvThErr=function') < outFiltered.indexOf('__probeF'))
}
// ── F 臂（对照）：把**两道过滤逐字从源码里摘掉**，再提取同一个真函数 ──────────
//   为什么必须这么做：A 臂"相对地址没被注入"与"不注入任何脚本"之间只差一个 if ——
//   没有 F 臂，那条断言可能只是"注入器整个没干活"的假绿。摘下来的源码仍走
//   `buildFrom`（逐字提取），所以对照臂跑的**依然是真注入器**，只少那两道 if。
{
  const BLANK_RE = /\n\s*if \(!c\.trim\(\)\) \{[\s\S]*?\n\s*\}\n/
  const SRCFILTER_RE = /\n\s*if \(muvCardScriptBareSrc\(c\)\) \{[\s\S]*?\n\s*\}\n/
  const SRC_NO_FILTER = SRC.replace(BLANK_RE, '\n').replace(SRCFILTER_RE, '\n')
  const stripped = SRC_NO_FILTER !== SRC && !BLANK_RE.test(SRC_NO_FILTER) && !SRCFILTER_RE.test(SRC_NO_FILTER)
  check('★★★ F 臂的前提：两道过滤真的从源码里摘掉了（摘不动就是假对照，宁可这里红）',
    stripped, '摘掉=' + (SRC_NO_FILTER !== SRC))
  let outNoFilter = ''
  if (stripped) {
    const noFilter = buildFrom(SRC_NO_FILTER, ['withCardScripts'], { MUV_CARD_SCRIPTS: true }, 'withCardScripts')
    outNoFilter = noFilter(CARD, FILTER_LIST)
  }
  check('★★★ F 臂（去掉过滤）：同一条 `./index.js` **会被注入** ⇒ ' +
    'A 臂那条"相对地址没进文档"不是永真',
    outNoFilter.indexOf('./index.js') > -1 && outNoFilter.indexOf('cdn.example') > -1,
    '标签数=' + String((outNoFilter.match(/<script type="module"/g) || []).length))
  check('★★ F 臂（去掉过滤）：空白 / 裸斜杠那两条也各占一个标签（7 个，不是 3 个）' +
    '⇒ 空白那条断言同样不是永真',
    (outNoFilter.match(/<script type="module"/g) || []).length === 7,
    String((outNoFilter.match(/<script type="module"/g) || []).length))
}

// ── 3. 真浏览器 + 真沙箱：enabled 的真的跑起来了吗 ─────────────────────────
console.log('\n=== [3] 真浏览器：srcdoc + sandbox=allow-scripts ===')
const EDGE = process.env.MUV_EDGE ||
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => fs.existsSync(p))

// 生产同款沙箱（连同 "\\/" 写法一起逐字取出来，别写死）
const sandbox = (/var\s+MUV_CARD_SANDBOX\s*=\s*(['"][^'"]*['"])/.exec(SRC) || [])[1]
const SANDBOX = sandbox ? new Function('return ' + sandbox)() : 'allow-scripts'
check('★ 沙箱常量取自源码（内联 ==> 与生产一致，没有放宽 same-origin）',
  SANDBOX === 'allow-scripts' && !/allow-same-origin/.test(SANDBOX), String(SANDBOX))

const escAttr = buildFrom(SRC, ['escAttr'], {}, 'escAttr')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muv-th-scripts-'))
// D/E 臂（第 32 轮）：
//   D = 一条**没有顶层 import**、运行时直接抛的脚本 ⇒ 留痕必须**说到它的名字**
//       （这条能力完全来自注入器那层 try/catch，没包壳就只能报「（未知脚本）」）；
//   E = 一个 `<img src="">`（真机那条 `… http://127.0.0.1:3080/` 的形态）⇒ 留痕必须
//       点明「非脚本元素」，不许再把图片挂了叫成"卡脚本报错"。
const RT_ERR = { name: '壬·运行时就抛', content: "throw new Error('boom-壬');\n" }
const withImg = CARD.replace('ARM', 'arm-e')
  .replace('<div id="keep">KEEPME</div>', '<div id="keep">KEEPME</div>\n<img id="broken" src="">')
const arms = {
  a: injected.replace('ARM', 'arm-a'),                                   // 注入
  b: CARD.replace('ARM', 'arm-b'),                                       // 对照：不注入
  c: withCardScriptsOff(CARD.replace('ARM', 'arm-c'), LIST),             // 对照：开关关掉
  d: withCardScripts(CARD.replace('ARM', 'arm-d'), [RT_ERR]),            // 运行时报错 ⇒ 带名字
  e: withCardScripts(withImg, [RT_ERR])                                  // 非脚本元素 ⇒ 说清是 img
}
const page = '<!DOCTYPE html><html><body>\n' +
  Object.keys(arms).map((k) =>
    '<iframe id="f' + k + '" sandbox="' + escAttr(SANDBOX) + '" srcdoc="' + escAttr(arms[k]) + '"></iframe>')
    .join('\n') + '\n</body></html>'
const file = path.join(tmpDir, 'th.html')
fs.writeFileSync(file, page, 'utf8')

const PROBE = 'JSON.stringify({' +
  'title:document.title,' +
  'a:(typeof window.__probeA==="undefined"?null:window.__probeA),' +
  'b:(typeof window.__probeB==="undefined"?null:window.__probeB),' +
  'errs:(window.__muvScriptErrs||[]),' +
  'keep:(document.body&&document.body.innerText||"").indexOf("KEEPME")>=0' +
  '})'

const rt = await openPage(EDGE, { url: 'file:///' + file.replace(/\\/g, '/'), outDir: tmpDir, windowSize: '1200,900' })
try {
  let sessions = []
  for (let i = 0; i < 100 && sessions.length < 5; i++) {
    sessions = rt.cdp.iframeSessions || []
    if (sessions.length < 5) await sleep(150)
  }
  check('★ 五个卡 iframe 都挂上了独立会话（OOPIF）', sessions.length === 5, '实际 ' + sessions.length)

  const byTitle = {}
  for (const s of sessions) {
    for (let i = 0; i < 40; i++) {
      try {
        const o = await evalJson(rt.cdp, PROBE, s.sessionId)
        if (o && o.title) { byTitle[o.title] = { o, sid: s.sessionId }; break }
      } catch (_) {}
      await sleep(150)
    }
  }
  const A = byTitle['arm-a']
  const B = byTitle['arm-b']
  const C = byTitle['arm-c']
  const D = byTitle['arm-d']
  const E = byTitle['arm-e']
  check('★ 五臂都读到了探针（按 title 认领，不假设会话顺序）',
    !!A && !!B && !!C && !!D && !!E, Object.keys(byTitle).join(','))

  // A/D/E 臂：等到各自那条留痕出现（A 的 import 一定会挂 —— URL 指向 127.0.0.1:1；
  // D 的脚本一定会抛；E 的 <img src=""> 一定会加载失败）
  const waitErrs = async (arm, ms) => {
    if (!arm) return null
    const t0 = Date.now()
    let v = arm.o
    while (Date.now() - t0 < ms) {
      v = await evalJson(rt.cdp, PROBE, arm.sid)
      if (v && v.errs && v.errs.length) break
      await sleep(200)
    }
    return v
  }
  const a = await waitErrs(A, 12000)
  const b = B ? await evalJson(rt.cdp, PROBE, B.sid) : null
  const c = C ? await evalJson(rt.cdp, PROBE, C.sid) : null
  const d = await waitErrs(D, 8000)
  const e = await waitErrs(E, 8000)
  console.log('\n  实测 A（注入）: ' + JSON.stringify(a))
  console.log('  实测 B（不注入）: ' + JSON.stringify(b))
  console.log('  实测 C（开关关）: ' + JSON.stringify(c))
  console.log('  实测 D（运行时报错）: ' + JSON.stringify(d))
  console.log('  实测 E（img src=""）: ' + JSON.stringify(e) + '\n')

  check('★★★ A：enabled 的脚本真的执行了（写了 __probeA）', !!a && a.a === 1, a && String(a.a))
  check('★★★ A：import 不存在的那条**自己**没跑起来（__probeB 不存在）',
    !!a && a.b === null, a && String(a.b))
  check('★★★ A：一条挂了不影响另一条（__probeA 仍在）—— 这就是"不拖垮其他"',
    !!a && a.a === 1 && a.b === null, a && JSON.stringify(a))
  check('★★ A：失败留痕了（__muvScriptErrs 里有一条）', !!a && a.errs.length >= 1, a && JSON.stringify(a.errs))
  check('★★ A：留痕**说到脚本名**（不然排障时还是两眼一抹黑）',
    !!a && a.errs.some((e) => String(e).indexOf('乙') >= 0), a && JSON.stringify(a.errs))
  check('★ A：卡正文没被注入吃掉', !!a && a.keep === true)

  check('★★ 对照臂 B：不注入时 __probeA 不存在（判据能红）', !!b && b.a === null, b && String(b.a))
  check('★★ 对照臂 B：不注入时没有任何卡脚本错误留痕', !!b && b.errs.length === 0, b && JSON.stringify(b.errs))
  check('★★ 对照臂 C：开关关掉时 __probeA 不存在（MUV_CARD_SCRIPTS 真的管事）',
    !!c && c.a === null, c && String(c.a))
  check('★ 对照臂 C：开关关掉时正文照旧', !!c && c.keep === true)

  // ── D/E 臂（第 32 轮）：留痕必须"说得清"────────────────────────────────
  check('★★★ D：没有顶层 import 的脚本运行时报错 ⇒ 留痕**带着脚本名**（不再「（未知脚本）」）',
    !!d && d.errs.some((x) => String(x).indexOf('壬·运行时就抛') >= 0 && String(x).indexOf('boom-壬') >= 0),
    d && JSON.stringify(d.errs))
  check('★★ D：同一条留痕**没有**退化成「（未知脚本）」（名字真的带上了）',
    !!d && !d.errs.some((x) => String(x).indexOf('（未知脚本）') >= 0), d && JSON.stringify(d.errs))
  check('★★★ E：`<img src="">` 这类**非脚本元素**的报错不许被叫成"卡脚本报错"' +
    '（真机那条 `… 脚本加载失败（本次不执行） http://127.0.0.1:3080/` 就是它）',
    !!e && e.errs.some((x) => String(x).indexOf('非脚本元素 <img>') >= 0 && String(x).indexOf('不是卡脚本') >= 0),
    e && JSON.stringify(e.errs))
  check('★ E：留痕里没有把它说成"脚本加载失败"（误导排查的那半句去掉了）',
    !!e && !e.errs.some((x) => String(x).indexOf('脚本加载失败') >= 0), e && JSON.stringify(e.errs))
} finally {
  rt.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skip ? ', ' + skip + ' 跳过' : '') + ' ===')
process.exit(fail ? 1 : 0)
