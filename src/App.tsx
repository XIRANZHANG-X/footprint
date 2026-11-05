import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react'
import { Composer } from './components/Composer.tsx'
import { Timeline } from './components/Timeline.tsx'
import { db } from './db.ts'
import { aiAvailable } from './lib/ai.ts'
import { enrichRecord } from './lib/enrich.ts'
import { importPhotos } from './lib/importPhotos.ts'

// 地图（Leaflet）体积较大，切到地图页签时再加载，记录页打开更快
const MapView = lazy(() =>
  import('./components/MapView.tsx').then((m) => ({ default: m.MapView })),
)

function App() {
  const records = useLiveQuery(() => db.records.toArray())
  const [tab, setTab] = useState<'timeline' | 'map'>('timeline')
  const [picked, setPicked] = useState<File[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [aiReady, setAiReady] = useState(false)

  useEffect(() => {
    void aiAvailable().then(setAiReady)
  }, [])

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 允许再次选同一批照片
    if (files.length === 0) return
    setMessage(undefined)
    setPicked(files)
  }

  async function onDone(note: string) {
    if (!picked) return
    setBusy(true)
    try {
      const r = await importPhotos(picked, note)
      const parts = [`已保存 ${r.imported} 张`]
      if (r.failed.length)
        parts.push(`${r.failed.length} 张无法处理：${r.failed.join('、')}`)
      setMessage(parts.join('；'))
      setPicked(null)
      // 先存好再整理：AI 慢或失败都不会丢记录
      if (r.recordId && aiReady) void enrichRecord(r.recordId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-neutral-50 px-4 py-6">
      <h1 className="text-2xl font-semibold">足迹手账</h1>

      {picked ? (
        busy ? (
          <p className="mt-5 text-center text-sm text-neutral-500">保存中…</p>
        ) : (
          <Composer
            files={picked}
            aiReady={aiReady}
            onDone={(note) => void onDone(note)}
            onCancel={() => setPicked(null)}
          />
        )
      ) : (
        <label className="mt-5 flex cursor-pointer items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-700">
          ＋ 选照片，新建一条记录
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPick}
          />
        </label>
      )}
      {message && <p className="mt-2 text-sm text-neutral-600">{message}</p>}

      <nav className="mt-5 grid grid-cols-2 rounded-lg bg-neutral-200 p-1 text-sm">
        {(
          [
            ['timeline', '时间线'],
            ['map', '地图'],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md py-1.5 ${tab === key ? 'bg-white font-medium shadow-sm' : 'text-neutral-600'}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {records &&
        (tab === 'timeline' ? (
          <Timeline records={records} />
        ) : (
          <Suspense
            fallback={
              <p className="mt-6 text-center text-sm text-neutral-400">
                地图加载中…
              </p>
            }
          >
            <MapView records={records} />
          </Suspense>
        ))}
    </main>
  )
}

export default App
