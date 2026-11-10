import type { LatLng, PhotoMeta, TimeSource } from './photoMeta.ts'

// manual：用户在地图上手动点选的地点
export type LocationStatus = 'gps' | 'pending' | 'manual'

export type RecordSummary = {
  takenAt: number
  timeSource: TimeSource
  location: LatLng | null
  locationStatus: LocationStatus
}

// 一次导入的照片组成一条记录（"在某个地方的一次停留"）。
// 时间取最早的一张；地点取最早一张带 GPS 的照片，都没有就标为"待定位"，P3 在地图上补。
export function summarizeRecord(photos: PhotoMeta[]): RecordSummary {
  if (photos.length === 0) throw new Error('记录至少需要一张照片')
  const sorted = [...photos].sort((a, b) => a.takenAt - b.takenAt)
  // 只要有一张照片带拍摄时间，就用带拍摄时间的照片里最早的那张，不让不可靠的文件时间抢先
  const withExifTime = sorted.filter((p) => p.timeSource === 'exif')
  const timeRef = withExifTime[0] ?? sorted[0]
  const location = sorted.find((p) => p.location !== null)?.location ?? null
  return {
    takenAt: timeRef.takenAt,
    timeSource: timeRef.timeSource,
    location,
    locationStatus: location ? 'gps' : 'pending',
  }
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`

// 卡片上显示的整理耗时，例如"整理用时 5.2 秒（地名 0.9 秒 · 缩图 0.3 秒 · 模型 4.8 秒）"
export function formatTimings(t: {
  geocodeMs: number | null
  imagesMs: number
  modelMs: number
  totalMs: number
}): string {
  const parts = [
    ...(t.geocodeMs === null ? [] : [`地名 ${sec(t.geocodeMs)}`]),
    `缩图 ${sec(t.imagesMs)}`,
    `模型 ${sec(t.modelMs)}`,
  ]
  return `整理用时 ${sec(t.totalMs)}（${parts.join(' · ')}）`
}

type BodyFields = {
  note: string
  bodySource: 'own' | 'ai'
  content: { intro: string } | null
}

// 卡片和分享图上显示的正文（决策 0012）：用户选了哪一版就显示哪一版；
// 选了 AI 版但 AI 还没写出正文时，退回用户自己写的
export function recordBody(r: BodyFields): string {
  if (r.bodySource === 'own') return r.note
  return r.content?.intro || r.note
}

// 自己写的和 AI 写的两版都在，才谈得上"换成另一版"
export function hasBothVersions(r: BodyFields): boolean {
  return r.note.trim() !== '' && (r.content?.intro ?? '').trim() !== ''
}

// 草稿提示里的一句话摘要，例如"3 张照片 · 排了一小时的面…"
export function draftSummary(d: { files: unknown[]; note: string }): string {
  const text = d.note.trim()
  const chars = Array.from(text)
  return [
    d.files.length > 0 ? `${d.files.length} 张照片` : null,
    text
      ? chars.length > 12
        ? `${chars.slice(0, 12).join('')}…`
        : text
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
