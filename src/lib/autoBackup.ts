import { registerPlugin } from '@capacitor/core'
import { exportBackup } from './backup.ts'
import { AUTO_BACKUP_KEEP, AUTO_BACKUP_PREFIX } from './reminder.ts'
import { writeCacheFile } from './saveFile.ts'
import { getLastBackupAt, setLastBackupAt } from './storage.ts'

// 安卓 App 的自动备份（决策 0019 第 1 条）：生成备份，写进缓存目录，
// 再由原生插件复制到"下载/足迹手账"，只留最近 AUTO_BACKUP_KEEP 份自动备份。
// 什么时候该备份、开关和上次结果见 reminder.ts（不依赖这里，首屏代码不用加载这个文件）

// android/app/src/main/java/.../BackupSaverPlugin.java
const BackupSaver = registerPlugin<{
  saveToDownloads(options: {
    uri: string
    name: string
    prefix: string
    keep: number
  }): Promise<{ uri: string; deleted: number }>
}>('BackupSaver')

export type AutoBackupStatus =
  | { at: number; ok: true; name: string; size: number }
  | { at: number; ok: false; error: string }

const STATUS_KEY = 'footprint-journal:autoBackupStatus'

export function getAutoBackupStatus(): AutoBackupStatus | null {
  try {
    const v = localStorage.getItem(STATUS_KEY)
    return v ? (JSON.parse(v) as AutoBackupStatus) : null
  } catch {
    return null
  }
}

function saveStatus(s: AutoBackupStatus) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(s))
  } catch {
    // 记不下来只影响备份页的显示
  }
}

let running: Promise<AutoBackupStatus> | null = null

export function runAutoBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<AutoBackupStatus> {
  running ??= (async () => {
    const before = getLastBackupAt()
    const at = Date.now()
    let status: AutoBackupStatus
    try {
      const { blob } = await exportBackup(onProgress)
      const d = new Date(at)
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `${AUTO_BACKUP_PREFIX}${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`
      const uri = await writeCacheFile(blob, name)
      await BackupSaver.saveToDownloads({
        uri,
        name,
        prefix: AUTO_BACKUP_PREFIX,
        keep: AUTO_BACKUP_KEEP,
      })
      status = { at, ok: true, name, size: blob.size }
    } catch (e) {
      // 没存成功就不算备份过：exportBackup 已经把"上次备份时间"改了，改回去
      setLastBackupAt(before)
      status = {
        at,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
    saveStatus(status)
    return status
  })().finally(() => {
    running = null
  })
  return running
}
