import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { MAX_SUMMARY_ITEMS } from '../../shared/ai.ts'
import { db, type JournalRecord } from '../db.ts'
import { summarize } from '../lib/ai.ts'
import { cityOf } from '../lib/geo/area.ts'
import { styleForRequest } from '../lib/preferences.ts'
import { recordLine } from '../lib/review.ts'
import { renderDocument, C, type DocBlock } from '../lib/shareImage.ts'
import { saveErrorMessage } from '../lib/storage.ts'
import { tripHeading } from '../lib/tripLabel.ts'
import type { Trip } from '../lib/trips.ts'
import { localDay, type VisitInfo } from '../lib/visits.ts'
import { ShareSheet, type ShareOption } from './SharePreview.tsx'

// 一次出行的总结（决策 0014 第 3E 条）：几天、几个地方、几个第一次，加一段 AI 写的总结。
// 总结存在设置表里（键 trip:<出行 id>），会跟着备份走；可以改，没网时只显示统计
type Saved = { text: string; at: number }
const key = (tripId: string) => `trip:${tripId}`

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})

export function TripSummary({
  trip,
  visits,
  onClose,
}: {
  trip: Trip<JournalRecord>
  visits: Map<string, VisitInfo>
  onClose: () => void
}) {
  const saved = useLiveQuery(
    async () =>
      (await db.settings.get(key(trip.id)))?.value as Saved | undefined,
    [trip.id],
  )
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // 点"生成长图"时把当时的内容定下来，预览期间不跟着重新生成
  const [sharing, setSharing] = useState<ShareOption[] | null>(null)

  const stats = useMemo(() => {
    const rs = trip.records
    const places = new Set(rs.flatMap((r) => visits.get(r.id)?.place ?? []))
    const firsts = rs.filter((r) => visits.get(r.id)?.visit === 1).length
    const cities = [...new Set(rs.flatMap((r) => cityOf(r) ?? []))]
    const days = new Set(rs.map((r) => localDay(r.takenAt))).size
    return { days, places: places.size, firsts, cities }
  }, [trip, visits])

  const text = draft ?? saved?.text ?? ''

  const save = (t: string) =>
    db.settings.put({
      key: key(trip.id),
      value: { text: t.trim(), at: Date.now() },
    })

  async function write() {
    setBusy(true)
    setError(undefined)
    try {
      const { preferences } = await styleForRequest(false)
      const items = trip.records.slice(0, MAX_SUMMARY_ITEMS).map((r) => {
        const l = recordLine(r)
        return {
          date: dayFmt.format(r.takenAt),
          title: l.title.slice(0, 40),
          place: l.place.slice(0, 80),
          body: l.body.slice(0, 400),
        }
      })
      const t = await summarize({ items, preferences })
      await save(t)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 长图：前 9 张照片拼成九宫格 + 统计 + 总结 + 每条记录一行
  async function render(): Promise<Blob[]> {
    const covers: Blob[] = []
    for (const r of trip.records) {
      if (covers.length >= 9) break
      const p = await db.photos.where('recordId').equals(r.id).sortBy('order')
      if (p[0]) covers.push(p[0].blob)
    }
    const blocks: DocBlock[] = [
      { kind: 'photoGrid', blobs: covers },
      {
        kind: 'title',
        text: stats.cities.slice(0, 3).join('、') || '一次出行',
      },
      {
        kind: 'tags',
        tags: [
          { label: tripHeading(trip).split(' · ')[0], fill: C.card },
          { label: `${stats.days} 天 · ${stats.places} 个地方`, fill: C.sky },
          ...(stats.firsts
            ? [{ label: `${stats.firsts} 个第一次`, fill: C.berry }]
            : []),
        ],
      },
      ...(text ? [{ kind: 'text', text } as DocBlock] : []),
      { kind: 'heading', text: '去过的地方' },
      ...trip.records.flatMap((r): DocBlock[] => {
        const l = recordLine(r)
        return [
          { kind: 'text', text: `${dayFmt.format(r.takenAt)}  ${l.title}` },
          ...(l.place
            ? [{ kind: 'text', text: l.place, soft: true } as DocBlock]
            : []),
          { kind: 'gap', h: 12 },
        ]
      }),
    ]
    return renderDocument(blocks)
  }

  return (
    <div className="px-card mb-4 space-y-3 bg-card p-3 text-sm">
      <p className="font-pixel text-[12px] text-ink-soft">
        {stats.days} 天 · {stats.places} 个地方 · {stats.firsts} 个第一次
        {stats.cities.length > 0 && ` · ${stats.cities.join('、')}`}
      </p>

      <label htmlFor={`trip-${trip.id}`} className="sr-only">
        出行总结
      </label>
      <textarea
        id={`trip-${trip.id}`}
        className="px-input min-h-24 w-full"
        placeholder="还没有总结。可以让 AI 根据这次的记录写一段，也可以自己写。"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
      />
      {error && <p className="text-xs text-cherry">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-btn px-btn-sm bg-mint"
          disabled={busy}
          onClick={() => {
            if (text && !confirm('重新写会替换现在的总结，继续吗？')) return
            void write()
          }}
        >
          {busy ? 'AI 写总结中…' : text ? '让 AI 重写' : '让 AI 写总结'}
        </button>
        {draft !== null && draft !== (saved?.text ?? '') && (
          <button
            type="button"
            className="px-btn px-btn-sm bg-berry"
            onClick={() =>
              void save(draft)
                .then(() => setDraft(null))
                .catch((e: unknown) => setError(saveErrorMessage(e)))
            }
          >
            保存
          </button>
        )}
        <button
          type="button"
          className="px-btn px-btn-sm bg-sky"
          onClick={() => setSharing([{ key: 'long', label: '长图', render }])}
        >
          生成长图
        </button>
        <button type="button" className="px-btn px-btn-sm" onClick={onClose}>
          收起
        </button>
      </div>

      {sharing && (
        <ShareSheet
          options={sharing}
          initial="long"
          baseName={`足迹-出行-${new Date(trip.start).toISOString().slice(0, 10)}`}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  )
}
