import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// 决策 0027 第 4 条：连不上服务端时保存的记录先排队，网络恢复后自动整理

const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url))
const AI_REPLY = {
  title: '山脚下的小面馆',
  category: '美食',
  tags: ['面'],
  placeGuess: null,
  intro: '在山脚下吃了一碗面。',
  clues: { phones: [], plates: [] },
}

test('queues AI organizing while offline and runs it when back online', async ({
  page,
}) => {
  let up = false
  const described: string[] = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!up) return route.abort('internetdisconnected')
    if (path === '/api/health')
      return route.fulfill({
        json: { ok: true, aiConfigured: true, accessRequired: false },
      })
    if (path === '/api/describe') {
      described.push(path)
      return route.fulfill({ json: AI_REPLY })
    }
    return route.fulfill({ status: 404, json: { error: '没准备' } })
  })
  await page.goto('/')

  await page.getByLabel('＋ 选照片').setInputFiles([PHOTO])
  await page.locator('textarea').first().fill('山脚下吃面')
  await expect(page.getByText('现在连不上服务端')).toBeVisible()
  await page.getByRole('button', { name: '联网后让 AI 整理' }).click()
  await expect(page.getByText('等联网后整理')).toBeVisible()
  expect(described).toHaveLength(0)

  // 网络恢复：浏览器发 online 事件，App 重新检查服务端，然后整理排队的记录
  up = true
  await page.evaluate("window.dispatchEvent(new Event('online'))")
  await expect(page.getByText(AI_REPLY.title)).toBeVisible()
  await expect(page.getByText('等联网后整理')).toHaveCount(0)
  expect(described).toHaveLength(1)
})

test('a queued record can be taken off the queue', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await page.goto('/')
  await page.getByLabel('＋ 选照片').setInputFiles([PHOTO])
  await page.locator('textarea').first().fill('不用整理')
  await page.getByRole('button', { name: '直接保存' }).click()
  await expect(page.getByText('等联网后整理')).toBeVisible()
  await page.getByRole('button', { name: '不用整理了' }).click()
  await expect(page.getByText('等联网后整理')).toHaveCount(0)
})
