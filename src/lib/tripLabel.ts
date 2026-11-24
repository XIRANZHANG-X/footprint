import type { JournalRecord } from '../db.ts'
import { formatKm, tripPaths } from './route.ts'
import type { TrackPoint } from './track.ts'
import type { Trip } from './trips.ts'

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const DAY = 86_400_000

// 出行分组的标题，例如"11月3日 – 11月5日 · 3 天 · 8 条 · 约 120 公里"（里程：决策 0020 第 4 条）
export function tripHeading(
  trip: Trip<JournalRecord>,
  track: TrackPoint[] = [],
) {
  const start = dayFmt.format(trip.start)
  const end = dayFmt.format(trip.end)
  const days =
    Math.round(
      (new Date(trip.end).setHours(0, 0, 0, 0) -
        new Date(trip.start).setHours(0, 0, 0, 0)) /
        DAY,
    ) + 1
  const range = start === end ? start : `${start} – ${end}`
  // 有轨迹按轨迹算（决策 0022 第 7 条）
  const km = formatKm(
    tripPaths(
      trip.records,
      track.filter((p) => p.t >= trip.start && p.t <= trip.end),
    ).km,
  )
  return `${range} · ${days > 1 ? `${days} 天 · ` : ''}${trip.records.length} 条${km ? ` · ${km}` : ''}`
}
