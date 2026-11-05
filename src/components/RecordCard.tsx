import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { CATEGORIES } from '../../shared/ai.ts'
import { db, type JournalRecord, type RecordContent } from '../db.ts'
import { enrichRecord, saveContent } from '../lib/enrich.ts'
import { deleteRecord } from '../lib/importPhotos.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function Thumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return url ? (
    <img
      src={url}
      alt=""
      className="aspect-square w-full rounded object-cover"
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
  const input = 'w-full rounded border border-neutral-200 p-1.5 text-sm'
  return (
    <div className="mt-3 space-y-2">
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
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={onCancel} className="px-3 py-1">
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
          className="rounded bg-emerald-600 px-3 py-1 text-white"
        >
          保存
        </button>
      </div>
    </div>
  )
}

export function RecordCard({ record }: { record: JournalRecord }) {
  const photos = useLiveQuery(
    () => db.photos.where('recordId').equals(record.id).sortBy('order'),
    [record.id],
  )
  const [editing, setEditing] = useState(false)
  const content = record.content
  const link = 'text-xs text-neutral-400 hover:text-neutral-700'

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {content && !editing && (
            <h2 className="text-lg font-semibold">{content.title}</h2>
          )}
          <p className="text-sm text-neutral-500">
            {dateFmt.format(record.takenAt)}
            {content && <span className="ml-2">{content.category}</span>}
          </p>
          {record.timeSource === 'file' && (
            <p className="text-xs text-amber-600">
              照片没有拍摄时间，这里用的是文件时间，可能不准
            </p>
          )}
          <p className="mt-1 text-sm text-neutral-600">
            {record.placeName ??
              (record.location ? (
                `${record.location.lat.toFixed(4)}, ${record.location.lng.toFixed(4)}`
              ) : (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  待定位
                </span>
              ))}
            <span className="ml-2 text-neutral-400">
              {record.photoCount} 张
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm('删除这条记录和其中的照片？'))
              void deleteRecord(record.id)
          }}
          className="shrink-0 text-xs text-neutral-400 hover:text-red-600"
        >
          删除
        </button>
      </header>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
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
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">
                {content.intro}
              </p>
              {content.tags.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-1">
                  {content.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                    >
                      #{t}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
          {record.note && (
            <p className="mt-2 border-l-2 border-neutral-200 pl-2 text-xs text-neutral-500">
              原话：{record.note}
            </p>
          )}
        </>
      )}

      <footer className="mt-2 flex items-center gap-3">
        {record.aiStatus === 'pending' && (
          <span className="text-xs text-emerald-700">AI 整理中…</span>
        )}
        {record.aiStatus === 'error' && (
          <span className="text-xs text-red-600">
            整理失败：{record.aiError}
          </span>
        )}
        {content && !editing && (
          <button
            type="button"
            className={link}
            onClick={() => setEditing(true)}
          >
            编辑
          </button>
        )}
        {record.aiStatus !== 'pending' && (
          <button
            type="button"
            className={link}
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
              void enrichRecord(record.id, true)
            }}
          >
            {record.aiStatus === 'none' ? 'AI 整理' : '重新生成'}
          </button>
        )}
      </footer>
    </article>
  )
}
