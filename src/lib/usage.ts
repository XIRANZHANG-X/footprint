import type { AiUsage } from '../../shared/ai.ts'

// AI 用量和费用估算（决策 0016 第 3 条）。每次调用记一行在本机的 aiCalls 表，这里只做计算，不碰数据库。
//
// 价格来自阿里云百炼价目表（华北 2 北京地域，2026-11-23 查看），单位：元。
// 只是估算：没算新开通的免费额度、上下文缓存折扣和阶梯价（单次输入超过 32K token 更贵，这里用不到）。
// 换了模型或者涨价降价，改这张表就行；表里没有的模型只统计次数和 token，不算钱
export const PRICE_CHECKED = '2026-11-23'
export const PRICES: Record<
  string,
  { input?: number; output?: number; perSecond?: number }
> = {
  // 每百万 token
  'qwen3-vl-plus': { input: 1, output: 10 },
  'qwen3.7-flash': { input: 0.2, output: 0.8 },
  'qwen-flash': { input: 0.15, output: 1.5 },
  // 每秒音频，输出不收费
  'qwen3-asr-flash': { perSecond: 0.00022 },
}

export type AiCallKind =
  | 'transcribe'
  | 'describe'
  | 'suggest'
  | 'summarize'
  | 'plan' // AI 帮我排行程（决策 0024）
  | 'agent' // 问问我的足迹、帮我找地点，每一轮记一次（决策 0028）

export type AiCall = {
  id: string
  at: number
  kind: AiCallKind
  ok: boolean
  ms: number // 从发出请求到收到回复
  // 一次请求可能调用了几次模型（比如回复不合格式又修了一次）；旧版服务端不返回用量时为空
  usage: AiUsage[]
}

// 一次模型调用大约多少钱；不知道价格或用量时为 null
export function costOf(u: AiUsage): number | null {
  const p = PRICES[u.model]
  if (!p) return null
  if (p.perSecond !== undefined)
    return u.seconds === null ? null : u.seconds * p.perSecond
  if (u.inputTokens === null || u.outputTokens === null) return null
  return (
    (u.inputTokens * (p.input ?? 0) + u.outputTokens * (p.output ?? 0)) / 1e6
  )
}

export type UsageSummary = {
  calls: number
  failed: number
  inputTokens: number
  outputTokens: number
  seconds: number
  cost: number // 能算出价格的部分加起来
  unpriced: number // 算不出价格的模型调用次数（没有用量或不在价目表里）
}

export function summarizeUsage(
  calls: AiCall[],
  from: number,
  to: number,
): UsageSummary {
  const sum: UsageSummary = {
    calls: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    seconds: 0,
    cost: 0,
    unpriced: 0,
  }
  for (const c of calls) {
    if (c.at < from || c.at >= to) continue
    sum.calls++
    if (!c.ok) sum.failed++
    for (const u of c.usage) {
      sum.inputTokens += u.inputTokens ?? 0
      sum.outputTokens += u.outputTokens ?? 0
      sum.seconds += u.seconds ?? 0
      const cost = costOf(u)
      if (cost === null) sum.unpriced++
      else sum.cost += cost
    }
  }
  return sum
}

export function monthRange(year: number, month: number): [number, number] {
  return [
    new Date(year, month - 1, 1).getTime(),
    new Date(year, month, 1).getTime(),
  ]
}

// "1.2 万"、"860"
export function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : String(n)
}

// 金额太小时不显示成 ¥0.00
export function formatYuan(n: number): string {
  if (n === 0) return '¥0'
  if (n < 0.01) return '不到 ¥0.01'
  return `¥${n.toFixed(2)}`
}
