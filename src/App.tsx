import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react'
import { Timeline } from './components/Timeline.tsx'
import { db } from './db.ts'
import { checkAi, type AiState } from './lib/ai.ts'
import { getLastBackupAt, requestPersistence } from './lib/storage.ts'
import { enrichRecord } from './lib/enrich.ts'
import { importPhotos } from './lib/importPhotos.ts'
import { backupReminder } from './lib/reminder.ts'

// 地图（Leaflet）体积较大，切到地图页签时再加载，记录页打开更快
const MapView = lazy(() =>
  import('./components/MapView.tsx').then((m) => ({ default: m.MapView })),
)
// 选完照片才出现的编辑区（含录音和 WAV 编码）、只在需要口令时出现的输入框，都按需加载
const Composer = lazy(() =>
  import('./components/Composer.tsx').then((m) => ({ default: m.Composer })),
)
const AccessGate = lazy(() =>
  import('./components/AccessGate.tsx').then((m) => ({
    default: m.AccessGate,
  })),
)
// 备份页依赖 zip 库，同样按需加载
const BackupPanel = lazy(() =>
  import('./components/BackupPanel.tsx').then((m) => ({
    default: m.BackupPanel,
  })),
)

function App() {
  const records = useLiveQuery(() => db.records.toArray())
  const [tab, setTab] = useState<'timeline' | 'map' | 'backup'>('timeline')
  const [picked, setPicked] = useState<File[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [aiState, setAiState] = useState<AiState>('unavailable')
  const aiReady = aiState === 'ready'

  useEffect(() => {
    void checkAi().then(setAiState)
  }, [])

  // 打开页面时的时间就够用了：提醒按"天"计算，不需要实时刷新
  const [now] = useState(() => Date.now())
  // 备份页导出后会更新上次备份时间；切换页签时重新渲染，这里会读到新值
  const { unbacked, remind } = backupReminder(
    records ?? [],
    getLastBackupAt(),
    now,
  )

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
      // 有了第一批数据后申请持久化存储；浏览器拒绝也没关系，备份页可以再申请
      void requestPersistence()
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
          <Suspense fallback={null}>
            <Composer
              files={picked}
              aiReady={aiReady}
              onDone={(note) => void onDone(note)}
              onCancel={() => setPicked(null)}
            />
          </Suspense>
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

      {aiState === 'needsToken' && (
        <Suspense fallback={null}>
          <AccessGate onResult={setAiState} />
        </Suspense>
      )}

      {remind && tab !== 'backup' && (
        <button
          type="button"
          onClick={() => setTab('backup')}
          className="mt-3 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-900"
        >
          有 {unbacked}{' '}
          条记录超过一周还没备份，数据只存在这台手机的浏览器里。去备份 →
        </button>
      )}

      <nav className="mt-5 grid grid-cols-3 rounded-lg bg-neutral-200 p-1 text-sm">
        {(
          [
            ['timeline', '时间线'],
            ['map', '地图'],
            ['backup', '备份'],
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

      {records && (
        <Suspense
          fallback={
            <p className="mt-6 text-center text-sm text-neutral-400">加载中…</p>
          }
        >
          {tab === 'timeline' && <Timeline records={records} />}
          {tab === 'map' && <MapView records={records} />}
          {tab === 'backup' && <BackupPanel records={records} />}
        </Suspense>
      )}
    </main>
  )
}

export default App
