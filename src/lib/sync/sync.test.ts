import { describe, expect, it } from 'vitest'
import { deriveKey, newMeta, open, seal, unlock } from './crypto.ts'
import { emptyState, mergeStates, type SyncState } from './merge.ts'

// 决策 0029 第 3 条：多设备同步

const state = (patch: Partial<SyncState>): SyncState => ({
  ...emptyState(),
  ...patch,
})
const TABLES = ['records', 'settings'] as const

describe('merge', () => {
  it('takes the newer row from either side and keeps rows only one side has', () => {
    const local = state({
      tables: {
        records: [
          { id: 'a', title: '本机改过', _mt: 20 },
          { id: 'b', title: '本机旧的', _mt: 5 },
          { id: 'c', title: '只在本机', _mt: 1 },
        ],
      },
    })
    const remote = state({
      tables: {
        records: [
          { id: 'a', title: '网盘旧的', _mt: 10 },
          { id: 'b', title: '网盘新的', _mt: 15 },
          { id: 'd', title: '只在网盘', _mt: 3 },
        ],
      },
    })
    const r = mergeStates(local, remote, TABLES, 100)
    const titles = Object.fromEntries(
      (r.merged.tables.records ?? []).map((x) => [x.id, x.title]),
    )
    expect(titles).toEqual({
      a: '本机改过',
      b: '网盘新的',
      c: '只在本机',
      d: '只在网盘',
    })
    expect(r.apply.map((a) => a.row.id).sort()).toEqual(['b', 'd'])
    expect(r.remove).toEqual([])
  })

  it('deletes when the tombstone is newer, keeps when edited after deletion', () => {
    const local = state({
      tables: {
        records: [
          { id: 'x', _mt: 10 },
          { id: 'y', _mt: 50 }, // 删除之后本机又改过
        ],
      },
    })
    const remote = state({
      tombstones: [
        { key: 'records/x', table: 'records', id: 'x', at: 30 },
        { key: 'records/y', table: 'records', id: 'y', at: 30 },
      ],
    })
    const r = mergeStates(local, remote, TABLES, 100)
    expect(r.remove).toEqual([{ table: 'records', id: 'x' }])
    expect(r.merged.tables.records?.map((x) => x.id)).toEqual(['y'])
    expect(r.merged.tombstones).toHaveLength(2)
  })

  it('treats rows without a modification time as oldest', () => {
    const r = mergeStates(
      state({ tables: { records: [{ id: 'a', v: 'old' }] } }),
      state({ tables: { records: [{ id: 'a', v: 'new', _mt: 1 }] } }),
      TABLES,
      100,
    )
    expect(r.apply.map((a) => a.row.v)).toEqual(['new'])
  })

  it('never syncs device-only settings', () => {
    const r = mergeStates(
      state({
        tables: {
          settings: [
            { key: 'syncConfig', _mt: 1 },
            { key: 'home', _mt: 1 },
          ],
        },
      }),
      state({
        tables: {
          settings: [
            { key: 'opens', _mt: 9 },
            { key: 'syncStatus', _mt: 9 },
          ],
        },
      }),
      TABLES,
      100,
    )
    expect(r.merged.tables.settings?.map((x) => x.key)).toEqual(['home'])
    expect(r.apply).toEqual([])
  })

  it('merges track points by time', () => {
    const r = mergeStates(
      state({
        track: [
          { t: 1, lat: 1 },
          { t: 3, lat: 3 },
        ],
      }),
      state({
        track: [
          { t: 2, lat: 2 },
          { t: 3, lat: 3 },
        ],
      }),
      TABLES,
      100,
    )
    expect(r.merged.track.map((p) => p.t)).toEqual([1, 2, 3])
    expect(r.track).toEqual([{ t: 2, lat: 2 }])
  })
})

describe('sync crypto', () => {
  it('round-trips and refuses a wrong passphrase', async () => {
    const { meta, key } = await newMeta('correct horse battery')
    expect(meta.rounds).toBe(310_000)
    const text = await seal(key, { hello: '你好' })
    expect(text).not.toContain('你好')
    expect(await open(key, text)).toEqual({ hello: '你好' })
    expect(await unlock('wrong passphrase', meta)).toBeNull()
    const again = await unlock('correct horse battery', meta)
    expect(again).not.toBeNull()
    expect(await open(again!, text)).toEqual({ hello: '你好' })
  })

  it('derives different keys from different salts', async () => {
    const a = await deriveKey('same', 'AAAAAAAAAAAAAAAAAAAAAA==', 1000)
    const b = await deriveKey('same', 'BBBBBBBBBBBBBBBBBBBBBB==', 1000)
    const text = await seal(a, 1)
    await expect(open(b, text)).rejects.toThrow()
  })
})
