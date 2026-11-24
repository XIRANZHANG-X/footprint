import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { newShareKey, openNote, packShare } from '../shared/shareFormat.ts'

// 跟着看（决策 0026）：朋友看的页面能解密、能翻、能留言；App 里能生成链接。服务端都是假的
const ID = 'AbCdEfGh2345'

test('friends can open, flip through and comment on a shared trip', async ({
  page,
}) => {
  const key = newShareKey()
  const jpeg = await readFile(
    fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url)),
  )
  const sealed = await packShare(key, {
    v: 1,
    title: '杭州 · 上海',
    stats: '11月3日 – 11月4日 · 2 天 · 2 条',
    createdAt: 1,
    updatedAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
    showMap: true,
    paths: [
      {
        long: false,
        points: [
          { lat: 30.26, lng: 120.15 },
          { lat: 31.24, lng: 121.49 },
        ],
      },
    ],
    stops: [
      {
        title: '断桥',
        date: Date.now() - 86_400_000,
        place: '西湖',
        weather: '☀️ 晴 20°C',
        body: '人不多，慢慢走',
        lat: 30.26,
        lng: 120.15,
        photos: [{ bytes: new Uint8Array(jpeg), width: 640, height: 480 }],
      },
      {
        title: '外滩',
        date: Date.now(),
        place: null,
        weather: null,
        body: null,
        lat: 31.24,
        lng: 121.49,
        photos: [],
      },
    ],
  })
  const posted: string[] = []
  await page.route('**/api/share/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/api/share/${ID}`)
      return route.fulfill({ body: Buffer.from(sealed) })
    if (url.pathname === `/api/share/${ID}/notes`) {
      if (route.request().method() === 'POST') {
        posted.push(route.request().postData() ?? '')
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({
        json: { notes: posted.map((data, i) => ({ at: i, data })) },
      })
    }
    return route.fulfill({ status: 404, json: { error: 'x' } })
  })

  await page.goto(`/share.html?id=${ID}#k=${key}`)
  await expect(page.getByText('杭州 · 上海')).toBeVisible()
  await expect(page.getByText('人不多，慢慢走')).toBeVisible()
  await expect(page.getByLabel('路线示意图')).toBeVisible()

  await page.getByRole('button', { name: '一站一站翻' }).click()
  const story = page.getByRole('dialog', { name: '一站一站翻' })
  await expect(story.getByText('1 / 2')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(story.getByText('2 / 2')).toBeVisible()
  await story.getByRole('button', { name: '关闭' }).click()

  await page.getByLabel('你的名字').fill('小王')
  await page.getByLabel('留言').fill('好看！')
  await page.getByRole('button', { name: '留言', exact: true }).click()
  await expect(page.getByText('留言好了。')).toBeVisible()
  // 发出去的是加密过的，用同一把钥匙能解开
  expect(posted[0]).not.toContain('好看')
  expect((await openNote(key, posted[0])).text).toBe('好看！')
})

test('a wrong key or a revoked link shows a clear message', async ({
  page,
}) => {
  await page.route('**/api/share/**', (route) =>
    route.fulfill({ status: 404, json: { error: '过期' } }),
  )
  await page.goto(`/share.html?id=${ID}#k=${newShareKey()}`)
  await expect(
    page.getByText('这个链接已经过期，或者被分享的人撤回了。'),
  ).toBeVisible()
  await page.goto(`/share.html?id=${ID}`)
  await expect(page.getByText(/链接不完整/)).toBeVisible()
})

test('the app creates an encrypted link from a trip', async ({ page }) => {
  let uploaded = 0
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/health')
      return route.fulfill({
        json: { ok: true, aiConfigured: false, accessRequired: false },
      })
    if (url.pathname === '/api/share' && route.request().method() === 'PUT') {
      uploaded = route.request().postDataBuffer()?.length ?? 0
      return route.fulfill({
        json: { id: ID, editKey: 'edit-key-test', expiresAt: Date.now() + 1e9 },
      })
    }
    return route.fulfill({ status: 404, json: { error: '没准备' } })
  })
  page.on('dialog', (d) => void d.accept())
  await page.goto('/')
  await page
    .getByLabel('＋ 选照片')
    .setInputFiles(
      fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url)),
    )
  await page.locator('textarea').first().fill('要分享的一站')
  await page.getByRole('button', { name: '直接保存' }).click()
  await page.getByRole('button', { name: '回看' }).click()
  const dialog = page.getByRole('dialog', { name: '回看这次出行' })
  await dialog.getByRole('button', { name: '生成链接' }).click()
  await expect(dialog.getByText(new RegExp(`/s/${ID}#k=`))).toBeVisible()
  expect(uploaded).toBeGreaterThan(1000) // 带着照片，加密后的包
})
