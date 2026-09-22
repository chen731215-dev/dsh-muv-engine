// 定点重建被「丢字+丢换行」压扁的注释块（第 86—91 行）。
// 原文来自我在损坏前对 verify-frame-size.mjs 的读取（当时的第 100—111 行），逐字回填。
import fs from 'node:fs'
const f = 'C:\\dsh-muv-engine\\verify-frame-size.fixed2.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
const START = 86, END = 91   // 1-based，含两端
const old = lines.slice(START - 1, END)
console.log('将被替换的 ' + old.length + ' 行：')
for (const o of old) console.log('  ' + JSON.stringify(o.slice(0, 100)))
const fixed = [
  "    // ★ 已按 ST 规格对齐：ST 的 `b1()` 注入的是**一条规则、单个简写属性**",
  "    //   `html,body{…;overflow:hidden!important}`（见 ST-IFRAME-SPEC.md §1）。",
  "    //   我们此前是「横向 hidden、纵向 auto」的偏离，理由是\"让卡自己能滚\"；但那条偏离",
  "    //   正是用户看到的\"框里还有滚动条\"，而且和高度口径互为因果（纵向靠滚动兜底 ⇒",
  "    //   内容再高也不报高度）。现在高度按内容量走 ⇒ 必须跟 ST 一样 hidden。",
  "    //   ⚠ 想改回 `overflow-y:auto` 之前，先读 muvCardResetCss 的注释与 §8 偏离表。",
  "    ['html,body overflow:hidden!important（ST 口径，简写属性）', /html\\s*,\\s*body\\{[^}]*overflow:hidden!important/],",
  "  ]",
  "  for (const [label, re] of need) check('B: reset 含 ' + label, re.test(resetProbe), resetProbe.slice(0, 260))",
  "  // 反向断言：锁死旧偏离，别让它悄悄回退（回退了卡里就会重新长出内部滚动条）",
  "  check('B: reset 不含 overflow-y:auto（旧偏离不许回退）',",
]
const out = lines.slice(0, START - 1).concat(fixed, lines.slice(END))
fs.writeFileSync(f, out.join('\n'), 'utf8')
console.log('替换完成：' + old.length + ' 行 → ' + fixed.length + ' 行')
