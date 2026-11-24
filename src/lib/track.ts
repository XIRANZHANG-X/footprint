import type { LatLng } from './photoMeta.ts'
import { distanceM } from './visits.ts'

// 轨迹（决策 0022）：后台记下的点、导入的 GPX。只存在手机里。
// 这里都是纯计算：隐私区过滤、按时间找位置、找停留、读 GPX、猜交通方式、简化折线。

export type TrackPoint = {
  id?: number
  t: number // 毫秒时间戳
  lat: number
  lng: number
  acc: number | null // 精度（米），GPX 没有
  src: string // gps / network / passive / gpx
}

// ---------- 隐私区（决策 0022 第 3 条） ----------

export type PrivacyZone = {
  id: string
  name: string
  lat: number // 存的是随机偏移过的圆心
  lng: number
  radiusM: number
}
export const ZONES_KEY = 'privacyZones'
export const ZONE_RADII = [300, 1000, 2000]

// 圆心随机偏移不超过半径的三分之一：别人不能从圈推出确切位置；
// 半径同时放大同样的距离，保证真实位置仍然在圈里
export function offsetZoneCenter(
  center: LatLng,
  radiusM: number,
  rand: () => number = Math.random,
): { center: LatLng; radiusM: number } {
  const d = (radiusM / 3) * rand()
  const angle = 2 * Math.PI * rand()
  const dLat = (d * Math.cos(angle)) / 111_320
  const dLng =
    (d * Math.sin(angle)) / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  return {
    center: { lat: center.lat + dLat, lng: center.lng + dLng },
    radiusM: radiusM + d,
  }
}

export const inZone = (p: LatLng, zones: PrivacyZone[]) =>
  zones.some((z) => distanceM(p, z) <= z.radiusM)

// ---------- 按时间找位置（决策 0022 第 4 条） ----------

export const NEAR_MS = 10 * 60_000
export const GAP_MS = 30 * 60_000

// 点要按时间排好序。前后 10 分钟内有点就用最近的；
// 前后都有点、相隔不超过 30 分钟，就按时间插值；都没有返回 null
export function locateAt(points: TrackPoint[], t: number): LatLng | null {
  if (points.length === 0) return null
  // 二分找第一个不早于 t 的点
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const after = points[lo]
  const before = points[lo - 1]
  const near = [before, after]
    .filter((p): p is TrackPoint => Boolean(p))
    .map((p) => ({ p, d: Math.abs(p.t - t) }))
    .sort((a, b) => a.d - b.d)[0]
  if (near && near.d <= NEAR_MS) return { lat: near.p.lat, lng: near.p.lng }
  if (before && after && after.t - before.t <= GAP_MS) {
    const k = (t - before.t) / (after.t - before.t)
    return {
      lat: before.lat + (after.lat - before.lat) * k,
      lng: before.lng + (after.lng - before.lng) * k,
    }
  }
  return null
}

// ---------- 停留（决策 0022 第 5 条） ----------

export type Stay = { start: number; end: number; lat: number; lng: number }
export const STAY_RADIUS_M = 150
export const STAY_MIN_MS = 20 * 60_000

// 从一个点开始，后面的点都在 150 米内，持续 20 分钟以上，就是一次停留。中心取这些点的平均
export function findStays(points: TrackPoint[]): Stay[] {
  const out: Stay[] = []
  let i = 0
  while (i < points.length) {
    let j = i + 1
    while (
      j < points.length &&
      distanceM(points[i], points[j]) <= STAY_RADIUS_M
    )
      j++
    const last = points[j - 1]
    if (last.t - points[i].t >= STAY_MIN_MS) {
      const group = points.slice(i, j)
      out.push({
        start: points[i].t,
        end: last.t,
        lat: group.reduce((n, p) => n + p.lat, 0) / group.length,
        lng: group.reduce((n, p) => n + p.lng, 0) / group.length,
      })
      i = j
    } else i++
  }
  return out
}

// 那段时间前后半小时内、200 米以内有记录，就算已经记过了；按时间倒序，最多 3 个
const COVER_MS = 30 * 60_000
const COVER_M = 200
const MAX_STAYS = 3

export function uncoveredStays(
  stays: Stay[],
  records: { takenAt: number; location: LatLng | null }[],
  dismissed: number[],
): Stay[] {
  return stays
    .filter(
      (s) =>
        !dismissed.includes(s.start) &&
        !records.some(
          (r) =>
            r.location &&
            r.takenAt >= s.start - COVER_MS &&
            r.takenAt <= s.end + COVER_MS &&
            distanceM(r.location, s) <= COVER_M,
        ),
    )
    .sort((a, b) => b.start - a.start)
    .slice(0, MAX_STAYS)
}

// ---------- GPX（决策 0022 第 6 条） ----------

// 只读轨迹点和路点里带时间的；没有时间的点没法给照片补位置，不要
export function parseGpx(xml: string): TrackPoint[] {
  const out: TrackPoint[] = []
  const re = /<(trkpt|rtept|wpt)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
  for (const m of xml.matchAll(re)) {
    const attrs = m[2]
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1])
    const lng = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1])
    const time = /<time>\s*([^<]+?)\s*<\/time>/.exec(m[3] ?? '')?.[1]
    const t = time ? Date.parse(time) : NaN
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      Number.isFinite(t)
    )
      out.push({ t, lat, lng, acc: null, src: 'gpx' })
  }
  return out.sort((a, b) => a.t - b.t)
}

// ---------- 交通方式（决策 0022 第 7 条） ----------

export const TRANSPORTS = [
  'walk',
  'bike',
  'car',
  'train',
  'plane',
  'boat',
] as const
export type Transport = (typeof TRANSPORTS)[number]
export const TRANSPORT_LABEL: Record<Transport, string> = {
  walk: '🚶 步行',
  bike: '🚲 骑行',
  car: '🚗 开车或公交',
  train: '🚄 火车',
  plane: '✈️ 飞机',
  boat: '⛴️ 坐船',
}

// 按平均速度（公里/时）猜
export function guessBySpeed(kmh: number): Transport {
  if (kmh < 7) return 'walk'
  if (kmh < 20) return 'bike'
  if (kmh < 120) return 'car'
  if (kmh < 300) return 'train'
  return 'plane'
}

// 轨迹断了很远时的飞机判断：Polarsteps 的规则（≥ 200 公里且 > 100 公里/时，或 > 1500 公里）。
// 只在有轨迹的时候用：没有轨迹时照片太稀，速度不可靠（决策 0020 第 2 条）
export const looksLikeFlight = (km: number, hours: number) =>
  km > 1500 || (km >= 200 && hours > 0 && km / hours > 100)

// ---------- 简化折线（画轨迹用） ----------

// 道格拉斯-普克，按米算（约 30 米）。轨迹一天可能上千个点，画之前先简化
export function simplifyPath(points: LatLng[], toleranceM = 30): LatLng[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1
    let bestD = toleranceM
    for (let i = a + 1; i < b; i++) {
      const d = offLine(points[i], points[a], points[b])
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

// 点到线段的距离（米），在局部平面上近似
function offLine(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((a.lat * Math.PI) / 180) * 111_320
  const ax = a.lng * k
  const ay = a.lat * 111_320
  const dx = b.lng * k - ax
  const dy = b.lat * 111_320 - ay
  const px = p.lng * k - ax
  const py = p.lat * 111_320 - ay
  const len2 = dx * dx + dy * dy
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
  return Math.hypot(px - t * dx, py - t * dy)
}

export function pathKm(points: LatLng[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++)
    m += distanceM(points[i - 1], points[i])
  return m / 1000
}
