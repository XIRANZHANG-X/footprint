import type { Weather } from '../../shared/ai.ts'
import { db } from '../db.ts'

// 当时的天气（决策 0025）：给有位置、拍摄时间可靠的记录在后台补上，卡片和 PDF 手账里显示。
// 查询经过我们的服务端转发给 Open-Meteo，只发坐标和时间

// WMO 天气代码 → 文字（只分到常用的几类）
export function weatherText(code: number | null): string | null {
  if (code === null) return null
  if (code === 0) return '☀️ 晴'
  if (code <= 2) return '🌤️ 多云'
  if (code === 3) return '☁️ 阴'
  if (code === 45 || code === 48) return '🌫️ 雾'
  if (code >= 51 && code <= 57) return '🌦️ 毛毛雨'
  if (code === 61 || code === 80) return '🌦️ 小雨'
  if (code === 63 || code === 81) return '🌧️ 中雨'
  if (code === 65 || code === 82 || code === 66 || code === 67) return '🌧️ 大雨'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️ 雪'
  if (code >= 95) return '⛈️ 雷雨'
  return null
}

export function formatWeather(w: Weather | null | undefined): string | null {
  if (!w) return null
  const parts = [
    weatherText(w.code),
    w.tempC !== null ? `${Math.round(w.tempC)}°C` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

let running: Promise<void> | null = null

// 每次最多补 10 条，一条一条来；查不到（太早、海上）也记下 null，不再查。网络出错不记，下次再试
export function backfillWeather(): Promise<void> {
  running ??= (async () => {
    try {
      const { fetchWeather } = await import('./ai.ts')
      const hourAgo = Date.now() - 3_600_000
      const todo = await db.records
        .filter(
          (r) =>
            r.weather === undefined &&
            r.location !== null &&
            r.takenAt < hourAgo &&
            (r.timeSource === 'exif' || r.timeSource === 'manual'),
        )
        .limit(10)
        .toArray()
      for (const r of todo) {
        try {
          const w = await fetchWeather(
            r.location!.lat,
            r.location!.lng,
            r.takenAt,
          )
          await db.records.update(r.id, {
            weather: w.tempC === null && w.code === null ? null : w,
          })
        } catch {
          return // 没网、没口令：这次先停
        }
      }
    } finally {
      running = null
    }
  })()
  return running
}
