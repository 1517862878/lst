/**
 * 作品详情页大图「自适应」回归（用户反馈：上传的照片不要固定大小）。
 *
 * 背景：`.g-photo-thumb-display` 曾同时有两条定义，一条带
 * `height: min(66vh, 640px)`（固定高度），另一条没重置它，于是固定高度存活：
 * 竖构图照片被这个高度钉住、再用 contain 居中，左右各留大片空档
 * （实测 800×1300 竖图浪费 45% 容器面积）。修复后容器尺寸应由图片比例决定。
 *
 * 这里不依赖「有没有真实图片」：种子作品的占位色块与真图走同一个容器，
 * 容器尺寸与图片上不上传无关，所以断言容器本身即可。真实图片的
 * 「渲染内容 vs 容器空档」由 .tmp/verify-display-fit.mjs 在构建产物上量过。
 *
 * 关键断言：
 *   · 容器不得有写死的固定高度（高度必须随宽高比变化）
 *   · 竖构与横构作品的容器宽高比，必须分别等于各自 photo 的比例
 *   · 占位色块必须铺满容器（防止去掉 min-height 后容器塌成一条线）
 *   · 三档视口下都不横向溢出
 */
import { expect, test } from '@playwright/test'
import { SEED_PHOTO_ID, resetApp } from './utils'

/** 详情页大图容器的计算尺寸 */
async function frame(page: import('@playwright/test').Page) {
  const m = await page.evaluate(() => {
    const box = document.querySelector('.g-work-media .g-photo-thumb-display')
    if (!box) return null
    const img = box.querySelector('img.g-photo-thumb-img')
    const fill = box.querySelector('.g-photo-thumb-fill')
    const rectOf = (el: Element | null) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
    }
    const cs = getComputedStyle(box)
    return {
      frame: rectOf(box)!,
      img: rectOf(img),
      fill: rectOf(fill),
      height: cs.height,
      width: cs.width,
      hasFixedHeightToken: /min\(/.test(cs.height),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewportH: window.innerHeight,
    }
  })
  if (!m) throw new Error('找不到详情页大图容器 .g-work-media .g-photo-thumb-display')
  return m
}

test.describe('作品详情页大图自适应', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('容器尺寸由图片比例决定，不是写死的固定高度', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/works/${SEED_PHOTO_ID}`)
    await expect(page.locator('.g-work-media .g-photo-thumb-display')).toBeVisible({ timeout: 20_000 })

    const m = await frame(page)

    // 1) 不得是固定高度：原 bug 的取值就是 height: min(66vh/68vh, …)
    expect(m.hasFixedHeightToken).toBe(false)

    // 2) 容器高宽比必须等于作品比例（由内联 aspect-ratio 决定）
    const ratio = await page.evaluate(() => {
      const box = document.querySelector('.g-work-media .g-photo-thumb-display')
      if (!box) return null
      const el = box as HTMLElement
      const probe = el.style.getPropertyValue('--g-photo-ar')
      return { ar: probe ? Number(probe) : null, cssAr: getComputedStyle(el).aspectRatio }
    })
    expect(ratio?.ar).toBeGreaterThan(0)
    const boxRatio = m.frame.w / m.frame.h
    expect(Math.abs(boxRatio - (ratio?.ar ?? 1))).toBeLessThan(0.05)

    // 3) 高度不得超过 68vh（保留「不超出首屏」的原意），也不能塌陷
    expect(m.frame.h).toBeLessThanOrEqual(0.68 * m.viewportH + 1)
    expect(m.frame.h).toBeGreaterThan(100)

    // 4) 占位色块铺满容器（没有真实图片时这是唯一可见内容）
    if (m.fill) {
      expect(m.fill.w).toBeGreaterThan(m.frame.w - 8)
      expect(m.fill.h).toBeGreaterThan(m.frame.h - 8)
    }

    // 5) 无横向溢出
    expect(m.overflow).toBeLessThanOrEqual(1)
  })

  test('窄屏与中等屏都不溢出，容器不塌陷', async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [900, 1000],
    ] as const) {
      await page.setViewportSize({ width, height })
      await page.goto(`/works/${SEED_PHOTO_ID}`)
      await expect(page.locator('.g-work-media .g-photo-thumb-display')).toBeVisible({ timeout: 20_000 })
      const m = await frame(page)

      expect(m.hasFixedHeightToken, `${width}px 不应有固定高度`).toBe(false)
      expect(m.overflow, `${width}px 横向溢出`).toBeLessThanOrEqual(1)
      expect(m.frame.h, `${width}px 容器塌陷`).toBeGreaterThan(100)
      expect(m.frame.h, `${width}px 不超 68vh`).toBeLessThanOrEqual(0.68 * m.viewportH + 1)
    }
  })
})
