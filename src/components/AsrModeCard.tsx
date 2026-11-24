import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db } from '../db.ts'
import { ASR_KEY, localAsrAvailable, type AsrMode } from '../lib/localAsr.ts'

// 语音识别走本机还是云端（决策 0027）。只在有本机语音模型的安卓 App 里显示
export function AsrModeCard() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    void localAsrAvailable().then(setAvailable)
  }, [])
  const mode =
    useLiveQuery(
      async () =>
        ((await db.settings.get(ASR_KEY))?.value as AsrMode | undefined) ??
        'local',
    ) ?? 'local'
  if (!available) return null
  const pick = (m: AsrMode) => void db.settings.put({ key: ASR_KEY, value: m })
  return (
    <div className="px-card p-3 text-sm">
      <p className="px-title text-[16px]">语音识别</p>
      <div className="mt-2 space-y-1">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="asr"
            className="accent-ink"
            checked={mode === 'local'}
            onChange={() => pick('local')}
          />
          本机（不联网、不花钱，录音不离开手机）
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="asr"
            className="accent-ink"
            checked={mode === 'cloud'}
            onChange={() => pick('cloud')}
          />
          云端（阿里云百炼）
        </label>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">
        本机识别第一次要加载模型，会慢几秒。本机识别出错、而能连上服务端时，自动改用云端。
      </p>
      <p className="mt-1 text-[11px] text-ink-soft">
        本机模型：SenseVoice-Small，阿里巴巴通义实验室（FunAudioLLM），FunASR
        模型开源协议；用 sherpa-onnx（Apache-2.0）运行。
      </p>
    </div>
  )
}
