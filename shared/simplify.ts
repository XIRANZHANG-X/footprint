// 简化边界（决策 0021）：道格拉斯-普克算法，去掉偏离直线不到 tolerance（度）的点。
// 坐标按 [经度, 纬度, 经度, 纬度, …] 平铺，和 src/lib/geo/pip.ts 的 Ring 一样。
// 杭州市的高德边界有 6420 个点，简化到约 200 米精度后只剩几百个，传给 App 只要几 KB。

export function simplifyRing(flat: number[], tolerance: number): number[] {
  const n = flat.length / 2
  if (n <= 4) return flat
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  // 闭合的环首尾是同一个点，直接拿首尾连线会退化成一个点：先在离起点最远的地方切开，分两段处理
  let far = 0
  let farD = -1
  for (let i = 1; i < n; i++) {
    const d = (flat[2 * i] - flat[0]) ** 2 + (flat[2 * i + 1] - flat[1]) ** 2
    if (d > farD) {
      farD = d
      far = i
    }
  }
  keep[far] = 1
  const stack: [number, number][] = [
    [0, far],
    [far, n - 1],
  ]
  const tol2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const ax = flat[2 * a]
    const ay = flat[2 * a + 1]
    const dx = flat[2 * b] - ax
    const dy = flat[2 * b + 1] - ay
    const len2 = dx * dx + dy * dy
    let best = -1
    let bestD = tol2
    for (let i = a + 1; i < b; i++) {
      const px = flat[2 * i] - ax
      const py = flat[2 * i + 1] - ay
      let d: number
      if (len2 === 0) d = px * px + py * py
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
        d = (px - t * dx) ** 2 + (py - t * dy) ** 2
      }
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++)
    if (keep[i]) out.push(flat[2 * i], flat[2 * i + 1])
  return out
}

// 一组多边形（每个是若干个环）整体简化，丢掉简化后太小的环
export type Shape = number[][][]

export function simplifyShape(shape: Shape, tolerance: number): Shape {
  return shape
    .map((poly) =>
      poly
        .map((ring) => simplifyRing(ring, tolerance))
        .filter((ring) => ring.length >= 8),
    )
    .filter((poly) => poly.length > 0)
}
