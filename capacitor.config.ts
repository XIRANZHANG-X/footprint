import type { CapacitorConfig } from '@capacitor/cli'

// 安卓外壳配置（决策 0009）：把 dist/ 打包进 App，AI 走线上 Worker（地址见 .env.app）。
const config: CapacitorConfig = {
  // 安装包的唯一标识，发布到应用商店后就不能再改；目前只是自己装着用
  appId: 'com.footprintjournal.app',
  appName: '足迹手账',
  webDir: 'dist',
  android: {
    // 页面来源是 https://localhost（Capacitor 默认）。服务端 CORS 只放行这个来源，两边要一致
    allowMixedContent: false,
  },
}

export default config
