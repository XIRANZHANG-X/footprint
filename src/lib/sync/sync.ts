import { db, SYNCED_TABLES, type StoredPhoto } from '../../db.ts'
import {
  newMeta,
  open,
  openBytes,
  seal,
  sealBytes,
  unlock,
  type SyncMeta,
} from './crypto.ts'
import {
  emptyState,
  isLocalSetting,
  mergeStates,
  type Row,
  type SyncState,
  type TrackRow,
} from './merge.ts'
import { Dav, type DavConfig, type Transport } from './webdav.ts'

// 多设备同步（决策 0029 第 3 条）：
// 1. 读网盘的 meta.json，用同步口令解开钥匙（第一次就新建）
// 2. 读 state.bin（加密的全部数据，不含照片原图）和它的版本号
// 3. 和本机合并：网盘上更新的写进本机，别处删掉的本机也删
// 4. 先传新照片，再传合并后的 state.bin（带上读到时的版本号；被别人抢先改了就重来一次）

export const SYNC_CONFIG_KEY = 'syncConfig'
export const SYNC_STATUS_KEY = 'syncStatus'

export type SyncConfig = DavConfig & { passphrase: string }
export type SyncReport = {
  at: number
  pulled: number // 写进本机的行数
  removed: number
  pushedPhotos: number
  pulledPhotos: number
}

// ---------- 照片文件：一张照片一个文件，原图和缩略图放在一起再加密 ----------

async function packPhoto(p: StoredPhoto): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Uint8Array(await p.blob.arrayBuffer())
  const thumb = new Uint8Array(await p.thumb.arrayBuffer())
  const head = new TextEncoder().encode(
    JSON.stringify({
      type: p.blob.type,
      thumbType: p.thumb.type,
      n: blob.length,
    }),
  )
  const out = new Uint8Array(4 + head.length + blob.length + thumb.length)
  new DataView(out.buffer).setUint32(0, head.length)
  out.set(head, 4)
  out.set(blob, 4 + head.length)
  out.set(thumb, 4 + head.length + blob.length)
  return out
}

function unpackPhoto(bytes: Uint8Array): { blob: Blob; thumb: Blob } {
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0)
  const head = JSON.parse(
    new TextDecoder().decode(bytes.subarray(4, 4 + len)),
  ) as { type: string; thumbType: string; n: number }
  const start = 4 + len
  return {
    blob: new Blob([bytes.slice(start, start + head.n)], { type: head.type }),
    thumb: new Blob([bytes.slice(start + head.n)], { type: head.thumbType }),
  }
}

const photoPath = (id: string) => `photos/${id}.txt`

// ---------- 本机快照 ----------

async function localState(): Promise<SyncState> {
  const state = emptyState()
  for (const t of SYNCED_TABLES) {
    let rows = (await db.table(t).toArray()) as Row[]
    if (t === 'photos')
      rows = rows.map(({ blob: _b, thumb: _t, ...rest }) => rest as Row)
    if (t === 'settings')
      rows = rows.filter((r) => !isLocalSetting(String(r.key)))
    state.tables[t] = rows
  }
  state.tombstones = await db.tombstones.toArray()
  state.track = (await db.track.toArray()).map(
    ({ id: _id, ...p }) => p as TrackRow,
  )
  return state
}

async function readKey(dav: Dav, passphrase: string): Promise<CryptoKey> {
  const got = await dav.get('meta.json')
  if (got) {
    const key = await unlock(passphrase, JSON.parse(got.text) as SyncMeta)
    if (!key)
      throw new Error(
        '同步口令和网盘上的不一致。用第一次设置同步时的口令；忘了的话只能在网盘上删掉 footprint-journal 文件夹重来',
      )
    return key
  }
  await dav.ensureDirs()
  const { meta, key } = await newMeta(passphrase)
  if (!(await dav.put('meta.json', JSON.stringify(meta), null)))
    return readKey(dav, passphrase) // 另一台设备刚好同时建好了
  return key
}

export async function syncNow(
  config: SyncConfig,
  transport?: Transport,
  onProgress?: (msg: string) => void,
): Promise<SyncReport> {
  const dav = new Dav(config, transport)
  onProgress?.('连接网盘…')
  const key = await readKey(dav, config.passphrase)

  for (let attempt = 0; attempt < 3; attempt++) {
    onProgress?.('读取网盘上的数据…')
    const got = await dav.get('state.txt')
    const remote = got ? await open<SyncState>(key, got.text) : emptyState()
    const local = await localState()
    const { merged, apply, remove, track } = mergeStates(
      local,
      remote,
      SYNCED_TABLES,
      Date.now(),
    )

    // 网盘上更新的照片：先把文件下载下来，再和其他行一起写进本机
    const photoBlobs = new Map<string, { blob: Blob; thumb: Blob }>()
    const photoRows = apply.filter((a) => a.table === 'photos')
    for (const [i, a] of photoRows.entries()) {
      onProgress?.(`下载照片 ${i + 1}/${photoRows.length}`)
      const id = String(a.row.id)
      const file = await dav.get(photoPath(id))
      if (file) photoBlobs.set(id, unpackPhoto(await openBytes(key, file.text)))
    }

    onProgress?.('写入本机…')
    await db.transaction(
      'rw',
      [...SYNCED_TABLES.map((t) => db.table(t)), db.track, db.tombstones],
      async () => {
        for (const { table, row } of apply) {
          if (table === 'photos') {
            const blobs = photoBlobs.get(String(row.id))
            if (!blobs) continue // 照片文件还没传上来：下次再拿
            await db.photos.put({
              ...(row as unknown as StoredPhoto),
              ...blobs,
            })
          } else await db.table(table).put(row)
        }
        for (const { table, id } of remove) await db.table(table).delete(id)
        if (track.length) await db.track.bulkAdd(track as never[])
        await db.tombstones.bulkPut(merged.tombstones)
      },
    )

    // 本机新的或改过的照片传上去（state 之前传，别的设备不会读到还没有文件的照片）
    const remotePhotos = new Map(
      (remote.tables.photos ?? []).map((r) => [String(r.id), r._mt ?? 0]),
    )
    const toPush = (merged.tables.photos ?? []).filter(
      (r) =>
        !apply.some((a) => a.table === 'photos' && a.row.id === r.id) &&
        (remotePhotos.get(String(r.id)) ?? -1) < (r._mt ?? 0),
    )
    for (const [i, r] of toPush.entries()) {
      onProgress?.(`上传照片 ${i + 1}/${toPush.length}`)
      const p = await db.photos.get(String(r.id))
      if (p)
        await dav.put(photoPath(p.id), await sealBytes(key, await packPhoto(p)))
    }

    onProgress?.('上传…')
    const ok = await dav.put(
      'state.txt',
      await seal(key, merged),
      got ? got.etag : null,
    )
    if (!ok) continue // 另一台设备刚同步过：重新读、重新合并

    // 删掉的照片，网盘上的文件也删
    const goneBefore = new Set(
      remote.tombstones.filter((t) => t.table === 'photos').map((t) => t.id),
    )
    for (const t of merged.tombstones)
      if (t.table === 'photos' && !goneBefore.has(t.id))
        await dav.remove(photoPath(t.id))

    const report: SyncReport = {
      at: Date.now(),
      pulled: apply.length + track.length,
      removed: remove.length,
      pushedPhotos: toPush.length,
      pulledPhotos: photoBlobs.size,
    }
    await db.settings.put({ key: SYNC_STATUS_KEY, value: report })
    return report
  }
  throw new Error('网盘上的数据一直在变（另一台设备在同步？），过一会儿再试')
}
