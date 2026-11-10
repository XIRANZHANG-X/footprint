import { db } from '../db.ts'
import { geocode, placeLabel } from './ai.ts'
import type { LatLng } from './photoMeta.ts'
import type { TripBreak } from './trips.ts'

// 用户在地图上点选地点（用于"待定位"的记录，也可以纠正 GPS 不准的记录）。
// 地名查询失败不影响保存坐标。
export async function setRecordLocation(recordId: string, location: LatLng) {
  await db.records.update(recordId, {
    location,
    locationStatus: 'manual',
    placeName: null,
  })
  try {
    const g = await geocode(location.lat, location.lng)
    const placeName = placeLabel(g)
    await db.records.update(recordId, { placeName })
  } catch {
    // 留着坐标，界面上显示经纬度
  }
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
