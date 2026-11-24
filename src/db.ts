import { Dexie, type EntityTable } from 'dexie'
import type {
  DescribeMode,
  Description,
  PlaceKind,
  Weather,
} from '../shared/ai.ts'
import type { Area } from './lib/geo/area.ts'
import type { AiCall } from './lib/usage.ts'
import type { LatLng, TimeSource } from './lib/photoMeta.ts'
import type { LocationStatus } from './lib/record.ts'
import type { TrackPoint, Transport } from './lib/track.ts'
import type { TripBreak } from './lib/trips.ts'

// queued：保存时连不上服务端，等能连上再整理（决策 0027 第 4 条）
export type AiStatus = 'none' | 'queued' | 'pending' | 'done' | 'error'

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
  // 当时的天气（决策 0025）：undefined 还没查，null 查过但没有数据
  weather?: Weather | null
  // 从上一条记录到这一条怎么去的，用户改过才有（决策 0022 第 7 条）；没有就按轨迹猜
  transport?: Transport | null
  // 正文用哪一版（决策 0012）：own = 用户自己写的（note），ai = AI 整理的（content.intro）。两版都留着，可以换
  bodySource: 'own' | 'ai'
  // AI 从照片里猜的地点。只是一个候选，用户点了才用（决策 0013 第 2 条）
  placeGuess: string | null
  aiTimings: AiTimings | null
  // AI 刚写完一版、而用户自己也写了内容时为 true：卡片上两版并排，等用户选一版（决策 0012 第 3 条）。
  // 不建索引的可选字段，旧记录里没有它，等同于 false
  choosing?: boolean
  // 最后修改时间，数据库钩子自动写，同步时用（决策 0029 第 3c 条）。旧数据没有
  _mt?: number
  // 文字是不是用语音说的（决策 0029 第 1 条，使用看板用）。以前的记录没有
  noteVia?: 'voice' | 'text'
  // aiStatus 为 queued 时，能连上后按哪种方式整理
  aiQueued?: DescribeMode
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

// 记录体检的事件（决策 0030）：开始、心跳、停止、被系统停了。只在这台设备，不同步、不进备份
export type TrackEvent = {
  id?: number
  t: number
  ev: 'start' | 'hb' | 'stop' | 'lost'
  bat: number // 电量百分比，读不到是 -1
  chg: boolean // 在充电
  scr?: boolean // 屏幕亮着（锁屏期间的耗电才大致是后台记录的消耗）
  precise: boolean
  prov: string // "gps:on,network:none" 这样：定位来源有没有、开没开
}

// 删除标记（决策 0029 第 3c 条）：同步时让别的设备也删掉。key = "表名/编号"
export type Tombstone = { key: string; table: string; id: string; at: number }

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
  _mt?: number // 同上，同步用
}

// 行政区边界（决策 0020）：多边形 → 环 → [经度, 纬度, …]，WGS-84，和打包的边界数据同一种结构
export type ShapeData = number[][][]

// 想去的地方（决策 0020 第 7 条）。"去过了"不存，按记录现算（lib/wishes.ts）；
// 只存用户手动改的结果：判错了可以拿回来，或者手动标成去过了
export type Wish = {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  kind: PlaceKind | 'pin' // pin：在地图上长按加的点
  boundary: string | null // 取边界用的编号（见 shared/ai.ts）
  shape: ShapeData | null // 城市、景区这类有边界的地方，按边界判断去没去过
  note: string
  addedAt: number
  manual: 'done' | 'undone' | null
}

// 补的以前去过的地方（决策 0020 第 6 条）
// - country：整个国家，按国家代码点亮它的所有省州
// - a1：一个省、州（打包的边界数据里的序号）
// - cn：国内的地级市、区县（行政区代码），边界联网时从高德取
// - custom：列表里没有、自己填的名字；联网时查一次，查到就补上国家、城市和边界
export type VisitedPlace = {
  id: string
  kind: 'country' | 'a1' | 'cn' | 'custom'
  name: string
  cc: string | null
  a1: number | null
  code: string | null // 国内的行政区代码（6 位）
  city: string | null // 算"城市数"用；省、国家为 null（直辖市除外）
  shape: ShapeData | null
  addedAt: number
}

// 计划（决策 0024）：一次还没去的出行，按天排的一串地方
export type PlanStop = {
  id: string
  day: number // 第几天，从 1 开始
  name: string
  lat: number | null // 没核实（地图上搜不到）时为 null
  lng: number | null
  address: string | null
  boundary: string | null
  shape: ShapeData | null // 城市、景区按边界判断到没到
  note: string
  reason: string | null // AI 排的才有：为什么推荐给你
}
export type Plan = {
  id: string
  title: string
  start: number // 出发那天的本地零点
  days: number
  stops: PlanStop[]
  createdAt: number
  source: 'manual' | 'ai'
}

// 跟着看的链接（决策 0026）。钥匙和修改钥匙只存在这台手机里；服务端只有加密后的包
export type ShareOptions = {
  text: boolean // 带不带正文
  photos: boolean // 带不带照片
  precision: 'exact' | 'rough' | 'none' // 精确 / 大概（约 5 公里）/ 不显示地图
  days: 7 | 30 | 90
}
export type ShareLink = {
  id: string
  tripId: string // 出行的第一条记录的 id
  key: string // 解密钥匙，在链接 # 后面
  editKey: string // 更新、撤回用
  options: ShareOptions
  createdAt: number
  updatedAt: number
  expiresAt: number
  recordCount: number // 上次上传时这次出行有几条，变了就自动更新
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
  wishes: EntityTable<Wish, 'id'>
  visited: EntityTable<VisitedPlace, 'id'>
  track: EntityTable<TrackPoint, 'id'>
  plans: EntityTable<Plan, 'id'>
  shares: EntityTable<ShareLink, 'id'>
  tombstones: EntityTable<Tombstone, 'key'>
  trackEvents: EntityTable<TrackEvent, 'id'>
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

// v8（决策 0020）：想去的地方、补的以前去过的地方，都只在本机，会进备份
db.version(8).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
})

// v9（决策 0022）：轨迹点（后台记的、导入的 GPX），按时间查。只在本机，会进备份
db.version(9).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
  track: '++id, t',
})

// v10（决策 0024）：计划。只在本机，会进备份
db.version(10).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
  track: '++id, t',
  plans: 'id, start',
})

// v11（决策 0026）：跟着看的链接。钥匙只在本机；会进备份，换手机后还能更新和撤回
db.version(11).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
  track: '++id, t',
  plans: 'id, start',
  shares: 'id, tripId',
})

// v12（决策 0029 第 3c 条）：删除标记，同步用。会进同步，不进备份
db.version(12).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
  track: '++id, t',
  plans: 'id, start',
  shares: 'id, tripId',
  tombstones: 'key, at',
})

// v13（决策 0030）：记录体检的事件
db.version(13).stores({
  records: 'id, takenAt',
  photos: 'id, recordId',
  edits: 'id, recordId, at',
  settings: 'key',
  drafts: 'id',
  embeddings: 'recordId',
  aiCalls: 'id, at',
  wishes: 'id, addedAt',
  visited: 'id',
  track: '++id, t',
  plans: 'id, start',
  shares: 'id, tripId',
  tombstones: 'key, at',
  trackEvents: '++id, t',
})

// 参与同步的表（轨迹另算：按时间合并）。写入时由钩子统一加修改时间 _mt，删除时记删除标记，
// 不用改每一个写入的地方（决策 0029 第 3c 条）。
// 从网盘合并来的行自带 _mt，原样保留；本机代码从来不自己写 _mt
export const SYNCED_TABLES = [
  'records',
  'photos',
  'edits',
  'wishes',
  'visited',
  'plans',
  'shares',
  'aiCalls',
  'settings',
] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

let pendingTombs: Tombstone[] = []
function flushTombs() {
  const batch = pendingTombs
  pendingTombs = []
  if (batch.length) void db.tombstones.bulkPut(batch).catch(() => {})
}

for (const name of SYNCED_TABLES) {
  const t = db.table(name)
  t.hook('creating', (_pk, obj: { _mt?: number }) => {
    obj._mt ??= Date.now()
  })
  t.hook('updating', (mods) =>
    '_mt' in (mods as object) ? undefined : { _mt: Date.now() },
  )
  t.hook('deleting', (pk, _obj, tx) => {
    const id = String(pk)
    pendingTombs.push({ key: `${name}/${id}`, table: name, id, at: Date.now() })
    tx.on('complete', flushTombs)
  })
}
