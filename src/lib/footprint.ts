import type { JournalRecord, VisitedPlace } from '../db.ts'
import { cityOf, countryName } from './geo/area.ts'
import { shortPlace } from './review.ts'
import { tripPaths } from './route.ts'
import type { TrackPoint } from './track.ts'
import { groupTrips } from './trips.ts'
import { distanceM } from './visits.ts'

// 地图页顶部的"足迹总览"（决策 0020 第 4、5 条）。纯计算，打开地图页时算。
// 补的以前去过的地方只计入国家数、城市数，不计入里程和离家最远

export type Home = { name: string; lat: number; lng: number }
export const HOME_KEY = 'home'

export type Footprint = {
  countries: { cc: string; name: string }[]
  cities: number
  km: number
  farthest: { name: string; km: number } | null
  added: number
}

export function footprint(
  records: JournalRecord[],
  visited: VisitedPlace[],
  home: Home | null,
  track: TrackPoint[] = [],
): Footprint {
  const ccs = new Set<string>()
  const cities = new Set<string>()
  for (const r of records) {
    if (r.area?.cc) ccs.add(r.area.cc)
    const c = cityOf(r)
    if (c) cities.add(c)
  }
  for (const v of visited) {
    if (v.cc) ccs.add(v.cc)
    if (v.city) cities.add(v.city)
  }
  // 有轨迹的出行按轨迹算里程（决策 0022 第 7 条），没有的按记录之间的直线
  const km = groupTrips(records).reduce(
    (n, t) =>
      n +
      tripPaths(
        t.records,
        track.filter((p) => p.t >= t.start && p.t <= t.end),
      ).km,
    0,
  )
  let farthest: Footprint['farthest'] = null
  if (home)
    for (const r of records) {
      if (!r.location) continue
      const d = distanceM(home, r.location) / 1000
      if (d > (farthest?.km ?? 0))
        farthest = {
          name: cityOf(r) ?? shortPlace(r.placeName) ?? '一个没有地名的地方',
          km: d,
        }
    }
  return {
    countries: [...ccs]
      .map((cc) => ({ cc, name: countryName(cc) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    cities: cities.size,
    km,
    farthest,
    added: visited.length,
  }
}
