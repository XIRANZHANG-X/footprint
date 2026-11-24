import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { MAX_PLACE_QUERY_CHARS, type PlaceCandidate } from '../../shared/ai.ts'
import { db, type JournalRecord } from '../db.ts'
import { placeLabel, searchPlaces } from '../lib/ai.ts'
import type { ClueCity } from '../lib/geo/cnTables.ts'
import { sameDayPlaces } from '../lib/places.ts'
import { LocateAgent } from './LocateAgent.tsx'
import { applyPlace, setPlaceNameOnly } from '../lib/recordEdits.ts'

const DAY_MS = 86_400_000

// 给没有定位的记录补地点（决策 0013 第 2、3 条）：
// 先列当天去过的地方供点选；没有合适的就输入地名，查到坐标后列出候选让用户选；
// AI 从照片里猜的地名只是一个标明"AI 猜测"的选项，点了才拿去查
export function PlacePicker({
  record,
  onClose,
}: {
  record: JournalRecord
  onClose: () => void
}) {
  const options = useLiveQuery(async () => {
    // takenAt 有索引：只取前后一天以内的记录，再精确比较是不是同一天
    const nearby = await db.records
      .where('takenAt')
      .between(record.takenAt - DAY_MS, record.takenAt + DAY_MS, true, true)
      .toArray()
    const photos = await db.photos.where('recordId').equals(record.id).toArray()
    return sameDayPlaces(record, nearby, photos)
  }, [record.id, record.takenAt])

  const [query, setQuery] = useState(record.placeName ?? '')
  const [searching, setSearching] = useState(false)
  // searched：这次查的是哪个名字；candidates 为空数组表示没查到
  const [found, setFound] = useState<{
    searched: string
    candidates: PlaceCandidate[]
  }>()
  const [message, setMessage] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  // 照片里读到的电话、车牌指向的城市（决策 0014 补充，借自 geo-sleuth）。查表数据只在这里用到时加载
  const [clues, setClues] = useState<ClueCity[]>([])
  useEffect(() => {
    let cancelled = false
    void import('../lib/geo/regions.ts')
      .then((m) => m.clueCities(record))
      .then((c) => !cancelled && setClues(c))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [record])

  // 点了城市：把城市名放到输入框最前面，已经有地名就直接查，没有就等用户输入店名
  const pickCity = (city: string) => {
    const rest = query.replace(city, '').trim()
    const q = `${city} ${rest || (record.placeGuess ?? '')}`.trim()
    if (q !== city) void search(q)
    else {
      setQuery(`${city} `)
      input.current?.focus()
    }
  }

  const search = async (name: string) => {
    const q = name.trim()
    if (!q) return
    setQuery(q)
    setSearching(true)
    setMessage(undefined)
    setFound(undefined)
    try {
      const candidates = await searchPlaces(q)
      if (candidates.length > 0) setFound({ searched: q, candidates })
      else {
        // 查不到：只存地名文字，记录留在"待定位"里
        await setPlaceNameOnly(record.id, q)
        setMessage(
          `没查到「${q}」的位置，先只记下了地名。可以到地图页点一下位置。`,
        )
      }
    } catch (e) {
      await setPlaceNameOnly(record.id, q)
      setMessage(
        `查位置失败（${e instanceof Error ? e.message : e}），先只记下了地名。`,
      )
    } finally {
      setSearching(false)
    }
  }

  const chip = 'px-btn px-btn-sm text-left'

  return (
    <div className="mt-3 space-y-3 border-2 border-dashed border-ink p-2 text-sm">
      {options && options.length > 0 && (
        <div>
          <p className="font-pixel text-[12px] text-ink-soft">
            当天去过的地方，点一下就用它
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`${chip} bg-sky`}
                onClick={() => {
                  void applyPlace(record.id, o)
                  onClose()
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {record.placeGuess && record.placeGuess !== record.placeName && (
        <div>
          <p className="font-pixel text-[12px] text-ink-soft">
            AI 从照片里猜的，不一定对
          </p>
          <button
            type="button"
            className={`${chip} mt-1 bg-lemon`}
            disabled={searching}
            onClick={() => void search(record.placeGuess ?? '')}
          >
            AI 猜测：{record.placeGuess}
          </button>
        </div>
      )}

      {clues.length > 0 && (
        <div>
          <p className="font-pixel text-[12px] text-ink-soft">
            照片里读到的电话、车牌指向这些城市，点一下在这个城市里查
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {clues.map((c) => (
              <button
                key={c.city}
                type="button"
                className={`${chip} bg-taro`}
                disabled={searching}
                onClick={() => pickCity(c.city)}
              >
                {c.city}
                <span className="opacity-60">（{c.via}）</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <LocateAgent recordId={record.id} onPlaced={onClose} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(query)
        }}
      >
        <label
          htmlFor={`place-${record.id}`}
          className="font-pixel text-[12px] text-ink-soft"
        >
          自己输入地名
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`place-${record.id}`}
            ref={input}
            className="px-input min-w-0 flex-1"
            value={query}
            maxLength={MAX_PLACE_QUERY_CHARS}
            placeholder="例如：西湖断桥"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            className="px-btn px-btn-sm shrink-0 bg-mint"
            disabled={searching || !query.trim()}
          >
            {searching ? '查找中…' : '查位置'}
          </button>
        </div>
      </form>

      {found && (
        <div>
          <p className="font-pixel text-[12px] text-ink-soft">
            查到这几个，选一个；都不对就只记地名
          </p>
          <div className="mt-1 flex flex-col items-start gap-2">
            {found.candidates.map((c) => (
              <button
                key={`${c.lat},${c.lng}`}
                type="button"
                className={`${chip} bg-sky`}
                onClick={() => {
                  void applyPlace(record.id, {
                    location: { lat: c.lat, lng: c.lng },
                    placeName: placeLabel(c) ?? found.searched,
                  })
                  onClose()
                }}
              >
                {placeLabel(c)}
              </button>
            ))}
            <button
              type="button"
              className={chip}
              onClick={() => {
                void setPlaceNameOnly(record.id, found.searched)
                onClose()
              }}
            >
              都不对，只记地名「{found.searched}」
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="text-xs text-ink-soft">
          {message}
        </p>
      )}

      <div className="flex justify-end">
        <button type="button" className="px-btn px-btn-sm" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
