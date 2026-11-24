// 用真实的模型试跑两个 Agent（决策 0028 第 5 条）。记录是下面写死的假数据，不碰任何人的真实记录。
// 直接调用服务端代码（不经过网络和口令），百炼 key、高德 key 从 .env 读，不打印。
// 用法：npx tsx scripts/eval_agents.ts        每跑一次大约花几分钱，结尾打印用量
import type { AgentRequest, AgentResponse } from '../shared/agents.ts'
import type { AiUsage, PlaceCandidate } from '../shared/ai.ts'
import { createApp } from '../server/app.ts'
import type { JournalRecord } from '../src/db.ts'
import { askTools } from '../src/lib/agents/askTools.ts'
import { RecordRefs } from '../src/lib/agents/askTools.ts'
import { locateTools, pickCandidates } from '../src/lib/agents/locateTools.ts'
import { SpotBook } from '../src/lib/agents/locateTools.ts'
import { runAgent } from '../src/lib/agents/run.ts'
import { costOf } from '../src/lib/usage.ts'

process.loadEnvFile()
const app = createApp({ requireAccessToken: false })
const usages: AiUsage[] = []
// .env 里配了口令时服务端会校验（和线上一样）；口令只放进请求头，不打印
const AUTH: Record<string, string> = process.env.ACCESS_TOKEN
  ? { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` }
  : {}

async function send(req: AgentRequest): Promise<AgentResponse> {
  const res = await app.request(
    '/api/agent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify(req),
    },
    process.env,
  )
  usages.push(
    ...(JSON.parse(res.headers.get('X-AI-Usage') ?? '[]') as AiUsage[]),
  )
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return (await res.json()) as AgentResponse
}

async function search(q: string): Promise<PlaceCandidate[]> {
  const res = await app.request(
    `/api/geocode/search?q=${encodeURIComponent(q)}`,
    { headers: AUTH },
    process.env,
  )
  return ((await res.json()) as { results: PlaceCandidate[] }).results
}

const CN = (admin1: string, city: string) => ({
  area: { key: '', gv: 2, cc: 'CN', admin1, a1: 0, county: null },
  geoCity: city,
})
function rec(
  id: string,
  when: string,
  title: string,
  category: string,
  place: string,
  where: object,
  extra: Partial<JournalRecord> = {},
): JournalRecord {
  return {
    id,
    createdAt: 0,
    takenAt: new Date(when).getTime(),
    timeSource: 'exif',
    location: { lat: 30, lng: 120 },
    locationStatus: 'exif',
    photoCount: 1,
    note: '',
    placeName: place,
    aiDraft: null,
    content: { title, category, intro: '', tags: [] },
    aiStatus: 'done',
    aiError: null,
    tripBreak: null,
    bodySource: 'ai',
    placeGuess: null,
    aiTimings: null,
    ...where,
    ...extra,
  } as JournalRecord
}

const HZ = CN('浙江省', '杭州市')
const SH = CN('上海市', '上海市')
const RECORDS: JournalRecord[] = [
  rec(
    '1',
    '2025-03-02T12:10',
    '奎元馆的虾爆鳝面',
    '美食',
    '奎元馆（解放路店）',
    HZ,
  ),
  rec('2', '2025-03-02T15:00', '断桥残雪', '风景', '断桥', HZ),
  rec('3', '2025-03-03T08:30', '片儿川当早饭', '美食', '菊英面馆', HZ),
  rec('4', '2025-10-04T19:00', '外婆家', '美食', '外婆家（湖滨店）', HZ),
  rec('5', '2024-05-01T11:00', '第一次来上海：外滩', '风景', '外滩', SH),
  rec('6', '2025-06-14T12:30', '佳家汤包', '美食', '佳家汤包（黄河路）', SH),
  rec('7', '2025-06-14T16:00', '上海博物馆的青铜器', '展览', '上海博物馆', SH),
  rec('8', '2026-02-10T13:00', '葱油拌面', '美食', '老地方面馆', SH),
  rec('9', '2025-03-02T18:40', '一笼小笼', '美食', '', HZ, {
    location: null,
    locationStatus: 'pending',
    placeName: null,
    note: '晚上在知味观吃了小笼包，人好多',
    placeGuess: '知味观',
    aiDraft: {
      title: '一笼小笼',
      category: '美食',
      intro: '',
      tags: [],
      placeGuess: '知味观',
      clues: { phones: ['0571-87065871'], plates: [] },
    },
  } as unknown as Partial<JournalRecord>),
]
const TODAY = '2026-11-24'

const QUESTIONS = [
  '我去过几个城市？',
  '去年在杭州吃过哪些面？',
  '第一次去上海是哪天？',
  '在上海看过什么展？',
]

for (const q of QUESTIONS) {
  const refs = new RecordRefs()
  const seen = new Set<string>()
  const t0 = performance.now()
  const r = await runAgent<'ask', { text: string; recordIds: string[] }>(
    'ask',
    q,
    askTools(RECORDS, refs, seen),
    send,
    TODAY,
  )
  const cited = (r.final?.recordIds ?? []).map((x) => {
    const id = refs.id(x)
    const rr = RECORDS.find((y) => y.id === id)
    return id && seen.has(id) ? rr?.content?.title : `（丢掉 ${x}）`
  })
  console.log(
    `\n问：${q}（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`,
  )
  for (const s of r.steps)
    console.log(`  查了：${s.label}${s.ok ? '' : '（出错）'}`)
  console.log(`  答：${r.final?.text ?? r.text ?? '（没有）'} [${r.stopped}]`)
  if (cited.length) console.log(`  引用：${cited.join('、')}`)
}

{
  const book = new SpotBook()
  const target = RECORDS.at(-1)!
  const t0 = performance.now()
  const r = await runAgent<
    'locate',
    {
      candidates: { ref: string; evidence: string }[]
      note: string | null
    }
  >(
    'locate',
    '帮我找这条记录是在哪里。',
    locateTools(target, RECORDS, book, {
      clueCities: async () => [{ city: '杭州市', via: '电话区号 0571' }],
      search,
    }),
    send,
    TODAY,
  )
  console.log(`\n找地点（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`)
  for (const s of r.steps)
    console.log(`  查了：${s.label}${s.ok ? '' : '（出错）'}`)
  if (r.final) {
    const p = pickCandidates(r.final, book)
    for (const c of p.candidates)
      console.log(`  候选：${c.label} ← ${c.evidence}`)
    console.log(`  对不上的候选：${p.dropped}；说明：${r.final.note ?? '无'}`)
  } else console.log(`  没有候选：${r.text} [${r.stopped}]`)
}

const yuan = usages.reduce((s, u) => s + (costOf(u) ?? 0), 0)
const tokens = usages.reduce(
  (s, u) => s + (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
  0,
)
console.log(
  `\n共 ${usages.length} 次模型调用，${tokens} tokens，约 ¥${yuan.toFixed(4)}`,
)
