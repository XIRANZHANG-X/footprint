import type { JournalRecord } from '../db.ts'
import { cityOf } from './geo/area.ts'
import { recordBody } from './record.ts'
import { groupTrips } from './trips.ts'
import { computeVisits, localDay } from './visits.ts'

// 回顾（决策 0014 第 3E 条）：一年前的今天、月度和年度统计。纯计算，打开回顾页时才算。

const titleOf = (r: JournalRecord) =>
  r.content?.title ?? (r.note.trim().slice(0, 16) || '没有标题的记录')

// 往年同月同日的记录；今年的不算。没有就是 null
export function onThisDay(records: JournalRecord[], now: number) {
  const today = new Date(now)
  const month = today.getMonth() + 1
  const date = today.getDate()
  const hits = records.filter((r) => {
    const d = new Date(r.takenAt)
    return (
      d.getFullYear() < today.getFullYear() &&
      d.getMonth() + 1 === month &&
      d.getDate() === date
    )
  })
  if (hits.length === 0) return null
  const latest = hits.reduce((a, b) => (a.takenAt > b.takenAt ? a : b))
  const years = today.getFullYear() - new Date(latest.takenAt).getFullYear()
  const more = hits.length > 1 ? ` 等 ${hits.length} 条` : ''
  return {
    day: { month, date },
    count: hits.length,
    label: `${years === 1 ? '一年' : `${years} 年`}前的今天：${titleOf(latest)}${more}`,
  }
}

export type Period = { kind: 'month' | 'year'; year: number; month: number } // month 1–12，年度时忽略

export function periodRange(p: Period): [number, number] {
  return p.kind === 'year'
    ? [new Date(p.year, 0, 1).getTime(), new Date(p.year + 1, 0, 1).getTime()]
    : [
        new Date(p.year, p.month - 1, 1).getTime(),
        new Date(p.year, p.month, 1).getTime(),
      ]
}

export function shiftPeriod(p: Period, by: number): Period {
  if (p.kind === 'year') return { ...p, year: p.year + by }
  const m = p.year * 12 + (p.month - 1) + by
  return { ...p, year: Math.floor(m / 12), month: (m % 12) + 1 }
}

export const periodLabel = (p: Period) =>
  p.kind === 'year' ? `${p.year} 年` : `${p.year} 年 ${p.month} 月`

export type Ranked = { name: string; count: number }

const rank = (names: string[], limit: number): Ranked[] => {
  const m = new Map<string, number>()
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1)
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
    .slice(0, limit)
}

// 地名在回顾里只留店名或第一段地址
export function shortPlace(placeName: string | null): string | null {
  if (!placeName) return null
  return placeName.split('（')[0].split(' · ').slice(0, 2).join(' · ') || null
}

export type Review = {
  records: JournalRecord[] // 这段时间里的记录，按时间正序
  days: number // 出门的天数（有记录的不同日子）
  cities: string[]
  trips: number
  topPlaces: Ranked[] // 去得最多的地方（按去过的天数）
  firsts: { name: string; at: number }[] // 这段时间里第一次去的地方
  categories: Ranked[]
}

// "第一次去"和"去得最多"要看全部记录才知道，所以传入全部记录，再取这段时间的部分
export function buildReview(all: JournalRecord[], p: Period): Review {
  const [from, to] = periodRange(p)
  const inPeriod = (r: JournalRecord) => r.takenAt >= from && r.takenAt < to
  const records = all.filter(inPeriod).sort((a, b) => a.takenAt - b.takenAt)
  const { visits, places } = computeVisits(all, cityOf)
  const byId = new Map(all.map((r) => [r.id, r]))
  const placeName = (index: number) => {
    for (const id of places[index].recordIds) {
      const name = shortPlace(byId.get(id)?.placeName ?? null)
      if (name) return name
    }
    return null
  }

  // 去得最多：这段时间里每个地方去过几天
  const placeDays = new Map<number, Set<string>>()
  const firsts: Review['firsts'] = []
  for (const r of records) {
    const v = visits.get(r.id)
    if (!v) continue
    let days = placeDays.get(v.place)
    if (!days) placeDays.set(v.place, (days = new Set()))
    days.add(localDay(r.takenAt))
    if (v.visit === 1 && !firsts.some((f) => f.at === r.takenAt)) {
      const name = placeName(v.place) ?? titleOf(r)
      if (!firsts.some((f) => f.name === name))
        firsts.push({ name, at: r.takenAt })
    }
  }
  const topPlaces = [...placeDays.entries()]
    .map(([i, days]) => ({ name: placeName(i), count: days.size }))
    .filter((x): x is Ranked => x.name !== null)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
    .slice(0, 5)

  return {
    records,
    days: new Set(records.map((r) => localDay(r.takenAt))).size,
    cities: rank(
      records.flatMap((r) => cityOf(r) ?? []),
      99,
    ).map((c) => c.name),
    trips: groupTrips(records).length,
    topPlaces,
    firsts: firsts.slice(0, 8),
    categories: rank(
      records.flatMap((r) => (r.content ? [r.content.category] : [])),
      9,
    ),
  }
}

// 出行总结和回顾长图用的每条记录摘要
export function recordLine(r: JournalRecord) {
  return {
    title: titleOf(r),
    place: shortPlace(r.placeName) ?? '',
    body: recordBody(r),
  }
}
