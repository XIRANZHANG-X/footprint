import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { MAX_AVOID_WORD_CHARS } from '../../shared/ai.ts'
import {
  getPreferences,
  learnedWords,
  updatePreferences,
} from '../lib/preferences.ts'

// "不要用的词"（决策 0016 第 4 条）：从修改记录里学到的（同一个词在两次以上的修改里被删掉），
// 加上自己添的。整理时告诉 AI 别写，写了会在卡片上标出来。学到的词可以划掉，划错了可以恢复
export function AvoidWordsCard() {
  const data = useLiveQuery(async () => {
    const [prefs, learned] = await Promise.all([
      getPreferences(),
      learnedWords(),
    ])
    return { prefs, learned }
  })
  const [draft, setDraft] = useState('')
  if (!data) return null
  const { prefs, learned } = data
  const ignored = new Set(prefs.ignoredWords)
  const active = learned.filter((w) => !ignored.has(w.word))

  const add = () => {
    const w = draft.trim().slice(0, MAX_AVOID_WORD_CHARS)
    if (!w) return
    setDraft('')
    void updatePreferences({
      extraWords: [...new Set([...prefs.extraWords, w])],
      ignoredWords: prefs.ignoredWords.filter((x) => x !== w),
    })
  }

  return (
    <div className="px-card space-y-3 p-3 text-sm">
      <h2 className="px-title text-[16px]">不要用的词</h2>
      <p className="text-xs text-ink-soft">
        整理时会告诉 AI
        别写这些词；写了也会在卡片上标出来。原话里没有的价格、时长这类数字也会被标出来。
      </p>

      <div>
        <p className="font-pixel text-[12px] text-ink-soft">
          从你的修改里学到的（删过两次以上）
        </p>
        {active.length === 0 ? (
          <p className="mt-1 text-xs text-ink-soft">还没有。</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {active.map((w) => (
              <button
                key={w.word}
                type="button"
                className="px-btn px-btn-sm bg-berry"
                aria-label={`划掉“${w.word}”`}
                onClick={() =>
                  void updatePreferences({
                    ignoredWords: [...prefs.ignoredWords, w.word],
                  })
                }
              >
                {w.word}
                <span className="opacity-60">删过 {w.times} 次 ×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="font-pixel text-[12px] text-ink-soft">自己加的</p>
        {prefs.extraWords.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {prefs.extraWords.map((w) => (
              <button
                key={w}
                type="button"
                className="px-btn px-btn-sm"
                aria-label={`去掉“${w}”`}
                onClick={() =>
                  void updatePreferences({
                    extraWords: prefs.extraWords.filter((x) => x !== w),
                  })
                }
              >
                {w} <span className="opacity-60">×</span>
              </button>
            ))}
          </div>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <label htmlFor="avoid-word" className="sr-only">
            加一个不要用的词
          </label>
          <input
            id="avoid-word"
            className="px-input min-w-0 flex-1"
            value={draft}
            maxLength={MAX_AVOID_WORD_CHARS}
            placeholder="例如：氛围感"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            className="px-btn px-btn-sm shrink-0 bg-mint"
            disabled={!draft.trim()}
          >
            加上
          </button>
        </form>
      </div>

      {prefs.ignoredWords.length > 0 && (
        <p className="text-xs text-ink-soft">
          已划掉：
          {prefs.ignoredWords.map((w, i) => (
            <span key={w}>
              {i > 0 && '、'}
              <button
                type="button"
                className="underline decoration-dashed underline-offset-2 hover:text-ink"
                aria-label={`恢复“${w}”`}
                onClick={() =>
                  void updatePreferences({
                    ignoredWords: prefs.ignoredWords.filter((x) => x !== w),
                  })
                }
              >
                {w}
              </button>
            </span>
          ))}
          （点一下恢复）
        </p>
      )}
    </div>
  )
}
