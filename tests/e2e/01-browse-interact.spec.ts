/**
 * 主链路 1：浏览 → 点赞 → 收藏 → 评论（ROADMAP G-4 第一条）
 *
 * 覆盖用户真实路径：
 *   游客进首页 → 进作品墙 → 打开详情 → 点赞（跳登录）→ 登录 → 回跳 → 点赞成功
 *   → 收藏 → 发评论 → 评论出现在列表
 *
 * 这条链路同时也是「动态化后页面零改动」的验收基准：
 *   后面把数据层从 mock 换成 Supabase，这个文件必须原样通过。
 */
import { expect, test } from '@playwright/test'
import { DEMO, SEED_PHOTO_ID, resetApp, signIn } from './utils'

test.describe('主链路 1 · 浏览与互动', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('游客可浏览首页、作品墙与详情页', async ({ page }) => {
    // 首页：三个板块都应有内容
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible()

    // 首页作品卡同时提供作品入口与真实作者入口，且两者不是嵌套链接。
    const authorLink = page.locator('.g-photo-card a[href^="/u/"]').first()
    await expect(authorLink).toBeVisible()
    const authorName = await authorLink.locator('.g-author-link-name').textContent()
    expect(authorName?.trim()).toBeTruthy()
    expect(authorName?.trim()).not.toBe('示例素材')
    await expect(authorLink.locator('a')).toHaveCount(0)

    // 榜单入口与分类入口存在
    await expect(page.locator('a[href*="/rankings/weekly"]').first()).toBeVisible()
    await expect(page.locator('a[href="/categories"]').first()).toBeVisible()

    // 作品墙
    await page.goto('/gallery')
    await expect(page.getByRole('heading', { name: '作品墙' })).toBeVisible()
    const gridCards = await page.locator('a[href^="/works/"]').count()
    expect(gridCards).toBeGreaterThan(0)

    // 排序切换：最热（URL 即状态）
    await page.getByRole('button', { name: '最热' }).click()
    await expect(page).toHaveURL(/sort=popular/)
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible()

    // 视图切换：瀑布流
    await page.getByRole('button', { name: /瀑布流/ }).click()
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible()

    // 详情页：标题、EXIF 面板、相关作品
    await page.goto(`/works/${SEED_PHOTO_ID}`)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByText('作品墙', { exact: true }).first()).toBeVisible() // 面包屑
    await expect(page.getByRole('heading', { name: '相关作品' })).toBeVisible()

    // 详情页作者卡可识别真实作者，并进入正确个人主页。
    const detailAuthorLink = page.locator('.g-work-info a[href^="/u/"]')
    await expect(detailAuthorLink).toBeVisible()
    const expectedProfilePath = await detailAuthorLink.getAttribute('href')
    expect(expectedProfilePath).toMatch(/^\/u\/[^/]+$/)
    await detailAuthorLink.click()
    await expect(page).toHaveURL(new RegExp(`${expectedProfilePath}$`))
    await expect(page.locator('h1')).toBeVisible()
  })

  test('未登录点赞会跳转登录，登录后回跳到原作品', async ({ page }) => {
    await page.goto(`/works/${SEED_PHOTO_ID}`)
    await expect(page.locator('h1')).toBeVisible()

    // 未登录点「点赞」→ 应跳登录并带上 next
    await page.getByRole('button', { name: /^点赞/ }).click()
    await expect(page).toHaveURL(/\/login\?next=/)
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()

    // 一键填入演示账号并登录
    await page.getByRole('button', { name: new RegExp(DEMO.alice.displayName) }).click()
    await page.getByRole('button', { name: '登录', exact: true }).click()

    // 关键断言：登录后回到被点赞的作品详情，而不是首页
    await expect(page).toHaveURL(new RegExp(`/works/${SEED_PHOTO_ID}`))
  })

  test('登录后可点赞、取消点赞、收藏，计数随之变化', async ({ page }) => {
    await signIn(page, 'alice', `/works/${SEED_PHOTO_ID}`)
    await expect(page).toHaveURL(new RegExp(`/works/${SEED_PHOTO_ID}`))

    const likeBtn = page.getByRole('button', { name: /^点赞/ })
    const favBtn = page.getByRole('button', { name: /^收藏/ })
    await expect(likeBtn).toBeVisible()

    const readNum = async (loc: typeof likeBtn) =>
      Number((await loc.textContent())?.replace(/\D/g, '') ?? '0')

    // 等数据就绪
    await expect.poll(() => readNum(likeBtn)).toBeGreaterThanOrEqual(0)

    // 注意：种子数据里 alice 可能已赞过该作品，所以初始状态两者皆有可能。
    // 这里不假设初始值，而是断言「点击后状态翻转，且计数同步 ±1」。
    const likedBefore = (await likeBtn.getAttribute('aria-pressed')) === 'true'
    const likeBefore = await readNum(likeBtn)

    await likeBtn.click()
    if (likedBefore) {
      // 原本已赞 → 点击是取消：计数 -1，状态变 false
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
      await expect.poll(() => readNum(likeBtn), { timeout: 15_000 }).toBe(likeBefore - 1)
      // 再点回来，恢复原状
      await likeBtn.click()
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => readNum(likeBtn), { timeout: 15_000 }).toBe(likeBefore)
    } else {
      // 原本未赞 → 点击是点赞：计数 +1，状态变 true
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => readNum(likeBtn), { timeout: 15_000 }).toBe(likeBefore + 1)
      // 取消点赞，恢复原状
      await likeBtn.click()
      await expect(likeBtn).toHaveAttribute('aria-pressed', 'false')
      await expect.poll(() => readNum(likeBtn), { timeout: 15_000 }).toBe(likeBefore)
    }

    // 收藏：同样处理初始状态
    const favBefore = (await favBtn.getAttribute('aria-pressed')) === 'true'
    const favCount = await readNum(favBtn)
    await favBtn.click()
    await expect(favBtn).toHaveAttribute('aria-pressed', favBefore ? 'false' : 'true')
    await expect
      .poll(() => readNum(favBtn), { timeout: 15_000 })
      .toBe(favBefore ? favCount - 1 : favCount + 1)
  })

  test('登录后可发评论，评论立即出现在列表', async ({ page }) => {
    await signIn(page, 'bob', `/works/${SEED_PHOTO_ID}`)
    await expect(page.locator('h1')).toBeVisible()

    const body = `E2E 自动化评论 ${Date.now()}`
    const box = page.getByLabel('发表评论')
    await box.fill(body)
    await page.getByRole('button', { name: '发表评论' }).click()

    // 断言：评论出现在列表中
    await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 })
    // 输入框应被清空（成功后重置）
    await expect(box).toHaveValue('')
  })

  test('未登录时评论区提示先登录', async ({ page }) => {
    await page.goto(`/works/${SEED_PHOTO_ID}`)
    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByText(/请先.*登录.*后再评论/)).toBeVisible()
    // 未登录不应出现评论输入框
    await expect(page.getByLabel('发表评论')).toHaveCount(0)
  })
})
