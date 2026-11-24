// 最小的 PDF：每页一张 JPEG 铺满（决策 0025 的 PDF 手账）。
// PDF 可以直接嵌 JPEG（DCTDecode），不用重新编码，也不用引入 PDF 库。
// 页面是 A5（148 × 210 毫米 = 420 × 595 点），图片按比例放进去，居中。

export type PdfImage = { jpeg: Blob; width: number; height: number }

const A5 = { w: 419.53, h: 595.28 }

export async function imagesToPdf(images: PdfImage[]): Promise<Blob> {
  const enc = new TextEncoder()
  const parts: BlobPart[] = []
  const offsets: number[] = []
  let size = 0
  const push = (p: string | Blob) => {
    if (typeof p === 'string') {
      const b = enc.encode(p)
      parts.push(b)
      size += b.length
    } else {
      parts.push(p)
      size += p.size
    }
  }
  const obj = (n: number, body: string) => {
    offsets[n] = size
    push(`${n} 0 obj\n${body}\nendobj\n`)
  }

  push('%PDF-1.4\n%âãÏÓ\n')
  // 1 目录，2 页树，之后每页三个对象：页面、图片、内容
  const pageIds = images.map((_, i) => 3 + i * 3)
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>`,
  )
  for (const [i, img] of images.entries()) {
    const page = pageIds[i]
    const image = page + 1
    const content = page + 2
    const scale = Math.min(A5.w / img.width, A5.h / img.height)
    const w = img.width * scale
    const h = img.height * scale
    const x = (A5.w - w) / 2
    const y = (A5.h - h) / 2
    obj(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A5.w} ${A5.h}] ` +
        `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`,
    )
    offsets[image] = size
    push(
      `${image} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.size} >>\nstream\n`,
    )
    push(img.jpeg)
    push('\nendstream\nendobj\n')
    const draw = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`
    obj(content, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
  }
  const count = 3 + images.length * 3
  const xref = size
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++)
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}
