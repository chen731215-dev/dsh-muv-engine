// 在"git 写引用不持久"的环境里可靠地落一笔提交：
//   git write-tree → git commit-tree（只写对象）→ fs 直写 refs/heads/<branch> → 校验
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function git(repo, args, input) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 1 << 28, input, env: { ...process.env, GIT_PAGER: 'cat' },
  })
}
function writeRef(repo, branch, sha) {
  const p = path.join(repo, '.git', 'refs', 'heads', branch)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, sha + '\n', 'utf8')
  return p
}

/** @param {{repo:string, branch:string, parent:string, message:string, files?:boolean}} opt */
export function commitDirect({ repo, branch, parent, message, files = false }) {
  if (files) git(repo, ['add', '-A'])
  const tree = git(repo, ['write-tree']).trim()
  const sha = git(repo, ['commit-tree', tree, '-p', parent], message).trim()
  writeRef(repo, branch, sha)
  return { tree, sha }
}

const ENGINE = 'C:/dsh-muv-engine'
const TAVERN = 'C:/dsh-tavern-v2'

// ★ 只在**直接执行**本文件时才跑下面的示例提交。
//   教训：这个文件第一次写完时没有守卫，别人 `import()` 一下就会**真的提交一次**
//   （实测发生了：多出一个重复提交）。工具必须 import-safe。
const RAN_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href } catch (_) { return false }
})()
if (!RAN_DIRECTLY) {
  console.log('[commit-direct] 作为模块导入：只导出 commitDirect()，不执行示例提交。')
} else {

// ── 1) muv-engine：把正则修复挂到 a7031dc 之后 ─────────────────────────────
const engMsg = `fix(regex): 替换串里的 $' / $& / $\` 必须字面量入文 —— 卡的 JS 不再被自己的文档打坏

症状：卡 HTML/CSS 正常但卡的 JS 全废（tab 切不动 / 数据不渲染 / 按钮无反应），
控制台只有 about:srcdoc:4102 Uncaught SyntaxError: Invalid or unexpected token（出现两次）。

根因（定位到字符）：卡正则 [2]「ERA 状态栏」的替换串是一整页 210KB HTML，
文档里的卡 JS 写着 key.charAt(0)==='$'；此前用 String.replace(re, str) 替换时，
替换串里的 $' 被当成「匹配之后的文本」引用 ⇒ 那行变成
key.charAt(0)==='<StatusPlaceHolderImpl/>'（引号错位）⇒ 整段卡脚本语法错误。
HTML/CSS 不经 JS 解析，所以看起来「卡渲染对了」，只是功能全废 —— 极难定位。

修法：照抄 ST 的函数式替换（SillyTavern/public/scripts/extensions/regex/engine.js:419-442）
—— 只显式展开 $1…$99 与 $<name>（外加 {{match}} → $0），其余 $ 一律字面量。

回归哨兵 test-regex-engine 26 通过：$' / $& / $\` 逐字入文、$1 / $<name> / {{match}} 仍展开。
实测：真消息走完「服务端正则 → 客户端围栏 → srcdoc」整条链后语法错 0（修复前 script#2 报错）。`
const r1 = commitDirect({ repo: ENGINE, branch: 'wip/card-interactive', parent: 'a7031dc172fc6f5a0494baf279cd4731e2a45a0d', message: engMsg, files: true })
console.log('engine 新提交:', r1.sha.slice(0, 8), 'tree', r1.tree.slice(0, 8))
console.log(git(ENGINE, ['log', '--oneline', '-4']))
console.log('engine status:', JSON.stringify(git(ENGINE, ['status', '--short']).split('\n').filter(Boolean).length))

// ── 2) dsh-tavern-v2：ctx.sessions 受保护访问 ─────────────────────────────
const tavMsg = `fix(client): ctx.sessions 改受保护访问 —— 别让 Cordis 的 inject 报错刷控制台

控制台实测：[dsh-tavern] sessions mount failed: Error: cannot get property "sessions" without
inject（Cordis 对未声明 inject 的服务属性**取值即抛**）。
语义不变：声明了 inject 时一样能拿到；没声明时安静回退到 ctx.get('sessions')
（异步 provide 的服务本来就走它，getCurrentSessionId() 里还有每次调用重试的懒解析）。
单测 core 77 / greeting-seed 11 全过。`
const r2 = commitDirect({ repo: TAVERN, branch: 'wip/card-interactive', parent: 'bb3bd4b4feb2ae027002ed41d59ce4d069450b29', message: tavMsg, files: true })
console.log('\ntavern 新提交:', r2.sha.slice(0, 8))
console.log(git(TAVERN, ['log', '--oneline', '-4']))
console.log('tavern status:', JSON.stringify(git(TAVERN, ['status', '--short']).split('\n').filter(Boolean).length))

}   // ← 结束「只在直接执行时跑示例提交」的分支
