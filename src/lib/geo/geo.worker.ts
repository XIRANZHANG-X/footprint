/// <reference lib="webworker" />
import {
  decodeRegions,
  locate,
  type EncodedFile,
  type Region,
  type Ring,
} from './pip.ts'

// 行政边界的后台线程（决策 0016 第 5 条）：几 MB 的边界数据在这里读取、解码、判断点在哪个区域，
// 不占界面线程，手机上滑动、点按不会卡一下。界面要画点亮的区域时，只把用得到的那几个形状传回去

const BASE = import.meta.env.BASE_URL

type Admin1 = Region & { en: string; cc: string }

async function load<T>(path: string) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`读取 ${path} 失败（${r.status}）`)
  return decodeRegions((await r.json()) as EncodedFile<T>)
}

let admin1: Promise<Admin1[]> | null = null
let counties: Promise<Region[]> | null = null
// 失败了允许下次再试
const getAdmin1 = () =>
  (admin1 ??= load<{ n: string; en: string; cc: string }>(
    'geo/admin1.json',
  ).catch((e: unknown) => {
    admin1 = null
    throw e
  }))
const getCounties = () =>
  (counties ??= load<{ n: string }>('geo/cn-counties.json').catch(
    (e: unknown) => {
      counties = null
      throw e
    },
  ))

export type LocatedArea = {
  cc: string
  admin1: string
  a1: number
  county: number | null
}

export type GeoRequest =
  | { id: number; op: 'locate'; points: { lat: number; lng: number }[] }
  | { id: number; op: 'shapes'; a1: number[]; cn: number[] }
  // 全部省州的名字（不带形状），给"补以前去过的地方"的列表用（决策 0020 第 6 条）
  | { id: number; op: 'names' }

export type Admin1Name = { index: number; n: string; en: string; cc: string }

export type Shape = { index: number; g: Ring[][] }

export type GeoResponse =
  | { id: number; areas: (LocatedArea | null)[] }
  | { id: number; a1: Shape[]; cn: Shape[] }
  | { id: number; names: Admin1Name[] }
  | { id: number; error: string }

async function handle(req: GeoRequest): Promise<GeoResponse> {
  if (req.op === 'names') {
    const regions = await getAdmin1()
    return {
      id: req.id,
      names: regions.map((r, index) => ({ index, n: r.n, en: r.en, cc: r.cc })),
    }
  }
  if (req.op === 'locate') {
    const regions = await getAdmin1()
    const needChina = req.points.map((p) => {
      const i = locate(regions, p.lat, p.lng)
      return i < 0 ? null : i
    })
    const cn = needChina.some((i) => i !== null && regions[i].cc === 'CN')
      ? await getCounties()
      : []
    return {
      id: req.id,
      areas: req.points.map((p, k) => {
        const i = needChina[k]
        if (i === null) return null
        const r = regions[i]
        let county: number | null = null
        if (r.cc === 'CN') {
          const c = locate(cn, p.lat, p.lng)
          county = c < 0 ? null : c
        }
        return { cc: r.cc, admin1: r.n || r.en, a1: i, county }
      }),
    }
  }
  const [a1, cn] = await Promise.all([
    req.a1.length ? getAdmin1() : Promise.resolve([]),
    req.cn.length ? getCounties() : Promise.resolve([]),
  ])
  const pick = (list: Region[], idx: number[]) =>
    idx.flatMap((index) => (list[index] ? [{ index, g: list[index].g }] : []))
  return { id: req.id, a1: pick(a1, req.a1), cn: pick(cn, req.cn) }
}

self.onmessage = async (e: MessageEvent<GeoRequest>) => {
  try {
    self.postMessage(await handle(e.data))
  } catch (err) {
    self.postMessage({
      id: e.data.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies GeoResponse)
  }
}
