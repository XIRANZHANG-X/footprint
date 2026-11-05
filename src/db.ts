import { Dexie, type EntityTable } from 'dexie'
import type { Description } from '../shared/ai.ts'
import type { LatLng, TimeSource } from './lib/photoMeta.ts'
import type { LocationStatus } from './lib/record.ts'

export type AiStatus = 'none' | 'pending' | 'done' | 'error'

// 用户看到和编辑的正文
export type RecordContent = Pick<
  Description,
  'title' | 'category' | 'intro' | 'tags'
>

export type JournalRecord = {
  id: string
  createdAt: number
  takenAt: number
  timeSource: TimeSource
  location: LatLng | null
  locationStatus: LocationStatus
  photoCount: number
  note: string // 用户自己说或写的那句话（原话，AI 不改）
  placeName: string | null // GPS 转出来的地址，或 AI 从照片里认出的地点
  // AI 生成的原稿，永远不被用户编辑覆盖：第 3 阶段要对比"AI 原稿 vs 用户改后"来学习偏好
  aiDraft: Description | null
  content: RecordContent | null
  aiStatus: AiStatus
  aiError: string | null
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

// v2（P2）：加入语音原话、地名和 AI 相关字段。索引不变，只给旧记录补默认值。
db.version(2)
  .stores({ records: 'id, takenAt', photos: 'id, recordId' })
  .upgrade((tx) =>
    tx
      .table('records')
      .toCollection()
      .modify((r: Partial<JournalRecord>) => {
        r.note ??= ''
        r.placeName ??= null
        r.aiDraft ??= null
        r.content ??= null
        r.aiStatus ??= 'none'
        r.aiError ??= null
      }),
  )
