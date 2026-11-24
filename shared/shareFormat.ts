// 跟着看的加密包（决策 0026）：App 打包加密，朋友看的页面解密。服务端只经手加密后的字节。
// 只用浏览器和 Node 都有的 Web Crypto，App、看的页面、测试共用。
//
// 明文：[4 字节 JSON 长度][JSON][照片 1 的字节][照片 2 的字节]…，JSON 里记着每张照片的位置和长度
// 密文：[12 字节随机 IV][AES-GCM 256 加密后的明文]
// 钥匙：32 字节随机数，base64url 编码后放在链接 # 后面

export type ShareStop = {
  title: string
  date: number
  place: string | null
  weather: string | null
  body: string | null
  lat: number | null
  lng: number | null
  photos: { offset: number; length: number; width: number; height: number }[]
}

export type ShareManifest = {
  v: 1
  title: string
  stats: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  showMap: boolean
  paths: { points: { lat: number; lng: number }[]; long: boolean }[]
  stops: ShareStop[]
}

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function newShareKey(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}

const importKey = (key: string) =>
  crypto.subtle.importKey(
    'raw',
    fromB64url(key) as Uint8Array<ArrayBuffer>,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  )

async function seal(key: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await importKey(key),
      plain as Uint8Array<ArrayBuffer>,
    ),
  )
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

async function open(key: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 13) throw new Error('数据不完整')
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, 12) },
      await importKey(key),
      sealed.slice(12) as Uint8Array<ArrayBuffer>,
    ),
  )
}

// 打包：照片的位置由这里填进清单
export async function packShare(
  key: string,
  manifest: Omit<ShareManifest, 'stops'> & {
    stops: (Omit<ShareStop, 'photos'> & {
      photos: { bytes: Uint8Array; width: number; height: number }[]
    })[]
  },
): Promise<Uint8Array> {
  let offset = 0
  const blobs: Uint8Array[] = []
  const stops: ShareStop[] = manifest.stops.map((s) => ({
    ...s,
    photos: s.photos.map((p) => {
      const ref = {
        offset,
        length: p.bytes.length,
        width: p.width,
        height: p.height,
      }
      offset += p.bytes.length
      blobs.push(p.bytes)
      return ref
    }),
  }))
  const json = new TextEncoder().encode(JSON.stringify({ ...manifest, stops }))
  const plain = new Uint8Array(4 + json.length + offset)
  new DataView(plain.buffer).setUint32(0, json.length)
  plain.set(json, 4)
  let at = 4 + json.length
  for (const b of blobs) {
    plain.set(b, at)
    at += b.length
  }
  return seal(key, plain)
}

export async function unpackShare(
  key: string,
  sealed: Uint8Array,
): Promise<{
  manifest: ShareManifest
  photo: (ref: ShareStop['photos'][number]) => Uint8Array
}> {
  const plain = await open(key, sealed)
  const len = new DataView(plain.buffer, plain.byteOffset).getUint32(0)
  const manifest = JSON.parse(
    new TextDecoder().decode(plain.subarray(4, 4 + len)),
  ) as ShareManifest
  const base = 4 + len
  return {
    manifest,
    photo: (ref) =>
      plain.subarray(base + ref.offset, base + ref.offset + ref.length),
  }
}

// 留言：同一把钥匙加密，存成 base64url 文本
export type ShareNote = { name: string; text: string; at: number }

export async function sealNote(key: string, note: ShareNote): Promise<string> {
  return b64url(await seal(key, new TextEncoder().encode(JSON.stringify(note))))
}

export async function openNote(key: string, data: string): Promise<ShareNote> {
  return JSON.parse(new TextDecoder().decode(await open(key, fromB64url(data))))
}
