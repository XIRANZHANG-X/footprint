import type { StyleExample } from '../../shared/ai.ts'
import { changeRatio } from './editStats.ts'

// 学习用户写作习惯的规则（决策 0012 第 2、6 条）。纯函数，不碰数据库和网络。
// 数字都集中在这里，用一阵子觉得不对可以直接调。
export const LEARNING = {
  summaryEvery: 5, // 每攒够几次修改，让模型提出一版新的偏好说明
  summaryEdits: 10, // 提炼时最多给模型看最近几次修改
  window: 5, // 看最近几次修改来判断"学会了没有"
  examplesOffBelow: 0.1, // 平均改动低于这个比例：不再带例子
  examplesOnAbove: 0.2, // 平均改动高于这个比例：重新带上例子
  maxExamples: 2, // 一次整理最多带几个例子
} as const

// auto：按改动比例自动决定；on / off：用户手动覆盖
export type ExamplesMode = 'auto' | 'on' | 'off'

export type Preferences = {
  text: string // 偏好说明，每次整理都带上
  examples: ExamplesMode
  autoExamplesOn: boolean // auto 模式下当前带不带例子（记住它，才能做到"低于 10% 关、高于 20% 才再开"）
  proposal: string | null // 模型提出、还没被用户确认的新说明
  editsAtLastSummary: number // 上次提炼时一共有多少条修改记录
  // "不要用的词"（决策 0016 第 4 条）：用户自己加的，和从学到的词里划掉的
  extraWords: string[]
  ignoredWords: string[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  text: '',
  examples: 'auto',
  autoExamplesOn: true,
  proposal: null,
  editsAtLastSummary: 0,
  extraWords: [],
  ignoredWords: [],
}

type EditLike = {
  at: number
  draft: { title: string; intro: string }
  final: { title: string; intro: string }
  changedChars: number
  draftChars: number
}

const newestFirst = <T extends { at: number }>(edits: T[]) =>
  [...edits].sort((a, b) => b.at - a.at)

/** 最近几次修改的平均改动比例；一次修改都没有时为 null */
export function recentChangeRatio(edits: EditLike[]): number | null {
  const recent = newestFirst(edits).slice(0, LEARNING.window)
  if (recent.length === 0) return null
  return recent.reduce((sum, e) => sum + changeRatio(e), 0) / recent.length
}

/**
 * auto 模式下带不带例子。两个门槛之间保持原状，避免在 10%~20% 之间来回跳。
 * 修改次数还不够一个窗口时不下"已经学会了"的结论，继续带。
 */
export function nextAutoExamples(current: boolean, edits: EditLike[]): boolean {
  if (edits.length < LEARNING.window) return true
  const ratio = recentChangeRatio(edits)
  if (ratio === null) return true
  if (ratio < LEARNING.examplesOffBelow) return false
  if (ratio > LEARNING.examplesOnAbove) return true
  return current
}

export function usesExamples(prefs: Preferences, edits: EditLike[]): boolean {
  if (prefs.examples === 'on') return true
  if (prefs.examples === 'off') return false
  return nextAutoExamples(prefs.autoExamplesOn, edits)
}

const toExample = (e: EditLike): StyleExample => ({
  draft: { title: e.draft.title, intro: e.draft.intro },
  final: { title: e.final.title, intro: e.final.intro },
})

/** 挑最近几次"确实改了东西"的修改当例子；一字未改的没有可学的 */
export function pickExamples(
  edits: EditLike[],
  max: number = LEARNING.maxExamples,
): StyleExample[] {
  return newestFirst(edits)
    .filter((e) => e.changedChars > 0)
    .slice(0, max)
    .map(toExample)
}

/** 自上次提炼以来又攒够了一批修改，而且没有一版还在等用户确认 */
export function summaryDue(prefs: Preferences, editCount: number): boolean {
  return (
    prefs.proposal === null &&
    editCount - prefs.editsAtLastSummary >= LEARNING.summaryEvery
  )
}
