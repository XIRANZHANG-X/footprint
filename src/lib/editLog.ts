import { db, type EditEntry, type RecordContent } from '../db.ts'
import { changeStats } from './editStats.ts'

const pick = (c: RecordContent): RecordContent => ({
  title: c.title,
  category: c.category,
  intro: c.intro,
  tags: c.tags,
})

const sameDraft = (a: RecordContent, b: RecordContent) =>
  a.title === b.title && a.intro === b.intro

// 记下"AI 原稿 → 用户改后的版本"（决策 0012 第 1 条）。
// 同一条记录、同一份原稿只留一条：用户反复保存时更新它，不会刷出一堆重复的。
// 换了一份原稿（点了"重新生成"）才新增一条，所以之前的修改不会再被覆盖。
// 要在包含 db.edits 的事务里调用，或者单独调用。
export async function logEdit(
  recordId: string,
  draft: RecordContent,
  final: RecordContent,
  kind: EditEntry['kind'] = 'edit',
) {
  const stats = changeStats(draft, final)
  const earlier = await db.edits.where('recordId').equals(recordId).sortBy('at')
  const last = earlier.at(-1)
  const entry: EditEntry = {
    id: last && sameDraft(last.draft, draft) ? last.id : crypto.randomUUID(),
    recordId,
    at: Date.now(),
    kind,
    draft: pick(draft),
    final: pick(final),
    ...stats,
  }
  await db.edits.put(entry)
}
