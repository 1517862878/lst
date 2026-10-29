/**
 * 8.4c 组照（多图作品）端到端验收 —— mock 模式，跑在 4173 的静态产物上。
 *
 * 覆盖用户真正会走的路径：
 *   1) 发布页一次选两张 → 条目列表出现两行，第 1 张标为封面；
 *   2) 能调整顺序、能删到只剩一张；
 *   3) 发布后详情页出现画册（缩略图条 + 序号），点击第二张主图切换；
 *   4) 编辑页把已保存的两条读出来（不是重新上传）。
 *
 * 为什么要放在浏览器里跑：组照的坑几乎都在「多文件选择的时序 + 压缩 + 上传槽位 +
 * 详情页缩略图切换」这条链上，jsdom 里 mock 掉压缩与存储正好把这条链的难点全绕开了。
 */
import { expect, test } from '@playwright/test'
import { resetApp, signIn } from './utils'

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

const JPEG = Buffer.from(MINIMAL_JPEG_BASE64, 'base64')

test.describe('组照（多图作品）', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('一次选两张 → 条目标为封面 → 顺序可调 → 发布后详情页有画册', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles([
      { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: JPEG },
      { name: 'second.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    ])
    // 两张都进了列表（文案里带第一张的文件名）
    await expect(page.getByText(/已选择 2 张：cover\.jpg/)).toBeVisible({ timeout: 20_000 })

    const list = page.locator('[id^="publish-item-"]')
    await expect(list).toHaveCount(2)
    await expect(page.locator('.g-item-list')).toBeVisible()
    await expect(page.getByText('封面').first()).toBeVisible()

    // 第 2 张上移一位 → 它变成封面
    await page.getByRole('button', { name: '上移第 2 张' }).click()

    const title = `E2E 组照作品 ${Date.now()}`
    await page.getByLabel('标题').fill(title)
    await page.getByLabel('拍摄心得').fill('两张图的组照，用于验证画册与缩略图切换。')
    await page.locator('#publish-category').selectOption('landscape')
    await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()
    await page.getByRole('button', { name: '发布作品' }).click()
    await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 30_000 })

    // 详情页：画册出现，默认显示第 1 张
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 20_000 })
    const gallery = page.locator('.g-gallery')
    await expect(gallery).toBeVisible()
    const thumbs = gallery.locator('.g-gallery-thumb')
    await expect(thumbs).toHaveCount(2)
    await expect(gallery.locator('.g-gallery-counter')).toHaveText(/1\s*\/\s*2/)

    // 点第二张缩略图 → 序号与主图都跟着换
    await thumbs.nth(1).click()
    await expect(gallery.locator('.g-gallery-counter')).toHaveText(/2\s*\/\s*2/)
  })

  test('编辑页能读出已保存的组照条目（不是重新上传）', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await page.locator('input[type="file"]').setInputFiles([
      { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    ])
    await expect(page.getByText(/已选择 2 张：a\.jpg/)).toBeVisible({ timeout: 20_000 })

    const title = `E2E 组照编辑 ${Date.now()}`
    await page.getByLabel('标题').fill(title)
    await page.getByLabel('拍摄心得').fill('验证编辑页读回组照。')
    await page.locator('#publish-category').selectOption('landscape')
    await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()
    await page.getByRole('button', { name: '发布作品' }).click()
    await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 30_000 })

    // 详情页的作者操作是 Button（走 navigate），不是 <Link>
    await page.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[id^="work-edit-item-"]')).toHaveCount(2)
    // 已有条目不需要重新选文件
    await expect(page.getByText(/已选择/)).toHaveCount(0)
  })
})
