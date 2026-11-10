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

// "选照片 → 说一句话 → 保存"里的后两步（决策 0003）；没有照片时就是"只写几句"（决策 0013）
export function Composer({
  files,
  aiReady,
  initialNote = '',
  onNoteChange,
  onDone,
  onCancel,
}: {
  files: File[] // 空数组表示"只写几句"，没有照片
  aiReady: boolean
  initialNote?: string // 从草稿继续时带回来的文字
  onNoteChange?: (note: string) => void // 用来自动存草稿
  // own：直接保存，正文用自己写的；ai：让 AI 写一版（决策 0012 第 3 条）
  onDone: (note: string, body: 'own' | 'ai') => void
  onCancel: () => void
}) {
  const [note, setNoteState] = useState(initialNote)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string>()
  const [seconds, setSeconds] = useState(0)
  const recording = useRef<Recording | null>(null)
  const textOnly = files.length === 0
  const idle = phase === 'idle'
  // 只写几句的记录没有照片，文字就不能再空着
  const canSave = idle && (!textOnly || note.trim() !== '')

  function setNote(next: string | ((prev: string) => string)) {
    setNoteState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      onNoteChange?.(value)
      return value
    })
  }

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
      {textOnly ? (
        <p className="px-title text-[16px]">只写几句</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {files.map((f, i) => (
            <Preview key={i} file={f} />
          ))}
        </div>
      )}

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
        rows={textOnly ? 5 : 3}
        placeholder={
          aiReady
            ? '识别结果会出现在这里，可以修改；也可以直接打字'
            : textOnly
              ? '写几句'
              : '写一句话（可选）'
        }
        className="px-input mt-3"
      />
      {error && <p className="mt-1 text-xs text-cherry">{error}</p>}
      {!aiReady && (
        <p className="mt-1 text-xs text-ink-soft">
          现在用不了 AI，这次只保存{textOnly ? '' : '照片和'}
          文字，之后可以再补。
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={!idle}
          className="px-btn"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => onDone(note, 'own')}
          disabled={!canSave}
          className={`px-btn flex-1 ${aiReady ? '' : 'bg-berry'}`}
        >
          直接保存
        </button>
        {aiReady && (
          <button
            type="button"
            onClick={() => onDone(note, 'ai')}
            disabled={!canSave}
            className="px-btn flex-1 bg-berry"
          >
            让 AI 整理
          </button>
        )}
      </div>
      {aiReady && (
        <p className="mt-2 text-xs text-ink-soft">
          直接保存：正文用你写的，AI 只补标题和标签。让 AI 整理：AI
          另写一版，和你写的放在一起让你选。
        </p>
      )}
    </section>
  )
}
