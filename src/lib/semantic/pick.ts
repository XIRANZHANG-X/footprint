export type SemanticHit = { recordId: string; score: number }

// 阈值是 2026-11-23 用 5 条样例记录实测定的：意思对得上的 0.37–0.55，无关的 0.2–0.35。
// 除了绝对阈值，还要求和最好的一条差得不远，免得查"湖"时把所有在杭州的记录都带出来
export const MIN_SCORE = 0.36
export const MAX_GAP = 0.1

export function pickHits(hits: SemanticHit[], limit = 8): SemanticHit[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score)
  const best = sorted[0]?.score ?? 0
  return sorted
    .filter((h) => h.score >= MIN_SCORE && h.score >= best - MAX_GAP)
    .slice(0, limit)
}
