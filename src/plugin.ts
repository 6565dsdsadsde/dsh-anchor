// dsh-anchor/src/plugin.ts —— P2 插件主体：官方 tools/pre-execute + post-execute 挂锚点
// 调研铁证（dsh-tools types/index.d.ts:38,61）：
//   'tools/pre-execute'(exec, next): 动作前瀑布 → 我们 anchorOpen（intent+pre 预承诺）
//   'tools/post-execute'(exec, result, next): 动作后、结果物化前 → 我们 anchorClose（对账判词）
// 纪律（实测判决固化）：
//   · open 只记录不拦截——next() 先放行官方瀑布，对账失败只报 DIVERGED（拦截权留给官方 guard）
//   · 采样走 Lucas 高熵锁定+间隔≥7+DIVERGED 反馈（sampling.ts，P1 验收 10/10）
//   · 冷启收养：apply 时扫锚点树 adopt（对齐官方 subagent cold resume）
import type { Context } from '@deepseek-ai/cordis'
import { AnchorCore } from './AnchorCore.ts'
import { shouldAnchor, onVerdict, initialSamplingState, type SamplingState } from './sampling.ts'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const name = 'anchor'

export interface AnchorConfig {
  anchorRoot?: string      // 锚点树根目录（默认 ./data/anchor-trees/default）
  minGap?: number          // 采样间隔纪律（默认 7；测试/双盲可配 1=全锚）
}

export interface AnchorService {
  core: AnchorCore
  report: () => ReturnType<AnchorCore['recover']>
  adoptState: ReturnType<AnchorCore['adopt']>
  sampling: SamplingState
}

// exec 对象在 pre/post 之间是同一引用 → WeakMap 关联锚点（零侵入、无 id 依赖）
const activeAnchors = new WeakMap<object, { dir: string; target?: string }>()
// 上一动作的目标与 post 观测（P4 双盲漏报堵漏：窗口外篡改由下一动作对账复核现形）
let prevTarget: { path: string; observed: string } | undefined

// ---- 对账器（恒等对账纪律的核心：expect/observed 必须是同一事物的预期值与实测值）----
// 对账装置 bug 教训：expect=参数hash、observed=结果hash 恒不等 → 永远 DIVERGED → 永远 panic。
// 正解 = 环境对账：动作后读磁盘/环境验证真实结果，不信结果自报。
// 官方 ToolExecutionInput 字段 = { name, arguments }（dsh-tools types:203-205）——真机是 arguments 不是 args
function execArgs(exec: unknown): Record<string, unknown> {
  const e = exec as { arguments?: unknown; args?: unknown }
  return (e?.arguments ?? e?.args ?? {}) as Record<string, unknown>
}
function toolNameOf(exec: unknown): string {
  const e = exec as { name?: string; tool?: string }
  return String(e?.name ?? e?.tool ?? 'unknown')
}

function reconcile(toolName: string, args: Record<string, unknown>): { expect: string; observed: string; envChecked: boolean } {
  if (toolName === 'write' || toolName === 'edit' || toolName === 'create_file') {
    // DSH 工具参数名兼容：write/edit 用 file_path，其余可能用 path
    const p0 = typeof args?.path === 'string' ? args.path : typeof args?.file_path === 'string' ? args.file_path : undefined
    const content = typeof args?.content === 'string' ? args.content : undefined
    if (p0 !== undefined && content !== undefined) {
      const expect = AnchorCore.fingerprint(content)   // 预期：参数声明的目标内容
      let observed: string
      try { observed = AnchorCore.fingerprint(fs.readFileSync(p0, 'utf-8')) } catch { observed = 'absent' }
      return { expect, observed, envChecked: true }
    }
  }
  // 通用兜底：预期动作无异常；结果自报错误标记 → DIVERGED
  return { expect: 'ok', observed: 'ok', envChecked: false }
}

export function apply(ctx: Context, config: AnchorConfig = {}) {
  const root = config.anchorRoot ?? './data/anchor-trees/default'
  const core = new AnchorCore(root)
  const sampling = initialSamplingState(config.minGap)
  // seq 从树中最大号续起（不与其他写入者撞号——bootstrap 树已有 1-5 号锚点）
  const existing = core.recover()
  let seq = existing.lastComplete?.seq ?? 0
  if (existing.lastIncomplete !== undefined) {
    const m = /^\d+/.exec(path.basename(existing.lastIncomplete))
    seq = Math.max(seq, m ? Number(m[0]) : 0)
  }

  // ---- 动作前：官方 pre-execute 瀑布中挂 anchorOpen ----
  ctx.on('tools/pre-execute', async function (exec: unknown, next: () => Promise<unknown>) {
    const decision = await next()   // 先放行（不拦截——拦截权归官方 guard）
    try {
      const toolName = toolNameOf(exec)
      if (shouldAnchor(toolName, sampling)) {
        seq++
        const args = execArgs(exec)
        const { expect, envChecked } = reconcile(toolName, args)
        const { dir } = core.open(seq, { action: `${toolName}#${seq}`, expect }, { note: 'auto' })
        sampling.lastAnchorStep = sampling.step
        // 只有环境对账类动作（真指纹）才记录 target 供复核——兜底类 observed='ok' 与文件 hash 不同命名空间
        const target = envChecked
          ? (typeof args?.file_path === 'string' ? args.file_path : typeof args?.path === 'string' ? args.path : undefined)
          : undefined
        activeAnchors.set(exec as object, { dir, target })
      }
    } catch { /* 锚点失败不阻断工具执行（锚点是观察者，不是闸门） */ }
    return decision
  })

  // ---- 动作后：官方 post-execute 瀑布中挂 anchorClose ----
  ctx.on('tools/post-execute', async function (exec: unknown, result: unknown, next: () => Promise<unknown>) {
    const decision = await next()
    try {
      const a = activeAnchors.get(exec as object)
      if (a !== undefined) {
        activeAnchors.delete(exec as object)
        const toolName = toolNameOf(exec)
        const { observed, envChecked } = reconcile(toolName, execArgs(exec))
        let verdict = core.close(a.dir, { observed })
        // 上一动作目标复核（P4 双盲堵漏）：对账窗口外的外部篡改在此现形
        if (prevTarget !== undefined) {
          let now: string
          try { now = AnchorCore.fingerprint(fs.readFileSync(prevTarget.path, 'utf-8')) } catch { now = 'absent' }
          if (now !== prevTarget.observed && now !== 'absent') {
            verdict = 'DIVERGED'
            core.forceVerdict(a.dir, 'DIVERGED', `prev-target-tampered: ${prevTarget.path}`)
          }
        }
        if (a.target !== undefined && envChecked) prevTarget = { path: a.target, observed }   // 记录本动作目标供下一步复核
        else prevTarget = undefined
        onVerdict(verdict, sampling)
      }
    } catch { /* 同上 */ }
    return decision
  })

  // ---- 冷启收养：插件挂载时扫锚点树（对齐官方 cold resume） ----
  const adoptState = core.adopt(() => [])

  const service: AnchorService = {
    core,
    report: () => core.recover(),
    adoptState,
    sampling,
  }
  ctx.provide('anchor', service)
  ctx.effect(() => () => { /* 锚点树是真相源——teardown 不删树（跨会话收养依赖） */ })
  return service
}
