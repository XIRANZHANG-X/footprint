import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db.ts'
import type { LatLng } from '../lib/photoMeta.ts'
import {
  inZone,
  offsetZoneCenter,
  ZONE_RADII,
  ZONES_KEY,
  type PrivacyZone,
} from '../lib/track.ts'
import { PlaceSearch } from './PlaceSearch.tsx'

// 隐私区（决策 0022 第 3 条）：家、公司附近的轨迹点不存。
// 圆心存的时候随机偏一点，别人不能从圈推出确切位置；加的时候，已有轨迹里圈内的点也一起删掉

const label = (m: number) => (m < 1000 ? `${m} 米` : `${m / 1000} 公里`)

export function PrivacyZonesCard() {
  const zones =
    useLiveQuery(
      async () =>
        ((await db.settings.get(ZONES_KEY))?.value as
          PrivacyZone[] | undefined) ?? [],
    ) ?? []
  const [name, setName] = useState('家')
  const [radius, setRadius] = useState(1000)
  const [message, setMessage] = useState<string>()
  const [locating, setLocating] = useState(false)

  async function add(center: LatLng) {
    const o = offsetZoneCenter(center, radius)
    const zone: PrivacyZone = {
      id: crypto.randomUUID(),
      name: name.trim() || '隐私区',
      ...o.center,
      radiusM: Math.round(o.radiusM),
    }
    const next = [...zones, zone]
    await db.settings.put({ key: ZONES_KEY, value: next })
    // 已有的轨迹里落在这个圈里的点删掉
    const inside = (await db.track.toArray()).filter((p) => inZone(p, [zone]))
    await db.track.bulkDelete(inside.flatMap((p) => (p.id ? [p.id] : [])))
    setMessage(
      `加好了"${zone.name}"${inside.length ? `，删掉了已有轨迹里圈内的 ${inside.length} 个点` : ''}。`,
    )
  }

  function useHere() {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        void add({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      (e) => {
        setLocating(false)
        setMessage(`取不到当前位置：${e.message}`)
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    )
  }

  return (
    <div className="px-card p-3 text-sm">
      <p className="px-title text-[16px]">隐私区</p>
      <p className="mt-1 text-xs text-ink-soft">
        记录路线时，家、公司附近的点不存，路线、备份、以后的分享链接里都不会出现。圈的位置会随机偏一点。
      </p>
      {zones.length > 0 && (
        <ul className="mt-2 space-y-1">
          {zones.map((z) => (
            <li key={z.id} className="flex items-center justify-between gap-2">
              <span>
                {z.name} · 半径约 {label(Math.round(z.radiusM / 100) * 100)}
              </span>
              <button
                type="button"
                className="text-xs text-cherry underline"
                aria-label={`删掉隐私区"${z.name}"`}
                onClick={() =>
                  void db.settings.put({
                    key: ZONES_KEY,
                    value: zones.filter((x) => x.id !== z.id),
                  })
                }
              >
                删掉
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="px-input w-24"
          aria-label="隐私区的名字"
          maxLength={10}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="px-input w-28"
          aria-label="隐私区的半径"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        >
          {ZONE_RADII.map((r) => (
            <option key={r} value={r}>
              半径 {label(r)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="px-btn px-btn-sm bg-sky"
          disabled={locating}
          onClick={useHere}
        >
          {locating ? '定位中…' : '用当前位置'}
        </button>
      </div>
      <div className="mt-2">
        <PlaceSearch
          placeholder="或者搜一个地方当圆心"
          onPick={(p) => void add({ lat: p.lat, lng: p.lng })}
        />
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
