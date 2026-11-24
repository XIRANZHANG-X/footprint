import { describe, expect, it } from 'vitest'
import type { JournalRecord, VisitedPlace, Wish } from '../db.ts'
import { footprint } from './footprint.ts'
import { fulfilledBy, wishState } from './wishes.ts'

// 决策 0020：想去的地方、足迹总览

const DAY = 86_400_000
const rec = (
  id: string,
  day: number,
  lat: number,
  lng: number,
  extra: Partial<JournalRecord> = {},
) =>
  ({
    id,
    takenAt: day * DAY,
    createdAt: day * DAY,
    location: { lat, lng },
    tripBreak: null,
    placeName: null,
    ...extra,
  }) as JournalRecord

const wish = (extra: Partial<Wish>): Wish => ({
  id: 'w',
  name: '西湖',
  address: null,
  lat: 30.25,
  lng: 120.14,
  kind: 'poi',
  boundary: null,
  shape: null,
  note: '',
  addedAt: 10 * DAY,
  manual: null,
  ...extra,
})

describe('wishes', () => {
  it('only counts visits after the place was added to the list', () => {
    const before = rec('old', 5, 30.2501, 120.1401)
    const after = rec('new', 12, 30.2502, 120.1402)
    expect(wishState(wish({}), [before])).toEqual({ done: false })
    expect(wishState(wish({}), [before, after])).toEqual({
      done: true,
      recordId: 'new',
      at: 12 * DAY,
    })
  })

  it('uses 200 m around a point, and the boundary when there is one', () => {
    const far = rec('far', 12, 30.27, 120.16) // 约 3 公里外
    expect(wishState(wish({}), [far]).done).toBe(false)
    // 一个把这条记录包进去的方框
    const shape = [
      [[120.1, 30.2, 120.2, 30.2, 120.2, 30.3, 120.1, 30.3, 120.1, 30.2]],
    ]
    expect(wishState(wish({ shape, kind: 'city' }), [far]).done).toBe(true)
  })

  it('lets the user override the automatic result', () => {
    const after = rec('new', 12, 30.25, 120.14)
    expect(wishState(wish({ manual: 'undone' }), [after]).done).toBe(false)
    expect(wishState(wish({ manual: 'done' }), [])).toEqual({
      done: true,
      recordId: null,
      at: null,
    })
  })

  it('tags the record that fulfilled a wish', () => {
    const after = rec('new', 12, 30.25, 120.14)
    expect(fulfilledBy([wish({})], [after]).get('new')).toBe('西湖')
  })
})

describe('footprint overview', () => {
  const area = (cc: string, admin1: string) => ({
    area: { key: '', gv: 2, cc, admin1, a1: 0, county: null },
    geoCity: null,
  })
  const records = [
    rec('a', 1, 31.23, 121.47, area('CN', '上海市')),
    rec('b', 1.2, 30.25, 120.16, area('CN', '浙江省')),
    rec('c', 40, 35.68, 139.77, area('JP', '东京都')),
  ]
  const visited: VisitedPlace[] = [
    {
      id: 'v',
      kind: 'country',
      name: '法国',
      cc: 'FR',
      a1: null,
      code: null,
      city: null,
      shape: null,
      addedAt: 1,
    },
    {
      id: 'v2',
      kind: 'cn',
      name: '成都市',
      cc: 'CN',
      a1: null,
      code: '510100',
      city: '成都市',
      shape: null,
      addedAt: 1,
    },
  ]

  it('counts countries and cities from records and places added by hand', () => {
    const f = footprint(records, visited, null)
    expect(f.countries.map((c) => c.cc).sort()).toEqual(['CN', 'FR', 'JP'])
    expect(f.cities).toBe(4) // 上海市、浙江省、东京都、成都市
    expect(f.added).toBe(2)
    expect(f.farthest).toBeNull()
  })

  it('adds up distance within trips only, not between them', () => {
    // 上海 → 杭州是同一次出行（相隔 4.8 小时），东京是 39 天后的另一次
    const km = footprint(records, [], null).km
    expect(km).toBeGreaterThan(150)
    expect(km).toBeLessThan(200)
  })

  it('finds the farthest place from home', () => {
    const f = footprint(records, [], { name: '杭州', lat: 30.27, lng: 120.15 })
    expect(f.farthest?.name).toBe('东京都')
    expect(f.farthest!.km).toBeGreaterThan(1500)
  })
})
