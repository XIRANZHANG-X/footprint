import { describe, expect, it } from 'vitest'
import { normalizeExif, validLocation } from './photoMeta.ts'

const FILE_TIME = Date.UTC(2026, 0, 1)

describe('normalizeExif', () => {
  it('uses the capture time and GPS when present', () => {
    const shot = new Date(2025, 9, 1, 12, 30)
    expect(
      normalizeExif(
        { DateTimeOriginal: shot, latitude: 31.23, longitude: 121.47 },
        FILE_TIME,
      ),
    ).toEqual({
      takenAt: shot.getTime(),
      timeSource: 'exif',
      location: { lat: 31.23, lng: 121.47 },
    })
  })

  it('falls back to CreateDate when DateTimeOriginal is missing', () => {
    const created = new Date(2025, 5, 1)
    expect(normalizeExif({ CreateDate: created }, FILE_TIME).takenAt).toBe(
      created.getTime(),
    )
  })

  it('treats a photo with no EXIF at all (e.g. forwarded through a chat app) as file-time and no location', () => {
    expect(normalizeExif(undefined, FILE_TIME)).toEqual({
      takenAt: FILE_TIME,
      timeSource: 'file',
      location: null,
    })
  })

  it('ignores an invalid date', () => {
    expect(
      normalizeExif({ DateTimeOriginal: new Date('nope') }, FILE_TIME)
        .timeSource,
    ).toBe('file')
  })
})

describe('validLocation', () => {
  it('rejects the (0, 0) placeholder some phones write without a fix', () => {
    expect(validLocation(0, 0)).toBeNull()
  })

  it('rejects out-of-range and non-numeric values', () => {
    expect(validLocation(91, 10)).toBeNull()
    expect(validLocation(10, 181)).toBeNull()
    expect(validLocation('31', 121)).toBeNull()
    expect(validLocation(Number.NaN, 121)).toBeNull()
  })

  it('accepts southern and western hemispheres', () => {
    expect(validLocation(-33.86, -70.65)).toEqual({ lat: -33.86, lng: -70.65 })
  })
})
