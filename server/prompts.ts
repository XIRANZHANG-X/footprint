import {
  CATEGORIES,
  type DescribeMode,
  type DescribeRequest,
  type StyleExample,
  type SummarizeRequest,
} from '../shared/ai.ts'

const COMMON_FIELDS = `- title：不超过 16 个字的标题，尽量用用户原话里的词，不要套话，不要感叹号
- category：从 [${CATEGORIES.join('、')}] 里选一个
- tags：2~5 个短标签
- placeGuess：根据照片里的招牌、地标等能确认的地点名称；看不出来就填 null，不要猜
- clues：{"phones": [], "plates": []}。照片里能看清的电话号码和车牌号，原样抄下来；没有或看不清就是空数组，不要根据它们推断城市`

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

const exampleBlock = (e: StyleExample, i: number) =>
  [
    `例 ${i + 1}`,
    `你写的标题：${e.draft.title}`,
    `你写的正文：${e.draft.intro}`,
    `用户改成的标题：${e.final.title}`,
    `用户改成的正文：${e.final.intro}`,
  ].join('\n')

// 偏好说明和例子接在基础提示词后面（决策 0012）：两者和基础要求冲突时，以用户的为准
export function describeSystem(
  mode: DescribeMode,
  preferences?: string,
  examples: StyleExample[] = [],
  avoidWords: string[] = [],
): string {
  const parts = [mode === 'meta' ? META_SYSTEM : FULL_SYSTEM]
  // 不要用的词（决策 0016 第 4 条）：用户以前反复删掉的，或者上次被标出来、用户点了"重写"的
  if (avoidWords.length > 0)
    parts.push(
      `下面这些词语这位用户以前删掉过，或者原话里没有，这次不要写：${avoidWords.join('、')}`,
    )
  if (preferences?.trim())
    parts.push(
      `这位用户对写法有自己的要求，和上面的要求冲突时以这里为准：\n${preferences.trim()}`,
    )
  // 只补标题时不写正文，例子用不上
  if (mode === 'full' && examples.length > 0)
    parts.push(
      `下面是你以前为这位用户写的稿子，和他改后的版本。看他删了什么、换了什么，这次直接按他的习惯写：\n\n${examples.map(exampleBlock).join('\n\n')}`,
    )
  return parts.join('\n\n')
}

export const SUGGEST_SYSTEM = `你在帮一位用户维护他的"写作偏好说明"。这段说明会交给写手账的 AI，让它写出来的东西更接近用户自己的写法。
我会给你现在的说明（可能是空的），和最近几次"AI 写的稿子 → 用户改后的版本"。请输出一版新的说明。要求：
- 只写反复出现的改法（至少在两次修改里出现过），偶然的一次不算
- 现在的说明里仍然成立的要求保留，被最近的修改推翻的去掉
- 每条一行，以"- "开头，最多 6 条，每条不超过 30 个字
- 写具体的做法（例如"不写感叹句""标题不超过 8 个字"），不写空话（例如"写得更好"）
- 只输出说明本身，不要解释，不要加标题`

// 出行总结（决策 0014 第 3E 条）：只用文字，语气和记录正文一样平实
export const SUMMARY_SYSTEM = `你在帮一位用户给他的一次出行写总结，放在他私人足迹手账里这次出行的开头。
我会按时间顺序给你这次出行的每条记录（日期、标题、地点、正文）。要求：
- 用第一人称"我"，60~150 字，一段话
- 语气平实，像自己随手记下的，不要写成游记或文案，不要感叹号
- 只写记录里出现过的地方和事，按时间顺序串起来；不要添加记录里没有的感受、评价和事实
- 只输出总结本身，不要标题，不要解释`

export function summaryUserText(req: SummarizeRequest): string {
  return req.items
    .map((it, i) =>
      [
        `${i + 1}. ${it.date} ${it.title}`,
        it.place ? `地点：${it.place}` : '',
        it.body ? `正文：${it.body}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

export function summarySystem(preferences?: string) {
  return preferences?.trim()
    ? `${SUMMARY_SYSTEM}\n\n这位用户对写法有自己的要求，和上面的要求冲突时以这里为准：\n${preferences.trim()}`
    : SUMMARY_SYSTEM
}

export function suggestUserText(
  current: string,
  edits: StyleExample[],
): string {
  return [
    `现在的说明：\n${current.trim() || '（空）'}`,
    `最近的修改：\n\n${edits.map(exampleBlock).join('\n\n')}`,
  ].join('\n\n')
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

// 回复不合格式时修一次（决策 0016 第 1 条）：只把那段回复和问题发给文字模型，不重发照片。
// 只改格式和长度，不改意思
export const REPAIR_SYSTEM = `你负责修正一段 JSON。我会给你一段手账记录的 JSON 和它不合要求的地方。
请只修正这些问题（例如标题太长就缩短，缺的字段补上），其余内容和意思保持不变，只输出修正后的 JSON 对象。`

export function repairUserText(reply: string, problems: string[]): string {
  return [
    '不合要求的地方：',
    ...problems.map((p) => `- ${p}`),
    '',
    '原来的回复：',
    reply.slice(0, 3000),
  ].join('\n')
}
