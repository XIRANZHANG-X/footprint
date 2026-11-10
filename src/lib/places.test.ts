import { describe, expect, it } from 'vitest'
import { sameDayPlaces } from './places.ts'

const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).getTime()
const bund = { lat: 31.24, lng: 121.49 }
const temple = { lat: 31.2272, lng: 121.4922 }

const rec = (
  id: string,
  takenAt: number,
  location: typeof bund | null,
  placeName: string | null = null,
) => ({ id, takenAt, location, placeName })

describe('sameDayPlaces', () => {
  const me = { id: 'me', takenAt: at(8, 12) }

  it('列出同一天其他记录的地点，离得近的排前面', () => {
    const list = sameDayPlaces(me, [
      rec('a', at(8, 20), bund, '外滩'),
      rec('b', at(8, 13), temple, '城隍庙'),
    ])
    expect(list.map((o) => o.label)).toEqual(['城隍庙', '外滩'])
    expect(list[0]).toMatchObject({ location: temple, placeName: '城隍庙' })
  })

  it('不列别的日子、没有定位的记录和自己', () => {
    const list = sameDayPlaces(me, [
      rec('yesterday', at(7, 23), bund, '外滩'),
      rec('nowhere', at(8, 13), null),
      rec('me', at(8, 12), bund, '自己'),
    ])
    expect(list).toEqual([])
  })

  it('同一个地方只列一次', () => {
    const list = sameDayPlaces(me, [
      rec('a', at(8, 13), bund, '外滩'),
      rec('b', at(8, 14), { lat: 31.24001, lng: 121.49001 }, '外滩观景台'),
    ])
    expect(list.map((o) => o.label)).toEqual(['外滩'])
  })

  it('没有地名的记录显示坐标', () => {
    const [o] = sameDayPlaces(me, [rec('a', at(8, 13), bund)])
    expect(o.label).toBe('31.2400, 121.4900')
    expect(o.placeName).toBeNull()
  })

  it('这条记录后来加的照片带定位时，排在最前面', () => {
    const list = sameDayPlaces(
      me,
      [rec('a', at(8, 13), bund, '外滩')],
      [{ location: null }, { location: temple }],
    )
    expect(list[0].label).toBe('照片里的位置（31.2272, 121.4922）')
    expect(list[0].placeName).toBeNull()
    expect(list).toHaveLength(2)
  })
})
