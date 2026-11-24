import { useEffect, useMemo, useState } from 'react'
import { db, type VisitedPlace } from '../db.ts'
import { fetchBoundary, searchPlaces } from '../lib/ai.ts'
import { countryName } from '../lib/geo/area.ts'
import { DIRECT_CITIES } from '../lib/geo/cnTables.ts'

// 补以前去过的地方（决策 0020 第 6 条，用户定的做法）：
// 上面一个搜索框，下面是列表；打几个字就筛出来，可以勾好几个；列表里没有的直接填名字。
// 列表的数据都打包在 App 里：国家、全球的省州（边界数据里的名字）、国内的省市县（查表数据）。
// 国内的市、区县 App 里没有边界，有网时从高德取一次存下来（决策 0021）

type Entry = Omit<VisitedPlace, 'id' | 'addedAt' | 'shape'> & {
  key: string
  sub: string
  en: string
}

const LIMIT = 60

async function loadEntries(): Promise<Entry[]> {
  const m = await import('../lib/geo/regions.ts')
  const [names, items] = await Promise.all([m.admin1Names(), m.adminItems()])
  const out: Entry[] = []
  const ccs = [...new Set(names.map((n) => n.cc))].filter(Boolean)
  // 国家也能打英文找（France、Japan）
  let english: Intl.DisplayNames | null = null
  try {
    english = new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    english = null
  }
  for (const cc of ccs)
    out.push({
      key: `country:${cc}`,
      kind: 'country',
      name: countryName(cc),
      sub: '国家和地区',
      en: `${englishName(english, cc)} ${cc}`.toLowerCase(),
      cc,
      a1: null,
      code: null,
      city: null,
    })
  // 国外的省州；国内的省也在这里，下面用查表数据里的名字对上它的边界
  const cnA1 = new Map<string, number>()
  for (const n of names) {
    if (n.cc === 'CN') {
      cnA1.set(n.n, n.index)
      continue
    }
    if (!n.cc) continue
    out.push({
      key: `a1:${n.index}`,
      kind: 'a1',
      name: n.n || n.en,
      sub: [countryName(n.cc), n.en !== n.n ? n.en : '']
        .filter(Boolean)
        .join(' · '),
      en: n.en.toLowerCase(),
      cc: n.cc,
      a1: n.index,
      code: null,
      city: n.n || n.en, // 国外的省州按城市算，和记录的算法一致（area.ts 的 cityOf）
    })
  }
  const byName = new Map(items.map((i) => [i.name, i]))
  for (const i of items) {
    const code = i.code.padEnd(6, '0')
    if (i.level === 1) {
      const a1 = cnA1.get(i.name) ?? null
      out.push({
        key: `cn:${code}`,
        kind: a1 !== null ? 'a1' : 'cn',
        name: i.name,
        sub: '中国 · 省级',
        en: '',
        cc: 'CN',
        a1,
        code,
        city: DIRECT_CITIES.has(i.name) ? i.name : null,
      })
    } else {
      const parent = byName.get(i.parent)
      const province =
        parent?.level === 2 ? byName.get(parent.parent)?.name : parent?.name
      out.push({
        key: `cn:${code}`,
        kind: 'cn',
        name: i.name,
        sub: [province, parent?.level === 2 ? parent.name : null]
          .filter(Boolean)
          .join(' · '),
        en: '',
        cc: 'CN',
        a1: null,
        code,
        // 选区县算它所属的市（直辖市的区县算直辖市）
        city: i.level === 2 ? i.name : i.parent,
      })
    }
  }
  return out
}

// 边界数据里有几个不是标准代码的（比如 ESB），浏览器查不到名字会报错
function englishName(names: Intl.DisplayNames | null, cc: string): string {
  try {
    return names?.of(cc) ?? ''
  } catch {
    return ''
  }
}

function matches(e: Entry, q: string) {
  return (
    e.name.includes(q) || e.sub.includes(q) || e.en.includes(q.toLowerCase())
  )
}

// 先完全同名的，再国家、省州，最后区县
const rank = (e: Entry, q: string) =>
  (e.name === q ? 0 : 10) + { country: 0, a1: 1, cn: 2, custom: 3 }[e.kind]

export function VisitedPicker({ visited }: { visited: VisitedPlace[] }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string>()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Map<string, Entry>>(new Map())
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState<string>()

  useEffect(() => {
    loadEntries()
      .then(setEntries)
      .catch((e: unknown) =>
        setError(`列表加载失败：${e instanceof Error ? e.message : e}`),
      )
  }, [])

  const have = useMemo(
    () => new Set(visited.map((v) => `${v.kind}:${v.code ?? v.a1 ?? v.cc}`)),
    [visited],
  )
  const shown = useMemo(() => {
    const t = q.trim()
    if (!entries || !t) return []
    return entries
      .filter((e) => matches(e, t))
      .sort((a, b) => rank(a, t) - rank(b, t))
      .slice(0, LIMIT)
  }, [entries, q])

  async function add() {
    const now = Date.now()
    const rows: VisitedPlace[] = [...picked.values()].map((e, i) => ({
      id: crypto.randomUUID(),
      kind: e.kind,
      name: e.name,
      cc: e.cc,
      a1: e.a1,
      code: e.kind === 'cn' ? e.code : null,
      city: e.city,
      shape: null,
      addedAt: now + i,
    }))
    if (custom.trim())
      rows.push({
        id: crypto.randomUUID(),
        kind: 'custom',
        name: custom.trim().slice(0, 40),
        cc: null,
        a1: null,
        code: null,
        city: null,
        shape: null,
        addedAt: now + rows.length,
      })
    if (rows.length === 0) return
    await db.visited.bulkAdd(rows)
    setPicked(new Map())
    setCustom('')
    setQ('')
    setNote(`加入了 ${rows.length} 个。`)
    // 国内的市、区县和自己填的：联网取边界，取不到也不影响计数
    void fillShapes(rows).then((failed) => {
      if (failed > 0)
        setNote(
          `加入了 ${rows.length} 个；${failed} 个没取到边界（可能没联网），先只算进统计，地图上不显示。`,
        )
    })
  }

  return (
    <div className="px-card mt-4 p-3 text-sm">
      <p className="px-title text-[16px]">补以前去过的地方</p>
      <p className="mt-1 text-xs text-ink-soft">
        用 App
        之前去过的国家、省、城市。只算进国家数、城市数和地图点亮，不算里程。
      </p>
      <input
        type="search"
        className="px-input mt-2 w-full"
        placeholder="打几个字找，比如 杭州、京都、France"
        aria-label="搜索去过的地方"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error && <p className="mt-1 text-xs text-cherry">{error}</p>}
      {!entries && !error && (
        <p className="mt-2 text-xs text-ink-soft">正在准备列表…</p>
      )}
      {shown.length > 0 && (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {shown.map((e) => {
            const done = have.has(`${e.kind}:${e.code ?? e.a1 ?? e.cc}`)
            return (
              <li key={e.key}>
                <label className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-ink"
                    disabled={done}
                    checked={done || picked.has(e.key)}
                    onChange={(ev) => {
                      const next = new Map(picked)
                      if (ev.target.checked) next.set(e.key, e)
                      else next.delete(e.key)
                      setPicked(next)
                    }}
                  />
                  <span>{e.name}</span>
                  <span className="text-xs text-ink-soft">
                    {done ? '已经补过' : e.sub}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className="px-input min-w-0 flex-1"
          placeholder="列表里没有？直接填名字"
          aria-label="直接填地名"
          maxLength={40}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          type="button"
          className="px-btn px-btn-sm shrink-0 bg-berry"
          disabled={picked.size === 0 && !custom.trim()}
          onClick={() => void add()}
        >
          加入 {picked.size + (custom.trim() ? 1 : 0) || ''} 个
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2 text-xs">
          {note}
        </p>
      )}

      {visited.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-soft">
            已经补了 {visited.length} 个
          </summary>
          <ul className="mt-1 space-y-1">
            {visited.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-xs">{v.name}</span>
                <button
                  type="button"
                  className="text-xs text-cherry underline"
                  aria-label={`删掉补的"${v.name}"`}
                  onClick={() => void db.visited.delete(v.id)}
                >
                  删掉
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// 取边界；自己填的名字先搜一下，补上国家、城市。返回没取到的个数
async function fillShapes(rows: VisitedPlace[]): Promise<number> {
  let failed = 0
  for (const v of rows) {
    try {
      if (v.kind === 'cn' && v.code) {
        const b = await fetchBoundary(v.code)
        if (b.shape.length) await db.visited.update(v.id, { shape: b.shape })
        else failed++
      } else if (v.kind === 'custom') {
        const [hit] = await searchPlaces(v.name)
        if (!hit) {
          failed++
          continue
        }
        const shape = hit.boundary
          ? (await fetchBoundary(hit.boundary)).shape
          : null
        await db.visited.update(v.id, {
          cc: hit.cc ?? null,
          city:
            hit.kind === 'city' || hit.kind === 'district'
              ? (hit.name ?? null)
              : null,
          shape: shape && shape.length ? shape : null,
        })
        if (!shape || !shape.length) failed++
      }
    } catch {
      failed++
    }
  }
  return failed
}
