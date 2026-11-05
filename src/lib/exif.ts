import exifr from 'exifr'
import { normalizeExif, type PhotoMeta, type RawExif } from './photoMeta.ts'

export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  let raw: RawExif
  try {
    raw = await exifr.parse(file, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'GPSLatitude',
        'GPSLongitude',
        'GPSLatitudeRef',
        'GPSLongitudeRef',
      ],
      gps: true,
    })
  } catch {
    // 格式不支持或文件损坏：当作没有元数据处理，不阻断导入
    raw = undefined
  }
  return normalizeExif(raw, file.lastModified)
}
