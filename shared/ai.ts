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

// 按地名查坐标（决策 0013 第 3 条）：最多 3 个候选，带上所在城市，让用户自己选
export const MAX_PLACE_QUERY_CHARS = 60
export const MAX_PLACE_CANDIDATES = 3
export const placeCandidate = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
})
export type PlaceCandidate = z.infer<typeof placeCandidate>
export const placeSearchResponse = z.object({
  results: z.array(placeCandidate),
})

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
})
export type SummarizeRequest = z.input<typeof summarizeRequest>
export const summarizeResponse = z.object({ text: z.string() })
