import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// 决策 0029 第 3 条：多设备同步。两个浏览器环境当两台设备（各自的数据库），
// 网盘是测试里的一个假 WebDAV（内存里的文件），检查：加密上传、另一台设备拿到记录和照片、
// 删除同步过去、同步口令不对会拒绝、网盘上看不到明文

const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url))
const DAV = 'https://dav.example.test/dav/'

type File = { text: string; etag: string }
function fakeDav() {
  const files = new Map<string, File>()
  let n = 0
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, OPTIONS',
    'Access-Control-Expose-Headers': 'ETag',
  }
  const attach = async (ctx: BrowserContext) => {
    await ctx.route(`${DAV}**`, async (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname
      const method = req.method()
      if (method === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors })
      if (!req.headers()['authorization']?.startsWith('Basic '))
        return route.fulfill({ status: 401, headers: cors })
      if (method === 'MKCOL')
        return route.fulfill({ status: 201, headers: cors })
      const f = files.get(path)
      if (method === 'GET')
        return f
          ? route.fulfill({
              status: 200,
              body: f.text,
              headers: { ...cors, ETag: f.etag },
            })
          : route.fulfill({ status: 404, headers: cors })
      if (method === 'DELETE') {
        files.delete(path)
        return route.fulfill({ status: 204, headers: cors })
      }
      if (method === 'PUT') {
        const h = req.headers()
        if (h['if-none-match'] === '*' && f)
          return route.fulfill({ status: 412, headers: cors })
        if (h['if-match'] && h['if-match'] !== f?.etag)
          return route.fulfill({ status: 412, headers: cors })
        const etag = `"v${++n}"`
        files.set(path, { text: req.postData() ?? '', etag })
        return route.fulfill({ status: 201, headers: { ...cors, ETag: etag } })
      }
      return route.fulfill({ status: 405, headers: cors })
    })
    // 服务端不可用：只测同步
    await ctx.route('**/api/**', (r) =>
      r.fulfill({
        json: { ok: true, aiConfigured: false, accessRequired: false },
      }),
    )
  }
  return { files, attach }
}

async function device(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage()
  page.on('dialog', (d) => void d.accept())
  await page.goto('/')
  return page
}

async function syncWith(page: Page, passphrase: string) {
  await page.getByRole('button', { name: '备份', exact: true }).click()
  const card = page.getByLabel('多设备同步')
  await expect(
    card.getByRole('button', { name: /保存并同步|现在同步/ }),
  ).toBeVisible()
  if (await card.locator('form').count()) {
    await card.getByLabel('网盘地址').fill(DAV)
    await card.getByLabel('账号').fill('me@example.test')
    await card.getByLabel(/应用密码/).fill('app-password')
    await card.getByLabel(/同步口令/).fill(passphrase)
    await card.getByRole('button', { name: '保存并同步' }).click()
  } else await card.getByRole('button', { name: '现在同步' }).click()
  return card.getByRole('status')
}

test('two devices sync records, photos and deletions through encrypted WebDAV', async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const dav = fakeDav()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  await dav.attach(ctxA)
  await dav.attach(ctxB)

  // 设备 A：一条带照片的记录、一条只有文字的，同步上去
  const a = await device(ctxA)
  await a.getByLabel('＋ 选照片').setInputFiles([PHOTO])
  await a.locator('textarea').first().fill('A 拍的照片')
  await a.getByRole('button', { name: '直接保存' }).click()
  await expect(a.getByText('A 拍的照片').first()).toBeVisible()
  await a.getByRole('button', { name: '只写几句' }).click()
  await a.locator('textarea').first().fill('A 写的要删掉')
  await a.getByRole('button', { name: '直接保存' }).click()
  await expect(a.getByText('A 写的要删掉').first()).toBeVisible()
  await expect(await syncWith(a, 'long sync passphrase')).toContainText(
    '同步好了',
  )

  // 网盘上只有密文
  const all = [...dav.files.values()].map((f) => f.text).join('\n')
  expect(all).not.toContain('A 拍的照片')
  expect([...dav.files.keys()].some((k) => k.includes('/photos/'))).toBe(true)

  // 设备 C：口令不对，拒绝
  const ctxC = await browser.newContext()
  await dav.attach(ctxC)
  const c = await device(ctxC)
  await expect(await syncWith(c, 'a wrong passphrase')).toContainText(
    '同步口令和网盘上的不一致',
  )

  // 设备 B：拿到两条记录和照片；删掉一条，再记一条，同步
  const b = await device(ctxB)
  await expect(await syncWith(b, 'long sync passphrase')).toContainText(
    '1 张照片',
  )
  await b.getByRole('button', { name: '时间线' }).click()
  await expect(b.getByText('A 拍的照片').first()).toBeVisible()
  await expect(b.locator('img[alt]').first()).toBeVisible()
  const doomed = b.locator('article', { hasText: 'A 写的要删掉' })
  await doomed.getByRole('button', { name: '删除' }).click()
  await expect(b.getByText('A 写的要删掉')).toHaveCount(0)
  await b.getByRole('button', { name: '只写几句' }).click()
  await b.locator('textarea').first().fill('B 新记的')
  await b.getByRole('button', { name: '直接保存' }).click()
  await expect(b.getByText('B 新记的').first()).toBeVisible()
  await expect(await syncWith(b, '')).toContainText('同步好了')

  // 回到设备 A：多了 B 的记录，删掉的那条也没了
  await expect(await syncWith(a, '')).toContainText('删掉 1 条')
  await a.getByRole('button', { name: '时间线' }).click()
  await expect(a.getByText('B 新记的').first()).toBeVisible()
  await expect(a.getByText('A 写的要删掉')).toHaveCount(0)
  await expect(a.getByText('A 拍的照片').first()).toBeVisible()
})
