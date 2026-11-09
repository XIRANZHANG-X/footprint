import 'leaflet/dist/leaflet.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { JournalRecord } from '../db.ts'
import { setRecordLocation } from '../lib/recordEdits.ts'
import { groupTrips } from '../lib/trips.ts'

// 瓦片源可在 .env 里用 VITE_TILE_URL 覆盖（决策 0005）。
// 注意：高德等国内瓦片使用 GCJ-02 坐标，直接叠加 GPS（WGS-84）坐标会偏几百米。
const TILE_URL =
  import.meta.env.VITE_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// 按出行轮换的颜色
// 每次出行一种马卡龙色（柠檬黄留给"待定位"，不用在这里）。
// Leaflet 把颜色写进 SVG 属性，不认 CSS 变量，所以这里写死；数值和 index.css 里的同名颜色一致
const TRIP_COLORS = ['#fdd0e0', '#c0f2db', '#decefd', '#c7eaff']
const INK = '#2d2132'
const CHINA: [number, number] = [35, 105]

const dateFmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const label = (r: JournalRecord) =>
  `${dateFmt.format(r.takenAt)} ${r.content?.title ?? ''}`.trim()

type Point = [number, number]

// 只在有定位的记录数量变化时重新缩放，避免每次编辑正文地图都跳回去
function FitToRecords({ points }: { points: Point[] }) {
  const map = useMap()
  const lastCount = useRef(-1)
  useEffect(() => {
    if (points.length > 0 && points.length !== lastCount.current)
      map.fitBounds(points, { padding: [40, 40], maxZoom: 16 })
    lastCount.current = points.length
  }, [map, points])
  return null
}

function ClickToPlace({
  onPlace,
}: {
  onPlace: (lat: number, lng: number) => void
}) {
  useMapEvents({ click: (e) => onPlace(e.latlng.lat, e.latlng.lng) })
  return null
}

export function MapView({ records }: { records: JournalRecord[] }) {
  const [placing, setPlacing] = useState<JournalRecord | null>(null)
  const pending = records.filter((r) => !r.location)

  const trips = useMemo(
    () =>
      groupTrips(records)
        .map((t) => t.records.filter((r) => r.location))
        .filter((rs) => rs.length > 0),
    [records],
  )

  const points = useMemo(
    () =>
      records.flatMap((r): Point[] =>
        r.location ? [[r.location.lat, r.location.lng]] : [],
      ),
    [records],
  )

  return (
    <div className="mt-5">
      {placing ? (
        <div className="px-card mb-4 flex items-center justify-between gap-2 bg-lemon px-3 py-2 text-sm">
          <span>在地图上点一下，设置「{label(placing)}」的位置</span>
          <button
            type="button"
            onClick={() => setPlacing(null)}
            className="px-btn px-btn-sm shrink-0"
          >
            取消
          </button>
        </div>
      ) : (
        pending.length > 0 && (
          <div className="px-card mb-4 p-3 text-sm">
            <p className="text-ink-soft">
              待定位 {pending.length} 条，点一条再到地图上选位置：
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {pending.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setPlacing(r)}
                  className="px-btn px-btn-sm bg-lemon"
                >
                  {label(r)}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      <MapContainer
        center={CHINA}
        zoom={4}
        className={`h-[65dvh] w-full border-2 border-ink shadow-px ${placing ? 'cursor-crosshair' : ''}`}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FitToRecords points={points} />
        {placing && (
          <ClickToPlace
            onPlace={(lat, lng) => {
              void setRecordLocation(placing.id, { lat, lng })
              setPlacing(null)
            }}
          />
        )}
        {trips.map((rs, i) => {
          const color = TRIP_COLORS[i % TRIP_COLORS.length]
          return (
            <Fragment key={rs[0].id}>
              {rs.length > 1 && (
                <Polyline
                  positions={rs.map((r): Point => [
                    r.location!.lat,
                    r.location!.lng,
                  ])}
                  pathOptions={{
                    color: INK,
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '4 6',
                  }}
                />
              )}
              {rs.map((r) => (
                <CircleMarker
                  key={r.id}
                  center={[r.location!.lat, r.location!.lng]}
                  radius={8}
                  pathOptions={{
                    color: INK,
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 1,
                  }}
                >
                  <Popup>
                    <p className="font-pixel text-[12px]">{label(r)}</p>
                    {r.placeName && (
                      <p className="mt-1 text-xs text-ink-soft">
                        {r.placeName}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setPlacing(r)}
                      className="px-btn px-btn-sm mt-2 bg-sky"
                    >
                      改位置
                    </button>
                  </Popup>
                </CircleMarker>
              ))}
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
}
