// dsh-anchor/test/agent-child.mjs —— P3 工作进程：挂插件的 cordis 实例，10 个全锚动作（模拟 panic 全锚期）
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/plugin.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'

const treeDir = process.argv[2]
const envDir = process.argv[3]
const root = new Context()
const service = apply(root, { anchorRoot: treeDir })
fs.mkdirSync(envDir, { recursive: true })

for (let i = 1; i <= 10; i++) {
  const f = path.join(envDir, `f${i % 3}.txt`)
  const action = `write-f${i % 3}`
  const expect = service.core.constructor.fingerprint(`STEP${i}`)
  const d = service.core.open(i, { action, expect }, {})
  fs.writeFileSync(f, `STEP${i}`)                       // 真写环境
  await new Promise(r => setTimeout(r, 60))             // kill 窗口
  const observed = service.core.constructor.fingerprint(fs.readFileSync(f, 'utf-8'))
  const v = service.core.close(d.dir, { observed })
  if (v !== 'OK') { console.log(`step${i} DIVERGED`); process.exit(2) }
}
fs.writeFileSync(path.join(envDir, 'AGENT-DONE'), 'done')
process.exit(0)
