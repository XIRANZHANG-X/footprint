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
