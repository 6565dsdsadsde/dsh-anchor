// anchor-core/src/AnchorCore.ts —— 会话锚点协议 v0 生产实装（四轮实验判决固化）
// 原语四件套：open（intent+pre 预承诺）/ close（post 对账判词）/ recover（扫树三证据）/ adopt（收养续跑）
// 四轮实验经验固化清单：
//   ① 恒等对账（四号实验装置 bug）：intended/observed 必须同一命名空间——open 写 expect，close 只做比较
//   ② 相位窗口（三号实验装置 bug）：所有写入 tmp+rename 原子，不留半写文件（半写=脏收养源）
//   ③ 空锚点目录容错（三号实验装置 adopter bug）：recover 对空目录/缺文件全部降级容错
//   ④ 并发 rename 竞争（Witness 经验）：跨进程竞争败者静默
//   ⑤ Windows 路径清洗（四号实验装置 bug）：动作名非法字符替换
//   ⑥ 幂等（收养重跑）：close 重复调用安全；adopt 续跑幂等
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'

export interface AnchorIntent { action: string; expect?: string }
export interface AnchorPre { fingerprint?: Record<string, string>; pids?: number[]; note?: string }
export interface AnchorPost { observed: string; extra?: Record<string, unknown> }
export type Verdict = 'OK' | 'DIVERGED'

const sha256 = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex')
const pad = (n: number) => String(n).padStart(5, '0')
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
const atomicWrite = (file: string, content: string) => {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, content, 'utf-8')
  try { fs.renameSync(tmp, file) } catch { try { fs.unlinkSync(tmp) } catch {} /* 竞争败者静默 */ }
}
const readJson = <T,>(p: string, fallback: T): T => {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return fallback }
}

export class AnchorCore {
  private treeRoot: string
  constructor(treeRoot: string) {
    this.treeRoot = treeRoot
    fs.mkdirSync(treeRoot, { recursive: true })
  }

  /** 锚点目录路径（可预测、可扫描） */
  anchorDir(seq: number, action: string): string {
    return path.join(this.treeRoot, `${pad(seq)}-${safeName(action)}`)
  }

  /** 原语 1：open —— 动作前写 intent（预承诺）+ pre（环境指纹） */
  open(seq: number, intent: AnchorIntent, pre: AnchorPre = {}): { dir: string } {
    const dir = this.anchorDir(seq, intent.action)
    fs.mkdirSync(dir, { recursive: true })
    atomicWrite(path.join(dir, 'intent.json'), JSON.stringify({ ...intent, expect: intent.expect ?? '' }))
    atomicWrite(path.join(dir, 'pre.json'), JSON.stringify({ at: Date.now(), ...pre }))
    return { dir }
  }

  /** 原语 2：close —— 动作后写 post（实际）+ verdict（对账判词：observed vs expect） */
  close(dir: string, post: AnchorPost): Verdict {
    const verdict: Verdict = post.observed === (readJson<AnchorIntent>(path.join(dir, 'intent.json'), { action: '' }).expect ?? '') ? 'OK' : 'DIVERGED'
    atomicWrite(path.join(dir, 'post.json'), JSON.stringify({ at: Date.now(), ...post }))
    atomicWrite(path.join(dir, 'verdict'), verdict)
    return verdict
  }

  /** 便捷：指纹工具（同一命名空间——恒等对账纪律） */
  static fingerprint(content: string): string { return sha256(content) }

  /** 原语 3：recover —— 扫锚点树，三证据重建会话状态 */
  recover(): {
    entries: string[]            // 所有锚点目录（按序）
    lastComplete?: { dir: string; seq: number; verdict: Verdict }
    lastIncomplete?: string      // 最后的不完整锚点（pre 后中断 = 脏收养现场）
    expectedEnv: Map<string, string>   // 每个 target 最近 post.observed（因果迹重建）
  } {
    let entries: string[] = []
    try { entries = fs.readdirSync(this.treeRoot).sort() } catch { return { entries: [], expectedEnv: new Map() } }
    let lastComplete: { dir: string; seq: number; verdict: Verdict } | undefined
    let lastIncomplete: string | undefined
    const expectedEnv = new Map<string, string>()
    for (const e of entries) {
      const d = path.join(this.treeRoot, e)
      if (!fs.statSync(d).isDirectory()) continue
      const verdictPath = path.join(d, 'verdict')
      if (fs.existsSync(verdictPath)) {
        const intent = readJson<AnchorIntent>(path.join(d, 'intent.json'), { action: '' })
        const post = readJson<AnchorPost>(path.join(d, 'post.json'), { observed: '' })
        lastComplete = { dir: d, seq: Number(/^\d+/.exec(e)?.[0] ?? 0), verdict: fs.readFileSync(verdictPath, 'utf-8').trim() as Verdict }
        if (intent.action) expectedEnv.set(intent.action, post.observed)
      } else {
        lastIncomplete = d   // 脏收养现场（含空目录——mkdir 后 intent 未写的竞态）
      }
    }
    return { entries, lastComplete, lastIncomplete, expectedEnv }
  }

  /** 原语 4：adopt —— 三证据收养判定 + 净化 + 续跑建议 */
  adopt(envCheck: (expectedEnv: Map<string, string>) => string[]): {
    type: 'clean' | 'dirty' | 'contaminated' | 'fresh'
    resumeFrom: number          // 从哪个 seq 续跑（0-based：已完成数）
    detectedPids: number
    killedPids: number
    adoptedAnchor?: string
  } {
    const rec = this.recover()
    const diffs = envCheck(rec.expectedEnv)
    // 净化：pre 记录的全部 pid（若活着则 kill；已死=污染已发生但已自灭）
    const pids = new Set<number>()
    for (const e of rec.entries) {
      const pre = readJson<AnchorPre>(path.join(this.treeRoot, e, 'pre.json'), {})
      for (const p of pre.pids ?? []) pids.add(p)
    }
    let killedPids = 0
    for (const p of pids) { try { process.kill(p, 'SIGKILL'); killedPids++ } catch { /* 已死 */ } }
    let type: 'clean' | 'dirty' | 'contaminated' | 'fresh'
    let resumeFrom: number
    if (rec.lastIncomplete !== undefined) {
      type = 'dirty'
      const intent = readJson<AnchorIntent>(path.join(rec.lastIncomplete, 'intent.json'), { action: '' })
      const seq = Number(/^\d+/.exec(path.basename(rec.lastIncomplete))?.[0] ?? 0)
      resumeFrom = intent.action ? Math.max(0, seq - 1) : (rec.lastComplete?.seq ?? 0)   // 空锚点：从最后完整处续
    } else if (diffs.length > 0) {
      type = 'contaminated'
      resumeFrom = 0   // 污染后全量幂等重跑（幂等纪律：动作必须可重放）
    } else if (rec.lastComplete !== undefined) {
      type = 'clean'
      resumeFrom = rec.lastComplete.seq   // 从下一步续
    } else {
      type = 'fresh'
      resumeFrom = 0
    }
    return { type, resumeFrom, detectedPids: pids.size, killedPids, adoptedAnchor: rec.lastComplete?.dir ?? rec.lastIncomplete }
  }
}
