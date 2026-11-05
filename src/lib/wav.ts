// 把录音转成 16kHz 单声道 16-bit PCM WAV。
// 浏览器录出来的通常是 webm/opus，百炼文档只给了 WAV/MP3 的示例，WAV 最稳妥；
// 一句话 10 秒约 320KB，远低于 10MB 的上限。
export const TARGET_SAMPLE_RATE = 16_000

// 简单的区间平均降采样：语音识别只需要 8kHz 以下的频率，够用且没有依赖
export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (toRate >= fromRate) return input
  const ratio = fromRate / toRate
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const ch of channels)
    for (let i = 0; i < out.length; i++) out[i] += ch[i]
  for (let i = 0; i < out.length; i++) out[i] /= channels.length
  return out
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt 块长度
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 单声道
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // 字节率 = 采样率 × 2 字节
  v.setUint16(32, 2, true) // 每个采样帧 2 字节
  v.setUint16(34, 16, true) // 16 位
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}
