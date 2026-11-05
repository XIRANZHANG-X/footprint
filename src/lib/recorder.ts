import { TARGET_SAMPLE_RATE, downsample, encodeWav, mixToMono } from './wav.ts'

export const MAX_RECORD_SECONDS = 60

export type Recording = { stop: () => Promise<string>; cancel: () => void }

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function toWavDataUrl(recorded: Blob): Promise<string> {
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(await recorded.arrayBuffer())
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
      audio.getChannelData(i),
    )
    const mono = downsample(
      mixToMono(channels),
      audio.sampleRate,
      TARGET_SAMPLE_RATE,
    )
    const wav = new Blob([encodeWav(mono, TARGET_SAMPLE_RATE)], {
      type: 'audio/wav',
    })
    return blobToDataUrl(wav)
  } finally {
    void ctx.close()
  }
}

// 开始录音；stop() 返回 data:audio/wav;base64,... 。录音需要安全上下文（HTTPS 或 localhost）。
export async function startRecording(
  onAutoStop?: () => void,
): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop()) // 释放麦克风，状态栏的录音标志才会消失
      resolve(new Blob(chunks, { type: recorder.mimeType }))
    }
  })
  recorder.start()
  const timer = setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop()
      onAutoStop?.()
    }
  }, MAX_RECORD_SECONDS * 1000)

  return {
    async stop() {
      clearTimeout(timer)
      if (recorder.state === 'recording') recorder.stop()
      return toWavDataUrl(await stopped)
    },
    cancel() {
      clearTimeout(timer)
      if (recorder.state === 'recording') recorder.stop()
    },
  }
}
