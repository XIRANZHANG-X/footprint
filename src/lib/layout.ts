// 分享图排版里不依赖浏览器的计算部分，方便单元测试。

// 不能出现在行首的标点（中文排版的"避头"规则），遇到时把它挤到上一行末尾
const NO_LINE_START = new Set('，。、；：！？）」』》〉”’,.;:!?)]}…')

// 逐字断行：中文没有空格分词，按字符宽度累加，超过 maxWidth 就换行。
// 超过 maxLines 时截断并在最后一行末尾加省略号。
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = Infinity,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const ch of Array.from(paragraph)) {
      const next = line + ch
      if (measure(next) <= maxWidth || line === '' || NO_LINE_START.has(ch)) {
        line = next
      } else {
        lines.push(line)
        line = ch
      }
    }
    lines.push(line)
  }
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last && measure(last + '…') > maxWidth)
    last = Array.from(last).slice(0, -1).join('')
  kept[maxLines - 1] = last + '…'
  return kept
}

export type Rect = { x: number; y: number; w: number; h: number }

// 1～4 张照片在正方形区域里的排法：1 张铺满；2 张左右；3 张左大右二；4 张田字格
export function photoSlots(count: number, size: number, gap: number): Rect[] {
  const half = (size - gap) / 2
  const far = half + gap
  switch (Math.min(count, 4)) {
    case 0:
      return []
    case 1:
      return [{ x: 0, y: 0, w: size, h: size }]
    case 2:
      return [
        { x: 0, y: 0, w: half, h: size },
        { x: far, y: 0, w: half, h: size },
      ]
    case 3:
      return [
        { x: 0, y: 0, w: half, h: size },
        { x: far, y: 0, w: half, h: half },
        { x: far, y: far, w: half, h: half },
      ]
    default:
      return [
        { x: 0, y: 0, w: half, h: half },
        { x: far, y: 0, w: half, h: half },
        { x: 0, y: far, w: half, h: half },
        { x: far, y: far, w: half, h: half },
      ]
  }
}

// "object-fit: cover"：从原图中间裁出与目标框同比例的区域
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Rect {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const w = dstW / scale
  const h = dstH / scale
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h }
}

// 九宫格（决策 0014 第 3B 条）：最多 9 张，正方形格子，行数按张数来
export function gridSlots(count: number, size: number, gap: number): Rect[] {
  const n = Math.min(count, 9)
  // 2、4 张用两列；3 张排成一行三张，不留空格子；5 张以上三列
  const cols = n <= 1 ? 1 : n === 2 || n === 4 ? 2 : 3
  const cell = (size - gap * (cols - 1)) / cols
  return Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * (cell + gap),
    y: Math.floor(i / cols) * (cell + gap),
    w: cell,
    h: cell,
  }))
}

// 长图分页（决策 0014 第 3B 条第 5 点）：内容由一块块高度已知的小块组成（一行字、一张照片……），
// 按顺序装进页里，每页不超过 maxHeight；一块不会被切成两半。返回每页包含的块的序号
export function paginate(heights: number[], maxHeight: number): number[][] {
  const pages: number[][] = []
  let page: number[] = []
  let used = 0
  for (const [i, h] of heights.entries()) {
    if (page.length > 0 && used + h > maxHeight) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push(i)
    used += h
  }
  if (page.length > 0 || pages.length === 0) pages.push(page)
  return pages
}
