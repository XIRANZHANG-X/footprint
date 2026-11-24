import type { z } from 'zod'
import { ASK_TOOLS, MAX_QUESTION_CHARS } from '../../../shared/agents.ts'
import { db, type JournalRecord } from '../../db.ts'
import { agentTurn } from '../ai.ts'
import { askTools, RecordRefs, ymd } from './askTools.ts'
import { runAgent, type Step } from './run.ts'

// 问问我的足迹（决策 0028 第 3 条）

type Answer = z.infer<typeof ASK_TOOLS.answer.args>

export type AskResult = {
  text: string
  records: JournalRecord[] // 回答引用的记录（只保留真的查到过的）
  steps: Step[]
  complete: boolean // false：到步数上限还没答完
}

// 语义搜索：本机向量（决策 0014 第 3A 条）。模型第一次要加载，失败就只用字面匹配
async function semanticIds(
  records: JournalRecord[],
  q: string,
): Promise<string[]> {
  const m = await import('../semantic/semantic.ts')
  await m.ensureEmbeddings(records, () => {})
  return (await m.semanticSearch(q, 12)).map((h) => h.recordId)
}

export async function askFootprint(
  question: string,
  onStep?: (steps: Step[]) => void,
): Promise<AskResult> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS)
  const records = await db.records.toArray()
  const refs = new RecordRefs()
  const seen = new Set<string>()
  const tools = askTools(records, refs, seen, (s) => semanticIds(records, s))
  const r = await runAgent<'ask', Answer>(
    'ask',
    q,
    tools,
    agentTurn,
    ymd(Date.now()),
    onStep,
  )
  const byId = new Map(records.map((x) => [x.id, x]))
  if (r.final) {
    const ids = r.final.recordIds.flatMap((ref) => {
      const id = refs.id(ref)
      return id && seen.has(id) ? [id] : []
    })
    return {
      text: r.final.text,
      records: [...new Set(ids)].flatMap((id) => byId.get(id) ?? []),
      steps: r.steps,
      complete: true,
    }
  }
  return {
    text:
      r.text?.trim() ||
      (r.stopped === 'limit'
        ? '查了好几步还没得出答案，换个问法试试？'
        : '没有得到回答。'),
    records: [],
    steps: r.steps,
    complete: r.stopped !== 'limit',
  }
}
