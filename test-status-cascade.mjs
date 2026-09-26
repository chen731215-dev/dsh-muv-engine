// Self-contained regression for the status cascade (stages 2-4).
// Run: node _cascade-regression.mjs
import { renderStatusFromText, extractStatusBody, extractHeaderFields } from './lib/status-cascade.js'

let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('=== 级联回归测试 ===\n')

// 1) 用户实际形态：『』内换行 + 章节标签
const c1 = `『
📅 日期：05月14日 星期三 | ⏰ 时间：21:14 |
📍 位置：暮川市·旧片区·旧宅区·森田宅门口』

[角色状态]
[NPC状态]`
const h1 = extractHeaderFields(c1)
const r1 = renderStatusFromText(c1)
console.log('[1] 拆行表头 + 章节标签')
check('表头日期正确', h1.date === '05月14日 星期三', h1.date)
check('表头时间正确', h1.time === '21:14', h1.time)
check('表头地点正确', h1.location.includes('森田宅门口'), h1.location)
check('命中 loose 级', r1 && r1.source === 'loose', r1 && r1.source)
check('渲染出表头', r1 && r1.html.includes('muv-sb-hd'))
check('不再残留『', r1 && !r1.html.includes('『'))

// 2) 瑟瑟提瓦特 YAML
const c2 = `状态栏:
  日期和时间: "⏰ 2025年01月17日 23点15分"
  地点: "📍 步非烟的私人直播间"
  用户列表:
    - 用户: 步非烟 名字: "👤 步非烟" 行动: "📝 刚完成抽奖" 内心: "💭 为什么…"
  行动选项:
    - "🏆 继续连线"`
const r2 = renderStatusFromText(c2)
console.log('\n[2] 瑟瑟提瓦特 YAML')
check('命中 yaml 级', r2 && r2.source === 'yaml', r2 && r2.source)
check('渲染角色名', r2 && r2.html.includes('👤 步非烟'))
check('emoji 不重复', r2 && !r2.html.includes('👤 👤') && !r2.html.includes('📝 📝'))
check('渲染行动选项', r2 && r2.html.includes('muv-sb-opt'))

// 3) 白厄纯文字：- 😋 名字 + 缩进字段
const c3 = `『📅 日期：08月31日 周一 | ⏰ 时间：06点40分 | 📍 位置：沉香廊·后院廊下』

- 😋 栎木
  - 🚶 当前行动：蹲在长凳边
  - 👔 当前穿搭：浅色短袖`
const r3 = renderStatusFromText(c3)
console.log('\n[3] 纯文字：- 😋 名字')
check('命中 loose 级', r3 && r3.source === 'loose', r3 && r3.source)
check('渲染角色名', r3 && r3.html.includes('😋 栎木'))
check('字段加粗成标签', r3 && r3.html.includes('<b>🚶 当前行动</b>'))
check('表头拆成一行', r3 && r3.html.includes('📅 08月31日 周一 06点40分'))

// 4) 👤 自由格式
const c4 = `⏰ 时间：21:14
📍 地点：旧宅门口
👤 川上富江 😃
手指上仍沾着血
行动选项
- 追问她的来意`
const r4 = renderStatusFromText(c4)
console.log('\n[4] 👤 自由格式')
check('命中 free 级', r4 && r4.source === 'free', r4 && r4.source)
check('渲染角色', r4 && r4.html.includes('川上富江'))
check('渲染备注', r4 && r4.html.includes('沾着血'))

// 4b) `- 😃 名字的状态` + <details><summary> 包裹 + 代码围栏（模型最常见的形态）
const c4b = `『📅 日期：05月14日 星期三 | ⏰ 时间：18:47 | 📍 位置：暮川市·旧片区·窄巷底』

<details><summary>[角色状态]</summary>
\`\`\`
- 😃 川上富江的状态
  - 🏃 当前行动：退开半步
  - 👗 当前穿搭：水手制服上衣
\`\`\`
</details>`
const r4b = renderStatusFromText(c4b)
console.log('\n[4b] - 😃 名字的状态 + details 包裹')
check('命中 loose 级', r4b && r4b.source === 'loose', r4b && r4b.source)
check('提取角色名（去掉「的状态」）', r4b && r4b.html.includes('😃 川上富江') && !r4b.html.includes('川上富江的状态'))
check('生成角色行', r4b && r4b.html.includes('muv-sb-char-name'))
check('剥离 <details>', r4b && !/details|summary/i.test(r4b.html))
check('剥离代码围栏', r4b && !r4b.html.includes('```'))
check('章节标签保留', r4b && r4b.html.includes('角色状态'))
check('字段加粗', r4b && r4b.html.includes('<b>🏃 当前行动</b>'))

// 4c) 模型真实形态：summary + 围栏 + 角色名【同一行】，且字段行【无前导破折号】。
//     两个坑都踩过：丢掉同行余下的角色名 → 只剩章节标题；把无破折号字段行
//     当表头删掉 → 字段全空。
const c4c = `『
📅 日期： 05月14日 星期三 | ⏰ 时间： 21:14 |
📍 位置： 暮川市·旧片区·旧宅区·森田宅门口』

<details><summary>[角色状态]</summary> \`\`\` - 😃 川上富江的状态 -
🏃 当前行动： 被他背到森田宅门口 -
👗 当前穿搭： 水手制服上衣 -
\`\`\` </details>
<details><summary>[NPC状态]</summary> \`\`\` - 😃 森田的状态 -
🏃 当前行动： 开门、让两人进屋 -
\`\`\` </details>`
const r4c = renderStatusFromText(c4c)
console.log('\n[4c] summary+围栏+角色名同行 且 字段无破折号')
check('命中 loose 级', r4c && r4c.source === 'loose', r4c && r4c.source)
check('两个章节都提取', r4c && r4c.html.includes('角色状态') && r4c.html.includes('NPC状态'))
check('两个角色都提取', r4c && r4c.html.includes('😃 川上富江') && r4c.html.includes('😃 森田'))
check('无破折号字段未被当表头删掉', r4c && r4c.html.includes('<b>🏃 当前行动</b>'))
check('字段数量正确(3)', r4c && (r4c.html.match(/<b>/g) || []).length === 3, r4c && String((r4c.html.match(/<b>/g) || []).length))
check('表头正确', r4c && r4c.html.includes('📅 05月14日 星期三 21:14'))
check('无残留详情标签', r4c && !/details|summary/i.test(r4c.html))

// 4d) 一行里塞了「多个字段 + 角色名」，且 NPC 标记被模型放到了这一行之前。
//     整行当一个字段会同时丢掉两个字段、并把角色名混进字段文本里。
const c4d = `<details><summary>[角色状态]</summary> \`\`\` - 😃 川上富江的状态 -
🏃 当前行动： 被他背到森田宅门口 -
🌸 下体状况：无反应，湿冷环境已压下此前状态 - 🥩 肉质：外貌A/肌肉D/脂肪B/乳酸A（总评B） - 😃 森田的状态 -
🏃 当前行动： 开门、让两人进屋 -
\`\`\` </details>`
const r4d = renderStatusFromText(c4d)
console.log('\n[4d] 一行含多字段 + 角色名')
const dHtml = r4d ? r4d.html : ''
const moritaAt = dHtml.indexOf('>😃 森田<')
check('森田是独立角色行', dHtml.includes('muv-sb-char-name">😃 森田<'))
check('下体状况归给富江（在森田之前）', dHtml.indexOf('下体状况') > dHtml.indexOf('>😃 川上富江<') && dHtml.indexOf('下体状况') < moritaAt)
check('肉质归给富江（在森田之前）', dHtml.indexOf('肉质') > dHtml.indexOf('>😃 川上富江<') && dHtml.indexOf('肉质') < moritaAt)
check('字段被拆成独立行', dHtml.includes('<b>🌸 下体状况</b>') && dHtml.includes('<b>🥩 肉质</b>'))
check('字段数量正确(4)', (dHtml.match(/<b>/g) || []).length === 4, String((dHtml.match(/<b>/g) || []).length))

// 4e) 模型把下一个章节标记提前盖在了仍属于上一个角色的字段之前：
//     `<details><summary>[NPC状态]</summary> 🌸 下体状况… - 😃 森田`
//     直接按标记关闭角色会把这两个字段变成无归属的裸行。
const c4e = `<details><summary>[角色状态]</summary> \`\`\` - 😃 川上富江的状态 -
💭 当前内心： 森田不惊不惧 -
<details><summary>[NPC状态]</summary> \`\`\` 🌸 下体状况：无反应 - 🥩 肉质：外貌A（总评B） - 😃 森田的状态 -
🏃 当前行动： 开门、让两人进屋 -
\`\`\` </details>`
const r4e = renderStatusFromText(c4e)
console.log('\n[4e] 章节标记提前于上一角色的字段')
const eHtml = r4e ? r4e.html : ''
const eFj = eHtml.indexOf('>😃 川上富江<')
const eMorita = eHtml.indexOf('>😃 森田<')
const eNpc = eHtml.indexOf('NPC状态')
check('下体状况留在富江卡内', eHtml.indexOf('下体状况') > eFj && eHtml.indexOf('下体状况') < eMorita)
check('肉质留在富江卡内', eHtml.indexOf('肉质') > eFj && eHtml.indexOf('肉质') < eMorita)
check('NPC状态标签排到富江卡之后', eNpc > eFj)
check('NPC状态标签排在森田之前', eNpc < eMorita)
check('无孤立裸行(muv-sb-line 都在角色卡内)',
  (eHtml.match(/<div class="muv-sb-line">/g) || []).length === (eHtml.match(/<b>/g) || []).length,
  `${(eHtml.match(/<div class="muv-sb-line">/g) || []).length} 行 / ${(eHtml.match(/<b>/g) || []).length} 加粗`)

// 5) 纯正文必须拒绝，否则会误伤正常回复
const r5 = renderStatusFromText('他推开门，风灌了进来。\n「你来了。」她说。')
console.log('\n[5] 纯正文（必须拒绝）')
check('正确拒绝', r5 === null, r5 && r5.source)

// 6) Status_block 包裹提取 + 转义形态
console.log('\n[6] Status_block 包裹提取')
check('普通形态', extractStatusBody('<Status_block>\n内容\n</Status_block>').trim() === '内容')
check('含空格变体', extractStatusBody('< Status_block >\n内容\n</ Status_block >').trim() === '内容')
check('转义形态', extractStatusBody('&lt;Status_block&gt;内容&lt;/Status_block&gt;').trim() === '内容')
check('无标签返回空', extractStatusBody('没有标签') === '')

// 7) 行动选项：模型对同一件事写出了四种不同标记，全都必须变成按钮。
//    回归背景：yaml 级只认 `- `/`• `，free 级只认 `1.`，loose 级压根没有
//    选项概念。于是 A./B./C. 这套最常用的写法被整段丢掉，用户看到的
//    「选项没了」就是这么来的。
function optTexts(html) {
  return (html.match(/<button type="button" class="muv-sb-opt">([^<]*)<\/button>/g) || [])
    .map(b => b.replace(/<[^>]*>/g, ''))
}
console.log('\n[7] 行动选项（四种标记）')

const optCases = {
  '字母 A./B./C.（free 级）': {
    body: '👤 川上富江\n  当前行动：坐在教室后排\n行动选项:\nA. 走过去搭话\nB. 假装没看见\nC. 直接离开',
    want: ['走过去搭话', '假装没看见', '直接离开']
  },
  '数字 1./2.（free 级）': {
    body: '👤 川上富江\n行动选项:\n1. 走过去搭话\n2. 假装没看见',
    want: ['走过去搭话', '假装没看见']
  },
  '项目符号 -（loose 级）': {
    body: '😃 川上富江\n- 当前行动：坐在教室后排\n行动选项:\n- 走过去搭话\n- 假装没看见',
    want: ['走过去搭话', '假装没看见']
  },
  '全角顿号 A、（free 级）': {
    body: '👤 川上富江\n行动选项:\nA、走过去搭话\nB、假装没看见',
    want: ['走过去搭话', '假装没看见']
  }
}
for (const [name, c] of Object.entries(optCases)) {
  const r = renderStatusFromText(c.body)
  const html = r ? r.html : ''
  const opts = optTexts(html)
  check(name + ` → 按钮数=${c.want.length}`, opts.length === c.want.length, `实际 ${opts.length}: ${JSON.stringify(opts)}`)
  check(name + ' → 文本与顺序正确', opts.join('|') === c.want.join('|'), JSON.stringify(opts))
}

// 选项后面紧跟下一个角色时，不能让角色名被吞成选项
const c7e = '👤 川上富江\n行动选项:\nA. 走过去搭话\nB. 假装没看见\n👤 森田\n  当前行动：开门'
const r7e = renderStatusFromText(c7e)
check('选项后接新角色：森田成独立角色块', r7e && r7e.html.includes('👤 森田'), r7e && r7e.html.slice(0, 200))
check('选项后接新角色：森田未被当成选项', r7e && optTexts(r7e.html).length === 2, r7e && JSON.stringify(optTexts(r7e.html)))

// 纯正文里出现「行动」二字不应凭空造出选项区
const r7f = renderStatusFromText('他推开门。\n你可以自由行动。')
check('纯正文不产生选项区', r7f === null, r7f && r7f.source)

// 8) 选项与状态栏同时存在时，两者都要在
const c8 = '👤 川上富江\n  当前行动：坐在教室后排\n行动选项:\nA. 走过去搭话\nB. 假装没看见'
const r8 = renderStatusFromText(c8)
check('状态栏与选项区共存', r8 && r8.html.includes('muv-sb-row') && r8.html.includes('muv-sb-opts'))

// 9) 预设提示词里约定的「理想格式」必须一次渲染到位。
//    tavern 预设的 format 现在明确要求：每字段独占一行、角色名行只有名字、
//    章节标记紧贴所属角色、选项用 A./B./C. 独占一行。这份文本就是那个
//    约定的直译，解析器必须完整吃下它，否则提示词与渲染会各说各话。
const ideal = `『📅 日期：05月14日 星期三 | ⏰ 时间：21:14 | 📍 位置：暮川市·旧宅区·森田宅门口』
<details><summary>[角色状态]</summary>

- 😋 我
- 🚶 当前行动：站在门口敲门
- 👔 当前穿搭：黑色外套
- 🔞 下体状态：正常
- 🥩 肉质：3a1b，紧实

<details><summary>[NPC状态]</summary>

- 😃 川上富江
- 🏃 当前行动：坐在教室后排
- 👗 当前穿搭：校服
- 💭 当前内心：好奇
- 🌸 下体状况：无反应
- 🥩 肉质：4a，极佳

## 行动选项
A. 走过去搭话
B. 假装没看见
C. 直接离开
`
const r9 = renderStatusFromText(ideal)
const h9 = r9 ? r9.html : ''
console.log('\n[9] 预设理想格式端到端')
check('渲染成功', !!r9, r9 && r9.source)
check('表头渲染', h9.includes('muv-sb-hd'))
check('两个章节标记', (h9.match(/muv-sb-sect/g) || []).length === 2, String((h9.match(/muv-sb-sect/g) || []).length))
check('两个角色块', (h9.match(/muv-sb-char-name/g) || []).length === 2, String((h9.match(/muv-sb-char-name/g) || []).length))
check('三个选项按钮', optTexts(h9).length === 3, JSON.stringify(optTexts(h9)))
check('选项文本正确', optTexts(h9).join('|') === '走过去搭话|假装没看见|直接离开', JSON.stringify(optTexts(h9)))
check('无『残留', !h9.includes('『'))
check('无 ## 残留', !h9.includes('##'))
check('无 <details> 残留', !h9.includes('details'))

// 10) 可移植性：别人的角色卡未必写中文标签。英文标签、`## Options` 这类
//     markdown 装饰也必须能识别，否则「随便导入一张卡」就渲染不出选项。
console.log('\n[10] 英文 / markdown 装饰标签')
const c10 = `[Character Status]
- 😃 Alice
- 🏃 Action: sitting by the window
- 👗 Outfit: school uniform

## Options
A. Walk over
B. Ignore`
const r10 = renderStatusFromText(c10)
const h10 = r10 ? r10.html : ''
check('英文 Options 出按钮', optTexts(h10).length === 2, JSON.stringify(optTexts(h10)))
check('角色块存在', (h10.match(/muv-sb-char-name/g) || []).length === 1)
check('章节标签不重复渲染', (h10.match(/Character Status/g) || []).length === 1, String((h10.match(/Character Status/g) || []).length))
check('中英混排不冲突', (() => {
  const r = renderStatusFromText('- 😃 富江\n- 🏃 当前行动：坐着\nOptions:\nA. 搭话\nB. 离开')
  return r && optTexts(r.html).length === 2
})())

// 11) 瑟瑟提瓦特的 YAML 形态：字段任意、条目不一定从行首开始。
//     回归背景：旧实现要求行首正好是 `- 用户:`，而实际文本里第一条前面挂着
//     `用户列表:` 前缀，于是整条角色被丢；字段也被写死成 名字/行动/内心/衣着
//     四个，穿搭/小穴/胸部/肛门/阳具/最近性行为 全部消失。用户看到的就是
//     「整张卡只剩一个头部条」。
console.log('\n[11] YAML 形态：任意字段 + 行首前缀 + 单行选项')
const c11 = `状态栏: 日期和时间: "🎀 提瓦特历 Day1 下午15点40分" 地点: "📍 蒙德城·西风骑士团宿舍区·安柏的房间"
用户列表: - 用户: 名字: "🎀 安柏" 行动: "🛏️ 半躺在床上" 内心: "门是我自己插的" 穿搭: "🔴 红色侦察骑士制服" 小穴: "🌸 潮气已凉" 胸部: "🍒 起伏得很乱" 肛门: "🍑 收紧" 最近性行为: - 性行为: "{🌸 无}"
- 用户: 名字: "🍆 柊木" 行动: "🦵 单膝跪在地板前" 穿搭: "🔵 异界风格休闲装" 阳具: "🍆 硬得发胀" 最近性行为: - 性行为: "{🌸 无}"
行动选项: 名字: "🍆 柊木" 选项: - "1.最佳选项: 把那截脚骨收进兜里" - "2.最佳选项: 先不吃了" - "3.中等选项: 承认自己不是新人" - "4.淫秽选项: 逐一含进嘴里"`
const r11 = renderStatusFromText(c11)
const h11 = r11 ? r11.html : ''
check('两个角色都在', (h11.match(/muv-sb-name/g) || []).length === 2, String((h11.match(/muv-sb-name/g) || []).length))
check('安柏没有被丢掉', h11.includes('安柏'))
check('柊木在', h11.includes('柊木'))
check('穿搭字段保留', h11.includes('<b>穿搭</b>'))
check('小穴字段保留', h11.includes('<b>小穴</b>'))
check('胸部字段保留', h11.includes('<b>胸部</b>'))
check('肛门字段保留', h11.includes('<b>肛门</b>'))
check('阳具字段保留', h11.includes('<b>阳具</b>'))
check('最近性行为保留', h11.includes('<b>性行为</b>'))
check('四个选项', optTexts(h11).length === 4, JSON.stringify(optTexts(h11)))
check('选项文本正确', optTexts(h11)[0] === '最佳选项: 把那截脚骨收进兜里', JSON.stringify(optTexts(h11)[0]))
check('名字没被当成选项', !optTexts(h11).some(o => o.includes('柊木')), JSON.stringify(optTexts(h11)))
check('表头仍在', h11.includes('muv-sb-hd') && h11.includes('提瓦特历'))

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
