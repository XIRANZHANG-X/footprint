import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { JournalRecord } from '../db.ts'
import {
  BackupError,
  packBackup,
  unpackBackup,
  type PhotoBytes,
} from './backupFormat.ts'

const record: JournalRecord = {
  id: 'r1',
  createdAt: 2,
  takenAt: 1,
  timeSource: 'exif',
  location: { lat: 31.2, lng: 121.5 },
  locationStatus: 'gps',
  photoCount: 1,
  note: '排了一小时',
  placeName: '某某面馆',
  aiDraft: null,
  content: { title: 't', category: '美食', intro: 'i', tags: ['a'] },
  aiStatus: 'done',
  aiError: null,
  tripBreak: null,
}

const photo: PhotoBytes = {
  id: 'p1',
  recordId: 'r1',
  order: 0,
  takenAt: 1,
  timeSource: 'exif',
  location: { lat: 31.2, lng: 121.5 },
  width: 2,
  height: 1,
  blob: new Uint8Array([0xff, 0xd8, 1, 2, 3]),
  thumb: new Uint8Array([0xff, 0xd8, 9]),
}

describe('backup format', () => {
  it('round-trips records, photo metadata and photo bytes', () => {
    const out = unpackBackup(packBackup([record], [photo], 123))
    expect(out.exportedAt).toBe(123)
    expect(out.records).toEqual([record])
    expect(out.photos).toEqual([photo])
  })

  it('keeps unknown record fields so newer fields survive a round trip', () => {
    const future = { ...record, someFutureField: 42 } as JournalRecord
    const out = unpackBackup(packBackup([future], [photo], 1))
    expect(out.records[0]).toMatchObject({ someFutureField: 42 })
  })

  it('rejects a file that is not a zip', () => {
    expect(() => unpackBackup(new Uint8Array([1, 2, 3]))).toThrow(BackupError)
  })

  it('rejects a zip from another app', () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ app: 'other', format: 1 })),
    })
    expect(() => unpackBackup(zip)).toThrow('格式不对')
  })

  it('rejects a backup whose photo file is missing', () => {
    // manifest 里登记了照片，但 zip 里没有对应的文件
    const broken = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          app: 'footprint-journal',
          format: 1,
          exportedAt: 1,
          records: [record],
          photos: [{ ...photo, blob: undefined, thumb: undefined }],
        }),
      ),
    })
    expect(() => unpackBackup(broken)).toThrow('缺少照片')
  })
})
