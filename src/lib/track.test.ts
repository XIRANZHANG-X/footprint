import { describe, expect, it } from 'vitest'
import { tripPaths } from './route.ts'
import {
  findStays,
  uncoveredStays,
  guessBySpeed,
  inZone,
  locateAt,
  offsetZoneCenter,
  parseGpx,
  simplifyPath,
  type TrackPoint,
} from './track.ts'
import { distanceM } from './visits.ts'

// 决策 0022：轨迹
const MIN = 60_000
const pt = (min: number, lat: number, lng: number): TrackPoint => ({
  t: min * MIN,
  lat,
  lng,
  acc: 20,
  src: 'gps',
})

describe('locating a photo by time', () => {
  const track = [pt(0, 30, 120), pt(20, 30.01, 120), pt(100, 30.1, 120)]

  it('uses the nearest point within 10 minutes', () => {
    expect(locateAt(track, 3 * MIN)).toEqual({ lat: 30, lng: 120 })
    expect(locateAt(track, 95 * MIN)).toEqual({ lat: 30.1, lng: 120 })
  })

  it('interpolates across a gap of up to 30 minutes', () => {
    const p = locateAt(track, 15 * MIN)! // 0 和 20 分钟之间，离最近的点 5 分钟
    expect(p).toEqual({ lat: 30.01, lng: 120 })
    const mid = locateAt([pt(0, 30, 120), pt(28, 30.028, 120)], 14 * MIN)!
    expect(mid.lat).toBeCloseTo(30.014)
  })

  it('gives up when the track is too far away in time', () => {
    expect(locateAt(track, 60 * MIN)).toBeNull() // 20 和 100 之间隔 80 分钟
    expect(locateAt(track, 300 * MIN)).toBeNull()
    expect(locateAt([], 0)).toBeNull()
  })
})

describe('stays', () => {
  it('finds a stop of 20+ minutes within 150 m', () => {
    const track = [
      pt(0, 30, 120),
      pt(5, 30.01, 120), // 走开了
      pt(10, 30.0101, 120.0001),
      pt(25, 30.0102, 120),
      pt(40, 30.0101, 120.0002), // 在这里待了 30 分钟
      pt(45, 30.05, 120),
    ]
    const stays = findStays(track)
    expect(stays).toHaveLength(1)
    expect(stays[0].start).toBe(5 * MIN)
    expect(stays[0].end).toBe(40 * MIN)
  })

  it('ignores short stops', () => {
    expect(
      findStays([pt(0, 30, 120), pt(10, 30, 120), pt(15, 31, 120)]),
    ).toEqual([])
  })
})

describe('privacy zones', () => {
  it('moves the center but keeps the real place inside the circle', () => {
    const home = { lat: 30.27, lng: 120.15 }
    for (const r of [0, 0.5, 0.99]) {
      const z = offsetZoneCenter(home, 1000, () => r)
      const zone = { id: 'z', name: '家', ...z.center, radiusM: z.radiusM }
      expect(distanceM(home, z.center)).toBeLessThanOrEqual(1000 / 3 + 1)
      expect(inZone(home, [zone])).toBe(true)
    }
    const z = offsetZoneCenter(home, 1000, () => 0)
    expect(
      inZone({ lat: 30.3, lng: 120.15 }, [
        { id: 'z', name: '家', ...z.center, radiusM: z.radiusM },
      ]),
    ).toBe(false) // 3 公里外
  })
})

describe('GPX', () => {
  it('reads timed track points and skips ones without time', () => {
    const xml = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lat="30.1" lon="120.2"><ele>10</ele><time>2026-11-01T02:00:00Z</time></trkpt>
  <trkpt lon="120.3" lat="30.2"><time>2026-11-01T01:00:00Z</time></trkpt>
  <trkpt lat="30.3" lon="120.4"></trkpt>
  <trkpt lat="999" lon="120.4"><time>2026-11-01T03:00:00Z</time></trkpt>
</trkseg></trk>
<wpt lat="30.5" lon="120.5"><time>2026-11-01T04:00:00Z</time><name>x</name></wpt>
</gpx>`
    const pts = parseGpx(xml)
    expect(pts.map((p) => [p.lat, p.lng])).toEqual([
      [30.2, 120.3],
      [30.1, 120.2],
      [30.5, 120.5],
    ])
    expect(pts[0].src).toBe('gpx')
  })
})

describe('transport and paths', () => {
  it('guesses transport from speed', () => {
    expect(guessBySpeed(4)).toBe('walk')
    expect(guessBySpeed(15)).toBe('bike')
    expect(guessBySpeed(60)).toBe('car')
    expect(guessBySpeed(250)).toBe('train')
    expect(guessBySpeed(600)).toBe('plane')
  })

  it('drops points that lie on a straight line', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({
      lat: 30 + i * 0.001,
      lng: 120,
    }))
    expect(simplifyPath(line)).toHaveLength(2)
  })

  const rec = (id: string, min: number, lat: number, lng: number) => ({
    id,
    takenAt: min * MIN,
    location: { lat, lng },
  })

  it('follows the track between two records and guesses the speed', () => {
    // 1 小时走了约 4.4 公里：步行
    const track = [10, 20, 30, 40, 50].map((m, i) =>
      pt(m, 30 + i * 0.008, 120 + (i % 2) * 0.004),
    )
    const r = tripPaths([rec('a', 0, 30, 120), rec('b', 60, 30.04, 120)], track)
    expect(r.segments[0].path.length).toBeGreaterThan(2)
    expect(r.segments[0].transport).toBe('walk')
    expect(r.segments[0].guessed).toBe(true)
  })

  it('calls a long gap in the track a flight, by the Polarsteps rule', () => {
    const track = [pt(-60, 30.27, 120.15)] // 有轨迹，但起飞后没有点
    const r = tripPaths(
      [rec('a', 0, 30.27, 120.15), rec('b', 180, 39.9, 116.4)], // 3 小时 1100 公里
      track,
    )
    expect(r.segments[0]).toMatchObject({ transport: 'plane', long: true })
  })

  it('does not guess a flight without any track (photos are too sparse)', () => {
    const r = tripPaths(
      [rec('a', 0, 30.27, 120.15), rec('b', 180, 39.9, 116.4)],
      [],
    )
    expect(r.segments[0]).toMatchObject({ transport: null, long: true })
  })

  it('lets the user override the guess', () => {
    const r = tripPaths(
      [
        rec('a', 0, 30.27, 120.15),
        { ...rec('b', 300, 31.23, 121.47), transport: 'train' as const },
      ],
      [],
    )
    expect(r.segments[0]).toMatchObject({
      recordId: 'b',
      transport: 'train',
      guessed: false,
    })
  })
})

describe('which stays to ask about', () => {
  const stay = { start: 60 * MIN, end: 100 * MIN, lat: 30, lng: 120 }
  it('skips stays already recorded, or dismissed', () => {
    const near = { takenAt: 70 * MIN, location: { lat: 30.0005, lng: 120 } }
    const elsewhere = { takenAt: 70 * MIN, location: { lat: 31, lng: 120 } }
    expect(uncoveredStays([stay], [near], [])).toEqual([])
    expect(uncoveredStays([stay], [elsewhere], [])).toEqual([stay])
    expect(uncoveredStays([stay], [], [stay.start])).toEqual([])
  })
})
