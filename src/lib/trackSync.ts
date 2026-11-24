import { registerPlugin } from '@capacitor/core'
import { db, type TrackEvent } from '../db.ts'
import type { LatLng } from './photoMeta.ts'
import { setRecordLocation } from './recordEdits.ts'
import { inNativeApp } from './reminder.ts'
import {
  GAP_MS,
  inZone,
  locateAt,
  parseGpx,
  ZONES_KEY,
  type PrivacyZone,
  type TrackPoint,
} from './track.ts'

// 轨迹进出数据库（决策 0022）：从安卓后台服务取点、导入 GPX、用轨迹给"待定位"的记录补位置。
// 隐私区里的点一律不存（第 3 条）

// android/app/src/main/java/.../TrackerPlugin.java
export type TrackerStatus = {
  running: boolean
  precise: boolean
  startedAt: number
  pending: number
  brand?: string // 手机厂商（小写），体检里按品牌给设置路径（决策 0030）
}
export const Tracker = registerPlugin<{
  start(o: { precise: boolean }): Promise<TrackerStatus>
  stop(): Promise<TrackerStatus>
  getStatus(): Promise<TrackerStatus>
  // 暂存文件里有两种行：轨迹点，和记录体检的事件（有 ev 字段，决策 0030）
  drain(): Promise<{
    points: (
      | { t: number; lat: number; lng: number; acc: number; p: string }
      | Omit<TrackEvent, 'id'>
    )[]
  }>
  openBatterySettings(): Promise<void>
}>('Tracker')

export async function privacyZones(): Promise<PrivacyZone[]> {
  return (
    ((await db.settings.get(ZONES_KEY))?.value as PrivacyZone[] | undefined) ??
    []
  )
}

// 存点：去掉隐私区里的，去掉和已有的同一时刻重复的。返回存了几个
async function savePoints(points: TrackPoint[]): Promise<number> {
  if (points.length === 0) return 0
  const zones = await privacyZones()
  const kept = points.filter((p) => !inZone(p, zones))
  if (kept.length === 0) return 0
  const ts = kept.map((p) => p.t)
  const existing = new Set(
    (
      await db.track
        .where('t')
        .between(Math.min(...ts), Math.max(...ts), true, true)
        .toArray()
    ).map((p) => p.t),
  )
  const fresh = kept.filter((p) => !existing.has(p.t))
  await db.track.bulkAdd(fresh)
  return fresh.length
}

let syncing: Promise<number> | null = null

// 打开 App、回到前台时调用：把后台服务记下的点取进数据库，再给"待定位"的记录补位置
export function syncNativeTrack(): Promise<number> {
  if (!inNativeApp()) return Promise.resolve(0)
  syncing ??= (async () => {
    try {
      const { points: lines } = await Tracker.drain()
      const events = lines.filter((l): l is Omit<TrackEvent, 'id'> => 'ev' in l)
      if (events.length) await db.trackEvents.bulkAdd(events)
      const points = lines.filter(
        (l): l is Exclude<(typeof lines)[number], Omit<TrackEvent, 'id'>> =>
          !('ev' in l),
      )
      const added = await savePoints(
        points.map((p) => ({
          t: p.t,
          lat: p.lat,
          lng: p.lng,
          acc: p.acc >= 0 ? p.acc : null,
          src: p.p || 'gps',
        })),
      )
      if (added > 0) await fillPendingFromTrack()
      return added
    } finally {
      syncing = null
    }
  })()
  return syncing
}

export async function importGpxFile(
  file: File,
): Promise<{ read: number; added: number }> {
  const points = parseGpx(await file.text())
  const added = await savePoints(points)
  if (added > 0) await fillPendingFromTrack()
  return { read: points.length, added }
}

// 按时间到轨迹里找位置：只取前后 30 分钟的点
export async function locationFromTrack(t: number): Promise<LatLng | null> {
  const around = await db.track
    .where('t')
    .between(t - GAP_MS, t + GAP_MS, true, true)
    .sortBy('t')
  return locateAt(around, t)
}

// "待定位"的记录用轨迹补位置。只补拍摄时间可靠的：照片自带的拍摄时间，或者"只写几句"写下的那一刻。
// 文件时间不算：微信传过来的照片，文件时间是保存的时间，不是拍的时间，按它找位置会找错地方
export async function fillPendingFromTrack(): Promise<number> {
  const pending = await db.records
    .filter(
      (r) =>
        r.locationStatus === 'pending' &&
        (r.timeSource === 'exif' || r.timeSource === 'manual'),
    )
    .toArray()
  let filled = 0
  for (const r of pending) {
    const loc = await locationFromTrack(r.takenAt)
    if (!loc) continue
    await setRecordLocation(r.id, loc, 'track')
    filled++
  }
  return filled
}
