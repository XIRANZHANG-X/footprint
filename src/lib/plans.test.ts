import { describe, expect, it } from 'vitest'
import type { JournalRecord, Plan } from '../db.ts'
import { arrivals, countdown, reachedStops, tasteOf } from './plans.ts'

// 决策 0024：计划
const DAY = 86_400_000
const day0 = new Date(2026, 11, 1).getTime() // 12 月 1 日零点
const plan: Plan = {
  id: 'p',
  title: '京都三日',
  start: day0,
  days: 3,
  createdAt: day0 - 10 * DAY,
  source: 'ai',
  stops: [
    {
      id: 's1',
      day: 1,
      name: '清水寺',
      lat: 34.9949,
      lng: 135.785,
      address: null,
      boundary: null,
      shape: null,
      note: '',
      reason: null,
    },
    {
      id: 's2',
      day: 2,
      name: '没核实的地方',
      lat: null,
      lng: null,
      address: null,
      boundary: null,
      shape: null,
      note: '',
      reason: null,
    },
  ],
}
const rec = (id: string, t: number, lat: number, lng: number) =>
  ({ id, takenAt: t, location: { lat, lng } }) as JournalRecord

describe('plans', () => {
  it('marks a stop reached by a record during the trip, not before it', () => {
    expect(
      reachedStops(plan, [rec('old', day0 - 30 * DAY, 34.995, 135.785)]).size,
    ).toBe(0)
    const r = reachedStops(plan, [rec('now', day0 + 3600_000, 34.995, 135.785)])
    expect(r.get('s1')).toBe('now')
    expect(r.has('s2')).toBe(false) // 没有位置的永远到不了
  })

  it('prompts when the track arrives at an unrecorded stop during the trip', () => {
    const near = { t: day0 + 5 * 3600_000, lat: 34.995, lng: 135.7851 }
    expect(arrivals([plan], [], [near], day0 + 6 * 3600_000)).toHaveLength(1)
    // 已经记了就不提示；计划之外的日子也不提示
    expect(
      arrivals([plan], [rec('r', near.t, 34.995, 135.785)], [near], near.t),
    ).toHaveLength(0)
    expect(arrivals([plan], [], [near], day0 + 30 * DAY)).toHaveLength(0)
  })

  it('counts down to the next plan, then the day of an ongoing one', () => {
    expect(countdown([plan], null, day0 - 12 * DAY + 5000)).toBe(
      '离「京都三日」出发还有 12 天',
    )
    expect(countdown([plan], null, day0 - DAY)).toBe('明天出发：「京都三日」')
    expect(countdown([plan], null, day0 + DAY + 3600_000)).toBe(
      '「京都三日」第 2 天',
    )
  })

  it('falls back to days since the last trip', () => {
    expect(countdown([], day0 - 23 * DAY, day0)).toBe('上次出门是 23 天前')
    expect(countdown([], null, day0)).toBeNull()
  })

  it('summarizes taste from categories and tags', () => {
    const r = (category: string, tags: string[]) =>
      ({ content: { category, tags, title: '', intro: '' } }) as JournalRecord
    expect(
      tasteOf([r('美食', ['面']), r('美食', ['咖啡']), r('其他', ['面'])], 2),
    ).toEqual(['美食', '面'])
  })
})
