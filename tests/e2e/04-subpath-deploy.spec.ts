/**
 * 子路径部署回归测试（对应 GitHub Pages /lst/ 的真实部署形态）。
 *
 * 为什么单独写这个文件：
 *   项目部署在 https://<user>.github.io/lst/ 子路径下，本地开发默认 base='/'。
 *   两者行为不同 —— S8 部署后整站落到 404 页，就是因为 router 没设 basename。
 *   这类问题在 base='/' 的测试里永远测不出来。
 *
 * 生产构建使用 hash 路由：真实 HTTP 请求始终停在 /lst/，避免 GitHub Pages
 * 对 /lst/login、/lst/register 这类深链先返回 404。页面路由位于 # 后面。
 *
 * 运行：VITE_BASE=/lst/ VITE_USE_HASH_ROUTER=1 pnpm build && node scripts/postbuild.mjs && pnpm test:e2e:subpath
 */
import { expect, test } from '@playwright/test'

const BASE = (process.env.E2E_SUBPATH_URL ?? 'http://127.0.0.1:4180/lst').replace(/\/+$/, '')

/** 访问生产 hash 路由；根页直接访问 /lst/，其它页面统一放在 # 后。 */
const url = (path = '/') => (path === '/' ? BASE + '/' : `${BASE}/#${path}`)

test.describe('子路径部署（/lst/）', () => {
  test('首页正常渲染，不落到 404', async ({ page }) => {
    await page.goto(url('/'))
    // 关键断言：不能是 NotFound 页
    await expect(page.getByText('页面未找到')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.locator('a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
  })

  test('各主路由都能通过 hash 地址打开', async ({ page }) => {
    // 用 as const 让元组类型收紧，避免 strict 模式下解构出 string | undefined
    const routes = [
      ['/gallery', '作品墙'],
      ['/categories', '分类总览'],
      ['/rankings/weekly', '本周排行榜'],
      ['/learn', '学习板块'],
      ['/login', '登录'],
      ['/register', '注册'],
      // 外观设置是本轮新增页面：hash 路由 + /lst/ 前缀下必须同样可达
      ['/appearance', '外观设置'],
    ] as const
    for (const [path, heading] of routes) {
      // 首次访问会收到文档响应；同一文档内后续只改变 hash，Playwright 正确返回 null。
      // HTTP 200 已由首页用例覆盖，这里验证每个 hash 路由实际渲染。
      await page.goto(url(path))
      await expect(page.getByText('页面未找到')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 })
    }
  })

  test('页头提供独立登录与注册入口，两个页面可以互相切换', async ({ page }) => {
    await page.goto(url('/'))
    await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '注册', exact: true })).toBeVisible()

    await page.getByRole('link', { name: '注册', exact: true }).click()
    await expect(page).toHaveURL(/#\/register$/)
    await expect(page.getByRole('heading', { name: '注册', exact: true })).toBeVisible()

    await page.getByRole('link', { name: '返回登录' }).click()
    await expect(page).toHaveURL(/#\/login$/)
    await expect(page.getByRole('link', { name: '立即注册' })).toBeVisible()
  })

  test('内部链接保留 /lst/ 前缀并使用 hash 路由', async ({ page }) => {
    await page.goto(url('/gallery'))
    await expect(page.locator('a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
    const hrefs = await page
      .locator('a[href*="/works/"]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    // HashRouter 生成根相对链接（#/works/...）；浏览器解析后真实请求仍留在 /lst/。
    for (const h of hrefs) expect(h.startsWith('#/works/')).toBe(true)
  })

  test('搜索结果链接保留 /lst/ 前缀', async ({ page }) => {
    await page.goto(url('/search?q=' + encodeURIComponent('星空')))
    await expect(page.locator('main a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
    const links = await page
      .locator('main a[href*="/works/"]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('href') ?? ''))
    expect(links.length).toBeGreaterThan(0)
    for (const h of links) expect(h.startsWith('#/works/')).toBe(true)
  })

  test('外观设置在子路径下可切换并持久化', async ({ page }) => {
    await page.goto(url('/appearance'))
    await expect(page.getByRole('heading', { name: '外观设置', level: 1 })).toBeVisible({ timeout: 20_000 })

    // 切配色 + 切字体，刷新后仍是同一套（验证 base 前缀不影响 localStorage）
    await page.getByText('P4 碳灰霓虹').click()
    await page.getByText('现代无衬线').click()
    await page.reload()
    await expect(page.getByRole('heading', { name: '外观设置', level: 1 })).toBeVisible({ timeout: 20_000 })

    const markers = await page.evaluate(() => ({
      palette: document.documentElement.dataset.palette,
      font: document.documentElement.dataset.font,
    }))
    expect(markers.palette).toBe('p4')
    expect(markers.font).toBe('sans')

    // 390px 下不溢出（子路径形态一并验收）
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByRole('heading', { name: '外观设置', level: 1 })).toBeVisible({ timeout: 20_000 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('个人主页可用（Tabs 不崩溃）', async ({ page }) => {
    await page.goto(url('/u/alice'))
    await expect(page.getByText(/Application Error|TabsContent/)).toHaveCount(0)
    await expect(page.locator('h1')).toContainText('爱丽丝', { timeout: 20_000 })
  })

  test('周榜得分不为 0（周窗口计算正确）', async ({ page }) => {
    await page.goto(url('/rankings/weekly'))
    const rows = page.locator('ol.g-ranking-list > li')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    const first = await rows.first().innerText()
    const m = /得分\s*([\d.]+)/.exec(first)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(0)
  })
})
