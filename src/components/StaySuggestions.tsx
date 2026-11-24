import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import { arrivals } from '../lib/plans.ts'
import { findStays, uncoveredStays, type Stay } from '../lib/track.ts'

// 停留提示（决策 0022 第 5 条）：轨迹里在一个地方停了 20 分钟以上、那段时间那里又没有记录，
// 就在时间线顶部问一句"要记一条吗"。只看最近 3 天，最多 3 个；点"不用"就不再问这一次

const DISMISSED_KEY = 'dismissedStays'
const RECENT_MS = 3 * 86_400_000

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function duration(ms: number) {
  const min = Math.round(ms / 60_000)
  return min < 60
    ? `${min} 分钟`
    : `${Math.floor(min / 60)} 小时${min % 60 >= 10 ? ` ${min % 60} 分钟` : ''}`
}

export function StaySuggestions({
  records,
  onRecord,
}: {
  records: JournalRecord[]
  onRecord: (stay: Stay) => void
}) {
  // 打开页面时的时间就够了：最近 3 天，不需要实时刷新
  const [since] = useState(() => Date.now() - RECENT_MS)
  const recent = useLiveQuery(
    () => db.track.where('t').above(since).sortBy('t'),
    [Math.floor(since / 3_600_000)],
  )
  const dismissed = useLiveQuery(
    async () =>
      ((await db.settings.get(DISMISSED_KEY))?.value as number[] | undefined) ??
      [],
  )
  // 计划里的地方到了（决策 0024 第 3 条）：最近 3 小时的轨迹到了还没记录的地方
  const plans = useLiveQuery(() => db.plans.toArray())
  const [now] = useState(() => Date.now())
  const arrived = useMemo(
    () =>
      recent && dismissed
        ? arrivals(
            plans ?? [],
            records,
            recent.filter((p) => p.t >= now - 3 * 3_600_000),
            now,
          ).filter((a) => !dismissed.includes(a.at))
        : [],
    [plans, records, recent, dismissed, now],
  )
  const stays = useMemo(
    () =>
      recent && dismissed
        ? uncoveredStays(findStays(recent), records, dismissed)
        : [],
    [recent, dismissed, records],
  )
  if (stays.length === 0 && arrived.length === 0) return null
  const dismiss = (at: number) =>
    void db.settings.put({
      key: DISMISSED_KEY,
      value: [...(dismissed ?? []), at].slice(-200),
    })

  return (
    <div className="px-card bg-lemon p-3 text-sm">
      <p className="px-title text-[16px]">要记一下吗？</p>
      <ul className="mt-2 space-y-2">
        {arrived.map((a) => (
          <li
            key={`${a.plan.id}:${a.stop.id}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="flex-1">
              到了计划里的「{a.stop.name}」（{a.plan.title} 第 {a.stop.day} 天）
            </span>
            <button
              type="button"
              className="px-btn px-btn-sm bg-berry"
              onClick={() =>
                onRecord({
                  start: a.at,
                  end: a.at,
                  lat: a.where.lat,
                  lng: a.where.lng,
                })
              }
            >
              记一条
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => dismiss(a.at)}
            >
              不用
            </button>
          </li>
        ))}
        {stays.map((s) => (
          <li key={s.start} className="flex flex-wrap items-center gap-2">
            <span className="flex-1">
              {timeFmt.format(s.start)} 起，在同一个地方停了{' '}
              {duration(s.end - s.start)}
            </span>
            <button
              type="button"
              className="px-btn px-btn-sm bg-berry"
              onClick={() => onRecord(s)}
            >
              记一条
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => dismiss(s.start)}
            >
              不用
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
