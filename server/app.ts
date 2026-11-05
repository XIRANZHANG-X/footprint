import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  describeRequest,
  description,
  transcribeRequest,
} from '../shared/ai.ts'
import {
  chat,
  dashscopeConfig,
  extractJsonObject,
  UpstreamError,
} from './dashscope.ts'
import { reverseGeocode } from './geocode.ts'
import { DESCRIBE_SYSTEM, describeUserText } from './prompts.ts'

// 无状态代理：唯一职责是保管 API key 并转发 AI 请求，不存任何用户数据。
// 与 index.ts 分开，测试可以直接调用 app.request() 而不用真的监听端口。
export const app = new Hono().basePath('/api')

const aiConfigured = () => Boolean(process.env.DASHSCOPE_API_KEY)

app.get('/health', (c) =>
  c.json({
    ok: true,
    // 只报告 key 是否已配置，不回显 key 本身
    aiConfigured: aiConfigured(),
  }),
)

// 音频上限 10MB（百炼的 Base64 限制），4 张 768px 的图远小于这个值
app.use('/transcribe', bodyLimit({ maxSize: 12 * 1024 * 1024 }))
app.use('/describe', bodyLimit({ maxSize: 12 * 1024 * 1024 }))
app.use('/transcribe', async (c, next) =>
  aiConfigured()
    ? next()
    : c.json({ error: '服务端没有配置 DASHSCOPE_API_KEY' }, 503),
)
app.use('/describe', async (c, next) =>
  aiConfigured()
    ? next()
    : c.json({ error: '服务端没有配置 DASHSCOPE_API_KEY' }, 503),
)

app.post('/transcribe', async (c) => {
  const parsed = transcribeRequest.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
  const text = await chat({
    model: dashscopeConfig().asrModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: parsed.data.audio } },
        ],
      },
    ],
    // 非 OpenAI 标准参数，放在请求体顶层；开启 ITN 把"三点半"写成"3:30"这类形式
    asr_options: { enable_itn: true },
  })
  return c.json({ text: text.trim() })
})

app.post('/describe', async (c) => {
  const parsed = describeRequest.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
  const req = parsed.data
  const reply = await chat({
    model: dashscopeConfig().vlModel,
    messages: [
      { role: 'system', content: DESCRIBE_SYSTEM },
      {
        role: 'user',
        content: [
          ...req.images.map((url) => ({
            type: 'image_url',
            image_url: { url },
          })),
          { type: 'text', text: describeUserText(req) },
        ],
      },
    ],
  })
  let result
  try {
    result = description.parse(extractJsonObject(reply))
  } catch {
    return c.json(
      { error: '模型返回的内容无法解析', raw: reply.slice(0, 300) },
      502,
    )
  }
  return c.json(result)
})

app.get('/geocode', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return c.json({ error: '缺少坐标' }, 400)
  return c.json(await reverseGeocode(lat, lng))
})

app.onError((err, c) => {
  console.error(err)
  if (err instanceof UpstreamError)
    return c.json({ error: err.message }, err.status === 429 ? 429 : 502)
  return c.json({ error: '服务端出错' }, 500)
})
