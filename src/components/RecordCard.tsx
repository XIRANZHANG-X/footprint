import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useState } from 'react'
import { CATEGORIES } from '../../shared/ai.ts'
import { db, type JournalRecord, type RecordContent } from '../db.ts'
import { enrichRecord, saveContent } from '../lib/enrich.ts'
import { formatTimings } from '../lib/record.ts'
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

function Editor({
  initial,
  onSave,
  onCancel,
}: {
  initial: RecordContent
  onSave: (c: RecordContent) => void
  onCancel: () => void
}) {
  const [c, setC] = useState(initial)
  const [tags, setTags] = useState(initial.tags.join(' '))
  const input = 'px-input'
  return (
    <div className="mt-3 space-y-3">
      <input
        className={input}
        value={c.title}
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
        value={c.intro}
        onChange={(e) => setC({ ...c, intro: e.target.value })}
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
            onSave({
              ...c,
              tags: tags.split(/\s+/).filter(Boolean).slice(0, 5),
            })
          }
          className="px-btn px-btn-sm bg-berry"
        >
          保存
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

  return (
    <article className="px-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-pixel text-[12px] text-ink-soft">
            {dateFmt.format(record.takenAt)} · {record.photoCount} 张
          </p>
          {content && !editing && (
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

      <div className="mt-3 grid grid-cols-3 gap-2">
        {photos?.map((p) => (
          <Thumb key={p.id} blob={p.thumb} />
        ))}
      </div>

      {editing && content ? (
        <Editor
          initial={content}
          onCancel={() => setEditing(false)}
          onSave={(c) => {
            void saveContent(record.id, c)
            setEditing(false)
          }}
        />
      ) : (
        <>
          {content && (
            <>
              <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                {content.intro}
              </p>
              {content.tags.length > 0 && (
                <p className="mt-3 flex flex-wrap gap-1.5">
                  {content.tags.map((t) => (
                    <span key={t} className="px-tag bg-mint">
                      #{t}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
          {record.note && (
            <p className="mt-3 border-l-2 border-dashed border-ink-soft pl-2 text-xs text-ink-soft">
              原话：{record.note}
            </p>
          )}
        </>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {record.aiStatus === 'pending' && (
          <span className="px-tag bg-mint">AI 整理中…</span>
        )}
        {record.aiStatus === 'error' && (
          <span className="w-full text-xs text-cherry">
            整理失败：{record.aiError}
          </span>
        )}
        {content && !editing && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        )}
        {record.aiStatus !== 'pending' && (
          <button
            type="button"
            className="px-btn px-btn-sm bg-mint"
            onClick={() => {
              const edited =
                content !== null &&
                record.aiDraft !== null &&
                JSON.stringify(content) !==
                  JSON.stringify({
                    title: record.aiDraft.title,
                    category: record.aiDraft.category,
                    intro: record.aiDraft.intro,
                    tags: record.aiDraft.tags,
                  })
              if (edited && !confirm('重新生成会替换你改过的正文，继续吗？'))
                return
              void enrichRecord(record.id, { overwrite: true })
            }}
          >
            {record.aiStatus === 'none' ? 'AI 整理' : '重新生成'}
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
