import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// onnxruntime 默认引用的 asyncify 版 wasm（26.9 MB）会被打进 dist/assets，
// 超过 Cloudflare 单文件 25 MB 的上限。运行时我们把 wasm 路径指向 public/ort 里 14 MB 的普通版
// （src/lib/semantic/embed.worker.ts），所以这份用不到，构建时去掉（决策 0014 第 3A 条）
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'drop-unused-ort-wasm',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle))
        if (
          /ort-wasm-simd-threaded\.(asyncify|jsep|jspi)[^/]*\.wasm$/.test(name)
        )
          delete bundle[name]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `npm run dev:phone`：在局域网里用 HTTPS 提供页面，供手机测试。
  // 手机访问的是 192.168.x.x 而不是 localhost，普通 http 不算安全上下文，
  // crypto.randomUUID、录音（getUserMedia）等 API 都不可用，所以必须 HTTPS。
  const phone = mode === 'phone'
  return {
    plugins: [
      react(),
      tailwindcss(),
      dropUnusedOrtWasm(),
      ...(phone ? [basicSsl()] : []),
    ],
    worker: { format: 'es', plugins: () => [dropUnusedOrtWasm()] },
    server: {
      host: phone ? true : undefined,
      // 开发时把 /api 转给本地的 Hono 代理（server/index.ts）
      proxy: { '/api': 'http://localhost:8787' },
    },
  }
})
