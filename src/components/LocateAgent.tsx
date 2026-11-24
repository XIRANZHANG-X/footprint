import { useEffect, useState } from 'react'
import { checkAi } from '../lib/ai.ts'
import type { LocateResult } from '../lib/agents/locate.ts'
import type { Step } from '../lib/agents/run.ts'
import { applyPlace } from '../lib/recordEdits.ts'

// "补地点"里的"让 AI 找找看"（决策 0028 第 4 条）：AI 用线索、当天的地点、以前去过的地方和地点搜索
// 找出候选，每个都附上依据；用户点了才写进记录
export function LocateAgent({
  recordId,
  onPlaced,
}: {
  recordId: string
  onPlaced: () => void
}) {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<LocateResult | null>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    void checkAi().then((s) => alive && setReady(s === 'ready'))
    return () => {
      alive = false
    }
  }, [])
  if (!ready) return null

  const run = async () => {
    setBusy(true)
    setSteps([])
    setResult(null)
    setError(undefined)
    try {
      const { locateRecord } = await import('../lib/agents/locate.ts')
      setResult(await locateRecord(recordId, setSteps))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="px-btn px-btn-sm bg-mint"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'AI 在找…' : '让 AI 找找看'}
      </button>
      {steps.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-pixel text-[12px] text-ink-soft">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? '' : 'text-cherry'}>
              查了：{s.label}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-cherry">{error}</p>}
      {result && (
        <div className="mt-2">
          {result.candidates.length === 0 ? (
            <p className="text-xs text-ink-soft">
              没找到把握的地点。{result.note ?? ''}
            </p>
          ) : (
            <>
              <p className="font-pixel text-[12px] text-ink-soft">
                AI 找到的，看看依据对不对，点一下才用
              </p>
              <div className="mt-1 flex flex-col items-start gap-2">
                {result.candidates.map((c) => (
                  <button
                    key={c.ref}
                    type="button"
                    className="px-btn px-btn-sm bg-sky text-left"
                    onClick={() => {
                      void applyPlace(recordId, c)
                      onPlaced()
                    }}
                  >
                    {c.label}
                    <span className="block text-[11px] opacity-70">
                      {c.evidence}
                    </span>
                  </button>
                ))}
              </div>
              {result.note && (
                <p className="mt-1 text-xs text-ink-soft">{result.note}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
