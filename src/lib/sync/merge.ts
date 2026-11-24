import type { SyncedTable, Tombstone } from '../../db.ts'

// 两台设备的数据怎么合并（决策 0029 第 3c 条）。纯函数，方便测试：
// - 每一行看修改时间 _mt，后改的为准；一样时本机为准
// - 删除标记比这一行的修改时间晚（或相同），就删掉；早就保留（删了之后又在别的设备上改过）
// - 轨迹没有稳定的编号，按时间点合并（两边都有就是同一个点）

export type Row = Record<string, unknown> & { _mt?: number }
export type TrackRow = { t: number } & Record<string, unknown>

export type SyncState = {
  v: 1
  at: number
  tables: Partial<Record<SyncedTable, Row[]>>
  tombstones: Tombstone[]
  track: TrackRow[]
}

export const emptyState = (): SyncState => ({
  v: 1,
  at: 0,
  tables: {},
  tombstones: [],
  track: [],
})

export const keyField = (t: SyncedTable) => (t === 'settings' ? 'key' : 'id')

// 每台设备自己的设置，不同步：网盘账号和同步口令、同步状态、打开记录（看板只统计这台设备）
export const isLocalSetting = (key: string) =>
  key.startsWith('sync') || key === 'opens'

const mt = (r: Row | undefined) => (typeof r?._mt === 'number' ? r._mt : 0)

export type MergeResult = {
  merged: SyncState
  apply: { table: SyncedTable; row: Row }[] // 网盘上的更新，要写进本机
  remove: { table: SyncedTable; id: string }[] // 别处删掉了，本机也删
  track: TrackRow[] // 本机没有的轨迹点
}

export function mergeStates(
  local: SyncState,
  remote: SyncState,
  tables: readonly SyncedTable[],
  now: number,
): MergeResult {
  const tombs = new Map<string, Tombstone>()
  for (const t of [...remote.tombstones, ...local.tombstones]) {
    const old = tombs.get(t.key)
    if (!old || t.at > old.at) tombs.set(t.key, t)
  }

  const merged: SyncState = {
    v: 1,
    at: now,
    tables: {},
    tombstones: [...tombs.values()],
    track: [],
  }
  const apply: MergeResult['apply'] = []
  const remove: MergeResult['remove'] = []

  for (const table of tables) {
    const k = keyField(table)
    const keep = (r: Row) =>
      table !== 'settings' || !isLocalSetting(String(r[k]))
    const mine = new Map(
      (local.tables[table] ?? []).filter(keep).map((r) => [String(r[k]), r]),
    )
    const theirs = new Map(
      (remote.tables[table] ?? []).filter(keep).map((r) => [String(r[k]), r]),
    )
    const out: Row[] = []
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const a = mine.get(id)
      const b = theirs.get(id)
      const remoteWins = b !== undefined && (a === undefined || mt(b) > mt(a))
      const winner = remoteWins ? b : (a ?? b)!
      const tomb = tombs.get(`${table}/${id}`)
      if (tomb && tomb.at >= mt(winner)) {
        if (a) remove.push({ table, id })
        continue
      }
      out.push(winner)
      if (remoteWins) apply.push({ table, row: winner })
    }
    merged.tables[table] = out
  }

  const localTimes = new Set(local.track.map((p) => p.t))
  const track = new Map<number, TrackRow>()
  for (const p of [...remote.track, ...local.track]) track.set(p.t, p)
  merged.track = [...track.values()].sort((a, b) => a.t - b.t)

  return {
    merged,
    apply,
    remove,
    track: remote.track.filter((p) => !localTimes.has(p.t)),
  }
}
