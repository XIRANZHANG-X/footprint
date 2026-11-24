import { createApp } from './app.ts'
import type { Env } from './env.ts'

// Cloudflare Workers 入口（决策 0007）。
// 静态页面由 wrangler.jsonc 里的 assets 直接提供，只有 /api/* 和 /s/* 会进到这里。
// 线上必须配置访问口令：忘记配置时 AI 接口一律拒绝，而不是对所有人开放（决策 0008）。
const app = createApp({ requireAccessToken: true })

type WorkerEnv = Env & {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
}

export default {
  fetch(req: Request, env: WorkerEnv, ctx: Parameters<typeof app.fetch>[2]) {
    const url = new URL(req.url)
    // 跟着看的页面（决策 0026）：/s/<编号> 都给 share.html，不加载 App 本身。
    // 静态文件服务会把 /share.html 307 跳到 /share，所以直接要 /share
    if (url.pathname.startsWith('/s/')) {
      return env.ASSETS.fetch(new Request(new URL('/share', url), req)).then(
        (res) => {
          const out = new Response(res.body, res)
          out.headers.set('X-Robots-Tag', 'noindex, nofollow')
          return out
        },
      )
    }
    return app.fetch(req, env, ctx)
  },
}
