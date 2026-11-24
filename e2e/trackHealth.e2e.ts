import { expect, test } from '@playwright/test'

// 决策 0030：记录体检。用一个假的安卓桥（window.androidBridge + Capacitor.nativePromise）冒充 App，
// 让后台服务"交出"一段带断档、最后被系统停掉的记录，检查体检显示的内容和按品牌给的设置路径

test('shows the tracking checkup with gaps, kill and brand tips', async ({
  page,
}) => {
  await page.route('**/api/**', (r) =>
    r.fulfill({
      json: { ok: true, aiConfigured: false, accessRequired: false },
    }),
  )
  await page.addInitScript(() => {
    const T0 = new Date('2026-11-25T08:00').getTime()
    const m = (x: number) => T0 + x * 60_000
    const ev = (x: number, e: string, bat: number) => ({
      ev: e,
      t: m(x),
      bat,
      chg: false,
      scr: false,
      precise: false,
      prov: 'gps:on,network:none',
    })
    let drained = false
    const lines = [
      ev(0, 'start', 90),
      ev(15, 'hb', 90),
      ev(30, 'hb', 90),
      ev(45, 'hb', 89),
      ev(60, 'hb', 89),
      ev(75, 'hb', 89),
      // 75 → 150 断了
      ev(150, 'hb', 88),
      ev(240, 'lost', 87),
      { t: m(20), lat: 30.25, lng: 120.15, acc: 25, p: 'gps' },
      { t: m(40), lat: 30.26, lng: 120.16, acc: 35, p: 'passive' },
    ]
    const tracker: Record<string, () => unknown> = {
      getStatus: () => ({
        running: false,
        precise: false,
        startedAt: m(0),
        pending: 0,
        brand: 'xiaomi',
      }),
      drain: () => {
        const out = drained ? [] : lines
        drained = true
        return { points: out }
      },
      openBatterySettings: () => ({}),
    }
    const w = globalThis as unknown as Record<string, unknown>
    w.androidBridge = { postMessage: () => {} }
    // 真机上安卓自带的桥接脚本会先定义好这些
    w.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      PluginHeaders: [
        {
          name: 'Tracker',
          methods: Object.keys(tracker).map((name) => ({
            name,
            rtype: 'promise',
          })),
        },
      ],
      nativePromise: async (plugin: string, method: string) => {
        if (plugin === 'Tracker' && tracker[method]) return tracker[method]()
        throw new Error(`${plugin}.${method} 在测试里没准备`)
      },
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: '地图', exact: true }).click()

  const toggle = page.getByRole('button', { name: /记录体检/ })
  await expect(toggle).toContainText('有断档')
  await toggle.click()
  await expect(page.getByText(/之后被系统停了/)).toBeVisible()
  await expect(page.getByText(/断了 75 分钟/)).toBeVisible()
  await expect(page.getByText(/没有网络定位/)).toBeVisible()
  await expect(page.getByText(/2 个点（GPS 1 · 借别的 App 1）/)).toBeVisible()
  await expect(
    page.getByText('让小米 / 红米别在后台停掉足迹手账：'),
  ).toBeVisible()
  await expect(page.getByText(/省电策略，选"无限制"/)).toBeVisible()
  await page.screenshot({
    path: 'test-results/track-health.png',
    fullPage: false,
  })
})
