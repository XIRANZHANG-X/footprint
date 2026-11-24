import { coverCrop } from './layout.ts'
import { C, drawRouteSketch } from './shareImage.ts'
import type { TripMaterial } from './tripBook.ts'

// 路线回放和行程短视频（决策 0025）：同一段动画。
// 先把路线一点点画出来，再一站一张照片（带标题和日期），最后落款。没有配乐：要用有授权的曲库，先不做。
// 回放直接在画布上播；保存成视频用浏览器自带的录制（MediaRecorder），能录 MP4 就录 MP4，不能就录 WebM

export const REEL_W = 720
export const REEL_H = 1280
const ROUTE_S = 4
const SLIDE_S = 2.2
const END_S = 1.5
const MAX_SLIDES = 12
const PIXEL = '"Fusion Pixel", system-ui, sans-serif'

const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
})

export type ReelData = {
  title: string
  stats: string
  sketch: TripMaterial['sketch']
  slides: { bitmap: ImageBitmap | null; title: string; date: string }[]
}

export async function loadReel(m: TripMaterial): Promise<ReelData> {
  try {
    await document.fonts.load(`40px ${PIXEL}`, '足迹')
  } catch {
    // 字体没加载上就用系统字体
  }
  const slides: ReelData['slides'] = []
  for (const r of m.records.slice(0, MAX_SLIDES)) {
    const photo = m.photos.get(r.id)?.[0]
    let bitmap: ImageBitmap | null = null
    if (photo)
      try {
        bitmap = await createImageBitmap(photo.blob)
      } catch {
        bitmap = null
      }
    slides.push({
      bitmap,
      title: r.content?.title ?? (r.note.trim().slice(0, 14) || '一条记录'),
      date: dayFmt.format(r.takenAt),
    })
  }
  return { title: m.title, stats: m.stats, sketch: m.sketch, slides }
}

export const reelSeconds = (d: ReelData) =>
  ROUTE_S + d.slides.length * SLIDE_S + END_S

function paper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, REEL_W, REEL_H)
  ctx.fillStyle = C.grid
  for (let x = 0; x < REEL_W; x += 32) ctx.fillRect(x, 0, 2, REEL_H)
  for (let y = 0; y < REEL_H; y += 32) ctx.fillRect(0, y, REEL_W, 2)
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string = C.ink,
) {
  ctx.font = `${size}px ${PIXEL}`
  ctx.fillStyle = color
  ctx.fillText(s, x, y)
}

export function drawReelFrame(
  ctx: CanvasRenderingContext2D,
  d: ReelData,
  t: number,
) {
  paper(ctx)
  if (t < ROUTE_S) {
    text(ctx, d.title, 48, 120, 52)
    text(ctx, d.stats, 48, 180, 28, C.inkSoft)
    drawRouteSketch(
      ctx,
      d.sketch,
      { x: 24, y: 230, w: REEL_W - 48, h: REEL_H - 330 },
      Math.min(1, t / (ROUTE_S - 0.6)),
    )
    return
  }
  const i = Math.floor((t - ROUTE_S) / SLIDE_S)
  if (i < d.slides.length) {
    const s = d.slides[i]
    const local = (t - ROUTE_S - i * SLIDE_S) / SLIDE_S
    if (s.bitmap) {
      // 慢慢推近一点，照片不至于是死的
      const zoom = 1 + 0.06 * local
      const w = REEL_W * zoom
      const h = REEL_H * zoom
      const crop = coverCrop(s.bitmap.width, s.bitmap.height, w, h)
      ctx.drawImage(
        s.bitmap,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        (REEL_W - w) / 2,
        (REEL_H - h) / 2,
        w,
        h,
      )
    }
    // 底部一条卡片：第几站、标题、日期
    ctx.fillStyle = C.ink
    ctx.fillRect(36, REEL_H - 236, REEL_W - 60, 180)
    ctx.fillStyle = C.paper
    ctx.fillRect(30, REEL_H - 242, REEL_W - 60, 180)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 4
    ctx.strokeRect(30, REEL_H - 242, REEL_W - 60, 180)
    text(ctx, `${i + 1}`, 60, REEL_H - 170, 40, C.inkSoft)
    text(ctx, s.title.slice(0, 14), 120, REEL_H - 170, 44)
    text(ctx, s.date, 120, REEL_H - 110, 30, C.inkSoft)
    return
  }
  text(ctx, d.title, 48, REEL_H / 2 - 20, 56)
  text(ctx, d.stats, 48, REEL_H / 2 + 40, 28, C.inkSoft)
  text(ctx, '足迹手账', 48, REEL_H - 80, 32, C.inkSoft)
}

// 在画布上播放；返回停止的函数
export function playReel(
  canvas: HTMLCanvasElement,
  d: ReelData,
  onEnd?: () => void,
): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const total = reelSeconds(d)
  const start = performance.now()
  let raf = 0
  const frame = () => {
    const t = (performance.now() - start) / 1000
    drawReelFrame(ctx, d, Math.min(t, total))
    if (t < total) raf = requestAnimationFrame(frame)
    else onEnd?.()
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}

const MIME = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
]

export function videoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

// 一边播一边录，录完返回视频文件。要实时播完一遍，所以要等动画那么长的时间
export async function recordReel(
  canvas: HTMLCanvasElement,
  d: ReelData,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const mime = videoMime()
  if (!mime) throw new Error('这个浏览器不支持录视频')
  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 4_000_000,
  })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
  })
  rec.start(500)
  await new Promise<void>((resolve) => playReel(canvas, d, resolve))
  // 最后一帧多留一会儿再停，免得结尾被截掉
  await new Promise((r) => setTimeout(r, 300))
  rec.stop()
  await done
  stream.getTracks().forEach((t) => t.stop())
  const type = mime.split(';')[0]
  return {
    blob: new Blob(chunks, { type }),
    ext: type === 'video/mp4' ? 'mp4' : 'webm',
  }
}
