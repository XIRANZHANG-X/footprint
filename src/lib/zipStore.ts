import { inflateSync } from 'fflate'

// 只存不压的 zip，直接在 Blob 上读写（决策 0019 第 2 条）。
// 备份里几乎全是 JPEG，压缩没用；不压缩就能做到：
//   写：每张照片只读一遍算校验码，zip 由照片原来的 Blob 拼起来，不把所有照片同时读进内存
//   读：先读文件末尾的目录，再按位置切出每个文件，照片不用整个读进内存
// 格式是标准 zip，fflate 的 unzipSync（旧版 App 用的）能读；旧版 App 写的备份（fflate zipSync）这里也能读。
// 不支持 zip64：单个备份不能超过 4 GB、文件数不能超过 65535。

export class ZipError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

// 可以分段算：把上一段的结果作为 crc 传进来
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < data.length; i++)
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const CHUNK = 4 * 1024 * 1024

async function crcOfBlob(blob: Blob): Promise<number> {
  let crc = 0
  for (let start = 0; start < blob.size; start += CHUNK)
    crc = crc32(
      new Uint8Array(await blob.slice(start, start + CHUNK).arrayBuffer()),
      crc,
    )
  return crc
}

function dosTime(t: number) {
  const d = new Date(t)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date:
      ((Math.max(d.getFullYear(), 1980) - 1980) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate(),
  }
}

const UTF8_FLAG = 0x0800
const MAX_U32 = 0xffffffff

export type ZipEntry = { name: string; data: Blob }

export async function buildStoredZip(
  entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>,
  mtime: number,
  onEntry?: (done: number) => void,
): Promise<Blob> {
  const enc = new TextEncoder()
  const { time, date } = dosTime(mtime)
  // 不用 DOM 的 BlobPart 类型：这个文件也给 Node 里的脚本用（scripts/eval_prompts.ts）
  const parts: (Blob | Uint8Array<ArrayBuffer>)[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  let count = 0
  for await (const e of entries) {
    const name = enc.encode(e.name)
    const size = e.data.size
    if (offset + 30 + name.length + size > MAX_U32)
      throw new ZipError('备份超过 4 GB，暂不支持，请先删掉一些照片多的旧记录')
    const crc = await crcOfBlob(e.data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, UTF8_FLAG, true)
    lv.setUint16(8, 0, true) // 0 = 不压缩
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)

    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, UTF8_FLAG, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)

    parts.push(local, e.data)
    central.push(cd)
    offset += local.length + size
    count++
    onEntry?.(count)
  }
  if (count > 0xffff) throw new ZipError('备份里的文件太多，暂不支持')
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, count, true)
  ev.setUint16(10, count, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], {
    type: 'application/zip',
  })
}

export type ZipIndexEntry = {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

// 读 zip 末尾的目录，得到每个文件的位置。只读文件末尾一小段和目录本身
export async function readZipIndex(
  file: Blob,
): Promise<Map<string, ZipIndexEntry>> {
  const tailLen = Math.min(file.size, 22 + 0xffff)
  if (tailLen < 22) throw new ZipError('不是有效的 zip 文件')
  const tail = new Uint8Array(
    await file.slice(file.size - tailLen).arrayBuffer(),
  )
  const tv = new DataView(tail.buffer)
  let at = -1
  for (let i = tail.length - 22; i >= 0; i--)
    if (tv.getUint32(i, true) === 0x06054b50) {
      at = i
      break
    }
  if (at < 0) throw new ZipError('不是有效的 zip 文件')
  const cdSize = tv.getUint32(at + 12, true)
  const cdOffset = tv.getUint32(at + 16, true)
  if (cdOffset === MAX_U32 || cdOffset + cdSize > file.size)
    throw new ZipError('zip 文件不完整，或者是不支持的 zip64 格式')

  const cd = new Uint8Array(
    await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer(),
  )
  const v = new DataView(cd.buffer)
  const dec = new TextDecoder()
  const out = new Map<string, ZipIndexEntry>()
  for (let p = 0; p + 46 <= cd.length;) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new ZipError('zip 目录损坏')
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen))
    out.set(name, {
      name,
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      localOffset: v.getUint32(p + 42, true),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// 取出一个文件。不压缩的直接切片（不读内容）；压缩过的（别的工具重新打包的）读出来解压
export async function zipEntryBlob(
  file: Blob,
  e: ZipIndexEntry,
  type = '',
): Promise<Blob> {
  const head = new DataView(
    await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer(),
  )
  if (head.byteLength < 30 || head.getUint32(0, true) !== 0x04034b50)
    throw new ZipError(`zip 里的 ${e.name} 损坏`)
  const start =
    e.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
  const raw = file.slice(start, start + e.compressedSize, type)
  if (raw.size !== e.compressedSize)
    throw new ZipError(`zip 里的 ${e.name} 不完整`)
  if (e.method === 0) return raw
  if (e.method === 8)
    return new Blob(
      [
        inflateSync(
          new Uint8Array(await raw.arrayBuffer()),
        ) as Uint8Array<ArrayBuffer>,
      ],
      { type },
    )
  throw new ZipError(`zip 里的 ${e.name} 用了不支持的压缩方式`)
}
