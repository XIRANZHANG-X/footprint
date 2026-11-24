import { describe, expect, it } from 'vitest'
import { arcPoints, formatKm, LONG_SEGMENT_KM, tripRoute } from './route.ts'

// 路线（决策 0020 第 1、2 条）
const at = (h: number, lat: number, lng: number) => ({
  takenAt: h * 3_600_000,
  location: { lat, lng },
})

describe('trip route', () => {
  it('connects located records in time order and merges repeats at one place', () => {
    const r = tripRoute([
      at(3, 30.25, 120.16), // 杭州
      at(1, 31.23, 121.47), // 上海，最早
      at(2, 31.2301, 121.4701), // 还在上海，同一个地方
      { takenAt: 4 * 3_600_000, location: null },
    ])
    expect(r.points).toHaveLength(2)
    expect(r.points[0].lat).toBeCloseTo(31.23)
    expect(r.segments).toHaveLength(1)
    expect(r.km).toBeGreaterThan(150)
    expect(r.km).toBeLessThan(200)
    expect(r.segments[0].long).toBe(false)
  })

  it('marks segments over the threshold as long jumps', () => {
    const r = tripRoute([at(1, 31.23, 121.47), at(9, 39.9, 116.4)]) // 上海 → 北京
    expect(r.segments[0].km).toBeGreaterThan(LONG_SEGMENT_KM)
    expect(r.segments[0].long).toBe(true)
  })

  it('has no segments for a single place', () => {
    expect(tripRoute([at(1, 30, 120)])).toMatchObject({ segments: [], km: 0 })
  })
})

describe('arc points', () => {
  it('starts and ends at the two places and bulges to the left of travel', () => {
    const from = { lat: 0, lng: 0 }
    const to = { lat: 0, lng: 10 } // 往东走，左边是北
    const pts = arcPoints(from, to, 10)
    expect(pts[0]).toEqual(from)
    expect(pts.at(-1)!.lng).toBeCloseTo(10)
    expect(pts[5].lat).toBeGreaterThan(0.5)
    // 回程往西走，左边是南，两条线分开
    expect(arcPoints(to, from, 10)[5].lat).toBeLessThan(-0.5)
  })

  it('crosses the 180° meridian the short way', () => {
    const pts = arcPoints({ lat: 35, lng: 139 }, { lat: 37, lng: -122 }) // 东京 → 旧金山
    expect(pts.at(-1)!.lng).toBeCloseTo(238) // -122 + 360
    expect(Math.max(...pts.map((p) => p.lng))).toBeLessThanOrEqual(238.01)
  })
})

describe('formatting distance', () => {
  it('hides tiny distances and rounds the rest', () => {
    expect(formatKm(0.4)).toBeNull()
    expect(formatKm(3.21)).toBe('约 3.2 公里')
    expect(formatKm(1234.6)).toBe('约 1,235 公里')
  })
})
