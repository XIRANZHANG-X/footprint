import { db, type JournalRecord, type StoredPhoto } from '../db.ts'
import { readPhotoMeta } from './exif.ts'
import { compressPhoto } from './image.ts'
import { summarizeRecord } from './record.ts'

export type ImportResult = {
  recordId: string | null
  imported: number
  failed: string[] // 处理失败的文件名（例如浏览器解不了的 HEIC）
}

export async function importPhotos(
  files: File[],
  note = '',
): Promise<ImportResult> {
  const recordId = crypto.randomUUID()
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
        order: photos.length,
        ...meta,
        ...compressed,
      })
    } catch {
      failed.push(file.name)
    }
  }

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
    })
  })
  return { recordId, imported: photos.length, failed }
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
    return { record, photos }
  })
}

export async function restoreRecord({ record, photos }: DeletedRecord) {
  await db.transaction('rw', db.records, db.photos, async () => {
    await db.photos.bulkPut(photos)
    await db.records.put(record)
  })
}
