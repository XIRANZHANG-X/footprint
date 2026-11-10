import { Dexie, type EntityTable } from 'dexie'
import type { DescribeMode, Description } from '../shared/ai.ts'
import type { LatLng, TimeSource } from './lib/photoMeta.ts'
import type { LocationStatus } from './lib/record.ts'
import type { TripBreak } from './lib/trips.ts'

export type AiStatus = 'none' | 'pending' | 'done' | 'error'

// 用户看到和编辑的正文
export type RecordContent = Pick<
  Description,
  'title' | 'category' | 'intro' | 'tags'
>

// 一次整理各步花了多少毫秒（决策 0013 第 5 条）：攒几天数据后，用来决定要不要做"边生成边显示"或换模型
export type AiTimings = {
  mode: DescribeMode
  geocodeMs: number | null // 没查地名时为 null
  imagesMs: number // 缩小照片
  modelMs: number // 模型生成
  totalMs: number // 从开始到写回记录；地名和缩照片并行，所以小于各步之和
}

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
  tripBreak: TripBreak // 用户对出行归组的手动修正（见 lib/trips.ts）
  // 正文用哪一版（决策 0012）：own = 用户自己写的（note），ai = AI 整理的（content.intro）。两版都留着，可以换
  bodySource: 'own' | 'ai'
  // AI 从照片里猜的地点。只是一个候选，用户点了才用（决策 0013 第 2 条）
  placeGuess: string | null
  aiTimings: AiTimings | null
}

// 修改记录（决策 0012 第 1 条）："AI 原稿 → 用户改后的版本"，学习用户写作习惯的原料。
// 只存在本机，会进备份
export type EditEntry = {
  id: string
  recordId: string
  at: number
  // edit：用户改了 AI 的稿子；choseOwn：用户放弃 AI 版本，改用自己写的
  kind: 'edit' | 'choseOwn'
  draft: RecordContent
  final: RecordContent
  changedChars: number
  draftChars: number
}

// 零散的设置（偏好说明等），一个键一行
export type Setting = { key: string; value: unknown }

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
  edits: EntityTable<EditEntry, 'id'>
  settings: EntityTable<Setting, 'key'>
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

// v3（P3）：出行归组的手动修正。
db.version(3)
  .stores({ records: 'id, takenAt', photos: 'id, recordId' })
  .upgrade((tx) =>
    tx
      .table('records')
      .toCollection()
      .modify((r: Partial<JournalRecord>) => {
        r.tripBreak ??= null
      }),
  )

// v4（第二档 2A）：修改记录表、设置表；记录加上"正文用哪一版"、AI 猜的地点、整理耗时。
db.version(4)
  .stores({
    records: 'id, takenAt',
    photos: 'id, recordId',
    edits: 'id, recordId, at',
    settings: 'key',
  })
  .upgrade((tx) =>
    tx
      .table('records')
      .toCollection()
      .modify((r: Partial<JournalRecord>) => {
        // 旧记录只要有整理结果，显示的就是 AI 那一版
        r.bodySource ??= r.content ? 'ai' : 'own'
        r.placeGuess ??= r.aiDraft?.placeGuess ?? null
        r.aiTimings ??= null
      }),
  )
