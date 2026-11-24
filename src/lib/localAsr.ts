import { registerPlugin } from '@capacitor/core'
import { db } from '../db.ts'
import { transcribe } from './ai.ts'
import { inNativeApp } from './reminder.ts'

// 语音识别走本机还是云端（决策 0027）。
// 本机：sherpa-onnx + SenseVoice，只有安卓 App 有，不联网、不花钱；云端：百炼 qwen3-asr-flash（原来的做法）。
// 默认本机；本机识别失败、而云端能用时退回云端

// android/app/src/main/java/.../LocalAsrPlugin.java
const LocalAsr = registerPlugin<{
  status(): Promise<{ available: boolean; loaded: boolean }>
  transcribe(o: { wav: string }): Promise<{
    text: string
    ms: number
    loadMs: number
    seconds: number
  }>
}>('LocalAsr')

export const ASR_KEY = 'asrMode'
export type AsrMode = 'local' | 'cloud'

let available: Promise<boolean> | null = null
export function localAsrAvailable(): Promise<boolean> {
  if (!inNativeApp()) return Promise.resolve(false)
  available ??= LocalAsr.status()
    .then((s) => s.available)
    .catch(() => false)
  return available
}

export async function asrMode(): Promise<AsrMode> {
  return (
    ((await db.settings.get(ASR_KEY))?.value as AsrMode | undefined) ?? 'local'
  )
}

// dataUrl：录音得到的 data:audio/wav;base64,…
export async function transcribeAny(
  dataUrl: string,
  cloudReady: boolean,
): Promise<{ text: string; via: 'local' | 'cloud' }> {
  const useLocal = (await asrMode()) === 'local' && (await localAsrAvailable())
  if (useLocal) {
    try {
      const r = await LocalAsr.transcribe({ wav: dataUrl.split(',')[1] ?? '' })
      return { text: r.text, via: 'local' }
    } catch (e) {
      if (!cloudReady) throw e
    }
  }
  if (!cloudReady) throw new Error('现在连不上服务端，也没有本机语音模型')
  return { text: await transcribe(dataUrl), via: 'cloud' }
}
