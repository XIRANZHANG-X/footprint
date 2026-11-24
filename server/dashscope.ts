import type { AiUsage } from '../shared/ai.ts'
import type { Env } from './env.ts'

// 百炼（DashScope）OpenAI 兼容接口的最小封装。地址和模型名都可以在环境变量里覆盖。
// 按任务选模型（决策 0016 第 2 条）：有照片才用看图的 vlModel；纯文字的任务（只写文字的记录、
// 偏好提炼、出行总结、修格式）用便宜、快的 textModel。价格见 src/lib/usage.ts
export function dashscopeConfig(env: Env) {
  return {
    apiKey: env.DASHSCOPE_API_KEY ?? '',
    baseUrl:
      env.DASHSCOPE_BASE_URL ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    asrModel: env.ASR_MODEL ?? 'qwen3-asr-flash',
    vlModel: env.VL_MODEL ?? 'qwen3-vl-plus',
    textModel: env.TEXT_MODEL ?? 'qwen3.7-flash',
  }
}

export type DashscopeConfig = ReturnType<typeof dashscopeConfig>

// 不开"思考模式"。qwen3.7 系列默认开启，思考的 token 占输出的六成以上，又慢又贵；
// 结构化输出在 qwen3-vl-plus 上也只支持非思考模式。语音识别模型不传这个参数
export const THINKING_OFF = { enable_thinking: false } as const

export class UpstreamError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ChatResponse = {
  model?: string
  choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    seconds?: number
  }
}

export type ChatResult = { text: string; usage: AiUsage }

const num = (v: unknown) => (typeof v === 'number' ? v : null)

async function complete(
  { apiKey, baseUrl }: DashscopeConfig,
  body: Record<string, unknown>,
): Promise<{ data: ChatResponse; usage: AiUsage }> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stream: false, ...body }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    // 上游的错误信息可能很长，截断后返回，方便排查但不刷屏
    const detail = (await res.text()).slice(0, 300)
    throw new UpstreamError(`百炼返回 ${res.status}: ${detail}`, res.status)
  }
  const data = (await res.json()) as ChatResponse
  return {
    data,
    usage: {
      model: typeof body.model === 'string' ? body.model : (data.model ?? ''),
      inputTokens: num(data.usage?.prompt_tokens),
      outputTokens: num(data.usage?.completion_tokens),
      seconds: num(data.usage?.seconds),
    },
  }
}

// 调用 /chat/completions，返回第一条回复的文本，以及这次用了多少（决策 0016 第 3 条）
export async function chat(
  config: DashscopeConfig,
  body: Record<string, unknown>,
): Promise<ChatResult> {
  const { data, usage } = await complete(config, body)
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string')
    throw new UpstreamError('百炼返回格式异常', 502)
  return { text: content, usage }
}

// 带工具的一轮（决策 0028）：回复可能是文字，也可能是要调用的工具
export async function chatWithTools(
  config: DashscopeConfig,
  body: Record<string, unknown>,
): Promise<{
  message: { content: unknown; tool_calls: unknown }
  usage: AiUsage
}> {
  const { data, usage } = await complete(config, body)
  const message = data.choices?.[0]?.message
  if (!message) throw new UpstreamError('百炼返回格式异常', 502)
  return {
    message: {
      content: message.content ?? null,
      tool_calls: message.tool_calls ?? [],
    },
    usage,
  }
}

// 模型有时会在 JSON 外面包一层 ```json ... ``` 或说明文字，取出第一个 {...} 对象。
// 开了结构化输出以后很少需要，留着兜底
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('回复中没有 JSON 对象')
  return JSON.parse(text.slice(start, end + 1))
}

// 先当作纯 JSON 解析（结构化输出的正常情况），不行再从文字里找
export function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return extractJsonObject(text)
  }
}
