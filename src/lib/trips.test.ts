import { describe, expect, it } from 'vitest'
import { groupTrips, type Groupable, type TripBreak } from './trips.ts'

const H = 3_600_000
const r = (
  id: string,
  hour: number,
  tripBreak: TripBreak = null,
): Groupable => ({
  id,
  takenAt: hour * H,
  tripBreak,
})
const ids = (records: Groupable[]) =>
  groupTrips(records).map((t) => t.records.map((x) => x.id))

describe('groupTrips', () => {
  it('keeps a multi-day trip together across overnight gaps', () => {
    // 第一天 10:00、20:00，第二天 09:00（间隔 13 小时）
    expect(ids([r('a', 10), r('b', 20), r('c', 33)])).toEqual([['a', 'b', 'c']])
  })

  it('splits Saturday and Sunday outings (gap over 16 h)', () => {
    // 周六 14:00，周日 12:00（间隔 22 小时）
    expect(ids([r('sat', 14), r('sun', 36)])).toEqual([['sat'], ['sun']])
  })

  it('sorts by capture time regardless of input order', () => {
    expect(ids([r('c', 33), r('a', 10), r('b', 20)])).toEqual([['a', 'b', 'c']])
  })

  it('honours a manual split inside a would-be trip', () => {
    expect(ids([r('a', 10), r('b', 12, 'split'), r('c', 13)])).toEqual([
      ['a'],
      ['b', 'c'],
    ])
  })

  it('honours a manual join across a long gap', () => {
    expect(ids([r('a', 0), r('b', 100, 'join')])).toEqual([['a', 'b']])
  })

  it('ignores a join on the very first record', () => {
    expect(ids([r('a', 0, 'join')])).toEqual([['a']])
  })

  it('reports the trip id, start and end', () => {
    const [trip] = groupTrips([r('b', 20), r('a', 10)])
    expect(trip).toMatchObject({ id: 'a', start: 10 * H, end: 20 * H })
  })

  it('returns no trips for no records', () => {
    expect(groupTrips([])).toEqual([])
  })
})
