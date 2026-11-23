import { useEffect, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import {
  isNativeApp,
  saveFile,
  shareImageNative,
  shareImagesNative,
} from '../lib/saveFile.ts'
import {
  LAYOUT_NAMES,
  LAYOUTS,
  pickLayout,
  renderShare,
  type ShareLayout,
} from '../lib/shareImage.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function datePart(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function PreviewImage({ blob, small }: { blob: Blob; small?: boolean }) {
  const url = useObjectUrl(blob)
  return url ? (
    <img
      src={url}
      alt="分享图预览"
      className={
        small
          ? 'h-24 w-auto border-2 border-ink'
          : 'max-h-[60dvh] w-auto shrink-0 border-2 border-paper'
      }
    />
  ) : null
}

export type ShareOption = {
  key: string
  label: string
  render: () => Promise<Blob[]>
}

// 分享图预览和保存（决策 0014 第 3B 条）。几种版式各自生成，上面一排小预览可以切换；
// 一个版式可能是几张图（长图分页、朋友圈多图），一起存、一起分享
export function ShareSheet({
  options,
  initial,
  baseName,
  onClose,
}: {
  options: ShareOption[]
  initial: string | null // 自动选中的版式；null 表示还在算
  baseName: string // 文件名前缀，例如"足迹-20261123"
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string | null>(initial)
  useEffect(() => {
    if (initial && chosen === null) setChosen(initial)
  }, [initial, chosen])
  const [images, setImages] = useState<Record<string, Blob[]>>({})
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  // 先生成选中的版式，再依次生成其余版式的小预览
  useEffect(() => {
    if (!chosen) return
    let cancelled = false
    void (async () => {
      const order = [
        chosen,
        ...options.map((o) => o.key).filter((k) => k !== chosen),
      ]
      for (const key of order) {
        if (cancelled) return
        if (images[key]) continue
        try {
          const blobs = await options.find((o) => o.key === key)!.render()
          if (!cancelled) setImages((m) => ({ ...m, [key]: blobs }))
        } catch (e) {
          if (!cancelled && key === chosen)
            setError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // images 只是缓存，变化时不需要重新排队
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, options])

  const blobs = chosen ? images[chosen] : undefined
  const files =
    blobs?.map(
      (b, i) =>
        new File([b], `${baseName}${blobs.length > 1 ? `-${i + 1}` : ''}.jpg`, {
          type: 'image/jpeg',
        }),
    ) ?? []
  const native = isNativeApp()

  // App 里只有一个"分享"按钮：先自动存进相册，再打开系统分享面板（用户 2026-11-08 定）
  const shareInApp = async () => {
    setNotice(undefined)
    try {
      const r =
        files.length === 1
          ? await shareImageNative(files[0], files[0].name)
          : await shareImagesNative(files)
      setNotice(
        r.savedToGallery
          ? `已保存 ${files.length} 张到相册的“足迹手账”相簿`
          : `没能存到相册：${r.reason}`,
      )
    } catch (e) {
      setNotice(`分享失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 安卓 Chrome 支持把图片直接交给系统分享面板（可以选微信）；不支持的浏览器只显示保存
  const canShare = files.length > 0 && navigator.canShare?.({ files }) === true
  // 不能分享时说明原因，方便排查（例如微信内置浏览器、非 HTTPS、浏览器不支持分享文件）
  const shareBlocker =
    files.length === 0 || native
      ? null
      : !window.isSecureContext
        ? '当前页面不是安全连接（HTTPS）'
        : typeof navigator.share !== 'function'
          ? '这个浏览器不支持系统分享'
          : !canShare
            ? '这个浏览器不支持分享图片文件'
            : null

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 overflow-y-auto bg-ink/80 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col items-center gap-3"
      >
        {options.length > 1 && (
          <div className="flex w-full gap-2 overflow-x-auto pb-1">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={chosen === o.key}
                onClick={() => {
                  setError(undefined)
                  setNotice(undefined)
                  setChosen(o.key)
                }}
                className={`flex shrink-0 flex-col items-center gap-1 border-2 p-1 ${
                  chosen === o.key
                    ? 'border-lemon bg-lemon'
                    : 'border-transparent'
                }`}
              >
                {images[o.key] ? (
                  <PreviewImage blob={images[o.key][0]} small />
                ) : (
                  <span className="flex h-24 w-14 items-center justify-center border-2 border-paper/50 text-xs text-paper">
                    …
                  </span>
                )}
                <span
                  className={`font-pixel text-[12px] ${chosen === o.key ? 'text-ink' : 'text-paper'}`}
                >
                  {o.label}
                </span>
              </button>
            ))}
          </div>
        )}

        {blobs ? (
          <div className="flex max-w-full gap-2 overflow-x-auto">
            {blobs.map((b, i) => (
              <PreviewImage key={i} blob={b} />
            ))}
          </div>
        ) : (
          <p className="font-pixel text-[12px] text-paper">
            {error ? `生成失败：${error}` : '生成中…'}
          </p>
        )}
        {blobs && blobs.length > 1 && (
          <p className="text-xs text-paper">
            共 {blobs.length} 张，左右滑动查看
          </p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="px-btn">
            关闭
          </button>
          {files.length > 0 && native && (
            <button
              type="button"
              onClick={() => void shareInApp()}
              className="px-btn bg-berry"
            >
              存相册并分享…
            </button>
          )}
          {files.length > 0 && !native && (
            <button
              type="button"
              onClick={() =>
                void (async () => {
                  for (const f of files)
                    await saveFile(f, f.name).catch(() => {})
                })()
              }
              className="px-btn"
            >
              {files.length > 1 ? `保存 ${files.length} 张` : '保存图片'}
            </button>
          )}
          {canShare && !native && (
            <button
              type="button"
              onClick={() => void navigator.share({ files }).catch(() => {})}
              className="px-btn bg-berry"
            >
              分享…
            </button>
          )}
        </div>
        {notice && (
          <p className="max-w-xs text-center text-xs text-paper">{notice}</p>
        )}
        {shareBlocker && (
          <p className="max-w-xs text-center text-xs text-paper">
            {shareBlocker}，请先保存图片，再从相册发到微信。
          </p>
        )}
      </div>
    </div>
  )
}

// 一条记录的分享图：五种版式，默认选自动推荐的那种
export function SharePreview({
  record,
  onClose,
}: {
  record: JournalRecord
  onClose: () => void
}) {
  const [options, setOptions] = useState<ShareOption[]>([])
  const [initial, setInitial] = useState<ShareLayout | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const photos = await db.photos
        .where('recordId')
        .equals(record.id)
        .sortBy('order')
      if (cancelled) return
      setOptions(
        LAYOUTS.map((key) => ({
          key,
          label: LAYOUT_NAMES[key],
          render: () => renderShare(record, photos, key),
        })),
      )
      const picked = await pickLayout(record, photos.length)
      if (!cancelled) setInitial(picked)
    })()
    return () => {
      cancelled = true
    }
  }, [record])

  return (
    <ShareSheet
      options={options}
      initial={initial}
      baseName={`足迹-${datePart(record.takenAt)}`}
      onClose={onClose}
    />
  )
}
