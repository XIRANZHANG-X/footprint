import { gcj02ToWgs84, wgs84ToGcj02 } from '../shared/gcj02.ts'
import type { Geocode, PlaceCandidate, PlaceKind } from '../shared/ai.ts'
import { simplifyShape, type Shape } from '../shared/simplify.ts'

// 高德 Web 服务（决策 0021）：国内的地名、地点搜索、行政区边界。
// key 只在服务端（环境变量 AMAP_WEB_KEY），App 里看不到。
// 高德的坐标是 GCJ-02；进来前把 WGS-84 换过去，出去前换回 WGS-84，App 只见到 WGS-84。

const BASE = 'https://restapi.amap.com/v3'

export class AmapError extends Error {}

// 高德的空字段是 []，不是空字符串
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

async function amap(
  key: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE}/${path}`)
  url.search = new URLSearchParams({ ...params, key }).toString()
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new AmapError(`高德返回 ${res.status}`)
  const j = (await res.json()) as Record<string, unknown>
  // status 为 "1" 才是成功；失败时 info 里是原因（比如 key 不对、超出配额）
  if (j.status !== '1')
    throw new AmapError(`高德：${str(j.info) || '请求失败'}`)
  return j
}

const parseLngLat = (s: string) => {
  const [lng, lat] = s.split(',').map(Number)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lat, lng } : null
}

// ---------- 坐标查地名 ----------

type RegeoPoi = { name?: unknown; distance?: unknown }

// 返回 null 表示不在国内（高德说这里不是中国），交给 Nominatim
export async function amapReverse(
  key: string,
  lat: number,
  lng: number,
): Promise<Geocode | null> {
  const g = wgs84ToGcj02({ lat, lng })
  const j = await amap(key, 'geocode/regeo', {
    location: `${g.lng.toFixed(6)},${g.lat.toFixed(6)}`,
    extensions: 'all',
    radius: '100',
  })
  const r = (j.regeocode ?? {}) as Record<string, unknown>
  const a = (r.addressComponent ?? {}) as Record<string, unknown>
  if (str(a.country) !== '中国') return null
  const province = str(a.province)
  // 直辖市的 city 是空的，省一级就是城市
  const city = str(a.city) || province || null
  const street = (a.streetNumber ?? {}) as Record<string, unknown>
  // 地名：50 米内最近的地点（店、景点）；没有就用所在的区域（小区、园区、景区），也没有就只给地址
  const pois = (Array.isArray(r.pois) ? r.pois : []) as RegeoPoi[]
  const near = pois
    .map((p) => ({ name: str(p.name), d: Number(p.distance) }))
    .filter((p) => p.name && Number.isFinite(p.d) && p.d <= 50)
    .sort((x, y) => x.d - y.d)[0]
  const aois = (Array.isArray(r.aois) ? r.aois : []) as RegeoPoi[]
  const aoi = aois.map((p) => str(p.name)).find(Boolean)
  const parts = [
    city,
    str(a.district),
    str(a.township) || str(street.street),
  ].filter((p): p is string => Boolean(p))
  return {
    name: near?.name || aoi || null,
    address: parts.length
      ? [...new Set(parts)].join(' · ')
      : str(r.formatted_address) || null,
    city,
  }
}

// ---------- 地名查地点 ----------

const LEVEL_KIND: Record<string, PlaceKind> = {
  country: 'country',
  province: 'province',
  city: 'city',
  district: 'district',
}

type District = {
  name?: unknown
  adcode?: unknown
  center?: unknown
  level?: unknown
  polyline?: unknown
}

// 行政区（省、市、区县）和地点（店、景点）都查，行政区排前面：搜"杭州"多半是要杭州市
export async function amapSearch(
  key: string,
  q: string,
  limit: number,
): Promise<PlaceCandidate[]> {
  const [d, p] = await Promise.all([
    amap(key, 'config/district', {
      keywords: q,
      subdistrict: '0',
      extensions: 'base',
    }).catch(() => ({ districts: [] })),
    amap(key, 'place/text', {
      keywords: q,
      offset: String(limit),
      page: '1',
      extensions: 'base',
    }).catch(() => ({ pois: [] })),
  ])
  const out: PlaceCandidate[] = []
  for (const x of (Array.isArray(d.districts)
    ? d.districts
    : []) as District[]) {
    const kind = LEVEL_KIND[str(x.level)]
    const center = parseLngLat(str(x.center))
    if (!kind || !center) continue
    const w = gcj02ToWgs84(center)
    out.push({
      name: str(x.name) || null,
      address: null,
      lat: w.lat,
      lng: w.lng,
      kind,
      cc: 'CN',
      boundary: kind === 'country' ? null : str(x.adcode) || null,
    })
  }
  type Poi = {
    name?: unknown
    address?: unknown
    location?: unknown
    pname?: unknown
    cityname?: unknown
    adname?: unknown
  }
  for (const x of (Array.isArray(p.pois) ? p.pois : []) as Poi[]) {
    const loc = parseLngLat(str(x.location))
    if (!loc) continue
    const w = gcj02ToWgs84(loc)
    const area = [str(x.cityname) || str(x.pname), str(x.adname)].filter(
      Boolean,
    )
    out.push({
      name: str(x.name) || null,
      address:
        [...new Set(area)].join(' · ') +
          (str(x.address) ? ` · ${str(x.address)}` : '') || null,
      lat: w.lat,
      lng: w.lng,
      kind: 'poi',
      cc: 'CN',
      boundary: null,
    })
  }
  return out.slice(0, limit)
}

// ---------- 行政区边界 ----------

// 约 500 米：点亮城市、判断"在不在这个地方"都够用
export const BOUNDARY_TOLERANCE = 0.005

export async function amapBoundary(
  key: string,
  adcode: string,
): Promise<{ name: string | null; shape: Shape }> {
  const j = await amap(key, 'config/district', {
    keywords: adcode,
    subdistrict: '0',
    extensions: 'all',
  })
  const d = ((Array.isArray(j.districts) ? j.districts : []) as District[])[0]
  if (!d) return { name: null, shape: [] }
  // 多块之间用 | 分开（比如带岛屿的市），每块是 "经度,纬度;经度,纬度;…"
  const shape: Shape = str(d.polyline)
    .split('|')
    .map((part) => {
      const ring: number[] = []
      for (const pt of part.split(';')) {
        const p = parseLngLat(pt)
        if (!p) continue
        const w = gcj02ToWgs84(p)
        ring.push(w.lng, w.lat)
      }
      return [ring]
    })
  return {
    name: str(d.name) || null,
    shape: simplifyShape(shape, BOUNDARY_TOLERANCE),
  }
}
