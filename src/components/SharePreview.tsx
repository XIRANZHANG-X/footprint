import { useEffect, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { isNativeApp, saveFile, shareImageNative } from '../lib/saveFile.ts'
import { renderShareImage } from '../lib/shareImage.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function fileName(record: JournalRecord) {
  const d = new Date(record.takenAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `足迹-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jpg`
}

function PreviewImage({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return url ? (
    <img
      src={url}
      alt="分享图预览"
      className="max-h-[70dvh] w-auto rounded-lg shadow"
    />
  ) : null
}

export function SharePreview({
  record,
  onClose,
}: {
  record: JournalRecord
  onClose: () => void
}) {
  const [blob, setBlob] = useState<Blob>()
  const [error, setError] = useState<string>()
  // App 里点分享后显示"已存到相册"或存相册失败的原因
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const photos = await db.photos
          .where('recordId')
          .equals(record.id)
          .sortBy('order')
        const b = await renderShareImage(record, photos)
        if (!cancelled) setBlob(b)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [record])

  const file =
    blob && new File([blob], fileName(record), { type: 'image/jpeg' })
  // App 里只有一个"分享"按钮：先自动存进相册，再打开系统分享面板（用户 2026-11-08 定）
  const native = isNativeApp()
  const shareInApp = async (f: File) => {
    setNotice(undefined)
    try {
      const r = await shareImageNative(f, f.name)
      setNotice(
        r.savedToGallery
          ? '已保存到相册的“足迹手账”相簿'
          : `没能存到相册：${r.reason}`,
      )
    } catch (e) {
      setNotice(`分享失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 安卓 Chrome 支持把图片直接交给系统分享面板（可以选微信）；不支持的浏览器只显示保存
  const canShare =
    file !== undefined && navigator.canShare?.({ files: [file] }) === true
  // 不能分享时说明原因，方便排查（例如微信内置浏览器、非 HTTPS、浏览器不支持分享文件）
  const shareBlocker =
    !file || native
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
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-3"
      >
        {blob ? (
          <PreviewImage blob={blob} />
        ) : (
          <p className="text-sm text-white">
            {error ? `生成失败：${error}` : '生成中…'}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/20 px-4 py-2 text-sm text-white"
          >
            关闭
          </button>
          {file && native && (
            <button
              type="button"
              onClick={() => void shareInApp(file)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
            >
              存相册并分享…
            </button>
          )}
          {file && !native && (
            <button
              type="button"
              onClick={() => void saveFile(file, file.name).catch(() => {})}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium"
            >
              保存图片
            </button>
          )}
          {file && canShare && !native && (
            <button
              type="button"
              onClick={() =>
                void navigator.share({ files: [file] }).catch(() => {})
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
            >
              分享…
            </button>
          )}
        </div>
        {notice && (
          <p className="max-w-xs text-center text-xs text-white/80">{notice}</p>
        )}
        {shareBlocker && (
          <p className="max-w-xs text-center text-xs text-white/70">
            {shareBlocker}，请先保存图片，再从相册发到微信。
          </p>
        )}
      </div>
    </div>
  )
}
