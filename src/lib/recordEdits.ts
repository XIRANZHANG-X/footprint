import { db } from '../db.ts'
import { geocode, placeLabel } from './ai.ts'
import type { LatLng } from './photoMeta.ts'
import type { TripBreak } from './trips.ts'

// 用户在地图上点选地点（用于"待定位"的记录，也可以纠正 GPS 不准的记录）。
// 地名查询失败不影响保存坐标。
// status 为 track：位置是按拍摄时间从轨迹里找到的（决策 0022 第 4 条）
export async function setRecordLocation(
  recordId: string,
  location: LatLng,
  status: 'manual' | 'track' = 'manual',
) {
  await db.records.update(recordId, {
    location,
    locationStatus: status,
    placeName: null,
    // 换了地方，城市要重新定（undefined 在 Dexie 里等于删掉这个字段）
    geoCity: undefined,
  })
  try {
    const g = await geocode(location.lat, location.lng)
    const placeName = placeLabel(g)
    await db.records.update(recordId, {
      placeName,
      ...(g.city !== undefined ? { geoCity: g.city } : {}),
    })
  } catch {
    // 留着坐标，界面上显示经纬度
  }
}

// 用户从候选里选了一个地点（当天去过的地方，或按地名查到的结果）：地名和坐标一起写上，记录就上地图了。
// placeName 为 null 时只有坐标，走"在地图上点一下"的同一条路去查地名
export function applyPlace(
  recordId: string,
  place: { location: LatLng; placeName: string | null },
) {
  if (place.placeName === null)
    return setRecordLocation(recordId, place.location)
  return db.records.update(recordId, {
    location: place.location,
    locationStatus: 'manual',
    placeName: place.placeName,
    // 城市由后台从地名里拆（决策 0014 第 3C 条）
    geoCity: undefined,
  })
}

// 查不到坐标时只存地名文字，记录留在"待定位"里（决策 0013 第 3 条）
export function setPlaceNameOnly(recordId: string, name: string) {
  return db.records.update(recordId, { placeName: name.trim() || null })
}

// 编辑页里改时间、改地名（决策 0013）。地名只改文字，坐标不动；清空地名后卡片显示经纬度或"待定位"
export function setRecordDetails(
  recordId: string,
  details: { takenAt: number | null; placeName: string },
) {
  return db.transaction('rw', db.records, async () => {
    const record = await db.records.get(recordId)
    if (!record) return
    const placeName = details.placeName.trim() || null
    await db.records.update(recordId, {
      ...(placeName !== record.placeName ? { placeName } : {}),
      // 时间没动就不改来源：照片的拍摄时间仍然标成"来自照片"
      ...(details.takenAt !== null && details.takenAt !== record.takenAt
        ? { takenAt: details.takenAt, timeSource: 'manual' as const }
        : {}),
    })
  })
}

export function setTripBreak(recordId: string, tripBreak: TripBreak) {
  return db.records.update(recordId, { tripBreak })
}
