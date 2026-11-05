import { describe, expect, it } from 'vitest'
import { fitWithin } from './image.ts'

describe('fitWithin', () => {
  it('scales a landscape photo down by its long edge', () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 })
  })

  it('scales a portrait photo down by its long edge', () => {
    expect(fitWithin(3000, 4000, 400)).toEqual({ width: 300, height: 400 })
  })

  it('never upscales a small image', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })
})
