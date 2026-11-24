import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { MAX_PREFERENCES_CHARS } from '../../shared/ai.ts'
import { APP_VERSION } from '../appVersion.ts'
import { db } from '../db.ts'
import { changeRatio } from '../lib/editStats.ts'
import {
  DEFAULT_PREFERENCES,
  LEARNING,
  pickExamples,
  recentChangeRatio,
  usesExamples,
  type ExamplesMode,
  type Preferences,
} from '../lib/learning.ts'
import { updatePreferences } from '../lib/preferences.ts'
import { AvoidWordsCard } from './AvoidWordsCard.tsx'
import { UsageCard } from './UsageCard.tsx'

const percent = (n: number) => `${Math.round(n * 100)}%`
const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
})

const EXAMPLE_MODES: [ExamplesMode, string][] = [
  ['auto', '自动'],
  ['on', '总是带'],
  ['off', '不带'],
]

// 一段可以改的文字 + 保存按钮。key 换了（外面的文字变了）就重新开始
function TextEditor({
  initial,
  placeholder,
  rows,
  actions,
}: {
  initial: string
  placeholder?: string
  rows: number
  actions: (text: string, dirty: boolean) => React.ReactNode
}) {
  const [text, setText] = useState(initial)
  return (
    <>
      <textarea
        className="px-input mt-2"
        rows={rows}
        maxLength={MAX_PREFERENCES_CHARS}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {actions(text, text !== initial)}
      </div>
    </>
  )
}

// "我的偏好"（决策 0012）：AI 按这段说明来写；用户看得见、改得了它学到了什么
export function PreferencesPanel() {
  const row = useLiveQuery(() => db.settings.get('preferences'))
  const edits = useLiveQuery(() => db.edits.toArray())
  const [saved, setSaved] = useState(false)
  if (!edits) return null

  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    ...(row?.value as Partial<Preferences>),
  }
  const ratio = recentChangeRatio(edits)
  const withExamples = usesExamples(prefs, edits)
  const exampleCount = withExamples ? pickExamples(edits).length : 0
  const recent = [...edits].sort((a, b) => b.at - a.at).slice(0, 5)
  const untilNext = Math.max(
    0,
    LEARNING.summaryEvery - (edits.length - prefs.editsAtLastSummary),
  )

  return (
    <section className="mt-5 space-y-4">
      {prefs.proposal && (
        <div className="px-card bg-mint p-3 text-sm">
          <p className="px-title text-[16px]">AI 提出了一版新的偏好</p>
          <p className="mt-1 text-xs text-ink-soft">
            根据你最近的修改整理的。可以先改几个字再采用；不采用的话，现在的偏好不变。
          </p>
          <TextEditor
            key={prefs.proposal}
            initial={prefs.proposal}
            rows={6}
            actions={(text) => (
              <>
                <button
                  type="button"
                  className="px-btn px-btn-sm bg-berry"
                  disabled={!text.trim()}
                  onClick={() =>
                    void updatePreferences({
                      text: text.trim(),
                      proposal: null,
                    })
                  }
                >
                  采用
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => void updatePreferences({ proposal: null })}
                >
                  忽略
                </button>
              </>
            )}
          />
        </div>
      )}

      <div className="px-card p-3 text-sm">
        <p className="px-title text-[16px]">我的写作偏好</p>
        <p className="mt-1 text-xs text-ink-soft">
          AI 每次整理都会照着这段话写。可以自己写，也可以等 AI
          根据你的修改来提议。
        </p>
        <TextEditor
          key={prefs.text}
          initial={prefs.text}
          rows={6}
          placeholder={
            '例如：\n- 语气平实，不加我没说过的形容\n- 标题不超过 8 个字'
          }
          actions={(text, dirty) => (
            <>
              <button
                type="button"
                className="px-btn px-btn-sm bg-berry"
                disabled={!dirty}
                onClick={() => {
                  void updatePreferences({ text: text.trim() })
                  setSaved(true)
                }}
              >
                保存
              </button>
              {saved && !dirty && (
                <span className="self-center text-xs text-ink-soft">
                  已保存
                </span>
              )}
            </>
          )}
        />
      </div>

      <div className="px-card p-3 text-sm">
        <p className="px-title text-[16px]">带上最近的修改当例子</p>
        <p className="mt-1 text-xs text-ink-soft">
          把你最近改过的稿子给 AI
          看，它会照着你的改法写。自动：你改得少了就不带（更快），又改得多了再带上。
        </p>
        <div className="mt-2 flex gap-2">
          {EXAMPLE_MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={prefs.examples === mode}
              className={`px-btn px-btn-sm ${prefs.examples === mode ? 'bg-ink text-paper' : ''}`}
              onClick={() => void updatePreferences({ examples: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-3">
          现在：
          {withExamples ? (
            <span className="px-tag bg-mint">
              {exampleCount > 0
                ? `带 ${exampleCount} 个例子`
                : '会带，但还没有例子'}
            </span>
          ) : (
            <span className="px-tag">不带例子</span>
          )}
        </p>
      </div>

      <div className="px-card p-3 text-sm">
        <p className="px-title text-[16px]">AI 学得怎么样</p>
        {ratio === null ? (
          <p className="mt-1 text-ink-soft">
            还没有修改记录。你改过 AI 写的稿子后，这里会显示你平均改了多少。
          </p>
        ) : (
          <>
            <p className="mt-1">
              最近 {Math.min(edits.length, LEARNING.window)}{' '}
              次，你平均改动了正文的{' '}
              <span className="px-tag bg-lemon">{percent(ratio)}</span>
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              这个数字越低，说明 AI 写得越合你的意。一共 {edits.length}{' '}
              条修改记录
              {prefs.proposal
                ? '。'
                : untilNext > 0
                  ? `，再改 ${untilNext} 次后 AI 会提出一版新的偏好。`
                  : '，下次打开时 AI 会提出一版新的偏好。'}
            </p>
            <ul className="mt-3 space-y-2">
              {recent.map((e) => (
                <li
                  key={e.id}
                  className="border-l-2 border-dashed border-ink-soft pl-2 text-xs"
                >
                  <p className="text-ink-soft">
                    {dayFmt.format(e.at)} ·{' '}
                    {e.kind === 'choseOwn'
                      ? '改用了自己写的'
                      : `改了 ${percent(changeRatio(e))}`}
                  </p>
                  <p className="mt-0.5 text-ink-soft line-through">
                    {e.draft.intro}
                  </p>
                  <p className="mt-0.5">{e.final.intro}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <AvoidWordsCard />
      <UsageCard />
      <p className="text-center text-xs text-ink-soft">
        足迹手账 v{APP_VERSION}
      </p>
    </section>
  )
}
