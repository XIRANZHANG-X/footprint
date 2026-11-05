// 存储用的压缩版和列表用的缩略图（见决策 0005：原图会撑爆浏览器存储配额）
export const STORED_LONG_EDGE = 2048
export const THUMB_LONG_EDGE = 400

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
