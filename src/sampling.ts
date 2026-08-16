// dsh-anchor/src/sampling.ts —— P1 采样策略固化（实测判决：Lucas 高熵锁定 + 间隔≥7 + DIVERGED 反馈混合）
// 实测判决回放：
//   · 高熵动作（副作用熵大：写/进程/子任务）强制锚点——捕获率 100% 的来源
//   · 最小间隔 7——开销 25/轮（均匀5步的 63%），无间隔形态开销爆炸（98.6）被证伪
//   · 低熵动作（读/纯查询）正常放手——它们的翻车要么无害要么传播到高熵动作显现
//   · DIVERGED 反馈（翻车后临时加密）：纯 TCP 式自适应收敛慢（延迟 45.4）的教训——
//     翻车瞬间切 panic 模式（全锚），连续 3 步 OK 恢复——秩序轨+混沌轨的落地混合
export type Verdict = 'OK' | 'DIVERGED'

/** 高熵工具清单：副作用熵大的动作（写文件/进程/子任务/外部提交） */
const HIGH_ENTROPY = new Set([
  'write', 'edit', 'str_replace', 'create_file', 'delete_file',
  'pwsh', 'bash', 'shell', 'spawn', 'terminal',
  'task', 'subagent', 'workflow', 'schedule_create', 'schedule_delete',
  'memory_save', 'memory_forget', 'git', 'npm',
])

/** 间隔纪律：两个锚点之间的最小步数（实测判决 gap7；测试/P4 双盲可配 1=全锚形态） */
export const MIN_ANCHOR_GAP = 7
/** 翻车反馈：连续 OK 步数达到此值退出 panic 模式（实测自适应教训：收敛要快） */
export const PANIC_RECOVER_OKS = 3

export interface SamplingState {
  step: number              // 会话动作计数
  lastAnchorStep: number    // 上次挂锚点的步（初始 -999）
  panicMode: boolean        // 翻车后临时全锚模式
  okStreak: number          // panic 模式下的连续 OK 计数
  minGap: number            // 间隔纪律（可配——测试/双盲全锚形态）
}

export const initialSamplingState = (minGap: number = MIN_ANCHOR_GAP): SamplingState => ({
  step: 0, lastAnchorStep: -999, panicMode: false, okStreak: 0, minGap,
})

export const isHighEntropy = (toolName: string): boolean =>
  HIGH_ENTROPY.has(toolName) || toolName.includes('-') && HIGH_ENTROPY.has(toolName.split('-')[0])

/**
 * 采样决策：这一步挂不挂锚点
 * 规则（实测判决固化）：
 *   1. panic 模式（刚翻过车）：全锚——环境动荡期密集采样（混沌轨）
 *   2. 高熵工具 + 距上次锚点 ≥ MIN_ANCHOR_GAP：锚（秩序轨 Lucas 锁定）
 *   3. 低熵工具：放手（副作用熵小，翻车无害或传播到高熵显现）
 */
export function shouldAnchor(toolName: string, state: SamplingState): boolean {
  state.step++
  if (state.panicMode) return true
  if (!isHighEntropy(toolName)) return false
  if (state.step - state.lastAnchorStep < state.minGap) return false
  return true
}

/** 对账反馈：更新 panic/恢复状态（调用方在 close 后调） */
export function onVerdict(verdict: Verdict, state: SamplingState): void {
  if (verdict === 'DIVERGED') {
    state.panicMode = true
    state.okStreak = 0
  } else if (state.panicMode) {
    state.okStreak++
    if (state.okStreak >= PANIC_RECOVER_OKS) {
      state.panicMode = false
      state.okStreak = 0
    }
  }
}
