import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'

// 当时的天气（决策 0025）。Open-Meteo 的回复是假的
const app = createApp({ requireAccessToken: false })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/weather', () => {
  it('picks the hour closest to the photo, in local time', async () => {
    const urls: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        urls.push(new URL(String(input)))
        return Response.json({
          utc_offset_seconds: 8 * 3600, // 北京时间
          hourly: {
            time: ['2026-11-01T13:00', '2026-11-01T14:00', '2026-11-01T15:00'],
            temperature_2m: [17.5, 18.2, 18.9],
            weather_code: [3, 61, 61],
          },
        })
      }),
    )
    // 北京时间 14:10 = UTC 06:10
    const t = Date.UTC(2026, 10, 1, 6, 10)
    const res = await app.request(
      `/api/weather?lat=30.25&lng=120.15&t=${t}`,
      {},
      {},
    )
    expect(await res.json()).toEqual({ tempC: 18.2, code: 61 })
    expect(urls[0].searchParams.get('timezone')).toBe('auto')
  })

  it('uses the archive for old dates and rejects nonsense', async () => {
    const urls: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        urls.push(new URL(String(input)))
        return Response.json({ hourly: { time: [] } })
      }),
    )
    const old = Date.UTC(2020, 5, 1, 4)
    const res = await app.request(
      `/api/weather?lat=30&lng=120&t=${old}`,
      {},
      {},
    )
    expect(await res.json()).toEqual({ tempC: null, code: null })
    expect(urls[0].host).toBe('archive-api.open-meteo.com')
    expect(
      (await app.request('/api/weather?lat=95&lng=120&t=1', {}, {})).status,
    ).toBe(400)
  })
})
