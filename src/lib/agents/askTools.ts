import type { z } from 'zod'
import type { ASK_TOOLS } from '../../../shared/agents.ts'
import type { JournalRecord } from '../../db.ts'
import { cityOf } from '../geo/area.ts'
import { recordBody } from '../record.ts'
import { searchableText } from '../search.ts'
import type { ToolImpl } from './run.ts'

// "问问我的足迹"的工具（决策 0028 第 3 条）。都是纯函数，只读传进来的记录；
// 发给模型的只有文字摘要，不发坐标和照片

// 补零的本地日期 YYYY-MM-DD，按年、按月分组时直接截前几位
export function ymd(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type Args<K extends keyof typeof ASK_TOOLS> = z.infer<
  (typeof ASK_TOOLS)[K]['args']
>

// 给模型看的记录编号：r1、r2……比 UUID 短，模型也不容易抄错。同一次提问里编号不变
export class RecordRefs {
  private byRef = new Map<string, string>()
  private byId = new Map<string, string>()
  ref(id: string): string {
    let r = this.byId.get(id)
    if (!r) {
      r = `r${this.byId.size + 1}`
      this.byId.set(id, r)
      this.byRef.set(r, id)
    }
    return r
  }
  id(ref: string): string | undefined {
    return this.byRef.get(ref.trim())
  }
}

const norm = (s: string) =>
  s.trim().replace(/(市|省|自治区|特别行政区|地区)$/, '')

export function inCity(r: JournalRecord, city: string): boolean {
  const want = norm(city)
  if (!want) return true
  const c = cityOf(r)
  if (c && (norm(c).includes(want) || want.includes(norm(c)))) return true
  return (r.placeName ?? '').includes(want)
}

// YYYY-MM 或 YYYY-MM-DD → 那段时间的第一毫秒 / 最后一毫秒（本地时区）
export function dayBound(s: string, end: boolean): number {
  const [y, m, d] = s.split('-').map(Number)
  if (d === undefined)
    return end
      ? new Date(y, m, 1).getTime() - 1
      : new Date(y, m - 1, 1).getTime()
  return end
    ? new Date(y, m - 1, d + 1).getTime() - 1
    : new Date(y, m - 1, d).getTime()
}

type Scope = {
  city: string | null
  category: string | null
  from: string | null
  to: string | null
}

export function inScope(r: JournalRecord, s: Scope): boolean {
  if (s.city && !inCity(r, s.city)) return false
  if (s.category && !(r.content?.category ?? '').includes(s.category.trim()))
    return false
  if (s.from && r.takenAt < dayBound(s.from, false)) return false
  if (s.to && r.takenAt > dayBound(s.to, true)) return false
  return true
}

export function describeScope(
  s: Partial<Scope> & { keywords?: string | null },
) {
  return (
    [
      s.keywords,
      s.city,
      s.category,
      s.from && s.to ? `${s.from}～${s.to}` : (s.from ?? s.to),
    ]
      .filter(Boolean)
      .join(' · ') || '全部记录'
  )
}

export function summaryLine(r: JournalRecord, refs: RecordRefs): string {
  const body = recordBody(r).replace(/\s+/g, ' ').slice(0, 120)
  return [
    refs.ref(r.id),
    ymd(r.takenAt),
    r.content?.title ?? '（没有标题）',
    r.placeName ? `地点：${r.placeName}` : '',
    cityOf(r) ? `城市：${cityOf(r)}` : '',
    r.content?.category ? `类别：${r.content.category}` : '',
    r.content?.tags.length ? `标签：${r.content.tags.join('、')}` : '',
    body ? `正文：${body}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}

export const SEARCH_LIMIT = 12

// 先按字面：命中的词越多越靠前，同样多的新的在前。不够 12 条、又有关键词时，用语义搜索补
export async function searchRecords(
  records: JournalRecord[],
  args: Args<'search_records'>,
  refs: RecordRefs,
  semantic?: (q: string) => Promise<string[]>,
): Promise<{ text: string; ids: string[] }> {
  const pool = records.filter((r) => inScope(r, args))
  const terms = (args.keywords ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  let picked: JournalRecord[]
  if (terms.length === 0)
    picked = [...pool].sort((a, b) => b.takenAt - a.takenAt)
  else {
    const scored = pool
      .map((r) => {
        const text = searchableText(r, cityOf(r))
        return { r, n: terms.filter((t) => text.includes(t)).length }
      })
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.r.takenAt - a.r.takenAt)
    picked = scored.map((x) => x.r)
    if (picked.length < SEARCH_LIMIT && semantic) {
      try {
        const inPool = new Map(pool.map((r) => [r.id, r]))
        const have = new Set(picked.map((r) => r.id))
        for (const id of await semantic(args.keywords ?? ''))
          if (!have.has(id) && inPool.has(id)) picked.push(inPool.get(id)!)
      } catch {
        // 语义模型没加载成功：只用字面结果
      }
    }
  }
  const shown = picked.slice(0, SEARCH_LIMIT)
  const head =
    pool.length === 0
      ? '这个范围里没有记录。'
      : shown.length === 0
        ? `范围内有 ${pool.length} 条记录，但没有和关键词相关的。`
        : `找到 ${picked.length} 条${picked.length > shown.length ? `，列出前 ${shown.length} 条` : ''}：`
  return {
    text: [head, ...shown.map((r) => summaryLine(r, refs))].join('\n'),
    ids: shown.map((r) => r.id),
  }
}

export function stats(records: JournalRecord[], args: Args<'stats'>): string {
  const pool = records.filter((r) => inScope(r, args))
  if (pool.length === 0) return '这个范围里没有记录。'
  const keyOf = (r: JournalRecord): string => {
    const d = ymd(r.takenAt)
    if (args.groupBy === 'year') return d.slice(0, 4)
    if (args.groupBy === 'month') return d.slice(0, 7)
    if (args.groupBy === 'city') return cityOf(r) ?? '（城市未知）'
    return r.content?.category ?? '（没有类别）'
  }
  const groups = new Map<string, JournalRecord[]>()
  for (const r of pool) {
    const k = keyOf(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const rows = [...groups.entries()]
    .map(([k, rs]) => {
      const days = new Set(rs.map((r) => ymd(r.takenAt)))
      const times = rs.map((r) => r.takenAt)
      return {
        k,
        n: rs.length,
        days: days.size,
        first: ymd(Math.min(...times)),
        last: ymd(Math.max(...times)),
      }
    })
    .sort((a, b) =>
      args.groupBy === 'year' || args.groupBy === 'month'
        ? a.k.localeCompare(b.k)
        : b.n - a.n,
    )
  const allDays = new Set(pool.map((r) => ymd(r.takenAt))).size
  return [
    `共 ${pool.length} 条记录，${allDays} 天，分成 ${rows.length} 组：`,
    ...rows
      .slice(0, 40)
      .map(
        (x) =>
          `${x.k}：${x.n} 条，${x.days} 天，第一次 ${x.first}，最近 ${x.last}`,
      ),
    rows.length > 40 ? `（还有 ${rows.length - 40} 组没列出）` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function getRecord(
  records: JournalRecord[],
  args: Args<'get_record'>,
  refs: RecordRefs,
): string {
  const id = refs.id(args.id)
  const r = id ? records.find((x) => x.id === id) : undefined
  if (!r)
    return `没有编号为 ${args.id} 的记录（编号要用 search_records 给的）。`
  return [
    summaryLine(r, refs),
    r.note.trim() ? `自己写的：${r.note.trim()}` : '',
    r.content?.intro.trim() ? `AI 整理的：${r.content.intro.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const GROUP = { city: '城市', category: '类别', year: '年份', month: '月份' }

// 把上面的函数包成 Agent 的工具；seen 记下查到过的记录，回答只能引用这些
export function askTools(
  records: JournalRecord[],
  refs: RecordRefs,
  seen: Set<string>,
  semantic?: (q: string) => Promise<string[]>,
): Record<string, ToolImpl> {
  return {
    search_records: async (a) => {
      const args = a as Args<'search_records'>
      const out = await searchRecords(records, args, refs, semantic)
      for (const id of out.ids) seen.add(id)
      return { text: out.text, label: `找：${describeScope(args)}` }
    },
    stats: async (a) => {
      const args = a as Args<'stats'>
      return {
        text: stats(records, args),
        label: `按${GROUP[args.groupBy]}统计：${describeScope(args)}`,
      }
    },
    get_record: async (a) => {
      const args = a as Args<'get_record'>
      const id = refs.id(args.id)
      if (id) seen.add(id)
      const r = records.find((x) => x.id === id)
      return {
        text: getRecord(records, args, refs),
        label: `看全文：${r?.content?.title ?? args.id}`,
      }
    },
  }
}
