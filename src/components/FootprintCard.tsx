import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, type JournalRecord, type VisitedPlace } from '../db.ts'
import { footprint, HOME_KEY, type Home } from '../lib/footprint.ts'
import { formatKm } from '../lib/route.ts'
import type { TrackPoint } from '../lib/track.ts'
import { PlaceSearch } from './PlaceSearch.tsx'

// 地图页顶部的"足迹总览"（决策 0020 第 4、5 条）：国家和地区、城市、总里程、离家最远、补的地方。
// 常驻城市由用户自己设（第 5 条），只存在手机里

export function FootprintCard({
  records,
  visited,
  track,
}: {
  records: JournalRecord[]
  visited: VisitedPlace[]
  track: TrackPoint[]
}) {
  const home = useLiveQuery(
    async () =>
      ((await db.settings.get(HOME_KEY))?.value as Home | undefined) ?? null,
  )
  const [showCountries, setShowCountries] = useState(false)
  const [settingHome, setSettingHome] = useState(false)
  const f = useMemo(
    () => footprint(records, visited, home ?? null, track),
    [records, visited, home, track],
  )

  const cell = 'flex flex-col items-center px-1 py-1.5'
  const big = 'font-pixel text-[16px]'
  const small = 'text-[11px] text-ink-soft'
  return (
    <div className="px-card mb-4 p-3 text-sm">
      <p className="px-title text-[16px]">足迹总览</p>
      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
        <button
          type="button"
          className={`${cell} hover:bg-paper`}
          aria-expanded={showCountries}
          onClick={() => setShowCountries(!showCountries)}
        >
          <span className={big}>{f.countries.length}</span>
          <span className={`${small} underline decoration-dashed`}>
            国家和地区
          </span>
        </button>
        <div className={cell}>
          <span className={big}>{f.cities}</span>
          <span className={small}>城市</span>
        </div>
        <div className={cell}>
          <span className={big}>
            {formatKm(f.km)?.replace('约 ', '').replace(' 公里', '') ?? '0'}
          </span>
          <span className={small}>公里</span>
        </div>
      </div>
      {showCountries && f.countries.length > 0 && (
        <p className="mt-1 text-xs">
          {f.countries.map((c) => c.name).join('、')}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {home ? (
          <>
            <span>
              离家最远：
              {f.farthest
                ? `${f.farthest.name}，${formatKm(f.farthest.km) ?? '不到 1 公里'}`
                : '还没有离开过'}
            </span>
            <button
              type="button"
              className="text-ink-soft underline decoration-dashed"
              onClick={() => setSettingHome(!settingHome)}
            >
              常驻城市：{home.name}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setSettingHome(!settingHome)}
          >
            设一下常驻城市，就能看离家最远
          </button>
        )}
        {f.added > 0 && (
          <span className="text-ink-soft">· 其中补了 {f.added} 个地方</span>
        )}
      </div>
      {settingHome && (
        <div className="mt-2">
          <PlaceSearch
            placeholder="搜你常住的城市"
            onPick={(p) => {
              void db.settings.put({
                key: HOME_KEY,
                value: {
                  name: p.name ?? p.address ?? '常驻城市',
                  lat: p.lat,
                  lng: p.lng,
                } satisfies Home,
              })
              setSettingHome(false)
            }}
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            只存在这台手机里，只用来算离家多远。
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-soft">
        里程：记了路线的出行按轨迹算，其余按记录之间的直线算（实际走的路更长）。
      </p>
    </div>
  )
}
