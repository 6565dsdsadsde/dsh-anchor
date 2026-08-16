// dsh-anchor/test/plugin-anchor.test.ts —— P2 验收：cordis 真事件总线挂锚点（每块独立 Context 隔离）
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/plugin.ts'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let passed = 0, failed = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-anchor-'))
const mk = (treeSub: string) => {
  const ctx = new Context()
  const service = apply(ctx, { anchorRoot: path.join(tmp, treeSub) })
  return { ctx, service }
}

// 模拟一次官方工具调用（write 类真写磁盘——reconcile 环境对账的依赖）
async function toolCall(root: Context, toolName: string, args: any, result: unknown) {
  const exec = { name: toolName, arguments: args }
  if ((toolName === 'write' || toolName === 'edit' || toolName === 'create_file') && typeof args?.path === 'string' && typeof args?.content === 'string') {
    try { fs.mkdirSync(path.dirname(args.path), { recursive: true }); fs.writeFileSync(args.path, args.content) } catch {}
  }
  await root.emit('tools/pre-execute', exec, async () => 'allowed')
  await root.emit('tools/post-execute', exec, { content: result }, async () => 'ok')
  return exec
}

// 1) 写对 → 锚点 OK + 非 panic
{
  const { ctx, service } = mk('t1')
  const f = path.join(tmp, 't1', 'a.txt')
  await toolCall(ctx, 'write', { path: f, content: 'hello' }, 'written')
  const rec = service.report()
  check('高熵动作自动锚点', rec.entries.length >= 1, `entries=${rec.entries.length}`)
  const v = fs.readFileSync(path.join(rec.lastComplete!.dir, 'verdict'), 'utf-8')
  check('环境对账 OK（写对文件 → OK）', v === 'OK', v)
  check('对账后非 panic', service.sampling.panicMode === false)
}
// 2) 写坏 → DIVERGED 当场抓 + panic 触发
{
  const { ctx, service } = mk('t2')
  const f = path.join(tmp, 't2', 'b.txt')
  const exec = { name: 'write', arguments: { path: f, content: 'EXPECTED' } }
  await ctx.emit('tools/pre-execute', exec, async () => 'a')
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'CORRUPTED')   // 动作写坏
  await ctx.emit('tools/post-execute', exec, { content: 'written' }, async () => 'b')
  const rec = service.report()
  const v = fs.readFileSync(path.join(rec.lastComplete!.dir, 'verdict'), 'utf-8')
  check('写坏文件当场 DIVERGED', v === 'DIVERGED', v)
  check('DIVERGED 触发 panic 模式', service.sampling.panicMode === true)
}
// 3) 低熵放手（非 panic 状态）
{
  const { ctx, service } = mk('t3')
  const f = path.join(tmp, 't3', 'x.txt')
  await toolCall(ctx, 'write', { path: f, content: 'seed' }, 'ok')   // 建立锚点
  const before = service.report().entries.length
  await toolCall(ctx, 'read', { path: f }, 'data')
  await toolCall(ctx, 'glob', { pattern: '*' }, ['a'])
  await toolCall(ctx, 'grep', { q: 'x' }, [])
  const after = service.report().entries.length
  check('低熵动作放手（0 新锚点）', after === before, `before=${before} after=${after}`)
}
// 4) 不拦截：next 被调且决策透传
{
  const { ctx } = mk('t4')
  let nextCalled = 0
  const exec = { name: 'write', arguments: {} }
  await ctx.emit('tools/pre-execute', exec, async () => { nextCalled++; return 'granted' })
  check('pre 瀑布不拦截（next 被调）', nextCalled === 1, `next=${nextCalled}`)
}
// 5) panic 模式低熵也锚
{
  const { ctx, service } = mk('t5')
  const f = path.join(tmp, 't5', 'p.txt')
  const exec = { name: 'write', arguments: { path: f, content: 'GOOD' } }
  await ctx.emit('tools/pre-execute', exec, async () => 'a')
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'BAD')   // 制造 DIVERGED → panic
  await ctx.emit('tools/post-execute', exec, { content: 'x' }, async () => 'b')
  const before = service.report().entries.length
  await toolCall(ctx, 'read', { path: f }, 'y')   // panic 下低熵也锚
  const after = service.report().entries.length
  check('panic 模式低熵也锚', after === before + 1, `before=${before} after=${after}`)
  // 回归断言（真机第四 bug）：带 path 的 read 锚点不得污染 prevTarget 复核——下一个锚点必须 OK
  await toolCall(ctx, 'read', { path: f }, 'z')   // panic 下又一个锚点
  const rec = service.report()
  const v = fs.readFileSync(path.join(rec.lastComplete!.dir, 'verdict'), 'utf-8')
  check('低熵锚点不污染复核（下一个锚点 OK）', v === 'OK', v)
}
// 6) 冷启收养：新实例扫同一树
{
  const { ctx, service: s1 } = mk('t6')
  const f = path.join(tmp, 't6', 'seed.txt')
  await toolCall(ctx, 'write', { path: f, content: 'x' }, 'ok')
  const rec1 = s1.report()
  const ctx2 = new Context()
  const s2 = apply(ctx2, { anchorRoot: path.join(tmp, 't6') })
  check('冷启收养: 树被新实例扫到', s2.report().entries.length === rec1.entries.length && rec1.entries.length > 0, `e=${s2.report().entries.length}`)
  check('冷启收养: 判定类型合法', ['clean', 'dirty', 'contaminated', 'fresh'].includes(s2.adoptState.type), s2.adoptState.type)
}
// 7) 服务提供
{
  const { ctx } = mk('t7')
  check('ctx.provide anchor 服务', ctx.get('anchor') !== undefined)
}

console.log('='.repeat(66))
console.log(`  P2 插件挂载验收: ${passed} 通过 / ${failed} 失败`)
console.log('='.repeat(66))
process.exit(failed > 0 ? 1 : 0)
