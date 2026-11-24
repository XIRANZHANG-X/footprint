import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useState } from 'react'
import { CATEGORIES } from '../../shared/ai.ts'
import {
  db,
  type JournalRecord,
  type RecordContent,
  type StoredPhoto,
} from '../db.ts'
import { chooseBody, enrichRecord, saveContent } from '../lib/enrich.ts'
import { changePhotos } from '../lib/importPhotos.ts'
import {
  formatTimings,
  fromLocalInput,
  hasBothVersions,
  recordBody,
  toLocalInput,
} from '../lib/record.ts'
import { setRecordDetails } from '../lib/recordEdits.ts'
import { saveErrorMessage } from '../lib/storage.ts'
import { visitLabel, type VisitInfo } from '../lib/visits.ts'
import { PlacePicker } from './PlacePicker.tsx'
import { useObjectUrl } from './useObjectUrl.ts'

// 分享图只在点击时才需要，按需加载
const SharePreview = lazy(() =>
  import('./SharePreview.tsx').then((m) => ({ default: m.SharePreview })),
)

// 大图只在点开照片时才需要
const PhotoViewer = lazy(() =>
  import('./PhotoViewer.tsx').then((m) => ({ default: m.PhotoViewer })),
)

function Thumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return url ? (
    <img
      src={url}
      alt=""
      className="aspect-square w-full border-2 border-ink object-cover"
    />
  ) : null
}

const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const BLANK: RecordContent = {
  title: '',
  category: '其他',
  intro: '',
  tags: [],
}

// 编辑页里的一张照片：右上角的按钮用来移除（或撤回移除），保存时才真的生效
function EditThumb({
  blob,
  removed = false,
  onToggle,
}: {
  blob: Blob
  removed?: boolean
  onToggle: () => void
}) {
  return (
    <div className="relative">
      <div className={removed ? 'opacity-30' : ''}>
        <Thumb blob={blob} />
      </div>
      <button
        type="button"
        aria-label={removed ? '撤回移除' : '移除这张照片'}
        onClick={onToggle}
        className="absolute top-1 right-1 min-h-7 min-w-7 border-2 border-ink bg-paper px-1 text-xs"
      >
        {removed ? '撤回' : '×'}
      </button>
    </div>
  )
}

// 编辑页（决策 0013）：照片、时间、地名、标题、类别、正文、原话、标签，点"保存"一起生效
function Editor({
  record,
  photos,
  onClose,
}: {
  record: JournalRecord
  photos: StoredPhoto[]
  onClose: () => void
}) {
  const content = record.content
  const [c, setC] = useState(content ?? BLANK)
  const [body, setBody] = useState(recordBody(record))
  const [note, setNote] = useState(record.note)
  const [tags, setTags] = useState((content?.tags ?? []).join(' '))
  const initialTime = toLocalInput(record.takenAt)
  const [time, setTime] = useState(initialTime)
  const [place, setPlace] = useState(record.placeName ?? '')
  const [removed, setRemoved] = useState<string[]>([])
  const [added, setAdded] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  // 正文是 AI 那一版时，上面的"正文"改的是 AI 的稿子，原话另给一栏
  const showsNote =
    record.bodySource === 'ai' && (content?.intro ?? '').trim() !== ''
  const input = 'px-input'
  const label = 'font-pixel text-[12px] text-ink-soft'

  const save = async () => {
    setSaving(true)
    setError(undefined)
    try {
      const next = { ...c, tags: tags.split(/\s+/).filter(Boolean).slice(0, 5) }
      // 还没有标题和标签、这次也没填：只存正文，不凭空造出一份空的整理结果
      if (!content && !next.title.trim() && next.tags.length === 0)
        await chooseBody(record.id, 'own', body)
      else
        await saveContent(record.id, next, body, showsNote ? note : undefined)
      await setRecordDetails(record.id, {
        // 输入框只精确到分钟：没动过就不传，免得把原来的秒数抹掉
        takenAt: time === initialTime ? null : fromLocalInput(time),
        placeName: place,
      })
      const failed = await changePhotos(record.id, removed, added)
      if (failed.length > 0) {
        // 其他改动已经存好了；留在编辑页，让用户看到哪几张没加进来
        setRemoved([])
        setAdded([])
        setError(`这些照片没能加进来：${failed.join('、')}`)
        setSaving(false)
        return
      }
      onClose()
    } catch (e) {
      setError(saveErrorMessage(e))
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className={label}>照片</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <EditThumb
              key={p.id}
              blob={p.thumb}
              removed={removed.includes(p.id)}
              onToggle={() =>
                setRemoved((r) =>
                  r.includes(p.id) ? r.filter((x) => x !== p.id) : [...r, p.id],
                )
              }
            />
          ))}
          {added.map((f, i) => (
            <EditThumb
              // 同一个文件可能被选两次，下标一起当 key
              key={`${f.name}-${f.lastModified}-${i}`}
              blob={f}
              onToggle={() => setAdded((a) => a.filter((_, j) => j !== i))}
            />
          ))}
          <label className="flex aspect-square cursor-pointer items-center justify-center border-2 border-dashed border-ink text-center text-xs text-ink-soft">
            ＋ 加照片
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                setAdded((a) => [...a, ...files])
                // 清空，这样连续两次选同一张也会触发
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>
      <label className="block">
        <span className={label}>时间</span>
        <input
          type="datetime-local"
          className={`${input} mt-1`}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </label>
      <label className="block">
        <span className={label}>地名</span>
        <input
          className={`${input} mt-1`}
          value={place}
          placeholder="可以留空"
          onChange={(e) => setPlace(e.target.value)}
        />
      </label>
      <label className="block">
        <span className={label}>标题</span>
        <input
          className={`${input} mt-1`}
          value={c.title}
          onChange={(e) => setC({ ...c, title: e.target.value })}
        />
      </label>
      <label className="block">
        <span className={label}>类别</span>
        <select
          className={`${input} mt-1`}
          value={c.category}
          onChange={(e) =>
            setC({
              ...c,
              category: e.target.value as RecordContent['category'],
            })
          }
        >
          {CATEGORIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={label}>{showsNote ? '正文（AI 写的）' : '正文'}</span>
        <textarea
          className={`${input} mt-1`}
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      {showsNote && (
        <label className="block">
          <span className={label}>我的原话</span>
          <textarea
            className={`${input} mt-1`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
      <label className="block">
        <span className={label}>标签</span>
        <input
          className={`${input} mt-1`}
          value={tags}
          placeholder="用空格分隔"
          onChange={(e) => setTags(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-cherry">{error}</p>}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-btn px-btn-sm"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-btn px-btn-sm bg-berry"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

// AI 刚写完一版，而用户自己也写了内容：两版并排，都可以改，选一版当正文（决策 0012 第 3 条）
function Chooser({ record }: { record: JournalRecord }) {
  const [own, setOwn] = useState(record.note)
  const [ai, setAi] = useState(record.content?.intro ?? '')
  return (
    <div className="mt-3 space-y-3 border-2 border-dashed border-ink p-2">
      <p className="font-pixel text-[12px]">选一版当正文，两边都可以先改再选</p>
      <div>
        <span className="px-tag">我写的</span>
        <textarea
          className="px-input mt-2"
          rows={3}
          value={own}
          onChange={(e) => setOwn(e.target.value)}
        />
        <button
          type="button"
          className="px-btn px-btn-sm mt-2"
          disabled={!own.trim()}
          onClick={() => void chooseBody(record.id, 'own', own)}
        >
          用我写的
        </button>
      </div>
      <div>
        <span className="px-tag bg-mint">AI 写的</span>
        <textarea
          className="px-input mt-2"
          rows={4}
          value={ai}
          onChange={(e) => setAi(e.target.value)}
        />
        <button
          type="button"
          className="px-btn px-btn-sm mt-2 bg-mint"
          disabled={!ai.trim()}
          onClick={() => void chooseBody(record.id, 'ai', ai)}
        >
          用 AI 写的
        </button>
      </div>
    </div>
  )
}

export function RecordCard({
  record,
  onDelete,
  visit,
  tripLabel,
  wish,
}: {
  record: JournalRecord
  onDelete: (recordId: string) => void
  // 第几次来这个地方、是不是第一次来这个城市（决策 0014 第 3C 条）
  visit?: VisitInfo
  // 搜索结果平铺显示时，标明这条属于哪次出行（决策 0014 第 3A 条）
  tripLabel?: string
  // 这条记录实现了哪个"想去的地方"（决策 0020 第 7 条）
  wish?: string
}) {
  const photos = useLiveQuery(
    () => db.photos.where('recordId').equals(record.id).sortBy('order'),
    [record.id],
  )
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [placing, setPlacing] = useState(false)
  const content = record.content
  const busy = record.aiStatus === 'pending'
  const choosing = record.choosing === true && !busy
  const body = recordBody(record)
  const hasAiBody = (content?.intro ?? '').trim() !== ''
  const usesOwn = record.bodySource === 'own'

  // avoid：这次额外不要写的词（卡片上被标出来的那些，决策 0016 第 4 条）
  const regenerate = (avoid: string[] = []) => {
    const edited =
      !usesOwn &&
      content !== null &&
      record.aiDraft !== null &&
      content.intro !== record.aiDraft.intro
    if (edited && !confirm('重新生成会替换你改过的正文，继续吗？')) return
    void enrichRecord(record.id, { overwrite: true, avoid })
  }
  const flags = record.aiFlags ?? []

  return (
    <article className="px-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-pixel text-[12px] text-ink-soft">
            {dateFmt.format(record.takenAt)}
            {record.photoCount > 0 && ` · ${record.photoCount} 张`}
          </p>
          {tripLabel && (
            <p className="mt-0.5 text-xs text-ink-soft">出行：{tripLabel}</p>
          )}
          {content?.title && !editing && (
            <h3 className="px-title mt-1 text-[20px]">{content.title}</h3>
          )}
          {record.timeSource === 'file' && (
            <p className="mt-1 text-xs text-ink-soft">
              照片没有拍摄时间，这里用的是文件时间，可能不准
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-1.5">
            {record.placeName ? (
              <span className="px-tag bg-sky">{record.placeName}</span>
            ) : (
              record.location && (
                <span className="px-tag bg-sky">
                  {record.location.lat.toFixed(4)},{' '}
                  {record.location.lng.toFixed(4)}
                </span>
              )
            )}
            {/* 只有地名文字、没有坐标的记录也算待定位：它还不在地图上 */}
            {!record.location && (
              <span className="px-tag bg-lemon">待定位</span>
            )}
            {content && <span className="px-tag">{content.category}</span>}
            {visit && (
              <span className="px-tag bg-berry">{visitLabel(visit)}</span>
            )}
            {visit?.firstInCity && (
              <span className="px-tag bg-taro">
                第一次来{visit.firstInCity}
              </span>
            )}
            {wish && (
              <span
                className="px-tag bg-lemon"
                title={`实现了想去的地方：${wish}`}
              >
                ★ 想去的地方
              </span>
            )}
          </p>
          {!record.location && !editing && !placing && (
            <button
              type="button"
              className="px-btn px-btn-sm mt-2 bg-lemon"
              onClick={() => setPlacing(true)}
            >
              补地点
            </button>
          )}
        </div>
        <button
          type="button"
          // 不再弹确认框：删除后页面底部会出现"撤销"
          onClick={() => onDelete(record.id)}
          className="-m-1 shrink-0 p-1 text-xs text-ink-soft hover:text-cherry"
        >
          删除
        </button>
      </header>

      {placing && !editing && !record.location && (
        <PlacePicker record={record} onClose={() => setPlacing(false)} />
      )}

      {!editing && photos && photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              aria-label={`看大图，第 ${i + 1} 张`}
              onClick={() => setViewing(i)}
            >
              <Thumb blob={p.thumb} />
            </button>
          ))}
        </div>
      )}

      {/* AI 写了原话里没有的东西：只提醒，重写要用户点（决策 0016 第 4 条） */}
      {!editing && !busy && !choosing && flags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-2 border-dashed border-ink bg-lemon p-2 text-sm">
          <span className="w-full">
            AI 写了你没说过的：
            {flags.map((f, i) => (
              <span key={f}>
                {i > 0 && '、'}
                <mark className="bg-berry px-0.5 text-ink">{f}</mark>
              </span>
            ))}
          </span>
          <button
            type="button"
            className="px-btn px-btn-sm bg-mint"
            onClick={() =>
              usesOwn
                ? void enrichRecord(record.id, { mode: 'meta', avoid: flags })
                : regenerate(flags)
            }
          >
            去掉这些重写
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() =>
              void db.records.update(record.id, { aiFlags: undefined })
            }
          >
            没关系
          </button>
        </div>
      )}

      {/* 加删照片后只提示，不自动重新整理（决策 0013 第 1 条） */}
      {!editing && !busy && record.photosChanged && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-2 border-dashed border-ink bg-lemon p-2 text-sm">
          <span className="w-full">照片有变动，要重新整理吗？</span>
          <button
            type="button"
            className="px-btn px-btn-sm bg-mint"
            onClick={() => {
              // 正文用的是自己写的：照片变了只需要重新补标题和标签
              if (usesOwn) void enrichRecord(record.id, { mode: 'meta' })
              else regenerate()
            }}
          >
            重新整理
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() =>
              void db.records.update(record.id, { photosChanged: false })
            }
          >
            不用
          </button>
        </div>
      )}

      {editing ? (
        <Editor
          record={record}
          photos={photos ?? []}
          onClose={() => setEditing(false)}
        />
      ) : choosing ? (
        // key：重新生成后 AI 那一版换了，输入框要跟着换
        <Chooser key={content?.intro} record={record} />
      ) : (
        <>
          {body && (
            <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">
              {body}
            </p>
          )}
          {content && content.tags.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-1.5">
              {content.tags.map((t) => (
                <span key={t} className="px-tag bg-mint">
                  #{t}
                </span>
              ))}
            </p>
          )}
          {/* 正文是 AI 写的时，把用户的原话附在下面；正文就是原话时不重复 */}
          {!usesOwn && hasAiBody && record.note && (
            <p className="mt-3 border-l-2 border-dashed border-ink-soft pl-2 text-xs text-ink-soft">
              原话：{record.note}
            </p>
          )}
        </>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {busy && <span className="px-tag bg-mint">AI 整理中…</span>}
        {record.aiStatus === 'error' && (
          <span className="w-full text-xs text-cherry">
            整理失败：{record.aiError}
          </span>
        )}
        {!editing && !choosing && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        )}
        {!editing && !choosing && !busy && hasBothVersions(record) && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() =>
              void chooseBody(
                record.id,
                usesOwn ? 'ai' : 'own',
                usesOwn ? (content?.intro ?? '') : record.note,
              )
            }
          >
            {usesOwn ? '换成 AI 写的' : '换成我写的'}
          </button>
        )}
        {/* 用自己写的正文、但还没有标题（没网或上次失败）：只补标题、类别、标签 */}
        {!editing && !busy && usesOwn && !content?.title && (
          <button
            type="button"
            className="px-btn px-btn-sm bg-mint"
            onClick={() => void enrichRecord(record.id, { mode: 'meta' })}
          >
            补标题和标签
          </button>
        )}
        {!editing && !busy && (
          <button
            type="button"
            className="px-btn px-btn-sm bg-mint"
            onClick={() => regenerate()}
          >
            {hasAiBody ? '重新生成' : '让 AI 写一版'}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            className="px-btn px-btn-sm ml-auto bg-berry"
            onClick={() => setSharing(true)}
          >
            生成分享图
          </button>
        )}
      </footer>
      {record.aiTimings && record.aiStatus === 'done' && (
        // 临时的耗时信息（决策 0013 第 5 条）：攒几天数据，用来决定要不要继续优化速度
        <p className="mt-2 text-[11px] text-ink-soft">
          {formatTimings(record.aiTimings)}
        </p>
      )}
      {viewing !== null && photos && photos.length > 0 && (
        <Suspense fallback={null}>
          <PhotoViewer
            photos={photos}
            start={Math.min(viewing, photos.length - 1)}
            onClose={() => setViewing(null)}
          />
        </Suspense>
      )}
      {sharing && (
        <Suspense fallback={null}>
          <SharePreview record={record} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </article>
  )
}
