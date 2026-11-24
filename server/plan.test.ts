import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { planUserText } from './prompts.ts'

// AI 帮我排行程（决策 0024 第 4 条）。模型的回复是假的，不花钱
const app = createApp({ requireAccessToken: false })
const ENV = { DASHSCOPE_API_KEY: 'sk-test-not-real' }

function fakeModel(content: string) {
  const calls: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return Response.json({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 300, completion_tokens: 120 },
      })
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const post = (body: unknown) =>
  app.request(
    '/api/plan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    ENV,
  )

describe('POST /api/plan', () => {
  it('asks the text model for a strict JSON plan and returns it', async () => {
    const calls = fakeModel(
      JSON.stringify({
        days: [
          {
            day: 1,
            stops: [
              { name: '清水寺', reason: '你常记寺庙' },
              { name: '二年坂', reason: '顺路，适合慢慢走' },
            ],
          },
        ],
      }),
    )
    const res = await post({
      destination: '京都',
      days: 1,
      likes: ['寺庙', '咖啡'],
      visited: ['伏见稻荷大社'],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      days: [
        {
          day: 1,
          stops: [
            { name: '清水寺', reason: '你常记寺庙' },
            { name: '二年坂', reason: '顺路，适合慢慢走' },
          ],
        },
      ],
    })
    expect(res.headers.get('X-AI-Usage')).toContain('inputTokens')
    const body = calls[0] as {
      response_format: { type: string }
      enable_thinking: boolean
      messages: { content: string }[]
    }
    expect(body.response_format.type).toBe('json_schema')
    expect(body.enable_thinking).toBe(false)
    // 只发文字：目的地、口味、去过的地方
    expect(body.messages[1].content).toContain('伏见稻荷大社')
  })

  it('rejects a bad request without calling the model', async () => {
    const calls = fakeModel('{}')
    expect((await post({ destination: '', days: 3 })).status).toBe(400)
    expect((await post({ destination: '京都', days: 30 })).status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('answers 502 when the reply is not a plan', async () => {
    fakeModel('今天天气不错')
    expect((await post({ destination: '京都', days: 2 })).status).toBe(502)
  })
})

describe('plan prompt', () => {
  it('leaves out empty parts', () => {
    expect(planUserText({ destination: '杭州', days: 2 })).toBe(
      '目的地：杭州\n天数：2',
    )
  })
})

// 决策 0029 第 2 条：年度回顾。月度小结用 /summarize 的 month 口径，年度只收小结和统计
describe('year story', () => {
  it('writes a month summary with the month prompt', async () => {
    const calls = fakeModel('三月我去了杭州。')
    const res = await app.request(
      '/api/summarize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'month',
          items: [{ date: '3月2日', title: '面', place: '奎元馆', body: '' }],
        }),
      },
      ENV,
    )
    expect(res.status).toBe(200)
    const sys = (calls[0] as { messages: { content: string }[] }).messages[0]
    expect(sys.content).toContain('某一个月')
  })

  it('writes the year from month summaries and facts', async () => {
    const calls = fakeModel('这一年我去了两个城市。')
    const res = await app.request(
      '/api/summarize/year',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: 2025,
          months: [
            { month: 3, text: '三月在杭州吃面。' },
            { month: 7, text: '七月看展。' },
          ],
          facts: '3 条记录，出门 3 天',
        }),
      },
      ENV,
    )
    expect(await res.json()).toEqual({ text: '这一年我去了两个城市。' })
    const sent = calls[0] as { messages: { content: string }[] }
    expect(sent.messages[0].content).toContain('数字照抄统计')
    expect(sent.messages[1].content).toContain('7 月：七月看展。')
    const bad = await app.request(
      '/api/summarize/year',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: 2025, months: [], facts: '' }),
      },
      ENV,
    )
    expect(bad.status).toBe(400)
  })
})
