// dsh-anchor/test/p4-driver.mjs —— P4 双盲主进程：挂插件（全锚形态）跑 20 个真实写动作
// 每步：pre 锚点 → 写正确内容 → 发信号给注入进程 → sleep 50ms（注入窗口）→ post 对账
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/plugin.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'

const treeDir = process.argv[2]
const envDir = process.argv[3]
const root = new Context()
const service = apply(root, { anchorRoot: treeDir, minGap: 1 })   // 全锚形态（P4 测对账协议本身）
fs.mkdirSync(envDir, { recursive: true })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let divergedCount = 0
for (let i = 1; i <= 20; i++) {
  const f = path.join(envDir, `f${i % 3}.txt`)
  const exec = { name: 'write', arguments: { path: f, content: `TRUE-${i}` } }
  await root.emit('tools/pre-execute', exec, async () => 'a')
  fs.writeFileSync(f, `TRUE-${i}`)                    // 动作：写正确内容
  fs.writeFileSync(path.join(envDir, `.pollute-${i}`), 'go')   // 注入窗口信号
  await sleep(50)                                     // 注入窗口（注入进程在此窗口内改坏）
  await root.emit('tools/post-execute', exec, { content: 'ok' }, async () => 'b')
  // 该锚点判词
  const rec = service.report()
  if (rec.lastComplete) {
    const v = fs.readFileSync(path.join(rec.lastComplete.dir, 'verdict'), 'utf-8')
    if (v === 'DIVERGED') divergedCount++
  }
}
// 汇总
const polluted = fs.readdirSync(envDir).filter(n => n.startsWith('.polluted-')).length
console.log(JSON.stringify({ divergedCount, polluted }))
process.exit(0)
