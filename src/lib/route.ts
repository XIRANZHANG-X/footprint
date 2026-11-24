import type { LatLng } from './photoMeta.ts'
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
