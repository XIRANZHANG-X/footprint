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

## 目录

- `src/`：前端（React）
- `server/`：无状态 AI 代理（Hono），只负责保管 API key 并转发请求
- `docs/decisions/`：架构决策记录
