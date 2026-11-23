import type { LatLng } from '../photoMeta.ts'

// 记录所在的行政区（决策 0014 第 3C 条）。由坐标在本地的边界数据里算出来，
// 存在记录上，坐标或边界数据版本变了就重算（见 regions.ts 的 backfillGeo）。
export type Area = {
  key: string // 算这个结果时用的坐标（4 位小数），坐标改了就对不上，要重算
  gv: number // 边界数据版本，见 GEO_VERSION
  cc: string // 国家或地区代码（ISO 3166-1 两位字母）
  admin1: string // 省、州一级的中文名（Natural Earth 没有中文名时用英文名）
  a1: number // admin1 在 public/geo/admin1.json 里的序号，地图点亮时用
  county: number | null // 中国的区县在 public/geo/cn-counties.json 里的序号；国外为 null
}

// public/geo 下的边界文件重新生成（scripts/prepare_assets.mjs --force）后，
// 序号可能变化，这里要加 1，旧记录会自动重算
export const GEO_VERSION = 1

export const areaKey = (l: LatLng) => `${l.lat.toFixed(4)},${l.lng.toFixed(4)}`

type Located = {
  location: LatLng | null
  area?: Area | null
  geoCity?: string | null
}

// 有坐标、但还没算过所在区域（或者坐标、数据版本变了），或者城市名还没确定
export function needsGeo(r: Located): boolean {
  if (!r.location) return false
  if (r.geoCity === undefined) return true
  if (r.area === undefined) return true
  if (r.area === null) return false // 算过了，在海上等不属于任何区域的地方
  return r.area.gv !== GEO_VERSION || r.area.key !== areaKey(r.location)
}

// 香港、澳门、新加坡这类地方，Natural Earth 的省级是更小的区，城市直接用地区名
const CITY_STATES = new Set(['HK', 'MO', 'SG', 'MC', 'VA', 'SM', 'LI', 'BH'])

// 浏览器自带的地区名有的太长（"中国香港特别行政区"），卡片标签上用短名
const SHORT_NAMES: Record<string, string> = {
  HK: '香港',
  MO: '澳门',
  TW: '台湾',
}

let regionNames: Intl.DisplayNames | null = null
export function countryName(cc: string): string {
  if (SHORT_NAMES[cc]) return SHORT_NAMES[cc]
  try {
    regionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' })
    return regionNames.of(cc) ?? cc
  } catch {
    return cc
  }
}

// "第几次来杭州"和统计用的城市名。中国用地级市（来自地名查询，或从地名里拆出来），
// 拿不到时退回省级（直辖市本身就是省级）；国外用省、州一级。没有坐标或还没算出区域时为 null
export function cityOf(r: Located): string | null {
  if (!r.location || !r.area) return null
  if (CITY_STATES.has(r.area.cc)) return countryName(r.area.cc)
  if (r.area.cc === 'CN') return r.geoCity || r.area.admin1
  return r.area.admin1
}
