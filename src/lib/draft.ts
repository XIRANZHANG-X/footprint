import { db, type Draft } from '../db.ts'

// 写到一半的新记录（决策 0013）：选了照片、话还没说完就被打断，回来能接着写。
// 草稿只是方便，存不进去（比如空间不够）不该影响正常使用，所以这里的错误都吞掉。

export async function saveDraft(files: File[], note: string) {
  try {
    await db.drafts.put({ id: 'current', files, note, savedAt: Date.now() })
  } catch {
    // 存不进去就算了
  }
}

export async function loadDraft(): Promise<Draft | null> {
  try {
    const d = await db.drafts.get('current')
    // 没有照片也没有文字的草稿没有意义
    if (!d || (d.files.length === 0 && !d.note.trim())) return null
    return d
  } catch {
    return null
  }
}

export async function clearDraft() {
  try {
    await db.drafts.delete('current')
  } catch {
    // 留下一份旧草稿，下次打开时用户可以丢弃
  }
}
