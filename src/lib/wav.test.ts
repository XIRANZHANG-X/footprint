import { describe, expect, it } from 'vitest'
import { downsample, encodeWav, mixToMono } from './wav.ts'

describe('encodeWav', () => {
  it('writes a valid 16 kHz mono 16-bit PCM header', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16_000)
    const v = new DataView(buf)
    const ascii = (o: number) =>
      String.fromCharCode(...new Uint8Array(buf, o, 4))
    expect(ascii(0)).toBe('RIFF')
    expect(ascii(8)).toBe('WAVE')
    expect(ascii(36)).toBe('data')
    expect(v.getUint16(22, true)).toBe(1) // channels
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(8) // 4 samples × 2 bytes
    expect(buf.byteLength).toBe(44 + 8)
  })

  it('clips and scales samples to int16', () => {
    const v = new DataView(encodeWav(new Float32Array([1, -1, 2, -2]), 16_000))
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
    expect(v.getInt16(48, true)).toBe(32767)
    expect(v.getInt16(50, true)).toBe(-32768)
  })
})

describe('downsample', () => {
  it('averages 48 kHz down to 16 kHz (3:1)', () => {
    const out = downsample(
      new Float32Array([0, 0.3, 0.6, 1, 1, 1]),
      48_000,
      16_000,
    )
    expect(Array.from(out)).toEqual([expect.closeTo(0.3), 1])
  })

  it('leaves audio untouched when it is already at or below the target rate', () => {
    const input = new Float32Array([0.1, 0.2])
    expect(downsample(input, 16_000, 16_000)).toBe(input)
  })
})

describe('mixToMono', () => {
  it('averages channels', () => {
    expect(
      Array.from(
        mixToMono([new Float32Array([1, 0]), new Float32Array([0, 0])]),
      ),
    ).toEqual([0.5, 0])
  })
})
