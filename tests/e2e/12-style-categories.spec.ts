/**
 * 分类体系换代回归（2026-11：题材维度 → 风格维度）。
 *
 * 这件事有三处容易坏，各自都需要断言：
 *   1) 目录本身：8 个新分类、顺序、名称，且旧 slug 不在目录里
 *   2) 发布页下拉：值必须与新 slug 一致（否则发布时外键失败）
 *   3) 旧链接退场：/categories/landscape 这类旧地址要给「分类不存在」，
 *      而不是一个「有标题但没作品」的假分类页
 */
import { expect, test } from '@playwright/test'
import { resetApp, signIn } from './utils'

const NEW_CATEGORIES = [
  { slug: 'campus-fresh', name: '校园清新' },
  { slug: 'travel-doc', name: '旅行纪实' },
  { slug: 'japanese-soft', name: '日系治愈' },
  { slug: 'hk-retro', name: '港风复古' },
  { slug: 'new-chinese', name: '新中式国风' },
  { slug: 'korean-clear', name: '韩系清透' },
  { slug: 'cinematic-dark', name: '暗调电影感' },
  { slug: 'american-retro', name: '美式复古' },
] as const

const OLD_SLUGS = [
  'landscape',
  'people',
  'architecture',
  'industrial',
  'technology',
  'macro',
  'night',
  'monochrome',
] as const

test.describe('分类体系换代', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('分类页正好列出 8 个风格分类，且不含任何旧题材分类', async ({ page }) => {
    await page.goto('/categories')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })

    const entries = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/categories/"]')].map((a) => ({
        slug: (a.getAttribute('href') ?? '').replace('/categories/', ''),
        text: (a.textContent ?? '').trim(),
      }))
    )

    // 每个新分类都必须出现，且顺序与目录一致（sortOrder 1–8）
    for (let i = 0; i < NEW_CATEGORIES.length; i += 1) {
      const want = NEW_CATEGORIES[i]!
      expect(entries[i]?.slug, `第 ${i + 1} 个分类`).toBe(want.slug)
      expect(entries[i]?.text).toContain(want.name)
    }

    // 目录里不得再出现旧题材分类
    for (const old of OLD_SLUGS) {
      expect(entries.some((e) => e.slug === old), `旧分类 ${old} 不该出现在目录里`).toBe(false)
    }
  })

  test('发布页下拉的 8 个值必须与新 slug 一致', async ({ page }) => {
    await signIn(page, 'alice', '/publish')
    await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()
    // 先把分类下拉渲染出来（它在表单里随页面加载）
    await expect(page.locator('#publish-category')).toBeVisible({ timeout: 20_000 })

    const values = await page.evaluate(() => {
      const select = document.querySelector('#publish-category') as HTMLSelectElement | null
      return select ? [...select.options].map((o) => ({ value: o.value, label: o.textContent ?? '' })) : []
    })
    expect(values).toHaveLength(NEW_CATEGORIES.length)
    for (let i = 0; i < NEW_CATEGORIES.length; i += 1) {
      expect(values[i]?.value).toBe(NEW_CATEGORIES[i]!.slug)
      expect(values[i]?.label).toContain(NEW_CATEGORIES[i]!.name)
    }
  })

  test('旧分类链接给「分类不存在」，而不是空分类页', async ({ page }) => {
    // 抽查两个旧 slug：一个曾经是默认（landscape），一个是长尾（technology）
    for (const slug of ['landscape', 'technology'] as const) {
      await page.goto(`/categories/${slug}`)
      // exact: true —— 空态的标题「这个分类不存在或已下架」也含「分类不存在」，
      // 不加 exact 会被 Playwright strict mode 判成两个匹配
      await expect(page.getByRole('heading', { name: '分类不存在', exact: true })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByText('这个分类不存在或已下架')).toBeVisible()
      // 必须给出可执行的下一步，不能是死胡同
      await expect(page.getByRole('link', { name: '看看全部分类' })).toBeVisible()
    }
  })

  test('新分类链接可以打开，标题是对应分类名', async ({ page }) => {
    // 抽两个：第一个（默认）与最后一个（边界）
    for (const item of [NEW_CATEGORIES[0]!, NEW_CATEGORIES[NEW_CATEGORIES.length - 1]!]) {
      await page.goto(`/categories/${item.slug}`)
      await expect(page.getByRole('heading', { name: item.name, exact: true })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByRole('heading', { name: '分类不存在', exact: true })).toHaveCount(0)
    }
  })
})
