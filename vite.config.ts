import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

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

// 网页版的离线缓存和"添加到主屏幕"（决策 0019 第 4 条）。
// 安卓 App 的页面本来就打包在本地，不需要，也不该再套一层缓存，所以 app 模式下关掉；开发时也关掉
function pwa(mode: string) {
  return VitePWA({
    disable: mode === 'app',
    registerType: 'autoUpdate',
    injectRegister: 'script-defer',
    includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: '足迹手账',
      short_name: '足迹手账',
      description: '选几张照片、说一句话，整理成可以分享的记录',
      lang: 'zh-CN',
      start_url: '/',
      display: 'standalone',
      background_color: '#fffaf2',
      theme_color: '#fdd0e0',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: 'icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      // 页面代码、样式、字体、图标提前缓存，第一次打开后就能离线用
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      // 下面这些大文件不提前下载，用到时才缓存
      globIgnores: ['models/**', 'ort/**', 'geo/**', 'data/**'],
      // 像素字体 695 KB、首屏代码约 460 KB，默认上限 2 MB 够用；放宽一点留余地
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      navigateFallback: 'index.html',
      // 接口不缓存，走网络
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // 语义搜索模型、运行库、边界数据、查表数据：先走网络（有浏览器缓存时只是一次很小的确认），
          // 没网才用缓存。不用"先用缓存"：这些文件网址不变、内容会随版本更新，缓存优先会一直用旧的
          urlPattern: ({ url }) =>
            /^\/(models|ort|geo|data)\//.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'big-assets',
            networkTimeoutSeconds: 5,
            expiration: { maxEntries: 40 },
          },
        },
      ],
    },
  })
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
      pwa(mode),
    ],
    // 偏好页底部显示的版本号，和安卓安装包的版本号同出 package.json（决策 0017 第 2 条）
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    worker: { format: 'es', plugins: () => [dropUnusedOrtWasm()] },
    server: {
      host: phone ? true : undefined,
      // 开发时把 /api 转给本地的 Hono 代理（server/index.ts）
      proxy: { '/api': 'http://localhost:8787' },
    },
  }
})
