import { useEffect, useState } from 'react'
import { loadWeekly, weeksCsv, type WeekRow } from '../lib/dashboard.ts'
import { saveFile } from '../lib/saveFile.ts'

// 使用看板（决策 0029 第 1 条）：最近 12 周，每周一行。只在本机统计，可以导出 CSV 自己分析
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)

export function DashboardCard() {
  const [rows, setRows] = useState<WeekRow[] | null>(null)
  useEffect(() => {
    void loadWeekly().then(setRows)
  }, [])
  if (!rows) return null
  const recent = [...rows].reverse()
  return (
    <div className="px-card space-y-2 p-3 text-sm">
      <h2 className="px-title text-[16px]">使用看板</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left text-xs tabular-nums">
          <thead className="font-pixel text-[11px] text-ink-soft">
            <tr>
              <th className="py-1 pr-2 font-normal">周一</th>
              <th className="pr-2 font-normal">打开</th>
              <th className="pr-2 font-normal">新记</th>
              <th className="pr-2 font-normal">语音</th>
              <th className="pr-2 font-normal">改稿</th>
              <th className="font-normal">整理用时</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.start} className="border-t border-dashed border-grid">
                <td className="py-1 pr-2">{r.start.slice(5)}</td>
                <td className="pr-2">{r.openDays} 天</td>
                <td className="pr-2">{r.records} 条</td>
                <td className="pr-2">{pct(r.voiceShare)}</td>
                <td className="pr-2">{pct(r.editRatio)}</td>
                <td>
                  {r.medianAiSec === null
                    ? '–'
                    : `${r.medianAiSec.toFixed(1)} 秒`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft">
        打开：这周有几天打开过 App。语音：新记录里用语音说的比例。改稿：你改 AI
        稿子的平均改动比例，越小说明它越懂你。只统计这台设备。
      </p>
      <button
        type="button"
        className="px-btn px-btn-sm"
        onClick={() =>
          void saveFile(
            new Blob([`﻿${weeksCsv(rows)}`], { type: 'text/csv' }),
            `足迹-使用看板-${rows.at(-1)?.start ?? ''}.csv`,
          )
        }
      >
        导出 CSV
      </button>
    </div>
  )
}
