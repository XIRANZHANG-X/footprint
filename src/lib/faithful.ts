// 忠实度检查（决策 0016 第 4 条）：AI 写的标题和正文里，有没有原话里没有的数字，和"添油加醋"的词。
// 只标出来，要不要重写由用户决定（决策 0011：花钱的操作都要用户点一下才发生）。
// 纯函数，不碰数据库，方便测试。

// 默认留意的词：0012 实测里模型爱加的，加上常见的文案腔。
// 原话里自己用了的不算（用户自己说"治愈"就不该被标出来）
export const DEFAULT_WATCH_WORDS = [
  '热气腾腾',
  '令人陶醉',
  '治愈',
  '回味无穷',
  '浓郁',
  '惬意',
  '美不胜收',
  '流连忘返',
  '沁人心脾',
  '心旷神怡',
  '宛如',
  '仿佛置身',
  '绝美',
  '宝藏',
  '氛围感',
  '烟火气',
  '满满的',
  '幸福感',
  '小确幸',
  '岁月静好',
  '诗意',
  '别有一番',
  '令人难忘',
  '不虚此行',
]

// ---------- 数字 ----------

// 带单位的数量才算：价格、时长、人数、距离、份数这些模型最容易编的。
// 不管日期（"11 月 3 号"），拍摄时间是告诉过模型的
const UNITS: [RegExp, string][] = [
  [/^(块钱|块|元)/, '元'],
  [/^(毛|角)/, '角'],
  [/^(个小时|小时)/, '小时'],
  [/^分钟/, '分钟'],
  [/^(人|位)/, '人'],
  [/^岁/, '岁'],
  [/^(度|℃)/, '度'],
  [/^(公里|千米)/, '公里'],
  [/^米/, '米'],
  [/^层/, '层'],
  [/^杯/, '杯'],
  [/^碗/, '碗'],
  [/^份/, '份'],
  [/^斤/, '斤'],
  [/^克/, '克'],
  [/^折/, '折'],
]

const DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const SCALE: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

// 中文数字转阿拉伯数字，支持到"万"，例如"两百五十" → 250、"十二" → 12、"半" → 0.5
export function chineseNumber(s: string): number | null {
  if (s === '半') return 0.5
  let total = 0
  let section = 0
  let digit: number | null = null
  for (const ch of s) {
    if (ch in DIGIT) digit = DIGIT[ch]
    else if (ch in SCALE) {
      const scale = SCALE[ch]
      if (scale === 10000) {
        total = (total + section + (digit ?? 0)) * scale
        section = 0
      } else section += (digit ?? 1) * scale
      digit = null
    } else return null
  }
  return total + section + (digit ?? 0)
}

const NUMBER =
  /[¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万半]+/g

export type Quantity = { key: string; text: string }

// 找出文字里带单位的数量。key 是归一化后的写法（"一小时"和"1 个小时"都是"1小时"），text 是原文
export function quantities(text: string): Quantity[] {
  const out: Quantity[] = []
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0]
    const rest = text.slice((m.index ?? 0) + raw.length).replace(/^\s+/, '')
    const isYuan = /^[¥￥]/.test(raw)
    const value = isYuan
      ? Number(raw.replace(/[¥￥\s]/g, ''))
      : /\d/.test(raw)
        ? Number(raw)
        : chineseNumber(raw)
    if (value === null || Number.isNaN(value)) continue
    const unit = isYuan ? ['', '元'] : UNITS.find(([re]) => re.test(rest))
    if (!unit) continue
    const unitText = isYuan ? '' : (rest.match(unit[0] as RegExp)?.[0] ?? '')
    // 提醒里照原文写（"38 元"），用户才好在正文里找到
    const gap = isYuan
      ? ''
      : (text.slice((m.index ?? 0) + raw.length).match(/^\s*/)?.[0] ?? '')
    out.push({ key: `${value}${unit[1]}`, text: `${raw}${gap}${unitText}` })
  }
  return out
}

// ---------- 检查 ----------

export type CheckInput = { title: string; intro: string }
export type Source = { note: string; placeName: string | null }

// 返回要提醒用户的片段（去重，按出现顺序），例如 ["38 元", "热气腾腾"]
export function unfaithfulBits(
  ai: CheckInput,
  source: Source,
  watchWords: string[],
): string[] {
  const generated = `${ai.title}\n${ai.intro}`
  const given = `${source.note}\n${source.placeName ?? ''}`
  const givenKeys = new Set(quantities(given).map((q) => q.key))
  const out: string[] = []
  for (const q of quantities(generated))
    if (!givenKeys.has(q.key) && !out.includes(q.text)) out.push(q.text)
  for (const w of watchWords)
    if (generated.includes(w) && !given.includes(w) && !out.includes(w))
      out.push(w)
  return out
}

// ---------- 从修改记录里学"不要用的词" ----------

const PUNCT = /[\s，。、；：！？,.;:!?“”"'‘’（）()《》…—\-·]+/

// 片段两头的虚字去掉再比较："热气腾腾的"和"热气腾腾"算同一个词
const trimParticles = (p: string) =>
  p.replace(/^[很也都就又还]+/, '').replace(/[的了地得着]+$/, '')

// 原稿里被删掉的连续片段（按最长公共子序列对齐，逐字比较）
export function deletedRuns(draft: string, final: string): string[] {
  const a = Array.from(draft)
  const b = Array.from(final)
  // lcs[i][j]：a[i..] 和 b[j..] 的最长公共子序列长度
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const runs: string[] = []
  let run = ''
  let i = 0
  let j = 0
  while (i < a.length) {
    if (j < b.length && a[i] === b[j]) {
      if (run) runs.push(run)
      run = ''
      i++
      j++
    } else if (j < b.length && lcs[i][j + 1] >= lcs[i + 1][j]) {
      j++ // 用户新加的字
    } else {
      run += a[i] // 原稿里被删掉的字
      i++
    }
  }
  if (run) runs.push(run)
  return runs
}

type EditLike = {
  kind: 'edit' | 'choseOwn'
  draft: { title: string; intro: string }
  final: { title: string; intro: string }
}

export type LearnedWord = { word: string; times: number }

export const LEARN = {
  minTimes: 2, // 至少在几次修改里被删掉
  minChars: 2,
  maxChars: 6,
  max: 20,
} as const

// 用户在不同的修改里反复删掉的词（2–6 个字），而且用户自己写的东西里从来不用。
//
// 候选词：被删掉的片段里 2–6 个字的那些，加上"默认留意的词"。
// 计数：某次修改里只要有被删的片段"包含"这个词就算一次。逐字对齐常把相邻的字一起算进被删的片段
// （删"热气腾腾"时连带一个"底"字），只认完全相等会漏掉；删掉一整句时，句子里的候选词也能被认出来
export function learnAvoidWords(
  edits: EditLike[],
  ownTexts: string[],
): LearnedWord[] {
  // 每次修改被删掉的片段（"改用自己写的"是整篇不要，不代表哪个词不好，不算）
  const perEdit = edits
    .filter((e) => e.kind === 'edit')
    .map((e) =>
      (['title', 'intro'] as const).flatMap((f) =>
        deletedRuns(e.draft[f], e.final[f]).flatMap((run) =>
          run.split(PUNCT).map(trimParticles).filter(Boolean),
        ),
      ),
    )
  const candidates = new Set<string>(DEFAULT_WATCH_WORDS)
  for (const pieces of perEdit)
    for (const p of pieces) {
      const len = Array.from(p).length
      if (len >= LEARN.minChars && len <= LEARN.maxChars) candidates.add(p)
    }
  const own = ownTexts.join('\n')
  const out: LearnedWord[] = []
  for (const word of candidates) {
    if (own.includes(word)) continue
    const times = perEdit.filter((pieces) =>
      pieces.some((p) => p.includes(word)),
    ).length
    if (times >= LEARN.minTimes) out.push({ word, times })
  }
  return out
    .sort((x, y) => y.times - x.times || x.word.localeCompare(y.word, 'zh'))
    .slice(0, LEARN.max)
}
