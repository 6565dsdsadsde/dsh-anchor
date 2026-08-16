# dsh-anchor

> **Long-running sessions without limits.** Every high-entropy tool action gets a pre-committed intent and immediate reconciliation; the anchor tree on disk is the session's source of truth. Crash the process, rescan the tree, adopt, continue — nothing is lost.
>
> **长程任务执行无限制。** 每个高熵工具动作预承诺意图 + 当场对账；磁盘上的锚点树就是会话真相源。进程崩了，扫树、收养、继续——进度零丢失。

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![ci](https://github.com/6565dsdsadsde/dsh-anchor/actions/workflows/ci.yml/badge.svg)](https://github.com/6565dsdsadsde/dsh-anchor/actions/workflows/ci.yml)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-4d6bfe)](https://github.com/topics/dsh-plugin)
[![topic: dsh](https://img.shields.io/badge/topic-dsh-4d6bfe)](https://github.com/topics/dsh)

## 为什么存在 / Why this exists

主流对"长程任务"的答案靠两样东西：上下文压缩（丢精度）和记忆检索（丢一致性）。真实的翻车史数据说：**失败的主因从来不是"忘了"，是动作打到了环境的错误假设上**（副作用失控：编码损坏、杀错进程、状态泄漏）。

dsh-anchor 换一条路：**不记过去，锁定未来。**

```
每个动作前：intent（我要做什么）+ pre（环境指纹）  = 预承诺
每个动作后：post（实际结果）当场对账 → OK / DIVERGED
```

- 翻车在**当下**现形，不是事后追查
- 锚点树 = 会话进度真相：**会话死了，树还在**；新会话扫树收养续跑（对齐官方 subagent 的 cold resume 语义，且比它多了环境对账）
- 对应官方公开痛点：force-kill 丢 write-behind 尾部（[#483](https://github.com/deepseek-ai/deepseek-harness/discussions/483)）→ 我们零缓冲即时落盘；一条坏日志杀死会话（[#1593](https://github.com/deepseek-ai/deepseek-harness/discussions/1593)）→ 我们的真相源是目录结构，坏了一个锚点只损失那一步

## 工作原理 / How it works

骑在官方扩展点上，零侵入：

| 官方 seam | 我们的挂载 |
|---|---|
| `tools/pre-execute`（动作前瀑布）| `anchorOpen`：写 intent + pre 指纹 |
| `tools/post-execute`（动作后、结果物化前）| `anchorClose`：环境对账 + 判词 |

**环境对账，不信自报**：`write`/`edit` 类动作对账时**读磁盘验证真实内容**（预期=参数声明的目标内容，实测=磁盘上的实际字节）——工具说自己写成功没用，锚点验的是环境。

**采样纪律**（实测判决固化）：
- **高熵动作**（写文件/进程/子任务）强制挂锚点——副作用熵最大的动作锁死
- **最小间隔 7**——无间隔形态开销爆炸（每捕获成本 98.6 → 25.1，实测数据）
- **低熵动作**（读/纯查询）放手——它们的翻车要么无害、要么传播到高熵动作现形
- **DIVERGED 反馈**：翻车瞬间切 panic 模式（全锚），连续 3 步 OK 恢复——秩序轨↔混沌轨自动切换

**锚点树解剖**：

```
session-anchors/
├── 00027-write#27/           # 一个动作 = 一个锚点目录
│   ├── intent.json           # 预承诺：动作名 + 预期指纹
│   ├── pre.json              # 动作前环境指纹（+ 已记录的进程 pid）
│   ├── post.json             # 动作后实测
│   └── verdict               # OK / DIVERGED（当场判词）
└── ...
```

## 快速开始 / Quick start

```sh
# 安装（git 源，固定 tag）
dsh plugin --profile <name> add "github:6565dsdsadsde/dsh-anchor#v0.2.0"
```

然后在 profile 的 `cordis.patch.yml` 挂载：

```yaml
# cordis.patch.yml
- insert:
    - name: 'dsh-anchor'
      config:
        anchorRoot: 'C:\path\to\session-anchors'   # 锚点树根（真相源）
        minGap: 7                                  # 采样间隔纪律（默认 7）
```

重启后插件即上岗：每个高熵工具动作自动挂锚点、当场对账。冷启时自动扫锚点树做收养判定。

```ts
import { apply } from 'dsh-anchor'
const service = apply(ctx, { anchorRoot: './data/session-anchors' })
service.report()      // 扫树报告（最后完整锚点/脏现场/指纹链）
service.adoptState    // 冷启收养判定（clean/dirty/contaminated/fresh）
```

## 验收证据 / Acceptance evidence

全部测试常驻 `npm test`（37 断言全绿）。实测环境：**Windows 11 Pro · Node 25.8**。

| 套件 | 验证什么 | 断言 |
|---|---|---|
| sampling | 采样纪律（高熵锁定/间隔7/panic 反馈/恢复）| 10 |
| plugin-anchor | 官方 seam 挂载 + 环境对账 + 不拦截 + 冷启 | 12 |
| plugin-adopt | 真进程 kill -9 → 跨进程收养 → 续跑终态一致 | 7 |
| plugin-blind | 双盲外部污染（独立进程改坏环境，插件不知情）| 8 |

**真机上岗实录**（真实 DSH 实例上的锚点树摘录）：

```
00027-write#27   DIVERGED   ← 写只读文件被 EACCES 挡，对账读磁盘当场抓死
00028-pwsh#28    OK         ← 间隔仅 1 步仍被锚 = panic 触发（纪律被 override）
00029/30/31-read OK         ← panic 下低熵全锚 ×3，每次 OK 推进恢复
（此后 read 零锚点）          ← 3 步 OK 恢复 → 低熵重新放手，零误报
```

## 与 dsh-witness 的关系 / vs. dsh-witness

| | dsh-witness | dsh-anchor |
|---|---|---|
| 粒度 | 任务（一个任务一个目录，五态收养）| 动作（一个动作一个锚点，判词对账）|
| 管什么 | 后台任务生命周期 | 会话/agent 的长程动作监督 |
| 共同内核 | AnchorCore 四原语（open/close/recover/adopt）| 同一内核 |

任务只是"大动作"，动作只是"小任务"——两个包共享同一哲学：**文件系统即真相源**。

## 诚实边界 / Honest boundaries

- **Windows-first。** 实测于 Windows 11 + Node 25.8。锚点树协议本身跨平台，但当前只在 Windows 真机验证过；未实测的平台不声称支持。
- **对账覆盖 v0**：环境对账目前覆盖 `write`/`edit`/`create_file`（读磁盘验证）；其余工具走兜底对账（只判有无异常自报）。对账器按工具类型扩展是既定路线。
- **收养 v0 弱校验**：冷启收养扫树做结构判定（干净/脏/污染），环境级 diff 校验的完整形态在 dsh-witness 的任务收养里已实现，会话级完整环境校验在路线图上。
- 锚点是**观察者不是闸门**：对账失败只判 DIVERGED 并触发加密采样，不拦截工具执行（拦截权归官方 guard 机制）。

## 开发 / Development

```sh
npm test   # 37 断言：sampling 10 + plugin-anchor 12 + plugin-adopt 7 + plugin-blind 8
```

要求：Node ≥ 22.5（`node:sqlite` 之外本插件不依赖，实测 25.8）、Windows PowerShell 5.1（真机验证环境）。

## License

Apache-2.0
