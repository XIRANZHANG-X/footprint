import type { LatLng } from './photoMeta.ts'

// "第几次来"（决策 0014 第 3C 条）：
// - 坐标相距 SAME_PLACE_M 米以内算同一个地方
// - 按"不同的日子"计次：同一天在同一个地方的几条记录算 1 次
// - 城市一级只标"第一次来"：这个城市最早的那条记录
// 没有坐标的记录不参与。

export const SAME_PLACE_M = 100

export type Visitable = { id: string; takenAt: number; location: LatLng | null }

export type VisitInfo = {
  place: number // 这个地方的序号（同一地方的记录相同），给地图和回顾用
  visit: number // 第几次来这个地方（1 = 第一次）
  firstInCity: string | null // 这是第一次来这个城市的第一条记录时，为城市名
}

export type PlaceGroup = {
  index: number
  lat: number
  lng: number
  days: string[] // 去过的日子（本地日期），按时间正序
  recordIds: string[]
}

const R = 6_371_000
export function distanceM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function computeVisits<T extends Visitable>(
  records: T[],
  cityOf: (r: T) => string | null,
): { visits: Map<string, VisitInfo>; places: PlaceGroup[] } {
  const sorted = records
    .filter((r) => r.location)
    .sort((a, b) => a.takenAt - b.takenAt)
  const places: PlaceGroup[] = []
  const seenCities = new Set<string>()
  const visits = new Map<string, VisitInfo>()
  for (const r of sorted) {
    const loc = r.location!
    // 同一地方取最早建立的那一处作为中心，不随后来的记录漂移
    let place = places.find((p) => distanceM(p, loc) <= SAME_PLACE_M)
    if (!place) {
      place = { index: places.length, ...loc, days: [], recordIds: [] }
      places.push(place)
    }
    const day = localDay(r.takenAt)
    if (place.days.at(-1) !== day) place.days.push(day)
    place.recordIds.push(r.id)
    const city = cityOf(r)
    const firstInCity = city !== null && !seenCities.has(city) ? city : null
    if (city !== null) seenCities.add(city)
    visits.set(r.id, {
      place: place.index,
      visit: place.days.length,
      firstInCity,
    })
  }
  return { visits, places }
}

// 卡片上的小标签："第一次来" / "第 3 次来"
export function visitLabel(v: VisitInfo): string {
  return v.visit === 1 ? '第一次来' : `第 ${v.visit} 次来`
}
