/**
 * 8.4d 每周主题与活动端到端验收 —— mock 模式，跑在 4173 的静态产物上。
 *
 * 冻结契约 §5.4 要求的完整旅程：编辑后台建主题 → 作者投稿 → 详情页出现 →
 * 编辑精选 → 作者收到通知且看到精选徽标；外加 §5.6 的 390px 窄屏验收。
 *
 * 与 06-photo-items 相同的取舍：真正难的是「跨账号状态 + 通知 + 精选徽标」
 * 这条链，jsdom 里桩掉仓储正好把链上的难点全绕开了，所以必须放在浏览器里跑。
 *
 * mock 模式的全部数据（含主题与投稿）都落在**同一个浏览器 context** 的
 * localStorage / IndexedDB 里，跨账号旅程必须在同一个 page 里切号走完 ——
 * 用账号菜单「退出登录」→ 演示账号一键登录切换，这才是用户真实路径；
 * 多 context 反而各持一套互不可见的数据（真 API 模式的跨账号才需要多 context）。
 *
 * mock 种子自带的 active 主题「秋日光线」占着「同一时刻只有一个进行中」的位子，
 * 所以编辑要先把它结束掉，再建自己的主题切到进行中 —— 这条约束本身也在验收范围内。
 */
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './utils'

const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q=='

const MINIMAL_JPEG = Buffer.from(MINIMAL_JPEG_BASE64, 'base64')

/** 账号菜单退出登录（mock 会话在 localStorage，同 context 切号必须走这条路） */
async function signOutViaMenu(page: Page): Promise<void> {
  await page.locator('.g-header-avatar-link').click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  // 退出后回到未登录态：账号菜单消失，出现登录/注册入口
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible()
}

test('编辑建主题 → 作者投稿 → 详情页出现 → 编辑精选 → 作者收到通知', async ({ page }) => {
  // 0) 作者先发一件已发布的作品（投稿只认已发布且未删除的作品）
  await signIn(page, 'alice', '/publish')
  const workTitle = `E2E 主题投稿 ${Date.now()}`
  await page.locator('input[type="file"]').setInputFiles({
    name: 'theme-entry.jpg',
    mimeType: 'image/jpeg',
    buffer: MINIMAL_JPEG,
  })
  await expect(page.getByText(/已选择 1 张：theme-entry\.jpg/)).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('标题').fill(workTitle)
  await page.getByLabel('拍摄心得').fill('用于主题投稿链路验证。')
  await page.locator('#publish-category').selectOption('landscape')
  await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()
  await page.getByRole('button', { name: '发布作品' }).click()
  await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const workPath = new URL(page.url()).pathname

  // 1) 切到编辑：结束种子自带的进行中主题，再建一期自己的主题（直接设为进行中）
  await signOutViaMenu(page)
  await signIn(page, 'editor', '/admin')
  await page.getByRole('tab', { name: /^主题/ }).click()

  // 1a) 结束「秋日光线」：同一时刻只能有一期进行中（部分唯一索引兜底）
  await page.getByRole('button', { name: '编辑主题 秋日光线' }).click()
  const closeForm = page.getByRole('form', { name: '编辑主题' })
  await closeForm.locator('#theme-status').selectOption('closed')
  await closeForm.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('已保存「秋日光线」')).toBeVisible()

  // 1b) 新建主题并直接设为「进行中」
  const slug = `e2e-${Date.now()}`
  const themeTitle = `E2E 主题 ${Date.now()}`
  await page.getByRole('button', { name: '新建主题' }).click()
  const form = page.getByRole('form', { name: '新建主题' })
  await form.getByLabel('Slug（网址短名）').fill(slug)
  await form.getByLabel('标题').fill(themeTitle)
  await form.getByLabel('投稿规则').fill('一人最多 3 件，需为本人原创。')
  await form.locator('#theme-status').selectOption('active')
  await form.getByRole('button', { name: '创建主题' }).click()
  await expect(page.getByText(`已创建「${themeTitle}」`)).toBeVisible()
  await expect(page.getByRole('list', { name: '全部主题' }).getByText(themeTitle)).toBeVisible()

  // 2) 切回作者，在作品详情页把新作品投稿到该主题
  await signOutViaMenu(page)
  await signIn(page, 'alice', workPath)
  await page.getByRole('button', { name: /^投稿到主题/ }).click()
  const submitDialog = page.getByRole('dialog')
  await expect(submitDialog.getByText(`投稿到「${themeTitle}」`)).toBeVisible()
  await submitDialog.getByRole('button', { name: `投稿《${workTitle}》` }).click()
  await expect(page.getByText(`《${workTitle}》已投稿到「${themeTitle}」`)).toBeVisible()

  // 3) 主题详情页出现这篇投稿，且「我的投稿」区块列出它
  await page.goto('/themes')
  await page.locator(`a[href="/themes/${slug}"]`).click()
  await expect(page.getByRole('heading', { name: themeTitle, level: 1 })).toBeVisible()
  await expect(page.getByText(workTitle).first()).toBeVisible()
  await expect(page.getByText('我的投稿 1 件')).toBeVisible()

  // 4) 切到编辑，在审核台「主题」Tab 里把这篇投稿设为精选
  await signOutViaMenu(page)
  await signIn(page, 'editor', '/admin')
  await page.getByRole('tab', { name: /^主题/ }).click()
  await page.getByRole('button', { name: `管理《${themeTitle}》的投稿` }).click()
  const adminEntries = page.getByRole('list', { name: '主题投稿' })
  await adminEntries.getByRole('button', { name: `把《${workTitle}》设为精选` }).click()
  await expect(page.getByText(`已把《${workTitle}》设为精选，作者会收到通知`)).toBeVisible()

  // 5) 切回作者：详情页看到精选徽标，通知中心收到精选通知
  await signOutViaMenu(page)
  await signIn(page, 'alice', `/themes/${slug}`)
  await expect(page.getByText('编辑精选').first()).toBeVisible()
  await page.goto('/notifications')
  await expect(page.getByText(`《${workTitle}》入选主题「${themeTitle}」精选`)).toBeVisible()
})

test('390×844 下主题列表与详情页无横向溢出，键盘可完成投稿', async ({ page }) => {
  // 先在桌面尺寸登录（手机尺寸下登录表单的可点区域与标签会变化），再缩到 390px 量溢出。
  await signIn(page, 'alice', '/themes')
  await page.setViewportSize({ width: 390, height: 844 })

  // 列表页三档都在，且没有横向溢出（tab 值写进 URL 的是英文档位名）
  const TAB_VALUES: Record<string, string> = { 征集中: 'active', 即将开始: 'upcoming', 往期: 'past' }
  await expect(page.getByRole('heading', { name: '每周主题' })).toBeVisible()
  for (const tab of ['征集中', '即将开始', '往期']) {
    await page.getByRole('tab', { name: tab }).click()
    await expect(page).toHaveURL(
      new RegExp(tab === '征集中' ? '/themes$' : `/themes\\?tab=${TAB_VALUES[tab]}$`),
    )
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${tab} 档位横向溢出 ${overflow}px`).toBeLessThanOrEqual(1)
  }

  // 详情页（mock 种子主题 autumn-light）无横向溢出
  await page.goto('/themes/autumn-light')
  await expect(page.getByRole('heading', { name: '秋日光线', level: 1 })).toBeVisible()
  const detailOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(detailOverflow).toBeLessThanOrEqual(1)

  // 键盘可达：Tab 遍历能走到带「投稿到主题」可访问名的按钮
  let found = false
  for (let i = 0; i < 30; i += 1) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
    if (label.includes('投稿到主题')) {
      found = true
      break
    }
    await page.keyboard.press('Tab')
  }
  expect(found, 'Tab 序里没有找到「投稿到主题」入口').toBe(true)
})
