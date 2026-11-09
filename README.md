# footprint-journal 足迹手账

AI 自动化电子手账：选几张照片、说一句话，自动整理成可以分享的记录，并沉淀进个人的足迹地图。本地优先，服务端不保存任何用户数据。

> 开发中（P0 脚手架）。设计决策见 [docs/decisions](docs/decisions)。

## 开发

```bash
npm install
cp .env.example .env   # 填写 DASHSCOPE_API_KEY（可选，P2 起才用到）
npm run dev            # 同时启动前端 (Vite) 和 API 代理 (Hono, :8787)
```

| 命令                | 作用                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev:phone` | 局域网 HTTPS 模式，供手机测试（自签名证书） |
| `npm test`          | 运行测试（Vitest）                          |
| `npm run lint`      | 代码检查（oxlint）                          |
| `npm run format`    | 格式化（Prettier）                          |
| `npm run build`     | 类型检查并构建                              |

## 部署与安卓 App

- 部署到 Cloudflare Workers：`npm run deploy`（见决策 0007、0008；需先用 `wrangler secret` 设置 `DASHSCOPE_API_KEY` 和 `ACCESS_TOKEN`）。
- 安卓安装包（决策 0009）：需要 Android Studio（含 SDK）和 **JDK 21**（Android Studio 自带的 Java 25 对 Gradle 8.14 太新）。

```bash
npm run app:sync                        # 用 .env.app 构建网页并同步进 android/
cd android && JAVA_HOME=<JDK 21 路径> ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`，传到手机上安装即可（需允许安装未知来源应用）。
`android/local.properties` 里写本机 SDK 路径（`sdk.dir=C:/Users/<你>/AppData/Local/Android/Sdk`），这个文件不提交。

## 目录

- `src/`：前端（React）
- `server/`：无状态 AI 代理（Hono），只负责保管 API key 并转发请求
- `android/`：Capacitor 安卓外壳；`app/src/main/java/` 里有自己写的存相册插件
- `docs/decisions/`：架构决策记录
