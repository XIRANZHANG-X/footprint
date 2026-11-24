import { useMemo, useState } from 'react'
import { MAX_PLAN_DAYS } from '../../shared/ai.ts'
import {
  db,
  type JournalRecord,
  type Plan,
  type PlanStop,
  type Wish,
} from '../db.ts'
import { planTrip, searchPlaces } from '../lib/ai.ts'
import { cityOf } from '../lib/geo/area.ts'
import { reachedStops, tasteOf } from '../lib/plans.ts'
import { shortPlace } from '../lib/review.ts'
import { PlaceSearch } from './PlaceSearch.tsx'

// 计划（决策 0024）：在地图页。一次还没去的出行，按天排的一串地方。
// 可以自己一个个加，也可以让 AI 按你的口味排，再逐个用地名搜索核实

const DAY = 86_400_000
const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
})
const toInput = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fromInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function newStop(day: number, name: string): PlanStop {
  return {
    id: crypto.randomUUID(),
    day,
    name,
    lat: null,
    lng: null,
    address: null,
    boundary: null,
    shape: null,
    note: '',
    reason: null,
  }
}

export function PlanPanel({
  plans,
  records,
  wishes,
  onFocus,
}: {
  plans: Plan[]
  records: JournalRecord[]
  wishes: Wish[]
  onFocus: (lat: number, lng: number) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = plans.find((p) => p.id === openId) ?? null
  const sorted = [...plans].sort((a, b) => b.start - a.start)

  return (
    <div className="px-card mt-4 p-3 text-sm">
      <p className="px-title text-[16px]">计划</p>
      {open ? (
        <PlanDetail
          plan={open}
          records={records}
          onBack={() => setOpenId(null)}
          onFocus={onFocus}
        />
      ) : (
        <>
          <NewPlan
            records={records}
            wishes={wishes}
            onCreated={(id) => setOpenId(id)}
          />
          {sorted.length > 0 && (
            <ul className="mt-3 space-y-1">
              {sorted.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full border-2 border-dashed border-grid px-2 py-1.5 text-left hover:border-ink"
                    onClick={() => setOpenId(p.id)}
                  >
                    <span className="font-medium">{p.title}</span>
                    <span className="ml-2 text-xs text-ink-soft">
                      {dateFmt.format(p.start)} 出发 · {p.days} 天 ·{' '}
                      {p.stops.length} 个地方
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function NewPlan({
  records,
  wishes,
  onCreated,
}: {
  records: JournalRecord[]
  wishes: Wish[]
  onCreated: (id: string) => void
}) {
  const [dest, setDest] = useState('')
  const [start, setStart] = useState(() => toInput(Date.now() + 7 * DAY))
  const [days, setDays] = useState(3)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string>()

  async function create(withAi: boolean) {
    const d = dest.trim()
    if (!d) return
    setError(undefined)
    const plan: Plan = {
      id: crypto.randomUUID(),
      title: `${d} ${days} 日`,
      start: fromInput(start),
      days,
      stops: [],
      createdAt: Date.now(),
      source: withAi ? 'ai' : 'manual',
    }
    if (withAi) {
      try {
        setBusy('AI 在排…')
        const visited = [
          ...new Set(
            records
              .filter(
                (r) =>
                  (cityOf(r) ?? '').includes(d) ||
                  (r.placeName ?? '').includes(d),
              )
              .flatMap((r) => shortPlace(r.placeName) ?? []),
          ),
        ].slice(0, 30)
        const res = await planTrip({
          destination: d,
          days,
          note: note.trim(),
          likes: tasteOf(records),
          visited,
          wishes: wishes
            .filter((w) => `${w.name}${w.address ?? ''}`.includes(d))
            .map((w) => w.name.slice(0, 40))
            .slice(0, 20),
        })
        const stops = res.days.flatMap((x) =>
          x.stops.map((s) => ({ ...newStop(x.day, s.name), reason: s.reason })),
        )
        // 逐个核实：用"目的地 + 地名"搜一次，搜到就填上位置
        for (const [i, s] of stops.entries()) {
          setBusy(`核实地点 ${i + 1}/${stops.length}…`)
          try {
            const [hit] = await searchPlaces(`${d} ${s.name}`)
            if (hit) {
              s.lat = hit.lat
              s.lng = hit.lng
              s.address = hit.address
              s.boundary = hit.boundary ?? null
            }
          } catch {
            // 搜不到就留着"没核实"
          }
        }
        plan.stops = stops
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setBusy(null)
        return
      }
    }
    await db.plans.add(plan)
    setBusy(null)
    setDest('')
    setNote('')
    onCreated(plan.id)
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          className="px-input min-w-0 flex-1"
          placeholder="去哪，比如 京都"
          aria-label="目的地"
          maxLength={40}
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        />
        <input
          type="date"
          className="px-input w-36"
          aria-label="出发日期"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <select
          className="px-input w-20"
          aria-label="天数"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {Array.from({ length: MAX_PLAN_DAYS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} 天
            </option>
          ))}
        </select>
      </div>
      <input
        className="px-input w-full"
        placeholder="想补充一句给 AI（可选）：想多走路、带老人、不想排太满"
        aria-label="给 AI 的补充"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm bg-mint"
          disabled={!dest.trim() || busy !== null}
          onClick={() => void create(true)}
        >
          {busy ?? 'AI 按我的口味排'}
        </button>
        <button
          type="button"
          className="px-btn px-btn-sm"
          disabled={!dest.trim() || busy !== null}
          onClick={() => void create(false)}
        >
          自己排
        </button>
      </div>
      <p className="text-[11px] text-ink-soft">
        AI
        只看到目的地、天数、你常记的类别和标签、在那里去过的地方名和想去清单，不看照片和正文。排出来的只是建议，不写进手账。
      </p>
      {error && <p className="text-xs text-cherry">{error}</p>}
    </div>
  )
}

function PlanDetail({
  plan,
  records,
  onBack,
  onFocus,
}: {
  plan: Plan
  records: JournalRecord[]
  onBack: () => void
  onFocus: (lat: number, lng: number) => void
}) {
  const reached = useMemo(() => reachedStops(plan, records), [plan, records])
  const [addDay, setAddDay] = useState(1)
  const save = (stops: PlanStop[]) => db.plans.update(plan.id, { stops })

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-xs underline" onClick={onBack}>
          ← 全部计划
        </button>
        <button
          type="button"
          className="text-xs text-cherry underline"
          onClick={() => {
            if (confirm(`删掉计划"${plan.title}"？`)) {
              void db.plans.delete(plan.id)
              onBack()
            }
          }}
        >
          删掉这个计划
        </button>
      </div>
      <p className="mt-2 font-medium">
        {plan.title}
        <span className="ml-2 text-xs text-ink-soft">
          {dateFmt.format(plan.start)} –{' '}
          {dateFmt.format(plan.start + (plan.days - 1) * DAY)}
        </span>
      </p>
      {Array.from({ length: plan.days }, (_, i) => i + 1).map((day) => {
        const stops = plan.stops.filter((s) => s.day === day)
        return (
          <div key={day} className="mt-3">
            <p className="font-pixel text-[12px] text-ink-soft">
              第 {day} 天 · {dateFmt.format(plan.start + (day - 1) * DAY)}
            </p>
            {stops.length === 0 && (
              <p className="text-xs text-ink-soft">还没有安排</p>
            )}
            <ul className="mt-1 space-y-1">
              {stops.map((s) => (
                <li
                  key={s.id}
                  className="border-l-2 border-dashed border-sky pl-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {s.lat !== null && s.lng !== null ? (
                        <button
                          type="button"
                          className="font-medium underline decoration-dashed"
                          onClick={() => onFocus(s.lat!, s.lng!)}
                        >
                          {s.name}
                        </button>
                      ) : (
                        <span className="font-medium">{s.name}</span>
                      )}
                      {reached.has(s.id) && (
                        <span className="px-tag ml-1 bg-mint">到了 ✓</span>
                      )}
                      {s.lat === null && (
                        <span className="px-tag ml-1 bg-lemon">没核实</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-cherry underline"
                      aria-label={`从计划里删掉"${s.name}"`}
                      onClick={() =>
                        void save(plan.stops.filter((x) => x.id !== s.id))
                      }
                    >
                      删掉
                    </button>
                  </div>
                  {s.reason && (
                    <p className="text-xs text-ink-soft">{s.reason}</p>
                  )}
                  <input
                    className="mt-0.5 w-full border-b border-dashed border-grid bg-transparent text-xs outline-none focus:border-ink"
                    placeholder="备注：门票号、想吃的"
                    aria-label={`"${s.name}"的备注`}
                    maxLength={80}
                    defaultValue={s.note}
                    onBlur={(e) =>
                      e.target.value !== s.note &&
                      void save(
                        plan.stops.map((x) =>
                          x.id === s.id ? { ...x, note: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      <div className="mt-4">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span>加一个地方到</span>
          <select
            className="px-input w-24"
            aria-label="加到第几天"
            value={addDay}
            onChange={(e) => setAddDay(Number(e.target.value))}
          >
            {Array.from({ length: plan.days }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                第 {n} 天
              </option>
            ))}
          </select>
        </div>
        <PlaceSearch
          placeholder="搜一个地方"
          onPick={(p) =>
            void save([
              ...plan.stops,
              {
                ...newStop(addDay, p.name ?? p.address ?? '一个地方'),
                lat: p.lat,
                lng: p.lng,
                address: p.label || p.address,
                boundary: p.boundary ?? null,
              },
            ])
          }
        />
      </div>
    </div>
  )
}
