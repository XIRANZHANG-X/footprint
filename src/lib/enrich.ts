import {
  MAX_AI_IMAGES,
  MAX_AVOID_WORDS,
  type DescribeMode,
} from '../../shared/ai.ts'
import { db, type RecordContent } from '../db.ts'
import { describe, geocode, placeLabel } from './ai.ts'
import { logEdit } from './editLog.ts'
import { unfaithfulBits } from './faithful.ts'
import { toAiDataUrl } from './image.ts'
import { styleForRequest, watchWords } from './preferences.ts'

const elapsed = (since: number) => Math.round(performance.now() - since)

export type EnrichOptions = {
  // 用户点"重新生成"时为 true，用新稿替换正文；否则保留用户已改过的正文
  overwrite?: boolean
  // full：完整整理；meta：正文用用户自己写的，只补标题、类别、标签（决策 0012）
  mode?: DescribeMode
  // 这次额外不要写的词：卡片上被标出来、用户点了"重写"的那些（决策 0016 第 4 条）
  avoid?: string[]
}

// 记录保存之后在后台补全：GPS → 地名，照片 + 原话 → 标题/正文/标签。
// 失败不影响记录本身（照片和原话已经存好了），只把状态标成 error，可以重试。
export async function enrichRecord(
  recordId: string,
  { overwrite = false, mode = 'full', avoid = [] }: EnrichOptions = {},
) {
  const record = await db.records.get(recordId)
  if (!record) return
  await db.records.update(recordId, { aiStatus: 'pending', aiError: null })

  try {
    const started = performance.now()

    // 查地名和缩小照片互不依赖，同时进行（决策 0013 第 5 条），并分别计时
    const lookupPlace = async () => {
      if (!record.location || record.placeName)
        return { placeName: record.placeName, city: undefined, ms: null }
      const t = performance.now()
      try {
        const g = await geocode(record.location.lat, record.location.lng)
        return { placeName: placeLabel(g), city: g.city, ms: elapsed(t) }
      } catch {
        // 地名查不到不影响生成正文
        return { placeName: null, city: undefined, ms: elapsed(t) }
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
    const [place, shrunk, style, watch] = await Promise.all([
      lookupPlace(),
      shrinkPhotos(),
      // 偏好说明每次都带；例子只在写正文时带（决策 0012）
      styleForRequest(mode === 'full'),
      watchWords(),
    ])
    const avoidWords = [
      ...new Set([...avoid, ...(style.avoidWords ?? [])]),
    ].slice(0, MAX_AVOID_WORDS)

    const modelStarted = performance.now()
    const draft = await describe({
      images: shrunk.images,
      note: record.note,
      // 文件时间不可靠，不告诉模型；拍摄时间和用户写下的时间可以
      takenAt: record.timeSource === 'file' ? undefined : record.takenAt,
      placeName: place.placeName,
      mode,
      ...style,
      avoidWords: avoidWords.length > 0 ? avoidWords : undefined,
    })
    const modelMs = elapsed(modelStarted)

    // 检查这次写的东西（决策 0016 第 4 条）：只补标题时只看标题，正文是用户自己的
    const flags = unfaithfulBits(
      { title: draft.title, intro: mode === 'meta' ? '' : draft.intro },
      { note: record.note, placeName: place.placeName },
      watch,
    )

    const meta = {
      title: draft.title,
      category: draft.category,
      tags: draft.tags,
    }
    await db.records.update(recordId, {
      // 只有这次真的按 GPS 查到了地名才写。AI 从照片里猜的地点不再当成真的，
      // 只存成一个候选，用户点了才用（决策 0013 第 2 条）
      ...(place.ms !== null && place.placeName
        ? { placeName: place.placeName }
        : {}),
      // 地名查询顺带给出的城市（决策 0014 第 3C 条）；旧版服务端没有这个字段时不写，由后台从地名里拆
      ...(place.city !== undefined ? { geoCity: place.city } : {}),
      placeGuess: draft.placeGuess,
      aiStatus: 'done',
      photosChanged: false,
      // 没有要提醒的就把字段删掉（undefined 在 Dexie 里等于删除）
      aiFlags: flags.length > 0 ? flags : undefined,
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
            ...(overwrite || !record.content
              ? record.note.trim()
                ? // 用户自己也写了内容：两版并排，等用户选一版（决策 0012 第 3 条）
                  { choosing: true }
                : // 用户什么都没写：只有 AI 这一版
                  { bodySource: 'ai' as const, choosing: false }
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

// 保存编辑页的内容，同时记下"AI 原稿 → 改后的版本"供以后学习（决策 0012）。
// body 是编辑页里的正文：记录用的是自己写的那一版时改的是原话，否则改的是 AI 的正文。
// note：正文是 AI 那一版时，编辑页另有一栏可以改原话；不传就不动
export function saveContent(
  recordId: string,
  content: RecordContent,
  body: string,
  note?: string,
) {
  return db.transaction('rw', db.records, db.edits, async () => {
    const record = await db.records.get(recordId)
    if (!record) return
    if (record.bodySource === 'own') {
      // AI 写的那一版（content.intro）原样留着，以后还能换回去
      await db.records.update(recordId, {
        note: body,
        content: { ...content, intro: record.content?.intro ?? '' },
      })
      return
    }
    const next = { ...content, intro: body }
    // 这次保存没动标题和正文（比如只改了时间或地名）就不记：否则会被当成一次"改动 0%"的修改
    const textChanged =
      next.title !== record.content?.title ||
      next.intro !== record.content?.intro
    await db.records.update(recordId, {
      content: next,
      ...(note === undefined ? {} : { note: note.trim() }),
      // 用户自己改过标题或正文，AI 写的那些提醒就过时了
      ...(textChanged ? { aiFlags: undefined } : {}),
    })
    if (record.aiDraft && textChanged)
      await logEdit(recordId, record.aiDraft, next)
  })
}

// 在"我写的"和"AI 写的"之间选一版当正文（决策 0012 第 3 条）。text 是用户在那一版上改完的文字。
// 没选中的那一版不动，之后可以换回来
export function chooseBody(
  recordId: string,
  source: 'own' | 'ai',
  text: string,
) {
  return db.transaction('rw', db.records, db.edits, async () => {
    const record = await db.records.get(recordId)
    if (!record) return
    const content = record.content
    if (source === 'own') {
      await db.records.update(recordId, {
        note: text,
        bodySource: 'own',
        choosing: false,
        // 不用 AI 写的正文了，针对它的提醒也就不需要了
        aiFlags: undefined,
      })
      // 放弃 AI 版本是最强的"不满意"信号，记下来
      if (record.aiDraft && content)
        await logEdit(
          recordId,
          record.aiDraft,
          { ...content, intro: text },
          'choseOwn',
        )
      return
    }
    if (!content) return
    const next = { ...content, intro: text }
    await db.records.update(recordId, {
      content: next,
      bodySource: 'ai',
      choosing: false,
    })
    if (record.aiDraft) await logEdit(recordId, record.aiDraft, next)
  })
}

// 离线时保存的记录（决策 0027 第 4 条）：先标成 queued，能连上服务端时按记录的时间先后整理
export function queueEnrich(recordId: string, mode: DescribeMode) {
  return db.records.update(recordId, {
    aiStatus: 'queued',
    aiQueued: mode,
    aiError: null,
  })
}

export function cancelQueued(recordId: string) {
  return db.records.update(recordId, { aiStatus: 'none', aiQueued: undefined })
}

let draining: Promise<number> | null = null

// 一条一条整理，不并发（手机上同时传几张大图很慢，也容易被限流）。
// 整理中途又断网了：这条放回队列，剩下的等下次。返回整理了几条
export function drainQueue(
  run: (id: string, mode: DescribeMode) => Promise<void> = (id, mode) =>
    enrichRecord(id, { mode }),
  online: () => boolean = () => navigator.onLine,
): Promise<number> {
  draining ??= (async () => {
    let done = 0
    try {
      for (;;) {
        const next = (await db.records.orderBy('takenAt').toArray()).find(
          (r) => r.aiStatus === 'queued',
        )
        if (!next) break
        const mode = next.aiQueued ?? 'full'
        await run(next.id, mode)
        const after = await db.records.get(next.id)
        if (after?.aiStatus === 'error' && !online()) {
          await queueEnrich(next.id, mode)
          break
        }
        if (after?.aiStatus === 'queued') break // run 没动它，避免死循环
        await db.records.update(next.id, { aiQueued: undefined })
        done++
      }
    } finally {
      draining = null
    }
    return done
  })()
  return draining
}
