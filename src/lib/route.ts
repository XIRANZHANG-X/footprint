import type { LatLng } from './photoMeta.ts'
import {
  guessBySpeed,
  looksLikeFlight,
  pathKm,
  simplifyPath,
  type TrackPoint,
  type Transport,
} from './track.ts'
import { distanceM, SAME_PLACE_M } from './visits.ts'

// 一次出行的路线（决策 0020 第 1、2 条）：有位置的记录按时间连起来。
// 连着几条在同一个地方（100 米内）只算一个点。超过 LONG_SEGMENT_KM 的一段画成弧线，
// 表示"这段是跳过去的，中间没有记录"，不判断是飞机还是高铁（照片太稀，算出来的速度不可靠）。

export const LONG_SEGMENT_KM = 300

export type RouteSegment = {
  from: LatLng
  to: LatLng
  km: number
  long: boolean
}
export type Route = { points: LatLng[]; segments: RouteSegment[]; km: number }

export function tripRoute(
  records: { takenAt: number; location: LatLng | null }[],
): Route {
  const points: LatLng[] = []
  for (const r of [...records].sort((a, b) => a.takenAt - b.takenAt)) {
    if (!r.location) continue
    const last = points.at(-1)
    if (last && distanceM(last, r.location) <= SAME_PLACE_M) continue
    points.push(r.location)
  }
  const segments = points.slice(1).map((to, i) => {
    const from = points[i]
    const km = distanceM(from, to) / 1000
    return { from, to, km, long: km > LONG_SEGMENT_KM }
  })
  return { points, segments, km: segments.reduce((n, s) => n + s.km, 0) }
}

// 弧线上的点：二次贝塞尔曲线，往前进方向的左边鼓出去（去程、回程两条不会叠在一起）。
// 跨越 180 度经线时，终点的经度加减 360 度，走近的那一边；Leaflet 能画超出 ±180 的经度
export function arcPoints(from: LatLng, to: LatLng, steps = 24): LatLng[] {
  let toLng = to.lng
  if (toLng - from.lng > 180) toLng -= 360
  else if (from.lng - toLng > 180) toLng += 360
  const dx = toLng - from.lng
  const dy = to.lat - from.lat
  // 鼓出去的高度是直线长度的 0.2 倍；(-dy, dx) 是前进方向左边的法线
  const cx = (from.lng + toLng) / 2 - dy * 0.2
  const cy = (from.lat + to.lat) / 2 + dx * 0.2
  const out: LatLng[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push({
      lng: u * u * from.lng + 2 * u * t * cx + t * t * toLng,
      lat: u * u * from.lat + 2 * u * t * cy + t * t * to.lat,
    })
  }
  return out
}

// "约 120 公里"：不到 1 公里不显示，10 公里以内留一位小数
export function formatKm(km: number): string | null {
  if (km < 1) return null
  return `约 ${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('zh-CN')} 公里`
}

// ---------- 有轨迹时（决策 0022 第 7 条） ----------

// 一次出行里每两条记录之间的一段：有轨迹点就沿轨迹走、按速度猜交通方式；
// 轨迹断了很远就按 Polarsteps 的规则判飞机；整次出行都没有轨迹时和 tripRoute 一样（只按距离画弧线）。
// 用户改过的交通方式存在后一条记录上，以用户的为准
export type PathSegment = {
  recordId: string // 这一段终点的那条记录（交通方式存在它上面）
  from: LatLng
  to: LatLng
  path: LatLng[]
  km: number
  transport: Transport | null
  guessed: boolean
  long: boolean
}

type Stop = {
  id: string
  takenAt: number
  location: LatLng | null
  transport?: Transport | null
}

export function tripPaths(
  records: Stop[],
  track: TrackPoint[],
): { segments: PathSegment[]; km: number } {
  const stops: (Stop & { location: LatLng })[] = []
  for (const r of [...records].sort((a, b) => a.takenAt - b.takenAt)) {
    if (!r.location) continue
    const last = stops.at(-1)
    if (last && distanceM(last.location, r.location) <= SAME_PLACE_M) continue
    stops.push(r as Stop & { location: LatLng })
  }
  const hasTrack = track.length > 0
  const segments = stops.slice(1).map((b, i): PathSegment => {
    const a = stops[i]
    const hours = Math.max(0, b.takenAt - a.takenAt) / 3_600_000
    const between = track.filter((p) => p.t > a.takenAt && p.t < b.takenAt)
    const user = b.transport ?? null
    let seg: Omit<PathSegment, 'recordId'>
    if (between.length >= 2) {
      const path = simplifyPath([a.location, ...between, b.location])
      const km = pathKm(path)
      seg = {
        from: a.location,
        to: b.location,
        path,
        km,
        transport: hours > 0 ? guessBySpeed(km / hours) : null,
        guessed: true,
        long: false,
      }
    } else {
      const km = distanceM(a.location, b.location) / 1000
      const flight = hasTrack && looksLikeFlight(km, hours)
      const long = flight || km > LONG_SEGMENT_KM
      seg = {
        from: a.location,
        to: b.location,
        path: long
          ? arcPoints(a.location, b.location)
          : [a.location, b.location],
        km,
        transport: flight ? 'plane' : null,
        guessed: true,
        long,
      }
    }
    if (user) {
      seg.transport = user
      seg.guessed = false
      if (user === 'plane' && !seg.long) {
        seg.long = true
        seg.path = arcPoints(seg.from, seg.to)
      }
    }
    return { ...seg, recordId: b.id }
  })
  return { segments, km: segments.reduce((n, s) => n + s.km, 0) }
}
