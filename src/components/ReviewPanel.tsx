import { useMemo, useState } from 'react'
import { db, type JournalRecord } from '../db.ts'
import {
  buildReview,
  periodLabel,
  periodRange,
  shiftPeriod,
  type Period,
  type Ranked,
  type Review,
} from '../lib/review.ts'
import { C, renderDocument, type DocBlock } from '../lib/shareImage.ts'
import { ShareSheet, type ShareOption } from './SharePreview.tsx'
import { YearStoryCard } from './YearStoryCard.tsx'
import { yearKey, type YearStory } from '../lib/yearStory.ts'

// 回顾页（决策 0014 第 3E 条）：按月、按年看去了哪些地方。打开这一页时才计算

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})

// 类别分布：单一系列，一种颜色，不要图例；每条直接标数字，悬停显示完整说明
function Bars({ items }: { items: Ranked[] }) {
  const max = Math.max(...items.map((i) => i.count), 1)
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li
          key={i.name}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-sm"
          title={`${i.name}：${i.count} 条`}
        >
          <span className="truncate">{i.name}</span>
          <span
            className="h-4 border-2 border-ink bg-taro"
            style={{ width: `${(i.count / max) * 100}%` }}
          />
          <span className="text-right font-pixel text-[12px]">{i.count}</span>
        </li>
      ))}
    </ul>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-card px-2 py-2 text-center">
      <p className="px-title text-[20px]">{value}</p>
      <p className="font-pixel text-[12px] text-ink-soft">{label}</p>
    </div>
  )
}

async function reviewImage(
  p: Period,
  r: Review,
  story: string | null,
): Promise<Blob[]> {
  const covers: Blob[] = []
  for (const rec of r.records) {
    if (covers.length >= 9) break
    const ph = await db.photos.where('recordId').equals(rec.id).sortBy('order')
    if (ph[0]) covers.push(ph[0].blob)
  }
  const blocks: DocBlock[] = [
    { kind: 'title', text: `${periodLabel(p)}的足迹` },
    {
      kind: 'tags',
      tags: [
        { label: `${r.records.length} 条记录`, fill: C.card },
        { label: `${r.days} 天`, fill: C.lemon },
        { label: `${r.cities.length} 个城市`, fill: C.sky },
        { label: `${r.firsts.length} 个第一次`, fill: C.berry },
      ],
    },
    { kind: 'photoGrid', blobs: covers },
    // 年度回顾的文字（决策 0029 第 2 条）
    ...(story ? ([{ kind: 'text', text: story }] as DocBlock[]) : []),
    ...(r.cities.length
      ? ([
          { kind: 'heading', text: '去过的城市' },
          { kind: 'text', text: r.cities.join('、') },
        ] as DocBlock[])
      : []),
    ...(r.topPlaces.length
      ? ([
          { kind: 'heading', text: '去得最多的地方' },
          ...r.topPlaces.map((t): DocBlock => ({
            kind: 'text',
            text: `${t.name} · ${t.count} 天`,
          })),
        ] as DocBlock[])
      : []),
    ...(r.firsts.length
      ? ([
          { kind: 'heading', text: '第一次去' },
          ...r.firsts.map((f): DocBlock => ({
            kind: 'text',
            text: `${dayFmt.format(f.at)}  ${f.name}`,
          })),
        ] as DocBlock[])
      : []),
    ...(r.categories.length
      ? ([
          { kind: 'heading', text: '都在做什么' },
          {
            kind: 'text',
            text: r.categories.map((c) => `${c.name} ${c.count}`).join(' · '),
          },
        ] as DocBlock[])
      : []),
  ]
  return renderDocument(blocks)
}

export function ReviewPanel({
  records,
  now,
}: {
  records: JournalRecord[]
  now: number
}) {
  const today = new Date(now)
  const [period, setPeriod] = useState<Period>({
    kind: 'month',
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  })
  const review = useMemo(() => buildReview(records, period), [records, period])
  const [sharing, setSharing] = useState<ShareOption[] | null>(null)
  // 下一段还没开始就不让往后翻
  const isFuture = periodRange(shiftPeriod(period, 1))[0] > now

  return (
    <section className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['month', 'year'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={period.kind === k}
              className={`px-btn px-btn-sm ${period.kind === k ? 'bg-ink text-paper' : ''}`}
              onClick={() => setPeriod({ ...period, kind: k })}
            >
              {k === 'month' ? '按月' : '按年'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm"
            aria-label="上一段"
            onClick={() => setPeriod(shiftPeriod(period, -1))}
          >
            ←
          </button>
          <h2 className="px-title text-[16px] whitespace-nowrap">
            {periodLabel(period)}
          </h2>
          <button
            type="button"
            className="px-btn px-btn-sm"
            aria-label="下一段"
            disabled={isFuture}
            onClick={() => setPeriod(shiftPeriod(period, 1))}
          >
            →
          </button>
        </div>
      </div>

      {review.records.length === 0 ? (
        <p className="px-card bg-lemon px-3 py-4 text-center text-sm">
          这段时间没有记录。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat value={review.records.length} label="记录" />
            <Stat value={review.days} label="天" />
            <Stat value={review.cities.length} label="城市" />
            <Stat value={review.firsts.length} label="第一次" />
          </div>

          {period.kind === 'year' && (
            <YearStoryCard year={period.year} records={records} />
          )}

          {review.cities.length > 0 && (
            <div>
              <h3 className="font-pixel text-[12px] text-ink-soft">
                去过的城市
              </h3>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {review.cities.map((c) => (
                  <span key={c} className="px-tag bg-sky">
                    {c}
                  </span>
                ))}
              </p>
            </div>
          )}

          {review.topPlaces.length > 0 && (
            <div>
              <h3 className="font-pixel text-[12px] text-ink-soft">
                去得最多的地方（按天数）
              </h3>
              <Bars items={review.topPlaces} />
            </div>
          )}

          {review.firsts.length > 0 && (
            <div>
              <h3 className="font-pixel text-[12px] text-ink-soft">第一次去</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {review.firsts.map((f) => (
                  <li key={`${f.at}-${f.name}`}>
                    <span className="font-pixel text-[12px] text-ink-soft">
                      {dayFmt.format(f.at)}
                    </span>{' '}
                    {f.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.categories.length > 0 && (
            <div>
              <h3 className="font-pixel text-[12px] text-ink-soft">
                类别分布（条数）
              </h3>
              <Bars items={review.categories} />
            </div>
          )}

          <button
            type="button"
            className="px-btn w-full bg-berry"
            onClick={() =>
              setSharing([
                {
                  key: 'long',
                  label: '长图',
                  render: async () => {
                    const story =
                      period.kind === 'year'
                        ? ((
                            (await db.settings.get(yearKey(period.year)))
                              ?.value as YearStory | undefined
                          )?.text ?? null)
                        : null
                    return reviewImage(period, review, story)
                  },
                },
              ])
            }
          >
            生成{periodLabel(period)}的长图
          </button>
        </>
      )}

      {sharing && (
        <ShareSheet
          options={sharing}
          initial="long"
          baseName={`足迹-回顾-${period.year}${period.kind === 'month' ? `-${period.month}` : ''}`}
          onClose={() => setSharing(null)}
        />
      )}
    </section>
  )
}
