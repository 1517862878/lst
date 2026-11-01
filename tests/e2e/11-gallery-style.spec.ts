/**
 * 组照画册样式回归（8.4c 的组件此前一直缺样式）。
 *
 * 背景：提交 cf05fc0 只加了 PhotoGallery / PhotoItemThumb 两个组件，
 * `.g-gallery-*` 与 `.g-item-*` 共 25 个类名在全仓库没有任何 CSS 规则。
 * 表现是：缩略条是 block 流、缩略图是无边框的 inline 元素（第二个甚至只有 1×1）、
 * 计数与提示行用 16px 正文色、画册宽度只由内容撑开（261px，外框 686px）。
 *
 * 这里把「结构和可访问性」钉死，尺寸细节由 .tmp/verify-gallery*.mjs 在构建产物上量：
 *   · 缩略条必须是水平排布（不再是竖排的 block 流）
 *   · 每个缩略图都是正方形、且 ≥44px 触控下限、有 2px 像素风描边
 *   · 计数是像素风小字（--g-text-xs），不是正文 16px
 *   · 主图容器按图片比例自适应，不超出 68vh
 *   · 键盘 ← → / Home / End 可翻页，且焦点留在画册内
 */
import { expect, test } from '@playwright/test'
import { resetApp, signIn } from './utils'

const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const JPEG = Buffer.from(MINIMAL_JPEG_BASE64, 'base64')

/** 发布一件双图组照，返回详情页地址 */
async function publishGallery(page: import('@playwright/test').Page): Promise<void> {
  await signIn(page, 'alice', '/publish')
  await expect(page.getByRole('heading', { name: '发布作品' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: JPEG },
  ])
  await page.waitForSelector('.g-item-list', { timeout: 25_000 })
  await page.getByLabel('标题').fill(`画册样式 ${Date.now()}`)
  await page.getByLabel('拍摄心得').fill('用于验证画册样式。')
  await page.locator('#publish-category').selectOption('landscape')
  await page.getByRole('checkbox', { name: /我确认拥有发布所需权利/ }).check()
  await page.getByRole('button', { name: '发布作品' }).click()
  await expect(page).toHaveURL(/\/works\/[0-9a-f-]{36}/, { timeout: 35_000 })
  await page.waitForSelector('.g-gallery', { timeout: 25_000 })
}

test.describe('组照画册样式', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('缩略条水平排布、缩略图是正方形像素卡、计数是像素风小字', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await publishGallery(page)

    const m = await page.evaluate(() => {
      const strip = document.querySelector('.g-gallery-strip')
      const thumbs = [...document.querySelectorAll('.g-gallery-thumb')]
      const counter = document.querySelector('.g-gallery-counter')
      const hint = document.querySelector('.g-gallery-hint')
      const wrap = document.querySelector('.g-gallery-image')
      const gallery = document.querySelector('.g-gallery')
      const media = document.querySelector('.g-work-media')
      const root = getComputedStyle(document.documentElement)
      const px = (v: string) => Number.parseFloat(v) || 0
      const box = (el: Element | null) => {
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
      }
      // 缩略条：走 flex 时子项应并排（第一个与第二个的左边界不同、top 相同）
      const tb = thumbs.map((t) => {
        const b = t.getBoundingClientRect()
        return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), left: +b.left.toFixed(1), top: +b.top.toFixed(1) }
      })
      return {
        stripDisplay: strip ? getComputedStyle(strip).display : null,
        stripListStyle: strip ? getComputedStyle(strip).listStyleType : null,
        thumbs: tb,
        thumbBorder: thumbs[0] ? getComputedStyle(thumbs[0]).borderTopWidth : null,
        counterFont: counter ? getComputedStyle(counter).fontSize : null,
        hintFont: hint ? getComputedStyle(hint).fontSize : null,
        hintColor: hint ? getComputedStyle(hint).color : null,
        wrap: box(wrap),
        gallery: box(gallery),
        media: box(media),
        textXs: root.getPropertyValue('--g-text-xs').trim(),
        viewportH: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ink3: root.getPropertyValue('--g-ink-3').trim(),
        px: px,
      }
    })

    // 1) 缩略条是水平 flex，不再是被浏览器默认的竖排 block 流
    expect(m.stripDisplay).toBe('flex')
    expect(m.stripListStyle).toBe('none')

    // 2) 缩略图：正方形、≥44px、2px 像素风硬描边；多张必须并排
    expect(m.thumbs.length).toBe(2)
    for (const t of m.thumbs) {
      expect(Math.abs(t.w - t.h)).toBeLessThanOrEqual(0.5)
      expect(t.w).toBeGreaterThanOrEqual(44)
    }
    const [first, second] = m.thumbs
    if (!first || !second) throw new Error('缩略图数量不足两张')
    expect(second.left).toBeGreaterThan(first.left)
    expect(second.top).toBe(first.top)
    expect(parseFloat(m.thumbBorder ?? '0')).toBeGreaterThanOrEqual(2)

    // 3) 计数与提示行用像素风小字，不是正文 16px
    expect(m.counterFont).toBe(m.textXs)
    expect(m.hintFont).toBe(m.textXs)

    // 4) 主图容器放得下且不超高（比例自适应，不是固定高度）
    expect(m.wrap).not.toBeNull()
    if (m.wrap) {
      expect(m.wrap.w).toBeLessThanOrEqual((m.media?.w ?? 0) + 1)
      expect(m.wrap.h).toBeLessThanOrEqual(0.68 * m.viewportH + 1)
    }

    // 5) 画册宽度吃满内容列（此前只有 261px，外框 686px）
    expect(m.gallery).not.toBeNull()
    if (m.gallery && m.media) {
      expect(m.gallery.w / m.media.w).toBeGreaterThan(0.9)
    }

    // 6) 无横向溢出
    expect(m.overflow).toBeLessThanOrEqual(1)
  })

  test('键盘可翻页且焦点留在画册内；390px 缩略图仍 ≥44px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await publishGallery(page)

    // 窄屏缩略图不得低于触控下限
    const small = await page.evaluate(() => {
      const t = document.querySelector('.g-gallery-thumb')
      if (!t) return null
      const b = t.getBoundingClientRect()
      return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
    })
    expect(small).not.toBeNull()
    if (small) {
      expect(small.w).toBeGreaterThanOrEqual(44)
      expect(small.h).toBeGreaterThanOrEqual(44)
    }

    // 键盘翻页
    await page.locator('.g-gallery').focus()
    const counter = page.locator('.g-gallery-counter')
    await expect(counter).toHaveText(/1\s*\/\s*2/)

    await page.keyboard.press('ArrowRight')
    await expect(counter).toHaveText(/2\s*\/\s*2/)

    await page.keyboard.press('Home')
    await expect(counter).toHaveText(/1\s*\/\s*2/)

    await page.keyboard.press('End')
    await expect(counter).toHaveText(/2\s*\/\s*2/)

    // 连续按键后焦点不能逃出画册，否则方向键会失效
    const focusIsGallery = await page.evaluate(() =>
      document.activeElement?.classList.contains('g-gallery') ?? false
    )
    expect(focusIsGallery).toBe(true)

    // 焦点环可见（键盘用户必须看得出焦点在哪）
    const focusOutline = await page.evaluate(() => {
      const g = document.querySelector('.g-gallery')
      if (!g) return null
      return getComputedStyle(g).outlineStyle
    })
    expect(focusOutline).not.toBe('none')
  })
})
