/**
 * 主链路 2：注册 → 发布 → 个人主页可见（ROADMAP G-4 第二条）
 *
 * 覆盖：
 *   未登录访问 /publish 被守卫拦下 → 登录 → 上传 JPG → 填表 → 发布
 *   → 跳到详情页 → 个人主页能看到刚发布的作品
 *
 * 关于测试图片：
 *   用 Playwright 的 setInputFiles 直接注入内存构造的最小合法 JPEG，
 *   不依赖仓库里的图片文件（避免引入第三方素材，见 CREDITS.md 规则）。
 */
import { expect, test } from '@playwright/test'
import { DEMO, resetApp, signIn } from './utils'

/** 构造一个最小可解码的 JPEG（1×1 像素，纯色），供上传测试使用 */
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

test.describe('主链路 2 · 发布与个人主页', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('未登录访问发布页会被守卫拦截并跳转登录', async ({ page }) => {
    await page.goto('/publish')
    await expect(page).toHaveURL(/\/login\?next=%2Fpublish|\/login\?next=\/publish/)
    await expect(page.getByRole('heading', { name: '登录' })).toBeVisible()
  })

  test('登录后可发布作品，发布成功后跳到详情页', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()

    const title = `E2E 测试作品 ${Date.now()}`

    // 上传 JPG（走真实文件选择路径）
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-sample.jpg',
      mimeType: 'image/jpeg',
      buffer: MINIMAL_JPEG,
    })

    // 等待压缩与 EXIF 读取完成（上传区显示"已选择"）
    await expect(page.getByText(/已选择：e2e-sample\.jpg/)).toBeVisible({ timeout: 20_000 })

    // 填表
    await page.getByLabel('标题').fill(title)
    await page.getByLabel('拍摄心得').fill('E2E 自动化测试创建的拍摄心得。')
    await page.locator('#publish-category').selectOption('landscape')
    await page.getByLabel('拍摄地点').fill('测试地点')
    // 8.3a 起发布页多了「标签候选」分组（role=group，aria-label 也是「标签」），
    // 只写 getByLabel('标签') 会撞 strict mode，必须指定 textbox。
    await page.getByRole('textbox', { name: '标签', exact: true }).fill('测试 自动化')
    await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()

    // 发布
    await page.getByRole('button', { name: '发布作品' }).click()

    // 断言：跳到详情页并显示标题
    await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    // 拍摄地点应正确显示
    await expect(page.getByText(/测试地点/)).toBeVisible()

    // 断言：上传的图片真的被渲染出来（而不是回退到占位色块）
    // 这是回归保护 —— 早先 PublishPage 只写入 IndexedDB、PhotoThumb 从不读取，
    // 导致"发布成功却只显示渐变色块"。这条断言防止该问题再次出现。
    const detailImg = page.locator('.g-photo-thumb-img').first()
    await expect(detailImg).toBeVisible({ timeout: 20_000 })
    // object URL 说明它来自存储层取出的 Blob，而非静态资源
    const src = await detailImg.getAttribute('src')
    expect(src).toMatch(/^blob:/)
    // 注意：页面上还有"相关作品"等种子数据仍走占位块（它们没有真实文件），
    // 所以这里不能断言全页 .g-photo-thumb-fill 为 0，只针对主图所在容器断言。
    const mainThumb = page.locator('.g-photo-thumb-display').first()
    await expect(mainThumb.locator('.g-photo-thumb-fill')).toHaveCount(0)
    await expect(mainThumb.locator('.g-photo-thumb-img')).toHaveCount(1)
  })

  test('发布后个人主页「作品」Tab 能看到该作品', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()

    const title = `E2E 个人主页可见 ${Date.now()}`
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-profile.jpg',
      mimeType: 'image/jpeg',
      buffer: MINIMAL_JPEG,
    })
    await expect(page.getByText(/已选择：e2e-profile\.jpg/)).toBeVisible({ timeout: 20_000 })

    await page.getByLabel('标题').fill(title)
    await page.getByLabel('拍摄心得').fill('验证个人主页可见性。')
    await page.locator('#publish-category').selectOption('people')
    await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()
    await page.getByRole('button', { name: '发布作品' }).click()
    await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 30_000 })

    // 去个人主页
    await page.goto(`/u/${DEMO.alice.username}`)
    // 等待资料加载完成（用 h1 文本，避免 heading role 在嵌套结构下匹配不到）
    await expect(page.locator('h1')).toContainText(DEMO.alice.displayName, { timeout: 20_000 })
    // 刚发布的作品标题应出现在作品 Tab
    await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 })
  })

  test('草稿会在刷新后恢复', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()

    const draftTitle = `草稿恢复验证 ${Date.now()}`
    await page.getByLabel('标题').fill(draftTitle)
    await page.getByLabel('拍摄心得').fill('这段文字应在刷新后还在。')

    // 点「保存草稿」，然后刷新
    await page.getByRole('button', { name: '保存草稿' }).click()
    await page.reload()

    await expect(page.getByText('已恢复上次未发布的草稿。')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('标题')).toHaveValue(draftTitle)
    await expect(page.getByLabel('拍摄心得')).toHaveValue('这段文字应在刷新后还在。')
  })
})
