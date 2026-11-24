import type { JournalRecord, Wish } from '../db.ts'
import { inShape } from './geo/pip.ts'
import { distanceM } from './visits.ts'

// 想去的地方什么时候算"去过了"（决策 0020 第 7 条）：
// - 加进清单之后拍的记录，落在那个地方里：有边界的（城市、景区）按边界，没有的（店、长按加的点）按 200 米
// - "想去"和"去过"是两张单子：以前去过、还想再去的地方，加进来时不算完成，再去一次才算
// - 用户手动改过的以手动为准（判错了可以拿回来，也可以手动标成去过了）

export const WISH_NEAR_M = 200

type Located = Pick<JournalRecord, 'id' | 'takenAt' | 'location'>

export type WishState =
  { done: false } | { done: true; recordId: string | null; at: number | null }

export function wishState(wish: Wish, records: Located[]): WishState {
  if (wish.manual === 'done') return { done: true, recordId: null, at: null }
  if (wish.manual === 'undone') return { done: false }
  const hit = records
    .filter((r) => r.location && r.takenAt >= wish.addedAt && covers(wish, r))
    .sort((a, b) => a.takenAt - b.takenAt)[0]
  return hit
    ? { done: true, recordId: hit.id, at: hit.takenAt }
    : { done: false }
}

function covers(wish: Wish, r: Located): boolean {
  const l = r.location!
  if (wish.shape && wish.shape.length > 0)
    return inShape(wish.shape, l.lng, l.lat)
  return distanceM(l, wish) <= WISH_NEAR_M
}

// 每条记录实现了哪个想去的地方（卡片上的"★ 想去的地方"标签）
export function fulfilledBy(
  wishes: Wish[],
  records: Located[],
): Map<string, string> {
  const out = new Map<string, string>()
  for (const w of wishes) {
    const s = wishState(w, records)
    if (s.done && s.recordId && !out.has(s.recordId))
      out.set(s.recordId, w.name)
  }
  return out
}
