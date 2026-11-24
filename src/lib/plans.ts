import type { JournalRecord, Plan, PlanStop } from '../db.ts'
import { inShape } from './geo/pip.ts'
import type { LatLng } from './photoMeta.ts'
import { distanceM } from './visits.ts'

// 计划（决策 0024）：到没到、到了提示、倒计时。纯计算

const DAY = 86_400_000
export const ARRIVE_M = 300

// 计划的日期范围，前后各放宽一天（早到一天、晚走一天都算）
export function planWindow(p: Plan): [number, number] {
  return [p.start - DAY, p.start + (p.days + 1) * DAY]
}

export function covers(stop: PlanStop, at: LatLng): boolean {
  if (stop.shape && stop.shape.length)
    return inShape(stop.shape, at.lng, at.lat)
  if (stop.lat === null || stop.lng === null) return false
  return distanceM(at, { lat: stop.lat, lng: stop.lng }) <= ARRIVE_M
}

// 每个地方有没有记录（到了 ✓），返回 stop id → 那条记录
export function reachedStops(
  plan: Plan,
  records: Pick<JournalRecord, 'id' | 'takenAt' | 'location'>[],
): Map<string, string> {
  const [from, to] = planWindow(plan)
  const out = new Map<string, string>()
  for (const stop of plan.stops)
    for (const r of records)
      if (
        r.location &&
        r.takenAt >= from &&
        r.takenAt < to &&
        covers(stop, r.location)
      ) {
        out.set(stop.id, r.id)
        break
      }
  return out
}

// 到了提示：计划进行中，最近的轨迹到了某个还没记录的地方
export type Arrival = { plan: Plan; stop: PlanStop; at: number; where: LatLng }

export function arrivals(
  plans: Plan[],
  records: Pick<JournalRecord, 'id' | 'takenAt' | 'location'>[],
  recentTrack: { t: number; lat: number; lng: number }[],
  now: number,
): Arrival[] {
  const out: Arrival[] = []
  for (const plan of plans) {
    const [from, to] = planWindow(plan)
    if (now < from || now >= to) continue
    const reached = reachedStops(plan, records)
    for (const stop of plan.stops) {
      if (reached.has(stop.id)) continue
      const hit = [...recentTrack].reverse().find((p) => covers(stop, p))
      if (hit)
        out.push({
          plan,
          stop,
          at: hit.t,
          where: { lat: hit.lat, lng: hit.lng },
        })
    }
  }
  return out.slice(0, 3)
}

// 首页的一行：离出发还有几天 / 计划进行中第几天 / 上次出门是多少天前
export function countdown(
  plans: Plan[],
  lastTripEnd: number | null,
  now: number,
): string | null {
  const today = new Date(now).setHours(0, 0, 0, 0)
  const ongoing = plans.find(
    (p) => p.start <= today && today < p.start + p.days * DAY,
  )
  if (ongoing)
    return `「${ongoing.title}」第 ${Math.round((today - ongoing.start) / DAY) + 1} 天`
  const next = plans
    .filter((p) => p.start > today)
    .sort((a, b) => a.start - b.start)[0]
  if (next) {
    const days = Math.round((next.start - today) / DAY)
    return days === 1
      ? `明天出发：「${next.title}」`
      : `离「${next.title}」出发还有 ${days} 天`
  }
  if (lastTripEnd === null) return null
  const since = Math.round(
    (today - new Date(lastTripEnd).setHours(0, 0, 0, 0)) / DAY,
  )
  return since <= 0 ? null : `上次出门是 ${since} 天前`
}

// 发给 AI 的"口味"：最常记的类别和标签，各取前几个（决策 0024 第 4 条）
export function tasteOf(records: JournalRecord[], limit = 8): string[] {
  const count = new Map<string, number>()
  for (const r of records) {
    if (!r.content) continue
    for (const k of [r.content.category, ...r.content.tags])
      if (k && k !== '其他') count.set(k, (count.get(k) ?? 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k)
}
