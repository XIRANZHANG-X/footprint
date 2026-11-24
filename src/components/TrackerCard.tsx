import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ChangeEvent } from 'react'
import { db } from '../db.ts'
import { inNativeApp } from '../lib/reminder.ts'
import { TrackHealthPanel } from './TrackHealthPanel.tsx'

// 记录路线（决策 0022）：在地图页顶部。安卓 App 里可以开始、停止，选省电或精确；
// 网页版做不了后台定位，只能导入别的 App 的轨迹（GPX）。点只存在手机里

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

type Status = {
  running: boolean
  precise: boolean
  startedAt: number
  brand?: string
}

export function TrackerCard() {
  const native = inNativeApp()
  const [status, setStatus] = useState<Status | null>(null)
  const [precise, setPrecise] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const count = useLiveQuery(() => db.track.count())
  const [since] = useState(() => Date.now() - 86_400_000)
  const today = useLiveQuery(
    () => db.track.where('t').above(since).count(),
    [Math.floor(since / 3_600_000)],
  )

  useEffect(() => {
    if (!native) return
    void import('../lib/trackSync.ts').then(async (m) => {
      const s = await m.Tracker.getStatus()
      setStatus(s)
      setPrecise(s.precise)
      await m.syncNativeTrack()
    })
  }, [native])

  async function toggle() {
    setBusy(true)
    setMessage(undefined)
    try {
      const m = await import('../lib/trackSync.ts')
      if (status?.running) {
        await m.syncNativeTrack()
        setStatus(await m.Tracker.stop())
      } else setStatus(await m.Tracker.start({ precise }))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function openBatterySettings() {
    void import('../lib/trackSync.ts').then((m) =>
      m.Tracker.openBatterySettings().catch((e: unknown) =>
        setMessage(e instanceof Error ? e.message : String(e)),
      ),
    )
  }

  async function onGpx(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage(undefined)
    try {
      const m = await import('../lib/trackSync.ts')
      const r = await m.importGpxFile(file)
      setMessage(
        r.read === 0
          ? '这个文件里没有带时间的轨迹点。'
          : `读到 ${r.read} 个点，新加 ${r.added} 个（隐私区里的、已经有的不加）。`,
      )
    } catch (err) {
      setMessage(`导入失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-card mb-4 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="px-title text-[16px]">记录路线</p>
        {status?.running && (
          <span className="px-tag bg-mint">
            正在记录 · {status.precise ? '精确' : '省电'}
          </span>
        )}
      </div>
      {native ? (
        <>
          <p className="mt-1 text-xs text-ink-soft">
            出门时打开，App
            在后台记下你走过的地方：路线沿着真实的路画，照片没带位置时按拍摄时间补上。
            只存在这台手机里。
          </p>
          {status?.running && (
            <p className="mt-1 text-xs">
              {timeFmt.format(status.startedAt)} 开始，最近一天记了 {today ?? 0}{' '}
              个点
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`px-btn px-btn-sm ${status?.running ? '' : 'bg-berry'}`}
              disabled={busy || status === null}
              onClick={() => void toggle()}
            >
              {status?.running ? '停止记录' : '开始记录路线'}
            </button>
            {!status?.running && (
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={precise}
                  onChange={(e) => setPrecise(e.target.checked)}
                />
                精确模式（GPS，更耗电）
              </label>
            )}
          </div>
          <button
            type="button"
            className="mt-2 text-xs text-ink-soft underline decoration-dashed"
            onClick={openBatterySettings}
          >
            锁屏后不记了？去设置里允许足迹手账在后台运行
          </button>
          <TrackHealthPanel
            running={status?.running ?? false}
            brand={status?.brand ?? ''}
            onOpenSettings={openBatterySettings}
          />
        </>
      ) : (
        <p className="mt-1 text-xs text-ink-soft">
          网页版没法在后台定位，安卓 App 里可以一路记下路线。这里可以导入别的
          App 记的轨迹。
        </p>
      )}
      <label
        className={`mt-2 inline-flex cursor-pointer text-xs underline decoration-dashed ${busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        导入轨迹文件（GPX：两步路、六只脚、运动手表导出的）
        <input
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="sr-only"
          onChange={(e) => void onGpx(e)}
        />
      </label>
      {count !== undefined && count > 0 && (
        <p className="mt-1 text-[11px] text-ink-soft">
          手机里一共有 {count} 个轨迹点。
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
