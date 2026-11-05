import { db, type StoredPhoto } from '../db.ts'
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

export async function deleteRecord(recordId: string) {
  await db.transaction('rw', db.records, db.photos, async () => {
    await db.photos.where('recordId').equals(recordId).delete()
    await db.records.delete(recordId)
  })
}
