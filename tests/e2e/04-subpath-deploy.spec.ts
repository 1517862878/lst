/**
 * 子路径部署回归测试（对应 GitHub Pages /lst/ 的真实部署形态）。
 *
 * 为什么单独写这个文件：
 *   项目部署在 https://<user>.github.io/lst/ 子路径下，本地开发默认 base='/'。
 *   两者行为不同 —— S8 部署后整站落到 404 页，就是因为 router 没设 basename。
 *   这类问题在 base='/' 的测试里永远测不出来。
 *
 * 注意路径写法：
 *   baseURL 设为 http://127.0.0.1:4180/lst 时，page.goto('/gallery') 会解析成
 *   http://127.0.0.1:4180/gallery（丢掉 /lst）。所以这里统一用 url() 拼完整地址。
 *
 * 运行：VITE_BASE=/lst/ pnpm build && node scripts/postbuild.mjs && pnpm test:e2e:subpath
 */
import { expect, test } from '@playwright/test'

const BASE = (process.env.E2E_SUBPATH_URL ?? 'http://127.0.0.1:4180/lst').replace(/\/+$/, '')

/** 访问子路径下的相对路径（避免 baseURL 拼接丢前缀） */
const url = (path = '/') => BASE + path

test.describe('子路径部署（/lst/）', () => {
  test('首页正常渲染，不落到 404', async ({ page }) => {
    await page.goto(url('/'))
    // 关键断言：不能是 NotFound 页
    await expect(page.getByText('页面未找到')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.locator('a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
  })

  test('各主路由都能打开（basename 生效）', async ({ page }) => {
    // 用 as const 让元组类型收紧，避免 strict 模式下解构出 string | undefined
    const routes = [
      ['/gallery', '作品墙'],
      ['/categories', '分类总览'],
      ['/rankings/weekly', '本周排行榜'],
      ['/learn', '学习板块'],
      ['/login', '登录'],
    ] as const
    for (const [path, heading] of routes) {
      await page.goto(url(path))
      await expect(page.getByText('页面未找到')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 })
    }
  })

  test('内部链接保留 /lst/ 前缀', async ({ page }) => {
    await page.goto(url('/gallery'))
    await expect(page.locator('a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
    const hrefs = await page
      .locator('a[href*="/works/"]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    // 所有作品链接都应带部署前缀，否则点进去会 404
    for (const h of hrefs) expect(h.startsWith('/lst/')).toBe(true)
  })

  test('搜索结果链接保留 /lst/ 前缀', async ({ page }) => {
    await page.goto(url('/search?q=' + encodeURIComponent('星空')))
    await expect(page.locator('main a[href*="/works/"]').first()).toBeVisible({ timeout: 20_000 })
    const links = await page
      .locator('main a[href*="/works/"]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('href') ?? ''))
    expect(links.length).toBeGreaterThan(0)
    for (const h of links) expect(h.startsWith('/lst/')).toBe(true)
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
