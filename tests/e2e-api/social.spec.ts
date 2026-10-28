/**
 * 第二期社交闭环：真实 API 模式浏览器旅程。
 *
 * 与 mock E2E 的分工：mock 侧验证「没有后端也能用」，这里验证
 * 「接了真实 PostgreSQL 之后，关注/通知/动态流确实跨账号生效」——
 * 单测与集成测试都只能验证单侧，跨账号可见性必须在浏览器里走一遍。
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
const PASSWORD = 'ApiE2e-pass-2026'
const OWNER = 'api_owner'
const OTHER = 'api_other'

async function signIn(page: Page, username: string, next: string): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}

async function freshPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext()
  return { page: await context.newPage(), close: () => context.close() }
}

test('关注跨账号生效：被关注者收到通知，关注者动态流能看到作品', async ({ browser }) => {
  // 1) 游客点关注应该被送到登录页并带回跳，而不是静默失败
  const guest = await freshPage(browser)
  try {
    await guest.page.goto(`/u/${OWNER}`)
    await guest.page.getByRole('button', { name: '关注', exact: true }).click()
    await expect(guest.page.getByLabel('用户名')).toBeVisible()
    expect(guest.page.url()).toContain(encodeURIComponent(`/u/${OWNER}`))
  } finally {
    await guest.close()
  }

  // 2) api_other 关注 api_owner
  const other = await freshPage(browser)
  try {
    await signIn(other.page, OTHER, `/u/${OWNER}`)
    // 关注按钮与「关注数」统计按钮都含「关注」二字，必须 exact 才不会撞 strict mode：
    // 统计按钮的可访问名是「N 关注」，精确匹配「关注」只命中前者。
    const followButton = other.page.getByRole('button', { name: /^(关注|已关注)$/, exact: true })
    if ((await followButton.getAttribute('aria-pressed')) !== 'true') {
      await followButton.click()
    }
    await expect(other.page.getByRole('button', { name: '已关注', exact: true })).toBeVisible()
    // 刷新后仍然是已关注：证明写进了数据库，不是前端乐观状态
    await other.page.reload()
    await expect(other.page.getByRole('button', { name: '已关注', exact: true })).toBeVisible()
    // 幂等：再点一次取消，再关注回来，计数不应错乱
    await other.page.getByRole('button', { name: '已关注', exact: true }).click()
    await expect(other.page.getByRole('button', { name: '关注', exact: true })).toBeVisible()
    await other.page.getByRole('button', { name: '关注', exact: true }).click()
    await expect(other.page.getByRole('button', { name: '已关注', exact: true })).toBeVisible()

    // 3) 关注者的动态流能看到对方的已发布作品
    await other.page.goto('/feed')
    // 空态标题是「关注动态还是空的」，与页面标题「关注动态」同含该词，必须 exact
    await expect(other.page.getByRole('heading', { name: '关注动态', exact: true })).toBeVisible()
    await expect(other.page.locator(`a[href="/works/${PHOTO_ID}"]`).first()).toBeVisible()
  } finally {
    await other.close()
  }

  // 4) 被关注者的通知铃铛有未读，通知页能看到这条关注
  const owner = await freshPage(browser)
  try {
    await signIn(owner.page, OWNER, '/')
    const bell = owner.page.getByRole('link', { name: /^通知，[1-9]\d* 条未读$/ })
    await expect(bell).toBeVisible()
    await bell.click()
    await expect(owner.page.getByRole('heading', { name: '通知' })).toBeVisible()
    // 通知条里展示的是对方的显示名（API Other），不是登录名（api_other）；
    // 用「查看 … 的主页」这个链接的可访问名断言最稳，不依赖排版细节。
    await expect(owner.page.getByRole('link', { name: '查看 API Other 的主页' }).first()).toBeVisible()
    await expect(owner.page.getByText('关注了你').first()).toBeVisible()
    // 看过之后未读清零：铃铛读屏文案回到「通知」
    await owner.page.getByRole('link', { name: '通知' }).first().waitFor()
    await expect(owner.page.getByRole('link', { name: /^通知，[1-9]\d* 条未读$/ })).toHaveCount(0)
  } finally {
    await owner.close()
  }
})

test('390px 窄屏下新页面无横向溢出，且通知铃铛键盘可达', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const page = await context.newPage()
  try {
    await signIn(page, OWNER, '/')
    for (const path of ['/feed', '/notifications', `/u/${OWNER}`]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(0)
    }
    // 键盘：Tab 能走到通知入口（可聚焦、有可读名字）
    await page.goto('/feed')
    await page.keyboard.press('Tab')
    let focused = ''
    for (let i = 0; i < 12; i += 1) {
      focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      if (focused.startsWith('通知')) break
      await page.keyboard.press('Tab')
    }
    expect(focused.startsWith('通知'), `Tab 序里没找到通知入口，最后聚焦 aria-label=${focused}`).toBe(true)
  } finally {
    await context.close()
  }
})
