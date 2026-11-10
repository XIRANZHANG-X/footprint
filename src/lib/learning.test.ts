import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  nextAutoExamples,
  pickExamples,
  recentChangeRatio,
  summaryDue,
  usesExamples,
} from './learning.ts'

// 造一条修改记录：原稿 100 字，改了 changed 个字
const edit = (at: number, changed: number) => ({
  at,
  draft: { title: `标题${at}`, intro: `原稿${at}` },
  final: { title: `标题${at}`, intro: `改后${at}` },
  changedChars: changed,
  draftChars: 100,
})
const edits = (...changed: number[]) => changed.map((c, i) => edit(i + 1, c))

describe('recentChangeRatio', () => {
  it('没有修改记录时为 null', () => {
    expect(recentChangeRatio([])).toBeNull()
  })

  it('只看最近 5 次的平均值', () => {
    // 最早的一次改了 90%，不在最近 5 次里
    expect(recentChangeRatio(edits(90, 10, 10, 10, 10, 10))).toBeCloseTo(0.1)
  })
})

describe('nextAutoExamples', () => {
  it('修改次数不够 5 次时一直带例子', () => {
    expect(nextAutoExamples(false, edits(0, 0, 0))).toBe(true)
  })

  it('平均改动低于 10% 就不再带', () => {
    expect(nextAutoExamples(true, edits(5, 5, 5, 5, 5))).toBe(false)
  })

  it('升回 20% 以上重新带上', () => {
    expect(nextAutoExamples(false, edits(30, 30, 30, 30, 30))).toBe(true)
  })

  it('在 10% 和 20% 之间保持原状', () => {
    const middle = edits(15, 15, 15, 15, 15)
    expect(nextAutoExamples(true, middle)).toBe(true)
    expect(nextAutoExamples(false, middle)).toBe(false)
  })
})

describe('usesExamples', () => {
  const low = edits(5, 5, 5, 5, 5)

  it('手动开关优先于自动判断', () => {
    expect(usesExamples({ ...DEFAULT_PREFERENCES, examples: 'on' }, low)).toBe(
      true,
    )
    expect(
      usesExamples({ ...DEFAULT_PREFERENCES, examples: 'off' }, edits(90)),
    ).toBe(false)
  })

  it('自动模式按改动比例来', () => {
    expect(usesExamples(DEFAULT_PREFERENCES, low)).toBe(false)
  })
})

describe('pickExamples', () => {
  it('取最近的、确实改了东西的修改', () => {
    const picked = pickExamples(edits(10, 0, 20, 0))
    expect(picked.map((e) => e.draft.intro)).toEqual(['原稿3', '原稿1'])
  })

  it('最多取指定的个数', () => {
    expect(pickExamples(edits(1, 1, 1, 1), 2)).toHaveLength(2)
  })
})

describe('summaryDue', () => {
  it('自上次提炼以来攒够 5 次才提炼', () => {
    expect(summaryDue(DEFAULT_PREFERENCES, 4)).toBe(false)
    expect(summaryDue(DEFAULT_PREFERENCES, 5)).toBe(true)
    expect(
      summaryDue({ ...DEFAULT_PREFERENCES, editsAtLastSummary: 5 }, 9),
    ).toBe(false)
  })

  it('有一版还在等确认时不再提炼', () => {
    expect(
      summaryDue({ ...DEFAULT_PREFERENCES, proposal: '语气平实' }, 20),
    ).toBe(false)
  })
})
