// dsh-anchor/test/plugin-blind.test.ts —— P4 最终验收：双盲外部污染（独立进程改坏，插件不知情）
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

let passed = 0, failed = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}

const ROUNDS = 3   // 3 轮独立双盲（每轮 20 动作，注入率 50%）
let totalInjected = 0, totalCaught = 0
for (let r = 1; r <= ROUNDS; r++) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `p4-r${r}-`))
  const treeDir = path.join(tmp, 'tree')
  const envDir = path.join(tmp, 'env')
  fs.mkdirSync(envDir, { recursive: true })

  const polluter = spawn(process.execPath, ['--experimental-strip-types', 'test/p4-polluter.mjs', envDir], { windowsHide: true })
  polluter.stderr.on('data', d => console.log('polluter stderr:', String(d).slice(0, 200)))
  polluter.on('error', e => console.log('polluter spawn error:', e.message))
  const driver = spawn(process.execPath, ['--experimental-strip-types', 'test/p4-driver.mjs', treeDir, envDir], { windowsHide: true })
  driver.stderr.on('data', d => console.log('driver stderr:', String(d).slice(0, 200)))
  driver.on('error', e => console.log('driver spawn error:', e.message))
  let dOut = '', pOut = ''
  driver.stdout.on('data', d => dOut += d)
  polluter.stdout.on('data', d => pOut += d)
  const dExit = await new Promise<number>(res => driver.once('exit', c => res(c ?? 1)))
  await Promise.race([new Promise<void>(res => polluter.once('exit', () => res())), new Promise<void>(res => setTimeout(res, 45000))])
  const dRep = (() => { try { return JSON.parse(dOut.trim()) } catch { return { divergedCount: -1, polluted: -1 } } })()
  const pRep = (() => { try { return JSON.parse(pOut.trim()) } catch { return { pollutedCount: -1 } } })()

  totalInjected += pRep.pollutedCount
  totalCaught += dRep.divergedCount
  check(`轮${r}: 注入事实与插件判决数一致（${dRep.divergedCount}/${pRep.pollutedCount}）`, dRep.divergedCount === pRep.pollutedCount, `diverged=${dRep.divergedCount} injected=${pRep.pollutedCount}`)
  check(`轮${r}: driver 正常退出`, dExit === 0, `exit=${dExit}`)
}
check('双盲总账: 注入的外部污染 100% 被当场 DIVERGED 捕获', totalInjected > 0 && totalCaught === totalInjected, `caught=${totalCaught} injected=${totalInjected}`)
check('注入量非零（实验有效）', totalInjected > 0, `injected=${totalInjected}`)

console.log('='.repeat(66))
console.log(`  P4 双盲外部污染验收: ${passed} 通过 / ${failed} 失败`)
console.log('='.repeat(66))
process.exit(failed > 0 ? 1 : 0)
