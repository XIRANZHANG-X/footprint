// 构建时由 vite.config.ts 的 define 填入 package.json 的版本号（决策 0017 第 2 条）
declare const __APP_VERSION__: string

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
