// 出行归组（决策 0005：规则法，简单、可解释，用户可以手动调整）。
//
// 规则：按拍摄时间排序，相邻两条记录间隔超过 TRIP_GAP_HOURS 就开始一次新的出行。
// 16 小时的含义：多日旅行里"今晚最后一张 → 明早第一张"通常不超过 16 小时，会连成一次；
// 周六探店和周日探店之间通常超过 16 小时，会分成两次。
// 不按距离拆分：坐飞机去外地，时间连续但距离很远，仍然属于同一次出行。
export const TRIP_GAP_HOURS = 16

// 用户对规则结果的手动修正，挂在"后一条记录"上，表示它和前一条记录的关系
export type TripBreak = 'split' | 'join' | null

export type Groupable = { id: string; takenAt: number; tripBreak: TripBreak }

export type Trip<T extends Groupable> = {
  id: string // 第一条记录的 id，作为这次出行的稳定标识
  start: number
  end: number
  records: T[] // 按时间正序
}

export function groupTrips<T extends Groupable>(
  records: T[],
  gapHours = TRIP_GAP_HOURS,
): Trip<T>[] {
  const sorted = [...records].sort((a, b) => a.takenAt - b.takenAt)
  const gapMs = gapHours * 3_600_000
  const trips: Trip<T>[] = []
  for (const r of sorted) {
    const current = trips.at(-1)
    const continues =
      current !== undefined &&
      r.tripBreak !== 'split' &&
      (r.tripBreak === 'join' || r.takenAt - current.end <= gapMs)
    if (continues) {
      current.records.push(r)
      current.end = r.takenAt
    } else {
      trips.push({ id: r.id, start: r.takenAt, end: r.takenAt, records: [r] })
    }
  }
  return trips
}
