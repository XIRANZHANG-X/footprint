import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { checkAi } from '../lib/ai.ts'
import { yearKey, type YearStory } from '../lib/yearStory.ts'

// 年度回顾的文字（决策 0029 第 2 条）：先逐月写小结，再写一年。写好的存在本机
export function YearStoryCard({
  year,
  records,
}: {
  year: number
  records: JournalRecord[]
}) {
  const story = useLiveQuery(
    async () =>
      ((await db.settings.get(yearKey(year)))?.value as YearStory) ?? null,
    [year],
  )
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [showMonths, setShowMonths] = useState(false)

  useEffect(() => {
    let alive = true
    void checkAi().then((s) => alive && setReady(s === 'ready'))
    return () => {
      alive = false
    }
  }, [])

  const write = async () => {
    setError(undefined)
    setProgress('准备中…')
    try {
      const { writeYearStory } = await import('../lib/yearStory.ts')
      await writeYearStory(records, year, (done, total) =>
        setProgress(
          done < total
            ? `在写每个月的小结：${done + 1}/${total}`
            : '在写这一年…',
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  if (story === undefined) return null
  if (!story && !ready) return null

  return (
    <div className="px-card bg-card p-3">
      <h3 className="font-pixel text-[12px] text-ink-soft">这一年</h3>
      {story ? (
        <p className="mt-1 text-sm whitespace-pre-wrap">{story.text}</p>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">
          让 AI
          先给每个月写一段小结，再串成一年。只发记录的文字，不发照片和坐标。
        </p>
      )}
      {story && story.months.length > 0 && (
        <button
          type="button"
          className="mt-2 text-xs text-ink-soft underline decoration-dashed underline-offset-4"
          onClick={() => setShowMonths(!showMonths)}
        >
          {showMonths ? '收起每个月的小结' : '看每个月的小结'}
        </button>
      )}
      {showMonths && story && (
        <ul className="mt-2 space-y-2 text-sm">
          {story.months.map((m) => (
            <li key={m.month}>
              <span className="font-pixel text-[12px] text-ink-soft">
                {m.month} 月
              </span>{' '}
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-cherry">{error}</p>}
      {ready && (
        <button
          type="button"
          className="px-btn px-btn-sm mt-3 bg-mint"
          disabled={progress !== null}
          onClick={() => void write()}
        >
          {progress ??
            (story ? '重写（只重写记录变了的月份）' : '让 AI 写这一年')}
        </button>
      )}
    </div>
  )
}
