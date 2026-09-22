import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
const D = fs.readFileSync(dir + 'verify-frame-size.mjs', 'utf8').replace(/^\uFEFF/, '').split('\n')
let n = 0
for (let i = 0; i < D.length; i++) {
  if (!D[i].includes('?')) continue
  // 疑似洞：`?` 紧贴汉字，或 `?` 后面紧跟引号/标点
  if (/[\u4e00-\u9fff]\s*\?|[\u3001-\u303f\uff00-\uffef]\s*\?|\?\s*['"）】」]$|[\u4e00-\u9fff]\?['"，。、）]/.test(D[i])) {
    n++
    console.log((i + 1) + ': ' + D[i].trim().slice(0, 130))
  }
}
console.log('疑似残留洞 ' + n + ' 行')
