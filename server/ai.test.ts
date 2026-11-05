import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from './app.ts'
import { extractJsonObject } from './dashscope.ts'
import { cacheKey, formatNominatim } from './geocode.ts'

const IMG = 'data:image/jpeg;base64,AAAA'
const WAV = 'data:audio/wav;base64,AAAA'

function post(path: string, body: unknown) {
  return app.request(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function mockChatReply(content: string): FetchMock {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ choices: [{ message: { content } }] }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentInit(fetchMock: FetchMock): RequestInit {
  return fetchMock.mock.calls[0][1] ?? {}
}

function sentBody(fetchMock: FetchMock) {
  return JSON.parse(sentInit(fetchMock).body as string)
}

// 测试里读响应 JSON 时不关心精确类型
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('AI routes', () => {
  const original = process.env.DASHSCOPE_API_KEY
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-not-real'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (original === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = original
  })

  it('returns 503 without calling upstream when the key is missing', async () => {
    delete process.env.DASHSCOPE_API_KEY
    const fetchMock = mockChatReply('{}')
    const res = await post('/describe', { images: [IMG] })
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('transcribe sends the audio as input_audio with asr_options at the top level', async () => {
    const fetchMock = mockChatReply('  这家面馆排了一小时，但是值得。 ')
    const res = await post('/transcribe', { audio: WAV })
    expect(await res.json()).toEqual({ text: '这家面馆排了一小时，但是值得。' })
    const body = sentBody(fetchMock)
    expect(body.model).toBe('qwen3-asr-flash')
    expect(body.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: WAV },
    })
    expect(body.asr_options).toEqual({ enable_itn: true })
    expect(
      (sentInit(fetchMock).headers as Record<string, string>).Authorization,
    ).toBe('Bearer sk-test-not-real')
  })

  it('describe parses a JSON reply wrapped in a markdown fence', async () => {
    const fetchMock = mockChatReply(
      '好的：\n```json\n{"title":"排队一小时的面","category":"美食","intro":"我排了一小时。","tags":["面馆"],"placeGuess":null}\n```',
    )
    const res = await post('/describe', {
      images: [IMG],
      note: '排了一小时',
      placeName: '上海 · 黄浦区',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: '排队一小时的面',
      category: '美食',
      intro: '我排了一小时。',
      tags: ['面馆'],
      placeGuess: null,
    })
    const body = sentBody(fetchMock)
    expect(body.model).toBe('qwen3-vl-plus')
    const userContent = body.messages[1].content
    expect(userContent[0]).toEqual({
      type: 'image_url',
      image_url: { url: IMG },
    })
    expect(userContent.at(-1).text).toContain('排了一小时')
    expect(userContent.at(-1).text).toContain('上海 · 黄浦区')
  })

  it('describe falls back to 其他 for an unknown category instead of failing', async () => {
    mockChatReply(
      '{"title":"t","category":"不存在的类别","intro":"i","tags":[],"placeGuess":null}',
    )
    const res = await post('/describe', { images: [IMG] })
    expect((await json(res)).category).toBe('其他')
  })

  it('describe returns 502 when the model reply is not valid JSON', async () => {
    mockChatReply('抱歉，我无法处理。')
    const res = await post('/describe', { images: [IMG] })
    expect(res.status).toBe(502)
  })

  it('maps an upstream error to 502 with the upstream status in the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid api key', { status: 401 })),
    )
    const res = await post('/describe', { images: [IMG] })
    expect(res.status).toBe(502)
    expect((await json(res)).error).toContain('401')
  })

  it('rejects a request with too many images', async () => {
    const res = await post('/describe', { images: Array(5).fill(IMG) })
    expect(res.status).toBe(400)
  })
})

describe('extractJsonObject', () => {
  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow()
  })
})

describe('geocode helpers', () => {
  it('builds a city · district · road address and keeps the POI name', () => {
    expect(
      formatNominatim({
        name: '某某面馆',
        address: { city: '上海市', city_district: '黄浦区', road: '南京东路' },
      }),
    ).toEqual({ name: '某某面馆', address: '上海市 · 黄浦区 · 南京东路' })
  })

  it('falls back to display_name when no address parts are present', () => {
    expect(formatNominatim({ display_name: 'Somewhere' })).toEqual({
      name: null,
      address: 'Somewhere',
    })
  })

  it('rounds coordinates to about 11 m for the cache key', () => {
    expect(cacheKey(31.240012, 121.489987)).toBe(cacheKey(31.24, 121.49))
  })
})
