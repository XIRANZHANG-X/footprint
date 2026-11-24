import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// 界面冒烟测试（决策 0019 第 6 条）：新建、编辑、删除和撤销、备份导出再导入、生成分享图、AI 整理。
// 每个测试是一个全新的浏览器环境（数据库是空的），/api 一律用假数据回答

const photo = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const PHOTOS = [photo('photo.jpg'), photo('photo2.jpg')]

const AI_REPLY = {
  title: '排队一小时的牛肉面',
  category: '美食',
  tags: ['面', '排队'],
  placeGuess: null,
  intro: '排了一小时，汤很浓。',
  clues: { phones: [], plates: [] },
}

async function stubApi(page: Page, { ai = false } = {}) {
  const calls: string[] = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    if (path === '/api/health')
      return route.fulfill({
        json: { ok: true, aiConfigured: ai, accessRequired: false },
      })
    if (path === '/api/describe')
      return route.fulfill({
        json: AI_REPLY,
        headers: {
          'X-AI-Usage': JSON.stringify([
            {
              model: 'qwen3-vl-plus',
              inputTokens: 900,
              outputTokens: 80,
              seconds: null,
            },
          ]),
        },
      })
    return route.fulfill({
      status: 404,
      json: { error: '测试里没准备这个接口' },
    })
  })
  return calls
}

// 选两张照片、写一句话、直接保存，回到时间线
async function addRecord(page: Page, note: string) {
  await page.getByLabel('＋ 选照片').setInputFiles(PHOTOS)
  await page.locator('textarea').first().fill(note)
  await page.getByRole('button', { name: '直接保存' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '已保存' }),
  ).toContainText('已保存 2 张')
  await expect(page.getByText(note).first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
})

test('creates a record from photos and a sentence', async ({ page }) => {
  await stubApi(page)
  await page.goto('/')
  await addRecord(page, '第一次来这家面馆')
  await expect(page.getByRole('button', { name: /看大图/ })).toHaveCount(2)
})

test('edits the title and body', async ({ page }) => {
  await stubApi(page)
  await page.goto('/')
  await addRecord(page, '原来的话')
  await page.getByRole('button', { name: '编辑' }).click()
  await page
    .getByRole('textbox', { name: '标题', exact: true })
    .fill('改过的标题')
  await page
    .getByRole('textbox', { name: '正文', exact: true })
    .fill('改过的正文')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('改过的标题')).toBeVisible()
  await expect(page.getByText('改过的正文')).toBeVisible()
})

test('deletes a record and undoes it', async ({ page }) => {
  await stubApi(page)
  await page.goto('/')
  await addRecord(page, '要删掉的记录')
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除这条记录')).toBeVisible()
  await expect(page.getByText('要删掉的记录')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.getByText('要删掉的记录').first()).toBeVisible()
})

test('exports a backup and imports it back', async ({ page }) => {
  await stubApi(page)
  await page.goto('/')
  await addRecord(page, '要备份的记录')

  await page.getByRole('button', { name: '备份', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份（zip）' }).click()
  const file = await (await download).path()
  await expect(
    page.getByRole('status').filter({ hasText: '已导出' }),
  ).toContainText('已导出 1 条记录')

  // 删掉这条记录（不撤销），再从备份导入
  await page.getByRole('button', { name: '时间线' }).click()
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('要备份的记录')).toHaveCount(0)
  await page.getByRole('button', { name: '备份', exact: true }).click()
  await page.getByLabel('从备份导入').setInputFiles(file)
  await expect(
    page.getByRole('status').filter({ hasText: '已导入' }),
  ).toContainText('已导入 1 条记录、2 张照片')
  await page.getByRole('button', { name: '时间线' }).click()
  await expect(page.getByText('要备份的记录').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /看大图/ })).toHaveCount(2)
})

test('generates a share image', async ({ page }) => {
  await stubApi(page)
  await page.goto('/')
  await addRecord(page, '要分享的记录')
  await page.getByRole('button', { name: '生成分享图' }).click()
  const dialog = page.getByRole('dialog', { name: '分享图预览' })
  await expect(dialog.getByAltText('分享图预览').first()).toBeVisible({
    timeout: 15_000,
  })
  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toHaveCount(0)
})

test('lets AI write the record (fake model reply)', async ({ page }) => {
  const calls = await stubApi(page, { ai: true })
  await page.goto('/')
  await page.getByLabel('＋ 选照片').setInputFiles(PHOTOS)
  await page.locator('textarea').first().fill('排了一小时')
  await page.getByRole('button', { name: '让 AI 整理' }).click()
  await expect(page.getByText(AI_REPLY.title)).toBeVisible()
  await expect(page.getByText(AI_REPLY.intro)).toBeVisible()
  expect(calls).toContain('/api/describe')
  // 这次调用记进了用量（决策 0016 第 3 条）
  await page.getByRole('button', { name: '偏好' }).click()
  await expect(page.getByText('AI 用量')).toBeVisible()
})
