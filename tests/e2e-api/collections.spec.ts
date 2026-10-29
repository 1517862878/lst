/**
 * 收藏夹的真 API 浏览器旅程（8.3b）。
 *
 * 与 mock 单测的分工：那边验「看不到就别露出」的逻辑分支，这里验真实链路——
 * Cookie 会话 + CSRF + SECURITY DEFINER 函数的可见性判定 + 前端页面接线是否真的通了。
 *
 * 账号由 scripts/api-e2e-harness.mjs 的种子提供：
 *   api_owner / api_other，密码 ApiE2e-pass-2026；
 *   作品 c3000000-0000-0000-0000-000000000003 属于 api_owner 且已发布。
 */
import { expect, test, type Browser, type Page } from '@playwright/test'

const OWNER = 'api_owner'
const OTHER = 'api_other'
const PASSWORD = 'ApiE2e-pass-2026'
const OWNER_PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'

async function freshPage(browser: Browser): Promise<Page> {
  // 每个用例一份干净的浏览器上下文：会话互不串味
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  return context.newPage()
}

async function signIn(page: Page, username: string, next = '/gallery'): Promise<void> {
  // 与 photo-owner.spec.ts 一致：站点用路径式入口回落到路由，不带 # 前缀。
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  // 用 pathname 判定而不是正则拼接：next 里可能带 / 与 ?，拼正则反而容易写错。
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe(next.split('?')[0])
}

test('收藏夹：新建 → 加入作品 → 他人只能看到公开的', async ({ browser }) => {
  const ownerPage = await freshPage(browser)
  await signIn(ownerPage, OWNER)
  await ownerPage.goto('/me/collections')

  const title = `夜行 ${Date.now()}`
  await ownerPage.getByRole('button', { name: '新建收藏夹' }).click()
  await ownerPage.getByLabel(/^标题/).fill(title)
  await ownerPage.getByRole('radio', { name: /^公开/ }).check()
  await ownerPage.getByRole('button', { name: '创建收藏夹' }).click()

  // 新夹出现在列表里
  await expect(ownerPage.getByText(title)).toBeVisible({ timeout: 10_000 })

  // 从作品页加入这件作品
  await ownerPage.goto(`/works/${OWNER_PHOTO_ID}`)
  await ownerPage.getByRole('button', { name: '加入收藏夹' }).click()
  const dialog = ownerPage.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: new RegExp(title) }).click()
  await expect(dialog.getByRole('button', { name: new RegExp(title) })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10_000 },
  )
  await ownerPage.keyboard.press('Escape')

  // 公开夹出现在作者主页的「相册」Tab，并能打开详情看到那件作品
  await ownerPage.goto(`/u/${OWNER}`)
  await ownerPage.getByRole('tab', { name: '相册' }).click()
  await ownerPage.getByRole('link', { name: new RegExp(title) }).first().click()
  await expect(ownerPage.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 })
  await expect(ownerPage.locator(`a[href*="/works/${OWNER_PHOTO_ID}"]`).first()).toBeVisible()

  // 另一个账号：同一页面能看到这个公开夹
  const otherPage = await freshPage(browser)
  await signIn(otherPage, OTHER, '/gallery')
  await otherPage.goto(`/u/${OWNER}`)
  await otherPage.getByRole('tab', { name: '相册' }).click()
  await expect(otherPage.getByText(title)).toBeVisible({ timeout: 10_000 })

  // 私密夹他看不到：新建一个私密夹，另开账号的相册里不出现
  const secretTitle = `私藏 ${Date.now()}`
  await ownerPage.goto('/me/collections')
  await ownerPage.getByRole('button', { name: '新建收藏夹' }).click()
  await ownerPage.getByLabel(/^标题/).fill(secretTitle)
  await ownerPage.getByRole('button', { name: '创建收藏夹' }).click()
  await expect(ownerPage.getByText(secretTitle)).toBeVisible({ timeout: 10_000 })

  await otherPage.reload()
  await otherPage.getByRole('tab', { name: '相册' }).click()
  await expect(otherPage.getByText(secretTitle)).toHaveCount(0)
})

test('发布页草稿：换设备（新上下文）能恢复服务端草稿', async ({ browser }) => {
  const page = await freshPage(browser)
  await signIn(page, OWNER, '/publish')

  const marker = `草稿标题 ${Date.now()}`
  await page.getByLabel(/^标题/).fill(marker)
  // 手动保存，避免等 5 秒防抖
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText(/草稿已保存到你的账号/)).toBeVisible({ timeout: 10_000 })

  // 换一个全新上下文（等价于换浏览器/设备）：本地 localStorage 是空的
  const otherDevice = await freshPage(browser)
  await signIn(otherDevice, OWNER, '/publish')
  await expect(otherDevice.getByLabel(/^标题/)).toHaveValue(marker, { timeout: 15_000 })
  await expect(otherDevice.getByText(/已恢复上次未发布的草稿/)).toBeVisible()
})

test('收藏夹页在 390px 下没有横向溢出', async ({ browser }) => {
  // 先在桌面尺寸登录（手机尺寸下登录表单的可点区域与标签会变化），再缩到 390px 量溢出。
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await signIn(page, OWNER, '/me/collections')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/me/collections')
  // 页面上有「我的收藏夹」（h1）与「全部收藏夹（N）」（h2）两个标题，收窄到页面主标题
  await expect(page.getByRole('heading', { name: '我的收藏夹', exact: true })).toBeVisible({ timeout: 10_000 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
