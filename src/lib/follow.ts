import {
  newShareKey,
  openNote,
  packShare,
  type ShareNote,
} from '../../shared/shareFormat.ts'
import {
  db,
  type JournalRecord,
  type ShareLink,
  type ShareOptions,
} from '../db.ts'
import { API, withToken } from './ai.ts'
import { recordBody } from './record.ts'
import { shortPlace } from './review.ts'
import { inZone } from './track.ts'
import { privacyZones } from './trackSync.ts'
import { tripMaterial } from './tripBook.ts'
import type { Trip } from './trips.ts'
import { formatWeather } from './weather.ts'

// 跟着看（决策 0026）：在手机上按隐私选项打包、加密、上传；链接里带钥匙，服务端打不开

const MAX_PHOTOS = 40
const PER_STOP = 3
const LONG_EDGE = 1280

export const DEFAULT_SHARE: ShareOptions = {
  text: true,
  photos: true,
  precision: 'exact',
  days: 30,
}

// 链接的网址：网页版就是当前网站；App 里是线上服务的地址（.env.app 的 VITE_API_BASE）
export function shareUrl(s: Pick<ShareLink, 'id' | 'key'>): string {
  const base = API.replace(/\/api$/, '') || location.origin
  return `${base}/s/${s.id}#k=${s.key}`
}

async function shrink(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const k = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * k)
    const h = Math.round(bitmap.height * k)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    return {
      bytes: new Uint8Array(await out.arrayBuffer()),
      width: w,
      height: h,
    }
  } finally {
    bitmap.close()
  }
}

// 大概：坐标只留到约 5 公里
const rough = (x: number) => Math.round(x * 20) / 20

export async function buildPackage(
  trip: Trip<JournalRecord>,
  key: string,
  options: ShareOptions,
  times: { createdAt: number; expiresAt: number },
): Promise<Uint8Array> {
  const m = await tripMaterial(trip)
  const zones = await privacyZones()
  const place = (p: { lat: number; lng: number } | null) => {
    if (!p || options.precision === 'none' || inZone(p, zones)) return null
    return options.precision === 'rough'
      ? { lat: rough(p.lat), lng: rough(p.lng) }
      : p
  }
  let photoBudget = options.photos ? MAX_PHOTOS : 0
  const stops = []
  for (const r of m.records) {
    const photos = []
    for (const p of (m.photos.get(r.id) ?? []).slice(0, PER_STOP)) {
      if (photoBudget <= 0) break
      photos.push(await shrink(p.blob))
      photoBudget--
    }
    const at = place(r.location)
    stops.push({
      title: r.content?.title ?? (r.note.trim().slice(0, 16) || '一条记录'),
      date: r.takenAt,
      place: shortPlace(r.placeName),
      weather: formatWeather(r.weather),
      body: options.text ? recordBody(r).trim() || null : null,
      lat: at?.lat ?? null,
      lng: at?.lng ?? null,
      photos,
    })
  }
  const paths =
    options.precision === 'none'
      ? []
      : m.sketch.paths.map((p) => ({
          long: p.long,
          points: p.points.flatMap((q) => place(q) ?? []),
        }))
  return packShare(key, {
    v: 1,
    title: m.title,
    stats: m.stats,
    createdAt: times.createdAt,
    updatedAt: Date.now(),
    expiresAt: times.expiresAt,
    showMap: options.precision !== 'none',
    paths: paths.filter((p) => p.points.length > 1),
    stops,
  })
}

async function send(path: string, init: RequestInit) {
  const res = await fetch(`${API}${path}`, withToken(init))
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok)
    throw new Error(String(body?.error ?? `请求失败（${res.status}）`))
  return body!
}

export async function createShare(
  trip: Trip<JournalRecord>,
  options: ShareOptions,
): Promise<ShareLink> {
  const key = newShareKey()
  const now = Date.now()
  const expiresAt = now + options.days * 86_400_000
  const pkg = await buildPackage(trip, key, options, {
    createdAt: now,
    expiresAt,
  })
  const r = await send(`/share?days=${options.days}`, {
    method: 'PUT',
    body: pkg as Uint8Array<ArrayBuffer>,
  })
  const link: ShareLink = {
    id: String(r.id),
    tripId: trip.id,
    key,
    editKey: String(r.editKey),
    options,
    createdAt: now,
    updatedAt: now,
    expiresAt: Number(r.expiresAt),
    recordCount: trip.records.length,
  }
  await db.shares.put(link)
  return link
}

export async function updateShare(
  link: ShareLink,
  trip: Trip<JournalRecord>,
): Promise<void> {
  const pkg = await buildPackage(trip, link.key, link.options, link)
  await send(`/share/${link.id}`, {
    method: 'PUT',
    body: pkg as Uint8Array<ArrayBuffer>,
    headers: { 'X-Edit-Key': link.editKey },
  })
  await db.shares.update(link.id, {
    updatedAt: Date.now(),
    recordCount: trip.records.length,
  })
}

export async function revokeShare(link: ShareLink): Promise<void> {
  try {
    await send(`/share/${link.id}`, {
      method: 'DELETE',
      headers: { 'X-Edit-Key': link.editKey },
    })
  } catch (e) {
    // 已经过期、服务端没了：本机的也删掉
    if (!/不存在|过期/.test(e instanceof Error ? e.message : '')) throw e
  }
  await db.shares.delete(link.id)
}

export async function readNotes(link: ShareLink): Promise<ShareNote[]> {
  const res = await fetch(`${API}/share/${link.id}/notes`)
  const { notes } = (await res.json()) as { notes: { data: string }[] }
  const out: ShareNote[] = []
  for (const n of notes)
    try {
      out.push(await openNote(link.key, n.data))
    } catch {
      // 打不开的（不是用这把钥匙加密的）跳过
    }
  return out
}

// 出行里多了记录：自动更新还没过期的链接（决策 0026 第 4 条）
export async function refreshShares(
  trips: Trip<JournalRecord>[],
): Promise<number> {
  const links = await db.shares.toArray()
  let n = 0
  for (const link of links) {
    if (link.expiresAt < Date.now()) continue
    const trip = trips.find((t) => t.id === link.tripId)
    if (!trip || trip.records.length === link.recordCount) continue
    try {
      await updateShare(link, trip)
      n++
    } catch {
      return n // 没网、没口令：下次再试
    }
  }
  return n
}
