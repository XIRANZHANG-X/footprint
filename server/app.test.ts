import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import type { Env } from './env.ts'

const local = createApp({ requireAccessToken: false })
const worker = createApp({ requireAccessToken: true })
const KEY = 'sk-test-not-real'
const TOKEN = 'test-access-token-not-real'

function geocode(app: ReturnType<typeof createApp>, env: Env, token?: string) {
  return app.request(
    '/api/geocode?lat=31.24&lng=121.49',
    token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    env,
  )
}

describe('GET /api/health', () => {
  it('reports what is configured without leaking the key or the token', async () => {
    const res = await local.request(
      '/api/health',
      {},
      {
        DASHSCOPE_API_KEY: KEY,
        ACCESS_TOKEN: TOKEN,
      },
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({
      ok: true,
      aiConfigured: true,
      accessRequired: true,
    })
    expect(body).not.toContain(KEY)
    expect(body).not.toContain(TOKEN)
  })

  it('reports nothing configured locally when env is empty', async () => {
    const res = await local.request('/api/health', {}, {})
    expect(await res.json()).toEqual({
      ok: true,
      aiConfigured: false,
      accessRequired: false,
    })
  })

  it('always reports accessRequired on the worker', async () => {
    const res = await worker.request('/api/health', {}, {})
    expect(
      ((await res.json()) as { accessRequired: boolean }).accessRequired,
    ).toBe(true)
  })
})

describe('access token gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubNominatim() {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ name: '面馆', address: { city: '上海' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('lets requests through locally when no token is configured', async () => {
    stubNominatim()
    const res = await geocode(local, {})
    expect(res.status).toBe(200)
  })

  it('refuses everything on the worker when no token is configured', async () => {
    const fetchMock = stubNominatim()
    const res = await geocode(worker, { DASHSCOPE_API_KEY: KEY }, 'anything')
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong token with 401 and does not call upstream', async () => {
    const fetchMock = stubNominatim()
    const env = { ACCESS_TOKEN: TOKEN }
    expect((await geocode(worker, env)).status).toBe(401)
    expect((await geocode(worker, env, 'wrong')).status).toBe(401)
    expect((await geocode(local, env, 'wrong')).status).toBe(401)
    const res = await worker.request(
      '/api/describe',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
        body: '{}',
      },
      { ...env, DASHSCOPE_API_KEY: KEY },
    )
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the right token', async () => {
    stubNominatim()
    const env = { ACCESS_TOKEN: TOKEN }
    expect((await geocode(worker, env, TOKEN)).status).toBe(200)
    const check = await worker.request(
      '/api/auth/check',
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      env,
    )
    expect(await check.json()).toEqual({ ok: true })
  })
})

describe('CORS for the Android app', () => {
  const preflight = (origin: string) =>
    worker.request(
      '/api/describe',
      {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      },
      {},
    )

  it('allows the Capacitor origin', async () => {
    const res = await preflight('https://localhost')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://localhost',
    )
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'Authorization',
    )
  })

  it('does not allow other websites', async () => {
    const res = await preflight('https://evil.example')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('still requires the token for cross-origin calls', async () => {
    const res = await worker.request(
      '/api/geocode?lat=1&lng=1',
      { headers: { Origin: 'https://localhost' } },
      { ACCESS_TOKEN: TOKEN },
    )
    expect(res.status).toBe(401)
  })
})

describe('rate limiting', () => {
  // 假的限流绑定：前 n 次放行，之后拒绝；记下每次用的 key
  function fakeLimiter(n: number) {
    const keys: string[] = []
    return {
      keys,
      limit: async ({ key }: { key: string }) => {
        keys.push(key)
        return { success: keys.length <= n }
      },
    }
  }

  it('counts per IP and route, before the token check, and answers 429', async () => {
    const light = fakeLimiter(1)
    const env: Env = { ACCESS_TOKEN: TOKEN, LIGHT_RATE_LIMIT: light }
    const check = () =>
      worker.request(
        '/api/auth/check',
        { headers: { 'CF-Connecting-IP': '203.0.113.7' } },
        env,
      )
    // 第一次没带口令：被口令拦下，但已经计数
    expect((await check()).status).toBe(401)
    const res = await check()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(await res.json()).toMatchObject({ code: 'rate_limited' })
    expect(light.keys).toEqual([
      '203.0.113.7 /api/auth/check',
      '203.0.113.7 /api/auth/check',
    ])
  })

  it('uses the AI limiter for paid routes, not the light one', async () => {
    const ai = fakeLimiter(0)
    const light = fakeLimiter(100)
    const res = await worker.request(
      '/api/summarize',
      { method: 'POST' },
      { ACCESS_TOKEN: TOKEN, AI_RATE_LIMIT: ai, LIGHT_RATE_LIMIT: light },
    )
    expect(res.status).toBe(429)
    expect(ai.keys).toEqual(['unknown /api/summarize'])
    expect(light.keys).toEqual([])
  })

  it('does not limit when no binding is configured (local Node)', async () => {
    const res = await local.request('/api/auth/check', {}, {})
    expect(res.status).toBe(200)
  })
})
