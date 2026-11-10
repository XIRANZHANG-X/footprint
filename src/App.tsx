import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react'
import { Timeline } from './components/Timeline.tsx'
import { db } from './db.ts'
import { checkAi, type AiState } from './lib/ai.ts'
import {
  getLastBackupAt,
  requestPersistence,
  saveErrorMessage,
} from './lib/storage.ts'
import { enrichRecord } from './lib/enrich.ts'
import {
  deleteRecord,
  importPhotos,
  restoreRecord,
  type DeletedRecord,
} from './lib/importPhotos.ts'
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

const UNDO_MS = 6000

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

  // 刚删掉的那条记录，留在内存里几秒钟供撤销（决策 0011）
  const [deleted, setDeleted] = useState<DeletedRecord | null>(null)
  useEffect(() => {
    if (!deleted) return
    const t = setTimeout(() => setDeleted(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [deleted])

  async function onDelete(recordId: string) {
    setDeleted(await deleteRecord(recordId))
  }

  async function onUndo() {
    if (!deleted) return
    setDeleted(null)
    try {
      await restoreRecord(deleted)
    } catch (e) {
      setMessage(saveErrorMessage(e))
    }
  }

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
    } catch (e) {
      // 最常见的是存储空间满了；照片还留在编辑区，用户腾出空间后可以再点一次"完成"
      setMessage(saveErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <h1 className="px-title text-[24px]">足迹手账</h1>

      {picked ? (
        busy ? (
          <p className="mt-5 text-center font-pixel text-[12px] text-ink-soft">
            保存中…
          </p>
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
        <label className="px-btn mt-5 flex min-h-12 w-full bg-berry text-[16px]">
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
      {message && <p className="mt-3 text-sm text-ink-soft">{message}</p>}

      {aiState === 'needsToken' && (
        <Suspense fallback={null}>
          <AccessGate onResult={setAiState} />
        </Suspense>
      )}

      {remind && tab !== 'backup' && (
        <button
          type="button"
          onClick={() => setTab('backup')}
          className="px-card mt-4 w-full bg-lemon px-3 py-2 text-left text-sm"
        >
          有 {unbacked}{' '}
          条记录超过一周还没备份，数据只存在这台手机的浏览器里。去备份 →
        </button>
      )}

      <nav className="mt-6 grid grid-cols-3 gap-2">
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
            aria-pressed={tab === key}
            className={`px-btn ${tab === key ? 'bg-ink text-paper' : ''}`}
          >
            {name}
          </button>
        ))}
      </nav>

      {records && (
        <Suspense
          fallback={
            <p className="mt-6 text-center font-pixel text-[12px] text-ink-soft">
              加载中…
            </p>
          }
        >
          {tab === 'timeline' && (
            <Timeline records={records} onDelete={(id) => void onDelete(id)} />
          )}
          {tab === 'map' && <MapView records={records} />}
          {tab === 'backup' && <BackupPanel records={records} />}
        </Suspense>
      )}

      {deleted && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-4 z-[900] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between gap-3 border-2 border-ink bg-ink px-3 py-2 text-sm text-paper shadow-px-sm"
        >
          <span>已删除这条记录</span>
          <button
            type="button"
            className="px-btn px-btn-sm bg-lemon"
            onClick={() => void onUndo()}
          >
            撤销
          </button>
        </div>
      )}
    </main>
  )
}

export default App
