// dsh-anchor/test/adopter-child.mjs —— P3 收养进程：挂同一锚点树 → adopt 判定 → 幂等续跑 → 终态一致报告
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/plugin.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'

const treeDir = process.argv[2]
const envDir = process.argv[3]
const root = new Context()
const service = apply(root, { anchorRoot: treeDir })
const adopt = service.adoptState
const rec = service.report()

// 幂等续跑：第 1-10 步全部重跑（写固定内容）→ 终态一致（幂等纪律）
let consistent = true
for (let i = 1; i <= 10; i++) {
  const f = path.join(envDir, `f${i % 3}.txt`)
  const expect = service.core.constructor.fingerprint(`STEP${i}`)
  const d = service.core.open(i + 100, { action: `adopt-f${i % 3}`, expect }, { note: 'adopt-rerun' })
  fs.writeFileSync(f, `STEP${i}`)
  const observed = service.core.constructor.fingerprint(fs.readFileSync(f, 'utf-8'))
  const v = service.core.close(d.dir, { observed })
  if (v !== 'OK') consistent = false
}
// 终态验证：每个文件都是"最后写入者"的内容（f1=f10 语义：i%3 循环，最后一步 i=10 → f1 内容 STEP10）
const finalExpected = { 'f1.txt': 'STEP10', 'f2.txt': 'STEP8', 'f0.txt': 'STEP9' }
for (const [name, want] of Object.entries(finalExpected)) {
  try { if (fs.readFileSync(path.join(envDir, name), 'utf-8') !== want) consistent = false } catch { consistent = false }
}
console.log(JSON.stringify({
  type: adopt.type, resumeFrom: adopt.resumeFrom,
  anchorsBefore: rec.entries.length, consistent,
}))
process.exit(consistent ? 0 : 1)
