import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { cityOf } from '../lib/geo/area.ts'
import { isStarCenter, STAR } from '../lib/pixelStar.ts'
import { setTripBreak } from '../lib/recordEdits.ts'
import {
  applyFilters,
  isFiltering,
  matchesFacets,
  type Filters,
} from '../lib/search.ts'
import { tripHeading } from '../lib/tripLabel.ts'
import { groupTrips } from '../lib/trips.ts'
import { computeVisits } from '../lib/visits.ts'
import { countdown } from '../lib/plans.ts'
import { fulfilledBy } from '../lib/wishes.ts'
import type { Stay } from '../lib/track.ts'
import { RecordCard } from './RecordCard.tsx'
import { StaySuggestions } from './StaySuggestions.tsx'

// 语义搜索要加载模型，出行总结要调 AI，都只在用到时加载
const SemanticResults = lazy(() =>
  import('./SemanticResults.tsx').then((m) => ({ default: m.SemanticResults })),
)
const TripReview = lazy(() =>
  import('./TripReview.tsx').then((m) => ({ default: m.TripReview })),
)
const TripSummary = lazy(() =>
  import('./TripSummary.tsx').then((m) => ({ default: m.TripSummary })),
)

function PixelStar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 7 7"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {STAR.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '#' ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill={isStarCenter(x, y) ? 'var(--color-berry)' : 'currentColor'}
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

function EmptyState() {
  return (
    <div className="px-card relative mt-2 bg-lemon px-4 py-8 text-center">
      <PixelStar className="absolute top-3 left-4 h-6 w-6" />
      <PixelStar className="absolute right-5 bottom-4 h-4 w-4" />
      <p className="px-title text-[20px]">还没有足迹</p>
      <p className="mt-2 text-sm text-ink-soft">
        选几张出门拍的照片，记下第一个地方。
      </p>
    </div>
  )
}

// 首页的一行统计（决策 0014 第 3C 条）：记录数、城市数、出行次数、"第一次"的次数（去过的不同地方）
function Stats({
  records,
  trips,
  places,
  onCities,
}: {
  records: JournalRecord[]
  trips: number
  places: number
  onCities: () => void
}) {
  const cities = new Set(records.flatMap((r) => cityOf(r) ?? [])).size
  return (
    <p className="font-pixel text-[12px] text-ink-soft">
      {records.length} 条记录 ·{' '}
      <button
        type="button"
        className="underline decoration-dashed underline-offset-4 hover:text-ink"
        onClick={onCities}
      >
        {cities} 个城市
      </button>{' '}
      · {trips} 次出行 · {places} 个第一次
    </p>
  )
}

// 时间线按"一次出行"分组，最新的在上面。分组规则见 lib/trips.ts，
// 用户可以手动拆分或合并，修正记在被拆/被合并的那条记录的 tripBreak 上。
// 有搜索词或筛选条件时改成按时间平铺，每条标明属于哪次出行（决策 0014 第 3A 条）
export function Timeline({
  records,
  filters,
  onDelete,
  onShowMap,
  onRecordStay,
}: {
  records: JournalRecord[]
  filters: Filters
  onDelete: (recordId: string) => void
  onShowMap: () => void
  onRecordStay: (stay: Stay) => void
}) {
  const trips = useMemo(() => groupTrips(records), [records])
  const { visits, places } = useMemo(
    () => computeVisits(records, cityOf),
    [records],
  )
  const [summarizing, setSummarizing] = useState<string | null>(null)
  // 回看（决策 0025）：路线回放、短视频、海报、PDF 手账
  const [reviewing, setReviewing] = useState<string | null>(null)
  const reviewTrip = trips.find((t) => t.id === reviewing)
  // 实现了哪个想去的地方（决策 0020 第 7 条）
  const wishes = useLiveQuery(() => db.wishes.toArray())
  // 轨迹（决策 0022）：出行标题的里程按轨迹算
  const track = useLiveQuery(() => db.track.orderBy('t').toArray())
  // 倒计时（决策 0024 第 5 条）：离下次出发还有几天 / 上次出门是多少天前
  const plans = useLiveQuery(() => db.plans.toArray())
  const [now] = useState(() => Date.now())
  const nextTrip = countdown(plans ?? [], trips.at(-1)?.end ?? null, now)
  const fulfilled = useMemo(
    () => fulfilledBy(wishes ?? [], records),
    [wishes, records],
  )
  const oldestTripId = trips[0]?.id

  const card = (r: JournalRecord, tripLabel?: string) => (
    <RecordCard
      key={r.id}
      record={r}
      onDelete={onDelete}
      visit={visits.get(r.id)}
      tripLabel={tripLabel}
      wish={fulfilled.get(r.id)}
    />
  )

  if (isFiltering(filters)) {
    const tripOf = new Map<string, string>()
    for (const t of trips)
      for (const r of t.records) tripOf.set(r.id, tripHeading(t))
    const found = applyFilters(records, filters, cityOf).sort(
      (a, b) => b.takenAt - a.takenAt,
    )
    const pool = records.filter((r) => matchesFacets(r, filters, cityOf(r)))
    return (
      <section className="mt-6">
        <p className="font-pixel text-[12px] text-ink-soft">
          找到 {found.length} 条
        </p>
        <div className="mt-3 space-y-4">
          {found.map((r) => card(r, tripOf.get(r.id)))}
        </div>
        {filters.q.trim() && (
          <Suspense fallback={null}>
            <SemanticResults
              query={filters.q}
              records={pool}
              exclude={new Set(found.map((r) => r.id))}
              render={(r) => card(r, tripOf.get(r.id))}
            />
          </Suspense>
        )}
      </section>
    )
  }

  return (
    <section className="mt-6 space-y-6">
      <StaySuggestions records={records} onRecord={onRecordStay} />
      {nextTrip && (
        <p className="-mb-3 font-pixel text-[12px] text-ink-soft">{nextTrip}</p>
      )}
      {records.length === 0 ? (
        <EmptyState />
      ) : (
        <Stats
          records={records}
          trips={trips.length}
          places={places.length}
          onCities={onShowMap}
        />
      )}
      {[...trips].reverse().map((trip) => {
        const firstId = trip.records[0].id
        return (
          <div key={trip.id}>
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="px-tag bg-taro px-2 py-1">
                {tripHeading(trip, track)}
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-btn px-btn-sm bg-taro"
                  aria-expanded={summarizing === trip.id}
                  onClick={() =>
                    setSummarizing(summarizing === trip.id ? null : trip.id)
                  }
                >
                  总结
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => setReviewing(trip.id)}
                >
                  回看
                </button>
                {trip.id !== oldestTripId && (
                  <button
                    type="button"
                    className="px-btn px-btn-sm"
                    onClick={() => void setTripBreak(firstId, 'join')}
                  >
                    并入上一次出行
                  </button>
                )}
              </div>
            </header>
            {summarizing === trip.id && (
              <Suspense fallback={null}>
                <TripSummary
                  trip={trip}
                  visits={visits}
                  onClose={() => setSummarizing(null)}
                />
              </Suspense>
            )}
            <div className="space-y-4 border-l-4 border-taro pl-3">
              {[...trip.records].reverse().map((r) => (
                <div key={r.id}>
                  {card(r)}
                  {r.id !== firstId && (
                    <button
                      type="button"
                      className="mt-2 py-1 text-xs text-ink-soft hover:text-ink"
                      onClick={() => void setTripBreak(r.id, 'split')}
                    >
                      ✂ 从这条起算新的一次出行
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {reviewTrip && (
        <Suspense fallback={null}>
          <TripReview trip={reviewTrip} onClose={() => setReviewing(null)} />
        </Suspense>
      )}
    </section>
  )
}
