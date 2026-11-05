import { serve } from '@hono/node-server'
import { app } from './app.ts'

// 有 .env 就加载，没有也能启动（只是 AI 功能不可用）
try {
  process.loadEnvFile()
} catch {
  console.warn('未找到 .env，AI 接口将不可用。参考 .env.example 创建。')
}

const port = Number(process.env.API_PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API proxy listening on http://localhost:${info.port}`)
})
