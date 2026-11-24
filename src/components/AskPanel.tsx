import { useState } from 'react'
import { MAX_QUESTION_CHARS } from '../../shared/agents.ts'
import type { JournalRecord } from '../db.ts'
import type { AskResult } from '../lib/agents/ask.ts'
import type { Step } from '../lib/agents/run.ts'

// 问问我的足迹（决策 0028 第 3 条）：用一句话问自己的记录。
// 显示它查了什么、回答，以及回答引用的记录
export function AskPanel({
  render,
}: {
  render: (r: JournalRecord) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState<string>()

  if (!open)
    return (
      <button
        type="button"
        className="px-btn px-btn-sm bg-mint"
        onClick={() => setOpen(true)}
      >
        问问我的足迹
      </button>
    )

  const ask = async () => {
    if (!q.trim() || busy) return
    setBusy(true)
    setSteps([])
    setResult(null)
    setError(undefined)
    try {
      const { askFootprint } = await import('../lib/agents/ask.ts')
      setResult(await askFootprint(q, setSteps))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="px-card bg-card p-3" aria-label="问问我的足迹">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <input
          className="px-input min-w-0 flex-1"
          value={q}
          maxLength={MAX_QUESTION_CHARS}
          onChange={(e) => setQ(e.target.value)}
          placeholder="比如：去年在杭州吃过哪些面？"
          aria-label="问题"
          autoFocus
        />
        <button
          type="submit"
          className="px-btn px-btn-sm bg-mint"
          disabled={busy || !q.trim()}
        >
          {busy ? '查找中…' : '问'}
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm"
          onClick={() => setOpen(false)}
          aria-label="收起"
        >
          ×
        </button>
      </form>
      <p className="mt-1 text-[11px] text-ink-soft">
        在手机上查你的记录，只把查到的几条的文字（不含坐标和照片）发给 AI 作答。
      </p>

      {steps.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-pixel text-[12px] text-ink-soft">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? '' : 'text-cherry'}>
              查了：{s.label}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-cherry">{error}</p>}
      {result && (
        <div className="mt-3">
          <p className="text-sm whitespace-pre-wrap">{result.text}</p>
          {result.records.length > 0 && (
            <div className="mt-3 space-y-4">{result.records.map(render)}</div>
          )}
        </div>
      )}
    </section>
  )
}
