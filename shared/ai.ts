import { z } from 'zod'

// 前端和代理共用的接口数据结构（决策 0005：同一种语言，结构只定义一次）

export const CATEGORIES = [
  '美食',
  '咖啡甜品',
  '风景',
  '城市漫步',
  '展览演出',
  '购物',
  '住宿',
  '交通',
  '其他',
] as const

export const transcribeRequest = z.object({
  audio: z.string().startsWith('data:audio/'),
})
export const transcribeResponse = z.object({ text: z.string() })

export const MAX_AI_IMAGES = 4

// full：完整整理（标题、类别、正文、标签）；
// meta：正文用用户自己写的，只补标题、类别、标签（决策 0012）
export const DESCRIBE_MODES = ['full', 'meta'] as const
export type DescribeMode = (typeof DESCRIBE_MODES)[number]

// 学习用户写作习惯用的例子（决策 0012）：AI 以前写的稿子，和用户改后的版本
const styleText = z.object({
  title: z.string().max(40),
  intro: z.string().max(2000),
})
export const styleExample = z.object({ draft: styleText, final: styleText })
export type StyleExample = z.infer<typeof styleExample>

export const MAX_PREFERENCES_CHARS = 600
export const MAX_AVOID_WORDS = 40
export const MAX_AVOID_WORD_CHARS = 12

export const describeRequest = z
  .object({
    // 只写文字的记录没有照片（决策 0013），所以允许为空
    images: z
      .array(z.string().startsWith('data:image/'))
      .max(MAX_AI_IMAGES)
      .default([]),
    note: z.string().max(2000).default(''),
    takenAt: z.number().optional(),
    placeName: z.string().nullable().optional(),
    mode: z.enum(DESCRIBE_MODES).default('full'),
    // 用户的偏好说明，和最近几次修改的例子（少样本提示）。都只在这次请求里用，服务端不保存
    preferences: z.string().max(MAX_PREFERENCES_CHARS).optional(),
    examples: z.array(styleExample).max(3).optional(),
    // 不要用的词：用户反复删掉的词，加上"重写"时被标出来的词（决策 0016 第 4 条）
    avoidWords: z
      .array(z.string().min(1).max(MAX_AVOID_WORD_CHARS))
      .max(MAX_AVOID_WORDS)
      .optional(),
  })
  // 照片和文字至少要有一样，否则没有东西可整理
  .refine((r) => r.images.length > 0 || r.note.trim() !== '')
export type DescribeRequest = z.input<typeof describeRequest>

// 整理结果每个字段的约束，只写这一处（决策 0016 第 1 条）：
// 下面的"给模型的格式"和"校验模型回复"都从这里来
const field = {
  title: z.string().min(1).max(40),
  category: z.enum(CATEGORIES),
  intro: z.string().max(300),
  tags: z.array(z.string().max(12)).max(5),
  placeGuess: z.string().max(60).nullable(),
  phones: z.array(z.string().max(30)).max(5),
  plates: z.array(z.string().max(12)).max(5),
}

// 交给模型的格式（JSON Schema 模式）：每个字段都必填、不许多字段。
// meta 模式不写正文，格式里也就没有 intro
export function descriptionContract(mode: DescribeMode) {
  const clues = z.strictObject({ phones: field.phones, plates: field.plates })
  const { intro, ...rest } = {
    title: field.title,
    category: field.category,
    intro: field.intro,
    tags: field.tags,
    placeGuess: field.placeGuess,
  }
  return z.strictObject(
    mode === 'meta' ? { ...rest, clues } : { ...rest, intro, clues },
  )
}

// 照片里读到的电话号码和车牌（决策 0014 补充，借自 geo-sleuth）：模型只抄字，城市由前端查表得出
export const photoClues = z.object({
  phones: field.phones.catch([]),
  plates: field.plates.catch([]),
})
export type PhotoClues = z.infer<typeof photoClues>

// 校验模型回复：比交给模型的格式宽松，不影响使用的小错就地纠正（类别不认识就归"其他"等），
// 标题、正文这种纠正不了的，才交给服务端修一次（决策 0016 第 1 条）
export const description = z.object({
  title: field.title,
  category: field.category.catch('其他'),
  intro: field.intro,
  tags: field.tags.catch([]),
  placeGuess: field.placeGuess.catch(null),
  // 后来加的字段：旧记录的 aiDraft 里没有它
  clues: photoClues.optional().catch(undefined),
})
export type Description = z.infer<typeof description>

// 每次调用百炼用了多少（决策 0016 第 3 条）。放在响应头 X-AI-Usage 里，不改响应正文：
// 旧版 App 不认识它也不受影响。语音识别按秒计费，其余按 token
export const AI_USAGE_HEADER = 'X-AI-Usage'
export const aiUsage = z.object({
  model: z.string(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  seconds: z.number().nullable(),
})
export type AiUsage = z.infer<typeof aiUsage>

export const geocodeResponse = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  // 所在城市（中国是地级市），给"第几次来"和统计用（决策 0014 第 3C 条）。旧版服务端没有这个字段
  city: z.string().nullable().optional(),
})
export type Geocode = z.infer<typeof geocodeResponse>

// 按地名查坐标（决策 0013 第 3 条）：列出候选，让用户自己选。
// 国内先查高德、国外查 Nominatim（决策 0021），两边各取几个
export const MAX_PLACE_QUERY_CHARS = 60
export const MAX_PLACE_CANDIDATES = 5

// 候选是什么级别的地方：行政区可以取边界（补去过的地方、想去清单要用，决策 0020）
export const PLACE_KINDS = [
  'country',
  'province',
  'city',
  'district',
  'poi',
] as const
export type PlaceKind = (typeof PLACE_KINDS)[number]

export const placeCandidate = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  // 坐标一律是 WGS-84：高德返回的 GCJ-02 在服务端换算过（决策 0021）
  lat: z.number(),
  lng: z.number(),
  // 后来加的字段，旧版服务端没有
  kind: z.enum(PLACE_KINDS).optional().catch(undefined),
  cc: z.string().nullable().optional(), // 国家代码（两位大写字母）
  // 取边界用的编号：国内是高德的行政区代码（6 位），国外是 OpenStreetMap 的编号（如 R3221112）
  boundary: z.string().nullable().optional(),
})
export type PlaceCandidate = z.infer<typeof placeCandidate>
export const placeSearchResponse = z.object({
  results: z.array(placeCandidate),
})

// 行政区边界（决策 0020 第 6 条、0021）。坐标 WGS-84，按 [经度, 纬度, …] 平铺，
// 结构是"多边形 → 环 → 坐标"，和打包的边界数据一样
export const boundaryRequest = z
  .string()
  .regex(/^(\d{6}|[NWR]\d{1,12})$/, '边界编号不对')
export const boundaryResponse = z.object({
  name: z.string().nullable(),
  shape: z.array(z.array(z.array(z.number()))),
})
export type Boundary = z.infer<typeof boundaryResponse>

// 让模型根据最近的修改，提出一版新的偏好说明（决策 0012 第 6 条）
export const suggestRequest = z.object({
  current: z.string().max(MAX_PREFERENCES_CHARS).default(''),
  edits: z.array(styleExample).min(1).max(10),
})
export const suggestResponse = z.object({ text: z.string() })

// 一次出行的总结（决策 0014 第 3E 条）：只发这次出行每条记录的日期、标题、地名、正文，不发照片
export const MAX_SUMMARY_ITEMS = 60
export const summaryItem = z.object({
  date: z.string().max(20),
  title: z.string().max(40),
  place: z.string().max(80).default(''),
  body: z.string().max(400).default(''),
})
export const summarizeRequest = z.object({
  items: z.array(summaryItem).min(1).max(MAX_SUMMARY_ITEMS),
  preferences: z.string().max(MAX_PREFERENCES_CHARS).optional(),
  // trip：一次出行的总结；month：年度报告里一个月的总结（决策 0029 第 2 条）
  scope: z.enum(['trip', 'month']).default('trip'),
})
export type SummarizeRequest = z.input<typeof summarizeRequest>
export const summarizeResponse = z.object({ text: z.string() })

// 年度报告的最后一步（决策 0029 第 2 条）：只发每个月的总结和本机算好的统计，不发记录原文
export const yearStoryRequest = z.object({
  year: z.number().int().min(2000).max(2100),
  months: z
    .array(
      z.object({
        month: z.number().int().min(1).max(12),
        text: z.string().max(800),
      }),
    )
    .min(1)
    .max(12),
  facts: z.string().max(1500),
  preferences: z.string().max(MAX_PREFERENCES_CHARS).optional(),
})
export type YearStoryRequest = z.input<typeof yearStoryRequest>

// ---------- AI 帮我排行程（决策 0024 第 4 条） ----------
// 只发文字：目的地、天数、补充的一句话、常记的类别和标签、在目的地去过的地方、想去清单。不发照片和正文

export const MAX_PLAN_DAYS = 14
export const planRequest = z.object({
  destination: z.string().trim().min(1).max(40),
  days: z.number().int().min(1).max(MAX_PLAN_DAYS),
  note: z.string().max(200).default(''),
  likes: z.array(z.string().max(20)).max(20).default([]),
  visited: z.array(z.string().max(40)).max(40).default([]),
  wishes: z.array(z.string().max(40)).max(20).default([]),
})
export type PlanRequest = z.input<typeof planRequest>

// 给模型的严格格式（JSON Schema）
export const planContract = z.strictObject({
  days: z.array(
    z.strictObject({
      day: z.number().int(),
      stops: z.array(z.strictObject({ name: z.string(), reason: z.string() })),
    }),
  ),
})

// 校验回复：比给模型的格式宽松，超长的截断，空名字丢掉
export const planResponse = z.object({
  days: z
    .array(
      z.object({
        day: z.number().int().min(1).max(MAX_PLAN_DAYS),
        stops: z
          .array(
            z.object({
              name: z
                .string()
                .trim()
                .min(1)
                .transform((s) => s.slice(0, 40)),
              reason: z
                .string()
                .catch('')
                .transform((s) => s.trim().slice(0, 80)),
            }),
          )
          .max(6),
      }),
    )
    .max(MAX_PLAN_DAYS),
})
export type PlanResponse = z.infer<typeof planResponse>

// ---------- 当时的天气（决策 0025） ----------
// code 是 WMO 天气代码（0 晴、61 小雨……），App 里换成文字
export const weatherResponse = z.object({
  tempC: z.number().nullable(),
  code: z.number().int().nullable(),
})
export type Weather = z.infer<typeof weatherResponse>
