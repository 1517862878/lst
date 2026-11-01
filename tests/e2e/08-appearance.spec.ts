/**
 * 外观系统 E2E（8.5 背景与字体）。
 *
 * 覆盖用户真实路径，不用 class 选择器：
 *  1. 游客可以直接打开 /appearance（不需要登录）
 *  2. 选配色/主体/字体后，刷新仍然保持（持久化真的生效）
 *  3. 上传背景照片 → 自动采样亮度 → 显示压暗与对比度 → 移除恢复
 *  4. 字号调节后正文实际变大（不是只改了个数字）
 *  5. 390px 无横向溢出（项目验收口径）
 */
import { expect, test } from '@playwright/test'
import { resetApp } from './utils'

test.describe('外观设置', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('游客可直接进入外观设置页，四个分区都在', async ({ page }) => {
    await page.goto('/appearance')
    // 不需要登录（resetApp 已清 localStorage，此时是游客）
    await expect(page.getByRole('heading', { name: '外观设置', level: 1 })).toBeVisible()
    for (const title of ['内置主体', '经典配色', '我的背景照片', '字体']) {
      await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
    }
    // 现有主体必须是内置主体之一
    await expect(page.getByText('像素星空（当前主体）')).toBeVisible()
  })

  test('切换配色与字体后刷新仍保持', async ({ page }) => {
    await page.goto('/appearance')

    await page.getByText('P3 墨绿胶片').click()
    // 旧主体（像素网格/网点/扫描线）已换代，这里用新主体「工程剖面线」
    await page.getByText('工程剖面线', { exact: true }).click()
    await page.getByText('现代无衬线').click()

    // 立刻生效：html 上的标记 + 正文字体
    const markers = await page.evaluate(() => ({
      palette: document.documentElement.dataset.palette,
      font: document.documentElement.dataset.font,
      subject: document.documentElement.dataset.subject,
    }))
    expect(markers.palette).toBe('p3')
    expect(markers.font).toBe('sans')
    expect(markers.subject).toBe('px-hatch')

    await page.reload()
    const after = await page.evaluate(() => ({
      palette: document.documentElement.dataset.palette,
      font: document.documentElement.dataset.font,
      subject: document.documentElement.dataset.subject,
      body: getComputedStyle(document.body).fontFamily,
    }))
    expect(after.palette).toBe('p3')
    expect(after.font).toBe('sans')
    expect(after.subject).toBe('px-hatch')
    expect(after.body.toLowerCase()).toContain('inter')
  })

  test('上传照片后自动算出压暗与对比度，移除后回落主体', async ({ page }) => {
    await page.goto('/appearance')

    // 造一张偏亮的照片并走真实的文件选择路径
    const file = await makePhoto(page, '#f0f0f0')
    await page.setInputFiles('input[type=file]', file)

    // 元数据落到 localStorage（图片本体在 IndexedDB）
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('gy:appearance')
            const parsed = raw ? JSON.parse(raw) : null
            return parsed?.state?.photo?.key ?? null
          }),
        { timeout: 15_000 },
      )
      .toBe('background')

    // 界面显示了自动压暗与对比度，且对比度达标
    await expect(page.getByText(/自动压暗\s*\d+%/)).toBeVisible()
    const contrast = await page.locator('.g-photo-status-ok').first().textContent()
    expect(contrast).toMatch(/^\d+\.\d+:1$/)
    const value = Number.parseFloat(contrast ?? '0')
    expect(value).toBeGreaterThanOrEqual(4.5)

    await page.getByRole('button', { name: '移除照片' }).click()
    await expect(page.getByText('还没有背景照片')).toBeVisible()

    // 主体恢复：照片没了就不再是 px-none
    const subject = await page.evaluate(() => document.documentElement.dataset.subject)
    expect(subject).toBe('px-stars')
  })

  test('字号调节真实改变正文字号', async ({ page }) => {
    await page.goto('/appearance')
    await page.getByText('像素标题 + 黑体正文').click()

    await page.getByRole('button', { name: '增大正文字号' }).click()
    await page.getByRole('button', { name: '增大正文字号' }).click()

    const size = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--g-text-base').trim(),
    )
    expect(size).toBe('18px')

    // 刷新后仍然是 18px（持久化 + 首屏预涂两条路径一致）
    await page.reload()
    const after = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--g-text-base').trim(),
    )
    expect(after).toBe('18px')
  })

  test('390px 下外观页无横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/appearance')
    await expect(page.getByRole('heading', { name: '外观设置', level: 1 })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    // 关键控件在窄屏仍可操作（触控目标不小于 44px 是 UX 口径，这里先保证可见可点）
    await expect(page.getByRole('button', { name: '上传照片' })).toBeVisible()
    await expect(page.getByRole('button', { name: '增大正文字号' })).toBeVisible()
  })

  test('字号拉到最大档时页头不撑破视口，也不折行（既有溢出 bug 回归）', async ({ page }) => {
    const WIDTHS = [390, 900, 1440]

    // 不变量：页头宽度与字号设置无关（页头字阶钉回默认档）。
    // 所以先量默认档作基线，再把字号拉到最大档，两轮必须逐项相等。
    const measure = async (width: number) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      return page.evaluate(() => {
        const de = document.documentElement
        const header = document.querySelector('.g-header')
        const name = document.querySelector('.g-brand-name')
        return {
          overflow: de.scrollWidth - de.clientWidth,
          headerH: header ? Math.round(header.getBoundingClientRect().height) : 0,
          // 品牌名被压出省略号时 > 0
          truncated: name ? name.scrollWidth - name.clientWidth : 0,
        }
      })
    }

    const baseline: Array<{ width: number; m: Awaited<ReturnType<typeof measure>> }> = []
    for (const width of WIDTHS) baseline.push({ width, m: await measure(width) })

    // 走真实用户路径：把正文字号点到最大档
    await page.goto('/appearance')
    await page.setViewportSize({ width: 1440, height: 900 })
    const bump = page.getByRole('button', { name: '增大正文字号' })
    for (let i = 0; i < 8; i++) {
      const current = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--g-text-base').trim(),
      )
      if (current === '24px') break
      await bump.click()
    }
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--g-text-base').trim(),
      ),
    ).toBe('24px')

    for (const { width, m: base } of baseline) {
      const after = await measure(width)
      expect(after.overflow, `${width}px 最大字号横向溢出`).toBeLessThanOrEqual(1)
      // 历史 bug：390px/24px 溢出 7px，861–1024px 溢出最多 184px
      expect(after.overflow, `${width}px 与默认档一致`).toBe(base.overflow)
      // 页头折行会让高度几乎翻倍
      expect(after.headerH, `${width}px 页头高度`).toBe(base.headerH)
      expect(after.truncated, `${width}px 品牌名截断`).toBe(0)
    }
  })
})

/**
 * 在页面内合成一张纯色照片并返回可上传的文件。
 */
async function makePhoto(
  page: import('@playwright/test').Page,
  color: string,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const b64 = await page.evaluate(async (c) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 1600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 2400, 1600)
    // 加点结构，避免纯色触发极端采样
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    for (let i = 0; i < 8; i++) ctx.fillRect(0, 200 + i * 160, 2400, 8)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
    const buf = await blob.arrayBuffer()
    let out = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(out)
  }, color)

  return { name: 'bg.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') }
}
