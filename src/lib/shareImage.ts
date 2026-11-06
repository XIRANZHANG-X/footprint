import type { JournalRecord, StoredPhoto } from '../db.ts'
import { coverCrop, photoSlots, wrapText } from './layout.ts'

// 1080×1920 竖图（手机全屏比例），完全在本地生成，不经过服务端（决策 0002）
export const SHARE_W = 1080
export const SHARE_H = 1920

const PAD = 72
const GAP = 8
const FONT =
  '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif'
const C = {
  bg: '#faf7f2',
  ink: '#1f2937',
  muted: '#6b7280',
  accent: '#047857',
  tagBg: '#d1fae5',
}

const dateFmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' })

function shortPlace(placeName: string | null) {
  // "某某面馆（上海市 · 黄浦区 · 南京东路）" 在分享图上只留店名或第一段地址
  if (!placeName) return null
  return placeName.split('（')[0].split(' · ').slice(0, 2).join(' · ')
}

export async function renderShareImage(
  record: JournalRecord,
  photos: StoredPhoto[],
): Promise<Blob> {
  const canvas = new OffscreenCanvas(SHARE_W, SHARE_H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, SHARE_W, SHARE_H)

  // 照片区：顶部 1080×1080 正方形，最多 4 张
  const slots = photoSlots(photos.length, SHARE_W, GAP)
  for (const [i, slot] of slots.entries()) {
    const bitmap = await createImageBitmap(photos[i].blob)
    const crop = coverCrop(bitmap.width, bitmap.height, slot.w, slot.h)
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      slot.x,
      slot.y,
      slot.w,
      slot.h,
    )
    bitmap.close()
  }

  const width = SHARE_W - PAD * 2
  let y = SHARE_W + 96
  const text = (s: string, size: number, color: string, weight = 400) => {
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.fillText(s, PAD, y)
  }
  const measureWith =
    (size: number, weight = 400) =>
    (s: string) => {
      ctx.font = `${weight} ${size}px ${FONT}`
      return ctx.measureText(s).width
    }

  const content = record.content
  // 标题：没有 AI 正文时用原话开头，再没有就用日期
  const title =
    content?.title ??
    (record.note.slice(0, 16) || dateFmt.format(record.takenAt))
  for (const line of wrapText(title, width, measureWith(64, 700), 2)) {
    text(line, 64, C.ink, 700)
    y += 84
  }

  y += 4
  const meta = [dateFmt.format(record.takenAt), shortPlace(record.placeName)]
    .filter(Boolean)
    .join(' · ')
  text(meta, 34, C.muted)
  y += 76

  // 正文占据剩余空间，底部给标签和落款留出位置
  const body = content?.intro ?? record.note
  const lineHeight = 62
  const bodyBottom = SHARE_H - 220
  const maxLines = Math.max(1, Math.floor((bodyBottom - y) / lineHeight))
  for (const line of wrapText(body, width, measureWith(40), maxLines)) {
    text(line, 40, C.ink)
    y += lineHeight
  }

  // 标签：一行排不下的就不画了
  const tags = content?.tags ?? []
  if (tags.length) {
    let x = PAD
    const ty = SHARE_H - 170
    ctx.font = `400 32px ${FONT}`
    for (const tag of tags) {
      const label = `#${tag}`
      const w = ctx.measureText(label).width + 40
      if (x + w > SHARE_W - PAD) break
      ctx.fillStyle = C.tagBg
      ctx.beginPath()
      ctx.roundRect(x, ty - 40, w, 56, 28)
      ctx.fill()
      ctx.fillStyle = C.accent
      ctx.fillText(label, x + 20, ty)
      x += w + 16
    }
  }

  ctx.font = `500 28px ${FONT}`
  ctx.fillStyle = C.muted
  ctx.fillText('足迹手账', PAD, SHARE_H - 64)

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}
