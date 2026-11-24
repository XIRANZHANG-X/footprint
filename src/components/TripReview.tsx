import { useEffect, useRef, useState } from 'react'
import type { JournalRecord } from '../db.ts'
import {
  loadReel,
  playReel,
  recordReel,
  REEL_H,
  REEL_W,
  videoMime,
  type ReelData,
} from '../lib/reel.ts'
import { saveFile } from '../lib/saveFile.ts'
import {
  renderPoster,
  renderTripPdf,
  tripMaterial,
  type TripMaterial,
} from '../lib/tripBook.ts'
import type { Trip } from '../lib/trips.ts'

// 回看一次出行（决策 0025）：路线回放（可以存成短视频）、路线海报、PDF 手账。
// 都在手机上生成，不上传

export function TripReview({
  trip,
  onClose,
}: {
  trip: Trip<JournalRecord>
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [material, setMaterial] = useState<TripMaterial | null>(null)
  const [reel, setReel] = useState<ReelData | null>(null)
  const [busy, setBusy] = useState<string | null>('准备中…')
  const [message, setMessage] = useState<string>()
  const [poster, setPoster] = useState<string | null>(null)
  const stop = useRef<() => void>(() => {})

  useEffect(() => {
    const state = { alive: true }
    void (async () => {
      const m = await tripMaterial(trip)
      const r = await loadReel(m)
      if (!state.alive) return
      setMaterial(m)
      setReel(r)
      setBusy(null)
    })().catch((e: unknown) => {
      if (state.alive) setBusy(null)
      setMessage(`准备失败：${e instanceof Error ? e.message : e}`)
    })
    return () => {
      state.alive = false
      stop.current()
    }
  }, [trip])

  useEffect(() => {
    if (reel && canvas.current) stop.current = playReel(canvas.current, reel)
  }, [reel])

  useEffect(
    () => () => {
      if (poster) URL.revokeObjectURL(poster)
    },
    [poster],
  )

  const name = `足迹手账-${material?.title ?? '出行'}`.replace(
    /[\\/:*?"<>|]/g,
    '_',
  )

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label)
    setMessage(undefined)
    try {
      await job()
    } catch (e) {
      setMessage(
        `${label.replace('…', '')}失败：${e instanceof Error ? e.message : e}`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="回看这次出行"
      className="fixed inset-0 z-[1000] flex flex-col items-center gap-3 overflow-y-auto bg-ink/80 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <canvas
        ref={canvas}
        width={REEL_W}
        height={REEL_H}
        className="max-h-[60dvh] w-auto max-w-full border-2 border-paper"
        aria-label="路线回放"
      />
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm"
          disabled={!reel || busy !== null}
          onClick={() => {
            stop.current()
            if (reel && canvas.current)
              stop.current = playReel(canvas.current, reel)
          }}
        >
          重播
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm bg-berry"
          disabled={!reel || busy !== null || !videoMime()}
          title={videoMime() ? undefined : '这个浏览器不支持录视频'}
          onClick={() =>
            void run('录视频中（要播完一遍）…', async () => {
              stop.current()
              const { blob, ext } = await recordReel(canvas.current!, reel!)
              await saveFile(blob, `${name}.${ext}`)
              setMessage(
                ext === 'webm'
                  ? '存成了 WebM 视频；微信可能发不了，可以先用别的 App 转成 MP4。'
                  : '视频存好了。',
              )
            })
          }
        >
          存成短视频
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm bg-sky"
          disabled={!material || busy !== null}
          onClick={() =>
            void run('生成海报…', async () => {
              const blob = await renderPoster(material!)
              setPoster(URL.createObjectURL(blob))
              await saveFile(blob, `${name}-路线海报.jpg`)
            })
          }
        >
          路线海报
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm bg-mint"
          disabled={!material || busy !== null}
          onClick={() =>
            void run('生成 PDF…', async () => {
              const pdf = await renderTripPdf(material!)
              await saveFile(pdf, `${name}.pdf`)
              setMessage(
                `PDF 手账存好了（${(pdf.size / 1048576).toFixed(1)} MB），可以拿去打印。`,
              )
            })
          }
        >
          导出 PDF 手账
        </button>
        <button type="button" className="px-btn px-btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>
      {busy && <p className="font-pixel text-[12px] text-paper">{busy}</p>}
      {message && (
        <p role="status" className="max-w-xs text-center text-xs text-paper">
          {message}
        </p>
      )}
      {poster && (
        <img
          src={poster}
          alt="路线海报"
          className="max-w-xs border-2 border-paper"
        />
      )}
    </div>
  )
}
