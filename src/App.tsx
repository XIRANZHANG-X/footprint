import { useEffect, useState } from 'react'

type Health = { ok: boolean; aiConfigured: boolean }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">足迹手账</h1>
      <p className="mt-2 text-sm text-neutral-500">
        P0 脚手架 · 记录功能在 P1 加入
      </p>
      <p className="mt-6 text-sm">
        代理状态：
        {error
          ? '连不上（server 没启动？）'
          : health === null
            ? '检查中…'
            : health.aiConfigured
              ? '已连接，AI key 已配置'
              : '已连接，AI key 未配置'}
      </p>
    </main>
  )
}

export default App
