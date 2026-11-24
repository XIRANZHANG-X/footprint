import type { z } from 'zod'
import type { LOCATE_TOOLS } from '../../../shared/agents.ts'
import type { PlaceCandidate } from '../../../shared/ai.ts'
import type { JournalRecord } from '../../db.ts'
import type { ClueCity } from '../geo/cnTables.ts'
import type { LatLng } from '../photoMeta.ts'
import { ymd } from './askTools.ts'
import type { ToolImpl } from './run.ts'

// "帮我找地点"的工具（决策 0028 第 4 条）。每个可选的地点都登记一个编号，
// propose 只能引用这些编号，所以候选的坐标一定来自真实的查询结果

export type Spot = {
  ref: string
  label: string // 给用户看的名字
  location: LatLng
  placeName: string | null
}

export class SpotBook {
  private spots = new Map<string, Spot>()
  searches = 0 // 第几次 search_place，用来给搜索结果编号
  add(ref: string, s: Omit<Spot, 'ref'>): Spot {
    const spot = { ref, ...s }
    this.spots.set(ref, spot)
    return spot
  }
  get(ref: string): Spot | undefined {
    return this.spots.get(ref.trim())
  }
}

const hm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function recordClues(r: JournalRecord, cities: ClueCity[]): string {
  const clues = r.aiDraft?.clues
  return [
    `拍摄时间：${ymd(r.takenAt)} ${hm(r.takenAt)}`,
    r.note.trim() ? `原话：${r.note.trim()}` : '原话：（没写）',
    r.content?.title ? `标题：${r.content.title}` : '',
    r.content?.intro ? `AI 写的正文：${r.content.intro.slice(0, 300)}` : '',
    r.content?.tags.length ? `标签：${r.content.tags.join('、')}` : '',
    r.placeGuess ? `AI 看照片猜的地名：${r.placeGuess}` : '',
    r.placeName ? `用户写的地名（还没有坐标）：${r.placeName}` : '',
    clues?.phones.length ? `照片里的电话：${clues.phones.join('、')}` : '',
    clues?.plates.length ? `照片里的车牌：${clues.plates.join('、')}` : '',
    cities.length
      ? `查表得出的城市：${cities.map((c) => `${c.city}（${c.via}）`).join('、')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const sameDay = (a: number, b: number) => ymd(a) === ymd(b)

export function sameDayPlacesText(
  r: JournalRecord,
  records: JournalRecord[],
  book: SpotBook,
): string {
  const others = records
    .filter((x) => x.id !== r.id && x.location && sameDay(x.takenAt, r.takenAt))
    .sort((a, b) => a.takenAt - b.takenAt)
  if (others.length === 0) return '这一天没有其他有定位的记录。'
  return others
    .map((x, i) => {
      const s = book.add(`d${i + 1}`, {
        label: x.placeName ?? x.content?.title ?? '同一天的地点',
        location: x.location!,
        placeName: x.placeName,
      })
      const gap = Math.round((x.takenAt - r.takenAt) / 60_000)
      const when =
        gap === 0 ? '同一时间' : gap > 0 ? `晚 ${gap} 分钟` : `早 ${-gap} 分钟`
      return `${s.ref} | ${hm(x.takenAt)}（${when}）| ${s.label}${x.content?.title && x.placeName ? ` | ${x.content.title}` : ''}`
    })
    .join('\n')
}

export function pastPlacesText(
  r: JournalRecord,
  records: JournalRecord[],
  keyword: string,
  book: SpotBook,
): string {
  const k = keyword.trim()
  const seen = new Set<string>()
  const hits = records
    .filter(
      (x) =>
        x.id !== r.id &&
        x.location &&
        ((x.placeName ?? '').includes(k) ||
          (x.content?.title ?? '').includes(k)),
    )
    .sort((a, b) => b.takenAt - a.takenAt)
    .filter((x) => {
      const key =
        x.placeName ??
        `${x.location!.lat.toFixed(4)},${x.location!.lng.toFixed(4)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
  if (hits.length === 0) return `以前的记录里没有含「${k}」的地方。`
  return hits
    .map((x, i) => {
      const s = book.add(`p${i + 1}-${k}`, {
        label: x.placeName ?? x.content?.title ?? k,
        location: x.location!,
        placeName: x.placeName,
      })
      return `${s.ref} | ${ymd(x.takenAt)} | ${s.label}`
    })
    .join('\n')
}

export function searchResultsText(
  query: string,
  results: PlaceCandidate[],
  book: SpotBook,
): string {
  const n = ++book.searches
  if (results.length === 0)
    return `没查到「${query}」。可以换个说法，或者加上城市名。`
  return results
    .slice(0, 5)
    .map((c, i) => {
      const label = [c.name, c.address].filter(Boolean).join('，') || query
      const s = book.add(`s${n}-${i + 1}`, {
        label,
        location: { lat: c.lat, lng: c.lng },
        placeName: label,
      })
      return `${s.ref} | ${label}`
    })
    .join('\n')
}

type Proposal = z.infer<typeof LOCATE_TOOLS.propose.args>
export type LocateCandidate = Spot & { evidence: string }

export function locateTools(
  record: JournalRecord,
  records: JournalRecord[],
  book: SpotBook,
  deps: {
    clueCities: () => Promise<ClueCity[]>
    search: (q: string) => Promise<PlaceCandidate[]>
  },
): Record<string, ToolImpl> {
  return {
    record_clues: async () => ({
      text: recordClues(record, await deps.clueCities().catch(() => [])),
      label: '看这条记录的线索',
    }),
    same_day_places: async () => ({
      text: sameDayPlacesText(record, records, book),
      label: '看当天去过的地方',
    }),
    past_places: async (a) => {
      const { keyword } = a as { keyword: string }
      return {
        text: pastPlacesText(record, records, keyword, book),
        label: `找以前去过的：${keyword}`,
      }
    },
    search_place: async (a) => {
      const { query } = a as { query: string }
      return {
        text: searchResultsText(query, await deps.search(query), book),
        label: `搜地点：${query}`,
      }
    },
  }
}

// 只留下对得上工具结果的候选（决策 0028 第 2 条），同一个地点不重复
export function pickCandidates(
  p: Proposal,
  book: SpotBook,
): { candidates: LocateCandidate[]; dropped: number } {
  const out: LocateCandidate[] = []
  let dropped = 0
  for (const c of p.candidates) {
    const s = book.get(c.ref)
    if (!s) {
      dropped++
      continue
    }
    if (out.some((o) => o.ref === s.ref)) continue
    out.push({ ...s, evidence: c.evidence })
  }
  return { candidates: out, dropped }
}
