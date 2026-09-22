import fs from 'node:fs'
const dir = 'C:\\dsh-muv-engine\\'
fs.copyFileSync(dir + 'verify-frame-size.mjs', dir + '.work-frame-size-before-restore.mjs')
console.log('已备份 .work-frame-size-before-restore.mjs ' + fs.statSync(dir + '.work-frame-size-before-restore.mjs').size + ' B')
