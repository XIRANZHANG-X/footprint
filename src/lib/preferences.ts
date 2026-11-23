import { MAX_AVOID_WORDS } from '../../shared/ai.ts'
import { db } from '../db.ts'
import { suggestPreferences } from './ai.ts'
import { DEFAULT_WATCH_WORDS, learnAvoidWords } from './faithful.ts'
import {
  DEFAULT_PREFERENCES,
  LEARNING,
  nextAutoExamples,
  pickExamples,
  summaryDue,
  usesExamples,
  type Preferences,
} from './learning.ts'

// 偏好说明和学习状态存在本机的 settings 表里，会进备份（决策 0012）。规则本身在 learning.ts。

const KEY = 'preferences'

export async function getPreferences(): Promise<Preferences> {
  const row = await db.settings.get(KEY)
  // 以后加了新字段，旧数据里没有的用默认值补上
  return { ...DEFAULT_PREFERENCES, ...(row?.value as Partial<Preferences>) }
}

export async function updatePreferences(patch: Partial<Preferences>) {
  await db.transaction('rw', db.settings, async () => {
    const current = await getPreferences()
    await db.settings.put({ key: KEY, value: { ...current, ...patch } })
  })
}

// 从修改记录里学到的词（决策 0016 第 4 条）。"用户自己写的东西"= 所有记录的原话，加上每次修改后的版本：
// 用户自己留着的词不算他不喜欢的词
export async function learnedWords() {
  const [edits, records] = await Promise.all([
    db.edits.toArray(),
    db.records.toArray(),
  ])
  return learnAvoidWords(edits, [
    ...records.map((r) => r.note),
    ...edits.map((e) => `${e.final.title}\n${e.final.intro}`),
  ])
}

// 不要用的词 = 学到的 + 用户自己加的 − 用户划掉的
export async function avoidWords(): Promise<string[]> {
  const [prefs, learned] = await Promise.all([getPreferences(), learnedWords()])
  const ignored = new Set(prefs.ignoredWords)
  return [...new Set([...prefs.extraWords, ...learned.map((w) => w.word)])]
    .filter((w) => !ignored.has(w))
    .slice(0, MAX_AVOID_WORDS)
}

// 整理完以后检查用的词表：默认留意的词 + 不要用的词，同样去掉用户划掉的
export async function watchWords(): Promise<string[]> {
  const [prefs, avoid] = await Promise.all([getPreferences(), avoidWords()])
  const ignored = new Set(prefs.ignoredWords)
  return [
    ...new Set([
      ...DEFAULT_WATCH_WORDS.filter((w) => !ignored.has(w)),
      ...avoid,
    ]),
  ]
}

// 这次整理要带给模型的东西：偏好说明，（需要时）最近的例子，以及不要用的词
export async function styleForRequest(withExamples: boolean) {
  const [prefs, edits, avoid] = await Promise.all([
    getPreferences(),
    db.edits.toArray(),
    avoidWords(),
  ])
  // 把自动判断的结果记下来，下次才能做到"低于 10% 关、高于 20% 才再开"
  const auto = nextAutoExamples(prefs.autoExamplesOn, edits)
  if (auto !== prefs.autoExamplesOn)
    await updatePreferences({ autoExamplesOn: auto })
  const text = prefs.text.trim()
  return {
    preferences: text || undefined,
    examples:
      withExamples && usesExamples({ ...prefs, autoExamplesOn: auto }, edits)
        ? pickExamples(edits)
        : undefined,
    avoidWords: avoid.length > 0 ? avoid : undefined,
  }
}

// 攒够一批修改后，让模型提出一版新的偏好说明，存成"待确认"。用户确认后才生效。
// 失败就算了：下次打开 App 还会再试
export async function proposePreferencesIfDue(): Promise<boolean> {
  const [prefs, edits] = await Promise.all([
    getPreferences(),
    db.edits.toArray(),
  ])
  if (!summaryDue(prefs, edits.length)) return false
  const examples = pickExamples(edits, LEARNING.summaryEdits)
  if (examples.length === 0) {
    // 这一批全是"一字未改"：没有可学的，记下已经看过
    await updatePreferences({ editsAtLastSummary: edits.length })
    return false
  }
  const text = (await suggestPreferences(prefs.text, examples)).trim()
  await updatePreferences({
    // 模型认为不用改（和现在的一样）就不打扰用户
    proposal: text && text !== prefs.text.trim() ? text : null,
    editsAtLastSummary: edits.length,
  })
  return true
}
