import { describe, expect, it } from 'vitest'
import { weeksCsv, weekStart, weeklyStats } from './dashboard.ts'
import { ymd } from './agents/askTools.ts'

// 决策 0029 第 1 条：使用看板
const at = (s: string) => new Date(s).getTime()
const NOW = at('2026-11-25T10:00') // 周三

describe('weekly dashboard', () => {
  it('starts weeks on Monday in local time', () => {
    expect(ymd(weekStart(NOW))).toBe('2026-11-23')
    expect(ymd(weekStart(at('2026-11-23T00:00')))).toBe('2026-11-23')
    expect(ymd(weekStart(at('2026-11-22T23:59')))).toBe('2026-11-16')
  })

  it('counts opens, records, voice share, edit ratio, AI time and cost per week', () => {
    const rows = weeklyStats(
      {
        opens: ['2026-11-17', '2026-11-19', '2026-11-23', '2026-11-25'],
        records: [
          {
            createdAt: at('2026-11-23T09:00'),
            noteVia: 'voice',
            aiTimings: null,
          },
          {
            createdAt: at('2026-11-24T09:00'),
            noteVia: 'text',
            aiTimings: {
              mode: 'full',
              geocodeMs: 1,
              imagesMs: 1,
              modelMs: 1,
              totalMs: 4000,
            },
          },
          { createdAt: at('2026-11-24T19:00'), aiTimings: null }, // 以前的记录：不知道来源
          { createdAt: at('2026-11-18T09:00'), aiTimings: null },
        ],
        edits: [
          {
            at: at('2026-11-24T10:00'),
            kind: 'edit',
            changedChars: 10,
            draftChars: 100,
          },
          {
            at: at('2026-11-24T11:00'),
            kind: 'edit',
            changedChars: 30,
            draftChars: 100,
          },
          {
            at: at('2026-11-24T12:00'),
            kind: 'choseOwn',
            changedChars: 100,
            draftChars: 100,
          },
        ],
        aiCalls: [
          {
            at: at('2026-11-24T10:00'),
            usage: [
              {
                model: 'qwen3.7-flash',
                inputTokens: 1_000_000,
                outputTokens: 0,
                seconds: null,
              },
            ],
          },
        ],
      },
      NOW,
      2,
    )
    expect(rows.map((r) => r.start)).toEqual(['2026-11-16', '2026-11-23'])
    expect(rows[0]).toMatchObject({ openDays: 2, records: 1, voiceShare: null })
    expect(rows[1]).toMatchObject({
      openDays: 2,
      records: 3,
      voiceShare: 0.5,
      medianAiSec: 4,
    })
    expect(rows[1].editRatio).toBeCloseTo(0.2)
    expect(rows[1].aiYuan).toBeGreaterThan(0)
    expect(weeksCsv(rows).split('\n')[2]).toMatch(/^2026-11-23,2,3,50,20,4\.0,/)
  })
})
