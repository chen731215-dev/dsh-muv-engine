// 调试 2：按 lastIndexOf 抠真正的驱动脚本。
import fs from 'node:fs'
const html = fs.readFileSync(process.argv[2], 'utf8')
const a = html.lastIndexOf('<script>')
const b = html.lastIndexOf('</script>')
console.log('last <script> at ' + a + '  last </script> at ' + b + '  len=' + (b - a))
const driver = html.slice(a + '<script>'.length, b)
console.log('--- head 600 ---\n' + driver.slice(0, 600))
console.log('--- tail 300 ---\n' + driver.slice(-300))
try { new Function(driver); console.log('\n语法: OK') } catch (e) { console.log('\n语法错误: ' + e.message) }
fs.writeFileSync('C:/dsh-muv-engine/.work-driver.js', driver, 'utf8')
