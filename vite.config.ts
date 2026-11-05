import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 开发时把 /api 转给本地的 Hono 代理（server/index.ts）
    proxy: { '/api': 'http://localhost:8787' },
  },
})
