import { describe, expect, it } from 'vitest'
import { coverCrop, photoSlots, wrapText } from './layout.ts'

// 每个字符宽 10，便于计算
const measure = (s: string) => Array.from(s).length * 10

describe('wrapText', () => {
  it('breaks Chinese text by width', () => {
    expect(wrapText('一二三四五六七', 30, measure)).toEqual([
      '一二三',
      '四五六',
      '七',
    ])
  })

  it('keeps closing punctuation off the start of a line', () => {
    // "三" 之后本该换行，但"，"不能放在行首，挤到上一行
    expect(wrapText('一二三，四五', 30, measure)).toEqual(['一二三，', '四五'])
  })

  it('respects explicit newlines', () => {
    expect(wrapText('一二\n三', 100, measure)).toEqual(['一二', '三'])
  })

  it('truncates with an ellipsis that still fits the width', () => {
    expect(wrapText('一二三四五六七八九', 30, measure, 2)).toEqual([
      '一二三',
      '四五…',
    ])
  })

  it('handles emoji as single characters', () => {
    expect(wrapText('😀😀😀😀', 20, measure)).toEqual(['😀😀', '😀😀'])
  })
})

describe('photoSlots', () => {
  it('fills the square with one photo', () => {
    expect(photoSlots(1, 100, 4)).toEqual([{ x: 0, y: 0, w: 100, h: 100 }])
  })

  it('lays out three photos as one tall plus two stacked', () => {
    const [a, b, c] = photoSlots(3, 100, 4)
    expect(a).toEqual({ x: 0, y: 0, w: 48, h: 100 })
    expect(b).toEqual({ x: 52, y: 0, w: 48, h: 48 })
    expect(c).toEqual({ x: 52, y: 52, w: 48, h: 48 })
  })

  it('caps at four slots', () => {
    expect(photoSlots(9, 100, 4)).toHaveLength(4)
  })
})

describe('coverCrop', () => {
  it('crops the sides of a landscape photo into a square', () => {
    expect(coverCrop(400, 300, 100, 100)).toEqual({
      x: 50,
      y: 0,
      w: 300,
      h: 300,
    })
  })

  it('crops top and bottom of a portrait photo into a wide box', () => {
    expect(coverCrop(300, 400, 200, 100)).toEqual({
      x: 0,
      y: 125,
      w: 300,
      h: 150,
    })
  })
})
