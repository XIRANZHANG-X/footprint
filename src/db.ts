import { Dexie, type EntityTable } from 'dexie'
import type { DescribeMode, Description } from '../shared/ai.ts'
import type { Area } from './lib/geo/area.ts'
import type { AiCall } from './lib/usage.ts'
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
  // manual：只写文字的记录没有照片，时间是用户写下它的那一刻（决策 0013 第 4 条）
  timeSource: TimeSource | 'manual'
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
  // AI 刚写完一版、而用户自己也写了内容时为 true：卡片上两版并排，等用户选一版（决策 0012 第 3 条）。
  // 不建索引的可选字段，旧记录里没有它，等同于 false
  choosing?: boolean
  // 上次整理之后加过或删过照片：卡片上提示"要重新整理吗"，用户点了才整理（决策 0013 第 1 条）
  photosChanged?: boolean
  // 所在行政区，由坐标在本地边界数据里算出（决策 0014 第 3C 条）。undefined = 还没算；null = 不在任何区域里
  area?: Area | null
  // 所在城市（中国是地级市）：来自地名查询，旧记录从地名文字里拆。undefined = 还没确定
  geoCity?: string | null
  // AI 这次写的标题、正文里，原话没有的数字和"添油加醋"的词（决策 0016 第 4 条）。
  // 卡片上提醒，用户点"没关系"或者自己改过之后清掉
  aiFlags?: string[]
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

// 写到一半的新记录（决策 0013）：选好的照片和已写的文字。只有一份，id 固定为 'current'。
// 单独一张表而不放进 settings：里面有照片原文件，不能进备份
export type Draft = {
  id: 'current'
  files: File[]
  note: string
  savedAt: number
}

// 本地语义搜索用的向量（决策 0014 第 3A 条）。可以随时重算，所以不进备份。
// hash 是算向量时那段文字的指纹，记录改了文字就对不上，要重算
export type Embedding = { recordId: string; hash: string; vector: Float32Array }

// 零散的设置（偏好说明、出行总结等），一个键一行
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
  drafts: EntityTable<Draft, 'id'>
  embeddings: EntityTable<Embedding, 'recordId'>
  aiCalls: EntityTable<AiCall, 'id'>
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

// v5（第二档 2B）：草稿表。只加表，旧数据不用动。
db.version(5).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
})

// v6（第三档 3A）：语义搜索的向量表。只加表；记录上新增的 area、geoCity 是可选字段，旧记录在后台补
db.version(6).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
})

// v7（决策 0016 第 3 条）：每次调用 AI 记一行（用了多少 token、多久、成没成功），只在本机，会进备份
db.version(7).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
})
