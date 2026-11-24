import {
  MAX_PLACE_CANDIDATES,
  type Boundary,
  type Geocode,
  type PlaceCandidate,
} from '../shared/ai.ts'
import { inChinaRough } from '../shared/gcj02.ts'
import { amapBoundary, amapReverse, amapSearch } from './amap.ts'
import {
  nominatimBoundary,
  reverseGeocode as nominatimReverse,
  searchPlaces as nominatimSearch,
} from './geocode.ts'

// 地名服务的分派（决策 0021）：国内用高德，国外用 Nominatim。
// 没配高德的 key（AMAP_WEB_KEY）或高德出错时，全部退回 Nominatim，和换高德之前一样。

const reverseCache = new Map<string, Geocode>()
const searchCache = new Map<string, PlaceCandidate[]>()
const boundaryCache = new Map<string, Boundary>()

export async function placeName(
  amapKey: string | undefined,
  lat: number,
  lng: number,
): Promise<Geocode> {
  if (amapKey && inChinaRough({ lat, lng })) {
    const k = `${lat.toFixed(4)},${lng.toFixed(4)}`
    const hit = reverseCache.get(k)
    if (hit) return hit
    try {
      const g = await amapReverse(amapKey, lat, lng)
      if (g) {
        reverseCache.set(k, g)
        return g
      }
      // 高德说这里不是中国（矩形边上的邻国）：交给 Nominatim
    } catch (e) {
      console.error(e)
    }
  }
  return nominatimReverse(lat, lng)
}

// 两边一起查：高德的排前面（国内的店名、行政区更全），再补 Nominatim 里国外的结果。
// 搜"京都"时高德只有叫"京都"的国内酒店，国外的京都要靠 Nominatim
export async function findPlaces(
  amapKey: string | undefined,
  q: string,
): Promise<PlaceCandidate[]> {
  const k = q.trim().toLowerCase()
  const hit = searchCache.get(k)
  if (hit) return hit
  const [domestic, world] = await Promise.all([
    amapKey
      ? amapSearch(amapKey, q.trim(), MAX_PLACE_CANDIDATES).catch((e) => {
          console.error(e)
          return null
        })
      : Promise.resolve(null),
    nominatimSearch(q).catch((e) => {
      console.error(e)
      return [] as PlaceCandidate[]
    }),
  ])
  const list =
    domestic === null
      ? world
      : [
          ...domestic.slice(0, 3),
          ...world.filter((c) => c.cc !== 'CN'),
          ...domestic.slice(3),
        ].slice(0, MAX_PLACE_CANDIDATES)
  searchCache.set(k, list)
  return list
}

// 编号：6 位数字是高德的行政区代码，N/W/R 开头是 OpenStreetMap 的编号
export async function findBoundary(
  amapKey: string | undefined,
  id: string,
): Promise<Boundary> {
  const hit = boundaryCache.get(id)
  if (hit) return hit
  let b: Boundary
  if (/^\d{6}$/.test(id)) {
    if (!amapKey) return { name: null, shape: [] }
    b = await amapBoundary(amapKey, id)
  } else b = await nominatimBoundary(id)
  // 坐标留 5 位小数（约 1 米），JSON 能小一半
  b = {
    name: b.name,
    shape: b.shape.map((poly) =>
      poly.map((ring) => ring.map((x) => Math.round(x * 1e5) / 1e5)),
    ),
  }
  boundaryCache.set(id, b)
  return b
}
