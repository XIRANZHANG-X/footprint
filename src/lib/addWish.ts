import { db, type Wish } from '../db.ts'
import { fetchBoundary } from './ai.ts'

// 加一个想去的地方。城市、景区这类有边界的，联网取一次边界存下，按边界判断去没去过
export async function addWish(
  p: Pick<Wish, 'name' | 'address' | 'lat' | 'lng' | 'kind' | 'boundary'>,
) {
  const id = crypto.randomUUID()
  await db.wishes.add({
    ...p,
    id,
    shape: null,
    note: '',
    addedAt: Date.now(),
    manual: null,
  })
  if (p.boundary && p.kind !== 'poi')
    void fetchBoundary(p.boundary)
      .then((b) => b.shape.length && db.wishes.update(id, { shape: b.shape }))
      .catch(() => {
        // 没取到边界就按 200 米判断，不影响加进清单
      })
}
