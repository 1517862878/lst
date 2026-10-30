/**
 * 8.4d 每周主题与活动 —— 真实 API 模式浏览器旅程。
 *
 * 与 mock E2E 的分工：那边验证「没有后端也能用」（含演示种子的完整旅程），
 * 这里验证「接了真实 PostgreSQL + SECURITY DEFINER 函数之后，编辑身份判定、
 * 投稿、精选与跨账号通知确实生效」——单测与集成测试只能验证单侧，
 * 跨账号可见性必须在浏览器里走一遍。
 *
 * 账号由 scripts/api-e2e-harness.mjs 的种子（server/src/api-e2e-seed.ts）提供：
 *   api_owner（作者）/ api_editor（编辑，role=editor），密码 ApiE2e-pass-2026；
 *   种子已建好进行中的主题 api-e2e-weekly（窗口跨过现在）。
 * 跨账号用两个 context（真 API 的会话在各自 Cookie 里，必须隔离）。
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const PASSWORD = 'ApiE2e-pass-2026'
const OWNER = 'api_owner'
const EDITOR = 'api_editor'
const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
const THEME_SLUG = 'api-e2e-weekly'
const THEME_TITLE = 'API 每周主题'
const WORK_TITLE = 'API 原标题'

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  return context.newPage()
}

async function signIn(page: Page, username: string, next = '/gallery'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe(next.split('?')[0])
}

test('作者投稿 → 编辑精选 → 作者收到精选通知且看到徽标', async ({ browser }) => {
  // 1) 游客能看到主题列表与详情（公开读，无需登录）
  const guest = await freshPage(browser)
  await guest.goto('/themes')
  await expect(guest.getByRole('heading', { name: '每周主题', exact: true })).toBeVisible()
  await expect(guest.locator(`a[href="/themes/${THEME_SLUG}"]`).first()).toBeVisible({ timeout: 15_000 })
  await guest.locator(`a[href="/themes/${THEME_SLUG}"]`).first().click()
  await expect(guest.getByRole('heading', { name: THEME_TITLE, level: 1 })).toBeVisible()
  await guest.context().close()

  // 2) 作者在作品详情页投稿（作品属于 api_owner 且已发布）
  const owner = await freshPage(browser)
  await signIn(owner, OWNER, `/works/${PHOTO_ID}`)
  await expect(owner.getByRole('button', { name: /^投稿到主题/ })).toBeVisible({ timeout: 15_000 })
  await owner.getByRole('button', { name: /^投稿到主题/ }).click()
  const dialog = owner.getByRole('dialog')
  await expect(dialog.getByText(`投稿到「${THEME_TITLE}」`)).toBeVisible()
  await dialog.getByRole('button', { name: `投稿《${WORK_TITLE}》` }).click()
  await expect(owner.getByText(`《${WORK_TITLE}》已投稿到「${THEME_TITLE}」`)).toBeVisible({ timeout: 15_000 })

  // 3) 主题详情页出现这篇投稿，且「我的投稿」区块列出它
  await owner.goto(`/themes/${THEME_SLUG}`)
  await expect(owner.getByRole('heading', { name: THEME_TITLE, level: 1 })).toBeVisible()
  await expect(owner.getByText(WORK_TITLE).first()).toBeVisible()
  await expect(owner.getByText('我的投稿 1 件')).toBeVisible()

  // 4) 编辑在审核台「主题」Tab 里把这篇投稿设为精选
  const editor = await freshPage(browser)
  await signIn(editor, EDITOR, '/admin')
  await editor.getByRole('tab', { name: /^主题/ }).click()
  await editor.getByRole('button', { name: `管理《${THEME_TITLE}》的投稿` }).click()
  const entries = editor.getByRole('list', { name: '主题投稿' })
  await entries.getByRole('button', { name: `把《${WORK_TITLE}》设为精选` }).click()
  await expect(editor.getByText(`已把《${WORK_TITLE}》设为精选，作者会收到通知`)).toBeVisible({
    timeout: 15_000,
  })

  // 5) 作者刷新详情页看到精选徽标，并在通知中心收到精选通知
  await owner.reload()
  await expect(owner.getByText('编辑精选').first()).toBeVisible()
  await owner.goto('/notifications')
  await expect(owner.getByText(`《${WORK_TITLE}》入选主题「${THEME_TITLE}」精选`)).toBeVisible({
    timeout: 15_000,
  })

  await owner.context().close()
  await editor.context().close()
})

test('390px 窄屏下主题页无横向溢出', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    await page.goto(`/themes/${THEME_SLUG}`)
    await expect(page.getByRole('heading', { name: THEME_TITLE, level: 1 })).toBeVisible({
      timeout: 15_000,
    })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  } finally {
    await context.close()
  }
})
