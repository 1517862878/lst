import { expect, test, type Browser, type Page } from '@playwright/test'

const PHOTO_ID = 'c3000000-0000-0000-0000-000000000003'
const PASSWORD = 'ApiE2e-pass-2026'
const PHOTO_PATH = `/works/${PHOTO_ID}`

async function signIn(page: Page, username: 'api_owner' | 'api_other', next: string): Promise<void> {
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

test('真实 API 模式覆盖作者编辑、非作者隔离与撤回不可见', async ({ browser }) => {
  const owner = await freshPage(browser)
  try {
    await signIn(owner.page, 'api_owner', PHOTO_PATH)
    await expect(owner.page.getByRole('button', { name: '编辑作品' })).toBeVisible()
    await owner.page.getByRole('button', { name: '编辑作品' }).click()
    await expect(owner.page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
    await owner.page.getByLabel('标题').fill('API 已编辑标题')
    await owner.page.getByLabel('拍摄心得').fill('由 Playwright 通过真实 Fastify 与 PostgreSQL 保存')
    await owner.page.getByRole('button', { name: '保存修改' }).click()
    await expect(owner.page).toHaveURL(new RegExp(`${PHOTO_PATH}$`))
    await expect(owner.page.getByRole('heading', { name: 'API 已编辑标题' })).toBeVisible()
  } finally {
    await owner.close()
  }

  const other = await freshPage(browser)
  try {
    await signIn(other.page, 'api_other', PHOTO_PATH)
    await expect(other.page.getByRole('button', { name: '编辑作品' })).toHaveCount(0)
    await expect(other.page.getByRole('button', { name: '撤回作品' })).toHaveCount(0)
    await other.page.goto(`${PHOTO_PATH}/edit`)
    await expect(other.page.getByText('无权编辑此作品')).toBeVisible()
  } finally {
    await other.close()
  }

  const ownerWithdraw = await freshPage(browser)
  try {
    await signIn(ownerWithdraw.page, 'api_owner', PHOTO_PATH)
    await ownerWithdraw.page.getByRole('button', { name: '撤回作品' }).click()
    await expect(ownerWithdraw.page.getByRole('dialog', { name: '确认撤回作品？' })).toBeVisible()
    await ownerWithdraw.page.getByRole('button', { name: '确认撤回' }).click()
    await expect(ownerWithdraw.page).toHaveURL(/\/me$/)
  } finally {
    await ownerWithdraw.close()
  }

  const anonymous = await freshPage(browser)
  try {
    await anonymous.page.goto(PHOTO_PATH)
    await expect(anonymous.page.getByText('作品不存在或已删除')).toBeVisible()
    await expect(anonymous.page.getByRole('heading', { name: 'API 已编辑标题' })).toHaveCount(0)
  } finally {
    await anonymous.close()
  }
})
