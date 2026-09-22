// 同类枚举排查：把**真卡 10 条脚本**涉及的全部标记形态抽出来，逐个问"旧枚举认不认"。
import { regexScriptsOf } from './lib/regex-engine.js'
import { readPngCard } from './../dsh-muv-table/lib/png-card.js'

const card = readPngCard('C:/MySpecialFolder/SillyTavern/data/default-user/characters/_足控天堂2.png')
const scripts = regexScriptsOf(card)
const OLD = /<StatusPlaceHolder|<\/?now_plot\b|<\/?content\b|<UpdateVariable|<Prism|<Status_?Block|<状况|<maintext|<choices?\b|<Variable(?:Edit|Insert|Think)\b|<Abstract\b/i
const NEW = /<[!\/]?[a-zA-Z_\u4e00-\u9fa5][^<>]*>/

const MARKERS = new Set()
for (const s of scripts) {
  const re = String(s.findRegex || '')
  for (const m of re.matchAll(/<[^<>]{1,40}>/g)) {
    // 只收"字面量名字"形态（去掉正则元字符噪声太大的）
    if (/[\\\[\](){}|?*+^$]/.test(m[0])) continue
    MARKERS.add(m[0])
  }
}
console.log('从卡脚本 findRegex 里抽出的字面量标记形态: ' + MARKERS.size)
const rows = [...MARKERS].sort()
let oldMiss = 0
for (const t of rows) {
  const o = OLD.test(t)
  const n = NEW.test(t)
  if (!o) oldMiss++
  console.log('  ' + (o ? '旧认' : '旧漏') + ' / ' + (n ? '新放' : '新漏') + '  ' + JSON.stringify(t))
}
console.log('\n旧枚举漏掉 ' + oldMiss + ' / ' + rows.length + ' 个卡脚本标记形态')

// 另外手工补几个"卡/引擎会产出、但不在 findRegex 字面量里"的形态
console.log('\n手工补充（引擎侧要写的/卡产物要写的）:')
for (const t of ['<VariableDelete>', '<variabledelete>', '<StatusPlaceHolderImpl/>', '<era_data>', '<video src="x.mp4" controls>', '<img src="x.webp">', '<audio>欢快</audio>', '<插图>海边</插图>', '<JSONPatch>', '</content>', '<!DOCTYPE html>', '<choices>', '【主页】']) {
  console.log('  ' + (OLD.test(t) ? '旧认' : '旧漏') + ' / ' + (NEW.test(t) ? '新放' : '新漏') + '  ' + JSON.stringify(t))
}
