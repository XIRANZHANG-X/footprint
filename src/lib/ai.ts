import {
  AI_USAGE_HEADER,
  aiUsage,
  description,
  geocodeResponse,
  placeSearchResponse,
  boundaryResponse,
  planResponse,
  type PlanRequest,
  suggestResponse,
  summarizeResponse,
  transcribeResponse,
  type DescribeRequest,
  type Geocode,
  type StyleExample,
  type SummarizeRequest,
} from '../../shared/ai.ts'
import { z } from 'zod'
import { db } from '../db.ts'
import { getAccessToken, setAccessToken } from './storage.ts'
import type { AiCallKind } from './usage.ts'

export class ApiError extends Error {}

// 接口地址：网页版为空，走同源的 /api；安卓 App 里页面来自本地，
// 要访问线上的 Worker，地址在 .env.app 里配置（决策 0009）
const API = `${String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')}/api`

// 带上访问口令（决策 0008）；没有口令时不加这个头
function withToken(init: RequestInit = {}): RequestInit {
  const token = getAccessToken()
  if (!token) return init
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

// 会花钱的接口，每次调用都记一行用量（决策 0016 第 3 条）；查地名不花百炼的钱，不记
const AI_KINDS: Record<string, AiCallKind> = {
  '/transcribe': 'transcribe',
  '/describe': 'describe',
  '/preferences/suggest': 'suggest',
  '/summarize': 'summarize',
  '/plan': 'plan',
}

const usageList = z.array(aiUsage)

// 记账失败（比如存储空间满了）不影响这次调用本身
function logCall(kind: AiCallKind, started: number, res: Response | null) {
  let usage: z.infer<typeof usageList> = []
  try {
    const parsed = usageList.safeParse(
      JSON.parse(res?.headers.get(AI_USAGE_HEADER) ?? '[]'),
    )
    if (parsed.success) usage = parsed.data
  } catch {
    // 旧版服务端没有这个头，或者头的内容不对：只记次数和耗时
  }
  void db.aiCalls
    .add({
      id: crypto.randomUUID(),
      at: Date.now(),
      kind,
      ok: res?.ok ?? false,
      ms: Math.round(performance.now() - started),
      usage,
    })
    .catch(() => {})
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const kind = AI_KINDS[path]
  const started = performance.now()
  let res: Response
  try {
    res = await fetch(`${API}${path}`, withToken(init))
  } catch {
    if (kind) logCall(kind, started, null)
    throw new ApiError('连不上服务端')
  }
  if (kind) logCall(kind, started, res)
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 401) {
    // 口令被换掉了：清掉旧的，下次打开页面会重新要求输入
    setAccessToken(null)
    throw new ApiError('访问口令不对或已更换，请刷新页面重新输入')
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `请求失败（${res.status}）`
    throw new ApiError(msg)
  }
  return schema.parse(body)
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export async function transcribe(audio: string) {
  return (await call('/transcribe', transcribeResponse, postJson({ audio })))
    .text
}

export function describe(req: DescribeRequest) {
  return call('/describe', description, postJson(req))
}

export async function suggestPreferences(
  current: string,
  edits: StyleExample[],
) {
  return (
    await call(
      '/preferences/suggest',
      suggestResponse,
      postJson({ current, edits }),
    )
  ).text
}

// 一次出行的总结（决策 0014 第 3E 条），只发文字
export async function summarize(req: SummarizeRequest) {
  return (await call('/summarize', summarizeResponse, postJson(req))).text
}

export function geocode(lat: number, lng: number) {
  return call(`/geocode?lat=${lat}&lng=${lng}`, geocodeResponse)
}

// 按地名查坐标，最多 3 个候选（决策 0013 第 3 条）
export async function searchPlaces(query: string) {
  return (
    await call(
      `/geocode/search?q=${encodeURIComponent(query.trim())}`,
      placeSearchResponse,
    )
  ).results
}

// AI 帮我排行程（决策 0024 第 4 条），只发文字
export function planTrip(req: PlanRequest) {
  return call('/plan', planResponse, postJson(req))
}

// 行政区边界（决策 0020 第 6、7 条）：国内的市、区县用高德，国外用 OpenStreetMap，都经过服务端
export function fetchBoundary(id: string) {
  return call(
    `/geocode/boundary?id=${encodeURIComponent(id)}`,
    boundaryResponse,
  )
}

// ready：可以用 AI；needsToken：服务端要求口令，但本机没有或不对；
// unavailable：服务端连不上或没有配置百炼 key
export type AiState = 'ready' | 'needsToken' | 'unavailable'

export async function checkAi(): Promise<AiState> {
  let health: { aiConfigured?: boolean; accessRequired?: boolean }
  try {
    health = (await (await fetch(`${API}/health`)).json()) as typeof health
  } catch {
    return 'unavailable'
  }
  if (!health.aiConfigured) return 'unavailable'
  if (!health.accessRequired) return 'ready'
  if (!getAccessToken()) return 'needsToken'
  try {
    const r = await fetch(`${API}/auth/check`, withToken())
    if (r.status === 401) {
      setAccessToken(null)
      return 'needsToken'
    }
    return r.ok ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

// 保存用户输入的口令并验证；口令不对时不保存
export async function tryAccessToken(token: string): Promise<AiState> {
  setAccessToken(token.trim())
  const state = await checkAi()
  if (state === 'needsToken') setAccessToken(null)
  return state
}

// "店名（城市 · 区 · 路）"；没有店名就只用地址
export function placeLabel(g: Geocode): string | null {
  return g.name ? `${g.name}（${g.address ?? ''}）` : g.address
}
