import { db, type JournalRecord, type StoredPhoto } from '../db.ts'
import { compressPhoto } from './image.ts'
import type { LatLng } from './photoMeta.ts'
import { summarizeRecord } from './record.ts'

export type ImportResult = {
  recordId: string | null
  imported: number
  failed: string[] // 处理失败的文件名（例如浏览器解不了的 HEIC）
}

// 处理到第几张（从 1 开始）、一共几张。一张一张处理：手机上同时解码几十张 4000 万像素的图会内存不够（决策 0019 第 3 条）
export type PhotoProgress = (done: number, total: number) => void

// 读元数据 + 压缩，得到可以直接入库的照片。firstOrder：第一张排在第几位
async function preparePhotos(
  files: File[],
  recordId: string,
  firstOrder = 0,
  onProgress?: PhotoProgress,
) {
  // 读照片信息的库（exifr）体积不小，只有导入照片时才用得上，到这里再加载，首屏更快
  const { readPhotoMeta } = await import('./exif.ts')
  const photos: StoredPhoto[] = []
  const failed: string[] = []

  for (const file of files) {
    try {
      // 必须先从原文件读元数据：压缩后重新编码的 JPEG 不再带 EXIF
      const meta = await readPhotoMeta(file)
      const compressed = await compressPhoto(file)
      photos.push({
        id: crypto.randomUUID(),
        recordId,
        order: firstOrder + photos.length,
        ...meta,
        ...compressed,
      })
    } catch {
      failed.push(file.name)
    }
    onProgress?.(photos.length + failed.length, files.length)
  }
  return { photos, failed }
}

export async function importPhotos(
  files: File[],
  note = '',
  onProgress?: PhotoProgress,
): Promise<ImportResult> {
  const recordId = crypto.randomUUID()
  const { photos, failed } = await preparePhotos(files, recordId, 0, onProgress)

  if (photos.length === 0) return { recordId: null, imported: 0, failed }

  const summary = summarizeRecord(photos)
  await db.transaction('rw', db.records, db.photos, async () => {
    await db.photos.bulkAdd(photos)
    await db.records.add({
      id: recordId,
      createdAt: Date.now(),
      photoCount: photos.length,
      ...summary,
      note: note.trim(),
      placeName: null,
      aiDraft: null,
      content: null,
      aiStatus: 'none',
      aiError: null,
      tripBreak: null,
      bodySource: 'own',
      placeGuess: null,
      aiTimings: null,
    })
  })
  return { recordId, imported: photos.length, failed }
}

// 给已有的记录加照片、删照片（决策 0013 第 1 条）。返回处理失败的文件名。
// 记录本身的时间和地点不跟着新照片变：否则补一张第二天拍的照片，整条记录会跳到另一次出行里去
export async function changePhotos(
  recordId: string,
  removeIds: string[],
  addFiles: File[],
): Promise<string[]> {
  if (removeIds.length === 0 && addFiles.length === 0) return []
  const existing = await db.photos.where('recordId').equals(recordId).toArray()
  const firstOrder = Math.max(-1, ...existing.map((p) => p.order)) + 1
  // 压缩比较慢，放在事务外面做（IndexedDB 的事务等不了别的异步操作）
  const { photos, failed } = await preparePhotos(addFiles, recordId, firstOrder)
  const removed = existing.filter((p) => removeIds.includes(p.id))
  if (removed.length === 0 && photos.length === 0) return failed

  await db.transaction('rw', db.records, db.photos, async () => {
    const record = await db.records.get(recordId)
    if (!record) return
    await db.photos.bulkDelete(removed.map((p) => p.id))
    await db.photos.bulkAdd(photos)
    await db.records.update(recordId, {
      photoCount: existing.length - removed.length + photos.length,
      // AI 整理过的记录才需要提示"要不要重新整理"
      ...(record.content || record.aiDraft ? { photosChanged: true } : {}),
    })
  })
  return failed
}

// 只写文字、没有照片的记录（决策 0013 第 4 条）：时间是写下它的这一刻，地点先空着
// location：用户点了"用当前位置"时取到的坐标
export async function createTextRecord(
  note: string,
  location: LatLng | null = null,
): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.records.add({
    id,
    createdAt: now,
    takenAt: now,
    timeSource: 'manual',
    location,
    locationStatus: location ? 'gps' : 'pending',
    photoCount: 0,
    note: note.trim(),
    placeName: null,
    aiDraft: null,
    content: null,
    aiStatus: 'none',
    aiError: null,
    tripBreak: null,
    bodySource: 'own',
    placeGuess: null,
    aiTimings: null,
  })
  return id
}

// 删除时顺手把删掉的内容交还给调用方，界面用它实现"撤销"（决策 0011）。
// 只留在内存里：撤销提示消失或 App 关掉后，这条记录就真的没了
export type DeletedRecord = { record: JournalRecord; photos: StoredPhoto[] }

export async function deleteRecord(
  recordId: string,
): Promise<DeletedRecord | null> {
  return db.transaction('rw', db.records, db.photos, async () => {
    const record = await db.records.get(recordId)
    if (!record) return null
    const photos = await db.photos.where('recordId').equals(recordId).toArray()
    await db.photos.where('recordId').equals(recordId).delete()
    await db.records.delete(recordId)
    // 修改记录故意留着：它记的是写作习惯，不属于某一条记录，删了记录也不该让 AI 忘掉学到的东西
    return { record, photos }
  })
}

export async function restoreRecord({ record, photos }: DeletedRecord) {
  await db.transaction('rw', db.records, db.photos, async () => {
    await db.photos.bulkPut(photos)
    await db.records.put(record)
  })
}
