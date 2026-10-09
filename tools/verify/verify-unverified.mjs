// ★★ 「未验」的统一出口 —— **缺样本时绝不许 `SKIP` + `exit 0`**。
//
// 为什么要有这个文件（task-21 的主目标）：
//   本批真机门禁依赖一些**只存在于作者机器上的样本**（特定角色卡 / 卡集 / 真实模型回复 / Edge）。
//   原先缺样本时它们打印一句 `SKIP …` 然后 **`process.exit(0)`** ⇒ 退出码是 0 ⇒
//   在批处理、CI、以及"看退出码"的人类眼里，它与**通过**长得一模一样 —— 这就是本会话反复治的
//   【免费绿灯】族里最大的一个口子：**"没跑"被读成"通过"**。
//
// 本仓的既定纪律是"跳过必须出声"，但那还不够：**出声 + 退出码 0** 仍然会被读成通过。
// ⇒ 从这里开始，凡"缺样本 / 环境前置不足 / 跑不起来"一律走 `unverified()`：
//     · 打印明确的「未验（缺 <哪一项>）」
//     · **非零退出**（用 2，与"真失败"的 1 区分开）
//   ⇒ 「未验」与「失败」是两种不同的红灯，但**两者都不是「通过」**。
//
// ★ 纪律（task-21 明写）：**不许**为了让门禁"在别人机器上也绿"而放松任何既有断言 ——
//   那会把真信号一起松掉。本模块只改"缺样本时的退出码与措辞"，不碰任何判据本身。
export const UNVERIFIED_EXIT = 2

/**
 * 组装「未验」那段输出，**不退出**（纯函数 ⇒ 可被单测直接驱动）。
 * 与 `unverified()` 共享同一份措辞 —— 契约单测（`tests/test-verify-unverified.mjs`）钉的就是它。
 * @param {string} what
 * @param {string[]} [hints]
 * @returns {string[]} 逐行输出（调用方决定怎么落地：console.log 或断言）
 */
export function unverifiedLines(what, hints = []) {
  const lines = [
    '',
    '未验（缺 ' + what + '）—— 本门禁**没有跑完/没有跑**，这不是通过。',
  ]
  for (const h of hints) lines.push('   补上这一项：' + h)
  lines.push('!! 退出码 ' + UNVERIFIED_EXIT + '（非零）：「未验」与「失败」都不等于「通过」。')
  return lines
}

/**
 * 缺样本 / 环境前置不足 ⇒ 标「未验」并**非零退出**。
 * @param {string} what 缺的是哪一项（越具体越好：把路径或环境变量名带上）
 * @param {string[]} [hints] 可选：给出怎么补上这一项
 * @param {(code:number)=>void} [doExit] ★ 仅测试用：注入退出函数（默认 `process.exit`）。
 *   为什么要这个缝：本函数原先**直接** `process.exit` ⇒ 想验它的契约就只能真起子进程，
 *   而本机沙箱禁止 node 派生 ⇒ 拿不到。把退出做成**可注入**后，契约（退出码 + 措辞）
 *   能在**同一进程**里被逐条断言（见 `tests/test-verify-unverified.mjs`），
 *   同时**默认行为一字未变**（生产路径仍走 `process.exit`）。
 */
export function unverified(what, hints = [], doExit = process.exit) {
  for (const line of unverifiedLines(what, hints)) console.log(line)
  doExit(UNVERIFIED_EXIT)
}
