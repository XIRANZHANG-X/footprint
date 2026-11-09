import type { JournalRecord } from '../db.ts'
import { isStarCenter, STAR } from '../lib/pixelStar.ts'
import { setTripBreak } from '../lib/recordEdits.ts'
import { groupTrips, type Trip } from '../lib/trips.ts'
import { RecordCard } from './RecordCard.tsx'

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})
const DAY = 86_400_000

function tripHeading(trip: Trip<JournalRecord>) {
  const start = dayFmt.format(trip.start)
  const end = dayFmt.format(trip.end)
  const days =
    Math.round(
      (new Date(trip.end).setHours(0, 0, 0, 0) -
        new Date(trip.start).setHours(0, 0, 0, 0)) /
        DAY,
    ) + 1
  const range = start === end ? start : `${start} – ${end}`
  return `${range} · ${days > 1 ? `${days} 天 · ` : ''}${trip.records.length} 条`
}

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

// 时间线按"一次出行"分组，最新的在上面。分组规则见 lib/trips.ts，
// 用户可以手动拆分或合并，修正记在被拆/被合并的那条记录的 tripBreak 上。
export function Timeline({ records }: { records: JournalRecord[] }) {
  const trips = groupTrips(records)
  const oldestTripId = trips[0]?.id

  return (
    <section className="mt-6 space-y-6">
      {records.length === 0 && <EmptyState />}
      {[...trips].reverse().map((trip) => {
        const firstId = trip.records[0].id
        return (
          <div key={trip.id}>
            <header className="mb-3 flex items-center justify-between gap-2">
              <h2 className="px-tag bg-taro px-2 py-1">{tripHeading(trip)}</h2>
              {trip.id !== oldestTripId && (
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => void setTripBreak(firstId, 'join')}
                >
                  并入上一次出行
                </button>
              )}
            </header>
            <div className="space-y-4 border-l-4 border-taro pl-3">
              {[...trip.records].reverse().map((r) => (
                <div key={r.id}>
                  <RecordCard record={r} />
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
    </section>
  )
}
