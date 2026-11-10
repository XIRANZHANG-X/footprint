import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import type { EditEntry, JournalRecord, Setting, StoredPhoto } from '../db.ts'

// 备份文件格式（zip）：
//   manifest.json      记录和照片的元数据，以及修改记录和设置（偏好说明等）
//   photos/<id>.jpg    存储版照片
//   thumbs/<id>.jpg    缩略图
// 这一层只处理字节，不碰 IndexedDB 和 Blob，方便在 Node 里测试往返。
export const BACKUP_APP = 'footprint-journal'
export const BACKUP_FORMAT = 1

export type PhotoMeta = Omit<StoredPhoto, 'blob' | 'thumb'>
export type PhotoBytes = PhotoMeta & { blob: Uint8Array; thumb: Uint8Array }

const latLng = z.object({ lat: z.number(), lng: z.number() }).nullable()

// 记录只校验核心字段，其余字段原样保留：以后加了新字段，旧版本导出的备份也能导入
const recordSchema = z
  .object({ id: z.string(), takenAt: z.number(), createdAt: z.number() })
  .loose()

const photoSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  order: z.number(),
  takenAt: z.number(),
  timeSource: z.enum(['exif', 'file']),
  location: latLng,
  width: z.number(),
  height: z.number(),
})

const manifestSchema = z.object({
  app: z.literal(BACKUP_APP),
  format: z.literal(BACKUP_FORMAT),
  exportedAt: z.number(),
  records: z.array(recordSchema),
  photos: z.array(photoSchema),
  // 后来加的两项：旧备份里没有，按空处理；旧版本 App 读新备份时会忽略它们
  edits: z
    .array(
      z
        .object({ id: z.string(), recordId: z.string(), at: z.number() })
        .loose(),
    )
    .default([]),
  settings: z
    .array(z.object({ key: z.string(), value: z.unknown() }))
    .default([]),
})

// 修改记录和设置：学到的写作习惯也要能跟着备份走（决策 0012）
export type BackupExtras = { edits: EditEntry[]; settings: Setting[] }

const photoPath = (id: string) => `photos/${id}.jpg`
const thumbPath = (id: string) => `thumbs/${id}.jpg`

export function packBackup(
  records: JournalRecord[],
  photos: PhotoBytes[],
  exportedAt: number,
  extras: BackupExtras = { edits: [], settings: [] },
): Uint8Array {
  const manifest = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt,
    ...extras,
    records,
    photos: photos.map((p) => {
      const { blob: _blob, thumb: _thumb, ...meta } = p
      return meta
    }),
  }
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
  }
  for (const p of photos) {
    files[photoPath(p.id)] = p.blob
    files[thumbPath(p.id)] = p.thumb
  }
  // JPEG 本身已经压缩过，再压只会更慢，所以只打包不压缩
  return zipSync(files, { level: 0 })
}

export class BackupError extends Error {}

export function unpackBackup(bytes: Uint8Array): {
  exportedAt: number
  records: JournalRecord[]
  photos: PhotoBytes[]
  edits: EditEntry[]
  settings: Setting[]
} {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new BackupError('不是有效的备份文件（无法解压）')
  }
  const raw = files['manifest.json']
  if (!raw) throw new BackupError('备份文件里缺少 manifest.json')
  let manifest
  try {
    manifest = manifestSchema.parse(JSON.parse(strFromU8(raw)))
  } catch {
    throw new BackupError('备份文件格式不对，或者来自不支持的版本')
  }
  const photos = manifest.photos.map((p) => {
    const blob = files[photoPath(p.id)]
    const thumb = files[thumbPath(p.id)]
    if (!blob || !thumb) throw new BackupError(`备份文件缺少照片 ${p.id}`)
    return { ...p, blob, thumb }
  })
  return {
    exportedAt: manifest.exportedAt,
    records: manifest.records as unknown as JournalRecord[],
    photos,
    edits: manifest.edits as unknown as EditEntry[],
    settings: manifest.settings as Setting[],
  }
}
