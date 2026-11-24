import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { timingSafeEqual } from 'hono/utils/buffer'
import { z } from 'zod'
import {
  AI_USAGE_HEADER,
  boundaryRequest,
  planContract,
  planRequest,
  planResponse,
  descriptionContract,
  describeRequest,
  description,
  MAX_PLACE_QUERY_CHARS,
  MAX_PREFERENCES_CHARS,
  suggestRequest,
  summarizeRequest,
  transcribeRequest,
  type AiUsage,
  type Description,
  type DescribeMode,
} from '../shared/ai.ts'
import {
  chat,
  dashscopeConfig,
  parseJsonReply,
  THINKING_OFF,
  UpstreamError,
} from './dashscope.ts'
import type { Env } from './env.ts'
import { findBoundary, findPlaces, placeName } from './places.ts'
import { shareRoutes } from './share.ts'
import { weatherAt } from './weather.ts'
import {
  describeSystem,
  describeUserText,
  REPAIR_SYSTEM,
  repairUserText,
  SUGGEST_SYSTEM,
  suggestUserText,
  summarySystem,
  summaryUserText,
  PLAN_SYSTEM,
  planUserText,
} from './prompts.ts'

type AppEnv = { Bindings: Env }

// 纯文字请求用 JSON Schema 模式，严格按格式输出（决策 0016 第 1 条）。
// 带照片的请求百炼只支持 JSON Object 模式（传 json_schema 也会被降级），格式靠提示词和下面的校验
function schemaFormat(mode: DescribeMode) {
  const { $schema: _drop, ...schema } = z.toJSONSchema(
    descriptionContract(mode),
  )
  return {
    type: 'json_schema',
    json_schema: { name: 'journal_record', strict: true, schema },
  }
}
const JSON_OBJECT = { type: 'json_object' } as const

type Parsed =
  { ok: true; value: Description } | { ok: false; problems: string[] }

// 解析并校验模型的回复。meta 模式下模型不写正文；万一它还是写了，也不采用
export function parseDescription(text: string, mode: DescribeMode): Parsed {
  let raw: unknown
  try {
    raw = parseJsonReply(text)
  } catch {
    return { ok: false, problems: ['不是合法的 JSON 对象'] }
  }
  const result = description.safeParse(
    mode === 'meta' && raw && typeof raw === 'object'
      ? { ...raw, intro: '' }
      : raw,
  )
  if (result.success) return { ok: true, value: result.data }
  return {
    ok: false,
    problems: result.error.issues.map(
      (i) => `${i.path.join('.') || '整体'}：${i.message}`,
    ),
  }
}

// 这次请求一共调用了几次、各用了多少，写进响应头（决策 0016 第 3 条）
function usageHeader(usages: AiUsage[]) {
  return { [AI_USAGE_HEADER]: JSON.stringify(usages) }
}

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
      // App 的页面和接口不同源，要显式放行，前端才读得到用量（决策 0016 第 3 条）
      exposeHeaders: [AI_USAGE_HEADER],
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

  // 按"IP + 接口"限流（决策 0018 第 3 条）：口令泄露后挡住刷量，也挡住反复猜口令。
  // 放在口令检查前面，猜错的请求也计数。Cloudflare 的计数是近似的、各机房分开算，挡得住刷量，挡不住慢慢地用；
  // 最后一道防线是阿里云的费用预警
  const rateLimit =
    (
      binding: 'AI_RATE_LIMIT' | 'LIGHT_RATE_LIMIT',
    ): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      const limiter = c.env[binding]
      if (!limiter) return next()
      const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
      const { success } = await limiter.limit({ key: `${ip} ${c.req.path}` })
      if (!success)
        return c.json(
          { error: '请求太频繁了，过一分钟再试', code: 'rate_limited' },
          429,
          { 'Retry-After': '60' },
        )
      return next()
    }
  // 花百炼额度的接口
  const aiRate = rateLimit('AI_RATE_LIMIT')
  // 不花钱的：口令验证、地名
  const lightRate = rateLimit('LIGHT_RATE_LIMIT')

  // 音频上限 10MB（百炼的 Base64 限制），4 张 768px 的图远小于这个值
  const limit = bodyLimit({ maxSize: 12 * 1024 * 1024 })

  // 让前端验证用户输入的口令是否正确，不消耗 AI 额度
  app.get('/auth/check', lightRate, checkAccess, (c) => c.json({ ok: true }))

  app.post('/transcribe', aiRate, checkAccess, limit, requireKey, async (c) => {
    const parsed = transcribeRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const config = dashscopeConfig(c.env)
    const { text, usage } = await chat(config, {
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
    return c.json({ text: text.trim() }, 200, usageHeader([usage]))
  })

  app.post('/describe', aiRate, checkAccess, limit, requireKey, async (c) => {
    const parsed = describeRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const req = parsed.data
    const config = dashscopeConfig(c.env)
    const hasImages = req.images.length > 0
    const system = describeSystem(
      req.mode,
      req.preferences,
      req.examples,
      req.avoidWords,
    )
    const usages: AiUsage[] = []

    // 有照片才用看图模型；只写文字的记录交给文字模型，并按 JSON Schema 严格输出（决策 0016 第 1、2 条）
    const first = await chat(config, {
      model: hasImages ? config.vlModel : config.textModel,
      ...THINKING_OFF,
      response_format: hasImages ? JSON_OBJECT : schemaFormat(req.mode),
      messages: [
        { role: 'system', content: system },
        hasImages
          ? {
              role: 'user',
              content: [
                ...req.images.map((url) => ({
                  type: 'image_url',
                  image_url: { url },
                })),
                { type: 'text', text: describeUserText(req) },
              ],
            }
          : { role: 'user', content: describeUserText(req) },
      ],
    })
    usages.push(first.usage)
    let result = parseDescription(first.text, req.mode)

    // 不合格式就修一次：只把回复和问题发给文字模型，不重发照片，快而且便宜。
    // 只修一次，修不好照旧报错，用户可以点重试（决策 0016 第 1 条）
    if (!result.ok) {
      const fix = await chat(config, {
        model: config.textModel,
        ...THINKING_OFF,
        response_format: schemaFormat(req.mode),
        messages: [
          { role: 'system', content: REPAIR_SYSTEM },
          {
            role: 'user',
            content: repairUserText(first.text, result.problems),
          },
        ],
      })
      usages.push(fix.usage)
      result = parseDescription(fix.text, req.mode)
    }

    if (!result.ok)
      return c.json(
        { error: '模型返回的内容无法解析', raw: first.text.slice(0, 300) },
        502,
        usageHeader(usages),
      )
    return c.json(result.value, 200, usageHeader(usages))
  })

  // 根据最近的修改提出一版新的偏好说明。只处理文字，没有照片
  app.post(
    '/preferences/suggest',
    aiRate,
    checkAccess,
    limit,
    requireKey,
    async (c) => {
      const parsed = suggestRequest.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
      const config = dashscopeConfig(c.env)
      const { text, usage } = await chat(config, {
        model: config.textModel,
        ...THINKING_OFF,
        messages: [
          { role: 'system', content: SUGGEST_SYSTEM },
          {
            role: 'user',
            content: suggestUserText(parsed.data.current, parsed.data.edits),
          },
        ],
      })
      // 说明要放回提示词里，超长的部分截掉
      return c.json(
        { text: text.trim().slice(0, MAX_PREFERENCES_CHARS) },
        200,
        usageHeader([usage]),
      )
    },
  )

  // 一次出行的总结（决策 0014 第 3E 条）。只处理文字，没有照片
  app.post('/summarize', aiRate, checkAccess, limit, requireKey, async (c) => {
    const parsed = summarizeRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const config = dashscopeConfig(c.env)
    const { text, usage } = await chat(config, {
      model: config.textModel,
      ...THINKING_OFF,
      messages: [
        { role: 'system', content: summarySystem(parsed.data.preferences) },
        { role: 'user', content: summaryUserText(parsed.data) },
      ],
    })
    return c.json(
      { text: text.trim().slice(0, 600) },
      200,
      usageHeader([usage]),
    )
  })

  // AI 帮我排行程（决策 0024 第 4 条）：只发文字，文字模型按严格格式输出；地点由 App 逐个搜索核实
  app.post('/plan', aiRate, checkAccess, limit, requireKey, async (c) => {
    const parsed = planRequest.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: '请求格式不对' }, 400)
    const config = dashscopeConfig(c.env)
    const { $schema: _drop, ...schema } = z.toJSONSchema(planContract)
    const { text, usage } = await chat(config, {
      model: config.textModel,
      ...THINKING_OFF,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'trip_plan', strict: true, schema },
      },
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: planUserText(parsed.data) },
      ],
    })
    let raw: unknown = null
    try {
      raw = parseJsonReply(text)
    } catch {
      // 回复里根本没有 JSON：当作格式不对
    }
    const plan = planResponse.safeParse(raw)
    if (!plan.success)
      return c.json(
        { error: 'AI 返回的行程格式不对，请重试' },
        502,
        usageHeader([usage]),
      )
    return c.json(plan.data, 200, usageHeader([usage]))
  })

  // 地名接口不花百炼额度，但被滥用会让 Nominatim 封掉我们、用光高德的免费额度，所以同样要口令。
  // 国内走高德、国外走 Nominatim（决策 0021），见 places.ts
  app.get('/geocode', lightRate, checkAccess, async (c) => {
    const lat = Number(c.req.query('lat'))
    const lng = Number(c.req.query('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return c.json({ error: '缺少坐标' }, 400)
    return c.json(await placeName(c.env.AMAP_WEB_KEY, lat, lng))
  })

  // 按地名查坐标，列出候选让用户选（决策 0013 第 3 条）。同样走 Nominatim，同样要口令
  app.get('/geocode/search', lightRate, checkAccess, async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (!q || q.length > MAX_PLACE_QUERY_CHARS)
      return c.json({ error: '地名不能为空，也不能太长' }, 400)
    return c.json({ results: await findPlaces(c.env.AMAP_WEB_KEY, q) })
  })

  // 行政区边界（决策 0020 第 6 条）：补去过的地方、想去清单要用。只转发，不存
  app.get('/geocode/boundary', lightRate, checkAccess, async (c) => {
    const id = boundaryRequest.safeParse(c.req.query('id') ?? '')
    if (!id.success) return c.json({ error: '边界编号不对' }, 400)
    return c.json(await findBoundary(c.env.AMAP_WEB_KEY, id.data))
  })

  // 跟着看（决策 0026）：加密的只读链接
  app.route('/share', shareRoutes(checkAccess, lightRate))

  // 当时的天气（决策 0025）：坐标和时间转发给 Open-Meteo，不存
  app.get('/weather', lightRate, checkAccess, async (c) => {
    const lat = Number(c.req.query('lat'))
    const lng = Number(c.req.query('lng'))
    const t = Number(c.req.query('t'))
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      !Number.isFinite(t) ||
      t < Date.UTC(1940, 0, 1) ||
      t > Date.now() + 3_600_000
    )
      return c.json({ error: '坐标或时间不对' }, 400)
    return c.json(await weatherAt(lat, lng, t))
  })

  app.onError((err, c) => {
    console.error(err)
    if (err instanceof UpstreamError)
      return c.json({ error: err.message }, err.status === 429 ? 429 : 502)
    return c.json({ error: '服务端出错' }, 500)
  })

  return app
}
