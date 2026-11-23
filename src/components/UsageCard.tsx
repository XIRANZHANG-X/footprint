import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db.ts'
import {
  formatTokens,
  formatYuan,
  monthRange,
  PRICE_CHECKED,
  summarizeUsage,
  type UsageSummary,
} from '../lib/usage.ts'

// AI 用量（决策 0016 第 3 条）：本月和上月各调用了多少次、多少 token、多少秒语音，大约多少钱。
// 数据只在本机；钱是按价目表估算的，以阿里云账单为准

function minutes(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

function Row({ label, sum }: { label: string; sum: UsageSummary }) {
  if (sum.calls === 0)
    return (
      <p>
        <span className="font-pixel text-[12px] text-ink-soft">{label}</span>{' '}
        没有调用
      </p>
    )
  return (
    <p>
      <span className="font-pixel text-[12px] text-ink-soft">{label}</span>{' '}
      {sum.calls} 次{sum.failed > 0 && `（失败 ${sum.failed} 次）`} · 输入{' '}
      {formatTokens(sum.inputTokens)} token · 输出{' '}
      {formatTokens(sum.outputTokens)} token
      {sum.seconds > 0 && ` · 语音 ${minutes(sum.seconds)}`} ·{' '}
      <strong>
        {/* 不到一分钱时直接写"不到 ¥0.01"，不再加"约" */}
        {sum.cost >= 0.01 ? `约 ${formatYuan(sum.cost)}` : formatYuan(sum.cost)}
      </strong>
      {sum.unpriced > 0 && `（另有 ${sum.unpriced} 次算不出价格）`}
    </p>
  )
}

export function UsageCard() {
  // 按"打开这一页时"算本月、上月就够了
  const [now] = useState(() => Date.now())
  const calls = useLiveQuery(() => db.aiCalls.toArray())
  if (!calls) return null
  const d = new Date(now)
  const thisMonth = monthRange(d.getFullYear(), d.getMonth() + 1)
  const lastMonth = monthRange(d.getFullYear(), d.getMonth())
  return (
    <div className="px-card space-y-1.5 p-3 text-sm">
      <h2 className="px-title text-[16px]">AI 用量</h2>
      <Row label="本月" sum={summarizeUsage(calls, ...thisMonth)} />
      <Row label="上月" sum={summarizeUsage(calls, ...lastMonth)} />
      <p className="text-xs text-ink-soft">
        只记在这台设备上。金额按百炼 {PRICE_CHECKED}{' '}
        查到的价格估算，没算免费额度和折扣，以阿里云账单为准。
      </p>
    </div>
  )
}
