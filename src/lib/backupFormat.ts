import { z } from 'zod'
import type { EditEntry, JournalRecord, Setting, StoredPhoto } from '../db.ts'
import type { AiCall } from './usage.ts'
import {
  buildStoredZip,
  readZipIndex,
  zipEntryBlob,
  ZipError,
  type ZipEntry,
} from './zipStore.ts'

// 备份文件格式（zip）：
//   manifest.json      记录和照片的元数据，以及修改记录和设置（偏好说明等）
//   photos/<id>.jpg    存储版照片
//   thumbs/<id>.jpg    缩略图
// 这一层只处理 Blob，不碰 IndexedDB，方便在 Node 里测试往返。
// zip 只存不压，照片按位置切片读写，不会把整个备份读进内存（决策 0019 第 2 条，见 zipStore.ts）
export const BACKUP_APP = 'footprint-journal'
export const BACKUP_FORMAT = 1

export type PhotoMeta = Omit<StoredPhoto, 'blob' | 'thumb'>
export type PhotoBlobs = PhotoMeta & { blob: Blob; thumb: Blob }

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
  // AI 用量（决策 0016 第 3 条），同样是后来加的
  aiCalls: z
    .array(z.object({ id: z.string(), at: z.number() }).loose())
    .default([]),
})

// 修改记录和设置：学到的写作习惯也要能跟着备份走（决策 0012）
export type BackupExtras = {
  edits: EditEntry[]
  settings: Setting[]
  aiCalls?: AiCall[]
}

const photoPath = (id: string) => `photos/${id}.jpg`
const thumbPath = (id: string) => `thumbs/${id}.jpg`

export async function packBackup(
  records: JournalRecord[],
  photos: PhotoBlobs[],
  exportedAt: number,
  extras: BackupExtras = { edits: [], settings: [] },
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
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
  function* entries(): Generator<ZipEntry> {
    yield {
      name: 'manifest.json',
      data: new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    }
    for (const p of photos) {
      yield { name: photoPath(p.id), data: p.blob }
      yield { name: thumbPath(p.id), data: p.thumb }
    }
  }
  const total = 1 + photos.length * 2
  return buildStoredZip(entries(), exportedAt, (done) =>
    onProgress?.(done, total),
  )
}

export class BackupError extends Error {}

export async function unpackBackup(file: Blob): Promise<{
  exportedAt: number
  records: JournalRecord[]
  photos: PhotoBlobs[]
  edits: EditEntry[]
  settings: Setting[]
  aiCalls: AiCall[]
}> {
  let index
  try {
    index = await readZipIndex(file)
  } catch (e) {
    throw new BackupError(
      e instanceof ZipError
        ? `不是有效的备份文件（${e.message}）`
        : '不是有效的备份文件（无法解压）',
    )
  }
  const entry = (name: string, type: string) => {
    const e = index.get(name)
    return e ? zipEntryBlob(file, e, type) : null
  }
  const raw = await entry('manifest.json', 'application/json')
  if (!raw) throw new BackupError('备份文件里缺少 manifest.json')
  let manifest
  try {
    manifest = manifestSchema.parse(JSON.parse(await raw.text()))
  } catch {
    throw new BackupError('备份文件格式不对，或者来自不支持的版本')
  }
  const photos: PhotoBlobs[] = []
  for (const p of manifest.photos) {
    const [blob, thumb] = await Promise.all([
      entry(photoPath(p.id), 'image/jpeg'),
      entry(thumbPath(p.id), 'image/jpeg'),
    ])
    if (!blob || !thumb) throw new BackupError(`备份文件缺少照片 ${p.id}`)
    photos.push({ ...p, blob, thumb })
  }
  return {
    exportedAt: manifest.exportedAt,
    records: manifest.records as unknown as JournalRecord[],
    photos,
    edits: manifest.edits as unknown as EditEntry[],
    settings: manifest.settings as Setting[],
    aiCalls: manifest.aiCalls as unknown as AiCall[],
  }
}
