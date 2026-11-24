import type { Weather } from '../shared/ai.ts'

// 当时的天气（决策 0025）：Open-Meteo（免费、不要 key，数据协议 CC BY 4.0）。
// 经过我们的服务端转发，第三方看不到用户的 IP；只发坐标和时间，结果缓存，不存。
// 最近两个月用预报接口（它保留过去 92 天）；更早的用历史接口（有约 5 天延迟，正好错开）

const RECENT_MS = 60 * 86_400_000
const cache = new Map<string, Weather>()

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

type Hourly = {
  utc_offset_seconds?: number
  hourly?: {
    time?: string[]
    temperature_2m?: (number | null)[]
    weather_code?: (number | null)[]
  }
}

export async function weatherAt(
  lat: number,
  lng: number,
  t: number,
  now = Date.now(),
): Promise<Weather> {
  // 同一个小时、约 1 公里内算同一个结果
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${Math.floor(t / 3_600_000)}`
  const hit = cache.get(key)
  if (hit) return hit
  const recent = now - t < RECENT_MS
  const url = new URL(
    recent
      ? 'https://api.open-meteo.com/v1/forecast'
      : 'https://archive-api.open-meteo.com/v1/archive',
  )
  // 前后各多要一天：当地日期和 UTC 日期可能差一天
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start_date: isoDate(t - 86_400_000),
    end_date: isoDate(t + 86_400_000),
    hourly: 'temperature_2m,weather_code',
    timezone: 'auto',
  }).toString()
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`天气服务返回 ${res.status}`)
  const j = (await res.json()) as Hourly
  const times = j.hourly?.time ?? []
  const offset = (j.utc_offset_seconds ?? 0) * 1000
  // 时间是当地时间（没有时区），减去时差得到 UTC，取离拍摄时间最近的那个小时
  let best = -1
  let bestD = Infinity
  for (const [i, s] of times.entries()) {
    const d = Math.abs(Date.parse(`${s}Z`) - offset - t)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const w: Weather =
    best >= 0 && bestD <= 90 * 60_000
      ? {
          tempC: j.hourly?.temperature_2m?.[best] ?? null,
          code: j.hourly?.weather_code?.[best] ?? null,
        }
      : { tempC: null, code: null }
  cache.set(key, w)
  return w
}
