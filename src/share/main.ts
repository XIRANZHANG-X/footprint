import '../index.css'
import {
  openNote,
  sealNote,
  unpackShare,
  type ShareManifest,
  type ShareStop,
} from '../../shared/shareFormat.ts'
import { drawRouteSketch } from '../lib/shareImage.ts'

// 朋友看的页面（决策 0026）：不用装 App、不用账号。
// 链接是 /s/<编号>#k=<钥匙>：编号拿去取加密包，钥匙只在 # 后面，不会发给服务器，在这里解密。
// 不加载 App 本身的代码

const root = document.getElementById('root')!
const id =
  /\/s\/([A-Za-z0-9]{12})/.exec(location.pathname)?.[1] ??
  new URLSearchParams(location.search).get('id')
const key = new URLSearchParams(location.hash.slice(1)).get('k')

const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const dayFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )

function fail(text: string) {
  root.innerHTML = `<div class="px-card mt-10 p-4 text-sm"><p class="px-title text-[18px]">打不开</p><p class="mt-2">${esc(text)}</p></div>`
}

type Photo = { url: string; width: number; height: number }
type Stop = ShareStop & { urls: Photo[] }

async function main() {
  if (!id || !key)
    return fail('链接不完整：可能复制时少了后半段（# 后面的部分）。')
  let res: Response
  try {
    res = await fetch(`/api/share/${id}`)
  } catch {
    return fail('连不上服务器，请检查网络后刷新。')
  }
  if (res.status === 404)
    return fail('这个链接已经过期，或者被分享的人撤回了。')
  if (!res.ok) return fail(`服务器出错了（${res.status}），稍后再试。`)
  let manifest: ShareManifest
  let stops: Stop[]
  try {
    const opened = await unpackShare(
      key,
      new Uint8Array(await res.arrayBuffer()),
    )
    manifest = opened.manifest
    stops = manifest.stops.map((s) => ({
      ...s,
      urls: s.photos.map((p) => ({
        url: URL.createObjectURL(
          new Blob([opened.photo(p) as Uint8Array<ArrayBuffer>], {
            type: 'image/jpeg',
          }),
        ),
        width: p.width,
        height: p.height,
      })),
    }))
  } catch {
    return fail('解不开：链接可能被改过，或者钥匙不完整。')
  }
  render(manifest, stops)
}

function render(m: ShareManifest, stops: Stop[]) {
  document.title = `${m.title} · 跟着看`
  const located = stops.filter((s) => s.lat !== null && s.lng !== null)
  root.innerHTML = `
    <header class="px-card p-4">
      <p class="px-title text-[22px]">${esc(m.title)}</p>
      <p class="mt-1 text-sm text-ink-soft">${esc(m.stats)}</p>
      <p class="mt-2 text-[11px] text-ink-soft">用「足迹手账」分享的出行 · ${dayFmt.format(m.expiresAt)}前可以看 · 最后更新 ${dateFmt.format(m.updatedAt)}</p>
      ${stops.length ? '<button id="story" type="button" class="px-btn px-btn-sm mt-3 bg-berry">一站一站翻</button>' : ''}
    </header>
    ${
      m.showMap && located.length
        ? '<canvas id="route" width="1080" height="860" class="mt-4 w-full border-2 border-ink bg-paper" aria-label="路线示意图"></canvas>'
        : ''
    }
    <section class="mt-4 space-y-4">
      ${stops
        .map(
          (s, i) => `
        <article class="px-card p-3">
          <p class="font-pixel text-[12px] text-ink-soft">第 ${i + 1} 站 · ${dateFmt.format(s.date)}</p>
          <p class="px-title mt-1 text-[18px]">${esc(s.title)}</p>
          <p class="mt-1 flex flex-wrap gap-1 text-xs">
            ${s.place ? `<span class="px-tag bg-sky">${esc(s.place)}</span>` : ''}
            ${s.weather ? `<span class="px-tag">${esc(s.weather)}</span>` : ''}
          </p>
          ${s.body ? `<p class="mt-2 whitespace-pre-wrap text-sm">${esc(s.body)}</p>` : ''}
          ${s.urls.map((p) => `<img src="${p.url}" alt="" class="mt-2 w-full border-2 border-ink" loading="lazy" />`).join('')}
        </article>`,
        )
        .join('')}
    </section>
    <section class="px-card mt-6 p-3 text-sm">
      <p class="px-title text-[16px]">留言</p>
      <ul id="notes" class="mt-2 space-y-1 text-sm"><li class="text-ink-soft">加载中…</li></ul>
      <form id="note-form" class="mt-3 space-y-2">
        <input name="name" class="px-input w-full" placeholder="你的名字" maxlength="20" required aria-label="你的名字" />
        <textarea name="text" class="px-input w-full" rows="2" placeholder="说一句（只有拿到这个链接的人能看到）" maxlength="200" required aria-label="留言"></textarea>
        <button type="submit" class="px-btn px-btn-sm bg-berry">留言</button>
        <p id="note-msg" role="status" class="text-xs"></p>
      </form>
    </section>
    <p class="mt-6 text-center text-[11px] text-ink-soft">内容在分享人的手机上加密，服务器打不开；拿到链接的人都能看。</p>`

  const canvas = document.getElementById('route') as HTMLCanvasElement | null
  if (canvas) {
    const ctx = canvas.getContext('2d')!
    void document.fonts.load('30px "Fusion Pixel"', '足迹').finally(() =>
      drawRouteSketch(
        ctx,
        {
          paths: m.paths,
          stops: located.map((s) => ({
            lat: s.lat!,
            lng: s.lng!,
            label: s.title.slice(0, 8),
          })),
        },
        { x: 0, y: 0, w: 1080, h: 860 },
      ),
    )
  }
  document
    .getElementById('story')
    ?.addEventListener('click', () => story(stops, 0))
  void loadNotes()
  document.getElementById('note-form')!.addEventListener('submit', (e) => {
    e.preventDefault()
    void sendNote(e.target as HTMLFormElement)
  })
}

// 一站一站翻：全屏，点右边下一站，点左边上一站
function story(stops: Stop[], start: number) {
  const layer = document.createElement('div')
  layer.setAttribute('role', 'dialog')
  layer.setAttribute('aria-modal', 'true')
  layer.setAttribute('aria-label', '一站一站翻')
  layer.className = 'fixed inset-0 z-50 flex flex-col bg-ink text-paper'
  document.body.append(layer)
  let i = start
  const show = () => {
    const s = stops[i]
    const photo = s.urls[0]
    layer.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 text-sm">
        <span class="font-pixel text-[12px]">${i + 1} / ${stops.length}</span>
        <button type="button" data-close class="px-btn px-btn-sm">关闭</button>
      </div>
      <div class="relative flex-1 overflow-hidden" data-tap>
        ${photo ? `<img src="${photo.url}" alt="" class="absolute inset-0 h-full w-full object-contain" />` : ''}
      </div>
      <div class="bg-paper p-4 text-ink">
        <p class="font-pixel text-[12px] text-ink-soft">${dateFmt.format(s.date)}${s.place ? ` · ${esc(s.place)}` : ''}${s.weather ? ` · ${esc(s.weather)}` : ''}</p>
        <p class="px-title mt-1 text-[18px]">${esc(s.title)}</p>
        ${s.body ? `<p class="mt-1 max-h-32 overflow-y-auto text-sm">${esc(s.body)}</p>` : ''}
        <p class="mt-2 text-[11px] text-ink-soft">点图片右边看下一站，左边看上一站</p>
      </div>`
  }
  const close = () => {
    layer.remove()
    document.removeEventListener('keydown', onKey)
  }
  const go = (d: number) => {
    i = Math.min(stops.length - 1, Math.max(0, i + d))
    show()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowRight') go(1)
    if (e.key === 'ArrowLeft') go(-1)
  }
  layer.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('[data-close]')) return close()
    const tap = t.closest('[data-tap]') as HTMLElement | null
    if (!tap) return
    const r = tap.getBoundingClientRect()
    go(e.clientX - r.left > r.width / 2 ? 1 : -1)
  })
  document.addEventListener('keydown', onKey)
  show()
}

async function loadNotes() {
  const list = document.getElementById('notes')!
  try {
    const { notes } = (await (
      await fetch(`/api/share/${id}/notes`)
    ).json()) as {
      notes: { data: string }[]
    }
    const opened = []
    for (const n of notes)
      try {
        opened.push(await openNote(key!, n.data))
      } catch {
        // 打不开的跳过
      }
    list.innerHTML = opened.length
      ? opened
          .map(
            (n) =>
              `<li><span class="font-medium">${esc(n.name)}</span>：${esc(n.text)}<span class="ml-1 text-[11px] text-ink-soft">${dateFmt.format(n.at)}</span></li>`,
          )
          .join('')
      : '<li class="text-ink-soft">还没有留言。</li>'
  } catch {
    list.innerHTML = '<li class="text-ink-soft">留言加载失败。</li>'
  }
}

async function sendNote(form: HTMLFormElement) {
  const data = new FormData(form)
  const name = String(data.get('name') ?? '')
    .trim()
    .slice(0, 20)
  const text = String(data.get('text') ?? '')
    .trim()
    .slice(0, 200)
  const msg = document.getElementById('note-msg')!
  if (!name || !text) return
  try {
    const body = await sealNote(key!, { name, text, at: Date.now() })
    const res = await fetch(`/api/share/${id}/notes`, { method: 'POST', body })
    if (!res.ok)
      throw new Error(((await res.json()) as { error?: string }).error)
    form.reset()
    msg.textContent = '留言好了。'
    void loadNotes()
  } catch (e) {
    msg.textContent = `没留上：${e instanceof Error ? e.message : e}`
  }
}

void main()
