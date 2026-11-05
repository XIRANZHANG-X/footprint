import { Dexie, type EntityTable } from 'dexie'
import type { LatLng, TimeSource } from './lib/photoMeta.ts'
import type { LocationStatus } from './lib/record.ts'

export type JournalRecord = {
  id: string
  createdAt: number
  takenAt: number
  timeSource: TimeSource
  location: LatLng | null
  locationStatus: LocationStatus
  photoCount: number
}

export type StoredPhoto = {
  id: string
  recordId: string
  order: number
  takenAt: number
  timeSource: TimeSource
  location: LatLng | null
  width: number
  height: number
  blob: Blob
  thumb: Blob
}

// 所有数据只存在本机的 IndexedDB 里（决策 0002：服务端不存用户数据）
export const db = new Dexie('footprint-journal') as Dexie & {
  records: EntityTable<JournalRecord, 'id'>
  photos: EntityTable<StoredPhoto, 'id'>
}

db.version(1).stores({
  // 只列需要查询的字段；Blob 等其他字段照样会存，只是不建索引
  records: 'id, takenAt',
  photos: 'id, recordId',
})
