import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db.ts'
import {
  findings,
  sessionHealth,
  sessions,
  type SessionHealth,
} from '../lib/trackHealth.ts'

// 记录体检（决策 0030）：最近几次记录路线记了多久、断了几次、锁屏时耗多少电、点从哪来。
// 有断档时按手机品牌给出放行后台的设置路径（国产手机杀后台各有各的开关）

const SOURCE: Record<string, string> = {
  gps: 'GPS',
  network: '网络',
  passive: '借别的 App',
  fused: '融合',
  gpx: 'GPX',
}

// 各品牌大致的设置路径；系统版本不同，名字会略有出入
const BRAND_TIPS: { match: RegExp; name: string; steps: string[] }[] = [
  {
    match: /xiaomi|redmi|poco/,
    name: '小米 / 红米',
    steps: [
      '设置 → 应用设置 → 应用管理 → 足迹手账 → 省电策略，选"无限制"',
      '同一页打开"自启动"',
      '最近任务里按住足迹手账，点锁形图标锁定',
    ],
  },
  {
    match: /huawei|honor/,
    name: '华为 / 荣耀',
    steps: [
      '设置 → 电池 → 启动管理（应用启动管理）→ 足迹手账，关掉"自动管理"',
      '在弹出的选项里打开"允许自启动""允许后台活动"',
      '最近任务里下拉足迹手账锁定',
    ],
  },
  {
    match: /oppo|realme|oneplus/,
    name: 'OPPO / 一加 / realme',
    steps: [
      '设置 → 电池 → 更多设置（或"应用耗电管理"）→ 足迹手账',
      '打开"允许后台运行""允许自启动"',
      '最近任务里锁定足迹手账',
    ],
  },
  {
    match: /vivo|iqoo/,
    name: 'vivo / iQOO',
    steps: [
      '设置 → 电池 → 后台耗电管理 → 足迹手账，选"允许后台高耗电"',
      '设置 → 应用与权限 → 权限管理 → 自启动，打开足迹手账',
    ],
  },
  {
    match: /samsung/,
    name: '三星',
    steps: ['设置 → 电池 → 后台使用限制 → 永不休眠的应用，加入足迹手账'],
  },
]
const OTHER = {
  name: '这台手机',
  steps: ['设置 → 应用 → 足迹手账 → 电池，选"不限制"或"无限制"'],
}

const hm = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Session({ s }: { s: SessionHealth }) {
  const list = findings(s)
  const sources = Object.entries(s.bySource)
    .map(([k, n]) => `${SOURCE[k] ?? k} ${n}`)
    .join(' · ')
  return (
    <li className="border-t-2 border-dashed border-grid pt-2 first:border-0 first:pt-0">
      <p className="font-pixel text-[12px] text-ink-soft">
        {hm(s.start)} 起 · {s.hours.toFixed(1)} 小时 ·{' '}
        {s.precise ? '精确' : '省电'}
        {s.endedBy === 'running' && ' · 正在记'}
      </p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {list.map((f, i) => (
          <li
            key={i}
            className={
              f.level === 'bad'
                ? 'text-cherry'
                : f.level === 'warn'
                  ? 'text-ink'
                  : 'text-ink-soft'
            }
          >
            {f.level === 'bad' ? '✗ ' : f.level === 'warn' ? '! ' : '✓ '}
            {f.text}
          </li>
        ))}
        <li className="text-ink-soft">
          {s.points} 个点{sources && `（${sources}）`}
          {s.medianAcc !== null && `，精度中位数 ${Math.round(s.medianAcc)} 米`}
        </li>
      </ul>
    </li>
  )
}

export function TrackHealthPanel({
  running,
  brand,
  onOpenSettings,
}: {
  running: boolean
  brand: string
  onOpenSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [now] = useState(() => Date.now())
  const data = useLiveQuery(async () => {
    const events = await db.trackEvents.orderBy('t').toArray()
    if (events.length === 0) return []
    const groups = sessions(events, running).slice(-3)
    const from = groups[0].events[0].t
    const points = await db.track.where('t').aboveOrEqual(from).toArray()
    return groups.map((g) => sessionHealth(g, points, now)).reverse()
  }, [running, now])

  if (!data || data.length === 0) return null
  const troubled = data.some((s) =>
    findings(s).some((f) => f.level === 'bad' && /停了|断了/.test(f.text)),
  )
  const tips = BRAND_TIPS.find((b) => b.match.test(brand)) ?? OTHER

  return (
    <div className="mt-3 border-2 border-dashed border-ink p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="px-title text-[14px]">记录体检</span>
        <span className={`px-tag ${troubled ? 'bg-lemon' : 'bg-mint'}`}>
          {troubled ? '有断档' : '正常'}
        </span>
      </button>
      {open && (
        <>
          <ul className="mt-2 space-y-2">
            {data.map((s) => (
              <Session key={s.start} s={s} />
            ))}
          </ul>
          {troubled && (
            <div className="mt-3 text-xs">
              <p className="font-pixel text-[12px]">
                让{tips.name}别在后台停掉足迹手账：
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                {tips.steps.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <button
                type="button"
                className="px-btn px-btn-sm mt-2"
                onClick={onOpenSettings}
              >
                打开系统的电池优化设置
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] text-ink-soft">
            每 15 分钟留一条心跳；超过 45
            分钟没有动静算断档。耗电只算锁屏、没充电的时段，是整机的耗电。
          </p>
        </>
      )}
    </div>
  )
}
