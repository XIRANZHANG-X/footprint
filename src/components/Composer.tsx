import { useEffect, useRef, useState } from 'react'
import { transcribe } from '../lib/ai.ts'
import {
  MAX_RECORD_SECONDS,
  startRecording,
  type Recording,
} from '../lib/recorder.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function Preview({ file }: { file: File }) {
  const url = useObjectUrl(file)
  return url ? (
    <img
      src={url}
      alt=""
      className="aspect-square w-full border-2 border-ink object-cover"
    />
  ) : null
}

type Phase = 'idle' | 'recording' | 'transcribing'

// "选照片 → 说一句话 → 完成"里的后两步（决策 0003）
export function Composer({
  files,
  aiReady,
  onDone,
  onCancel,
}: {
  files: File[]
  aiReady: boolean
  onDone: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string>()
  const [seconds, setSeconds] = useState(0)
  const recording = useRef<Recording | null>(null)

  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // 离开页面时别让麦克风一直开着
  useEffect(() => () => recording.current?.cancel(), [])

  async function finishRecording() {
    const rec = recording.current
    recording.current = null
    if (!rec) return
    setPhase('transcribing')
    try {
      const text = await transcribe(await rec.stop())
      // 追加而不是覆盖：可以分几次说
      setNote((prev) => (prev ? `${prev}${text}` : text))
    } catch (e) {
      setError(
        `语音识别失败：${e instanceof Error ? e.message : e}。可以直接打字。`,
      )
    } finally {
      setPhase('idle')
    }
  }

  async function toggleRecord() {
    setError(undefined)
    if (phase === 'recording') return finishRecording()
    try {
      recording.current = await startRecording(() => void finishRecording())
      setSeconds(0)
      setPhase('recording')
    } catch {
      setError(
        '没法使用麦克风：请允许录音权限（手机上需要通过 HTTPS 打开页面）。',
      )
    }
  }

  return (
    <section className="px-card mt-5 p-3">
      <div className="grid grid-cols-4 gap-2">
        {files.map((f, i) => (
          <Preview key={i} file={f} />
        ))}
      </div>

      {aiReady && (
        <button
          type="button"
          onClick={() => void toggleRecord()}
          disabled={phase === 'transcribing'}
          aria-pressed={phase === 'recording'}
          aria-busy={phase === 'transcribing'}
          className={`px-btn mt-4 min-h-12 w-full ${
            phase === 'recording' ? 'bg-berry' : 'bg-mint'
          }`}
        >
          {phase === 'recording' ? (
            <>
              <span className="animate-pulse text-cherry" aria-hidden="true">
                ●
              </span>
              录音中 {seconds}s · 点一下结束（最长 {MAX_RECORD_SECONDS}s）
            </>
          ) : phase === 'transcribing' ? (
            '识别中…'
          ) : (
            '按一下，说一句话'
          )}
        </button>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder={
          aiReady
            ? '识别结果会出现在这里，可以修改；也可以直接打字'
            : '写一句话（可选）'
        }
        className="px-input mt-3"
      />
      {error && <p className="mt-1 text-xs text-cherry">{error}</p>}
      {!aiReady && (
        <p className="mt-1 text-xs text-ink-soft">
          服务端没有配置 AI key，本次只保存照片和文字。
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={phase !== 'idle'}
          className="px-btn flex-1"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onDone(note)}
          disabled={phase !== 'idle'}
          className="px-btn flex-[2] bg-berry"
        >
          完成
        </button>
      </div>
    </section>
  )
}
