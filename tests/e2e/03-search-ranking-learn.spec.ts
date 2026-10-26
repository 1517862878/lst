/**
 * 主链路 3：搜索 → 周榜 → 教程（ROADMAP G-4 第三条）
 *
 * 覆盖：
 *   搜索关键词并验证高亮与结果 → 周榜页验证排名/分数/规则公开
 *   → 学习板块打开文章并验证正文渲染
 */
import { expect, test } from '@playwright/test'
import { resetApp } from './utils'

test.describe('主链路 3 · 搜索、榜单与学习', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('搜索关键词返回结果并高亮匹配文字', async ({ page }) => {
    await page.goto('/search?q=星空')
    await expect(page.getByRole('heading', { name: '搜索' })).toBeVisible()

    // 关键词回填到输入框（URL 即状态）
    await expect(page.getByLabel('关键词')).toHaveValue('星空')

    // 有结果或有明确空态，二者必有其一（种子数据里应有结果）
    const cards = page.locator('a[href^="/works/"]')
    await expect(cards.first()).toBeVisible({ timeout: 20_000 })

    // 高亮：搜索页会用 <mark> 包裹命中词
    const markCount = await page.locator('mark').count()
    expect(markCount).toBeGreaterThan(0)
  })

  test('搜索无结果时显示空态而不是空白页', async ({ page }) => {
    // 用 encodeURIComponent 保证中文关键词在地址栏里正确传递
    await page.goto(`/search?q=${encodeURIComponent('zzzz不存在的关键词zzzz')}`)
    await expect(page.getByRole('heading', { name: '搜索' })).toBeVisible()
    // 应出现空态提示与结果计数，而不是留白
    await expect(page.getByText(/没有匹配结果/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/共 0 个结果/)).toBeVisible()
  })

  test('周榜页展示排名、分数与公开的计分规则', async ({ page }) => {
    await page.goto('/rankings/weekly')
    await expect(page.getByRole('heading', { name: '本周排行榜' })).toBeVisible()

    // 规则公开：页面上必须能看到计分公式说明
    await expect(page.getByText(/点赞.*收藏.*加权|1.*赞.*3.*藏|公式/).first()).toBeVisible()

    // 榜单是一个有序列表（RankingTable 用 <ol class="g-ranking-list">）
    const rows = page.locator('ol.g-ranking-list > li')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })

    // 第一名的得分应大于 0 —— 这是种子数据有效性的关键断言：
    // 若互动数据散布过广导致本周窗口内几乎无互动，这里会失败
    const firstRowText = await rows.first().innerText()
    const scoreMatch = /得分\s*([\d.]+)/.exec(firstRowText)
    expect(scoreMatch).not.toBeNull()
    expect(Number(scoreMatch![1])).toBeGreaterThan(0)
  })

  test('历史周榜可访问（结果恒定）', async ({ page }) => {
    // 取一个过去周的 ISO 周号；不硬编码具体周，用当年第 1 周
    const year = new Date().getUTCFullYear()
    const isoWeek = `${year}-W01`
    await page.goto(`/rankings/weekly/${isoWeek}`)
    // 页面要么有历史榜数据，要么有明确提示，不能报错白屏
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('Application error')
  })

  test('学习板块可打开文章并渲染正文', async ({ page }) => {
    await page.goto('/learn')
    await expect(page.getByRole('heading', { name: '学习' }).first()).toBeVisible()

    // 进入任一篇文章
    const articleLink = page.locator('a[href^="/learn/"]:not([href="/learn"])').first()
    await expect(articleLink).toBeVisible({ timeout: 20_000 })
    await articleLink.click()

    // 文章页应有标题与正文（正文容器非空）
    await expect(page).toHaveURL(/\/learn\/.+/)
    await expect(page.locator('h1')).toBeVisible()
    const main = await page.locator('main, article').first().innerText()
    expect(main.length).toBeGreaterThan(100)
  })

  test('法律页可访问且条款非空', async ({ page }) => {
    for (const path of ['/terms', '/privacy', '/copyright', '/dmca', '/licenses', '/community']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      const text = await page.locator('body').innerText()
      // 条款页不应只有标题占位
      expect(text.length).toBeGreaterThan(200)
    }
  })
})
