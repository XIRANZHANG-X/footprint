import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Env, KvStore } from './env.ts'

// 跟着看（决策 0026）：存、取、更新、撤回加密后的出行包，留言。
// 服务端只经手加密后的字节，钥匙在链接 # 后面，服务端拿不到。
// 存在 Workers KV（绑定 SHARES）；本机 Node 没有 KV，用内存代替（重启就没了，只为开发和测试）

const MAX_SHARE_BYTES = 25 * 1024 * 1024 // KV 单个值的上限
const MAX_NOTE_CHARS = 3000
const MAX_NOTES = 100
const DAY_S = 86_400
const ALLOWED_DAYS = [7, 30, 90]

type Meta = { exp: number; edit: string }

// 本机用的内存版 KV，只实现用到的几个方法
const memory = new Map<
  string,
  { value: ArrayBuffer | string; meta: unknown; exp: number }
>()
const memoryKv: KvStore = {
  async get(key, type) {
    const e = memory.get(key)
    if (!e || e.exp < Date.now()) return null
    return (type === 'arrayBuffer' ? e.value : String(e.value)) as never
  },
  async getWithMetadata(key, type) {
    const e = memory.get(key)
    if (!e || e.exp < Date.now()) return { value: null, metadata: null }
    return {
      value: (type === 'arrayBuffer' ? e.value : String(e.value)) as never,
      metadata: e.meta as never,
    }
  },
  async put(key, value, opts) {
    memory.set(key, {
      value,
      meta: opts?.metadata ?? null,
      exp: Date.now() + (opts?.expirationTtl ?? 365 * DAY_S) * 1000,
    })
  },
  async delete(key) {
    memory.delete(key)
  },
  async list({ prefix }) {
    return {
      keys: [...memory.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name })),
    }
  },
}

const kv = (env: Env) => env.SHARES ?? memoryKv

const randomId = (n: number) => {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(
    crypto.getRandomValues(new Uint8Array(n)),
    (b) => abc[b % abc.length],
  ).join('')
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

const ID = /^[a-zA-Z0-9]{12}$/
const noindex = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
}

type AppEnv = { Bindings: Env }

export function shareRoutes(
  checkAccess: MiddlewareHandler<AppEnv>,
  lightRate: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>()
  const big = bodyLimit({ maxSize: MAX_SHARE_BYTES })

  async function owned(env: Env, id: string, editKey: string | undefined) {
    if (!ID.test(id) || !editKey) return null
    const { value, metadata } = await kv(env).getWithMetadata<Meta>(
      `share:${id}`,
      'arrayBuffer',
    )
    if (!value || !metadata) return null
    if ((await sha256(editKey)) !== metadata.edit) return null
    return metadata
  }

  // 新建：要访问口令（只有用户自己的 App 能建）
  app.put('/', lightRate, checkAccess, big, async (c) => {
    const days = Number(c.req.query('days'))
    if (!ALLOWED_DAYS.includes(days))
      return c.json({ error: '有效期只能是 7、30、90 天' }, 400)
    const body = await c.req.arrayBuffer()
    if (body.byteLength < 13) return c.json({ error: '内容是空的' }, 400)
    const id = randomId(12)
    const editKey = randomId(24)
    const exp = Date.now() + days * DAY_S * 1000
    await kv(c.env).put(`share:${id}`, body, {
      expirationTtl: days * DAY_S,
      metadata: { exp, edit: await sha256(editKey) } satisfies Meta,
    })
    return c.json({ id, editKey, expiresAt: exp })
  })

  // 更新：同一个链接换成新的内容，有效期不变
  app.put('/:id', lightRate, checkAccess, big, async (c) => {
    const id = c.req.param('id')
    const meta = await owned(c.env, id, c.req.header('X-Edit-Key'))
    if (!meta)
      return c.json({ error: '链接不存在、已过期，或者没有修改权限' }, 404)
    const body = await c.req.arrayBuffer()
    if (body.byteLength < 13) return c.json({ error: '内容是空的' }, 400)
    const ttl = Math.max(60, Math.floor((meta.exp - Date.now()) / 1000))
    await kv(c.env).put(`share:${id}`, body, {
      expirationTtl: ttl,
      metadata: meta,
    })
    return c.json({ id, expiresAt: meta.exp })
  })

  // 撤回：马上删除，连留言一起。只要修改钥匙，口令过期了也能撤
  app.delete('/:id', lightRate, async (c) => {
    const id = c.req.param('id')
    const meta = await owned(c.env, id, c.req.header('X-Edit-Key'))
    if (!meta) return c.json({ error: '链接不存在或没有修改权限' }, 404)
    const store = kv(c.env)
    await store.delete(`share:${id}`)
    const notes = await store.list({ prefix: `note:${id}:` })
    await Promise.all(notes.keys.map((k) => store.delete(k.name)))
    return c.json({ ok: true })
  })

  // 朋友看：不要口令，只限流
  app.get('/:id', lightRate, async (c) => {
    const id = c.req.param('id')
    if (!ID.test(id)) return c.json({ error: '链接不对' }, 404, noindex)
    const { value, metadata } = await kv(c.env).getWithMetadata<Meta>(
      `share:${id}`,
      'arrayBuffer',
    )
    if (!value)
      return c.json({ error: '这个链接已经过期或被撤回' }, 404, noindex)
    return c.body(value as ArrayBuffer, 200, {
      ...noindex,
      'Content-Type': 'application/octet-stream',
      'X-Expires-At': String(metadata?.exp ?? ''),
    })
  })

  // 留言：内容是用同一把钥匙加密过的文本
  app.post(
    '/:id/notes',
    lightRate,
    bodyLimit({ maxSize: 8 * 1024 }),
    async (c) => {
      const id = c.req.param('id')
      if (!ID.test(id)) return c.json({ error: '链接不对' }, 404)
      const { value, metadata } = await kv(c.env).getWithMetadata<Meta>(
        `share:${id}`,
        'arrayBuffer',
      )
      if (!value || !metadata)
        return c.json({ error: '这个链接已经过期或被撤回' }, 404)
      const data = (await c.req.text()).trim()
      if (!/^[A-Za-z0-9_-]{20,}$/.test(data) || data.length > MAX_NOTE_CHARS)
        return c.json({ error: '留言格式不对' }, 400)
      const store = kv(c.env)
      const existing = await store.list({ prefix: `note:${id}:` })
      if (existing.keys.length >= MAX_NOTES)
        return c.json({ error: '留言满了' }, 429)
      const ttl = Math.max(60, Math.floor((metadata.exp - Date.now()) / 1000))
      await store.put(`note:${id}:${Date.now()}-${randomId(4)}`, data, {
        expirationTtl: ttl,
      })
      return c.json({ ok: true })
    },
  )

  app.get('/:id/notes', lightRate, async (c) => {
    const id = c.req.param('id')
    if (!ID.test(id)) return c.json({ notes: [] }, 200, noindex)
    const store = kv(c.env)
    const list = await store.list({ prefix: `note:${id}:` })
    const notes = (
      await Promise.all(
        list.keys.slice(0, MAX_NOTES).map(async (k) => ({
          at: Number(k.name.split(':')[2].split('-')[0]),
          data: await store.get(k.name, 'text'),
        })),
      )
    ).filter(
      (n): n is { at: number; data: string } => typeof n.data === 'string',
    )
    return c.json({ notes: notes.sort((a, b) => a.at - b.at) }, 200, noindex)
  })

  return app
}
