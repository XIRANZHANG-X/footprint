import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

// 有 .env 就加载，没有也能启动（只是 AI 功能不可用）
try {
  process.loadEnvFile()
} catch {
  console.warn('未找到 .env，AI 接口将不可用。参考 .env.example 创建。')
}

// 本机开发：没配置 ACCESS_TOKEN 时不要求口令，方便在家里局域网测试；
// 在 .env 里配置了口令，就和线上一样校验
const app = createApp({ requireAccessToken: false })
const port = Number(process.env.API_PORT ?? 8787)
// 每次请求把 process.env 作为 c.env 传给路由，和 Worker 的写法保持一致
serve({ fetch: (req) => app.fetch(req, process.env), port }, (info) => {
  console.log(`API proxy listening on http://localhost:${info.port}`)
})
