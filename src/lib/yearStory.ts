import { MAX_SUMMARY_ITEMS } from '../../shared/ai.ts'
import { db, type JournalRecord } from '../db.ts'
import { summarize, summarizeYear } from './ai.ts'
import { styleForRequest } from './preferences.ts'
import { buildReview, periodRange, recordLine } from './review.ts'
import { textHash } from './search.ts'
import { groupTrips } from './trips.ts'

// 年度报告（决策 0029 第 2 条）：分层总结。先每个月写一段小结（存起来，这个月的记录没变就不重写），
// 再把 12 段小结和本机统计交给模型写一年。不发照片、不发坐标

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})

export type SummaryItem = {
  date: string
  title: string
  place: string
  body: string
}

// 一个月的记录多于上限时，均匀挑一部分（保留首尾）
export function monthItems(records: JournalRecord[]): SummaryItem[] {
  const sorted = [...records].sort((a, b) => a.takenAt - b.takenAt)
  const picked =
    sorted.length <= MAX_SUMMARY_ITEMS
      ? sorted
      : Array.from(
          { length: MAX_SUMMARY_ITEMS },
          (_, i) =>
            sorted[
              Math.round((i * (sorted.length - 1)) / (MAX_SUMMARY_ITEMS - 1))
            ],
        )
  return picked.map((r) => {
    const l = recordLine(r)
    return {
      date: dayFmt.format(r.takenAt),
      title: l.title.slice(0, 40),
      place: l.place.slice(0, 80),
      body: l.body.slice(0, 400),
    }
  })
}

export function byMonth(all: JournalRecord[], year: number) {
  const months = new Map<number, JournalRecord[]>()
  for (const r of all) {
    const d = new Date(r.takenAt)
    if (d.getFullYear() !== year) continue
    const m = d.getMonth() + 1
    months.set(m, [...(months.get(m) ?? []), r])
  }
  return [...months.entries()].sort((a, b) => a[0] - b[0])
}

// 本机算好的统计，原样交给模型（模型不自己数）
export function yearFacts(all: JournalRecord[], year: number): string {
  const r = buildReview(all, { kind: 'year', year, month: 1 })
  const months = byMonth(all, year)
  const busiest = [...months].sort((a, b) => b[1].length - a[1].length)[0]
  const [from, to] = periodRange({ kind: 'year', year, month: 1 })
  const trips = groupTrips(
    all.filter((x) => x.takenAt >= from && x.takenAt < to),
  )
  const longest = trips
    .map((t) => ({
      t,
      days: Math.round((t.end - t.start) / 86_400_000) + 1,
    }))
    .sort((a, b) => b.days - a.days)[0]
  return [
    // 一行一个数，带名称：试跑时"6 条记录，3 次出行"写在一行，模型写成了"六次出行"
    `记录条数：${r.records.length}`,
    `出门天数：${r.days}`,
    `出行次数：${r.trips}`,
    r.cities.length ? `去过的城市：${r.cities.join('、')}` : '',
    r.topPlaces.length
      ? `去得最多的地方（天数）：${r.topPlaces.map((p) => `${p.name} ${p.count} 天`).join('、')}`
      : '',
    r.firsts.length
      ? `第一次去：${r.firsts.map((f) => `${dayFmt.format(f.at)} ${f.name}`).join('、')}`
      : '',
    busiest
      ? `记得最多的月份：${busiest[0]} 月（${busiest[1].length} 条）`
      : '',
    longest && longest.days > 1
      ? `最长的一次出行：${dayFmt.format(longest.t.start)} 起 ${longest.days} 天`
      : '',
    r.categories.length
      ? `类别：${r.categories.map((c) => `${c.name} ${c.count}`).join('、')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1500)
}

type Cached = { fp: string; text: string; at: number }
const monthKey = (y: number, m: number) => `monthSummary:${y}-${m}`
export const yearKey = (y: number) => `yearStory:${y}`

export type YearStory = {
  text: string
  months: { month: number; text: string }[]
  at: number
}

export async function savedYearStory(year: number): Promise<YearStory | null> {
  return ((await db.settings.get(yearKey(year)))?.value as YearStory) ?? null
}

export async function writeYearStory(
  all: JournalRecord[],
  year: number,
  onProgress?: (done: number, total: number) => void,
): Promise<YearStory> {
  const { preferences } = await styleForRequest(false)
  const months = byMonth(all, year)
  if (months.length === 0) throw new Error('这一年没有记录')
  const out: { month: number; text: string }[] = []
  let done = 0
  for (const [m, recs] of months) {
    onProgress?.(done, months.length)
    const items = monthItems(recs)
    const fp = textHash(JSON.stringify([items, preferences ?? '']))
    const cached = (await db.settings.get(monthKey(year, m)))?.value as
      Cached | undefined
    let text = cached?.fp === fp ? cached.text : null
    if (text === null) {
      text = (await summarize({ items, preferences, scope: 'month' })).trim()
      await db.settings.put({
        key: monthKey(year, m),
        value: { fp, text, at: Date.now() } satisfies Cached,
      })
    }
    out.push({ month: m, text: text.slice(0, 800) })
    done++
  }
  onProgress?.(done, months.length)
  const text = await summarizeYear({
    year,
    months: out,
    facts: yearFacts(all, year),
    preferences,
  })
  const story: YearStory = { text: text.trim(), months: out, at: Date.now() }
  await db.settings.put({ key: yearKey(year), value: story })
  return story
}
