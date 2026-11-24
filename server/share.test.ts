import { describe, expect, it } from 'vitest'
import {
  newShareKey,
  openNote,
  packShare,
  sealNote,
  unpackShare,
} from '../shared/shareFormat.ts'
import { createApp } from './app.ts'

// 跟着看（决策 0026）。本机没有 KV，服务端用内存代替
const app = createApp({ requireAccessToken: false })

const manifest = {
  v: 1 as const,
  title: '杭州',
  stats: '2 天',
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 2,
  showMap: true,
  paths: [],
  stops: [
    {
      title: '断桥',
      date: 5,
      place: '西湖',
      weather: null,
      body: '人不多',
      lat: 30.26,
      lng: 120.15,
      photos: [
        { bytes: new Uint8Array([1, 2, 3]), width: 3, height: 1 },
        { bytes: new Uint8Array([9, 8]), width: 2, height: 1 },
      ],
    },
  ],
}

describe('share format', () => {
  it('round-trips the manifest and photos, and fails with the wrong key', async () => {
    const key = newShareKey()
    const sealed = await packShare(key, manifest)
    const { manifest: m, photo } = await unpackShare(key, sealed)
    expect(m.title).toBe('杭州')
    expect(Array.from(photo(m.stops[0].photos[1]))).toEqual([9, 8])
    await expect(unpackShare(newShareKey(), sealed)).rejects.toThrow()
    // 明文里的字不会出现在密文里
    expect(new TextDecoder().decode(sealed)).not.toContain('断桥')
  })

  it('seals notes with the same key', async () => {
    const key = newShareKey()
    const data = await sealNote(key, { name: '小王', text: '好看', at: 3 })
    expect(await openNote(key, data)).toEqual({
      name: '小王',
      text: '好看',
      at: 3,
    })
  })
})

describe('share routes', () => {
  const put = (body: Uint8Array, days = 30) =>
    app.request(`/api/share?days=${days}`, { method: 'PUT', body }, {})

  it('stores, serves, updates and revokes an encrypted share', async () => {
    const key = newShareKey()
    const sealed = await packShare(key, manifest)
    const created = (await (await put(sealed)).json()) as {
      id: string
      editKey: string
    }
    expect(created.id).toMatch(/^[a-zA-Z0-9]{12}$/)

    const got = await app.request(`/api/share/${created.id}`, {}, {})
    expect(got.headers.get('X-Robots-Tag')).toContain('noindex')
    const back = new Uint8Array(await got.arrayBuffer())
    expect((await unpackShare(key, back)).manifest.stops[0].title).toBe('断桥')

    // 没有修改钥匙不能更新、不能删
    const wrong = await app.request(
      `/api/share/${created.id}`,
      { method: 'PUT', body: sealed, headers: { 'X-Edit-Key': 'nope' } },
      {},
    )
    expect(wrong.status).toBe(404)

    // 留言
    const note = await sealNote(key, { name: '小王', text: '好看', at: 3 })
    expect(
      (
        await app.request(
          `/api/share/${created.id}/notes`,
          { method: 'POST', body: note },
          {},
        )
      ).status,
    ).toBe(200)
    const notes = (await (
      await app.request(`/api/share/${created.id}/notes`, {}, {})
    ).json()) as { notes: { data: string }[] }
    expect((await openNote(key, notes.notes[0].data)).text).toBe('好看')

    // 撤回以后连留言一起没了
    const del = await app.request(
      `/api/share/${created.id}`,
      { method: 'DELETE', headers: { 'X-Edit-Key': created.editKey } },
      {},
    )
    expect(del.status).toBe(200)
    expect((await app.request(`/api/share/${created.id}`, {}, {})).status).toBe(
      404,
    )
    const after = (await (
      await app.request(`/api/share/${created.id}/notes`, {}, {})
    ).json()) as { notes: unknown[] }
    expect(after.notes).toEqual([])
  })

  it('only allows the fixed expiry choices and rejects junk notes', async () => {
    expect((await put(new Uint8Array(20), 5)).status).toBe(400)
    const { id } = (await (await put(new Uint8Array(20))).json()) as {
      id: string
    }
    expect(
      (
        await app.request(
          `/api/share/${id}/notes`,
          { method: 'POST', body: '<script>' },
          {},
        )
      ).status,
    ).toBe(400)
  })
})
