import { useEffect, useState, type ChangeEvent } from 'react'
import type { JournalRecord } from '../db.ts'
import { exportBackup, importBackup } from '../lib/backup.ts'
import { backupReminder } from '../lib/reminder.ts'
import { getLastBackupAt, requestPersistence } from '../lib/storage.ts'

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function BackupPanel({ records }: { records: JournalRecord[] }) {
  const [lastBackupAt, setLastBackupAt] = useState(getLastBackupAt)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [now] = useState(() => Date.now())

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted)
    void navigator.storage
      ?.estimate?.()
      .then((e) => e.usage !== undefined && setUsage(mb(e.usage)))
  }, [records.length])

  const { unbacked } = backupReminder(records, lastBackupAt, now)

  async function onExport() {
    setBusy(true)
    setMessage(undefined)
    try {
      const { blob, name } = await exportBackup()
      save(blob, name)
      setLastBackupAt(getLastBackupAt())
      setMessage(
        `已导出 ${records.length} 条记录（${mb(blob.size)}），请把文件存到网盘或电脑上。`,
      )
    } catch (e) {
      setMessage(`导出失败：${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
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
      setMessage(`导入失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  const row = 'flex justify-between gap-2 py-1'
  return (
    <section className="mt-5 space-y-4">
      <div className="rounded-xl bg-white p-3 text-sm shadow-sm">
        <p className="mb-1 font-medium">数据只存在这台设备的浏览器里</p>
        <div className={row}>
          <span className="text-neutral-500">记录</span>
          <span>
            {records.length} 条{usage && ` · 占用约 ${usage}`}
          </span>
        </div>
        <div className={row}>
          <span className="text-neutral-500">上次备份</span>
          <span>
            {lastBackupAt ? timeFmt.format(lastBackupAt) : '从未备份'}
          </span>
        </div>
        <div className={row}>
          <span className="text-neutral-500">未备份</span>
          <span className={unbacked ? 'text-amber-700' : ''}>
            {unbacked} 条
          </span>
        </div>
        <div className={row}>
          <span className="text-neutral-500">持久保存</span>
          {persisted ? (
            <span className="text-emerald-700">已开启</span>
          ) : (
            <button
              type="button"
              className="text-emerald-700 underline"
              onClick={() => void requestPersistence().then(setPersisted)}
            >
              {persisted === false ? '未开启，点击申请' : '检查中…'}
            </button>
          )}
        </div>
        {persisted === false && (
          <p className="mt-1 text-xs text-neutral-500">
            浏览器可能不同意（取决于你的使用频率等）。把网页"添加到主屏幕"后更容易获批。即使开启，也建议定期导出备份。
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy || records.length === 0}
        onClick={() => void onExport()}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white disabled:bg-neutral-400"
      >
        {busy ? '处理中…' : '导出备份（zip）'}
      </button>
      <label
        className={`flex w-full cursor-pointer items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-3 font-medium ${busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        从备份导入
        <input
          type="file"
          accept=".zip,application/zip"
          hidden
          disabled={busy}
          onChange={(e) => void onImport(e)}
        />
      </label>
      <p className="text-xs text-neutral-500">
        导入是合并：备份里的记录会加进来（同一条记录以备份为准），这台设备上已有的其他记录不受影响。
      </p>
      {message && <p className="text-sm text-neutral-700">{message}</p>}
    </section>
  )
}
