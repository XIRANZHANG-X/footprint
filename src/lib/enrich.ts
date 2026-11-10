import { MAX_AI_IMAGES, type DescribeMode } from '../../shared/ai.ts'
import { db, type RecordContent } from '../db.ts'
import { describe, geocode, placeLabel } from './ai.ts'
import { logEdit } from './editLog.ts'
import { toAiDataUrl } from './image.ts'

const elapsed = (since: number) => Math.round(performance.now() - since)

export type EnrichOptions = {
  // 用户点"重新生成"时为 true，用新稿替换正文；否则保留用户已改过的正文
  overwrite?: boolean
  // full：完整整理；meta：正文用用户自己写的，只补标题、类别、标签（决策 0012）
  mode?: DescribeMode
}

// 记录保存之后在后台补全：GPS → 地名，照片 + 原话 → 标题/正文/标签。
// 失败不影响记录本身（照片和原话已经存好了），只把状态标成 error，可以重试。
export async function enrichRecord(
  recordId: string,
  { overwrite = false, mode = 'full' }: EnrichOptions = {},
) {
  const record = await db.records.get(recordId)
  if (!record) return
  await db.records.update(recordId, { aiStatus: 'pending', aiError: null })

  try {
    const started = performance.now()

    // 查地名和缩小照片互不依赖，同时进行（决策 0013 第 5 条），并分别计时
    const lookupPlace = async () => {
      if (!record.location || record.placeName)
        return { placeName: record.placeName, ms: null }
      const t = performance.now()
      try {
        const g = await geocode(record.location.lat, record.location.lng)
        return { placeName: placeLabel(g), ms: elapsed(t) }
      } catch {
        // 地名查不到不影响生成正文
        return { placeName: null, ms: elapsed(t) }
      }
    }
    const shrinkPhotos = async () => {
      const t = performance.now()
      const photos = await db.photos
        .where('recordId')
        .equals(recordId)
        .sortBy('order')
      const images = await Promise.all(
        photos.slice(0, MAX_AI_IMAGES).map((p) => toAiDataUrl(p.blob)),
      )
      return { images, ms: elapsed(t) }
    }
    const [place, shrunk] = await Promise.all([lookupPlace(), shrinkPhotos()])

    const modelStarted = performance.now()
    const draft = await describe({
      images: shrunk.images,
      note: record.note,
      takenAt: record.timeSource === 'exif' ? record.takenAt : undefined,
      placeName: place.placeName,
      mode,
    })
    const modelMs = elapsed(modelStarted)

    const meta = {
      title: draft.title,
      category: draft.category,
      tags: draft.tags,
    }
    await db.records.update(recordId, {
      placeName: place.placeName ?? draft.placeGuess,
      placeGuess: draft.placeGuess,
      aiStatus: 'done',
      aiTimings: {
        mode,
        geocodeMs: place.ms,
        imagesMs: shrunk.ms,
        modelMs,
        totalMs: elapsed(started),
      },
      ...(mode === 'meta'
        ? // 只补标题、类别、标签：AI 写的正文（如果以前生成过）和 AI 原稿都不动
          { content: { ...meta, intro: record.content?.intro ?? '' } }
        : {
            aiDraft: draft,
            content:
              overwrite || !record.content
                ? pickContent(draft)
                : record.content,
            // 第一次整理或重新生成后，显示的是 AI 这一版
            ...(overwrite || !record.content
              ? { bodySource: 'ai' as const }
              : {}),
          }),
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

// 保存用户改过的正文，同时记下"AI 原稿 → 改后的版本"供以后学习（决策 0012）
export function saveContent(recordId: string, content: RecordContent) {
  return db.transaction('rw', db.records, db.edits, async () => {
    const record = await db.records.get(recordId)
    if (!record) return
    await db.records.update(recordId, { content })
    if (record.aiDraft) await logEdit(recordId, record.aiDraft, content)
  })
}
