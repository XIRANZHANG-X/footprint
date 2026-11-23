import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
// markercluster 往全局的 L 上挂 markerClusterGroup，必须在 leaflet 之后导入
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { JournalRecord } from '../db.ts'
import { cityOf } from '../lib/geo/area.ts'
import type { Admin1Region } from '../lib/geo/regions.ts'
import type { Region } from '../lib/geo/pip.ts'
import { setRecordLocation } from '../lib/recordEdits.ts'
import { shortPlace } from '../lib/review.ts'
import { applyFilters, type Filters } from '../lib/search.ts'
import { groupTrips } from '../lib/trips.ts'
import { computeVisits, localDay, type PlaceGroup } from '../lib/visits.ts'

// 瓦片源可在 .env 里用 VITE_TILE_URL 覆盖（决策 0005）。
// 注意：高德等国内瓦片使用 GCJ-02 坐标，直接叠加 GPS（WGS-84）坐标会偏几百米。
const TILE_URL =
  import.meta.env.VITE_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 边界 Natural Earth、geoBoundaries'

// Leaflet 把颜色写进 SVG / canvas，不认 CSS 变量，所以这里写死；数值和 index.css 里的同名颜色一致
const INK = '#2d2132'
const BERRY_DEEP = '#e0679a' // 点亮区域：去得越多越不透明
const PAPER = '#fffaf2'
const GRID = '#d9cfe3'
const CHINA: [number, number] = [35, 105]
// 缩小到这一级以下看点亮的区域；放大后看具体地点（决策 0014 第 3D 条）
const DETAIL_ZOOM = 9

const dateFmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const label = (r: JournalRecord) =>
  `${dateFmt.format(r.takenAt)} ${r.content?.title ?? ''}`.trim()

type Point = [number, number]

const toLatLngs = (g: number[][][]) =>
  g.map((poly) =>
    poly.map((ring) => {
      const out: Point[] = []
      for (let i = 0; i < ring.length; i += 2) out.push([ring[i + 1], ring[i]])
      return out
    }),
  )

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

function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  return null
}

// 离线底图（决策 0014 第 3D 条第 2 点）：在线瓦片加载失败时，画出打包在 App 里的省州边界，
// 至少能看清点亮的区域在哪。没有用 OSM 瓦片打包：OSM 的瓦片使用规定不允许批量下载
function OfflineBase({ show }: { show: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!show) return
    const held: { layer: L.LayerGroup | null } = { layer: null }
    const run = { cancelled: false }
    void import('../lib/geo/regions.ts').then(async (m) => {
      const regions = await m.loadAdmin1()
      if (run.cancelled) return
      if (!map.getPane('offline')) {
        map.createPane('offline').style.zIndex = '150'
      }
      const renderer = L.canvas({ pane: 'offline' })
      held.layer = L.layerGroup(
        regions.map((r) =>
          L.polygon(toLatLngs(r.g), {
            renderer,
            pane: 'offline',
            color: GRID,
            weight: 1,
            fillColor: PAPER,
            fillOpacity: 1,
            interactive: false,
          }),
        ),
      ).addTo(map)
    })
    return () => {
      run.cancelled = true
      held.layer?.remove()
    }
  }, [map, show])
  return null
}

// 点亮去过的区域：中国按区县，其他地方按省、州（中国的地级市没有可用的开放边界数据，见决策 0014 补记）
type Lit = {
  kind: 'cn' | 'a1'
  index: number
  days: number
  names: string[]
  at: Point // 区域里第一条记录的位置，缩得很小时在这里画一个点
}

function litRegions(records: JournalRecord[]): Lit[] {
  const m = new Map<
    string,
    { lit: Lit; days: Set<string>; names: Set<string> }
  >()
  for (const r of records) {
    const a = r.area
    if (!r.location || !a) continue
    const kind = a.cc === 'CN' && a.county !== null ? 'cn' : 'a1'
    const index = kind === 'cn' ? a.county! : a.a1
    const k = `${kind}:${index}`
    let e = m.get(k)
    if (!e) {
      e = {
        lit: {
          kind,
          index,
          days: 0,
          names: [],
          at: [r.location.lat, r.location.lng],
        },
        days: new Set(),
        names: new Set(),
      }
      m.set(k, e)
    }
    e.days.add(localDay(r.takenAt))
    const c = cityOf(r)
    if (c) e.names.add(c)
  }
  return [...m.values()].map((e) => ({
    ...e.lit,
    days: e.days.size,
    names: [...e.names],
  }))
}

function LitLayer({ lit, detail }: { lit: Lit[]; detail: boolean }) {
  const map = useMap()
  const [shapes, setShapes] = useState<{
    a1: Admin1Region[]
    cn: Region[]
  } | null>(null)
  const needed = lit.length > 0
  useEffect(() => {
    if (!needed) return
    const run = { cancelled: false }
    void import('../lib/geo/regions.ts').then(async (m) => {
      const [a1, cn] = await Promise.all([
        m.loadAdmin1(),
        lit.some((l) => l.kind === 'cn')
          ? m.loadCounties()
          : Promise.resolve([]),
      ])
      if (!run.cancelled) setShapes({ a1, cn })
    })
    return () => {
      run.cancelled = true
    }
  }, [needed, lit])

  useEffect(() => {
    if (!shapes) return
    const max = Math.max(...lit.map((l) => l.days), 1)
    const group = L.layerGroup()
    for (const l of lit) {
      const region = l.kind === 'cn' ? shapes.cn[l.index] : shapes.a1[l.index]
      if (!region) continue
      // 去过 1 天也要看得见；去得最多的最深
      const strength = 0.35 + 0.45 * (l.days / max)
      L.polygon(toLatLngs(region.g), {
        color: INK,
        weight: detail ? 1 : 2,
        opacity: detail ? 0.4 : 0.9,
        fillColor: BERRY_DEEP,
        fillOpacity: detail ? 0.12 : strength,
      })
        .bindTooltip(
          `${l.names.join('、') || '去过的地方'} · 去过 ${l.days} 天`,
          {
            sticky: true,
          },
        )
        .addTo(group)
      // 缩小到全国、全世界时，区县只有几个像素，补一个方块点，保证看得见
      if (!detail)
        L.circleMarker(l.at, {
          radius: 6,
          color: INK,
          weight: 2,
          fillColor: BERRY_DEEP,
          fillOpacity: 1,
        })
          .bindTooltip(
            `${l.names.join('、') || '去过的地方'} · 去过 ${l.days} 天`,
          )
          .addTo(group)
    }
    group.addTo(map)
    return () => {
      group.remove()
    }
  }, [map, shapes, lit, detail])
  return null
}

// 放大后的地点标记：同一个地方（100 米以内）一个标记，上面写去过几次；太密时聚成一个圈
function PlaceMarkers({
  places,
  byId,
  show,
  onMove,
}: {
  places: PlaceGroup[]
  byId: Map<string, JournalRecord>
  show: boolean
  onMove: (r: JournalRecord) => void
}) {
  const map = useMap()
  useEffect(() => {
    if (!show) return
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      iconCreateFunction: (c) =>
        L.divIcon({
          html: `<span>${c.getChildCount()}</span>`,
          className: 'px-cluster',
          iconSize: [40, 40],
        }),
    })
    for (const p of places) {
      const rs = p.recordIds.flatMap((id) => byId.get(id) ?? [])
      if (rs.length === 0) continue
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          html: `<span>${p.days.length}</span>`,
          className: 'px-place',
          iconSize: [30, 30],
        }),
        title: `去过 ${p.days.length} 次`,
      })
      // 弹窗内容用 DOM 拼，按钮能直接调用 React 这边的函数
      const box = document.createElement('div')
      const name = rs.map((r) => shortPlace(r.placeName)).find(Boolean)
      const head = document.createElement('p')
      head.className = 'font-pixel text-[12px]'
      head.textContent = `${name ?? '这个地方'} · 去过 ${p.days.length} 次`
      box.append(head)
      for (const r of [...rs].reverse().slice(0, 6)) {
        const row = document.createElement('div')
        row.className = 'mt-2 flex items-center justify-between gap-2 text-xs'
        const t = document.createElement('span')
        t.textContent = label(r)
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'px-btn px-btn-sm bg-sky'
        b.textContent = '改位置'
        b.onclick = () => {
          map.closePopup()
          onMove(r)
        }
        row.append(t, b)
        box.append(row)
      }
      marker.bindPopup(box)
      cluster.addLayer(marker)
    }
    map.addLayer(cluster)
    return () => {
      map.removeLayer(cluster)
    }
  }, [map, places, byId, show, onMove])
  return null
}

export function MapView({
  records,
  filters,
}: {
  records: JournalRecord[]
  filters: Filters
}) {
  const [placing, setPlacing] = useState<JournalRecord | null>(null)
  const [zoom, setZoom] = useState(4)
  const [tilesFailed, setTilesFailed] = useState(!navigator.onLine)
  // 地图跟着时间线的搜索和筛选走（决策 0014 第 3A 条）
  const shown = useMemo(
    () => applyFilters(records, filters, cityOf),
    [records, filters],
  )
  const pending = shown.filter((r) => !r.location)
  const byId = useMemo(() => new Map(shown.map((r) => [r.id, r])), [shown])
  const { places } = useMemo(() => computeVisits(shown, cityOf), [shown])
  const lit = useMemo(() => litRegions(shown), [shown])
  const detail = zoom >= DETAIL_ZOOM

  const trips = useMemo(
    () =>
      groupTrips(shown)
        .map((t) => t.records.filter((r) => r.location))
        .filter((rs) => rs.length > 1),
    [shown],
  )
  const points = useMemo(
    () =>
      shown.flatMap((r): Point[] =>
        r.location ? [[r.location.lat, r.location.lng]] : [],
      ),
    [shown],
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

      <p className="mb-2 font-pixel text-[12px] text-ink-soft">
        {detail
          ? '数字是去过几次；缩小地图看点亮的区域'
          : `点亮了 ${lit.length} 个区域（中国按区县，其他地方按省州）；放大看具体地点`}
      </p>

      <MapContainer
        center={CHINA}
        zoom={4}
        className={`h-[65dvh] w-full border-2 border-ink shadow-px ${placing ? 'cursor-crosshair' : ''}`}
      >
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTRIBUTION}
          // 只要有瓦片加载失败就垫上离线底图；它在瓦片下面，瓦片能加载的地方照样显示瓦片
          eventHandlers={{ tileerror: () => setTilesFailed(true) }}
        />
        <OfflineBase show={tilesFailed} />
        <ZoomWatch onZoom={setZoom} />
        <FitToRecords points={points} />
        <LitLayer lit={lit} detail={detail} />
        {placing && (
          <ClickToPlace
            onPlace={(lat, lng) => {
              void setRecordLocation(placing.id, { lat, lng })
              setPlacing(null)
            }}
          />
        )}
        {detail &&
          trips.map((rs) => (
            <Polyline
              key={rs[0].id}
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
          ))}
        <PlaceMarkers
          places={places}
          byId={byId}
          // 还没算出所在区域（边界数据没加载好）时，缩小也显示地点，免得地图上什么都没有
          show={detail || lit.length === 0}
          onMove={setPlacing}
        />
      </MapContainer>
    </div>
  )
}
