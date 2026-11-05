import type { Geocode } from '../shared/ai.ts'

// Nominatim（OpenStreetMap）逆地理编码。使用政策要求：
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
  }
}

async function fetchOnce(lat: number, lng: number): Promise<Geocode> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '18',
    'accept-language': 'zh-CN,zh,en',
  }).toString()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Nominatim 返回 ${res.status}`)
  return formatNominatim((await res.json()) as NominatimResult)
}

export function reverseGeocode(lat: number, lng: number): Promise<Geocode> {
  const key = cacheKey(lat, lng)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  // 串行排队，保证全局不超过每秒 1 次
  const job = queue.then(() => fetchOnce(lat, lng))
  queue = job.catch(() => undefined)
  return job.then((g) => {
    cache.set(key, g)
    return g
  })
}
