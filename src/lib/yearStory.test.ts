import { describe, expect, it } from 'vitest'
import { MAX_SUMMARY_ITEMS } from '../../shared/ai.ts'
import type { JournalRecord } from '../db.ts'
import { byMonth, monthItems, yearFacts } from './yearStory.ts'

// 决策 0029 第 2 条：年度报告的分层总结
function rec(
  id: string,
  when: string,
  title: string,
  place: string,
): JournalRecord {
  return {
    id,
    createdAt: 0,
    takenAt: new Date(when).getTime(),
    timeSource: 'exif',
    location: { lat: 30.25, lng: 120.15 },
    locationStatus: 'exif',
    photoCount: 1,
    note: '',
    placeName: place,
    aiDraft: null,
    content: { title, category: '美食', intro: '', tags: [] },
    aiStatus: 'done',
    aiError: null,
    tripBreak: null,
    bodySource: 'own',
    placeGuess: null,
    aiTimings: null,
    area: { key: '', gv: 2, cc: 'CN', admin1: '浙江省', a1: 0, county: null },
    geoCity: '杭州市',
  } as unknown as JournalRecord
}

describe('year story', () => {
  it('groups by month inside the year only', () => {
    const all = [
      rec('a', '2025-03-02T12:00', '面', '奎元馆'),
      rec('b', '2025-03-20T12:00', '湖', '断桥'),
      rec('c', '2025-07-01T12:00', '展', '浙江美术馆'),
      rec('d', '2024-12-31T12:00', '去年', '外滩'),
    ]
    expect(byMonth(all, 2025).map(([m, rs]) => [m, rs.length])).toEqual([
      [3, 2],
      [7, 1],
    ])
  })

  it('samples evenly when a month has too many records, keeping first and last', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      rec(String(i), `2025-03-01T00:00`, `第${i}条`, ''),
    ).map((r, i) => ({ ...r, takenAt: r.takenAt + i * 60_000 }))
    const items = monthItems(many)
    expect(items).toHaveLength(MAX_SUMMARY_ITEMS)
    expect(items[0].title).toBe('第0条')
    expect(items.at(-1)?.title).toBe('第149条')
  })

  it('hands the model precomputed facts', () => {
    const all = [
      rec('a', '2025-03-02T18:00', '面', '奎元馆'),
      rec('b', '2025-03-03T09:00', '湖', '断桥'), // 隔 15 小时，同一次出行
      rec('c', '2025-07-01T12:00', '展', '浙江美术馆'),
    ]
    const facts = yearFacts(all, 2025)
    expect(facts).toContain('记录条数：3\n出门天数：3\n出行次数：2')
    expect(facts).toContain('去过的城市：杭州市')
    expect(facts).toContain('记得最多的月份：3 月（2 条）')
    expect(facts).toContain('最长的一次出行：3月2日 起 2 天')
    expect(facts).not.toContain('120.15')
  })
})
