// 调试：把 fixture 里最后一段 <script>（驱动脚本）抠出来做语法检查并跑一遍（DOM 用桩）。
import fs from 'node:fs'
const html = fs.readFileSync(process.argv[2], 'utf8')
const parts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
console.log('script 块数: ' + parts.length + ' 长度: ' + JSON.stringify(parts.map(p => p.length)))
const driver = parts[parts.length - 1]
console.log('--- driver head 400 ---')
console.log(driver.slice(0, 400))
try {
  new Function(driver)
  console.log('\n语法: OK')
} catch (e) {
  console.log('\n语法错误: ' + e.message)
  const m = /(\d+)/.exec('')
}
fs.writeFileSync('C:/dsh-muv-engine/.work-driver.js', driver, 'utf8')
console.log('driver -> .work-driver.js')
