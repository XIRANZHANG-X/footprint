// 中国的行政区划、固话区号、车牌前缀三张表（借自 geo-sleuth，决策 0014 补充）。
// 文件在 public/data/cn/，来源和协议见同目录 README.md。这里只有不依赖浏览器的查表逻辑，方便测试。

export type AdminItem = {
  name: string
  code: string
  level: number
  parent: string
}
export type Place = { admin1: string; admin2?: string }
export type PrefixTable = { entries: Record<string, Place[]> }

export const DIRECT_CITIES = new Set(['北京市', '上海市', '天津市', '重庆市'])

// 地名文字里拆出地级市：只认行政区划表里真有的名字，拆不出来就是 null。
// 能处理 "店名（杭州市 · 西湖区 · 某路）"、"杭州市 · 西湖区"、"西湖, 杭州市, 浙江省" 这几种写法
export function cityFromPlaceName(
  placeName: string | null,
  cities: Set<string>,
): string | null {
  if (!placeName) return null
  const inner = /（(.+)）/.exec(placeName)?.[1] ?? placeName
  const tokens = inner.split(/\s*[·,，、]\s*/).map((t) => t.trim())
  return tokens.find((t) => cities.has(t)) ?? null
}

// 地级市和直辖市的名字集合
export function cityNames(items: AdminItem[]): Set<string> {
  return new Set(
    items
      .filter(
        (i) => i.level === 2 || (i.level === 1 && DIRECT_CITIES.has(i.name)),
      )
      .map((i) => i.name),
  )
}

const placeLabel = (p: Place) => p.admin2 ?? p.admin1

// 固话区号：只取数字，去掉国家码 86，补上开头的 0，再找最长的前缀。
// 手机号（1 开头 11 位）、400/800 电话没有地区信息，直接跳过
export function lookupPhone(phone: string, table: PrefixTable): Place[] {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('86') && d.length > 11) d = d.slice(2)
  if (/^1\d{10}$/.test(d) || /^[48]00/.test(d)) return []
  if (!d.startsWith('0')) d = `0${d}`
  for (let len = Math.min(4, d.length); len >= 3; len--) {
    const hit = table.entries[d.slice(0, len)]
    if (hit) return hit
  }
  return []
}

// 车牌：去掉空格、点和横线，转大写，先找"省份简称 + 字母"，没有再只找省份简称
export function lookupPlate(plate: string, table: PrefixTable): Place[] {
  const p = plate.replace(/[\s·•.-]/g, '').toUpperCase()
  if (!/^[一-鿿]/.test(p)) return []
  return table.entries[p.slice(0, 2)] ?? table.entries[p.slice(0, 1)] ?? []
}

export type ClueCity = { city: string; via: string }

// 照片里读到的电话和车牌 → 指向的城市。一个前缀对应几个地方时全部列出；同一个城市只列一次
export function cluesToCities(
  clues: { phones: string[]; plates: string[] },
  phones: PrefixTable,
  plates: PrefixTable,
): ClueCity[] {
  const out = new Map<string, ClueCity>()
  for (const ph of clues.phones)
    for (const p of lookupPhone(ph, phones))
      if (!out.has(placeLabel(p)))
        out.set(placeLabel(p), { city: placeLabel(p), via: `电话 ${ph}` })
  for (const pl of clues.plates)
    for (const p of lookupPlate(pl, plates))
      if (!out.has(placeLabel(p)))
        out.set(placeLabel(p), { city: placeLabel(p), via: `车牌 ${pl}` })
  return [...out.values()]
}
