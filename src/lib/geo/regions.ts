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
import type {
  GeoRequest,
  GeoResponse,
  LocatedArea,
  Shape,
} from './geo.worker.ts'
import { decodeRegions, type EncodedFile } from './pip.ts'

// 行政边界和查表数据（决策 0014），只在需要时加载。这个模块本身也是按需 import 的，不进首屏代码。
// 几 MB 的边界数据交给后台线程（geo.worker.ts，决策 0016 第 5 条），这里只发问题、收答案；
// 一百多 KB 的查表数据和离线底图的轮廓在这里直接读

const BASE = import.meta.env.BASE_URL

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

const loadAdmin = () =>
  load<{ items: AdminItem[] }>('data/cn/admin.json').then((d) => d.items)
const loadPhones = () => load<PrefixTable>('data/cn/area_codes.json')
const loadPlates = () => load<PrefixTable>('data/cn/plates.json')

let cities: Promise<Set<string>> | null = null
const cityNameSet = () => (cities ??= loadAdmin().then(cityNames))

// ---------- 后台线程 ----------

type Request =
  | { op: 'locate'; points: { lat: number; lng: number }[] }
  | { op: 'shapes'; a1: number[]; cn: number[] }

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<
  number,
  { resolve: (r: GeoResponse) => void; reject: (e: Error) => void }
>()

function ask(req: Request): Promise<GeoResponse> {
  if (!worker) {
    worker = new Worker(new URL('./geo.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent<GeoResponse>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if ('error' in e.data) w.reject(new Error(e.data.error))
      else w.resolve(e.data)
    }
    worker.onerror = (e) => {
      for (const w of waiting.values())
        w.reject(new Error(e.message || '读取边界数据出错'))
      waiting.clear()
      worker?.terminate()
      worker = null
    }
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ ...req, id } satisfies GeoRequest)
  })
}

// 一批坐标各在哪个区域，一次问完
export async function locateMany(
  points: { lat: number; lng: number }[],
): Promise<(LocatedArea | null)[]> {
  if (points.length === 0) return []
  const r = await ask({ op: 'locate', points })
  return 'areas' in r ? r.areas : []
}

// 地图点亮时只要用得到的那几个形状（决策 0014 第 3D 条）
export async function regionShapes(
  a1: number[],
  cn: number[],
): Promise<{ a1: Shape[]; cn: Shape[] }> {
  const r = await ask({ op: 'shapes', a1, cn })
  return 'a1' in r ? { a1: r.a1, cn: r.cn } : { a1: [], cn: [] }
}

// 离线底图用的省州轮廓（精简得很狠，两 MB），只在在线瓦片加载失败时用
export const loadOutline = () =>
  load<EncodedFile<object>>('geo/admin1-lite.json').then(decodeRegions)

// ---------- 补算记录的区域和城市 ----------

let running: Promise<void> | null = null

// 给有坐标的记录补上所在区域和城市名（旧记录一次补齐，新记录随时补）。
// 只写 area、geoCity 两个字段，用 modify 读最新值再写，不会盖掉同时发生的编辑
export function backfillGeo(): Promise<void> {
  running ??= (async () => {
    try {
      const todo = (await db.records.toArray()).filter(needsGeo)
      if (todo.length === 0) return
      // 坐标变了或数据版本变了的才需要重新判断区域
      const relocate = todo.filter(
        (r) =>
          !r.area ||
          r.area.gv !== GEO_VERSION ||
          r.area.key !== areaKey(r.location!),
      )
      const [names, located] = await Promise.all([
        cityNameSet(),
        locateMany(relocate.map((r) => r.location!)),
      ])
      const fresh = new Map(
        relocate.map((r, i) => {
          const a = located[i]
          const area: Area | null = a
            ? { ...a, key: areaKey(r.location!), gv: GEO_VERSION }
            : null
          return [r.id, area]
        }),
      )
      for (const r of todo) {
        const loc = r.location!
        await db.records
          .where('id')
          .equals(r.id)
          .modify((x: JournalRecord) => {
            // 坐标在这期间又被改了：下一轮再算
            if (!x.location || areaKey(x.location) !== areaKey(loc)) return
            if (fresh.has(r.id)) x.area = fresh.get(r.id)
            x.geoCity ??=
              x.area?.cc === 'CN' ? cityFromPlaceName(x.placeName, names) : null
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
