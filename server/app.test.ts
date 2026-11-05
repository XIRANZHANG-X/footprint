import { afterEach, describe, expect, it } from 'vitest'
import { app } from './app.ts'

describe('GET /api/health', () => {
  const original = process.env.DASHSCOPE_API_KEY

  afterEach(() => {
    if (original === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = original
  })

  it('reports whether the AI key is configured without leaking it', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-not-real'
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({ ok: true, aiConfigured: true })
    expect(body).not.toContain('sk-test-not-real')
  })

  it('reports aiConfigured=false when the key is missing', async () => {
    delete process.env.DASHSCOPE_API_KEY
    const res = await app.request('/api/health')
    expect(await res.json()).toEqual({ ok: true, aiConfigured: false })
  })
})
