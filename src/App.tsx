import { useLiveQuery } from 'dexie-react-hooks'
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { Timeline } from './components/Timeline.tsx'
import { db, type Draft } from './db.ts'
import { checkAi, type AiState } from './lib/ai.ts'
import {
  getLastBackupAt,
  requestPersistence,
  saveErrorMessage,
} from './lib/storage.ts'
import { enrichRecord } from './lib/enrich.ts'
import { clearDraft, loadDraft, saveDraft } from './lib/draft.ts'
import {
  createTextRecord,
  deleteRecord,
  importPhotos,
  restoreRecord,
  type DeletedRecord,
} from './lib/importPhotos.ts'
import { draftSummary } from './lib/record.ts'
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
  // 正在写的新记录：选好的照片（"只写几句"时为空数组）和开头的文字
  const [picked, setPicked] = useState<{ files: File[]; note: string } | null>(
    null,
  )
  // 上次没写完的草稿，等用户决定继续还是丢弃（决策 0013）
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => {
    void loadDraft().then(setDraft)
  }, [])
  // 打字时不必每个字都写一次数据库，停下来一会儿再存
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(draftTimer.current), [])

  function startComposing(files: File[], note = '') {
    setMessage(undefined)
    setDraft(null)
    setPicked({ files, note })
    void saveDraft(files, note)
  }

  function stopComposing() {
    clearTimeout(draftTimer.current)
    setPicked(null)
    void clearDraft()
  }

  function onNoteChange(files: File[], note: string) {
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => void saveDraft(files, note), 400)
  }
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
    startComposing(files)
  }

  async function onDone(note: string, body: 'own' | 'ai') {
    if (!picked) return
    setBusy(true)
    try {
      let recordId: string | null
      if (picked.files.length === 0) {
        recordId = await createTextRecord(note)
        setMessage('已保存')
      } else {
        const r = await importPhotos(picked.files, note)
        recordId = r.recordId
        const parts = [`已保存 ${r.imported} 张`]
        if (r.failed.length)
          parts.push(`${r.failed.length} 张无法处理：${r.failed.join('、')}`)
        setMessage(parts.join('；'))
      }
      stopComposing()
      // 先存好再整理：AI 慢或失败都不会丢记录。
      // 直接保存：正文用自己写的，AI 只补标题、类别、标签；让 AI 整理：AI 另写一版（决策 0012）
      if (recordId && aiReady)
        void enrichRecord(recordId, { mode: body === 'own' ? 'meta' : 'full' })
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
              files={picked.files}
              aiReady={aiReady}
              initialNote={picked.note}
              onNoteChange={(note) => onNoteChange(picked.files, note)}
              onDone={(note, body) => void onDone(note, body)}
              onCancel={stopComposing}
            />
          </Suspense>
        )
      ) : (
        <>
          <div className="mt-5 flex gap-3">
            <label className="px-btn flex min-h-12 flex-1 bg-berry text-[16px]">
              ＋ 选照片
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={onPick}
              />
            </label>
            <button
              type="button"
              className="px-btn min-h-12"
              onClick={() => startComposing([])}
            >
              只写几句
            </button>
          </div>
          {draft && (
            <div className="px-card mt-4 bg-lemon px-3 py-2 text-sm">
              <p>上次有一条没写完：{draftSummary(draft)}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="px-btn px-btn-sm bg-berry"
                  onClick={() => startComposing(draft.files, draft.note)}
                >
                  继续写
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => {
                    setDraft(null)
                    void clearDraft()
                  }}
                >
                  丢弃
                </button>
              </div>
            </div>
          )}
        </>
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
