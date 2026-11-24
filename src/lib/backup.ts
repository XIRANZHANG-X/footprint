import { db, type JournalRecord, type StoredPhoto } from '../db.ts'
import { packBackup, unpackBackup } from './backupFormat.ts'
import { setLastBackupAt } from './storage.ts'

// 浏览器这一侧：IndexedDB ↔ 备份文件。格式本身见 backupFormat.ts。

export async function exportBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; name: string }> {
  const [
    records,
    photos,
    edits,
    settings,
    aiCalls,
    wishes,
    visited,
    track,
    plans,
  ] = await Promise.all([
    db.records.toArray(),
    db.photos.toArray(),
    db.edits.toArray(),
    db.settings.toArray(),
    db.aiCalls.toArray(),
    db.wishes.toArray(),
    db.visited.toArray(),
    db.track.toArray(),
    db.plans.toArray(),
  ])
  // 从数据库读出来的照片是 Blob（指向浏览器存的文件），这里不读内容，打包时一张一张读
  const now = Date.now()
  const blob = await packBackup(
    records,
    photos,
    now,
    { edits, settings, aiCalls, wishes, visited, track, plans },
    onProgress,
  )
  setLastBackupAt(now)
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    blob,
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
  // 照片是备份文件的切片，没有读进内存；写进数据库时浏览器再一张张复制
  const data = await unpackBackup(file)
  const photos: StoredPhoto[] = data.photos
  await db.transaction(
    'rw',
    [
      db.records,
      db.photos,
      db.edits,
      db.settings,
      db.aiCalls,
      db.wishes,
      db.visited,
      db.track,
      db.plans,
    ],
    async () => {
      await db.records.bulkPut(data.records.map(withDefaults))
      await db.photos.bulkPut(photos)
      await db.edits.bulkPut(data.edits)
      await db.settings.bulkPut(data.settings)
      await db.aiCalls.bulkPut(data.aiCalls)
      await db.wishes.bulkPut(data.wishes)
      await db.visited.bulkPut(data.visited)
      await db.plans.bulkPut(data.plans)
      // 轨迹点的编号是自增的，导入时去掉编号重新编，按时间去重：已经有同一时刻的点就不再加
      const have = new Set(
        (await db.track.toArray()).map((p) => `${p.t},${p.lat},${p.lng}`),
      )
      await db.track.bulkAdd(
        data.track
          .filter((p) => !have.has(`${p.t},${p.lat},${p.lng}`))
          .map(({ id: _id, ...p }) => p),
      )
    },
  )
  return {
    records: data.records.length,
    photos: photos.length,
    exportedAt: data.exportedAt,
  }
}
