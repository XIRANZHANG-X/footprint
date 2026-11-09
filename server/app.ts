import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { timingSafeEqual } from 'hono/utils/buffer'
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
import type { Env } from './env.ts'
import { reverseGeocode } from './geocode.ts'
import { DESCRIBE_SYSTEM, describeUserText } from './prompts.ts'

type AppEnv = { Bindings: Env }

export type AppOptions = {
  // true：没配置 ACCESS_TOKEN 时拒绝所有受保护接口（线上 Worker 用）。
  // false：没配置时放行（本机开发用）。配置了口令时两者都会校验。
  requireAccessToken: boolean
}

// 无状态代理：唯一职责是保管 API key 并转发 AI 请求，不存任何用户数据。
// 做成工厂函数：Node（本机开发）和 Cloudflare Worker（线上）各建一个，只有口令策略不同。
// 测试可以直接调用 app.request(path, init, env)，不用真的监听端口。
export function createApp({ requireAccessToken }: AppOptions) {
  const app = new Hono<AppEnv>().basePath('/api')

  // 安卓 App 的页面来自本地（https://localhost），访问线上接口属于跨域（决策 0009）。
  // 只放行 App 自己的来源；放行跨域不等于免口令，受保护接口照样校验
  app.use(
    '*',
    cors({
      origin: ['https://localhost', 'capacitor://localhost'],
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    }),
  )

  const aiConfigured = (env: Env) => Boolean(env.DASHSCOPE_API_KEY)
  const accessRequired = (env: Env) =>
    requireAccessToken || Boolean(env.ACCESS_TOKEN)

  app.get('/health', (c) =>
    c.json({
      ok: true,
      // 只报告"有没有配置"，不回显 key 或口令本身
      aiConfigured: aiConfigured(c.env),
      accessRequired: accessRequired(c.env),
    }),
  )

  // 访问口令（决策 0008）。两边先哈希再比较，响应时间不随"猜对了几位"变化
  const checkAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
    const expected = c.env.ACCESS_TOKEN
    if (!expected) {
      if (requireAccessToken)
        return c.json({ error: '服务端没有配置访问口令' }, 503)
      return next()
    }
    const header = c.req.header('Authorization') ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!given || !(await timingSafeEqual(given, expected)))
      return c.json({ error: '访问口令不对', code: 'bad_token' }, 401)
    return next()
  }

  const requireKey: MiddlewareHandler<AppEnv> = async (c, next) =>
    aiConfigured(c.env)
      ? next()
      : c.json({ error: '服务端没有配置 DASHSCOPE_API_KEY' }, 503)

  // 音频上限 10MB（百炼的 Base64 限制），4 张 768px 的图远小于这个值
  const limit = bodyLimit({ maxSize: 12 * 1024 * 1024 })

  // 让前端验证用户输入的口令是否正确，不消耗 AI 额度
  app.get('/auth/check', checkAccess, (c) => c.json({ ok: true }))

  app.post('/transcribe', checkAccess, limit, requireKey, async (c) => {
    const parsed = transcribeRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const config = dashscopeConfig(c.env)
    const text = await chat(config, {
      model: config.asrModel,
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

  app.post('/describe', checkAccess, limit, requireKey, async (c) => {
    const parsed = describeRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const req = parsed.data
    const config = dashscopeConfig(c.env)
    const reply = await chat(config, {
      model: config.vlModel,
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

  // 地名接口不花百炼额度，但被滥用会让 Nominatim 封掉我们，所以同样要口令
  app.get('/geocode', checkAccess, async (c) => {
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

  return app
}
