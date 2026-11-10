import {
  CATEGORIES,
  type DescribeMode,
  type DescribeRequest,
} from '../shared/ai.ts'

const COMMON_FIELDS = `- title：不超过 16 个字的标题，尽量用用户原话里的词，不要套话，不要感叹号
- category：从 [${CATEGORIES.join('、')}] 里选一个
- tags：2~5 个短标签
- placeGuess：根据照片里的招牌、地标等能确认的地点名称；看不出来就填 null，不要猜`

// 完整整理：标题、类别、正文、标签。
// 语气默认平实（决策 0012）：实测里模型爱补"热气腾腾""浓郁却不腻"这类用户没说过的形容
const FULL_SYSTEM = `你是一本私人足迹手账的整理助手。用户去了一个地方，给你几张照片和一句随口说的话。
请帮他整理成一条手账记录，只输出一个 JSON 对象，不要输出任何其他文字。字段：
${COMMON_FIELDS}
- intro：记录正文，用第一人称"我"，40~100 字。要求：
  - 语气平实，像自己随手记下来的，不要写成文案或游记
  - 只写用户原话里说到的事，和照片里看得见的东西
  - 不要添加用户没说过的感受、味道、氛围（例如"热气腾腾""令人陶醉""治愈"）
  - 不要编价格、人名、排队时长等事实
  - 原话很短就写短一点，不要为了凑字数展开
  - 用户没说话时，只客观写照片里有什么`

// 只补标题、类别、标签：用户选择用自己写的内容当正文时用（决策 0012 第 4 条）
const META_SYSTEM = `你是一本私人足迹手账的整理助手。用户已经自己写好了这条记录的正文，你不要改写它，也不要输出正文。
请只为这条记录起标题、选类别、加标签，只输出一个 JSON 对象，不要输出任何其他文字。字段：
${COMMON_FIELDS}`

export function describeSystem(mode: DescribeMode): string {
  return mode === 'meta' ? META_SYSTEM : FULL_SYSTEM
}

const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})

export function describeUserText(req: DescribeRequest): string {
  const hasImages = (req.images?.length ?? 0) > 0
  const lines = [
    req.note?.trim()
      ? `我说的话：${req.note.trim()}`
      : '我没有说话，请只根据照片整理。',
  ]
  if (!hasImages) lines.push('这条记录没有照片。')
  if (req.takenAt) lines.push(`拍摄时间：${timeFmt.format(req.takenAt)}`)
  if (req.placeName) lines.push(`GPS 对应的地址：${req.placeName}`)
  return lines.join('\n')
}
