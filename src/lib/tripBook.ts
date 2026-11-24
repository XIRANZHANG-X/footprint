import { db, type JournalRecord, type StoredPhoto } from '../db.ts'
import { cityOf } from './geo/area.ts'
import { imagesToPdf } from './pdf.ts'
import { recordBody } from './record.ts'
import { shortPlace } from './review.ts'
import { formatKm, tripPaths } from './route.ts'
import {
  renderDocument,
  type DocBlock,
  type RouteSketch,
  type Tag,
  C,
} from './shareImage.ts'
import type { Trip } from './trips.ts'
import { formatWeather } from './weather.ts'

// 回看一次出行（决策 0025）：路线海报、PDF 手账、短视频共用的素材

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const DAY = 86_400_000

export type TripMaterial = {
  title: string
  stats: string
  records: JournalRecord[] // 按时间正序
  photos: Map<string, StoredPhoto[]>
  sketch: RouteSketch
}

const titleOf = (r: JournalRecord) =>
  r.content?.title ?? (r.note.trim().slice(0, 12) || '一条记录')

export async function tripMaterial(
  trip: Trip<JournalRecord>,
): Promise<TripMaterial> {
  const records = [...trip.records].sort((a, b) => a.takenAt - b.takenAt)
  const [track, photoRows] = await Promise.all([
    db.track.where('t').between(trip.start, trip.end, true, true).sortBy('t'),
    db.photos
      .where('recordId')
      .anyOf(records.map((r) => r.id))
      .toArray(),
  ])
  const photos = new Map<string, StoredPhoto[]>()
  for (const p of photoRows.sort((a, b) => a.order - b.order))
    photos.set(p.recordId, [...(photos.get(p.recordId) ?? []), p])
  const paths = tripPaths(records, track)
  const located = records.filter((r) => r.location)
  const cities = [...new Set(records.flatMap((r) => cityOf(r) ?? []))]
  const days =
    Math.round(
      (new Date(trip.end).setHours(0, 0, 0, 0) -
        new Date(trip.start).setHours(0, 0, 0, 0)) /
        DAY,
    ) + 1
  const start = dayFmt.format(trip.start)
  const end = dayFmt.format(trip.end)
  return {
    title: `${cities.slice(0, 3).join(' · ') || '一次出行'}`,
    stats: [
      start === end ? start : `${start} – ${end}`,
      days > 1 ? `${days} 天` : '',
      `${records.length} 条`,
      formatKm(paths.km) ?? '',
    ]
      .filter(Boolean)
      .join(' · '),
    records,
    photos,
    sketch: {
      paths: paths.segments.map((s) => ({ points: s.path, long: s.long })),
      stops: located.map((r) => ({
        lat: r.location!.lat,
        lng: r.location!.lng,
        label: titleOf(r).slice(0, 8),
      })),
    },
  }
}

function recordTags(r: JournalRecord): Tag[] {
  return [
    { label: dayFmt.format(r.takenAt), fill: C.taro },
    ...(shortPlace(r.placeName)
      ? [{ label: shortPlace(r.placeName)!.slice(0, 14), fill: C.sky }]
      : []),
    ...(formatWeather(r.weather)
      ? [
          {
            label: formatWeather(r.weather)!.replace(/^\S+\s/, ''),
            fill: C.lemon,
          },
        ]
      : []),
  ]
}

// 路线海报：一张 1080 × 1920，标题、统计、路线示意图、按顺序的地方
export async function renderPoster(m: TripMaterial): Promise<Blob> {
  const blocks: DocBlock[] = [
    { kind: 'title', text: m.title },
    { kind: 'text', text: m.stats, soft: true },
    { kind: 'gap', h: 24 },
    { kind: 'route', sketch: m.sketch, h: 1100 },
    {
      kind: 'text',
      text: m.sketch.stops.map((s, i) => `${i + 1} ${s.label}`).join('　'),
      soft: true,
    },
  ]
  const [poster] = await renderDocument(blocks, { minHeight: 1920 })
  return poster
}

// PDF 手账：A5 竖版，封面（标题、统计、路线），之后每条记录：日期、地点、天气、正文、照片
export const PDF_PAGE_H = 1527 // 1080 宽时 A5 的高度

export async function renderTripPdf(m: TripMaterial): Promise<Blob> {
  const blocks: DocBlock[] = [
    { kind: 'title', text: m.title },
    { kind: 'text', text: m.stats, soft: true },
    { kind: 'gap', h: 16 },
    { kind: 'route', sketch: m.sketch, h: 900 },
  ]
  for (const r of m.records) {
    blocks.push(
      { kind: 'heading', text: titleOf(r) },
      { kind: 'tags', tags: recordTags(r) },
    )
    const body = recordBody(r).trim()
    if (body) blocks.push({ kind: 'text', text: body })
    const ps = (m.photos.get(r.id) ?? []).slice(0, 4)
    if (ps.length === 1)
      blocks.push({
        kind: 'photo',
        blob: ps[0].blob,
        width: ps[0].width,
        height: ps[0].height,
      })
    else if (ps.length > 1)
      blocks.push({ kind: 'photoGrid', blobs: ps.map((p) => p.blob) })
  }
  const pages = await renderDocument(blocks, { pageHeight: PDF_PAGE_H })
  return imagesToPdf(
    pages.map((jpeg) => ({ jpeg, width: 1080, height: PDF_PAGE_H })),
  )
}
