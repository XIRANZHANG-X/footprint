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

// ---------- 安卓 App 的自动备份（决策 0019 第 1 条） ----------
// 实际执行在 autoBackup.ts（按需加载）；这里只放判断和开关，首屏代码要用

export const AUTO_BACKUP_DAYS = 7
export const AUTO_BACKUP_KEEP = 2
export const AUTO_BACKUP_PREFIX = '足迹手账自动备份-'
// 打开 App 后等一会儿再备份，不和首屏、补算区域抢资源
export const AUTO_BACKUP_DELAY_MS = 8000

const AUTO_BACKUP_OFF_KEY = 'footprint-journal:autoBackupOff'

export function autoBackupEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_BACKUP_OFF_KEY) !== '1'
  } catch {
    return true
  }
}

export function setAutoBackupEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(AUTO_BACKUP_OFF_KEY)
    else localStorage.setItem(AUTO_BACKUP_OFF_KEY, '1')
  } catch {
    // 写不进去就保持原样
  }
}

// 距上次备份（手动导出或自动备份）满 AUTO_BACKUP_DAYS 天，并且有记录，就该自动备份了
export function autoBackupDue(
  recordCount: number,
  lastBackupAt: number | null,
  now: number,
): boolean {
  if (recordCount === 0) return false
  return (
    lastBackupAt === null || now - lastBackupAt >= AUTO_BACKUP_DAYS * 86_400_000
  )
}

// 安卓 App 里才有自动备份。看 Capacitor 注入的全局对象，不为这个把 Capacitor 打进首屏代码
export function inNativeApp(): boolean {
  const cap = (
    globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor
  return cap?.isNativePlatform?.() === true
}
