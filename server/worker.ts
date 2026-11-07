import { createApp } from './app.ts'

// Cloudflare Workers 入口（决策 0007）。
// 静态页面由 wrangler.jsonc 里的 assets 直接提供，只有 /api/* 会进到这里。
// 线上必须配置访问口令：忘记配置时 AI 接口一律拒绝，而不是对所有人开放（决策 0008）。
export default createApp({ requireAccessToken: true })
