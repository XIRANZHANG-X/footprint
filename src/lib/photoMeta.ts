export type LatLng = { lat: number; lng: number }

// 时间来源：exif = 照片拍摄时间；file = 拿不到拍摄时间时退回文件修改时间（不可靠，界面上要标出来）
export type TimeSource = 'exif' | 'file'

export type PhotoMeta = {
  takenAt: number // epoch ms
  timeSource: TimeSource
  location: LatLng | null
}

// exifr.parse(file, { gps: true }) 返回的字段里我们关心的部分；照片没有 EXIF 时 exifr 返回 undefined
export type RawExif =
  | {
      DateTimeOriginal?: unknown
      CreateDate?: unknown
      latitude?: unknown
      longitude?: unknown
    }
  | undefined

function validDate(v: unknown): number | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.getTime() : null
}

export function validLocation(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // 有些手机在没定位成功时会写入 (0, 0)，那是几内亚湾的海面，按"没有地点"处理
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

export function normalizeExif(
  raw: RawExif,
  fileLastModified: number,
): PhotoMeta {
  const exifTime =
    validDate(raw?.DateTimeOriginal) ?? validDate(raw?.CreateDate)
  return {
    takenAt: exifTime ?? fileLastModified,
    timeSource: exifTime === null ? 'file' : 'exif',
    location: validLocation(raw?.latitude, raw?.longitude),
  }
}
