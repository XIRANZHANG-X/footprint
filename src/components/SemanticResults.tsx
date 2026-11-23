import { useEffect, useState } from 'react'
import type { JournalRecord } from '../db.ts'
import {
  ensureEmbeddings,
  semanticSearch,
  type Progress,
} from '../lib/semantic/semantic.ts'

// 搜索结果的第二段："可能相关"（决策 0014 第 3A 条）。
// 第一次用时要读取本地模型、给旧记录补向量，期间显示进度；之后只算新增和改过的记录
export function SemanticResults({
  query,
  records,
  exclude,
  render,
}: {
  query: string
  records: JournalRecord[] // 符合筛选条件的全部记录（还没按文字过滤）
  exclude: Set<string> // 字面已经命中的，不再重复列
  render: (r: JournalRecord) => React.ReactNode
}) {
  const [hits, setHits] = useState<string[] | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string>()
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) return
    const run = { cancelled: false }
    // 停止输入半秒后再算，不必每敲一个字算一次
    const t = setTimeout(() => {
      void (async () => {
        try {
          setError(undefined)
          await ensureEmbeddings(
            records,
            (p) => !run.cancelled && setProgress(p),
          )
          const found = await semanticSearch(q, 12)
          if (!run.cancelled) setHits(found.map((h) => h.recordId))
        } catch (e) {
          if (!run.cancelled)
            setError(e instanceof Error ? e.message : String(e))
        }
      })()
    }, 500)
    return () => {
      run.cancelled = true
      clearTimeout(t)
    }
  }, [q, records])

  if (q.length < 2) return null
  const byId = new Map(records.map((r) => [r.id, r]))
  const shown = (hits ?? [])
    .filter((id) => !exclude.has(id))
    .flatMap((id) => byId.get(id) ?? [])
  const preparing = progress !== null && progress.done < progress.total

  return (
    <section className="mt-8">
      <h2 className="px-tag bg-mint px-2 py-1">可能相关</h2>
      {error ? (
        <p className="mt-2 text-sm text-cherry">语义搜索出错：{error}</p>
      ) : preparing ? (
        <p className="mt-2 text-sm text-ink-soft">
          正在给旧记录建索引（只有第一次要等）：{progress.done} /{' '}
          {progress.total}
        </p>
      ) : hits === null ? (
        <p className="mt-2 text-sm text-ink-soft">按意思找相近的记录…</p>
      ) : shown.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">没有意思相近的其他记录。</p>
      ) : (
        <div className="mt-3 space-y-4">{shown.map(render)}</div>
      )}
    </section>
  )
}
