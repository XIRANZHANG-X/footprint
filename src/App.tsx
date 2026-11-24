import { useLiveQuery } from 'dexie-react-hooks'
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { SearchBar } from './components/SearchBar.tsx'
import { Timeline } from './components/Timeline.tsx'
import { db, type Draft } from './db.ts'
import { checkAi, type AiState } from './lib/ai.ts'
import {
  getLastBackupAt,
  requestPersistence,
  saveErrorMessage,
} from './lib/storage.ts'
import { drainQueue, enrichRecord, queueEnrich } from './lib/enrich.ts'
import { clearDraft, loadDraft, saveDraft } from './lib/draft.ts'
import {
  createTextRecord,
  deleteRecord,
  importPhotos,
  restoreRecord,
  type DeletedRecord,
} from './lib/importPhotos.ts'
import { proposePreferencesIfDue } from './lib/preferences.ts'
import type { LatLng } from './lib/photoMeta.ts'
import { needsGeo } from './lib/geo/area.ts'
import { draftSummary } from './lib/record.ts'
import { onThisDay } from './lib/review.ts'
import { NO_FILTERS, type Filters } from './lib/search.ts'
import {
  AUTO_BACKUP_DELAY_MS,
  autoBackupDue,
  autoBackupEnabled,
  backupReminder,
  inNativeApp,
} from './lib/reminder.ts'

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

// 回顾页（决策 0014 第 3E 条）
const ReviewPanel = lazy(() =>
  import('./components/ReviewPanel.tsx').then((m) => ({
    default: m.ReviewPanel,
  })),
)

// 偏好页只在点开时才需要
const PreferencesPanel = lazy(() =>
  import('./components/PreferencesPanel.tsx').then((m) => ({
    default: m.PreferencesPanel,
  })),
)

function App() {
  const records = useLiveQuery(() => db.records.toArray())
  const [tab, setTab] = useState<
    'timeline' | 'map' | 'review' | 'prefs' | 'backup'
  >('timeline')
  // 搜索和筛选条件，时间线和地图共用（决策 0014 第 3A 条）
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  // 有坐标的记录在后台补上所在区域和城市（决策 0014 第 3C 条）。
  // 边界数据有十几 MB，只有确实有记录要补时才加载
  useEffect(() => {
    if (!records?.some(needsGeo)) return
    const t = setTimeout(() => {
      void import('./lib/geo/regions.ts')
        .then((m) => m.backfillGeo())
        .catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [records])
  // 正在写的新记录：选好的照片（"只写几句"时为空数组）和开头的文字
  // at：从"停留提示"补记时已知的时间和位置（决策 0022 第 5 条）
  const [picked, setPicked] = useState<{
    files: File[]
    note: string
    at?: { location: LatLng; takenAt: number }
  } | null>(null)
  // 上次没写完的草稿，等用户决定继续还是丢弃（决策 0013）
  const [draft, setDraft] = useState<Draft | null>(null)
  useEffect(() => {
    void loadDraft().then(setDraft)
  }, [])
  // 打字时不必每个字都写一次数据库，停下来一会儿再存
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(draftTimer.current), [])

  function startComposing(
    files: File[],
    note = '',
    at?: { location: LatLng; takenAt: number },
  ) {
    setMessage(undefined)
    setDraft(null)
    setPicked({ files, note, at })
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
  // 保存时处理到第几张照片（决策 0019 第 3 条：几十张大图在手机上要处理好一会儿）
  const [saveProgress, setSaveProgress] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [aiState, setAiState] = useState<AiState>('unavailable')
  const aiReady = aiState === 'ready'

  // 网络恢复时重新看一次服务端（决策 0027 第 4 条：离线时排队的记录这时开始整理）
  useEffect(() => {
    void checkAi().then(setAiState)
    const recheck = () => void checkAi().then(setAiState)
    window.addEventListener('online', recheck)
    return () => window.removeEventListener('online', recheck)
  }, [])
  // 能连上了：把排队的记录一条条整理掉
  const queuedCount = useLiveQuery(() =>
    db.records.filter((r) => r.aiStatus === 'queued').count(),
  )
  useEffect(() => {
    if (aiReady && queuedCount) void drainQueue().catch(() => {})
  }, [aiReady, queuedCount])
  // 暂时连不上、或者还没输口令：保存的记录先排队，之后自动整理
  const canQueue = aiState === 'offline' || aiState === 'needsToken'

  // 当时的天气（决策 0025）：能连服务端时，在后台给记录补上
  useEffect(() => {
    if (!aiReady || !records?.length) return
    const t = setTimeout(() => {
      void import('./lib/weather.ts')
        .then((m) => m.backfillWeather())
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [aiReady, records])

  // 跟着看（决策 0026）：出行里多了记录，自动更新还没过期的链接
  useEffect(() => {
    if (!aiReady || !records?.length) return
    const t = setTimeout(() => {
      void Promise.all([import('./lib/follow.ts'), import('./lib/trips.ts')])
        .then(([f, tr]) => f.refreshShares(tr.groupTrips(records)))
        .catch(() => {})
    }, 5000)
    return () => clearTimeout(t)
  }, [aiReady, records])

  // 攒够一批修改后，让 AI 提出一版新的偏好说明，等用户到偏好页确认（决策 0012 第 6 条）。
  // 修改记录的条数变了就检查一次；失败不提示，下次再试
  const editCount = useLiveQuery(() => db.edits.count())
  useEffect(() => {
    if (!aiReady || editCount === undefined) return
    void proposePreferencesIfDue().catch(() => {})
  }, [aiReady, editCount])
  const hasProposal = useLiveQuery(async () => {
    const row = await db.settings.get('preferences')
    return Boolean((row?.value as { proposal?: string | null })?.proposal)
  })

  // 打开页面时的时间就够用了：提醒按"天"计算，不需要实时刷新
  const [now] = useState(() => Date.now())
  // 备份页导出后会更新上次备份时间；切换页签时重新渲染，这里会读到新值
  const { unbacked, remind } = backupReminder(
    records ?? [],
    getLastBackupAt(),
    now,
  )

  // 安卓 App 里每周自动备份到"下载/足迹手账"（决策 0019 第 1 条）。打开后等几秒再做，
  // 只在打开 App 时检查一次；成功了在页面上提一句，失败的原因到备份页看
  const recordCount = records?.length
  const autoBackupChecked = useRef(false)
  useEffect(() => {
    if (recordCount === undefined || autoBackupChecked.current) return
    autoBackupChecked.current = true
    if (
      !inNativeApp() ||
      !autoBackupEnabled() ||
      !autoBackupDue(recordCount, getLastBackupAt(), Date.now())
    )
      return
    const t = setTimeout(() => {
      void import('./lib/autoBackup.ts')
        .then((m) => m.runAutoBackup())
        .then((s) => {
          if (s.ok) setMessage('已自动备份到手机的"下载/足迹手账"文件夹。')
        })
        .catch(() => {})
    }, AUTO_BACKUP_DELAY_MS)
    return () => clearTimeout(t)
  }, [recordCount])

  // 记录路线（决策 0022）：打开 App、从后台回到前台时，把后台服务记下的点取进数据库
  useEffect(() => {
    if (!inNativeApp()) return
    const sync = () =>
      void import('./lib/trackSync.ts')
        .then((m) => m.syncNativeTrack())
        .catch(() => {})
    sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // 从相册"分享"进来的照片（决策 0023）：直接进新建流程。正在写别的记录时先不打断，提示一句
  const composing = picked !== null
  const composingRef = useRef(composing)
  useEffect(() => {
    composingRef.current = composing
  }, [composing])
  useEffect(() => {
    if (!inNativeApp()) return
    let stop: (() => void) | null = null
    let cancelled = false
    void import('./lib/shareIn.ts').then(async (m) => {
      const s = await m.watchSharedPhotos((files) => {
        if (composingRef.current)
          setMessage('先写完手上这条，再从相册分享一次。')
        else startComposing(files)
      })
      if (cancelled) s()
      else stop = s
    })
    return () => {
      cancelled = true
      stop?.()
    }
    // startComposing 每次渲染都是新的函数，但它只用到 setState，不需要跟着重新订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 一年前的今天（决策 0014 第 3E 条）：往年同月同日有记录才显示
  const past = onThisDay(records ?? [], now)
  const [pastHidden, setPastHidden] = useState(false)

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

  async function onDone(
    note: string,
    body: 'own' | 'ai',
    location: LatLng | null,
  ) {
    if (!picked) return
    setBusy(true)
    try {
      let recordId: string | null
      if (picked.files.length === 0) {
        recordId = await createTextRecord(note, location, picked.at?.takenAt)
        setMessage('已保存')
      } else {
        const r = await importPhotos(picked.files, note, (done, total) =>
          setSaveProgress(total > 1 ? `${done}/${total}` : undefined),
        )
        recordId = r.recordId
        const parts = [`已保存 ${r.imported} 张`]
        if (r.failed.length)
          parts.push(`${r.failed.length} 张无法处理：${r.failed.join('、')}`)
        setMessage(parts.join('；'))
      }
      stopComposing()
      // 先存好再整理：AI 慢或失败都不会丢记录。
      // 直接保存：正文用自己写的，AI 只补标题、类别、标签；让 AI 整理：AI 另写一版（决策 0012）
      const mode = body === 'own' ? 'meta' : 'full'
      if (recordId && aiReady) void enrichRecord(recordId, { mode })
      else if (recordId && canQueue) await queueEnrich(recordId, mode)
      // 有了第一批数据后申请持久化存储；浏览器拒绝也没关系，备份页可以再申请
      void requestPersistence()
    } catch (e) {
      // 最常见的是存储空间满了；照片还留在编辑区，用户腾出空间后可以再点一次"完成"
      setMessage(saveErrorMessage(e))
    } finally {
      setBusy(false)
      setSaveProgress(undefined)
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <h1 className="px-title text-[24px]">足迹手账</h1>

      {picked ? (
        busy ? (
          <p
            role="status"
            className="mt-5 text-center font-pixel text-[12px] text-ink-soft"
          >
            {saveProgress ? `正在处理照片 ${saveProgress}…` : '保存中…'}
          </p>
        ) : (
          <Suspense fallback={null}>
            <Composer
              files={picked.files}
              aiReady={aiReady}
              canQueue={canQueue}
              initialNote={picked.note}
              initialHere={picked.at?.location}
              onNoteChange={(note) => onNoteChange(picked.files, note)}
              onDone={(note, body, location) =>
                void onDone(note, body, location)
              }
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
                className="sr-only"
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
      {message && (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          {message}
        </p>
      )}

      {aiState === 'needsToken' && (
        <Suspense fallback={null}>
          <AccessGate onResult={setAiState} />
        </Suspense>
      )}

      {hasProposal && tab !== 'prefs' && (
        <button
          type="button"
          onClick={() => setTab('prefs')}
          className="px-card mt-4 w-full bg-mint px-3 py-2 text-left text-sm"
        >
          AI 根据你最近的修改，提出了一版新的写作偏好。去看看 →
        </button>
      )}

      {past && !pastHidden && (
        <div className="px-card mt-4 flex items-center justify-between gap-2 bg-taro px-3 py-2 text-sm">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              setFilters({ ...NO_FILTERS, day: past.day })
              setTab('timeline')
            }}
          >
            {past.label} →
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm shrink-0"
            aria-label="今天不再显示"
            onClick={() => setPastHidden(true)}
          >
            ×
          </button>
        </div>
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

      <nav className="mt-6 grid grid-cols-5 gap-1.5">
        {(
          [
            ['timeline', '时间线'],
            ['map', '地图'],
            ['review', '回顾'],
            ['prefs', '偏好'],
            ['backup', '备份'],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`px-btn px-1 ${tab === key ? 'bg-ink text-paper' : ''}`}
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
          {(tab === 'timeline' || tab === 'map') && (
            <SearchBar
              records={records}
              filters={filters}
              onChange={setFilters}
            />
          )}
          {tab === 'timeline' && (
            <Timeline
              records={records}
              filters={filters}
              onDelete={(id) => void onDelete(id)}
              onShowMap={() => setTab('map')}
              canAsk={aiReady}
              onRecordStay={(stay) =>
                startComposing([], '', {
                  location: { lat: stay.lat, lng: stay.lng },
                  takenAt: stay.start,
                })
              }
            />
          )}
          {tab === 'map' && <MapView records={records} filters={filters} />}
          {tab === 'review' && <ReviewPanel records={records} now={now} />}
          {tab === 'prefs' && <PreferencesPanel />}
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
