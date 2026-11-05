import {
  description,
  geocodeResponse,
  transcribeResponse,
  type DescribeRequest,
} from '../../shared/ai.ts'
import type { z } from 'zod'

export class ApiError extends Error {}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError('连不上服务端')
  }
  const body: unknown = await res.json().catch(() => null)
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

export async function aiAvailable(): Promise<boolean> {
  try {
    const r = await fetch('/api/health')
    const body = (await r.json()) as { aiConfigured?: boolean }
    return Boolean(body.aiConfigured)
  } catch {
    return false
  }
}
