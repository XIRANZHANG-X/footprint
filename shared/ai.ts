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

export const describeRequest = z.object({
  images: z
    .array(z.string().startsWith('data:image/'))
    .min(1)
    .max(MAX_AI_IMAGES),
  note: z.string().max(2000).default(''),
  takenAt: z.number().optional(),
  placeName: z.string().nullable().optional(),
})
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
