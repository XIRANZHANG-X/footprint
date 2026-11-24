export type LatLng = { lat: number; lng: number }

// WGS-84 和 GCJ-02 互相换算（决策 0021）。
// 手机 GPS、OSM、我们存的坐标都是 WGS-84；高德的地图、地名、边界用 GCJ-02（国家规定的加密偏移），
// 两者在国内差几百米。规则：存的永远是 WGS-84，只在"画到高德地图上"和"收到高德的数据"时换算。
// 算法是公开流传的那一套（克拉索夫斯基椭球参数），正算误差在米级；反算没有公式，用迭代逼近。

const A = 6378245.0
const EE = 0.006693421622965943

// 粗略的"在不在国内"：GCJ-02 只在国内生效，国外的坐标高德也是原样用。
// 这个矩形会把蒙古、朝鲜等邻国的一部分算进来，只用来决定要不要换算坐标；
// 底图该用哪一家，由调用方按更准的方法（记录所在的国家）判断
export function inChinaRough({ lat, lng }: LatLng): boolean {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271
}

function transformLat(x: number, y: number) {
  let r =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x))
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  r +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) *
      2) /
    3
  return r
}

function transformLng(x: number, y: number) {
  let r =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r +=
    ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  r +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) *
      2) /
    3
  return r
}

// 某个 WGS-84 坐标在 GCJ-02 里要挪多少（度）
function delta({ lat, lng }: LatLng): LatLng {
  const x = lng - 105
  const y = lat - 35
  let dLat = transformLat(x, y)
  let dLng = transformLng(x, y)
  const radLat = (lat / 180) * Math.PI
  const s = Math.sin(radLat)
  const magic = 1 - EE * s * s
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { lat: dLat, lng: dLng }
}

export function wgs84ToGcj02(p: LatLng): LatLng {
  if (!inChinaRough(p)) return p
  const d = delta(p)
  return { lat: p.lat + d.lat, lng: p.lng + d.lng }
}

// 反算：猜一个 WGS-84，正算回去看差多少，按差值修正，直到差得足够小（约 1 厘米）
export function gcj02ToWgs84(p: LatLng): LatLng {
  if (!inChinaRough(p)) return p
  let guess = { lat: p.lat, lng: p.lng }
  for (let i = 0; i < 10; i++) {
    const back = wgs84ToGcj02(guess)
    const dLat = back.lat - p.lat
    const dLng = back.lng - p.lng
    guess = { lat: guess.lat - dLat, lng: guess.lng - dLng }
    if (Math.abs(dLat) < 1e-7 && Math.abs(dLng) < 1e-7) break
  }
  return guess
}
