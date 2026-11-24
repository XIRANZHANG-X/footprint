import {
  MAX_PLACE_CANDIDATES,
  type Geocode,
  type PlaceCandidate,
  type PlaceKind,
} from '../shared/ai.ts'
import { simplifyShape, type Shape } from '../shared/simplify.ts'

// Nominatim（OpenStreetMap）：坐标查地名，地名查坐标。使用政策要求：
// 带可识别的 User-Agent、每秒最多 1 次请求、结果要缓存。
// https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = 'footprint-journal/0.1 (self-hosted personal journal)'
const MIN_INTERVAL_MS = 1100

const cache = new Map<string, Geocode>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

// 坐标保留 4 位小数（约 11 米）作为缓存键：同一家店的几张照片只查一次
export function cacheKey(lat: number, lng: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

// 所在城市（决策 0014 第 3C 条）。中国的 OSM 数据里地级市一般在 city，有时在 state_district；
// 直辖市只有 state（"上海市"）。都没有时用 town / county，仍然没有就是 null
function cityOf(a: Record<string, string>): string | null {
  return (
    a.city ??
    a.state_district ??
    (a.state?.endsWith('市') ? a.state : undefined) ??
    a.town ??
    a.county ??
    null
  )
}

type NominatimResult = {
  name?: string
  display_name?: string
  address?: Record<string, string>
}

export function formatNominatim(r: NominatimResult): Geocode {
  const a = r.address ?? {}
  // 中文地址从大到小拼：城市 + 区 + 街道/社区
  const parts = [
    a.city ?? a.town ?? a.county ?? a.state,
    a.city_district ?? a.district ?? a.suburb,
    a.road ?? a.neighbourhood,
  ].filter((p): p is string => Boolean(p))
  const address = parts.length ? [...new Set(parts)].join(' · ') : null
  return {
    name: r.name?.trim() || null,
    address: address ?? r.display_name ?? null,
    city: cityOf(a),
  }
}

async function nominatim(
  path: 'reverse' | 'search' | 'lookup',
  params: Record<string, string>,
): Promise<unknown> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`)
  url.search = new URLSearchParams({
    format: 'jsonv2',
    'accept-language': 'zh-CN,zh,en',
    ...params,
  }).toString()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Nominatim 返回 ${res.status}`)
  return res.json()
}

// 两种查询共用一个队列：串行排队，保证全局不超过每秒 1 次
function queued<T>(run: () => Promise<T>): Promise<T> {
  const job = queue.then(run)
  queue = job.catch(() => undefined)
  return job
}

export function reverseGeocode(lat: number, lng: number): Promise<Geocode> {
  const key = cacheKey(lat, lng)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  return queued(async () =>
    formatNominatim(
      (await nominatim('reverse', {
        lat: String(lat),
        lon: String(lng),
        zoom: '18',
      })) as NominatimResult,
    ),
  ).then((g) => {
    cache.set(key, g)
    return g
  })
}

type NominatimSearchResult = NominatimResult & {
  lat?: string
  lon?: string
  addresstype?: string
  osm_type?: string
  osm_id?: number
}

// Nominatim 的地点类型 → 我们的五级（决策 0020）
const NOMINATIM_KIND: Record<string, PlaceKind> = {
  country: 'country',
  state: 'province',
  province: 'province',
  region: 'province',
  city: 'city',
  municipality: 'city',
  county: 'district',
  district: 'district',
  city_district: 'district',
}

// 搜索结果 → 候选。坐标缺失或不是数字的条目丢掉
export function formatCandidates(raw: unknown): PlaceCandidate[] {
  if (!Array.isArray(raw)) return []
  return (raw as NominatimSearchResult[])
    .map((r) => {
      // 候选里不带城市：PlaceCandidate 只有名称、地址和坐标
      const { name, address } = formatNominatim(r)
      const kind = NOMINATIM_KIND[r.addresstype ?? ''] ?? 'poi'
      const osm =
        r.osm_type && r.osm_id
          ? `${r.osm_type[0].toUpperCase()}${r.osm_id}`
          : null
      return {
        name,
        address,
        lat: Number(r.lat),
        lng: Number(r.lon),
        kind,
        cc: r.address?.country_code?.toUpperCase() ?? null,
        // 只有行政区（关系 R）才取边界：店、景点的边界没意义
        boundary: kind !== 'poi' && osm?.startsWith('R') ? osm : null,
      } satisfies PlaceCandidate
    })
    .filter(
      (c) =>
        inRange(c.lat, 90) &&
        inRange(c.lng, 180) &&
        (c.name !== null || c.address !== null),
    )
    .slice(0, MAX_PLACE_CANDIDATES)
}

const inRange = (n: number, max: number) =>
  Number.isFinite(n) && Math.abs(n) <= max

const searchCache = new Map<string, PlaceCandidate[]>()

// 按地名查坐标（决策 0013 第 3 条）。国内的小店大多查不到，景点和地标一般可以
export function searchPlaces(query: string): Promise<PlaceCandidate[]> {
  const key = query.trim().toLowerCase()
  const hit = searchCache.get(key)
  if (hit) return Promise.resolve(hit)
  return queued(async () =>
    formatCandidates(
      await nominatim('search', {
        q: query.trim(),
        addressdetails: '1',
        limit: String(MAX_PLACE_CANDIDATES),
      }),
    ),
  ).then((list) => {
    searchCache.set(key, list)
    return list
  })
}

// 国外行政区的边界（决策 0020 第 6 条）：按 OpenStreetMap 编号取，让 Nominatim 先简化到约 500 米
const boundaryCache = new Map<string, { name: string | null; shape: Shape }>()

type GeoJson =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: string; coordinates?: unknown }

export function nominatimBoundary(
  osm: string,
): Promise<{ name: string | null; shape: Shape }> {
  const hit = boundaryCache.get(osm)
  if (hit) return Promise.resolve(hit)
  return queued(async () => {
    const raw = (await nominatim('lookup', {
      osm_ids: osm,
      polygon_geojson: '1',
      polygon_threshold: '0.005',
    })) as (NominatimResult & { geojson?: GeoJson })[]
    const r = Array.isArray(raw) ? raw[0] : undefined
    const g = r?.geojson
    const polys: number[][][][] =
      g?.type === 'Polygon'
        ? [(g as { coordinates: number[][][] }).coordinates]
        : g?.type === 'MultiPolygon'
          ? (g as { coordinates: number[][][][] }).coordinates
          : []
    // GeoJSON 的点是 [经度, 纬度] 数组，平铺成 [经度, 纬度, 经度, 纬度, …]
    const shape: Shape = polys.map((poly) =>
      poly.map((ring) => ring.flatMap(([lng, lat]) => [lng, lat])),
    )
    return {
      name: r?.name?.trim() || null,
      shape: simplifyShape(shape, 0.005),
    }
  }).then((b) => {
    boundaryCache.set(osm, b)
    return b
  })
}
