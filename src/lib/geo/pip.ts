// 点在多边形里的判断，不依赖浏览器，方便测试。
// 解码后的区域：b = [西, 南, 东, 北]，g = 多边形列表；多边形 = 环列表（第一个是外环，其余是洞）；
// 环 = [lng, lat, lng, lat, ...]

export type Ring = ArrayLike<number>
export type Region = { n: string; b: number[]; g: Ring[][] }

// 文件里的格式（scripts/prepare_assets.mjs，格式版本 2，决策 0016 第 5 条）：
// 坐标乘以 scale 取整，每个点只存和上一个点的差值
export type EncodedFile<T> = {
  version: number
  scale: number
  features: (T & { b: number[]; g: number[][][] })[]
}

export function decodeRing(ring: number[], scale: number): Float64Array {
  const out = new Float64Array(ring.length)
  let x = 0
  let y = 0
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i]
    y += ring[i + 1]
    out[i] = x / scale
    out[i + 1] = y / scale
  }
  return out
}

export function decodeRegions<T>(
  file: EncodedFile<T>,
): (Omit<T, 'g'> & { b: number[]; g: Float64Array[][] })[] {
  return file.features.map((f) => ({
    ...f,
    g: f.g.map((poly) => poly.map((ring) => decodeRing(ring, file.scale))),
  }))
}

// 射线法：从点向东发一条射线，和环的边相交奇数次就在环里
function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]
    const yi = ring[i + 1]
    const xj = ring[j]
    const yj = ring[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

export function inRegion(region: Region, lng: number, lat: number): boolean {
  const [w, s, e, n] = region.b
  if (lng < w || lng > e || lat < s || lat > n) return false
  return region.g.some(
    ([outer, ...holes]) =>
      inRing(outer, lng, lat) && !holes.some((h) => inRing(h, lng, lat)),
  )
}

// 离区域边界上最近的顶点有多远（度，粗略）。只在点落在所有区域外面时用：
// 边界精简过，海边、河边拍的照片可能刚好落在缝里
function nearestVertex(region: Region, lng: number, lat: number): number {
  let best = Infinity
  for (const poly of region.g)
    for (const ring of poly)
      for (let i = 0; i < ring.length; i += 2) {
        const d = Math.hypot(ring[i] - lng, ring[i + 1] - lat)
        if (d < best) best = d
      }
  return best
}

// 返回所在区域的序号；都不在时，取 SNAP 度（约 5 公里）以内最近的区域；再没有就是 -1
const SNAP = 0.05
export function locate(regions: Region[], lat: number, lng: number): number {
  const near: number[] = []
  for (const [i, r] of regions.entries()) {
    const [w, s, e, n] = r.b
    if (lng < w - SNAP || lng > e + SNAP || lat < s - SNAP || lat > n + SNAP)
      continue
    if (inRegion(r, lng, lat)) return i
    near.push(i)
  }
  let best = -1
  let bestD = SNAP
  for (const i of near) {
    const d = nearestVertex(regions[i], lng, lat)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// 点在不在一组多边形里，不带范围框（决策 0020 的想去清单用：边界是联网取来的，没有预先算范围框）
export function inShape(shape: Ring[][], lng: number, lat: number): boolean {
  return shape.some(
    ([outer, ...holes]) =>
      outer !== undefined &&
      inRing(outer, lng, lat) &&
      !holes.some((h) => inRing(h, lng, lat)),
  )
}
