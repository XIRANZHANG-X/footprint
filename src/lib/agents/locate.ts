import type { z } from 'zod'
import { LOCATE_TOOLS } from '../../../shared/agents.ts'
import { db } from '../../db.ts'
import { agentTurn, searchPlaces } from '../ai.ts'
import { ymd } from './askTools.ts'
import {
  locateTools,
  pickCandidates,
  SpotBook,
  type LocateCandidate,
} from './locateTools.ts'
import { runAgent, type Step } from './run.ts'

// 帮我找地点（决策 0028 第 4 条）：给没有定位的记录找候选地点，用户点了才写入

type Proposal = z.infer<typeof LOCATE_TOOLS.propose.args>
export type { LocateCandidate }

export type LocateResult = {
  candidates: LocateCandidate[]
  note: string | null
  steps: Step[]
  dropped: number // 模型给了、但对不上任何工具结果的候选个数
}

export async function locateRecord(
  recordId: string,
  onStep?: (steps: Step[]) => void,
): Promise<LocateResult> {
  const record = await db.records.get(recordId)
  if (!record) throw new Error('记录不见了')
  const records = await db.records.toArray()
  const book = new SpotBook()
  const tools = locateTools(record, records, book, {
    clueCities: async () =>
      (await import('../geo/regions.ts')).clueCities(record),
    search: searchPlaces,
  })
  const r = await runAgent<'locate', Proposal>(
    'locate',
    '帮我找这条记录是在哪里。',
    tools,
    agentTurn,
    ymd(Date.now()),
    onStep,
  )
  if (!r.final)
    return {
      candidates: [],
      note:
        r.text?.trim() ||
        (r.stopped === 'limit' ? '查了好几步还没找到。' : null),
      steps: r.steps,
      dropped: 0,
    }
  return {
    ...pickCandidates(r.final, book),
    note: r.final.note,
    steps: r.steps,
  }
}
