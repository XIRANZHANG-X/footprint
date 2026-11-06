import { useEffect, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { renderShareImage } from '../lib/shareImage.ts'
import { useObjectUrl } from './useObjectUrl.ts'

function fileName(record: JournalRecord) {
  const d = new Date(record.takenAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `足迹-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jpg`
}

// 下载：通过一个临时链接触发浏览器保存
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  // 安卓 Chrome 支持把图片直接交给系统分享面板（可以选微信）；不支持的浏览器只显示保存
  const canShare =
    file !== undefined && navigator.canShare?.({ files: [file] }) === true
  // 不能分享时说明原因，方便排查（例如微信内置浏览器、非 HTTPS、浏览器不支持分享文件）
  const shareBlocker = !file
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
          {file && (
            <button
              type="button"
              onClick={() => download(file, file.name)}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium"
            >
              保存图片
            </button>
          )}
          {file && canShare && (
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
        {shareBlocker && (
          <p className="max-w-xs text-center text-xs text-white/70">
            {shareBlocker}，请先保存图片，再从相册发到微信。
          </p>
        )}
      </div>
    </div>
  )
}
