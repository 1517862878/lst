import { expect, test } from '@playwright/test'

/**
 * 真实 API 模式的标签体系旅程。
 *
 * 为什么要单独有一条：标签页用的是 `/api/tags/*`，而作品卡片的作者名依赖
 * 作品载荷里自带的 authorUsername。两者只要有一个不回字段，页面就会退化成
 * 「作者资料暂不可用」——mock 模式看不出来（本地仓储按 id 就能查到），
 * 只有真实 API 才能暴露，所以放在 e2e-api 里。
 */
const BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:4192'

test('热门标签可进详情页，作品卡片的作者链接可点', async ({ page }) => {
  await page.goto(`${BASE}/tags`)
  await expect(page.getByRole('heading', { name: '标签', exact: true })).toBeVisible()

  const chip = page.locator('a[href*="tags/api-e2e"]').first()
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await chip.click()

  await expect(page.getByRole('heading', { name: '#api-e2e', exact: true })).toBeVisible()
  await expect(page.locator('a[href*="/works/"]').first()).toBeVisible({ timeout: 15_000 })

  // 作者必须解析成真链接，而不是降级成「作者资料暂不可用」
  const author = page.locator('a[aria-label^="查看作者"]').first()
  await expect(author).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('作者资料暂不可用')).toHaveCount(0)

  await author.click()
  await expect(page.getByRole('heading', { name: 'API Owner', exact: true })).toBeVisible()
})

test('390px 窄屏下标签页无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/tags/api-e2e`)
  await expect(page.getByRole('heading', { name: '#api-e2e', exact: true })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})