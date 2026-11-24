import { describe, expect, it } from 'vitest'
import { distanceM } from '../src/lib/visits.ts'
import { gcj02ToWgs84, inChinaRough, wgs84ToGcj02 } from './gcj02.ts'

// 坐标换算（决策 0021）。不写死某个点的"标准答案"：手头没有可靠出处。
// 检查的是性质：国内偏移几百米、国外不动、正算再反算回到原点。

const cities = {
  杭州: { lat: 30.2741, lng: 120.1551 },
  北京: { lat: 39.9087, lng: 116.3975 },
  乌鲁木齐: { lat: 43.8256, lng: 87.6168 },
  三亚: { lat: 18.2528, lng: 109.512 },
  哈尔滨: { lat: 45.8038, lng: 126.535 },
}

describe('WGS-84 ↔ GCJ-02', () => {
  it('shifts points inside China by a few hundred meters', () => {
    for (const p of Object.values(cities)) {
      const m = distanceM(p, wgs84ToGcj02(p))
      expect(m).toBeGreaterThan(50)
      expect(m).toBeLessThan(800)
    }
  })

  it('leaves points outside China untouched', () => {
    const tokyo = { lat: 35.6812, lng: 139.7671 }
    const paris = { lat: 48.8566, lng: 2.3522 }
    expect(wgs84ToGcj02(tokyo)).toEqual(tokyo)
    expect(gcj02ToWgs84(paris)).toEqual(paris)
    expect(inChinaRough(tokyo)).toBe(false)
  })

  it('round-trips to within a few centimeters', () => {
    for (const p of Object.values(cities)) {
      const back = gcj02ToWgs84(wgs84ToGcj02(p))
      expect(distanceM(p, back)).toBeLessThan(0.05)
    }
  })

  it('is smooth: nearby points move by almost the same amount', () => {
    const a = cities.杭州
    const b = { lat: a.lat + 0.001, lng: a.lng + 0.001 } // 约 140 米外
    const da = wgs84ToGcj02(a)
    const db = wgs84ToGcj02(b)
    const shiftA = { lat: da.lat - a.lat, lng: da.lng - a.lng }
    const shiftB = { lat: db.lat - b.lat, lng: db.lng - b.lng }
    expect(Math.abs(shiftA.lat - shiftB.lat)).toBeLessThan(1e-5)
    expect(Math.abs(shiftA.lng - shiftB.lng)).toBeLessThan(1e-5)
  })
})
