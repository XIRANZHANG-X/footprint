import {
  description,
  geocodeResponse,
  transcribeResponse,
  type DescribeRequest,
  type Geocode,
} from '../../shared/ai.ts'
import type { z } from 'zod'
import { getAccessToken, setAccessToken } from './storage.ts'

export class ApiError extends Error {}

// 带上访问口令（决策 0008）；没有口令时不加这个头
function withToken(init: RequestInit = {}): RequestInit {
  const token = getAccessToken()
  if (!token) return init
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, withToken(init))
  } catch {
    throw new ApiError('连不上服务端')
  }
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

export function geocode(lat: number, lng: number) {
  return call(`/geocode?lat=${lat}&lng=${lng}`, geocodeResponse)
}

// ready：可以用 AI；needsToken：服务端要求口令，但本机没有或不对；
// unavailable：服务端连不上或没有配置百炼 key
export type AiState = 'ready' | 'needsToken' | 'unavailable'

export async function checkAi(): Promise<AiState> {
  let health: { aiConfigured?: boolean; accessRequired?: boolean }
  try {
    health = (await (await fetch('/api/health')).json()) as typeof health
  } catch {
    return 'unavailable'
  }
  if (!health.aiConfigured) return 'unavailable'
  if (!health.accessRequired) return 'ready'
  if (!getAccessToken()) return 'needsToken'
  try {
    const r = await fetch('/api/auth/check', withToken())
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
