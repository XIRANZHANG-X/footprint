import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
// markercluster 往全局的 L 上挂 markerClusterGroup，必须在 leaflet 之后导入
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { inChinaRough } from '../../shared/gcj02.ts'
import { db, type JournalRecord, type VisitedPlace, type Wish } from '../db.ts'
import { geocode } from '../lib/ai.ts'
import { cityOf } from '../lib/geo/area.ts'
import {
  AMAP_ATTRIBUTION,
  AMAP_LABEL_URL,
  AMAP_TILE_URL,
  GCJ_CRS,
} from '../lib/geo/mapCrs.ts'
import type { Ring } from '../lib/geo/pip.ts'
import { setRecordLocation } from '../lib/recordEdits.ts'
import { shortPlace } from '../lib/review.ts'
import { formatKm, tripPaths, type PathSegment } from '../lib/route.ts'
import { applyFilters, isFiltering, type Filters } from '../lib/search.ts'
import { TRANSPORT_LABEL, TRANSPORTS, type TrackPoint } from '../lib/track.ts'
import { groupTrips } from '../lib/trips.ts'
import { computeVisits, localDay, type PlaceGroup } from '../lib/visits.ts'
import { wishState } from '../lib/wishes.ts'
import { FootprintCard } from './FootprintCard.tsx'
import { TrackerCard } from './TrackerCard.tsx'
import { VisitedPicker } from './VisitedPicker.tsx'
import { addWish } from '../lib/addWish.ts'
import { WishList } from './WishList.tsx'

// 国外的瓦片源可在 .env 里用 VITE_TILE_URL 覆盖（决策 0005）。国内用高德（决策 0021，见 mapCrs.ts）
const TILE_URL =
  import.meta.env.VITE_TILE_URL ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · 边界 Natural Earth、geoBoundaries'

// Leaflet 把颜色写进 SVG / canvas，不认 CSS 变量，所以这里写死；数值和 index.css 里的同名颜色一致
const INK = '#2d2132'
const BERRY_DEEP = '#e0679a' // 点亮区域：去得越多越不透明
const TARO_DEEP = '#8c6cc8' // 路线：香芋紫表示出行分组（决策 0010），加深一档才在底图上看得清
const PAPER = '#fffaf2'
const GRID = '#d9cfe3'
const CHINA: [number, number] = [35, 105]
// 缩小到这一级以下看点亮的区域；放大后看具体地点（决策 0014 第 3D 条）
const DETAIL_ZOOM = 9

const dateFmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })
const label = (r: JournalRecord) =>
  `${dateFmt.format(r.takenAt)} ${r.content?.title ?? ''}`.trim()

type Point = [number, number]
type View = { center: Point; zoom: number }
// amap：国内，高德底图 + 换算坐标的坐标系；osm：国外，OSM 底图
type Mode = 'amap' | 'osm'

const toLatLngs = (g: ArrayLike<Ring>[]) =>
  g.map((poly) =>
    Array.from(poly, (ring) => {
      const out: Point[] = []
      for (let i = 0; i < ring.length; i += 2) out.push([ring[i + 1], ring[i]])
      return out
    }),
  )

// 只在有定位的记录数量变化时重新缩放，避免每次编辑正文地图都跳回去。
// 计数放在外面：切换底图时地图会重建，不能因此再缩放一次
function FitToRecords({
  points,
  shouldFit,
}: {
  points: Point[]
  shouldFit: (count: number) => boolean
}) {
  const map = useMap()
  useEffect(() => {
    if (shouldFit(points.length) && points.length > 0)
      map.fitBounds(points, { padding: [40, 40], maxZoom: 16 })
  }, [map, points, shouldFit])
  return null
}

function MapEvents({
  onPlace,
  onLongPress,
  onView,
}: {
  onPlace: ((lat: number, lng: number) => void) | null
  onLongPress: (lat: number, lng: number) => void
  onView: (v: View) => void
}) {
  const map = useMapEvents({
    click: (e) => onPlace?.(e.latlng.lat, e.latlng.lng),
    // 手机上长按、电脑上右键：加一个想去的地方（决策 0020 第 7 条）
    contextmenu: (e) => onLongPress(e.latlng.lat, e.latlng.lng),
    moveend: () => {
      const c = map.getCenter()
      onView({ center: [c.lat, c.lng], zoom: map.getZoom() })
    },
  })
  return null
}

// 从想去清单点一个地方：把地图移过去（地图建好以后 center 属性就不起作用了，要主动移）
function FocusOn({ target }: { target: View | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView(target.center, target.zoom)
  }, [map, target])
  return null
}

// 地图中心在不在国内：先用矩形粗判，再用打包的边界数据确认（决策 0021）。
// 在海上等不属于任何地方时返回 null，保持现在的底图，免得来回切换
// 缩小到看全国时（7 级及以下），中心在国内的大致范围里就用高德：中心常常落在海上或邻国，
// 但这时最要紧的是国内那部分看得清；邻国在这么小的比例下偏几百米看不出来
async function modeAt(
  lat: number,
  lng: number,
  zoom: number,
): Promise<Mode | null> {
  if (!inChinaRough({ lat, lng })) return 'osm'
  if (zoom <= 7) return 'amap'
  try {
    const m = await import('../lib/geo/regions.ts')
    const [a] = await m.locateMany([{ lat, lng }])
    if (!a) return null
    return a.cc === 'CN' ? 'amap' : 'osm'
  } catch {
    return 'amap'
  }
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
      // 只要个轮廓，用精简过的那份（决策 0016 第 5 条）
      const regions = await m.loadOutline()
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
  // 用到的形状，键是"a1:序号"或"cn:序号"
  const [shapes, setShapes] = useState<Map<string, ArrayLike<Ring>[]> | null>(
    null,
  )
  useEffect(() => {
    if (lit.length === 0) return
    const run = { cancelled: false }
    // 边界数据在后台线程里，只把要点亮的那几个区域的形状要回来（决策 0016 第 5 条）
    void import('../lib/geo/regions.ts').then(async (m) => {
      const got = await m.regionShapes(
        lit.filter((l) => l.kind === 'a1').map((l) => l.index),
        lit.filter((l) => l.kind === 'cn').map((l) => l.index),
      )
      if (run.cancelled) return
      setShapes(
        new Map([
          ...got.a1.map((s) => [`a1:${s.index}`, s.g] as const),
          ...got.cn.map((s) => [`cn:${s.index}`, s.g] as const),
        ]),
      )
    })
    return () => {
      run.cancelled = true
    }
  }, [lit])

  useEffect(() => {
    if (!shapes) return
    const max = Math.max(...lit.map((l) => l.days), 1)
    const group = L.layerGroup()
    for (const l of lit) {
      const g = shapes.get(`${l.kind}:${l.index}`)
      if (!g) continue
      // 去过 1 天也要看得见；去得最多的最深
      const strength = 0.35 + 0.45 * (l.days / max)
      L.polygon(toLatLngs(g), {
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

// 补的以前去过的地方（决策 0020 第 6 条）：颜色更浅、边是虚线，和真的记录区分开
function AddedLayer({ visited }: { visited: VisitedPlace[] }) {
  const map = useMap()
  const [shapes, setShapes] = useState<
    { name: string; g: ArrayLike<Ring>[] }[]
  >([])
  useEffect(() => {
    const run = { cancelled: false }
    void (async () => {
      const out: { name: string; g: ArrayLike<Ring>[] }[] = visited
        .filter((v) => v.shape && v.shape.length)
        .map((v) => ({ name: v.name, g: v.shape! }))
      const a1 = new Map<number, string>()
      for (const v of visited) if (v.a1 !== null) a1.set(v.a1, v.name)
      const countries = visited.filter((v) => v.kind === 'country' && v.cc)
      if (a1.size || countries.length) {
        const m = await import('../lib/geo/regions.ts')
        if (countries.length) {
          const names = await m.admin1Names()
          for (const c of countries)
            for (const n of names) if (n.cc === c.cc) a1.set(n.index, c.name)
        }
        const got = await m.regionShapes([...a1.keys()], [])
        for (const s of got.a1) out.push({ name: a1.get(s.index)!, g: s.g })
      }
      if (!run.cancelled) setShapes(out)
    })()
    return () => {
      run.cancelled = true
    }
  }, [visited])

  useEffect(() => {
    const group = L.layerGroup()
    for (const s of shapes)
      L.polygon(toLatLngs(s.g), {
        color: INK,
        weight: 1,
        opacity: 0.6,
        dashArray: '4 4',
        fillColor: BERRY_DEEP,
        fillOpacity: 0.15,
      })
        .bindTooltip(`补的：${s.name}`, { sticky: true })
        .addTo(group)
    group.addTo(map)
    return () => {
      group.remove()
    }
  }, [map, shapes])
  return null
}

// 每次出行的路线（决策 0020 第 1–3 条）：普通的一段画实线，超过 300 公里的画成虚线弧线。
// 下面垫一层奶油白，在各种底图上都看得清；直角线头，保持像素感
function RouteLayer({
  records,
  track,
}: {
  records: JournalRecord[]
  track: TrackPoint[]
}) {
  const map = useMap()
  const segments = useMemo(() => {
    const out: (PathSegment & { key: string })[] = []
    for (const t of groupTrips(records)) {
      // 只给这次出行时间范围里的轨迹：有没有轨迹决定了能不能按 Polarsteps 的规则判飞机
      const inTrip = track.filter((p) => p.t >= t.start && p.t <= t.end)
      tripPaths(t.records, inTrip).segments.forEach((s, i) =>
        out.push({ ...s, key: `${t.id}:${i}` }),
      )
    }
    return out
  }, [records, track])

  // 交通方式的小图标：放在这一段的中间，点开可以改（决策 0022 第 7 条）
  useEffect(() => {
    const group = L.layerGroup()
    for (const s of segments) {
      if (s.path.length < 2) continue
      const mid = s.path[Math.floor(s.path.length / 2)]
      const icon = s.transport
        ? TRANSPORT_LABEL[s.transport].split(' ')[0]
        : '?'
      const box = document.createElement('div')
      const head = document.createElement('p')
      head.className = 'text-xs'
      head.textContent = s.transport
        ? `${TRANSPORT_LABEL[s.transport]}${s.guessed ? '（猜的）' : ''} · ${formatKm(s.km) ?? '不到 1 公里'}`
        : `怎么去的？ · ${formatKm(s.km) ?? '不到 1 公里'}`
      box.append(head)
      const row = document.createElement('div')
      row.className = 'mt-1 flex flex-wrap gap-1'
      for (const t of TRANSPORTS) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'px-btn px-btn-sm'
        b.textContent = TRANSPORT_LABEL[t]
        b.onclick = () => {
          map.closePopup()
          void db.records.update(s.recordId, { transport: t })
        }
        row.append(b)
      }
      box.append(row)
      L.marker([mid.lat, mid.lng], {
        icon: L.divIcon({
          html: `<span>${icon}</span>`,
          className: 'px-transport',
          iconSize: [22, 22],
        }),
        title: s.transport ? TRANSPORT_LABEL[s.transport] : '交通方式',
      })
        .bindPopup(box)
        .addTo(group)
    }
    group.addTo(map)
    return () => {
      group.remove()
    }
  }, [map, segments])

  const base = {
    lineCap: 'butt',
    lineJoin: 'miter',
    interactive: false,
  } as const
  const pts = (s: PathSegment) => s.path.map((p): Point => [p.lat, p.lng])
  return (
    <>
      {segments.map((s) => (
        <Polyline
          key={`${s.key}:casing`}
          positions={pts(s)}
          pathOptions={{ ...base, color: PAPER, weight: 6, opacity: 0.9 }}
        />
      ))}
      {segments.map((s) => (
        <Polyline
          key={s.key}
          positions={pts(s)}
          pathOptions={{
            ...base,
            color: TARO_DEEP,
            weight: 3,
            opacity: 0.95,
            dashArray: s.long ? '8 6' : undefined,
          }}
        />
      ))}
    </>
  )
}

// 想去的地方：地图上的像素星星（柠檬黄，决策 0010 的装饰星星）
const STAR_SVG = `<svg viewBox="0 0 7 7" width="26" height="26" shape-rendering="crispEdges" aria-hidden="true">${[
  '...#...',
  '...#...',
  '..###..',
  '#######',
  '..###..',
  '.##.##.',
  '##...##',
]
  .flatMap((row, y) =>
    [...row].map((c, x) =>
      c === '#'
        ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#fbe58a" stroke="${INK}" stroke-width="0.25"/>`
        : '',
    ),
  )
  .join('')}</svg>`

function WishMarkers({ wishes }: { wishes: Wish[] }) {
  const map = useMap()
  useEffect(() => {
    const group = L.layerGroup()
    for (const w of wishes)
      L.marker([w.lat, w.lng], {
        icon: L.divIcon({
          html: STAR_SVG,
          className: 'px-wish',
          iconSize: [26, 26],
        }),
        title: `想去：${w.name}`,
        alt: `想去：${w.name}`,
      })
        .bindTooltip(`想去：${w.name}${w.note ? ` · ${w.note}` : ''}`)
        .addTo(group)
    group.addTo(map)
    return () => {
      group.remove()
    }
  }, [map, wishes])
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

// 长按地图加想去的地方：先给个名字（有网时查一下这里叫什么，查不到就自己写）
function PinForm({
  pin,
  onDone,
}: {
  pin: { lat: number; lng: number }
  onDone: () => void
}) {
  const [name, setName] = useState('')
  useEffect(() => {
    let alive = true
    geocode(pin.lat, pin.lng)
      .then((g) => {
        if (alive) setName((n) => n || g.name || g.address || '')
      })
      .catch(() => {
        // 没网或没有口令：自己写名字
      })
    return () => {
      alive = false
    }
  }, [pin])
  return (
    <div className="px-card mb-4 bg-lemon p-3 text-sm">
      <p>把这里加进"想去的地方"：</p>
      <div className="mt-2 flex gap-2">
        <input
          className="px-input min-w-0 flex-1"
          placeholder="给这个地方起个名字"
          aria-label="想去的地方的名字"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="px-btn px-btn-sm shrink-0 bg-berry"
          disabled={!name.trim()}
          onClick={() => {
            void addWish({
              name: name.trim(),
              address: null,
              lat: pin.lat,
              lng: pin.lng,
              kind: 'pin',
              boundary: null,
            })
            onDone()
          }}
        >
          加入
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm shrink-0"
          onClick={onDone}
        >
          取消
        </button>
      </div>
    </div>
  )
}

export function MapView({
  records,
  filters,
}: {
  records: JournalRecord[]
  filters: Filters
}) {
  const [placing, setPlacing] = useState<JournalRecord | null>(null)
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [panel, setPanel] = useState<'wishes' | 'visited' | null>(null)
  const [view, setView] = useState<View>({ center: CHINA, zoom: 4 })
  const [mode, setMode] = useState<Mode>('amap')
  const [focus, setFocus] = useState<View | null>(null)
  const fitted = useRef(-1)
  // 记录数变了才缩放；返回 true 表示这次要缩放
  const shouldFit = useCallback((count: number) => {
    if (count === fitted.current) return false
    fitted.current = count
    return true
  }, [])
  const [tilesFailed, setTilesFailed] = useState(!navigator.onLine)
  const wishRows = useLiveQuery(() => db.wishes.toArray())
  const visitedRows = useLiveQuery(() => db.visited.toArray())
  const wishes = useMemo(() => wishRows ?? [], [wishRows])
  const visited = useMemo(() => visitedRows ?? [], [visitedRows])
  // 轨迹（决策 0022）：路线沿轨迹画，里程按轨迹算
  const trackRows = useLiveQuery(() => db.track.orderBy('t').toArray())
  const track = useMemo(() => trackRows ?? [], [trackRows])
  // 地图跟着时间线的搜索和筛选走（决策 0014 第 3A 条）
  const filtering = isFiltering(filters)
  const shown = useMemo(
    () => applyFilters(records, filters, cityOf),
    [records, filters],
  )
  const pending = shown.filter((r) => !r.location)
  const byId = useMemo(() => new Map(shown.map((r) => [r.id, r])), [shown])
  const { places } = useMemo(() => computeVisits(shown, cityOf), [shown])
  const lit = useMemo(() => litRegions(shown), [shown])
  const openWishes = useMemo(
    () => wishes.filter((w) => !wishState(w, records).done),
    [wishes, records],
  )
  const detail = view.zoom >= DETAIL_ZOOM

  const points = useMemo(
    () =>
      shown.flatMap((r): Point[] =>
        r.location ? [[r.location.lat, r.location.lng]] : [],
      ),
    [shown],
  )

  function onView(v: View) {
    setView(v)
    void modeAt(v.center[0], v.center[1], v.zoom).then((m) => {
      if (m && m !== mode) setMode(m)
    })
  }

  return (
    <div className="mt-5">
      <TrackerCard />
      <FootprintCard records={records} visited={visited} track={track} />

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
      {pin && <PinForm pin={pin} onDone={() => setPin(null)} />}

      <p className="mb-2 font-pixel text-[12px] text-ink-soft">
        {detail
          ? '数字是去过几次；缩小地图看点亮的区域'
          : `点亮了 ${lit.length} 个区域（中国按区县，其他地方按省州）；放大看具体地点`}
        {filtering && '；筛选时不画路线'}
      </p>

      <MapContainer
        // 换底图要换坐标系，Leaflet 不支持中途换，只能重建地图；位置和缩放保留
        key={mode}
        crs={mode === 'amap' ? GCJ_CRS : L.CRS.EPSG3857}
        center={view.center}
        zoom={view.zoom}
        className={`h-[65dvh] w-full border-2 border-ink shadow-px ${placing ? 'cursor-crosshair' : ''}`}
      >
        {mode === 'amap' ? (
          <>
            <TileLayer
              url={AMAP_TILE_URL}
              subdomains="1234"
              maxZoom={18}
              attribution={AMAP_ATTRIBUTION}
              eventHandlers={{ tileerror: () => setTilesFailed(true) }}
            />
            <TileLayer url={AMAP_LABEL_URL} subdomains="1234" maxZoom={18} />
          </>
        ) : (
          <TileLayer
            url={TILE_URL}
            attribution={TILE_ATTRIBUTION}
            // 只要有瓦片加载失败就垫上离线底图；它在瓦片下面，瓦片能加载的地方照样显示瓦片
            eventHandlers={{ tileerror: () => setTilesFailed(true) }}
          />
        )}
        <OfflineBase show={tilesFailed} />
        <MapEvents
          onPlace={
            placing
              ? (lat, lng) => {
                  void setRecordLocation(placing.id, { lat, lng })
                  setPlacing(null)
                }
              : null
          }
          onLongPress={(lat, lng) => setPin({ lat, lng })}
          onView={onView}
        />
        <FitToRecords points={points} shouldFit={shouldFit} />
        <FocusOn target={focus} />
        <AddedLayer visited={visited} />
        <LitLayer lit={lit} detail={detail} />
        {!filtering && <RouteLayer records={records} track={track} />}
        <WishMarkers wishes={openWishes} />
        <PlaceMarkers
          places={places}
          byId={byId}
          // 还没算出所在区域（边界数据没加载好）时，缩小也显示地点，免得地图上什么都没有
          show={detail || lit.length === 0}
          onMove={setPlacing}
        />
      </MapContainer>
      <p className="mt-1 text-[11px] text-ink-soft">
        长按地图（电脑上右键）可以把那里加进"想去的地方"。
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={`px-btn px-btn-sm ${panel === 'wishes' ? 'bg-lemon' : ''}`}
          aria-expanded={panel === 'wishes'}
          onClick={() => setPanel(panel === 'wishes' ? null : 'wishes')}
        >
          ★ 想去（{openWishes.length}）
        </button>
        <button
          type="button"
          className={`px-btn px-btn-sm ${panel === 'visited' ? 'bg-berry' : ''}`}
          aria-expanded={panel === 'visited'}
          onClick={() => setPanel(panel === 'visited' ? null : 'visited')}
        >
          补以前去过的地方
        </button>
      </div>
      {panel === 'wishes' && (
        <WishList
          wishes={wishes}
          records={records}
          onFocus={(w) => setFocus({ center: [w.lat, w.lng], zoom: 14 })}
        />
      )}
      {panel === 'visited' && <VisitedPicker visited={visited} />}
    </div>
  )
}
