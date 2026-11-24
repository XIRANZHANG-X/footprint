import { useState, type FormEvent } from 'react'
import type { PlaceCandidate, PlaceKind } from '../../shared/ai.ts'
import { searchPlaces } from '../lib/ai.ts'
import { countryName } from '../lib/geo/area.ts'

// 按地名搜地方（决策 0020、0021）：国内的结果来自高德，国外的来自 OpenStreetMap，都经过服务端。
// 设常驻城市、加想去的地方都用它

const KIND_LABEL: Record<PlaceKind, string> = {
  country: '国家',
  province: '省、州',
  city: '城市',
  district: '区县',
  poi: '地点',
}

// 国内行政区代码 → "浙江省 · 杭州市"，用打包的查表数据（决策 0014）；搜"西湖区"时分得清是哪个市的
let adminNames: Promise<Map<string, string>> | null = null
function loadAdminNames() {
  adminNames ??= import('../lib/geo/regions.ts')
    .then((m) => m.adminItems())
    .then((items) => new Map(items.map((i) => [i.code, i.name])))
    .catch(() => {
      adminNames = null
      return new Map<string, string>()
    })
  return adminNames
}

function parentsOf(adcode: string, names: Map<string, string>): string {
  const province = names.get(adcode.slice(0, 2))
  const city = adcode.endsWith('00') ? null : names.get(adcode.slice(0, 4))
  return [province, city].filter(Boolean).join(' · ')
}

export type PickedPlace = PlaceCandidate & { label: string }

export function PlaceSearch({
  placeholder,
  onPick,
}: {
  placeholder: string
  onPick: (p: PickedPlace) => void
}) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [results, setResults] = useState<PickedPlace[] | null>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const [list, names] = await Promise.all([
        searchPlaces(q),
        loadAdminNames(),
      ])
      setResults(
        list.map((c) => {
          const where =
            c.address ??
            (c.cc === 'CN' && c.boundary && /^\d{6}$/.test(c.boundary)
              ? parentsOf(c.boundary, names)
              : c.cc && c.cc !== 'CN'
                ? countryName(c.cc)
                : '')
          const kind = c.kind ? KIND_LABEL[c.kind] : ''
          return {
            ...c,
            label: [kind, where].filter(Boolean).join(' · '),
          }
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResults(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={(e) => void search(e)} className="flex gap-2">
        <input
          type="search"
          className="px-input min-w-0 flex-1"
          placeholder={placeholder}
          aria-label={placeholder}
          value={q}
          maxLength={60}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="px-btn px-btn-sm shrink-0 bg-sky"
          disabled={busy}
        >
          {busy ? '搜索中…' : '搜索'}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-cherry">{error}</p>}
      {results && results.length === 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          没找到。国外的地方可以试试写全名，比如"京都市"。
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                className="w-full border-2 border-dashed border-grid px-2 py-1.5 text-left text-sm hover:border-ink"
                onClick={() => {
                  onPick(r)
                  setResults(null)
                  setQ('')
                }}
              >
                <span className="font-medium">{r.name ?? r.address}</span>
                {r.label && (
                  <span className="ml-2 text-xs text-ink-soft">{r.label}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
