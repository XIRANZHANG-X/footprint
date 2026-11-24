import { describe, expect, it } from 'vitest'
import { imagesToPdf } from './pdf.ts'

// 决策 0025：PDF 手账。检查结构对得上：每个对象的位置和 xref 表里记的一致
describe('pdf', () => {
  it('writes a valid xref pointing at every object', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])])
    const pdf = await imagesToPdf([
      { jpeg, width: 1080, height: 1527 },
      { jpeg, width: 1080, height: 1527 },
    ])
    const bytes = new Uint8Array(await pdf.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const start = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const rows = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(
      (m) => Number(m[1]),
    )
    expect(rows).toHaveLength(8) // 目录、页树、两页各三个
    rows.forEach((off, i) =>
      expect(
        text.slice(off).startsWith(`${i + 1} 0 obj
`),
      ).toBe(true),
    )
    expect(text).toContain('/Count 2')
  })
})
