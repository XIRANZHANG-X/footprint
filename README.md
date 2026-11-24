# footprint-journal 足迹手账

AI 自动化电子手账：选几张照片、说一句话，自动整理成可以分享的记录，并沉淀进个人的足迹地图。
本地优先，服务端不保存任何用户数据。

> 自己在用，还在开发中。设计决策和每一项的备选方案见 [docs/decisions](docs/decisions)，待办见 [docs/backlog.md](docs/backlog.md)。

## 隐私

记录、照片、语音都只存在你自己的手机或浏览器里（IndexedDB），没有账号，也没有云端同步。
下面是所有会离开设备的数据：

| 什么时候             | 发出去的内容                                                                               | 发给谁                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 让 AI 整理一条记录   | 缩小到 768 像素的照片、你写或说的原话、拍摄时间、地名、你的写作偏好和例子                  | 本项目的服务端，转发给阿里云百炼的模型                                    |
| 录音转文字           | 那段录音                                                                                   | 同上                                                                      |
| 偏好提炼、出行总结   | 只有文字：偏好提炼发你改过的稿子；出行总结发这次出行每条记录的日期、标题、地名和正文       | 同上                                                                      |
| 查地名、按地名搜地点 | 坐标或你输入的地名                                                                         | 本项目的服务端，国内的转发给高德，国外的转发给 OpenStreetMap 的 Nominatim |
| 看地图               | 地图瓦片请求（会带出你在看的区域）                                                         | 国内是高德，国外是 OpenStreetMap 的瓦片服务器                             |
| 补当时的天气         | 记录的坐标和拍摄时间                                                                       | 本项目的服务端，转发给 Open-Meteo                                         |
| 生成"跟着看"链接     | 这次出行加密后的包（标题、路线、每站的文字和照片，按你选的）；钥匙只在链接里，服务端打不开 | 本项目的服务端，存在 Cloudflare KV，到期自动删除                          |

- **服务端不保存**：服务端只负责保管 API key、转发请求，不存照片、不存文字、不存坐标。唯一的例外是"跟着看"链接：存的是在手机上加密过的包，服务端没有钥匙打不开，到期或你撤回就删掉（决策 0026）。
  部署在 Cloudflare Workers 上，Cloudflare 的运行日志会记下请求的网址（查地名时网址里有坐标）和出错信息，
  保留几天后自动删除；不记请求正文，所以照片和文字不进日志。
- **阿里云百炼**：照片和文字按阿里云百炼的服务条款处理，本项目控制不了它那边怎么存。
- **完全在本机做的**：路线回放、短视频、路线海报、PDF 手账、语义搜索（模型打包在 App 里）、判断在哪个省市区县（边界数据打包在 App 里）、分享图生成、备份。
- **访问口令**存在本机。每次调用服务端都要带上它，没有口令的请求会被拒绝。
- **备份文件**里有全部照片和记录，没有加密，请自己保管好。安卓 App 每周会自动备份一份到手机的"下载/足迹手账"文件夹（可以在备份页关掉）。

## 开发

```bash
npm install
cp .env.example .env   # 填写 DASHSCOPE_API_KEY，可选填 ACCESS_TOKEN
npm run dev            # 同时启动前端（Vite）和 API 代理（Hono，:8787）
```

第一次运行会自动下载约 50 MB 的模型和边界数据到 `public/`（`npm run assets`），这些文件不进仓库。

| 命令                  | 作用                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `npm run dev:phone`   | 局域网 HTTPS 模式，供手机测试（自签名证书）                         |
| `npm test`            | 运行测试（Vitest）                                                  |
| `npm run lint`        | 代码检查（oxlint）                                                  |
| `npm run format`      | 格式化（Prettier）                                                  |
| `npm run build`       | 类型检查并构建                                                      |
| `npm run check`       | 类型检查、代码检查、单元测试、格式，一次跑完                        |
| `npm run test:e2e`    | 界面冒烟测试（Playwright，AI 接口用假数据）                         |
| `npm run eval`        | 用自己的备份对比提示词改动前后的效果（会真实调用百炼，见决策 0019） |
| `npm run deploy`      | 构建并部署到 Cloudflare Workers                                     |
| `npm run app:release` | 打正式签名的安卓安装包                                              |

## 部署

部署到 Cloudflare Workers：`npm run deploy`（决策 0007、0008）。部署前先用 `wrangler secret put` 设置
`DASHSCOPE_API_KEY` 和 `ACCESS_TOKEN`。服务端按"IP + 接口"限流（决策 0018），配置在 `wrangler.jsonc` 的 `ratelimits`。
建议同时在阿里云控制台设一个费用预警。

## 安卓 App

需要 Android Studio（含 SDK）和 **JDK 21**（Android Studio 自带的 Java 25 对 Gradle 8.14 太新）。
`android/local.properties` 里写本机 SDK 路径（`sdk.dir=C:/Users/<你>/AppData/Local/Android/Sdk`），这个文件不提交。

- **本机语音识别**：`npm run app:sync` 会先跑 `npm run asr:assets`，下载 sherpa-onnx 安卓库（52 MB）和 SenseVoice 模型（解压后 239 MB），放进 `android/`（不提交）。安装包因此变大约 250 MB；不想要可以删掉 `android/app/libs/sherpa-onnx.aar` 和 `assets/sensevoice/`，App 会退回云端识别。
- **调试版**：`npm run app:sync`，然后在 `android/` 下运行 `JAVA_HOME=<JDK 21 路径> ./gradlew assembleDebug`。
- **正式版**（决策 0017）：
  1. 先用 `scripts/make_keystore.py` 生成签名密钥，只需一次，密钥放在仓库外。
  2. 设好 `JAVA_HOME` 后运行 `npm run app:release`。
  3. 安装包在 `android/app/build/outputs/apk/release/`。
- **版本号**只改 `package.json` 一处。

## 目录

- `src/`：前端（React）
- `server/`：无状态 AI 代理（Hono），只负责保管 API key 并转发请求
- `shared/`：前后端共用的请求和回复格式（Zod）
- `android/`：Capacitor 安卓外壳；`app/src/main/java/` 里有自己写的存相册插件
- `scripts/`：生成资源、图标、签名密钥的脚本
- `docs/decisions/`：架构决策记录

## 协议

代码用 [MIT](LICENSE) 协议。打包进 App 的数据、模型和字体各有自己的协议，见 [THIRD_PARTY.md](THIRD_PARTY.md)：
其中两份查表数据是 CC BY-SA 4.0，再分发时要保持同样的协议。
