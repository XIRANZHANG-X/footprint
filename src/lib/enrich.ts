import { MAX_AI_IMAGES } from '../../shared/ai.ts'
import { db, type RecordContent } from '../db.ts'
import { describe, geocode, placeLabel } from './ai.ts'
import { toAiDataUrl } from './image.ts'

// 记录保存之后在后台补全：GPS → 地名，照片 + 原话 → 标题/正文/标签。
// 失败不影响记录本身（照片和原话已经存好了），只把状态标成 error，可以重试。
// overwrite：用户点"重新生成"时为 true，用新稿替换正文；否则保留用户已改过的正文
export async function enrichRecord(recordId: string, overwrite = false) {
  const record = await db.records.get(recordId)
  if (!record) return
  await db.records.update(recordId, { aiStatus: 'pending', aiError: null })

  try {
    let placeName = record.placeName
    if (record.location && !placeName) {
      try {
        const g = await geocode(record.location.lat, record.location.lng)
        placeName = placeLabel(g)
      } catch {
        // 地名查不到不影响生成正文
      }
    }

    const photos = await db.photos
      .where('recordId')
      .equals(recordId)
      .sortBy('order')
    const images = await Promise.all(
      photos.slice(0, MAX_AI_IMAGES).map((p) => toAiDataUrl(p.blob)),
    )
    const draft = await describe({
      images,
      note: record.note,
      takenAt: record.timeSource === 'exif' ? record.takenAt : undefined,
      placeName,
    })

    await db.records.update(recordId, {
      placeName: placeName ?? draft.placeGuess,
      aiDraft: draft,
      content:
        overwrite || !record.content ? pickContent(draft) : record.content,
      aiStatus: 'done',
    })
  } catch (e) {
    await db.records.update(recordId, {
      aiStatus: 'error',
      aiError: e instanceof Error ? e.message : String(e),
    })
  }
}

// App 启动时调用一次：上次整理到一半就被关掉的记录，后台任务已经不在了，
// 状态却还停在"整理中"（界面上没有重试按钮）。改成失败，让用户可以点"重新生成"（决策 0011）
export function recoverInterrupted() {
  return db.records
    .filter((r) => r.aiStatus === 'pending')
    .modify({ aiStatus: 'error', aiError: '上次整理被打断了，请重新生成' })
}

function pickContent(d: RecordContent): RecordContent {
  return { title: d.title, category: d.category, intro: d.intro, tags: d.tags }
}

export function saveContent(recordId: string, content: RecordContent) {
  return db.records.update(recordId, { content })
}
