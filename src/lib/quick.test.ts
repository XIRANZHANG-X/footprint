import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { descriptionContract, description } from '../../shared/ai.ts'
import type { JournalRecord } from '../db.ts'
import { packBackup, unpackBackup } from './backupFormat.ts'
import {
  chineseNumber,
  DEFAULT_WATCH_WORDS,
  deletedRuns,
  learnAvoidWords,
  quantities,
  unfaithfulBits,
} from './faithful.ts'
import { decodeRing } from './geo/pip.ts'
import {
  costOf,
  formatTokens,
  formatYuan,
  monthRange,
  summarizeUsage,
  type AiCall,
} from './usage.ts'

// 决策 0016 的"快速改进"：结构化输出的格式、用量记账、忠实度检查、边界数据的编码

describe('structured output contract', () => {
  it('requires every field and forbids extra ones', () => {
    const schema = z.toJSONSchema(descriptionContract('full')) as {
      required: string[]
      additionalProperties: boolean
    }
    expect(schema.required).toEqual([
      'title',
      'category',
      'tags',
      'placeGuess',
      'intro',
      'clues',
    ])
    expect(schema.additionalProperties).toBe(false)
  })

  it('leaves the body out of the meta-mode contract', () => {
    const schema = z.toJSONSchema(descriptionContract('meta')) as {
      properties: Record<string, unknown>
    }
    expect(schema.properties.intro).toBeUndefined()
  })

  it('still repairs small mistakes when validating a reply', () => {
    const r = description.parse({
      title: '面',
      category: '不存在',
      intro: '',
      tags: 'not a list',
      placeGuess: 3,
    })
    expect(r).toMatchObject({ category: '其他', tags: [], placeGuess: null })
  })
})

describe('faithfulness check', () => {
  it('reads Chinese numbers', () => {
    expect(chineseNumber('两百五十')).toBe(250)
    expect(chineseNumber('十二')).toBe(12)
    expect(chineseNumber('三万五千')).toBe(35000)
    expect(chineseNumber('半')).toBe(0.5)
    expect(chineseNumber('几')).toBeNull()
  })

  it('finds quantities with units and normalizes how they are written', () => {
    expect(
      quantities('排了一个小时，人均38元，¥ 25 一杯，两碗面').map((q) => q.key),
    ).toEqual(['1小时', '38元', '25元', '1杯', '2碗'])
    // 日期不算：拍摄时间是告诉过模型的
    expect(quantities('11月3号')).toEqual([])
  })

  it('flags numbers and embellishments the user never said', () => {
    expect(
      unfaithfulBits(
        {
          title: '排队一小时的面',
          intro: '排了 1 小时，人均 38 元，热气腾腾。',
        },
        { note: '排了一小时', placeName: null },
        DEFAULT_WATCH_WORDS,
      ),
    ).toEqual(['38 元', '热气腾腾'])
  })

  it('does not flag words the user wrote themselves', () => {
    expect(
      unfaithfulBits(
        { title: '治愈的下午', intro: '很治愈。' },
        { note: '今天很治愈', placeName: null },
        DEFAULT_WATCH_WORDS,
      ),
    ).toEqual([])
  })
})

describe('learning words to avoid from edits', () => {
  const edit = (draft: string, final: string) => ({
    kind: 'edit' as const,
    draft: { title: 't', intro: draft },
    final: { title: 't', intro: final },
  })

  it('finds what was deleted', () => {
    expect(
      deletedRuns('汤底热气腾腾，浓郁却不腻。', '汤很浓，不腻。'),
    ).toContain('底热气腾腾')
  })

  it('learns words deleted in two or more edits, even inside longer deletions', () => {
    const learned = learnAvoidWords(
      [
        edit('汤底热气腾腾，浓郁却不腻。', '汤很浓，不腻。'),
        edit('面条热气腾腾，很有嚼劲。', '面条很有嚼劲。'),
        edit(
          '空气中弥漫着咖啡的香气，十分惬意，让人觉得岁月静好。',
          '咖啡很香。',
        ),
        edit('十分惬意。', '挺好。'),
      ],
      ['我自己写的：浓郁'],
    )
    expect(learned.map((w) => w.word)).toEqual(['惬意', '热气腾腾', '十分惬意'])
    expect(learned.every((w) => w.times === 2)).toBe(true)
  })

  it('ignores words the user keeps using and whole-body replacements', () => {
    expect(
      learnAvoidWords(
        [
          edit('热气腾腾的面。', '面。'),
          edit('热气腾腾的汤。', '汤。'),
          { ...edit('热气腾腾', '我自己写的'), kind: 'choseOwn' as const },
        ],
        ['今天的面热气腾腾'],
      ),
    ).toEqual([])
  })
})

describe('usage and cost', () => {
  const call = (p: Partial<AiCall> & Pick<AiCall, 'at'>): AiCall => ({
    id: String(p.at),
    kind: 'describe',
    ok: true,
    ms: 1000,
    usage: [],
    ...p,
  })

  it('prices tokens and audio seconds from the table', () => {
    expect(
      costOf({
        model: 'qwen3-vl-plus',
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        seconds: null,
      }),
    ).toBeCloseTo(1 + 1)
    expect(
      costOf({
        model: 'qwen3-asr-flash',
        inputTokens: null,
        outputTokens: null,
        seconds: 100,
      }),
    ).toBeCloseTo(0.022)
    expect(
      costOf({
        model: 'unknown-model',
        inputTokens: 1,
        outputTokens: 1,
        seconds: null,
      }),
    ).toBeNull()
  })

  it('sums one month and counts what it cannot price', () => {
    const [from, to] = monthRange(2026, 11)
    const vl = {
      model: 'qwen3-vl-plus',
      inputTokens: 2000,
      outputTokens: 200,
      seconds: null,
    }
    const sum = summarizeUsage(
      [
        call({ at: from + 1, usage: [vl, { ...vl, model: 'qwen3.7-flash' }] }),
        call({ at: from + 2, ok: false }),
        call({ at: from + 3, usage: [{ ...vl, inputTokens: null }] }),
        call({ at: to + 1, usage: [vl] }), // 下个月的不算
      ],
      from,
      to,
    )
    expect(sum).toMatchObject({
      calls: 3,
      failed: 1,
      inputTokens: 4000,
      outputTokens: 600,
      unpriced: 1,
    })
    expect(sum.cost).toBeCloseTo(
      (2000 * 1 + 200 * 10 + 2000 * 0.2 + 200 * 0.8) / 1e6,
    )
  })

  it('formats small amounts readably', () => {
    expect(formatYuan(0)).toBe('¥0')
    expect(formatYuan(0.004)).toBe('不到 ¥0.01')
    expect(formatYuan(1.234)).toBe('¥1.23')
    expect(formatTokens(860)).toBe('860')
    expect(formatTokens(12_345)).toBe('1.2 万')
  })

  it('handles January when asking for the previous month', () => {
    const [from, to] = monthRange(2027, 0)
    expect(new Date(from).getMonth()).toBe(11)
    expect(new Date(to).getMonth()).toBe(0)
  })
})

describe('backups carry the usage log', () => {
  const record = { id: 'r1', createdAt: 1, takenAt: 1 } as JournalRecord
  it('round-trips aiCalls and accepts old backups without them', async () => {
    const calls: AiCall[] = [
      { id: 'c1', at: 5, kind: 'describe', ok: true, ms: 900, usage: [] },
    ]
    const zip = await packBackup([record], [], 10, {
      edits: [],
      settings: [],
      aiCalls: calls,
    })
    expect((await unpackBackup(zip)).aiCalls).toEqual(calls)
    const old = await packBackup([record], [], 10)
    expect((await unpackBackup(old)).aiCalls).toEqual([])
  })
})

describe('boundary encoding', () => {
  it('decodes integer deltas back to coordinates', () => {
    // (120.1, 30.2) → (120.15, 30.25) → (120.1, 30.2)，乘以 10000 后存差值
    const ring = decodeRing([1201000, 302000, 500, 500, -500, -500], 1e4)
    expect(Array.from(ring)).toEqual([120.1, 30.2, 120.15, 30.25, 120.1, 30.2])
  })
})
