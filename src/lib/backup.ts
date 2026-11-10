import { db, type JournalRecord, type StoredPhoto } from '../db.ts'
import { packBackup, unpackBackup } from './backupFormat.ts'
import { setLastBackupAt } from './storage.ts'

// 浏览器这一侧：IndexedDB ↔ 备份文件。格式本身见 backupFormat.ts。

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

export async function exportBackup(): Promise<{ blob: Blob; name: string }> {
  const [records, photos, edits, settings] = await Promise.all([
    db.records.toArray(),
    db.photos.toArray(),
    db.edits.toArray(),
    db.settings.toArray(),
  ])
  const photoBytes = await Promise.all(
    photos.map(async (p) => ({
      ...p,
      blob: await bytes(p.blob),
      thumb: await bytes(p.thumb),
    })),
  )
  const now = Date.now()
  const zip = packBackup(records, photoBytes, now, { edits, settings })
  setLastBackupAt(now)
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    blob: new Blob([zip as Uint8Array<ArrayBuffer>], {
      type: 'application/zip',
    }),
    name: `足迹手账备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`,
  }
}

// 旧版本导出的记录可能缺少后来新增的字段，导入时补上默认值
function withDefaults(r: JournalRecord): JournalRecord {
  return {
    ...r,
    note: r.note ?? '',
    placeName: r.placeName ?? null,
    aiDraft: r.aiDraft ?? null,
    content: r.content ?? null,
    // 导出时正在整理的记录，导入后不会有后台任务继续跑，标成 error 让用户可以重试
    aiStatus: r.aiStatus === 'pending' ? 'error' : (r.aiStatus ?? 'none'),
    aiError:
      r.aiStatus === 'pending'
        ? '备份时还在整理，请重新生成'
        : (r.aiError ?? null),
    tripBreak: r.tripBreak ?? null,
    bodySource: r.bodySource ?? (r.content ? 'ai' : 'own'),
    placeGuess: r.placeGuess ?? r.aiDraft?.placeGuess ?? null,
    aiTimings: r.aiTimings ?? null,
  }
}

// 合并导入：备份里的记录按 id 写入（同 id 以备份为准），本机已有的其他记录保留
export async function importBackup(file: File) {
  const data = unpackBackup(new Uint8Array(await file.arrayBuffer()))
  const photos: StoredPhoto[] = data.photos.map((p) => ({
    ...p,
    blob: new Blob([p.blob as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
    thumb: new Blob([p.thumb as Uint8Array<ArrayBuffer>], {
      type: 'image/jpeg',
    }),
  }))
  await db.transaction(
    'rw',
    [db.records, db.photos, db.edits, db.settings],
    async () => {
      await db.records.bulkPut(data.records.map(withDefaults))
      await db.photos.bulkPut(photos)
      await db.edits.bulkPut(data.edits)
      await db.settings.bulkPut(data.settings)
    },
  )
  return {
    records: data.records.length,
    photos: photos.length,
    exportedAt: data.exportedAt,
  }
}
