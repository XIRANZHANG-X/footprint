import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { JournalRecord } from '../db.ts'
import {
  BackupError,
  packBackup,
  unpackBackup,
  type PhotoBlobs,
} from './backupFormat.ts'
import {
  buildStoredZip,
  crc32,
  readZipIndex,
  zipEntryBlob,
} from './zipStore.ts'

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
  bodySource: 'ai',
  placeGuess: null,
  aiTimings: null,
}

const jpeg = (bytes: number[]) =>
  new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

const photo: PhotoBlobs = {
  id: 'p1',
  recordId: 'r1',
  order: 0,
  takenAt: 1,
  timeSource: 'exif',
  location: { lat: 31.2, lng: 121.5 },
  width: 2,
  height: 1,
  blob: jpeg([0xff, 0xd8, 1, 2, 3]),
  thumb: jpeg([0xff, 0xd8, 9]),
}
const { blob: _b, thumb: _t, ...photoMeta } = photo

const bytesOf = async (b: Blob) =>
  Array.from(new Uint8Array(await b.arrayBuffer()))
// 测试里用 fflate 造旧版 App 写的备份
const blobOf = (u: Uint8Array) => new Blob([u as BlobPart])

describe('backup format', () => {
  it('round-trips records, photo metadata and photo bytes', async () => {
    const out = await unpackBackup(await packBackup([record], [photo], 123))
    expect(out.exportedAt).toBe(123)
    expect(out.records).toEqual([record])
    const { blob, thumb, ...meta } = out.photos[0]
    expect(meta).toEqual(photoMeta)
    expect(await bytesOf(blob)).toEqual([0xff, 0xd8, 1, 2, 3])
    expect(await bytesOf(thumb)).toEqual([0xff, 0xd8, 9])
    expect(blob.type).toBe('image/jpeg')
  })

  it('round-trips the edit log and settings', async () => {
    const content = {
      title: 't',
      category: '美食' as const,
      intro: 'i',
      tags: [],
    }
    const edits = [
      {
        id: 'e1',
        recordId: 'r1',
        at: 5,
        kind: 'edit' as const,
        draft: content,
        final: { ...content, intro: '改过的' },
        changedChars: 3,
        draftChars: 2,
      },
    ]
    const settings = [{ key: 'preferences', value: { text: '语气平实' } }]
    const out = await unpackBackup(
      await packBackup([record], [photo], 1, { edits, settings }),
    )
    expect(out.edits).toEqual(edits)
    expect(out.settings).toEqual(settings)
  })

  it('reports progress per file', async () => {
    const seen: string[] = []
    await packBackup([record], [photo], 1, undefined, (done, total) =>
      seen.push(`${done}/${total}`),
    )
    expect(seen).toEqual(['1/3', '2/3', '3/3'])
  })

  it('reads an older backup that has no edit log or settings', async () => {
    const old = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          app: 'footprint-journal',
          format: 1,
          exportedAt: 1,
          records: [record],
          photos: [],
        }),
      ),
    })
    const out = await unpackBackup(blobOf(old))
    expect(out.edits).toEqual([])
    expect(out.settings).toEqual([])
  })

  it('reads photos from an older backup written by fflate zipSync', async () => {
    const old = zipSync(
      {
        'manifest.json': strToU8(
          JSON.stringify({
            app: 'footprint-journal',
            format: 1,
            exportedAt: 1,
            records: [record],
            photos: [photoMeta],
          }),
        ),
        'photos/p1.jpg': new Uint8Array([0xff, 0xd8, 1, 2, 3]),
        'thumbs/p1.jpg': new Uint8Array([0xff, 0xd8, 9]),
      },
      { level: 0 },
    )
    const out = await unpackBackup(blobOf(old))
    expect(await bytesOf(out.photos[0].blob)).toEqual([0xff, 0xd8, 1, 2, 3])
  })

  it('writes a zip that older app versions (fflate unzipSync) can read', async () => {
    const zip = await packBackup([record], [photo], 1)
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual([
      'manifest.json',
      'photos/p1.jpg',
      'thumbs/p1.jpg',
    ])
    expect(Array.from(files['photos/p1.jpg'])).toEqual([0xff, 0xd8, 1, 2, 3])
  })

  it('keeps unknown record fields so newer fields survive a round trip', async () => {
    const future = { ...record, someFutureField: 42 } as JournalRecord
    const out = await unpackBackup(await packBackup([future], [photo], 1))
    expect(out.records[0]).toMatchObject({ someFutureField: 42 })
  })

  it('rejects a file that is not a zip', async () => {
    await expect(
      unpackBackup(blobOf(new Uint8Array([1, 2, 3]))),
    ).rejects.toThrow(BackupError)
    await expect(
      unpackBackup(blobOf(new Uint8Array(100).fill(7))),
    ).rejects.toThrow(BackupError)
  })

  it('rejects a truncated backup', async () => {
    const zip = await packBackup([record], [photo], 1)
    await expect(unpackBackup(zip.slice(0, zip.size - 30))).rejects.toThrow(
      BackupError,
    )
  })

  it('rejects a zip from another app', async () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ app: 'other', format: 1 })),
    })
    await expect(unpackBackup(blobOf(zip))).rejects.toThrow('格式不对')
  })

  it('rejects a backup whose photo file is missing', async () => {
    // manifest 里登记了照片，但 zip 里没有对应的文件
    const broken = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          app: 'footprint-journal',
          format: 1,
          exportedAt: 1,
          records: [record],
          photos: [photoMeta],
        }),
      ),
    })
    await expect(unpackBackup(blobOf(broken))).rejects.toThrow('缺少照片')
  })
})

describe('stored zip', () => {
  it('computes the standard CRC-32, also in pieces', () => {
    const data = strToU8('123456789')
    expect(crc32(data)).toBe(0xcbf43926)
    expect(crc32(data.subarray(4), crc32(data.subarray(0, 4)))).toBe(0xcbf43926)
  })

  it('handles entries bigger than one read chunk and Chinese names', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 3).map((_, i) => i % 251)
    const zip = await buildStoredZip(
      [
        { name: '中文/名字.txt', data: new Blob(['你好']) },
        { name: 'big.bin', data: new Blob([big]) },
      ],
      Date.UTC(2026, 10, 24),
    )
    // 用另一个实现（fflate）解开，校验码和大小都对得上才不会报错
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(new TextDecoder().decode(files['中文/名字.txt'])).toBe('你好')
    expect(files['big.bin']).toEqual(big)
    const index = await readZipIndex(zip)
    const entry = await zipEntryBlob(zip, index.get('big.bin')!)
    expect(entry.size).toBe(big.length)
  })

  it('inflates entries that another tool compressed', async () => {
    const text = strToU8('压缩过的内容'.repeat(50))
    const zip = blobOf(zipSync({ 'a.txt': text }, { level: 9 }))
    const index = await readZipIndex(zip)
    expect(index.get('a.txt')!.method).toBe(8)
    const out = await zipEntryBlob(zip, index.get('a.txt')!)
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(text)
  })
})

describe('backups carry wishes and places added by hand', () => {
  it('round-trips both lists, and old backups give empty lists', async () => {
    const wishes = [
      {
        id: 'w1',
        name: '某家咖啡馆',
        address: null,
        lat: 25.6,
        lng: 100.2,
        kind: 'poi' as const,
        boundary: null,
        shape: null,
        note: '想去',
        addedAt: 5,
        manual: null,
      },
    ]
    const visited = [
      {
        id: 'v1',
        kind: 'cn' as const,
        name: '杭州市',
        cc: 'CN',
        a1: null,
        code: '330100',
        city: '杭州市',
        shape: [[[120, 30, 120.1, 30, 120.1, 30.1, 120, 30]]],
        addedAt: 6,
      },
    ]
    const out = await unpackBackup(
      await packBackup([record], [], 1, {
        edits: [],
        settings: [],
        wishes,
        visited,
      }),
    )
    expect(out.wishes).toEqual(wishes)
    expect(out.visited).toEqual(visited)
    const old = await unpackBackup(await packBackup([record], [], 1))
    expect(old.wishes).toEqual([])
    expect(old.visited).toEqual([])
  })
})
