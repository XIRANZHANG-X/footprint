// 服务端用到的全部环境变量。
// 本机开发（Node）时来自 .env → process.env；部署到 Cloudflare Workers 时来自
// wrangler 配置里的变量和 `wrangler secret put` 设置的加密变量。
// 两种运行环境都把它作为 Hono 的 c.env 传进来，路由代码不直接读 process.env。
export type Env = {
  DASHSCOPE_API_KEY?: string
  DASHSCOPE_BASE_URL?: string
  ASR_MODEL?: string
  VL_MODEL?: string
  // 纯文字任务用的模型（决策 0016 第 2 条），默认 qwen3.7-flash
  TEXT_MODEL?: string
  // 访问口令（决策 0008）
  ACCESS_TOKEN?: string
  // 高德 Web 服务的 key（决策 0021）：国内的地名、地点搜索、行政区边界。没配就全部用 Nominatim
  AMAP_WEB_KEY?: string
  // Cloudflare 的限流绑定（决策 0018 第 3 条），在 wrangler.jsonc 的 ratelimits 里配置。
  // 本机 Node 没有这两个绑定，就不限流
  // 跟着看的加密包（决策 0026），Workers KV；本机没有，用内存代替
  SHARES?: KvStore
  AI_RATE_LIMIT?: RateLimiter
  LIGHT_RATE_LIMIT?: RateLimiter
}

// Workers 限流绑定的接口，只用到 limit 这一个方法
export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

// Workers KV 用到的几个方法（决策 0026）
export type KvStore = {
  get<T = string>(key: string, type: 'text' | 'arrayBuffer'): Promise<T | null>
  getWithMetadata<M>(
    key: string,
    type: 'arrayBuffer' | 'text',
  ): Promise<{ value: ArrayBuffer | string | null; metadata: M | null }>
  put(
    key: string,
    value: ArrayBuffer | string,
    opts?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>
  delete(key: string): Promise<void>
  list(opts: { prefix: string }): Promise<{ keys: { name: string }[] }>
}
