import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { ShareNote } from '../../shared/shareFormat.ts'
import { db, type JournalRecord, type ShareOptions } from '../db.ts'
import {
  createShare,
  DEFAULT_SHARE,
  readNotes,
  revokeShare,
  shareUrl,
  updateShare,
} from '../lib/follow.ts'
import type { Trip } from '../lib/trips.ts'

// 跟着看的链接（决策 0026），在"回看"里。朋友不用装 App、不用账号，点开链接就能看这次出行

const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
})

export function FollowLinkCard({ trip }: { trip: Trip<JournalRecord> }) {
  const link = useLiveQuery(
    () => db.shares.where('tripId').equals(trip.id).first(),
    [trip.id],
  )
  const [opts, setOpts] = useState<ShareOptions>(DEFAULT_SHARE)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string>()
  const [notes, setNotes] = useState<ShareNote[] | null>(null)
  const [now] = useState(() => Date.now())

  async function run(label: string, job: () => Promise<void>) {
    setBusy(label)
    setMessage(undefined)
    try {
      await job()
    } catch (e) {
      setMessage(
        `${label.replace('…', '')}失败：${e instanceof Error ? e.message : e}`,
      )
    } finally {
      setBusy(null)
    }
  }

  const box = 'mt-3 w-full max-w-md bg-paper p-3 text-sm text-ink'
  if (link) {
    const url = shareUrl(link)
    const expired = link.expiresAt < now
    return (
      <div className={`px-card ${box}`}>
        <p className="px-title text-[16px]">跟着看的链接</p>
        <p className="mt-1 break-all text-xs">{url}</p>
        <p className="mt-1 text-[11px] text-ink-soft">
          {expired
            ? '已经过期，朋友打不开了。'
            : `${dateFmt.format(link.expiresAt)} 过期 · 上次更新 ${dateFmt.format(link.updatedAt)}。拿到链接的人都能看，转发出去别人也能看。`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="px-btn px-btn-sm bg-berry"
            onClick={() =>
              void (async () => {
                if (navigator.share)
                  await navigator
                    .share({ title: '跟着看我的出行', url })
                    .catch(() => {})
                else {
                  await navigator.clipboard.writeText(url)
                  setMessage('链接复制好了。')
                }
              })()
            }
          >
            发给朋友
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={busy !== null || expired}
            onClick={() => void run('更新…', () => updateShare(link, trip))}
          >
            {busy === '更新…' ? '更新中…' : '更新'}
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void run('读留言…', async () => setNotes(await readNotes(link)))
            }
          >
            看留言
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm text-cherry"
            disabled={busy !== null}
            onClick={() =>
              confirm('撤回以后链接马上打不开，留言也一起删掉。撤回吗？') &&
              void run('撤回…', () => revokeShare(link))
            }
          >
            撤回
          </button>
        </div>
        {notes && (
          <ul className="mt-2 space-y-1 text-xs">
            {notes.length === 0 && (
              <li className="text-ink-soft">还没有留言。</li>
            )}
            {notes.map((n) => (
              <li key={n.at}>
                <span className="font-medium">{n.name}</span>：{n.text}
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p role="status" className="mt-2 text-xs">
            {message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={`px-card ${box}`}>
      <p className="px-title text-[16px]">让朋友跟着看</p>
      <p className="mt-1 text-[11px] text-ink-soft">
        生成一个链接，朋友不用装 App
        就能看这次出行，还能留言。内容在手机上加密后才上传，服务端打不开；钥匙只在链接里。
      </p>
      <div className="mt-2 space-y-1 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-ink"
            checked={opts.text}
            onChange={(e) => setOpts({ ...opts, text: e.target.checked })}
          />
          带上正文
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-ink"
            checked={opts.photos}
            onChange={(e) => setOpts({ ...opts, photos: e.target.checked })}
          />
          带上照片（每站最多 3 张）
        </label>
        <label className="flex items-center gap-2">
          位置
          <select
            className="px-input w-40"
            value={opts.precision}
            onChange={(e) =>
              setOpts({
                ...opts,
                precision: e.target.value as ShareOptions['precision'],
              })
            }
          >
            <option value="exact">精确</option>
            <option value="rough">大概（约 5 公里）</option>
            <option value="none">不显示地图</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          有效期
          <select
            className="px-input w-24"
            value={opts.days}
            onChange={(e) =>
              setOpts({
                ...opts,
                days: Number(e.target.value) as ShareOptions['days'],
              })
            }
          >
            <option value={7}>7 天</option>
            <option value={30}>30 天</option>
            <option value={90}>90 天</option>
          </select>
        </label>
        <p className="text-[11px] text-ink-soft">
          隐私区里的地点不带坐标（偏好页设）。
        </p>
      </div>
      <button
        type="button"
        className="px-btn px-btn-sm mt-2 bg-berry"
        disabled={busy !== null}
        onClick={() =>
          void run(
            '生成链接…',
            async () => void (await createShare(trip, opts)),
          )
        }
      >
        {busy ?? '生成链接'}
      </button>
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
