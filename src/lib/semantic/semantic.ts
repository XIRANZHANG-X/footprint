import { db, type JournalRecord } from '../../db.ts'
import { embedText, textHash } from '../search.ts'
import type { EmbedRequest, EmbedResponse } from './embed.worker.ts'
import { pickHits, type SemanticHit } from './pick.ts'

// 语义搜索的主线程这一侧（决策 0014 第 3A 条）。
// 向量存在本地的 embeddings 表；第一次用搜索时在后台给旧记录补齐，之后只算新增和改过的。

// bge 中文模型的检索用法：查询句前面加这句说明，被检索的文字不加
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：'
const BATCH = 8

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<
  number,
  { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./embed.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent<EmbedResponse>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if ('error' in e.data) w.reject(new Error(e.data.error))
      else w.resolve(e.data.vectors)
    }
    worker.onerror = (e) => {
      for (const w of waiting.values())
        w.reject(new Error(e.message || '语义搜索出错'))
      waiting.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

function embed(texts: string[]): Promise<Float32Array[]> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().postMessage({ id, texts } satisfies EmbedRequest)
  })
}

export type Progress = { done: number; total: number }

let backfill: Promise<void> | null = null

// 给还没有向量、或文字改过的记录算向量。onProgress 只报告这一轮要算的数量
export function ensureEmbeddings(
  records: JournalRecord[],
  onProgress?: (p: Progress) => void,
): Promise<void> {
  backfill ??= (async () => {
    try {
      const have = new Map(
        (await db.embeddings.toArray()).map((e) => [e.recordId, e.hash]),
      )
      const todo = records
        .map((r) => ({ id: r.id, text: embedText(r) }))
        .filter((x) => x.text && have.get(x.id) !== textHash(x.text))
      // 已经删掉的记录，向量一起清掉
      const alive = new Set(records.map((r) => r.id))
      const orphans = [...have.keys()].filter((id) => !alive.has(id))
      if (orphans.length) await db.embeddings.bulkDelete(orphans)
      onProgress?.({ done: 0, total: todo.length })
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH)
        const vectors = await embed(batch.map((x) => x.text))
        await db.embeddings.bulkPut(
          batch.map((x, j) => ({
            recordId: x.id,
            hash: textHash(x.text),
            vector: vectors[j],
          })),
        )
        onProgress?.({
          done: Math.min(i + BATCH, todo.length),
          total: todo.length,
        })
      }
    } finally {
      backfill = null
    }
  })()
  return backfill
}

export type { SemanticHit }

// 和查询句意思最接近的记录，按相似度从高到低
export async function semanticSearch(
  query: string,
  limit = 8,
): Promise<SemanticHit[]> {
  const [q] = await embed([QUERY_PREFIX + query.trim()])
  const all = await db.embeddings.toArray()
  return pickHits(
    all.map((e) => {
      let s = 0
      for (let i = 0; i < q.length; i++) s += q[i] * e.vector[i]
      return { recordId: e.recordId, score: s }
    }),
    limit,
  )
}
