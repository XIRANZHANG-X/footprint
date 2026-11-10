import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useState } from 'react'
import { CATEGORIES } from '../../shared/ai.ts'
import { db, type JournalRecord, type RecordContent } from '../db.ts'
import { chooseBody, enrichRecord, saveContent } from '../lib/enrich.ts'
import { formatTimings, hasBothVersions, recordBody } from '../lib/record.ts'
import { useObjectUrl } from './useObjectUrl.ts'

// 分享图只在点击时才需要，按需加载
const SharePreview = lazy(() =>
  import('./SharePreview.tsx').then((m) => ({ default: m.SharePreview })),
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

function Editor({
  initial,
  initialBody,
  onSave,
  onCancel,
}: {
  initial: RecordContent
  initialBody: string
  onSave: (c: RecordContent, body: string) => void
  onCancel: () => void
}) {
  const [c, setC] = useState(initial)
  const [body, setBody] = useState(initialBody)
  const [tags, setTags] = useState(initial.tags.join(' '))
  const input = 'px-input'
  return (
    <div className="mt-3 space-y-3">
      <input
        className={input}
        value={c.title}
        placeholder="标题"
        onChange={(e) => setC({ ...c, title: e.target.value })}
      />
      <select
        className={input}
        value={c.category}
        onChange={(e) =>
          setC({ ...c, category: e.target.value as RecordContent['category'] })
        }
      >
        {CATEGORIES.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <textarea
        className={input}
        rows={4}
        value={body}
        placeholder="正文"
        onChange={(e) => setBody(e.target.value)}
      />
      <input
        className={input}
        value={tags}
        placeholder="标签，用空格分隔"
        onChange={(e) => setTags(e.target.value)}
      />
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-btn px-btn-sm">
          取消
        </button>
        <button
          type="button"
          onClick={() =>
            onSave(
              { ...c, tags: tags.split(/\s+/).filter(Boolean).slice(0, 5) },
              body,
            )
          }
          className="px-btn px-btn-sm bg-berry"
        >
          保存
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
}: {
  record: JournalRecord
  onDelete: (recordId: string) => void
}) {
  const photos = useLiveQuery(
    () => db.photos.where('recordId').equals(record.id).sortBy('order'),
    [record.id],
  )
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const content = record.content
  const busy = record.aiStatus === 'pending'
  const choosing = record.choosing === true && !busy
  const body = recordBody(record)
  const hasAiBody = (content?.intro ?? '').trim() !== ''
  const usesOwn = record.bodySource === 'own'

  return (
    <article className="px-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-pixel text-[12px] text-ink-soft">
            {dateFmt.format(record.takenAt)}
            {record.photoCount > 0 && ` · ${record.photoCount} 张`}
          </p>
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
            ) : record.location ? (
              <span className="px-tag bg-sky">
                {record.location.lat.toFixed(4)},{' '}
                {record.location.lng.toFixed(4)}
              </span>
            ) : (
              <span className="px-tag bg-lemon">待定位</span>
            )}
            {content && <span className="px-tag">{content.category}</span>}
          </p>
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

      {photos && photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <Thumb key={p.id} blob={p.thumb} />
          ))}
        </div>
      )}

      {editing ? (
        <Editor
          initial={content ?? BLANK}
          initialBody={body}
          onCancel={() => setEditing(false)}
          onSave={(c, text) => {
            // 还没有标题和标签、这次也没填：只存正文，不凭空造出一份空的整理结果
            if (!content && !c.title.trim() && c.tags.length === 0)
              void chooseBody(record.id, 'own', text)
            else void saveContent(record.id, c, text)
            setEditing(false)
          }}
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
            onClick={() => {
              const edited =
                !usesOwn &&
                content !== null &&
                record.aiDraft !== null &&
                content.intro !== record.aiDraft.intro
              if (edited && !confirm('重新生成会替换你改过的正文，继续吗？'))
                return
              void enrichRecord(record.id, { overwrite: true })
            }}
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
      {sharing && (
        <Suspense fallback={null}>
          <SharePreview record={record} onClose={() => setSharing(false)} />
        </Suspense>
      )}
    </article>
  )
}
