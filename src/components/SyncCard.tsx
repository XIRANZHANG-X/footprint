import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db.ts'
import { isNativeApp } from '../lib/saveFile.ts'
import {
  SYNC_CONFIG_KEY,
  SYNC_STATUS_KEY,
  type SyncConfig,
  type SyncReport,
} from '../lib/sync/sync.ts'

// 多设备同步（决策 0029 第 3 条）：加密后存到自己的 WebDAV 网盘。
// 账号、应用密码和同步口令只存在这台设备里，不进同步、不进备份
const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const EMPTY: SyncConfig = {
  url: 'https://dav.jianguoyun.com/dav/',
  user: '',
  password: '',
  passphrase: '',
}

export function SyncCard() {
  const saved = useLiveQuery(
    async () =>
      ((await db.settings.get(SYNC_CONFIG_KEY))?.value as SyncConfig) ?? null,
  )
  const status = useLiveQuery(
    async () =>
      ((await db.settings.get(SYNC_STATUS_KEY))?.value as SyncReport) ?? null,
  )
  const [form, setForm] = useState<SyncConfig | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  if (saved === undefined) return null

  const editing = form ?? (saved ? null : EMPTY)
  const set =
    (k: keyof SyncConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...(editing ?? EMPTY), [k]: e.target.value })

  const run = async (config: SyncConfig) => {
    setBusy('开始…')
    setMessage(undefined)
    try {
      const { syncNow } = await import('../lib/sync/sync.ts')
      const r = await syncNow(config, undefined, setBusy)
      await db.settings.put({ key: SYNC_CONFIG_KEY, value: config })
      setForm(null)
      setMessage({
        ok: true,
        text: `同步好了：从网盘拿到 ${r.pulled} 处更新、${r.pulledPhotos} 张照片，删掉 ${r.removed} 条，传上去 ${r.pushedPhotos} 张照片。`,
      })
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-card space-y-2 p-3 text-sm" aria-label="多设备同步">
      <p className="px-title text-[16px]">多设备同步</p>
      <p className="text-xs text-ink-soft">
        加密后存到你自己的 WebDAV 网盘（如坚果云），本项目的服务端不经手。
        {!isNativeApp() &&
          '浏览器一般不允许网页直接访问网盘，网页版多半连不上，请在安卓 App 里同步。'}
      </p>

      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(editing)
          }}
        >
          <label className="block">
            <span className="font-pixel text-[12px] text-ink-soft">
              网盘地址
            </span>
            <input
              className="px-input w-full"
              value={editing.url}
              onChange={set('url')}
              required
            />
          </label>
          <label className="block">
            <span className="font-pixel text-[12px] text-ink-soft">账号</span>
            <input
              className="px-input w-full"
              value={editing.user}
              onChange={set('user')}
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            <span className="font-pixel text-[12px] text-ink-soft">
              应用密码（坚果云在"安全选项"里生成，不是登录密码）
            </span>
            <input
              className="px-input w-full"
              type="password"
              value={editing.password}
              onChange={set('password')}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="block">
            <span className="font-pixel text-[12px] text-ink-soft">
              同步口令（自己设，每台设备都要输同一个；忘了就解不开网盘上的数据）
            </span>
            <input
              className="px-input w-full"
              type="password"
              value={editing.passphrase}
              onChange={set('passphrase')}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-btn px-btn-sm bg-mint"
              disabled={busy !== null}
            >
              {busy ?? '保存并同步'}
            </button>
            {saved && (
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => setForm(null)}
              >
                取消
              </button>
            )}
          </div>
        </form>
      ) : (
        saved && (
          <>
            <p className="text-xs">
              {saved.user} @ {saved.url}
              {status && `，上次同步 ${timeFmt.format(status.at)}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-btn px-btn-sm bg-mint"
                disabled={busy !== null}
                onClick={() => void run(saved)}
              >
                {busy ?? '现在同步'}
              </button>
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => setForm(saved)}
              >
                改设置
              </button>
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => {
                  if (
                    confirm(
                      '停用同步？这台设备会忘掉网盘账号和同步口令，网盘上的数据不动。',
                    )
                  )
                    void db.settings.bulkDelete([
                      SYNC_CONFIG_KEY,
                      SYNC_STATUS_KEY,
                    ])
                }}
              >
                停用
              </button>
            </div>
          </>
        )
      )}
      {message && (
        <p
          className={`text-xs ${message.ok ? '' : 'text-cherry'}`}
          role="status"
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
