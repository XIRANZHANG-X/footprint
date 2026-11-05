import { describe, expect, it } from 'vitest'
import type { PhotoMeta } from './photoMeta.ts'
import { summarizeRecord } from './record.ts'

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
