import { useState } from 'react'
import type { JournalRecord } from '../db.ts'
import { cityOf } from '../lib/geo/area.ts'
import { facets, isFiltering, NO_FILTERS, type Filters } from '../lib/search.ts'

// 时间线和地图共用的搜索框和筛选（决策 0014 第 3A 条）。
// 筛选按钮从已有记录里统计出来，常用的排前面；太多时先只列前几个
const SHOWN = 8

type Key = 'category' | 'tag' | 'city'

function Chips({
  title,
  items,
  value,
  onPick,
  color,
}: {
  title: string
  items: { value: string; count: number }[]
  value: string | null
  onPick: (v: string | null) => void
  color: string
}) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <div>
      <p className="font-pixel text-[12px] text-ink-soft">{title}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {shown.map((it) => {
          const on = value === it.value
          return (
            <button
              key={it.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : it.value)}
              className={`px-btn px-btn-sm ${on ? 'bg-ink text-paper' : color}`}
            >
              {it.value}
              <span className="opacity-60">{it.count}</span>
            </button>
          )
        })}
        {items.length > SHOWN && (
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => setAll(!all)}
          >
            {all ? '收起' : `更多 ${items.length - SHOWN}`}
          </button>
        )}
      </div>
    </div>
  )
}

export function SearchBar({
  records,
  filters,
  onChange,
}: {
  records: JournalRecord[]
  filters: Filters
  onChange: (f: Filters) => void
}) {
  const [open, setOpen] = useState(false)
  const f = facets(records, cityOf)
  const set = (key: Key) => (v: string | null) =>
    onChange({ ...filters, [key]: v })
  const active = isFiltering(filters)

  return (
    <div className="mt-5 space-y-3">
      <div className="flex gap-2">
        <label htmlFor="search" className="sr-only">
          搜索记录
        </label>
        <input
          id="search"
          type="search"
          className="px-input min-w-0 flex-1"
          placeholder="搜标题、正文、地名、标签…"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
        <button
          type="button"
          aria-expanded={open}
          className={`px-btn shrink-0 ${open ? 'bg-ink text-paper' : ''}`}
          onClick={() => setOpen(!open)}
        >
          筛选
        </button>
      </div>

      {open && (
        <div className="px-card space-y-3 p-3">
          <Chips
            title="类别"
            items={f.categories}
            value={filters.category}
            onPick={set('category')}
            color="bg-card"
          />
          <Chips
            title="城市"
            items={f.cities}
            value={filters.city}
            onPick={set('city')}
            color="bg-sky"
          />
          <Chips
            title="标签"
            items={f.tags}
            value={filters.tag}
            onPick={set('tag')}
            color="bg-mint"
          />
          {f.categories.length + f.cities.length + f.tags.length === 0 && (
            <p className="text-sm text-ink-soft">
              整理过的记录才有类别和标签，有坐标的记录才有城市。
            </p>
          )}
        </div>
      )}

      {active && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {filters.day && (
            <span className="px-tag bg-lemon">
              往年的 {filters.day.month} 月 {filters.day.date} 日
            </span>
          )}
          {filters.category && (
            <span className="px-tag">{filters.category}</span>
          )}
          {filters.city && (
            <span className="px-tag bg-sky">{filters.city}</span>
          )}
          {filters.tag && (
            <span className="px-tag bg-mint">#{filters.tag}</span>
          )}
          <button
            type="button"
            className="px-btn px-btn-sm"
            onClick={() => onChange(NO_FILTERS)}
          >
            清空条件
          </button>
        </div>
      )}
    </div>
  )
}
