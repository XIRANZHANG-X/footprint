import { useEffect, useRef, useState } from 'react'
import type { StoredPhoto } from '../db.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function Slide({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return (
    <div className="flex h-full w-full shrink-0 snap-center items-center justify-center p-2">
      {url && (
        <img
          src={url}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  )
}

// 全屏看大图。左右滑动用的是浏览器自带的横向滚动 + 吸附（scroll-snap），
// 不用自己处理手势，滑动的手感也和系统相册一致
export function PhotoViewer({
  photos,
  start,
  onClose,
}: {
  photos: StoredPhoto[]
  start: number
  onClose: () => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(start)

  const go = (i: number, smooth = true) => {
    const el = strip.current
    if (!el) return
    const next = Math.min(photos.length - 1, Math.max(0, i))
    el.scrollTo({
      left: next * el.clientWidth,
      behavior: smooth ? 'smooth' : 'instant',
    })
  }

  // 打开时直接停在点的那一张；看图时页面本身不跟着滚
  useEffect(() => {
    go(start, false)
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
    // 只在打开时执行一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const arrow =
    'absolute top-1/2 hidden -translate-y-1/2 border-2 border-paper bg-ink px-3 py-2 text-paper sm:block'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="查看照片"
      className="fixed inset-0 z-[1000] flex flex-col bg-ink"
    >
      <div className="flex items-center justify-between px-3 py-2 text-paper">
        <span className="font-pixel text-[14px]">
          {index + 1} / {photos.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="border-2 border-paper px-3 py-1 text-sm"
        >
          关闭
        </button>
      </div>
      <div
        ref={strip}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / el.clientWidth))
        }}
      >
        {photos.map((p) => (
          <Slide key={p.id} blob={p.blob} />
        ))}
      </div>
      {/* 箭头只在宽屏（电脑）上显示；手机上直接滑 */}
      {index > 0 && (
        <button
          type="button"
          aria-label="上一张"
          className={`${arrow} left-3`}
          onClick={() => go(index - 1)}
        >
          ‹
        </button>
      )}
      {index < photos.length - 1 && (
        <button
          type="button"
          aria-label="下一张"
          className={`${arrow} right-3`}
          onClick={() => go(index + 1)}
        >
          ›
        </button>
      )}
    </div>
  )
}
