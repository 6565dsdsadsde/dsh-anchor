// dsh-anchor/test/sampling.test.ts —— P1 验收：采样策略断言（实测数据特征固化）
import { shouldAnchor, onVerdict, initialSamplingState, MIN_ANCHOR_GAP, PANIC_RECOVER_OKS, isHighEntropy } from '../src/sampling.ts'

let passed = 0, failed = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}

// 1) 高熵锁定：高熵工具间隔 ≥7 必锚
{
  const s = initialSamplingState()
  let anchored = 0
  for (let i = 0; i < 30; i++) {
    if (shouldAnchor('write', s)) { anchored++; s.lastAnchorStep = s.step }
  }
  check('高熵锁定: 30步高熵序列锚点数 ≈ ceil(30/7)=5', anchored === 5, `got ${anchored}`)
}
// 2) 间隔纪律：间隔 <7 时高熵也被跳过
{
  const s = initialSamplingState()
  let anchored = 0
  for (let i = 0; i < 14; i++) {
    if (shouldAnchor('write', s)) { anchored++; s.lastAnchorStep = s.step }
  }
  check('间隔纪律: 14步高熵序列恰好 2 锚点', anchored === 2, `got ${anchored}`)
}
// 3) 低熵放手：纯读序列 0 锚点
{
  const s = initialSamplingState()
  let anchored = 0
  for (let i = 0; i < 50; i++) {
    if (shouldAnchor('read', s)) anchored++
  }
  check('低熵放手: 50步纯读 0 锚点', anchored === 0, `got ${anchored}`)
}
// 4) DIVERGED 反馈：翻车后 panic 全锚（低熵也锚）
{
  const s = initialSamplingState()
  onVerdict('DIVERGED', s)
  const a = shouldAnchor('read', s)
  check('翻车反馈: panic 模式下低熵也锚', a === true)
}
// 5) 恢复纪律：连续 PANIC_RECOVER_OKS 步 OK 退出 panic
{
  const s = initialSamplingState()
  onVerdict('DIVERGED', s)
  for (let i = 0; i < PANIC_RECOVER_OKS - 1; i++) onVerdict('OK', s)
  check('恢复纪律: 未满3步OK仍在panic', s.panicMode === true)
  onVerdict('OK', s)
  check('恢复纪律: 满3步OK退出panic', s.panicMode === false)
}
// 6) 恢复后间隔纪律重新生效（从 panic 密集回到间隔 7）
{
  const s = initialSamplingState()
  onVerdict('DIVERGED', s)
  // panic 期间：低熵也锚
  let p = shouldAnchor('read', s); s.lastAnchorStep = s.step
  for (let i = 0; i < PANIC_RECOVER_OKS; i++) onVerdict('OK', s)
  // 恢复后：低熵放手
  const afterRecover = shouldAnchor('read', s)
  check('恢复后低熵放手', p === true && afterRecover === false, `panic=${p} recover=${afterRecover}`)
}
// 7) 高熵判定表
{
  check('高熵判定: write/edit/pwsh/spawn/task 是高熵', ['write', 'edit', 'pwsh', 'spawn', 'task', 'bash'].every(isHighEntropy))
  check('高熵判定: read/glob/grep/list 是低熵', ['read', 'glob', 'grep', 'list', 'web_search'].every(n => !isHighEntropy(n)))
}
// 8) 混合序列模拟（对照实测判决特征：捕获率 100% + 开销≈25/轮×200步规模）
{
  const s = initialSamplingState()
  const kinds = ['read', 'write', 'read', 'compute', 'write', 'read', 'process', 'read', 'write', 'read']
  let anchors = 0
  for (let i = 0; i < 200; i++) {
    const k = kinds[i % kinds.length]
    if (shouldAnchor(k, s)) { anchors++; s.lastAnchorStep = s.step; onVerdict('OK', s) }
  }
  // 200 步混合（高熵占 40%）：期望锚点数与实测 LucasGap7 等比（25/轮×200步）
  check('混合序列开销: 200步 ≈ 21 锚点（实测 25/轮等比）', anchors >= 18 && anchors <= 26, `got ${anchors}`)
}

console.log('='.repeat(66))
console.log(`  P1 采样策略验收: ${passed} 通过 / ${failed} 失败`)
console.log('='.repeat(66))
process.exit(failed > 0 ? 1 : 0)
