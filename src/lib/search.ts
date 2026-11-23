import type { JournalRecord } from '../db.ts'
import { recordBody } from './record.ts'

// 时间线顶部的搜索和筛选（决策 0014 第 3A 条）。数据都在本地，直接在内存里过滤。
// 中文不分词：按"包含这几个字"匹配；空格隔开的几个词要同时出现。

export type Filters = {
  q: string
  category: string | null
  tag: string | null
  city: string | null
  // "一年前的今天"：只看往年同月同日的记录（决策 0014 第 3E 条）
  day: { month: number; date: number } | null
}

export const NO_FILTERS: Filters = {
  q: '',
  category: null,
  tag: null,
  city: null,
  day: null,
}

export const isFiltering = (f: Filters) =>
  f.q.trim() !== '' ||
  f.category !== null ||
  f.tag !== null ||
  f.city !== null ||
  f.day !== null

type CityOf = (r: JournalRecord) => string | null

// 参与搜索的文字：标题、两版正文、原话、地名、标签、类别、城市
export function searchableText(r: JournalRecord, city: string | null): string {
  return [
    r.content?.title,
    r.content?.intro,
    r.note,
    r.placeName,
    r.placeGuess,
    ...(r.content?.tags ?? []),
    r.content?.category,
    city,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

export function matchesText(r: JournalRecord, q: string, city: string | null) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const text = searchableText(r, city)
  return terms.every((t) => text.includes(t))
}

export function sameDay(ms: number, day: { month: number; date: number }) {
  const d = new Date(ms)
  return d.getMonth() + 1 === day.month && d.getDate() === day.date
}

// 除了文字以外的条件（类别、标签、城市、日期）
export function matchesFacets(
  r: JournalRecord,
  f: Filters,
  city: string | null,
) {
  if (f.category !== null && r.content?.category !== f.category) return false
  if (f.tag !== null && !(r.content?.tags ?? []).includes(f.tag)) return false
  if (f.city !== null && city !== f.city) return false
  if (f.day !== null && !sameDay(r.takenAt, f.day)) return false
  return true
}

export function applyFilters(
  records: JournalRecord[],
  f: Filters,
  cityOf: CityOf,
): JournalRecord[] {
  return records.filter((r) => {
    const city = cityOf(r)
    return matchesFacets(r, f, city) && matchesText(r, f.q, city)
  })
}

export type Facet = { value: string; count: number }

const countBy = (values: string[]): Facet[] => {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  // 常用的排前面；一样多的按名字排，顺序稳定
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh'))
}

// 筛选按钮：从已有记录里统计出类别、标签、城市
export function facets(records: JournalRecord[], cityOf: CityOf) {
  return {
    categories: countBy(
      records.flatMap((r) => (r.content ? [r.content.category] : [])),
    ),
    tags: countBy(records.flatMap((r) => r.content?.tags ?? [])),
    cities: countBy(records.flatMap((r) => cityOf(r) ?? [])),
  }
}

// 语义搜索用的文字（决策 0014 第 3A 条）：标题 + 正文 + 地名 + 标签
export function embedText(r: JournalRecord): string {
  return [
    r.content?.title,
    recordBody(r),
    r.placeName,
    (r.content?.tags ?? []).join(' '),
  ]
    .filter((s) => s && s.trim())
    .join('\n')
    .slice(0, 500)
}

// 文字指纹（FNV-1a），用来判断向量是不是按现在的文字算的
export function textHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + s.length.toString(36)
}
