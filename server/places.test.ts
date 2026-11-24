import { afterEach, describe, expect, it, vi } from 'vitest'
import { wgs84ToGcj02 } from '../shared/gcj02.ts'
import { simplifyRing } from '../shared/simplify.ts'
import { distanceM } from '../src/lib/visits.ts'
import { createApp } from './app.ts'

// 地名服务分派到高德或 Nominatim（决策 0021）。fetch 全部是假的，不连高德、不连 Nominatim
const app = createApp({ requireAccessToken: false })
const KEY = 'amap-test-key-not-real'
const ENV = { AMAP_WEB_KEY: KEY }

type Route = (url: URL) => unknown
function stubFetch(route: Route) {
  const calls: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      calls.push(url)
      return Response.json(route(url))
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// 一个杭州的点，和它在高德里的 GCJ-02 坐标
const HZ = { lat: 30.2741, lng: 120.1551 }
const HZ_GCJ = wgs84ToGcj02(HZ)

describe('reverse geocoding in China goes to Amap', () => {
  it('sends GCJ-02 coordinates and names the nearest shop within 50 m', async () => {
    const calls = stubFetch(() => ({
      status: '1',
      regeocode: {
        formatted_address: '浙江省杭州市西湖区北山街道',
        addressComponent: {
          country: '中国',
          province: '浙江省',
          city: '杭州市',
          district: '西湖区',
          township: '北山街道',
          streetNumber: { street: [], number: [] },
        },
        pois: [
          { name: '远一点的店', distance: '80' },
          { name: '知味观', distance: '12' },
        ],
        aois: [],
      },
    }))
    const res = await app.request(
      `/api/geocode?lat=${HZ.lat + 0.00001}&lng=${HZ.lng}`,
      {},
      ENV,
    )
    expect(await res.json()).toEqual({
      name: '知味观',
      address: '杭州市 · 西湖区 · 北山街道',
      city: '杭州市',
    })
    expect(calls[0].host).toBe('restapi.amap.com')
    expect(calls[0].searchParams.get('key')).toBe(KEY)
    const [lng, lat] = calls[0].searchParams.get('location')!.split(',')
    expect(distanceM({ lat: +lat, lng: +lng }, HZ_GCJ)).toBeLessThan(5)
  })

  it('uses the province as the city in Beijing/Shanghai (city is an empty list)', async () => {
    stubFetch(() => ({
      status: '1',
      regeocode: {
        addressComponent: {
          country: '中国',
          province: '上海市',
          city: [],
          district: '黄浦区',
          township: '外滩街道',
        },
        pois: [],
        aois: [{ name: '外滩' }],
      },
    }))
    const res = await app.request(
      '/api/geocode?lat=31.2401&lng=121.4901',
      {},
      ENV,
    )
    expect(await res.json()).toEqual({
      name: '外滩',
      address: '上海市 · 黄浦区 · 外滩街道',
      city: '上海市',
    })
  })

  it('falls back to Nominatim when Amap fails or there is no key', async () => {
    const calls = stubFetch((url) =>
      url.host === 'restapi.amap.com'
        ? { status: '0', info: 'INVALID_USER_KEY' }
        : { name: '某地', address: { city: '杭州市' } },
    )
    const res = await app.request(
      '/api/geocode?lat=30.2801&lng=120.1601',
      {},
      ENV,
    )
    expect(await res.json()).toMatchObject({ name: '某地', city: '杭州市' })
    expect(calls.map((u) => u.host)).toEqual([
      'restapi.amap.com',
      'nominatim.openstreetmap.org',
    ])
    const noKey = stubFetch(() => ({ name: '某地', address: {} }))
    await app.request('/api/geocode?lat=30.2901&lng=120.1701', {}, {})
    expect(noKey.map((u) => u.host)).toEqual(['nominatim.openstreetmap.org'])
  })

  it('never calls Amap for places outside China', async () => {
    const calls = stubFetch(() => ({ name: 'Tokyo', address: {} }))
    await app.request('/api/geocode?lat=35.6812&lng=139.7671', {}, ENV)
    expect(calls.every((u) => u.host === 'nominatim.openstreetmap.org')).toBe(
      true,
    )
  })
})

describe('place search merges Amap and Nominatim', () => {
  it('puts Amap districts and POIs first, converted back to WGS-84, then foreign results', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/config/district'))
        return {
          status: '1',
          districts: [
            {
              name: '杭州市',
              adcode: '330100',
              level: 'city',
              center: `${HZ_GCJ.lng},${HZ_GCJ.lat}`,
            },
          ],
        }
      if (url.pathname.endsWith('/place/text'))
        return {
          status: '1',
          pois: [
            {
              name: '杭州东站',
              address: '天城路1号',
              location: `${HZ_GCJ.lng},${HZ_GCJ.lat}`,
              cityname: '杭州市',
              adname: '上城区',
            },
          ],
        }
      return [
        {
          name: 'Hangzhou',
          lat: '30.27',
          lon: '120.15',
          addresstype: 'city',
          osm_type: 'relation',
          osm_id: 1,
          address: { country_code: 'cn' },
        },
        {
          name: '杭州（日本的同名地方）',
          lat: '35.0',
          lon: '135.0',
          addresstype: 'city',
          osm_type: 'relation',
          osm_id: 42,
          address: { country_code: 'jp' },
        },
      ]
    })
    const res = await app.request('/api/geocode/search?q=杭州', {}, ENV)
    const { results } = (await res.json()) as {
      results: Record<string, unknown>[]
    }
    expect(results.map((r) => [r.name, r.kind, r.boundary])).toEqual([
      ['杭州市', 'city', '330100'],
      ['杭州东站', 'poi', null],
      ['杭州（日本的同名地方）', 'city', 'R42'],
    ])
    // 中心点换回了 WGS-84
    expect(
      distanceM(results[0] as { lat: number; lng: number }, HZ),
    ).toBeLessThan(5)
    expect(results[1].address).toBe('杭州市 · 上城区 · 天城路1号')
  })
})

describe('boundaries', () => {
  it('simplifies an Amap polyline and converts it to WGS-84', async () => {
    // 一个约 1 公里见方、边上有很多点的正方形（GCJ-02）
    const pts: string[] = []
    for (let i = 0; i <= 100; i++) pts.push(`${120 + i * 0.0001},30`)
    for (let i = 0; i <= 100; i++) pts.push(`120.01,${30 + i * 0.0001}`)
    for (let i = 100; i >= 0; i--) pts.push(`${120 + i * 0.0001},30.01`)
    pts.push('120,30')
    const calls = stubFetch(() => ({
      status: '1',
      districts: [{ name: '某区', polyline: pts.join(';') }],
    }))
    const res = await app.request('/api/geocode/boundary?id=330106', {}, ENV)
    const b = (await res.json()) as { name: string; shape: number[][][] }
    expect(b.name).toBe('某区')
    expect(b.shape).toHaveLength(1)
    const ring = b.shape[0][0]
    expect(ring.length / 2).toBeLessThan(10) // 直线上的点都去掉了
    // 换回 WGS-84 以后，和原来的 GCJ-02 差几百米
    expect(
      distanceM({ lng: ring[0], lat: ring[1] }, { lng: 120, lat: 30 }),
    ).toBeGreaterThan(100)
    expect(calls[0].searchParams.get('extensions')).toBe('all')
  })

  it('rejects malformed ids', async () => {
    stubFetch(() => ({}))
    for (const id of ['', 'abc', '12345', 'X123', '3301001'])
      expect(
        (await app.request(`/api/geocode/boundary?id=${id}`, {}, ENV)).status,
      ).toBe(400)
  })
})

describe('ring simplification', () => {
  it('keeps the corners of a closed ring', () => {
    const ring = [0, 0, 0.5, 0, 1, 0, 1, 0.5, 1, 1, 0.5, 1, 0, 1, 0, 0.5, 0, 0]
    expect(simplifyRing(ring, 0.01)).toEqual([0, 0, 1, 0, 1, 1, 0, 1, 0, 0])
  })
})
