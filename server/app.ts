import { Hono } from 'hono'

// 无状态代理：唯一职责是保管 API key 并转发 AI 请求，不存任何用户数据。
// 与 index.ts 分开，测试可以直接调用 app.request() 而不用真的监听端口。
export const app = new Hono().basePath('/api')

app.get('/health', (c) =>
  c.json({
    ok: true,
    // 只报告 key 是否已配置，不回显 key 本身
    aiConfigured: Boolean(process.env.DASHSCOPE_API_KEY),
  }),
)
