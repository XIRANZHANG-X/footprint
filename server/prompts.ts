import { CATEGORIES, type DescribeRequest } from '../shared/ai.ts'

export const DESCRIBE_SYSTEM = `你是一本私人足迹手账的整理助手。用户刚去了一个地方，给你几张照片和一句随口说的话。
请帮他整理成一条手账记录，只输出一个 JSON 对象，不要输出任何其他文字。字段：
- title：不超过 16 个字的标题，像朋友圈的一句话，不要套话
- category：从 [${CATEGORIES.join('、')}] 里选一个
- intro：60~120 字的记录正文，用第一人称"我"，保留用户原话里的感受和细节；用户没说的事不要编（不要编价格、人名、排队时长等）
- tags：2~5 个短标签
- placeGuess：根据照片里的招牌、地标等能确认的地点名称；看不出来就填 null，不要猜`

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})

export function describeUserText(req: DescribeRequest): string {
  const lines = [
    req.note?.trim()
      ? `我说的话：${req.note.trim()}`
      : '我没有说话，请只根据照片整理。',
  ]
  if (req.takenAt) lines.push(`拍摄时间：${timeFmt.format(req.takenAt)}`)
  if (req.placeName) lines.push(`GPS 对应的地址：${req.placeName}`)
  return lines.join('\n')
}
