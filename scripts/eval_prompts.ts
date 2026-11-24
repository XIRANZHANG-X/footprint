// 提示词样例对比（决策 0019 第 8 条）。
//
// 样例来自你自己的备份：照片、原话、地名、时间照原样发给"整理"接口，
// 你最后改成的版本当作参考答案。改提示词前跑一次、改完再跑一次，生成并排对比的网页。
//
//   npm run eval -- run <备份.zip> <这次的名字> [--limit 10]
//   npm run eval -- report <名字A> <名字B>
//
// - 会真实调用百炼（用 .env 里的 key），每条样例一次看图调用，约 0.002 元。跑之前想清楚要跑几条。
// - 选哪些记录：evals/samples.txt 里每行一个记录 id；没有这个文件就挑最近的、你改过 AI 稿子的记录优先。
// - 结果和网页都写在 evals/ 下，这个目录不进 git：里面有你的照片和原话。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createApp } from '../server/app.ts'
import { AI_USAGE_HEADER, MAX_AI_IMAGES, type AiUsage } from '../shared/ai.ts'
import type { JournalRecord } from '../src/db.ts'
import { unpackBackup, type PhotoBlobs } from '../src/lib/backupFormat.ts'
import { DEFAULT_WATCH_WORDS, unfaithfulBits } from '../src/lib/faithful.ts'
import { costOf } from '../src/lib/usage.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVALS = join(ROOT, 'evals')
const RUNS = join(EVALS, 'runs')
// 和 App 一样：发给模型的照片长边 768 像素（src/lib/image.ts 的 AI_LONG_EDGE）
const AI_LONG_EDGE = 768

type Text = { title: string; intro: string }
type Sample = {
  id: string
  note: string
  placeName: string | null
  takenAt: number
  thumbs: string[] // 报告里显示的小图
  reference: Text | null // 你最后改成的样子
  result: (Text & { category: string; tags: string[] }) | null
  error: string | null
  ms: number
  usage: AiUsage[]
}
type Run = { label: string; at: number; samples: Sample[] }

async function dataUrl(blob: Blob, longEdge: number, quality: number) {
  const out = await sharp(Buffer.from(await blob.arrayBuffer()))
    .rotate()
    .resize(longEdge, longEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

async function pickRecords(records: JournalRecord[], limit: number) {
  let wanted: string[] = []
  try {
    wanted = (await readFile(join(EVALS, 'samples.txt'), 'utf8'))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    // 没有 samples.txt：自动挑
  }
  if (wanted.length) {
    const byId = new Map(records.map((r) => [r.id, r]))
    return wanted.flatMap((id) => byId.get(id) ?? []).slice(0, limit)
  }
  const edited = (r: JournalRecord) =>
    Boolean(r.aiDraft && r.content && r.content.intro !== r.aiDraft.intro)
  return records
    .filter((r) => r.photoCount > 0 || r.note.trim())
    .sort(
      (a, b) => Number(edited(b)) - Number(edited(a)) || b.takenAt - a.takenAt,
    )
    .slice(0, limit)
}

async function run(backupPath: string, label: string, limit: number) {
  try {
    process.loadEnvFile(join(ROOT, '.env'))
  } catch {
    throw new Error('找不到 .env，没有百炼的 key 没法跑')
  }
  if (!process.env.DASHSCOPE_API_KEY)
    throw new Error('.env 里没有 DASHSCOPE_API_KEY')

  const backup = await unpackBackup(new Blob([await readFile(backupPath)]))
  const prefs = backup.settings.find((s) => s.key === 'preferences')?.value as
    { text?: string } | undefined
  const photosOf = new Map<string, PhotoBlobs[]>()
  for (const p of backup.photos)
    photosOf.set(p.recordId, [...(photosOf.get(p.recordId) ?? []), p])

  const picked = await pickRecords(backup.records, limit)
  console.log(
    `备份里 ${backup.records.length} 条记录，这次跑 ${picked.length} 条`,
  )
  // 本机直接调服务端代码，不用另外开服务；口令检查在本机模式下没配置就放行
  const app = createApp({ requireAccessToken: false })
  const env = { ...process.env, ACCESS_TOKEN: undefined }

  const samples: Sample[] = []
  for (const [i, r] of picked.entries()) {
    const photos = (photosOf.get(r.id) ?? [])
      .sort((a, b) => a.order - b.order)
      .slice(0, MAX_AI_IMAGES)
    const images = await Promise.all(
      photos.map((p) => dataUrl(p.blob, AI_LONG_EDGE, 80)),
    )
    const thumbs = await Promise.all(
      photos.map((p) => dataUrl(p.thumb, 160, 70)),
    )
    const started = performance.now()
    const res = await app.request(
      '/api/describe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          note: r.note,
          takenAt: r.takenAt,
          placeName: r.placeName,
          mode: 'full',
          ...(prefs?.text?.trim() ? { preferences: prefs.text } : {}),
        }),
      },
      env,
    )
    const ms = Math.round(performance.now() - started)
    const body = (await res.json()) as Record<string, unknown>
    let usage: AiUsage[] = []
    try {
      usage = JSON.parse(res.headers.get(AI_USAGE_HEADER) ?? '[]')
    } catch {
      // 没有用量头：只记耗时
    }
    samples.push({
      id: r.id,
      note: r.note,
      placeName: r.placeName,
      takenAt: r.takenAt,
      thumbs,
      reference: r.content
        ? { title: r.content.title, intro: r.content.intro }
        : null,
      result: res.ok
        ? {
            title: String(body.title),
            intro: String(body.intro),
            category: String(body.category),
            tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          }
        : null,
      error: res.ok ? null : String(body.error ?? res.status),
      ms,
      usage,
    })
    console.log(
      `${i + 1}/${picked.length} ${res.ok ? 'OK' : '失败'} ${(ms / 1000).toFixed(1)} 秒`,
    )
  }
  const out: Run = {
    label,
    at: Date.now(),
    samples,
  }
  await mkdir(RUNS, { recursive: true })
  const file = join(RUNS, `${label}.json`)
  await writeFile(file, JSON.stringify(out, null, 1))
  console.log(`结果：${file}`)
}

// ---------- 报告 ----------

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )

function metrics(s: Sample) {
  if (!s.result) return null
  const flagged = unfaithfulBits(
    s.result,
    { note: s.note, placeName: s.placeName },
    DEFAULT_WATCH_WORDS,
  )
  const cost = s.usage.reduce((n, u) => n + (costOf(u) ?? 0), 0)
  return {
    chars: [...s.result.intro].length,
    flagged,
    cost,
    tokens: s.usage.reduce(
      (n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
      0,
    ),
  }
}

function cell(s: Sample | undefined) {
  if (!s) return '<td class="muted">这次没跑这条</td>'
  if (!s.result) return `<td class="bad">失败：${esc(s.error ?? '')}</td>`
  const m = metrics(s)!
  return `<td><b>${esc(s.result.title)}</b><p>${esc(s.result.intro)}</p>
    <div class="m">${m.chars} 字 · ${(s.ms / 1000).toFixed(1)} 秒 · ${m.tokens} token
    ${m.flagged.length ? `<br><span class="bad">可能编的：${m.flagged.map(esc).join('、')}</span>` : ''}</div></td>`
}

function summary(r: Run) {
  const ms = r.samples.map(metrics).filter((m) => m !== null)
  const models = [
    ...new Set(r.samples.flatMap((s) => s.usage.map((u) => u.model))),
  ]
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  return `<b>${esc(r.label)}</b>：${r.samples.length} 条，失败 ${r.samples.length - ms.length} 条；
    正文平均 ${avg(ms.map((m) => m.chars)).toFixed(0)} 字；
    带"可能编的"内容 ${ms.filter((m) => m.flagged.length).length} 条；
    平均 ${(avg(r.samples.map((s) => s.ms)) / 1000).toFixed(1)} 秒；
    共约 ¥${ms.reduce((n, m) => n + m.cost, 0).toFixed(4)}（用到的模型：${esc(models.join('、') || '无')}）`
}

async function report(a: string, b: string) {
  const load = async (l: string) =>
    JSON.parse(await readFile(join(RUNS, `${l}.json`), 'utf8')) as Run
  const [ra, rb] = await Promise.all([load(a), load(b)])
  const bById = new Map(rb.samples.map((s) => [s.id, s]))
  const rows = ra.samples
    .map((s) => {
      const ref = s.reference
      return `<tr>
      <td>${s.thumbs.map((t) => `<img src="${t}" alt="">`).join('')}
        <p class="muted">原话：${esc(s.note || '（没写）')}</p>
        ${s.placeName ? `<p class="muted">地点：${esc(s.placeName)}</p>` : ''}</td>
      <td>${ref ? `<b>${esc(ref.title)}</b><p>${esc(ref.intro)}</p>` : '<span class="muted">没有</span>'}</td>
      ${cell(s)}${cell(bById.get(s.id))}</tr>`
    })
    .join('\n')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>提示词对比</title>
<style>
body{font:14px/1.6 system-ui,sans-serif;margin:16px;color:#2d2132;background:#fffaf2}
table{border-collapse:collapse;width:100%;table-layout:fixed}
td,th{border:1px solid #d9cfe0;padding:8px;vertical-align:top;text-align:left;overflow-wrap:anywhere}
th{background:#fdd0e0}img{width:72px;height:72px;object-fit:cover;margin:0 4px 4px 0}
p{margin:4px 0}.m{font-size:12px;color:#6b5f72}.muted{color:#6b5f72}.bad{color:#b3261e}
</style>
<h1>提示词对比</h1>
<p>${summary(ra)}</p><p>${summary(rb)}</p>
<p class="muted">"可能编的"是自动检查（原话和地名里没有的数字、默认的添油加醋词表），只是提示；写得像不像你，要靠你自己看。</p>
<table><thead><tr><th>照片和原话</th><th>你最后改成的</th><th>${esc(ra.label)}</th><th>${esc(rb.label)}</th></tr></thead>
<tbody>${rows}</tbody></table></html>`
  const file = join(EVALS, `report-${a}-vs-${b}.html`)
  await writeFile(file, html)
  console.log(`对比网页：${file}`)
}

const [cmd, ...args] = process.argv.slice(2)
const limitAt = args.indexOf('--limit')
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 10
if (cmd === 'run' && args[0] && args[1]) await run(args[0], args[1], limit)
else if (cmd === 'report' && args[0] && args[1]) await report(args[0], args[1])
else {
  console.log(
    '用法：\n  npm run eval -- run <备份.zip> <名字> [--limit 10]\n  npm run eval -- report <名字A> <名字B>',
  )
  process.exitCode = 1
}
