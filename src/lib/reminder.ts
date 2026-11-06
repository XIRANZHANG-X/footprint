// 备份提醒：有记录还没备份过，且其中最早的一条已经存在 REMIND_AFTER_DAYS 天，就提醒。
// 刚记完不马上提醒（太烦），也不会无限拖着不提醒。
export const REMIND_AFTER_DAYS = 7

export function backupReminder(
  records: { createdAt: number }[],
  lastBackupAt: number | null,
  now: number,
): { unbacked: number; remind: boolean } {
  const unbacked = records.filter(
    (r) => lastBackupAt === null || r.createdAt > lastBackupAt,
  )
  if (unbacked.length === 0) return { unbacked: 0, remind: false }
  const oldest = Math.min(...unbacked.map((r) => r.createdAt))
  return {
    unbacked: unbacked.length,
    remind: now - oldest >= REMIND_AFTER_DAYS * 86_400_000,
  }
}
