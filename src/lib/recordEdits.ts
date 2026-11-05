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

export function setTripBreak(recordId: string, tripBreak: TripBreak) {
  return db.records.update(recordId, { tripBreak })
}
