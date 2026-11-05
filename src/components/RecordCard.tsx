import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { deleteRecord } from '../lib/importPhotos.ts'

function useObjectUrl(blob: Blob) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    // object URL 是要手动释放的外部资源，创建和释放必须成对放在同一个 effect 里。
    // 若改成渲染时 useMemo 创建，StrictMode 下 effect 会多跑一轮清理，把仍在使用的 URL 提前释放。
    const u = URL.createObjectURL(blob)
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

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

export function RecordCard({ record }: { record: JournalRecord }) {
  const photos = useLiveQuery(
    () => db.photos.where('recordId').equals(record.id).sortBy('order'),
    [record.id],
  )

  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{dateFmt.format(record.takenAt)}</p>
          {record.timeSource === 'file' && (
            <p className="text-xs text-amber-600">
              照片没有拍摄时间，这里用的是文件时间，可能不准
            </p>
          )}
          <p className="mt-1 text-sm text-neutral-600">
            {record.location ? (
              `${record.location.lat.toFixed(4)}, ${record.location.lng.toFixed(4)}`
            ) : (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                待定位
              </span>
            )}
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
    </article>
  )
}
