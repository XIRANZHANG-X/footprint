import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ChangeEvent } from 'react'
import { RecordCard } from './components/RecordCard.tsx'
import { db } from './db.ts'
import { importPhotos } from './lib/importPhotos.ts'

function App() {
  const records = useLiveQuery(() =>
    db.records.orderBy('takenAt').reverse().toArray(),
  )
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 允许再次选同一批照片
    if (files.length === 0) return
    setBusy(true)
    setMessage(undefined)
    try {
      const r = await importPhotos(files)
      const parts = [`已导入 ${r.imported} 张`]
      if (r.failed.length)
        parts.push(`${r.failed.length} 张无法处理：${r.failed.join('、')}`)
      setMessage(parts.join('；'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-neutral-50 px-4 py-6">
      <h1 className="text-2xl font-semibold">足迹手账</h1>

      <label
        className={`mt-5 flex cursor-pointer items-center justify-center rounded-xl px-4 py-3 font-medium text-white ${
          busy ? 'bg-neutral-400' : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {busy ? '处理中…' : '＋ 选照片，新建一条记录'}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={busy}
          onChange={onPick}
        />
      </label>
      {message && <p className="mt-2 text-sm text-neutral-600">{message}</p>}

      <section className="mt-6 space-y-3">
        {records?.length === 0 && (
          <p className="text-center text-sm text-neutral-400">还没有记录</p>
        )}
        {records?.map((r) => (
          <RecordCard key={r.id} record={r} />
        ))}
      </section>
    </main>
  )
}

export default App
