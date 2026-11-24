import { db, type EditEntry, type JournalRecord } from '../db.ts'
import { ymd } from './agents/askTools.ts'
import { changeRatio } from './editStats.ts'
import { costOf, type AiCall } from './usage.ts'

// 使用看板（决策 0029 第 1 条）：只在本机统计，按周列最近 12 周

export const OPENS_KEY = 'opens'
const KEEP_DAYS = 400

// 每天第一次打开时记下日期（只记日期）
export async function recordOpen(now = Date.now()) {
  const today = ymd(now)
  await db.transaction('rw', db.settings, async () => {
    const days = ((await db.settings.get(OPENS_KEY))?.value as string[]) ?? []
    if (days.at(-1) === today) return
    await db.settings.put({
      key: OPENS_KEY,
      value: [...days.filter((d) => d !== today), today].slice(-KEEP_DAYS),
    })
  })
}

export type WeekRow = {
  start: string // 周一 YYYY-MM-DD
  openDays: number
  records: number
  voiceShare: number | null // 知道来源的新记录里用语音的比例；没有就是 null
  editRatio: number | null // 这周改 AI 稿的平均改动比例
  medianAiSec: number | null // 整理用时中位数（秒）
  aiYuan: number
}

// 本地时间的周一零点
export function weekStart(ms: number): number {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export function weeklyStats(
  input: {
    opens: string[]
    records: Pick<JournalRecord, 'createdAt' | 'noteVia' | 'aiTimings'>[]
    edits: Pick<EditEntry, 'at' | 'kind' | 'changedChars' | 'draftChars'>[]
    aiCalls: Pick<AiCall, 'at' | 'usage'>[]
  },
  now: number,
  weeks = 12,
): WeekRow[] {
  const thisWeek = weekStart(now)
  const rows: WeekRow[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(thisWeek)
    from.setDate(from.getDate() - 7 * i)
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    const a = from.getTime()
    const b = to.getTime()
    const inWeek = (t: number) => t >= a && t < b
    const recs = input.records.filter((r) => inWeek(r.createdAt))
    const known = recs.filter((r) => r.noteVia)
    rows.push({
      start: ymd(a),
      openDays: input.opens.filter((d) => d >= ymd(a) && d < ymd(b)).length,
      records: recs.length,
      voiceShare: known.length
        ? known.filter((r) => r.noteVia === 'voice').length / known.length
        : null,
      editRatio: mean(
        input.edits
          .filter((e) => e.kind === 'edit' && inWeek(e.at))
          .map((e) => changeRatio(e)),
      ),
      medianAiSec: (() => {
        const m = median(
          recs.flatMap((r) => (r.aiTimings ? [r.aiTimings.totalMs] : [])),
        )
        return m === null ? null : m / 1000
      })(),
      aiYuan: input.aiCalls
        .filter((c) => inWeek(c.at))
        .reduce(
          (s, c) => s + c.usage.reduce((x, u) => x + (costOf(u) ?? 0), 0),
          0,
        ),
    })
  }
  return rows
}

const pct = (x: number | null) => (x === null ? '' : (x * 100).toFixed(0))

export function weeksCsv(rows: WeekRow[]): string {
  const head =
    '周一,打开天数,新记录,语音比例%,AI稿改动%,整理用时中位数秒,AI花费元'
  return [
    head,
    ...rows.map((r) =>
      [
        r.start,
        r.openDays,
        r.records,
        pct(r.voiceShare),
        pct(r.editRatio),
        r.medianAiSec === null ? '' : r.medianAiSec.toFixed(1),
        r.aiYuan.toFixed(4),
      ].join(','),
    ),
  ].join('\n')
}

export async function loadWeekly(now = Date.now()) {
  const [opens, records, edits, aiCalls] = await Promise.all([
    db.settings.get(OPENS_KEY),
    db.records.toArray(),
    db.edits.toArray(),
    db.aiCalls.toArray(),
  ])
  return weeklyStats(
    { opens: (opens?.value as string[]) ?? [], records, edits, aiCalls },
    now,
  )
}
