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
  })
  // 照片和文字至少要有一样，否则没有东西可整理
  .refine((r) => r.images.length > 0 || r.note.trim() !== '')
export type DescribeRequest = z.input<typeof describeRequest>

export const description = z.object({
  title: z.string().min(1).max(40),
  category: z.enum(CATEGORIES).catch('其他'),
  intro: z.string().max(300),
  tags: z.array(z.string().max(12)).max(5).catch([]),
  placeGuess: z.string().max(60).nullable().catch(null),
})
export type Description = z.infer<typeof description>

export const geocodeResponse = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
})
export type Geocode = z.infer<typeof geocodeResponse>
