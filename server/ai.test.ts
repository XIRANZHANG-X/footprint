import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import type { Env } from './env.ts'
import { extractJsonObject } from './dashscope.ts'
import { cacheKey, formatCandidates, formatNominatim } from './geocode.ts'

const IMG = 'data:image/jpeg;base64,AAAA'
const WAV = 'data:audio/wav;base64,AAAA'

const app = createApp({ requireAccessToken: false })
const ENV: Env = { DASHSCOPE_API_KEY: 'sk-test-not-real' }

function post(path: string, body: unknown, env: Env = ENV) {
  return app.request(
    `/api${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  )
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function mockChatReply(content: string): FetchMock {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ choices: [{ message: { content } }] }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// 依次返回几段回复，每次都带上用量（模拟百炼的 usage 字段）
function mockChatReplies(...contents: string[]): FetchMock {
  let i = 0
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      choices: [
        { message: { content: contents[Math.min(i++, contents.length - 1)] } },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentInit(fetchMock: FetchMock, call = 0): RequestInit {
  return fetchMock.mock.calls[call][1] ?? {}
}

function sentBody(fetchMock: FetchMock, call = 0) {
  return JSON.parse(sentInit(fetchMock, call).body as string)
}

const usageOf = (res: Response) =>
  JSON.parse(res.headers.get('X-AI-Usage') ?? 'null') as unknown

// 测试里读响应 JSON 时不关心精确类型
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('AI routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 503 without calling upstream when the key is missing', async () => {
    const fetchMock = mockChatReply('{}')
    const res = await post('/describe', { images: [IMG] }, {})
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

  it('describe in full mode asks for a plain tone', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"美食","intro":"i","tags":[],"placeGuess":null}',
    )
    await post('/describe', { images: [IMG], note: '排了一小时' })
    const system = sentBody(fetchMock).messages[0].content as string
    expect(system).toContain('语气平实')
    expect(system).toContain('不要添加用户没说过的感受')
  })

  it('describe in meta mode never returns a body, even if the model writes one', async () => {
    const fetchMock = mockChatReply(
      '{"title":"排队一小时的面","category":"美食","intro":"模型多写的正文","tags":["面馆"],"placeGuess":"某某面馆"}',
    )
    const res = await post('/describe', {
      images: [IMG],
      note: '排了一小时',
      mode: 'meta',
    })
    expect(await res.json()).toEqual({
      title: '排队一小时的面',
      category: '美食',
      intro: '',
      tags: ['面馆'],
      placeGuess: '某某面馆',
    })
    const system = sentBody(fetchMock).messages[0].content as string
    expect(system).toContain('不要改写')
    expect(system).not.toContain('intro')
  })

  it('describe accepts a text-only record and tells the model there are no photos', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"其他","intro":"i","tags":[],"placeGuess":null}',
    )
    const res = await post('/describe', { note: '今天去了江边' })
    expect(res.status).toBe(200)
    const body = sentBody(fetchMock)
    // 没有照片：交给文字模型，按 JSON Schema 严格输出，不开思考（决策 0016 第 1、2 条）
    expect(body.model).toBe('qwen3.7-flash')
    expect(body.enable_thinking).toBe(false)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.required).toContain('intro')
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined()
    const userContent = body.messages[1].content as string
    expect(userContent).toContain('今天去了江边')
    expect(userContent).toContain('没有照片')
  })

  it('describe rejects a request with neither photos nor text', async () => {
    const fetchMock = mockChatReply('{}')
    expect((await post('/describe', { note: '  ' })).status).toBe(400)
    expect(
      (await post('/describe', { mode: 'nope', images: [IMG] })).status,
    ).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('describe appends the user preferences and examples to the system prompt', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"美食","intro":"i","tags":[],"placeGuess":null}',
    )
    const example = {
      draft: { title: '排队一小时的面', intro: '热气腾腾，浓郁却不腻。' },
      final: { title: '排队的面', intro: '汤很浓。' },
    }
    await post('/describe', {
      images: [IMG],
      preferences: '- 不写感叹句',
      examples: [example],
    })
    const system = sentBody(fetchMock).messages[0].content as string
    expect(system).toContain('- 不写感叹句')
    expect(system).toContain('你写的正文：热气腾腾，浓郁却不腻。')
    expect(system).toContain('用户改成的正文：汤很浓。')
  })

  it('describe in meta mode keeps the preferences but drops the examples', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"美食","tags":[],"placeGuess":null}',
    )
    await post('/describe', {
      note: '排了一小时',
      mode: 'meta',
      preferences: '- 标题不超过 8 个字',
      examples: [
        {
          draft: { title: 'a', intro: '例子里的正文' },
          final: { title: 'b', intro: 'c' },
        },
      ],
    })
    const system = sentBody(fetchMock).messages[0].content as string
    expect(system).toContain('- 标题不超过 8 个字')
    expect(system).not.toContain('例子里的正文')
  })

  it('preferences/suggest sends the current text and the edits, and returns the reply', async () => {
    const fetchMock = mockChatReply('  - 不写感叹句\n- 标题不超过 8 个字  ')
    const res = await post('/preferences/suggest', {
      current: '- 语气平实',
      edits: [
        {
          draft: { title: '排队一小时的面！', intro: '太好吃了！' },
          final: { title: '排队的面', intro: '好吃。' },
        },
      ],
    })
    expect(await res.json()).toEqual({
      text: '- 不写感叹句\n- 标题不超过 8 个字',
    })
    const body = sentBody(fetchMock)
    expect(body.messages[1].content).toContain('- 语气平实')
    expect(body.messages[1].content).toContain('用户改成的正文：好吃。')
  })

  it('preferences/suggest needs at least one edit', async () => {
    const fetchMock = mockChatReply('x')
    const res = await post('/preferences/suggest', { current: '', edits: [] })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('summarize sends each record as text and returns the reply', async () => {
    const fetchMock = mockChatReply('  先去了西湖，第二天吃了面。  ')
    const res = await post('/summarize', {
      items: [
        { date: '11月3日', title: '西湖散步', place: '西湖', body: '走了一圈' },
        { date: '11月4日', title: '排队的面', body: '好吃。' },
      ],
      preferences: '- 不写感叹句',
    })
    expect(await res.json()).toEqual({ text: '先去了西湖，第二天吃了面。' })
    const body = sentBody(fetchMock)
    expect(body.messages[0].content).toContain('- 不写感叹句')
    expect(body.messages[1].content).toContain('1. 11月3日 西湖散步')
    expect(body.messages[1].content).toContain('地点：西湖')
    // 只发文字，不发照片
    expect(typeof body.messages[1].content).toBe('string')
  })

  it('summarize needs at least one record', async () => {
    const fetchMock = mockChatReply('x')
    const res = await post('/summarize', { items: [] })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('describe keeps the phone numbers and plates the model read', async () => {
    mockChatReply(
      JSON.stringify({
        title: '面馆',
        category: '美食',
        intro: '吃了面',
        tags: [],
        placeGuess: null,
        clues: { phones: ['0571-88886666'], plates: ['浙A12345'] },
      }),
    )
    const res = await post('/describe', { images: [IMG] })
    expect((await json(res)).clues).toEqual({
      phones: ['0571-88886666'],
      plates: ['浙A12345'],
    })
  })

  it('describe with photos uses JSON object mode on the vision model, thinking off', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"美食","intro":"i","tags":[],"placeGuess":null}',
    )
    await post('/describe', { images: [IMG], note: '面' })
    const body = sentBody(fetchMock)
    expect(body.model).toBe('qwen3-vl-plus')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.enable_thinking).toBe(false)
    // JSON Object 模式要求提示词里出现 "JSON"
    expect(JSON.stringify(body.messages)).toContain('JSON')
  })

  it('describe repairs a bad reply once with the text model, without resending photos', async () => {
    const longTitle = '很'.repeat(60)
    const fetchMock = mockChatReplies(
      `{"title":"${longTitle}","category":"美食","intro":"吃了面","tags":[],"placeGuess":null}`,
      '{"title":"一碗面","category":"美食","intro":"吃了面","tags":[],"placeGuess":null,"clues":{"phones":[],"plates":[]}}',
    )
    const res = await post('/describe', { images: [IMG], note: '吃了面' })
    expect(res.status).toBe(200)
    expect((await json(res)).title).toBe('一碗面')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const fix = sentBody(fetchMock, 1)
    expect(fix.model).toBe('qwen3.7-flash')
    expect(fix.response_format.type).toBe('json_schema')
    expect(JSON.stringify(fix.messages)).not.toContain('image_url')
    expect(fix.messages[1].content).toContain('title')
    // 两次调用的用量都在响应头里
    expect(usageOf(res)).toEqual([
      {
        model: 'qwen3-vl-plus',
        inputTokens: 1000,
        outputTokens: 100,
        seconds: null,
      },
      {
        model: 'qwen3.7-flash',
        inputTokens: 1000,
        outputTokens: 100,
        seconds: null,
      },
    ])
  })

  it('describe gives up after one failed repair', async () => {
    const fetchMock = mockChatReplies('不是 JSON', '还是不是 JSON')
    const res = await post('/describe', { images: [IMG] })
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(usageOf(res)).toHaveLength(2)
  })

  it('describe passes the words to avoid to the model', async () => {
    const fetchMock = mockChatReply(
      '{"title":"t","category":"美食","intro":"i","tags":[],"placeGuess":null}',
    )
    await post('/describe', {
      images: [IMG],
      avoidWords: ['热气腾腾', '38 元'],
    })
    const system = sentBody(fetchMock).messages[0].content as string
    expect(system).toContain('热气腾腾、38 元')
  })

  it('suggest and summarize use the text model with thinking off', async () => {
    const fetchMock = mockChatReplies('- 不写感叹句', '先去了西湖。')
    await post('/preferences/suggest', {
      current: '',
      edits: [
        {
          draft: { title: 'a', intro: 'b' },
          final: { title: 'c', intro: 'd' },
        },
      ],
    })
    await post('/summarize', { items: [{ date: '11月3日', title: '西湖' }] })
    for (const call of [0, 1]) {
      expect(sentBody(fetchMock, call).model).toBe('qwen3.7-flash')
      expect(sentBody(fetchMock, call).enable_thinking).toBe(false)
    }
  })

  it('transcribe reports the audio seconds in the usage header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '你好' } }],
          usage: { prompt_tokens: 42, completion_tokens: 2, seconds: 3 },
        }),
      ),
    )
    const res = await post('/transcribe', { audio: WAV })
    expect(usageOf(res)).toEqual([
      {
        model: 'qwen3-asr-flash',
        inputTokens: 42,
        outputTokens: 2,
        seconds: 3,
      },
    ])
  })

  it('lets the app read the usage header across origins', async () => {
    mockChatReply('你好')
    const res = await app.request(
      '/api/transcribe',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://localhost',
        },
        body: JSON.stringify({ audio: WAV }),
      },
      ENV,
    )
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain(
      'X-AI-Usage',
    )
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
    ).toEqual({
      name: '某某面馆',
      address: '上海市 · 黄浦区 · 南京东路',
      city: '上海市',
    })
  })

  it('falls back to display_name when no address parts are present', () => {
    expect(formatNominatim({ display_name: 'Somewhere' })).toEqual({
      name: null,
      address: 'Somewhere',
      city: null,
    })
  })

  it('rounds coordinates to about 11 m for the cache key', () => {
    expect(cacheKey(31.240012, 121.489987)).toBe(cacheKey(31.24, 121.49))
  })
})

describe('place search', () => {
  it('turns search results into at most 3 candidates with coordinates', () => {
    const hit = (name: string, lat: string) => ({
      name,
      lat,
      lon: '121.49',
      address: { city: '上海市', city_district: '黄浦区' },
    })
    const list = formatCandidates([
      hit('外滩', '31.24'),
      hit('外滩源', '31.25'),
      hit('外滩美术馆', '31.26'),
      hit('外滩隧道', '31.27'),
    ])
    expect(list).toHaveLength(3)
    expect(list[0]).toEqual({
      name: '外滩',
      address: '上海市 · 黄浦区',
      lat: 31.24,
      lng: 121.49,
    })
  })

  it('drops results without usable coordinates, and tolerates a non-list reply', () => {
    expect(formatCandidates([{ name: 'x', lat: 'abc', lon: '1' }])).toEqual([])
    expect(formatCandidates({ error: 'x' })).toEqual([])
  })

  it('rejects an empty or overlong query without calling Nominatim', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const get = (q: string) =>
      app.request(`/api/geocode/search?q=${encodeURIComponent(q)}`, {}, ENV)
    expect((await get('  ')).status).toBe(400)
    expect((await get('长'.repeat(61))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the candidates from Nominatim', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json([
        {
          name: '西湖',
          lat: '30.24',
          lon: '120.15',
          address: { city: '杭州市' },
        },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await app.request('/api/geocode/search?q=西湖测试', {}, ENV)
    expect(await res.json()).toEqual({
      results: [{ name: '西湖', address: '杭州市', lat: 30.24, lng: 120.15 }],
    })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe('/search')
    expect(url.searchParams.get('q')).toBe('西湖测试')
    expect(url.searchParams.get('limit')).toBe('3')
  })
})
