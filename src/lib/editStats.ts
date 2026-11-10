// 衡量"用户改了多少"（决策 0012）：AI 原稿和用户改后的版本之间，要增、删、换多少个字。
// 纯函数，不碰数据库，方便测试。

type Text = { title: string; intro: string }

/** 编辑距离（Levenshtein）：把 a 变成 b 最少要增、删、换几个字。按字（码点）算，不按 UTF-16 单元 */
export function editDistance(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length
  // 只保留上一行，内存 O(较短的那一边)
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j)
  for (let i = 1; i <= s.length; i++) {
    const cur = [i]
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1, // 删
        cur[j - 1] + 1, // 增
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1), // 换
      )
    }
    prev = cur
  }
  return prev[t.length]
}

const length = (s: string) => Array.from(s).length

export type ChangeStats = {
  changedChars: number // 标题和正文一共改了多少字
  draftChars: number // AI 原稿的标题和正文一共多少字
}

// 只看标题和正文：类别、标签是选出来的，不反映写作习惯
export function changeStats(draft: Text, final: Text): ChangeStats {
  return {
    changedChars:
      editDistance(draft.title, final.title) +
      editDistance(draft.intro, final.intro),
    draftChars: length(draft.title) + length(draft.intro),
  }
}

/** 改动比例：0 表示一字未改；原稿很短而用户写了很多时会超过 1 */
export function changeRatio({ changedChars, draftChars }: ChangeStats): number {
  return changedChars / Math.max(draftChars, 1)
}
