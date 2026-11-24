import { useEffect, useState, type ChangeEvent } from 'react'
import type { JournalRecord } from '../db.ts'
import {
  getAutoBackupStatus,
  runAutoBackup,
  type AutoBackupStatus,
} from '../lib/autoBackup.ts'
import { exportBackup, importBackup } from '../lib/backup.ts'
import {
  AUTO_BACKUP_DAYS,
  AUTO_BACKUP_KEEP,
  autoBackupEnabled,
  backupReminder,
  inNativeApp,
  setAutoBackupEnabled,
} from '../lib/reminder.ts'
import { saveFile } from '../lib/saveFile.ts'
import { SyncCard } from './SyncCard.tsx'
import {
  getLastBackupAt,
  isQuotaError,
  requestPersistence,
} from '../lib/storage.ts'

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
const size = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : mb(n)

export function BackupPanel({ records }: { records: JournalRecord[] }) {
  const [lastBackupAt, setLastBackupAt] = useState(getLastBackupAt)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [now] = useState(() => Date.now())
  const [progress, setProgress] = useState<string>()
  const native = inNativeApp()
  const [autoOn, setAutoOn] = useState(autoBackupEnabled)
  const [autoStatus, setAutoStatus] = useState<AutoBackupStatus | null>(
    getAutoBackupStatus,
  )
  const onProgress = (done: number, total: number) =>
    setProgress(`${Math.round((done / total) * 100)}%`)

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
    void navigator.storage?.estimate?.().then(
      (e) =>
        e.usage !== undefined &&
        setUsage(
          // quota 是浏览器给这个网站的上限，不是手机的剩余空间，所以写"上限"
          e.quota ? `${mb(e.usage)}（上限 ${size(e.quota)}）` : mb(e.usage),
        ),
    )
  }, [records.length])

  const { unbacked } = backupReminder(records, lastBackupAt, now)

  async function onExport() {
    setBusy(true)
    setMessage(undefined)
    try {
      const { blob, name } = await exportBackup(onProgress)
      setProgress('正在保存')
      await saveFile(blob, name)
      setLastBackupAt(getLastBackupAt())
      setMessage(
        `已导出 ${records.length} 条记录（${mb(blob.size)}），请把文件存到网盘或电脑上。`,
      )
    } catch (e) {
      setMessage(`导出失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }

  // 安卓 App：马上备份一次到"下载/足迹手账"（换手机、卸载重装前用）
  async function onAutoBackupNow() {
    setBusy(true)
    setMessage(undefined)
    const s = await runAutoBackup(onProgress)
    setAutoStatus(s)
    setLastBackupAt(getLastBackupAt())
    setBusy(false)
    setProgress(undefined)
    setMessage(
      s.ok
        ? `已备份到"下载/足迹手账/${s.name}"（${mb(s.size)}）。`
        : `备份失败：${s.error}`,
    )
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage(undefined)
    try {
      const r = await importBackup(file)
      setMessage(
        `已导入 ${r.records} 条记录、${r.photos} 张照片（备份时间 ${timeFmt.format(r.exportedAt)}）。`,
      )
    } catch (err) {
      setMessage(
        isQuotaError(err)
          ? '导入失败：这台设备留给 App 的存储空间不够，一条都没有导入。请清理手机空间后重试。'
          : `导入失败：${err instanceof Error ? err.message : err}`,
      )
    } finally {
      setBusy(false)
    }
  }

  const row =
    'flex justify-between gap-2 border-b-2 border-dashed border-grid py-1.5 last:border-0'
  return (
    <section className="mt-5 space-y-4">
      <div className="px-card p-3 text-sm">
        <p className="px-title mb-2 text-[16px]">数据只存在这台设备里</p>
        <div className={row}>
          <span className="text-ink-soft">记录</span>
          <span>
            {records.length} 条{usage && ` · 占用约 ${usage}`}
          </span>
        </div>
        <div className={row}>
          <span className="text-ink-soft">上次备份</span>
          <span>
            {lastBackupAt ? timeFmt.format(lastBackupAt) : '从未备份'}
          </span>
        </div>
        <div className={row}>
          <span className="text-ink-soft">未备份</span>
          <span className={unbacked ? 'px-tag bg-lemon' : ''}>
            {unbacked} 条
          </span>
        </div>
        <div className={row}>
          <span className="text-ink-soft">持久保存</span>
          {persisted ? (
            <span className="px-tag bg-mint">已开启</span>
          ) : (
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => void requestPersistence().then(setPersisted)}
            >
              {persisted === false ? '未开启，点击申请' : '检查中…'}
            </button>
          )}
        </div>
        {persisted === false && (
          <p className="mt-2 text-xs text-ink-soft">
            浏览器可能不同意（取决于你的使用频率等）。把网页"添加到主屏幕"后更容易获批。即使开启，也建议定期导出备份。
          </p>
        )}
      </div>

      <SyncCard />

      {native && (
        <div className="px-card p-3 text-sm">
          <label className="flex items-center justify-between gap-2">
            <span className="px-title text-[16px]">每周自动备份</span>
            <input
              type="checkbox"
              className="size-5 accent-ink"
              checked={autoOn}
              onChange={(e) => {
                setAutoBackupEnabled(e.target.checked)
                setAutoOn(e.target.checked)
              }}
            />
          </label>
          <p className="mt-1 text-xs text-ink-soft">
            距上次备份满 {AUTO_BACKUP_DAYS} 天时，打开 App
            会自动备份到手机的"下载/足迹手账"文件夹，只留最近 {AUTO_BACKUP_KEEP}{' '}
            份。卸载 App 后这些文件还在，重装后可以从这里导入。
          </p>
          {autoStatus && (
            <p className={`mt-2 text-xs ${autoStatus.ok ? '' : 'text-cherry'}`}>
              上次自动备份：{timeFmt.format(autoStatus.at)}
              {autoStatus.ok
                ? `，${mb(autoStatus.size)}`
                : `，失败：${autoStatus.error}`}
            </p>
          )}
          <button
            type="button"
            disabled={busy || records.length === 0}
            onClick={() => void onAutoBackupNow()}
            className="px-btn px-btn-sm mt-2"
          >
            现在备份到手机文件夹
          </button>
        </div>
      )}

      <button
        type="button"
        disabled={busy || records.length === 0}
        onClick={() => void onExport()}
        aria-busy={busy}
        className="px-btn min-h-12 w-full bg-berry"
      >
        {busy ? `处理中…${progress ?? ''}` : '导出备份（zip）'}
      </button>
      <label
        aria-busy={busy}
        className={`px-btn flex min-h-12 w-full ${busy ? 'pointer-events-none' : ''}`}
      >
        从备份导入
        <input
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          disabled={busy}
          onChange={(e) => void onImport(e)}
        />
      </label>
      <p className="text-xs text-ink-soft">
        导入是合并：备份里的记录会加进来（同一条记录以备份为准），这台设备上已有的其他记录不受影响。
      </p>
      {message && (
        <p role="status" className="px-card p-3 text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
