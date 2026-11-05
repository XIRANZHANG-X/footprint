// 百炼（DashScope）OpenAI 兼容接口的最小封装。地址和模型名都可以在 .env 里覆盖。
export function dashscopeConfig() {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY ?? '',
    baseUrl:
      process.env.DASHSCOPE_BASE_URL ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    asrModel: process.env.ASR_MODEL ?? 'qwen3-asr-flash',
    vlModel: process.env.VL_MODEL ?? 'qwen3-vl-plus',
  }
}

export class UpstreamError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type ChatResponse = { choices?: { message?: { content?: unknown } }[] }

// 调用 /chat/completions，返回第一条回复的文本
export async function chat(body: Record<string, unknown>): Promise<string> {
  const { apiKey, baseUrl } = dashscopeConfig()
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
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string')
    throw new UpstreamError('百炼返回格式异常', 502)
  return content
}

// 模型有时会在 JSON 外面包一层 ```json ... ``` 或说明文字，取出第一个 {...} 对象
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('回复中没有 JSON 对象')
  return JSON.parse(text.slice(start, end + 1))
}
