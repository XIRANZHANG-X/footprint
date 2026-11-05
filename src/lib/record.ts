import type { LatLng, PhotoMeta, TimeSource } from './photoMeta.ts'

export type LocationStatus = 'gps' | 'pending'

export type RecordSummary = {
  takenAt: number
  timeSource: TimeSource
  location: LatLng | null
  locationStatus: LocationStatus
}

// 一次导入的照片组成一条记录（"在某个地方的一次停留"）。
// 时间取最早的一张；地点取最早一张带 GPS 的照片，都没有就标为"待定位"，P3 在地图上补。
export function summarizeRecord(photos: PhotoMeta[]): RecordSummary {
  if (photos.length === 0) throw new Error('记录至少需要一张照片')
  const sorted = [...photos].sort((a, b) => a.takenAt - b.takenAt)
  // 只要有一张照片带拍摄时间，就用带拍摄时间的照片里最早的那张，不让不可靠的文件时间抢先
  const withExifTime = sorted.filter((p) => p.timeSource === 'exif')
  const timeRef = withExifTime[0] ?? sorted[0]
  const location = sorted.find((p) => p.location !== null)?.location ?? null
  return {
    takenAt: timeRef.takenAt,
    timeSource: timeRef.timeSource,
    location,
    locationStatus: location ? 'gps' : 'pending',
  }
}
