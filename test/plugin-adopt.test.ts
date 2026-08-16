// dsh-anchor/test/plugin-adopt.test.ts —— P3 验收：真进程 kill -9 → 跨进程收养（收养协议插件形态）
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

let passed = 0, failed = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'))
const treeDir = path.join(tmp, 'tree')
const envDir = path.join(tmp, 'env')

// 1) agent 进程跑到第 6 个锚点 → kill -9
const agent = spawn(process.execPath, ['--experimental-strip-types', 'test/agent-child.mjs', treeDir, envDir], { windowsHide: true })
const agentExit = new Promise(r => agent.once('exit', () => r()))
let killedAt = -1
for (let t = 0; t < 600; t++) {
  let entries: string[] = []
  try { entries = fs.readdirSync(treeDir).sort() } catch {}
  const full = entries.filter(e => fs.existsSync(path.join(treeDir, e, 'verdict')))
  if (full.length >= 6) {
    killedAt = full.length
    try { process.kill(agent.pid, 'SIGKILL') } catch {}
    break
  }
  if (fs.existsSync(path.join(envDir, 'AGENT-DONE'))) break   // agent 跑完（kill 窗口错过）
  await sleep(10)
}
await Promise.race([agentExit, sleep(2000)])
check('agent 进程在第 6 锚点后被 kill', killedAt === 6, `killedAt=${killedAt}`)

// 2) 收养进程：挂同一树 → adopt → 续跑 → 终态一致
const adopter = spawn(process.execPath, ['--experimental-strip-types', 'test/adopter-child.mjs', treeDir, envDir], { windowsHide: true })
let out = ''
adopter.stdout.on('data', d => out += d)
adopter.stderr.on('data', d => out += d)
const adopterExit = await new Promise<number>(r => adopter.once('exit', c => r(c ?? 1)))
const report = (() => { try { return JSON.parse(out.trim()) } catch { return { type: 'crash', consistent: false, anchorsBefore: -1 } } })()

check('收养判定类型合法（clean/dirty）', report.type === 'clean' || report.type === 'dirty', report.type)
check('收养进程扫到被杀现场（≥6 锚点）', report.anchorsBefore >= 6, `anchors=${report.anchorsBefore}`)
check('幂等续跑终态一致', report.consistent === true, String(report.consistent))
check('收养进程正常退出', adopterExit === 0, `exit=${adopterExit}`)

// 3) 对照：无 kill 完整跑 → 终态一致率（续跑=无中断语义）
{
  const treeDir2 = path.join(tmp, 'tree-ctl')
  const envDir2 = path.join(tmp, 'env-ctl')
  const ctl = spawn(process.execPath, ['--experimental-strip-types', 'test/agent-child.mjs', treeDir2, envDir2], { windowsHide: true })
  const ctlExit = await new Promise<number>(r => ctl.once('exit', c => r(c ?? 1)))
  check('对照组无 kill 完整跑', ctlExit === 0 && fs.existsSync(path.join(envDir2, 'AGENT-DONE')), `exit=${ctlExit}`)
  // 与收养组终态对比（两者都应满足同样的最终内容约定）
  const fin = (d: string, n: string) => { try { return fs.readFileSync(path.join(d, n), 'utf-8') } catch { return '' } }
  check('收养组终态 == 对照组终态', ['f1.txt', 'f2.txt', 'f0.txt'].every(n => fin(envDir, n) === fin(envDir2, n)), `${fin(envDir, 'f1.txt')}|${fin(envDir2, 'f1.txt')}`)
}

console.log('='.repeat(66))
console.log(`  P3 跨进程收养验收: ${passed} 通过 / ${failed} 失败`)
console.log('='.repeat(66))
process.exit(failed > 0 ? 1 : 0)
