import type { JournalRecord, StoredPhoto } from '../db.ts'
import {
  coverCrop,
  gridSlots,
  paginate,
  photoSlots,
  wrapText,
  type Rect,
} from './layout.ts'
import { isStarCenter, STAR } from './pixelStar.ts'
import { recordBody } from './record.ts'

// 分享图完全在本地生成，不经过服务端（决策 0002）。
// 风格同 App（决策 0010）：方格底纸、粗描边、实心硬阴影、马卡龙色标签。
// 版式（决策 0014 第 3B 条）：
//   classic 原来的竖图（最多 4 张照片，正文太长会截断）
//   single  单张大图
//   grid    九宫格拼成一张（最多 9 张）
//   long    长图：正文不截断，照片竖着排，超过 MAX_PAGE_H 分成几张
//   set     发朋友圈用的多张图：第一张是标题和正文卡片，后面是照片原图
export const SHARE_W = 1080
export const SHARE_H = 1920
export const MAX_PAGE_H = 8000

export const LAYOUTS = ['classic', 'single', 'grid', 'long', 'set'] as const
export type ShareLayout = (typeof LAYOUTS)[number]
export const LAYOUT_NAMES: Record<ShareLayout, string> = {
  classic: '经典',
  single: '单张大图',
  grid: '九宫格',
  long: '长图',
  set: '朋友圈多图',
}

const PAD = 72
const BORDER = 6 // 描边粗细，相当于 App 里 2px 放大 3 倍
const SHADOW = 12 // 硬阴影偏移
const GRID = 48 // 底纸方格
const SANS =
  '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif'
// 像素字原生 12px，用 12 的整数倍画出来笔画才不糊
const PIXEL = `"Fusion Pixel", ${SANS}`
const TITLE_FONT = `72px ${PIXEL}`
const BODY_FONT = `400 40px ${SANS}`
const BODY_LINE = 62
const TAG_FONT = `36px ${PIXEL}`
const TAG_H = 64
const MAX_SET_PHOTOS = 8 // 朋友圈最多 9 张，第一张是文字卡片

// canvas 不认 CSS 变量，这里是 index.css 里同名 OKLCH 颜色换算成的十六进制
export const C = {
  paper: '#fffaf2',
  grid: '#efe8f4',
  card: '#ffffff',
  ink: '#2d2132',
  inkSoft: '#64586d',
  berry: '#fdd0e0',
  mint: '#c0f2db',
  lemon: '#fef1a1',
  sky: '#c7eaff',
  taro: '#decefd',
}

const dateFmt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' })

function shortPlace(placeName: string | null) {
  // "某某面馆（上海市 · 黄浦区 · 南京东路）" 在分享图上只留店名或第一段地址
  if (!placeName) return null
  return placeName.split('（')[0].split(' · ').slice(0, 2).join(' · ')
}

/** 像素字体在 CSS 里是 swap 加载的，画布用之前要等它真正下载好；失败就退回系统字体 */
async function ensurePixelFont() {
  try {
    await document.fonts.load('48px "Fusion Pixel"', '足迹')
  } catch {
    // 离线首装等情况下字体没加载成功，照样出图
  }
}

type Ctx = OffscreenCanvasRenderingContext2D

function newCanvas(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  return { canvas, ctx }
}

const toJpeg = (c: OffscreenCanvas) =>
  c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })

function paper(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = C.grid
  for (let x = 0; x < w; x += GRID) ctx.fillRect(x, 0, 3, h)
  for (let y = 0; y < h; y += GRID) ctx.fillRect(0, y, w, 3)
}

/** 卡片：先画右下错开的实心阴影，再画底色和描边 */
function card(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadow = SHADOW,
) {
  if (shadow) {
    ctx.fillStyle = C.ink
    ctx.fillRect(x + shadow, y + shadow, w, h)
  }
  ctx.fillStyle = C.ink
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = fill
  ctx.fillRect(x + BORDER, y + BORDER, w - BORDER * 2, h - BORDER * 2)
}

function star(ctx: Ctx, x: number, y: number, cell: number) {
  for (const [row, line] of STAR.entries()) {
    for (const [col, c] of [...line].entries()) {
      if (c !== '#') continue
      ctx.fillStyle = isStarCenter(col, row) ? C.berry : C.ink
      ctx.fillRect(x + col * cell, y + row * cell, cell, cell)
    }
  }
}

const measureWith = (ctx: Ctx, font: string) => (s: string) => {
  ctx.font = font
  return ctx.measureText(s).width
}

async function drawPhoto(ctx: Ctx, blob: Blob, dst: Rect) {
  const bitmap = await createImageBitmap(blob)
  const crop = coverCrop(bitmap.width, bitmap.height, dst.w, dst.h)
  ctx.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    dst.x,
    dst.y,
    dst.w,
    dst.h,
  )
  bitmap.close()
}

export type Tag = { label: string; fill: string }

// 一行小标签，从 x 开始排，排不下的丢掉
function drawTags(ctx: Ctx, tags: Tag[], x0: number, y: number) {
  let x = x0
  for (const t of tags) {
    ctx.font = TAG_FONT
    const w = Math.ceil(ctx.measureText(t.label).width) + 40
    if (x + w > SHARE_W - PAD) break
    card(ctx, x, y, w, TAG_H, t.fill, 0)
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'middle'
    ctx.fillText(t.label, x + 20, y + TAG_H / 2 + 2)
    ctx.textBaseline = 'alphabetic'
    x += w + 16
  }
}

// 落款：虚线分隔 + 小星星 + App 名，画在 bottom 之上 116 像素的位置
const FOOTER_H = 140
function footer(ctx: Ctx, bottom: number) {
  ctx.fillStyle = C.inkSoft
  for (let dx = PAD; dx < SHARE_W - PAD; dx += 24)
    ctx.fillRect(dx, bottom - 116, 12, 3)
  star(ctx, PAD, bottom - 84, 6)
  ctx.font = `36px ${PIXEL}`
  ctx.fillStyle = C.inkSoft
  ctx.fillText('足迹手账', PAD + 60, bottom - 52)
}

const recordTitle = (r: JournalRecord) =>
  r.content?.title ?? (r.note.slice(0, 16) || dateFmt.format(r.takenAt))

function infoTags(r: JournalRecord): Tag[] {
  const place = shortPlace(r.placeName)
  return [
    { label: dateFmt.format(r.takenAt), fill: C.card },
    ...(place ? [{ label: place, fill: C.sky }] : []),
  ]
}

const hashTags = (r: JournalRecord): Tag[] =>
  (r.content?.tags ?? []).map((t) => ({ label: `#${t}`, fill: C.mint }))

// ---------- 照片在上、文字在下的竖图：classic / single / grid ----------

type Frame = {
  maxPhotos: number
  slots: (n: number, inner: number, gap: number) => Rect[]
  // 照片框的高度（内部）：正方形，或按格子行数算
  innerH: (n: number, inner: number) => number
}

const FRAMES: Record<'classic' | 'single' | 'grid', Frame> = {
  classic: { maxPhotos: 4, slots: photoSlots, innerH: (_n, w) => w },
  single: {
    maxPhotos: 1,
    slots: (n, w) => (n ? [{ x: 0, y: 0, w, h: Math.round(w * 1.2) }] : []),
    innerH: (_n, w) => Math.round(w * 1.2),
  },
  grid: {
    maxPhotos: 9,
    slots: gridSlots,
    innerH: (n, w) => {
      const s = gridSlots(Math.max(n, 1), w, BORDER)
      const last = s[s.length - 1]
      return last.y + last.h
    },
  },
}

const BOX_W = SHARE_W - PAD * 2 - SHADOW
const TEXT_W = SHARE_W - PAD * 2

// 正文从哪一行开始、能放几行：自动选版式时也要用，所以单独算
function framedTextLayout(
  ctx: Ctx,
  frame: Frame,
  record: JournalRecord,
  photoCount: number,
) {
  const n = Math.min(photoCount, frame.maxPhotos)
  const innerW = BOX_W - BORDER * 2
  const boxH = frame.innerH(n, innerW) + BORDER * 2
  const tagsY = PAD + boxH + SHADOW + 64
  const titleLines = wrapText(
    recordTitle(record),
    TEXT_W,
    measureWith(ctx, TITLE_FONT),
    2,
  )
  const bodyY = tagsY + TAG_H + 88 + titleLines.length * 92 + 8
  const bodyBottom = SHARE_H - 240
  const maxLines = Math.max(1, Math.floor((bodyBottom - bodyY) / BODY_LINE))
  const allLines = wrapText(
    recordBody(record),
    TEXT_W,
    measureWith(ctx, BODY_FONT),
  )
  return { n, innerW, boxH, tagsY, titleLines, maxLines, allLines }
}

async function renderFramed(
  record: JournalRecord,
  photos: StoredPhoto[],
  frame: Frame,
): Promise<Blob> {
  const { canvas, ctx } = newCanvas(SHARE_W, SHARE_H)
  paper(ctx, SHARE_W, SHARE_H)
  const l = framedTextLayout(ctx, frame, record, photos.length)

  // 照片卡；照片之间露出描边色，像漫画分格
  card(ctx, PAD, PAD, BOX_W, l.boxH, l.n ? C.ink : C.lemon)
  for (const [i, slot] of frame.slots(l.n, l.innerW, BORDER).entries())
    await drawPhoto(ctx, photos[i].blob, {
      ...slot,
      x: PAD + BORDER + slot.x,
      y: PAD + BORDER + slot.y,
    })
  // 星星压在照片卡右上角
  star(ctx, PAD + BOX_W - 60, PAD - 36, 12)

  drawTags(ctx, infoTags(record), PAD, l.tagsY)
  let y = l.tagsY + TAG_H + 88
  ctx.fillStyle = C.ink
  for (const line of l.titleLines) {
    ctx.font = TITLE_FONT
    ctx.fillText(line, PAD, y)
    y += 92
  }
  y += 8

  // 正文用系统字体：长段像素字读着累（决策 0010）
  const lines = wrapText(
    recordBody(record),
    TEXT_W,
    measureWith(ctx, BODY_FONT),
    l.maxLines,
  )
  for (const line of lines) {
    ctx.font = BODY_FONT
    ctx.fillStyle = C.ink
    ctx.fillText(line, PAD, y)
    y += BODY_LINE
  }

  // 标签：薄荷绿，紧跟正文（正文短时不留大片空白），一行排不下的就不画了
  drawTags(
    ctx,
    hashTags(record),
    PAD,
    Math.min(y - BODY_LINE + 48, SHARE_H - 210),
  )
  footer(ctx, SHARE_H)
  return toJpeg(canvas)
}

// ---------- 长图：一块一块往下排，超过 MAX_PAGE_H 分页 ----------

// 长图的内容块。回顾页和出行总结也用它（决策 0014 第 3E 条）
export type DocBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; soft?: boolean }
  | { kind: 'tags'; tags: Tag[] }
  | { kind: 'photo'; blob: Blob; width: number; height: number }
  | { kind: 'photoGrid'; blobs: Blob[] }
  | { kind: 'gap'; h: number }

type Piece = { h: number; draw: (ctx: Ctx, y: number) => Promise<void> | void }

function toPieces(ctx: Ctx, blocks: DocBlock[]): Piece[] {
  const pieces: Piece[] = []
  const textLines = (
    text: string,
    font: string,
    lineH: number,
    color: string,
  ) => {
    for (const line of wrapText(text, TEXT_W, measureWith(ctx, font)))
      pieces.push({
        h: lineH,
        draw: (c, y) => {
          c.font = font
          c.fillStyle = color
          c.fillText(line, PAD, y + lineH * 0.72)
        },
      })
  }
  for (const b of blocks) {
    switch (b.kind) {
      case 'title':
        textLines(b.text, TITLE_FONT, 92, C.ink)
        pieces.push({ h: 24, draw: () => {} })
        break
      case 'heading':
        pieces.push({ h: 32, draw: () => {} })
        textLines(b.text, `48px ${PIXEL}`, 72, C.ink)
        break
      case 'text':
        textLines(b.text, BODY_FONT, BODY_LINE, b.soft ? C.inkSoft : C.ink)
        break
      case 'tags':
        if (b.tags.length)
          pieces.push({
            h: TAG_H + 32,
            draw: (c, y) => drawTags(c, b.tags, PAD, y),
          })
        break
      case 'photo': {
        // 照片按原比例排满宽度；特别长的竖图截到 1.5 倍宽
        const inner = BOX_W - BORDER * 2
        const h = Math.round(
          Math.min(inner * 1.5, (inner * b.height) / b.width),
        )
        pieces.push({
          h: h + BORDER * 2 + SHADOW + 40,
          draw: async (c, y) => {
            card(c, PAD, y, BOX_W, h + BORDER * 2, C.ink)
            await drawPhoto(c, b.blob, {
              x: PAD + BORDER,
              y: y + BORDER,
              w: inner,
              h,
            })
          },
        })
        break
      }
      case 'photoGrid': {
        if (!b.blobs.length) break
        const inner = BOX_W - BORDER * 2
        const slots = gridSlots(b.blobs.length, inner, BORDER)
        const last = slots[slots.length - 1]
        const h = last.y + last.h
        pieces.push({
          h: h + BORDER * 2 + SHADOW + 40,
          draw: async (c, y) => {
            card(c, PAD, y, BOX_W, h + BORDER * 2, C.ink)
            for (const [i, s] of slots.entries())
              await drawPhoto(c, b.blobs[i], {
                ...s,
                x: PAD + BORDER + s.x,
                y: y + BORDER + s.y,
              })
          },
        })
        break
      }
      case 'gap':
        pieces.push({ h: b.h, draw: () => {} })
        break
    }
  }
  return pieces
}

// 把内容块排成一张或几张 1080 宽的长图。minHeight：内容太短时也至少这么高
export async function renderDocument(
  blocks: DocBlock[],
  { minHeight = 0 }: { minHeight?: number } = {},
): Promise<Blob[]> {
  await ensurePixelFont()
  const measure = newCanvas(1, 1).ctx
  const pieces = toPieces(measure, blocks)
  const pages = paginate(
    pieces.map((p) => p.h),
    MAX_PAGE_H - PAD - FOOTER_H,
  )
  const out: Blob[] = []
  for (const [pi, idx] of pages.entries()) {
    const contentH = idx.reduce((s, i) => s + pieces[i].h, 0)
    const h = Math.max(minHeight, PAD + contentH + FOOTER_H)
    const { canvas, ctx } = newCanvas(SHARE_W, h)
    paper(ctx, SHARE_W, h)
    let y = PAD
    for (const i of idx) {
      await pieces[i].draw(ctx, y)
      y += pieces[i].h
    }
    if (pi === pages.length - 1) footer(ctx, h)
    else {
      ctx.font = `36px ${PIXEL}`
      ctx.fillStyle = C.inkSoft
      ctx.fillText(`接下一张 · ${pi + 1}/${pages.length}`, PAD, h - 52)
    }
    out.push(await toJpeg(canvas))
  }
  return out
}

function recordText(record: JournalRecord): DocBlock[] {
  return [
    { kind: 'tags', tags: infoTags(record) },
    { kind: 'gap', h: 24 },
    { kind: 'title', text: recordTitle(record) },
    { kind: 'text', text: recordBody(record) },
    { kind: 'gap', h: 24 },
    { kind: 'tags', tags: hashTags(record) },
  ]
}

async function renderLong(record: JournalRecord, photos: StoredPhoto[]) {
  return renderDocument([
    ...recordText(record),
    { kind: 'gap', h: 16 },
    ...photos.map((p): DocBlock => ({
      kind: 'photo',
      blob: p.blob,
      width: p.width,
      height: p.height,
    })),
  ])
}

// 朋友圈多图：文字卡片 + 照片原图（存储版，长边约 2048px）。卡片至少是正方形，九宫格缩略图裁得好看
async function renderSet(record: JournalRecord, photos: StoredPhoto[]) {
  const cardPages = await renderDocument(recordText(record), {
    minHeight: SHARE_W,
  })
  return [...cardPages, ...photos.slice(0, MAX_SET_PHOTOS).map((p) => p.blob)]
}

// 自动选版式（决策 0014 第 3B 条第 3 点）：1 张照片用单张大图；没照片或正文一屏放不下用长图；其余用经典
export async function pickLayout(
  record: JournalRecord,
  photoCount: number,
): Promise<ShareLayout> {
  if (photoCount === 0) return 'long'
  await ensurePixelFont()
  const ctx = newCanvas(1, 1).ctx
  const frame = photoCount === 1 ? FRAMES.single : FRAMES.classic
  const l = framedTextLayout(ctx, frame, record, photoCount)
  if (l.allLines.length > l.maxLines) return 'long'
  return photoCount === 1 ? 'single' : 'classic'
}

// 生成分享图。大多数版式是一张；长图可能分成几张，朋友圈多图是卡片加照片
export async function renderShare(
  record: JournalRecord,
  photos: StoredPhoto[],
  layout: ShareLayout,
): Promise<Blob[]> {
  await ensurePixelFont()
  switch (layout) {
    case 'long':
      return renderLong(record, photos)
    case 'set':
      return renderSet(record, photos)
    default:
      return [await renderFramed(record, photos, FRAMES[layout])]
  }
}
