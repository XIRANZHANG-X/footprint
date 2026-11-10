import { describe, expect, it } from 'vitest'
import type { PhotoMeta } from './photoMeta.ts'
import {
  draftSummary,
  formatTimings,
  hasBothVersions,
  recordBody,
  summarizeRecord,
} from './record.ts'

const here = { lat: 31.2, lng: 121.5 }
const there = { lat: 30.3, lng: 120.2 }

describe('summarizeRecord', () => {
  it('takes the earliest capture time and the earliest GPS location', () => {
    const photos: PhotoMeta[] = [
      { takenAt: 300, timeSource: 'exif', location: there },
      { takenAt: 100, timeSource: 'exif', location: null },
      { takenAt: 200, timeSource: 'exif', location: here },
    ]
    expect(summarizeRecord(photos)).toEqual({
      takenAt: 100,
      timeSource: 'exif',
      location: here,
      locationStatus: 'gps',
    })
  })

  it('marks the record as pending location when no photo has GPS', () => {
    const s = summarizeRecord([
      { takenAt: 1, timeSource: 'exif', location: null },
    ])
    expect(s.locationStatus).toBe('pending')
    expect(s.location).toBeNull()
  })

  it('does not let an unreliable file time beat a real capture time', () => {
    const s = summarizeRecord([
      { takenAt: 50, timeSource: 'file', location: null },
      { takenAt: 900, timeSource: 'exif', location: null },
    ])
    expect(s).toMatchObject({ takenAt: 900, timeSource: 'exif' })
  })

  it('falls back to file time when no photo has a capture time', () => {
    expect(
      summarizeRecord([{ takenAt: 50, timeSource: 'file', location: null }])
        .timeSource,
    ).toBe('file')
  })

  it('rejects an empty record', () => {
    expect(() => summarizeRecord([])).toThrow()
  })
})

describe('formatTimings', () => {
  it('列出各步耗时', () => {
    expect(
      formatTimings({
        geocodeMs: 900,
        imagesMs: 320,
        modelMs: 4810,
        totalMs: 5730,
      }),
    ).toBe('整理用时 5.7 秒（地名 0.9 秒 · 缩图 0.3 秒 · 模型 4.8 秒）')
  })

  it('没查地名时不显示地名一项', () => {
    expect(
      formatTimings({
        geocodeMs: null,
        imagesMs: 300,
        modelMs: 2000,
        totalMs: 2300,
      }),
    ).toBe('整理用时 2.3 秒（缩图 0.3 秒 · 模型 2.0 秒）')
  })
})

describe('recordBody', () => {
  const ai = { intro: 'AI 写的正文' }

  it('选了自己写的就显示原话，哪怕 AI 也写了一版', () => {
    expect(recordBody({ note: '我写的', bodySource: 'own', content: ai })).toBe(
      '我写的',
    )
  })

  it('选了 AI 版就显示 AI 的正文', () => {
    expect(recordBody({ note: '我写的', bodySource: 'ai', content: ai })).toBe(
      'AI 写的正文',
    )
  })

  it('选了 AI 版但 AI 没有正文时退回自己写的', () => {
    expect(
      recordBody({ note: '我写的', bodySource: 'ai', content: null }),
    ).toBe('我写的')
    expect(
      recordBody({ note: '我写的', bodySource: 'ai', content: { intro: '' } }),
    ).toBe('我写的')
  })
})

describe('hasBothVersions', () => {
  it('两版都有内容才算', () => {
    const both = {
      note: '我写的',
      bodySource: 'own' as const,
      content: { intro: 'AI' },
    }
    expect(hasBothVersions(both)).toBe(true)
    expect(hasBothVersions({ ...both, note: '  ' })).toBe(false)
    expect(hasBothVersions({ ...both, content: { intro: '' } })).toBe(false)
    expect(hasBothVersions({ ...both, content: null })).toBe(false)
  })
})

describe('draftSummary', () => {
  it('照片数和文字开头都有', () => {
    expect(
      draftSummary({
        files: [1, 2, 3],
        note: '排了一小时的面，汤很浓，下次还来',
      }),
    ).toBe('3 张照片 · 排了一小时的面，汤很浓，…')
  })

  it('只有照片或只有文字', () => {
    expect(draftSummary({ files: [1], note: ' ' })).toBe('1 张照片')
    expect(draftSummary({ files: [], note: '江边走走' })).toBe('江边走走')
  })
})
