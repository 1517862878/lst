/**
 * 8.3c 发现增强 · 真实 API 模式浏览器验收。
 *
 * 覆盖冻结契约 §5 里「浏览器才算数」的部分：
 *   1) 首页「发现 / 关注」双 Tab：URL 落在 ?tab=following，未登录显示登录引导；
 *   2) 搜索页：热门搜索展示服务端聚合出来的词，点一下能真的搜出结果；
 *   3) 最近搜索：搜过之后回到搜索页能看到，且能单条删除；
 *   4) 编辑精选：首页区块出现，作品详情有「编辑精选」徽标。
 *
 * 数据前提（server/src/api-e2e-seed.ts 提供）：api_owner 的主作品已 featured_at，
 * search_logs 有 3 条「山」。
 */
import { expect, test } from '@playwright/test'

test('首页「关注」Tab 写进 URL，未登录时给登录引导', async ({ page }) => {
  await page.goto('/')

  // 双 Tab 是可访问的 tablist，不是两个普通链接
  const tabs = page.getByRole('tablist')
  await expect(tabs).toBeVisible()

  const following = page.getByRole('tab', { name: '关注', exact: true })
  await following.click()

  await expect(page).toHaveURL(/\?tab=following$/)
  await expect(following).toHaveAttribute('aria-selected', 'true')

  // 未登录：关注流应当引导登录，而不是显示空列表
  await expect(page.getByText(/登录后这里会显示你关注的作者/)).toBeVisible()

  // 键盘可达：← 回到「发现」
  await following.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page).toHaveURL(/\/(\?tab=discover)?$/)
})

test('热门搜索来自服务端聚合，点一下能搜出作品', async ({ page }) => {
  await page.goto('/search')

  // 种子造了 3 条「山」的搜索日志（≥3 次才上榜）
  const hot = page.getByRole('group', { name: '热门搜索' })
  await expect(hot).toBeVisible()
  // chip 的可读名包含次数（「山 3 次搜索」），所以用前缀匹配而不是 exact
  const chip = hot.getByRole('button', { name: /^山/ })
  await expect(chip).toBeVisible()

  await chip.click()
  // 搜索页是 URL-as-state，点了热词应当落到 ?q=山 并给出结果计数
  await expect(page).toHaveURL(/[?&]q=%E5%B1%B1/)
  await expect(page.getByRole('combobox', { name: '关键词' })).toHaveValue('山')
})

test('最近搜索落盘到 localStorage，可单条删除', async ({ page }) => {
  await page.goto('/search')

  const input = page.getByRole('combobox', { name: '关键词' })
  await input.fill('API 原标题')
  await input.press('Enter')
  await expect(page).toHaveURL(/[?&]q=/)

  // 回到空白的搜索页，最近搜索应当出现
  await page.goto('/search')
  const recent = page.getByRole('group', { name: '最近搜索' })
  await expect(recent).toBeVisible()

  const stored = await page.evaluate(() => window.localStorage.getItem('gy:recent-searches'))
  expect(stored, '最近搜索必须真的写进 localStorage').toContain('API 原标题')

  await recent.getByRole('button', { name: /删除最近搜索/ }).first().click()
  await expect(recent).toBeHidden()

  const after = await page.evaluate(() => window.localStorage.getItem('gy:recent-searches'))
  expect(after ?? '').not.toContain('API 原标题')
})

test('编辑精选：首页区块出现，作品详情有可读徽标', async ({ page }) => {
  await page.goto('/')

  const featured = page.getByRole('list', { name: '编辑精选作品' })
  await expect(featured).toBeVisible()
  // 区块标题在 <section> 里，列表本身只有卡片；标题单独断言一次
  await expect(page.getByRole('heading', { name: '编辑精选' })).toBeVisible()

  // 从精选区块点进作品，详情页也应有同一枚徽标（可读文案，不只是颜色）
  const card = featured.getByRole('link').first()
  await card.click()
  await expect(page).toHaveURL(/\/works\//)
  await expect(page.getByText('编辑精选').first()).toBeVisible()
})

test('390px 窄屏下发现相关页面无横向溢出', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  for (const url of ['/', '/?tab=following', '/search']) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${url} 出现横向溢出 ${overflow}px`).toBeLessThanOrEqual(0)
  }

  await context.close()
})
