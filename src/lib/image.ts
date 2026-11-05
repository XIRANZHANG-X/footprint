// 存储用的压缩版和列表用的缩略图（见决策 0005：原图会撑爆浏览器存储配额）
export const STORED_LONG_EDGE = 2048
export const THUMB_LONG_EDGE = 400
// 发给视觉模型的尺寸：百炼按 28×28 像素约 1 token 计费，768px 一张约 560 token
export const AI_LONG_EDGE = 768

export function fitWithin(width: number, height: number, maxLongEdge: number) {
  const scale = Math.min(1, maxLongEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function encode(
  bitmap: ImageBitmap,
  maxLongEdge: number,
  quality: number,
) {
  const size = fitWithin(bitmap.width, bitmap.height, maxLongEdge)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return { blob, ...size }
}

export type CompressedPhoto = {
  blob: Blob
  thumb: Blob
  width: number
  height: number
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  // from-image：按 EXIF 方向转正，否则竖拍的照片会横着存
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })
  try {
    const stored = await encode(bitmap, STORED_LONG_EDGE, 0.85)
    const thumb = await encode(bitmap, THUMB_LONG_EDGE, 0.8)
    return {
      blob: stored.blob,
      thumb: thumb.blob,
      width: stored.width,
      height: stored.height,
    }
  } finally {
    bitmap.close()
  }
}

// 把已存的照片缩小后转成 data URL，供视觉模型使用（照片只在请求时临时发出，服务端不存）
export async function toAiDataUrl(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { blob: small } = await encode(bitmap, AI_LONG_EDGE, 0.8)
    return await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(small)
    })
  } finally {
    bitmap.close()
  }
}
