import type { LatLng } from './photoMeta.ts'

// 给没有定位的记录准备的"当天去过的地点"（决策 0013 第 2 条）。
// placeName 为 null 表示只有坐标（例如后来加进来的照片自带的 GPS），选中后再去查地名
export type PlaceOption = {
  key: string
  label: string
  location: LatLng
  placeName: string | null
}

type Located = {
  id: string
  takenAt: number
  location: LatLng | null
  placeName: string | null
}

const sameLocalDay = (a: number, b: number) =>
  new Date(a).toDateString() === new Date(b).toDateString()

const coords = (l: LatLng) => `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`
// 约 11 米以内算同一个地方，不重复列出
const spot = (l: LatLng) => `${l.lat.toFixed(4)},${l.lng.toFixed(4)}`

export function sameDayPlaces(
  record: { id: string; takenAt: number },
  others: Located[],
  ownPhotos: { location: LatLng | null }[] = [],
): PlaceOption[] {
  const options: PlaceOption[] = []
  const seen = new Set<string>()
  const add = (o: PlaceOption) => {
    const k = spot(o.location)
    if (seen.has(k)) return
    seen.add(k)
    options.push(o)
  }

  // 这条记录自己的照片里带的定位排最前：它最可能就是这条记录的地点
  for (const p of ownPhotos)
    if (p.location)
      add({
        key: `photo:${spot(p.location)}`,
        label: `照片里的位置（${coords(p.location)}）`,
        location: p.location,
        placeName: null,
      })

  // 同一天的其他记录，离这条记录时间最近的排前面
  const sameDay = others
    .filter(
      (r) =>
        r.id !== record.id &&
        r.location !== null &&
        sameLocalDay(r.takenAt, record.takenAt),
    )
    .sort(
      (a, b) =>
        Math.abs(a.takenAt - record.takenAt) -
        Math.abs(b.takenAt - record.takenAt),
    )
  for (const r of sameDay)
    if (r.location)
      add({
        key: `record:${r.id}`,
        label: r.placeName ?? coords(r.location),
        location: r.location,
        placeName: r.placeName,
      })

  return options
}
