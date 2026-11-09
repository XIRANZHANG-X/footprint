import { useState, type FormEvent } from 'react'
import { tryAccessToken, type AiState } from '../lib/ai.ts'

// 部署到公网后，AI 接口要访问口令（决策 0008）。
// 不挡住整个 App：没有口令时照样能导入照片、看时间线和地图，只是不能用 AI。
export function AccessGate({ onResult }: { onResult: (s: AiState) => void }) {
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [wrong, setWrong] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setChecking(true)
    setWrong(false)
    const state = await tryAccessToken(token)
    setChecking(false)
    if (state === 'needsToken') setWrong(true)
    else onResult(state)
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="px-card mt-4 bg-sky p-3 text-sm"
    >
      <p>
        输入访问口令后可以使用语音识别和 AI 整理。只需输入一次，这台设备会记住。
      </p>
      <div className="mt-3 flex gap-3">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="访问口令"
          autoComplete="off"
          className="px-input min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={checking}
          aria-busy={checking}
          className="px-btn bg-berry"
        >
          {checking ? '验证中…' : '确定'}
        </button>
      </div>
      {wrong && <p className="mt-2 text-cherry">口令不对，请再检查一下。</p>}
    </form>
  )
}
