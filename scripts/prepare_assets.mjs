// 准备体积大的静态资源（决策 0014）。这些文件不进 git，`npm run dev` / `build` 之前自动运行：
//   public/ort/      onnxruntime 的 wasm（从 node_modules 复制，本地语义搜索用）
//   public/models/   中文向量模型 Xenova/bge-small-zh-v1.5 量化版（从 Hugging Face 下载）
//   public/geo/      精简后的行政边界：Natural Earth 全球省州级、geoBoundaries 中国区县级
// 下载的原始文件缓存在 .cache/assets/，已经存在就不再下载。
// 用法：node scripts/prepare_assets.mjs [--force]  （--force 重新生成 public 下的文件）

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'assets')
const PUBLIC = join(ROOT, 'public')
const force = process.argv.includes('--force')

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  )

async function download(url, dest) {
  if (await exists(dest)) return dest
  await mkdir(dirname(dest), { recursive: true })
  console.log(`下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

// ---------- onnxruntime wasm ----------
// 用不带 asyncify / jsep 的版本：只跑 CPU，14 MB；asyncify 版 26 MB，超过 Cloudflare 单文件 25 MB 的上限
async function ort() {
  const src = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')
  const out = join(PUBLIC, 'ort')
  await mkdir(out, { recursive: true })
  for (const f of [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
  ]) {
    const dest = join(out, f)
    if (force || !(await exists(dest))) await copyFile(join(src, f), dest)
  }
}

// ---------- 向量模型 ----------
const MODEL = 'Xenova/bge-small-zh-v1.5'
const MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
]
async function model() {
  for (const f of MODEL_FILES) {
    const cached = await download(
      `https://huggingface.co/${MODEL}/resolve/main/${f}`,
      join(CACHE, 'model', f),
    )
    const dest = join(PUBLIC, 'models', MODEL, f)
    if (force || !(await exists(dest))) {
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(cached, dest)
    }
  }
}

// ---------- 行政边界 ----------
// 坐标保留 4 位小数（约 11 米），再用道格拉斯-普克算法按 TOL 度精简。
// 只用来判断"在哪个省、哪个区县"和在地图上涂色，边界附近差几百米可以接受
const round = (v) => Math.round(v * 1e4) / 1e4

function simplifyRing(points, tol) {
  if (points.length <= 4) return points
  const keep = new Uint8Array(points.length)
  const last = points.length - 1
  keep[0] = keep[last] = 1
  // 闭合的环首尾是同一个点，直接拿首尾连线当基准会把整个环删光：先用离起点最远的点把环切成两段
  let far = 1
  let farD = -1
  for (let i = 1; i < last; i++) {
    const d = Math.hypot(
      points[i][0] - points[0][0],
      points[i][1] - points[0][1],
    )
    if (d > farD) {
      farD = d
      far = i
    }
  }
  keep[far] = 1
  const stack = [
    [0, far],
    [far, last],
  ]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-12
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

// 输出格式：每个区域 { n 名称, b [西,南,东,北], g 多边形列表 }，多边形 = 环列表，环 = 扁平的 [lng,lat,lng,lat,...]
function compact(geometry, tol) {
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const out = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    const rings = []
    for (const [i, ring] of poly.entries()) {
      const s = simplifyRing(ring, tol)
      if (s.length < 4) {
        if (i === 0) break // 外环精简没了：整个小岛丢掉
        continue
      }
      const flat = []
      for (const [x, y] of s) {
        flat.push(round(x), round(y))
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      rings.push(flat)
    }
    if (rings.length) out.push(rings)
  }
  if (!out.length) return null
  return { b: [minX, minY, maxX, maxY].map(round), g: out }
}

async function geo() {
  const out = join(PUBLIC, 'geo')
  const admin1Out = join(out, 'admin1.json')
  const countyOut = join(out, 'cn-counties.json')
  if (!force && (await exists(admin1Out)) && (await exists(countyOut))) return
  await mkdir(out, { recursive: true })

  // Natural Earth 10m 省州级，公有领域
  const ne = JSON.parse(
    await readFile(
      await download(
        'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
        join(CACHE, 'geo', 'ne_10m_admin_1_states_provinces.geojson'),
      ),
      'utf8',
    ),
  )
  const admin1 = []
  for (const f of ne.features) {
    const p = f.properties
    const c = compact(f.geometry, 0.005)
    if (!c) continue
    admin1.push({
      n: p.name_zh || p.name || '',
      en: p.name || '',
      cc: p.iso_a2 && p.iso_a2 !== '-1' ? p.iso_a2 : p.adm0_a3,
      ...c,
    })
  }
  await writeFile(
    admin1Out,
    JSON.stringify({
      // 和 src/lib/geo/area.ts 的 GEO_VERSION 保持一致；改了精简参数要一起加 1
      version: 1,
      source: 'Natural Earth 10m admin-1 (public domain), simplified',
      features: admin1,
    }),
  )

  // geoBoundaries 中国 ADM2（区县级），PDDL。名称只有拼音，只用来在地图上点亮"去过的区县"
  const gb = JSON.parse(
    await readFile(
      await download(
        'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CHN/ADM2/geoBoundaries-CHN-ADM2_simplified.geojson',
        join(CACHE, 'geo', 'geoBoundaries-CHN-ADM2_simplified.geojson'),
      ),
      'utf8',
    ),
  )
  const counties = []
  for (const f of gb.features) {
    const c = compact(f.geometry, 0.002)
    if (!c) continue
    counties.push({ n: f.properties.shapeName ?? '', ...c })
  }
  await writeFile(
    countyOut,
    JSON.stringify({
      version: 1,
      source: 'geoBoundaries gbOpen CHN ADM2 (PDDL 1.0), simplified',
      features: counties,
    }),
  )
  for (const p of [admin1Out, countyOut])
    console.log(`${p}: ${((await stat(p)).size / 1e6).toFixed(1)} MB`)
}

await ort()
await model()
await geo()
console.log('静态资源已就绪')
