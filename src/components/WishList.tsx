import { useMemo, useState } from 'react'
import { db, type JournalRecord, type Wish } from '../db.ts'
import { addWish } from '../lib/addWish.ts'
import { wishState } from '../lib/wishes.ts'
import { PlaceSearch, type PickedPlace } from './PlaceSearch.tsx'

// 想去的地方（决策 0020 第 7 条）。"想去"和"去过"是两张单子：
// 加进来之后再去一次，就从"想去"移到折起来的"实现了"里；判错了可以拿回来。
// 也可以在地图上长按加（见 MapView）

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function WishList({
  wishes,
  records,
  onFocus,
}: {
  wishes: Wish[]
  records: JournalRecord[]
  onFocus: (w: Wish) => void
}) {
  const [showDone, setShowDone] = useState(false)
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records])
  const states = useMemo(
    () => wishes.map((w) => ({ w, s: wishState(w, records) })),
    [wishes, records],
  )
  const pending = states.filter((x) => !x.s.done).map((x) => x.w)
  const done = states.filter((x) => x.s.done)

  return (
    <div className="px-card mt-4 p-3 text-sm">
      <p className="px-title text-[16px]">想去的地方</p>
      <p className="mt-1 text-xs text-ink-soft">
        搜一个地方加进来，或者在地图上长按。以后去了、记了一条，就会自动打勾。
      </p>
      <div className="mt-2">
        <PlaceSearch
          placeholder="搜想去的地方"
          onPick={(p: PickedPlace) =>
            void addWish({
              name: p.name ?? p.address ?? '想去的地方',
              address: p.label || p.address,
              lat: p.lat,
              lng: p.lng,
              kind: p.kind ?? 'poi',
              boundary: p.boundary ?? null,
            })
          }
        />
      </div>

      {pending.length === 0 ? (
        <p className="mt-3 text-xs text-ink-soft">清单还是空的。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pending.map((w) => (
            <li key={w.id} className="border-l-2 border-dashed border-ink pl-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-left font-medium underline decoration-dashed"
                  onClick={() => onFocus(w)}
                >
                  ★ {w.name}
                </button>
                <span className="flex shrink-0 gap-2 text-xs">
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      void db.wishes.update(w.id, { manual: 'done' })
                    }
                  >
                    去过了
                  </button>
                  <button
                    type="button"
                    className="text-cherry underline"
                    aria-label={`从想去清单删掉"${w.name}"`}
                    onClick={() => void db.wishes.delete(w.id)}
                  >
                    删掉
                  </button>
                </span>
              </div>
              {w.address && (
                <p className="text-xs text-ink-soft">{w.address}</p>
              )}
              <input
                className="mt-1 w-full border-b border-dashed border-grid bg-transparent text-xs outline-none focus:border-ink"
                placeholder="写一句备注，比如 想吃那家面"
                aria-label={`"${w.name}"的备注`}
                maxLength={60}
                defaultValue={w.note}
                onBlur={(e) =>
                  e.target.value !== w.note &&
                  void db.wishes.update(w.id, { note: e.target.value })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-ink-soft underline decoration-dashed"
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            实现了 {done.length} 个 {showDone ? '▲' : '▼'}
          </button>
          {showDone && (
            <ul className="mt-1 space-y-1">
              {done.map(({ w, s }) => {
                const r =
                  s.done && s.recordId ? byId.get(s.recordId) : undefined
                return (
                  <li
                    key={w.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span>
                      ✓ {w.name}
                      {s.done && s.at
                        ? ` · ${dayFmt.format(s.at)}去的${r?.content?.title ? `（${r.content.title}）` : ''}`
                        : ' · 手动标的'}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 underline"
                      // 拿回来：从现在起重新算，以后再去才打勾
                      onClick={() =>
                        void db.wishes.update(w.id, {
                          manual: null,
                          addedAt: Date.now(),
                        })
                      }
                    >
                      拿回来
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
