import type { JournalRecord } from '../db.ts'
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

const link = 'text-xs text-neutral-400 hover:text-emerald-700'

// 时间线按"一次出行"分组，最新的在上面。分组规则见 lib/trips.ts，
// 用户可以手动拆分或合并，修正记在被拆/被合并的那条记录的 tripBreak 上。
export function Timeline({ records }: { records: JournalRecord[] }) {
  const trips = groupTrips(records)
  const oldestTripId = trips[0]?.id

  return (
    <section className="mt-6 space-y-6">
      {records.length === 0 && (
        <p className="text-center text-sm text-neutral-400">还没有记录</p>
      )}
      {[...trips].reverse().map((trip) => {
        const firstId = trip.records[0].id
        return (
          <div key={trip.id}>
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">
                {tripHeading(trip)}
              </h2>
              {trip.id !== oldestTripId && (
                <button
                  type="button"
                  className={link}
                  onClick={() => void setTripBreak(firstId, 'join')}
                >
                  并入上一次出行
                </button>
              )}
            </header>
            <div className="space-y-3 border-l-2 border-emerald-200 pl-3">
              {[...trip.records].reverse().map((r) => (
                <div key={r.id}>
                  <RecordCard record={r} />
                  {r.id !== firstId && (
                    <button
                      type="button"
                      className={`${link} mt-1`}
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
