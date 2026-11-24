import type { JournalRecord } from '../db.ts'
import { formatKm, tripRoute } from './route.ts'
import type { Trip } from './trips.ts'

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const DAY = 86_400_000

// 出行分组的标题，例如"11月3日 – 11月5日 · 3 天 · 8 条 · 约 120 公里"（里程：决策 0020 第 4 条）
export function tripHeading(trip: Trip<JournalRecord>) {
  const start = dayFmt.format(trip.start)
  const end = dayFmt.format(trip.end)
  const days =
    Math.round(
      (new Date(trip.end).setHours(0, 0, 0, 0) -
        new Date(trip.start).setHours(0, 0, 0, 0)) /
        DAY,
    ) + 1
  const range = start === end ? start : `${start} – ${end}`
  const km = formatKm(tripRoute(trip.records).km)
  return `${range} · ${days > 1 ? `${days} 天 · ` : ''}${trip.records.length} 条${km ? ` · ${km}` : ''}`
}
