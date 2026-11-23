import { db, type JournalRecord } from '../../db.ts'
import { areaKey, GEO_VERSION, needsGeo, type Area } from './area.ts'
import {
  cityFromPlaceName,
  cityNames,
  cluesToCities,
  type AdminItem,
  type ClueCity,
  type PrefixTable,
} from './cnTables.ts'
import { locate, type Region } from './pip.ts'

// 行政边界和查表数据都是几 MB 的静态文件（决策 0014），只在需要时加载一次。
// 这个模块本身也是按需 import 的，不进首屏代码。

const BASE = import.meta.env.BASE_URL

export type Admin1Region = Region & { en: string; cc: string }

const cache = new Map<string, Promise<unknown>>()
function load<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${BASE}${path}`).then((r) => {
      if (!r.ok) throw new Error(`读取 ${path} 失败（${r.status}）`)
      return r.json()
    })
    // 失败了允许下次再试
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

export const loadAdmin1 = () =>
  load<{ features: Admin1Region[] }>('geo/admin1.json').then((d) => d.features)
export const loadCounties = () =>
  load<{ features: Region[] }>('geo/cn-counties.json').then((d) => d.features)
const loadAdmin = () =>
  load<{ items: AdminItem[] }>('data/cn/admin.json').then((d) => d.items)
const loadPhones = () => load<PrefixTable>('data/cn/area_codes.json')
const loadPlates = () => load<PrefixTable>('data/cn/plates.json')

let cities: Promise<Set<string>> | null = null
const cityNameSet = () => (cities ??= loadAdmin().then(cityNames))

export async function locateArea(
  lat: number,
  lng: number,
): Promise<Area | null> {
  const admin1 = await loadAdmin1()
  const i = locate(admin1, lat, lng)
  if (i < 0) return null
  const r = admin1[i]
  let county: number | null = null
  if (r.cc === 'CN') {
    const c = locate(await loadCounties(), lat, lng)
    county = c < 0 ? null : c
  }
  return {
    key: areaKey({ lat, lng }),
    gv: GEO_VERSION,
    cc: r.cc,
    admin1: r.n || r.en,
    a1: i,
    county,
  }
}

let running: Promise<void> | null = null

// 给有坐标的记录补上所在区域和城市名（旧记录一次补齐，新记录随时补）。
// 只写 area、geoCity 两个字段，用 modify 读最新值再写，不会盖掉同时发生的编辑
export function backfillGeo(): Promise<void> {
  running ??= (async () => {
    try {
      const todo = (await db.records.toArray()).filter(needsGeo)
      if (todo.length === 0) return
      const names = await cityNameSet()
      for (const r of todo) {
        const loc = r.location!
        const fresh = await db.records.get(r.id)
        if (!fresh || !needsGeo(fresh)) continue
        const area =
          fresh.area &&
          fresh.area.gv === GEO_VERSION &&
          fresh.area.key === areaKey(loc)
            ? fresh.area
            : await locateArea(loc.lat, loc.lng)
        await db.records
          .where('id')
          .equals(r.id)
          .modify((x: JournalRecord) => {
            // 坐标在这期间又被改了：下一轮再算
            if (!x.location || areaKey(x.location) !== areaKey(loc)) return
            x.area = area
            x.geoCity ??=
              area?.cc === 'CN' ? cityFromPlaceName(x.placeName, names) : null
          })
      }
    } finally {
      running = null
    }
  })()
  return running
}

// "补地点"里的"照片线索指向的城市"：AI 原稿里抄下来的电话和车牌，查表得出城市
export async function clueCities(record: JournalRecord): Promise<ClueCity[]> {
  const clues = record.aiDraft?.clues
  if (!clues || (clues.phones.length === 0 && clues.plates.length === 0))
    return []
  const [phones, plates] = await Promise.all([loadPhones(), loadPlates()])
  return cluesToCities(clues, phones, plates)
}
