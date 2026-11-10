import type { JournalRecord, StoredPhoto } from '../db.ts'
import { coverCrop, photoSlots, wrapText } from './layout.ts'
import { isStarCenter, STAR } from './pixelStar.ts'
import { recordBody } from './record.ts'

// 1080×1920 竖图（手机全屏比例），完全在本地生成，不经过服务端（决策 0002）
// 风格同 App（决策 0010）：方格底纸、粗描边、实心硬阴影、马卡龙色标签
export const SHARE_W = 1080
export const SHARE_H = 1920

const PAD = 72
const BORDER = 6 // 描边粗细，相当于 App 里 2px 放大 3 倍
const SHADOW = 12 // 硬阴影偏移
const GRID = 48 // 底纸方格
const SANS =
  '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif'
// 像素字原生 12px，用 12 的整数倍画出来笔画才不糊
const PIXEL = `"Fusion Pixel", ${SANS}`

// canvas 不认 CSS 变量，这里是 index.css 里同名 OKLCH 颜色换算成的十六进制
const C = {
  paper: '#fffaf2',
  grid: '#efe8f4',
  card: '#ffffff',
  ink: '#2d2132',
  inkSoft: '#64586d',
  berry: '#fdd0e0',
  mint: '#c0f2db',
  lemon: '#fef1a1',
  sky: '#c7eaff',
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

export async function renderShareImage(
  record: JournalRecord,
  photos: StoredPhoto[],
): Promise<Blob> {
  await ensurePixelFont()
  const canvas = new OffscreenCanvas(SHARE_W, SHARE_H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 底纸 + 浅方格
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, SHARE_W, SHARE_H)
  ctx.fillStyle = C.grid
  for (let x = 0; x < SHARE_W; x += GRID) ctx.fillRect(x, 0, 3, SHARE_H)
  for (let y = 0; y < SHARE_H; y += GRID) ctx.fillRect(0, y, SHARE_W, 3)

  // 照片卡：正方形，最多 4 张；照片之间露出描边色，像漫画分格
  const box = SHARE_W - PAD * 2 - SHADOW
  const top = PAD
  card(ctx, PAD, top, box, box, photos.length ? C.ink : C.lemon)
  const inner = box - BORDER * 2
  const slots = photoSlots(photos.length, inner, BORDER)
  for (const [i, slot] of slots.entries()) {
    const bitmap = await createImageBitmap(photos[i].blob)
    const crop = coverCrop(bitmap.width, bitmap.height, slot.w, slot.h)
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      PAD + BORDER + slot.x,
      top + BORDER + slot.y,
      slot.w,
      slot.h,
    )
    bitmap.close()
  }
  // 星星压在照片卡右上角
  star(ctx, PAD + box - 60, top - 36, 12)

  const width = SHARE_W - PAD * 2
  const measureWith = (font: string) => (s: string) => {
    ctx.font = font
    return ctx.measureText(s).width
  }

  // 日期、地点：做成小标签
  let y = top + box + SHADOW + 64
  const tagFont = `36px ${PIXEL}`
  const tagH = 64
  let x = PAD
  const tag = (label: string, fill: string) => {
    ctx.font = tagFont
    const w = Math.ceil(ctx.measureText(label).width) + 40
    if (x + w > SHARE_W - PAD) return false
    card(ctx, x, y, w, tagH, fill, 0)
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'middle'
    ctx.fillText(label, x + 20, y + tagH / 2 + 2)
    ctx.textBaseline = 'alphabetic'
    x += w + 16
    return true
  }
  tag(dateFmt.format(record.takenAt), C.card)
  const place = shortPlace(record.placeName)
  if (place) tag(place, C.sky)
  y += tagH + 88

  const content = record.content
  // 标题：没有 AI 正文时用原话开头，再没有就用日期
  const title =
    content?.title ??
    (record.note.slice(0, 16) || dateFmt.format(record.takenAt))
  const titleFont = `72px ${PIXEL}`
  for (const line of wrapText(title, width, measureWith(titleFont), 2)) {
    ctx.font = titleFont
    ctx.fillStyle = C.ink
    ctx.fillText(line, PAD, y)
    y += 92
  }
  y += 8

  // 正文用系统字体：长段像素字读着累（决策 0010）
  const body = recordBody(record)
  const bodyFont = `400 40px ${SANS}`
  const lineHeight = 62
  const bodyBottom = SHARE_H - 240
  const maxLines = Math.max(1, Math.floor((bodyBottom - y) / lineHeight))
  for (const line of wrapText(body, width, measureWith(bodyFont), maxLines)) {
    ctx.font = bodyFont
    ctx.fillStyle = C.ink
    ctx.fillText(line, PAD, y)
    y += lineHeight
  }

  // 标签：薄荷绿，紧跟正文（正文短时不留大片空白），一行排不下的就不画了
  x = PAD
  y = Math.min(y - lineHeight + 48, SHARE_H - 210)
  for (const t of content?.tags ?? []) {
    if (!tag(`#${t}`, C.mint)) break
  }

  // 落款：虚线分隔 + 小星星 + App 名
  ctx.fillStyle = C.inkSoft
  for (let dx = PAD; dx < SHARE_W - PAD; dx += 24)
    ctx.fillRect(dx, SHARE_H - 116, 12, 3)
  star(ctx, PAD, SHARE_H - 84, 6)
  ctx.font = `36px ${PIXEL}`
  ctx.fillStyle = C.inkSoft
  ctx.fillText('足迹手账', PAD + 60, SHARE_H - 52)

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}
