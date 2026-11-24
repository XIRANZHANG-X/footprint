import { describe, expect, it } from 'vitest'
import type { TrackEvent } from '../db.ts'
import { findings, sessionHealth, sessions } from './trackHealth.ts'

// 决策 0030：记录体检
const T0 = new Date('2026-11-25T08:00').getTime()
const min = (m: number) => T0 + m * 60_000
const ev = (
  m: number,
  e: TrackEvent['ev'],
  bat: number,
  extra: Partial<TrackEvent> = {},
): TrackEvent => ({
  t: min(m),
  ev: e,
  bat,
  chg: false,
  scr: false,
  precise: false,
  prov: 'gps:on,network:on',
  ...extra,
})

describe('track checkup', () => {
  it('splits sessions and knows how each ended', () => {
    const g = sessions(
      [
        ev(0, 'start', 90),
        ev(15, 'hb', 90),
        ev(30, 'stop', 89),
        ev(60, 'start', 89), // 这次没收到结束就又开始了
        ev(75, 'hb', 88),
        ev(120, 'start', 87),
        ev(135, 'hb', 87),
      ],
      true,
    )
    expect(g.map((x) => x.endedBy)).toEqual(['stop', 'unknown', 'running'])
  })

  it('finds gaps from heartbeats and points, and when the system stopped it', () => {
    const events = [
      ev(0, 'start', 90),
      ev(15, 'hb', 90),
      ev(30, 'hb', 89),
      // 30 → 120 没有心跳，但 60 有一个轨迹点：断档只算 60 → 120
      ev(120, 'hb', 87),
      ev(135, 'hb', 87),
      ev(200, 'lost', 85),
    ]
    const [g] = sessions(events, false)
    const h = sessionHealth(
      g,
      [{ t: min(60), acc: 30, src: 'network' }],
      min(300),
    )
    expect(h.endedBy).toBe('lost')
    expect(h.gaps).toEqual([{ from: min(60), to: min(120) }])
    expect(h.lostAfter).toBe(min(135))
    expect(h.end).toBe(min(135))
    const text = findings(h).map((f) => f.text)
    expect(text.some((x) => x.includes('之后被系统停了'))).toBe(true)
    expect(text.some((x) => x.includes('断了 60 分钟'))).toBe(true)
  })

  it('counts battery only while the screen is off and not charging', () => {
    const events = [
      ev(0, 'start', 100),
      ev(15, 'hb', 100, { scr: true }), // 亮屏：不算
      ev(30, 'hb', 97, { scr: true }),
      ev(45, 'hb', 97),
      ev(60, 'hb', 97),
      ev(75, 'hb', 96),
      ev(90, 'hb', 96),
      ev(105, 'hb', 96),
      ev(120, 'hb', 95),
      ev(135, 'hb', 99, { chg: true }), // 充电：不算
      ev(150, 'stop', 99),
    ]
    const [g] = sessions(events, false)
    const h = sessionHealth(g, [], min(200))
    // 45→120 共 75 分钟锁屏，掉 2%
    expect(h.idleHours).toBeCloseTo(1.25)
    expect(h.idleDrainPerHour).toBeCloseTo(1.6)
    expect(
      findings(h).some(
        (f) => f.level === 'warn' && f.text.includes('一天 38%'),
      ),
    ).toBe(true)
  })

  it('flags a phone without network location in saving mode, and an ongoing gap', () => {
    const events = [
      ev(0, 'start', 80, { prov: 'gps:on,network:none' }),
      ev(15, 'hb', 80, { prov: 'gps:on,network:none' }),
    ]
    const [g] = sessions(events, true)
    const h = sessionHealth(g, [], min(180))
    expect(h.networkMissing).toBe(true)
    expect(h.gaps).toEqual([{ from: min(15), to: min(180) }])
    const text = findings(h).map((f) => f.text)
    expect(text.some((x) => x.includes('没有网络定位'))).toBe(true)
    expect(text.some((x) => x.includes('一个点都没有'))).toBe(true)
  })

  it('says all good when nothing is wrong', () => {
    const events = [ev(0, 'start', 80), ev(15, 'hb', 80), ev(30, 'stop', 80)]
    const [g] = sessions(events, false)
    const h = sessionHealth(g, [{ t: min(10), acc: 20, src: 'gps' }], min(40))
    expect(findings(h)[0]).toEqual({ level: 'ok', text: '没有断档' })
    expect(h.bySource).toEqual({ gps: 1 })
  })
})
