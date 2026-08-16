// dsh-anchor/test/p4-polluter.mjs —— P4 双盲注入进程：独立进程改坏环境（插件完全不知情）
// 轮询 .pollute-<i> 信号 → sleep 0-45ms（必在 50ms 窗口内）→ 50% 概率改坏目标文件 → 留 .polluted-<i> 事实记录
import * as fs from 'node:fs'
import * as path from 'node:path'

const envDir = process.argv[2]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pollutedCount = 0
for (let i = 1; i <= 20; i++) {
  const sig = path.join(envDir, `.pollute-${i}`)
  for (let t = 0; t < 400 && !fs.existsSync(sig); t++) await sleep(5)   // 等信号（2s 上限）
  if (!fs.existsSync(sig)) break
  await sleep(Math.floor(Math.random() * 46))     // 0-45ms：必在 50ms 窗口内
  if (Math.random() < 0.5) {
    const f = path.join(envDir, `f${i % 3}.txt`)
    try { fs.writeFileSync(f, 'POLLUTED-BY-EXTERNAL') } catch {}
    pollutedCount++
    fs.writeFileSync(path.join(envDir, `.polluted-${i}`), 'yes')   // 注入事实记录（真相）
  }
}
console.log(JSON.stringify({ pollutedCount }))
process.exit(0)
