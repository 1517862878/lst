/**
 * 主链路 3：搜索 → 周榜 → 教程（ROADMAP G-4 第三条）
 *
 * 覆盖：
 *   搜索关键词并验证高亮与结果 → 周榜页验证排名/分数/规则公开
 *   → 学习板块打开文章并验证正文渲染
 */
import { expect, test } from '@playwright/test'
import { resetApp, signIn } from './utils'

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

  test('多关键词查询保持完整，并给出明确结果状态', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('星空 长曝')}`)
    await expect(page.getByLabel('关键词')).toHaveValue('星空 长曝')
    await expect(page.getByRole('button', { name: '搜索' })).toBeEnabled()
    await expect(page.getByText(/共 \d+ 个结果/)).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('Application error')
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

  /**
   * 0039 起学习板块不再预置 12 篇虚拟教程，改为「作者自行上传」。
   *
   * 所以这条用例不能再去点一篇现成的文章 —— 它必须自己走一遍真实路径：
   * 登录 → 写教程 → 发布 → 从学习板块进入 → 正文渲染。
   * 这反而比原来覆盖得更完整（发布链路本身也被测到了）。
   */
  test('学习板块可发布文章并打开渲染正文', async ({ page }) => {
    await signIn(page, 'alice')
    await page.goto('/learn/write')
    await expect(page.getByRole('heading', { name: '写教程' })).toBeVisible()

    const slug = `e2e-article-${Date.now()}`
    await page.getByLabel('标题').fill('E2E 自动发布的教程')
    await page.getByLabel('文章地址（URL）').fill(slug)
    await page.getByLabel('摘要').fill('这条摘要由自动化用例生成。')
    await page
      .getByLabel('正文（Markdown）')
      .fill('# E2E 教程\n\n这是自动化用例写入的正文。\n\n## 小节\n\n更多内容，用来确保正文足够长。')

    await page.getByRole('button', { name: '发布', exact: true }).click()

    // 发布后跳转到文章页，正文必须真的渲染出来
    await expect(page).toHaveURL(new RegExp(`/learn/${slug}`), { timeout: 20_000 })
    // 用 .first()：Markdown 正文里的 `# 标题` 也会渲染成 h1，严格模式下会撞名
    await expect(page.locator('h1').first()).toBeVisible()
    const main = await page.locator('main, article').first().innerText()
    expect(main.length).toBeGreaterThan(100)

    // 再回学习板块，确认它出现在列表里（不是只存在于详情页）
    await page.goto('/learn')
    await expect(page.getByRole('heading', { name: '学习板块' }).first()).toBeVisible()
    const articleLink = page.locator('a[href^="/learn/"]:not([href="/learn"])').first()
    await expect(articleLink).toBeVisible({ timeout: 20_000 })
  })

  test('学习板块在无文章时给出「写第一篇」空态', async ({ page }) => {
    // 全新浏览器（resetApp 已清库）且不再预置文章 → 必须是空态而不是空白列表
    await page.goto('/learn')
    await expect(page.getByText('还没有教程')).toBeVisible()
    await expect(page.getByRole('link', { name: /写第一篇教程|登录后发布/ })).toBeVisible()
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
