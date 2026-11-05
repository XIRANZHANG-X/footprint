import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `npm run dev:phone`：在局域网里用 HTTPS 提供页面，供手机测试。
  // 手机访问的是 192.168.x.x 而不是 localhost，普通 http 不算安全上下文，
  // crypto.randomUUID、录音（getUserMedia）等 API 都不可用，所以必须 HTTPS。
  const phone = mode === 'phone'
  return {
    plugins: [react(), tailwindcss(), ...(phone ? [basicSsl()] : [])],
    server: {
      host: phone ? true : undefined,
      // 开发时把 /api 转给本地的 Hono 代理（server/index.ts）
      proxy: { '/api': 'http://localhost:8787' },
    },
  }
})
