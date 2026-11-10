import { describe, expect, it } from 'vitest'
import { changeRatio, changeStats, editDistance } from './editStats.ts'

describe('editDistance', () => {
  it('相同的文字距离为 0', () => {
    expect(editDistance('排了一小时', '排了一小时')).toBe(0)
    expect(editDistance('', '')).toBe(0)
  })

  it('一边为空时等于另一边的字数', () => {
    expect(editDistance('', '很好吃')).toBe(3)
    expect(editDistance('很好吃', '')).toBe(3)
  })

  it('分别数出增、删、换', () => {
    expect(editDistance('面很好吃', '面好吃')).toBe(1) // 删一个字
    expect(editDistance('面好吃', '面很好吃')).toBe(1) // 增一个字
    expect(editDistance('面很好吃', '面不好吃')).toBe(1) // 换一个字
    expect(editDistance('热气腾腾的面', '一碗面')).toBe(5)
  })

  it('按字算，表情符号算一个字', () => {
    expect(editDistance('好吃😀', '好吃')).toBe(1)
  })
})

describe('changeStats', () => {
  const draft = { title: '排队一小时的面', intro: '热气腾腾，浓郁却不腻。' }

  it('一字未改时改动为 0', () => {
    const s = changeStats(draft, { ...draft })
    expect(s).toEqual({ changedChars: 0, draftChars: 18 })
    expect(changeRatio(s)).toBe(0)
  })

  it('标题和正文的改动加在一起', () => {
    const s = changeStats(draft, {
      title: '排队一小时的面馆', // 增 1
      intro: '浓郁却不腻。', // 删 5
    })
    expect(s.changedChars).toBe(6)
    expect(changeRatio(s)).toBeCloseTo(6 / 18)
  })

  it('原稿为空时比例不会除以零', () => {
    const s = changeStats({ title: '', intro: '' }, { title: '面', intro: '' })
    expect(changeRatio(s)).toBe(1)
  })
})
