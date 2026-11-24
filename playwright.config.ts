import { defineConfig, devices } from '@playwright/test'

// 界面冒烟测试（决策 0019 第 6 条）：在真浏览器里走一遍主要流程。
// 跑的是生产构建（vite preview），所有 /api 请求在测试里用假数据回答，不连服务端、不花钱。
const PORT = 4179

export default defineConfig({
  testDir: 'e2e',
  // 文件名用 .e2e.ts，免得被 Vitest（默认找 .test / .spec）当成单元测试
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 离线缓存（service worker）会接管请求，测试里的假接口就拦不到了，所以关掉
    serviceWorkers: 'block',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
