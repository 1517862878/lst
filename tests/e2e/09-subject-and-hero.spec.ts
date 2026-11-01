/**
 * 内置主体换代（2026-11）+ 首页 Hero 字阶与密度的 E2E。
 *
 * 覆盖两件「只看单测看不出来」的事：
 *  1. 五套新主体在真实页面里真的画出了**互不相同**的图案，且走廊遮罩真的挂上了。
 *     只读元素自身的 backgroundImage 不够 —— 取景框与像素光圈的图案全在
 *     ::before / ::after 上，元素自身是 `none`。所以签名把两个伪元素一起算进来。
 *  2. 首页 Hero 的六条验收指标（字号 / 宽度占比 / 高度占比 / 底边 / 首个区块顶边 /
 *     首屏条目数 + 横向溢出 + 6 列精选卡）。
 *
 * 设计取舍：主体签名用 localStorage + 刷新切换，而不是逐个点 /appearance 的卡片 ——
 * 六次点击每次都要等一次页面切换与预览卡重绘，比直接改持久化值慢得多，
 * 而这里要验的是「背景层画对了」，不是「设置页的点击路径」（那条路径由 08 覆盖）。
 */
import { expect, test, type Page } from '@playwright/test'

/** 非 canvas 的 6 套主体：5 套 CSS 绘制 + 纯净无主体（无主体层） */
const NON_CANVAS_SUBJECTS = [
  { id: 'px-viewfinder', name: '取景框' },
  { id: 'px-sprocket', name: '胶片齿孔' },
  { id: 'px-aperture', name: '像素光圈' },
  { id: 'px-colorbar', name: '灰阶色卡' },
  { id: 'px-hatch', name: '工程剖面线' },
  { id: 'px-none', name: '纯净无主体' },
] as const

/** 五套真正有图案的主体（px-none 没有主体层） */
const PATTERN_SUBJECTS = NON_CANVAS_SUBJECTS.filter((s) => s.id !== 'px-none')

async function writeAppearance(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => {
    const raw = localStorage.getItem('gy:appearance')
    const parsed = raw ? JSON.parse(raw) : {}
    const state = { ...(parsed.state ?? {}), ...p }
    localStorage.setItem('gy:appearance', JSON.stringify({ ...parsed, state, version: 1 }))
  }, patch)
  await page.reload()
}

/**
 * 主体签名：元素自身 + ::before + ::after 的图案相关计算值。
 * 取 backgroundImage / backgroundSize / backgroundPosition / maskImage 四项 ——
 * 任意两套主体只要有一项不同，就算「可辨识」。
 */
async function subjectSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.g-bg-subject')
    if (!el || !(el instanceof HTMLElement)) return '__NO_SUBJECT_LAYER__'
    const own = getComputedStyle(el)
    const before = getComputedStyle(el, '::before')
    const after = getComputedStyle(el, '::after')
    const val = (s: CSSStyleDeclaration, k: string): string =>
      (s.getPropertyValue(k) || '').trim().replace(/\s+/g, ' ')
    return JSON.stringify({
      cls: el.className,
      image: [val(own, 'background-image'), val(before, 'background-image'), val(after, 'background-image')],
      size: [val(own, 'background-size'), val(before, 'background-size'), val(after, 'background-size')],
      position: [val(own, 'background-position'), val(before, 'background-position'), val(after, 'background-position')],
      mask: [val(own, 'mask-image'), val(before, 'mask-image'), val(after, 'mask-image')],
    })
  })
}

test.describe('内置主体换代', () => {
  test('px-stars 仍然走 canvas，不生成 CSS 主体层', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html[data-subject="px-stars"]')).toHaveCount(1)
    await expect(page.locator('.g-pixel-stars')).toHaveCount(1)
    await expect(page.locator('.g-bg-subject')).toHaveCount(0)
  })

  test('旧主体 id（px-grid / px-halftone / px-scanline）迁移到 px-none，而不是回落星空', async ({
    page,
  }) => {
    for (const legacy of ['px-grid', 'px-halftone', 'px-scanline'] as const) {
      await page.goto('/')
      await writeAppearance(page, { subject: legacy })
      await expect(page.locator('html[data-subject="px-none"]')).toHaveCount(1)
      // 真的没有主体层（不是画了一层 px-none 的图案）
      await expect(page.locator('.g-bg-subject')).toHaveCount(0)
      await expect(page.locator('.g-pixel-stars')).toHaveCount(0)
    }
  })

  for (const subject of NON_CANVAS_SUBJECTS) {
    test(`主体 ${subject.id}（${subject.name}）切换后背景层生效`, async ({ page }) => {
      await page.goto('/')
      await writeAppearance(page, { subject: subject.id })
      await expect(page.locator(`html[data-subject="${subject.id}"]`)).toHaveCount(1)

      if (subject.id === 'px-none') {
        await expect(page.locator('.g-bg-subject')).toHaveCount(0)
        return
      }

      await expect(page.locator(`.g-bg-subject-${subject.id}`)).toHaveCount(1)
      // 走廊遮罩必须挂在新主体上（1200px 正文列内降到 22%）
      const mask = await page.evaluate(() => {
        const el = document.querySelector('.g-bg-subject')
        return el ? getComputedStyle(el).getPropertyValue('mask-image') : ''
      })
      expect(mask).toContain('linear-gradient')
      expect(mask).toContain('600px')
    })
  }

  test('五套主体的图案两两不相同（含 ::before / ::after）', async ({ page }) => {
    const signatures = new Map<string, string>()
    for (const subject of PATTERN_SUBJECTS) {
      await page.goto('/')
      await writeAppearance(page, { subject: subject.id })
      await expect(page.locator(`.g-bg-subject-${subject.id}`)).toHaveCount(1)
      signatures.set(subject.id, await subjectSignature(page))
    }

    expect(signatures.size).toBe(5)
    const values = [...signatures.values()]
    // 任意两个都必须不同：并集去重后数量不变
    expect(new Set(values).size).toBe(values.length)

    // 且每一套都真的画了东西（不是空图案凑数）
    for (const [id, sig] of signatures) {
      expect(sig, `${id} 的图案为空`).not.toContain('"image":["none","none","none"]')
    }
  })

  test('px-hatch 下常驻 8px 网格层被关闭（避免摩尔纹）', async ({ page }) => {
    await page.goto('/')
    await writeAppearance(page, { subject: 'px-hatch' })
    await expect(page.locator('.g-bg-grid')).toBeHidden()
    const others = await page.evaluate(() => {
      document.documentElement.dataset.subject = 'px-colorbar'
      const el = document.querySelector('.g-bg-grid')
      return el ? getComputedStyle(el).display : 'missing'
    })
    expect(others).not.toBe('none')
  })
})

test.describe('首页 Hero 字阶与密度', () => {
  /** 把验收指标一次采齐（少一次 round-trip，也避免中途布局变化） */
  async function heroMetrics(page: Page) {
    return page.evaluate(() => {
      const hero = document.querySelector('.g-hero') as HTMLElement | null
      const title = document.querySelector('.g-hero-title') as HTMLElement | null
      const section = document.querySelector('.g-section') as HTMLElement | null
      if (!hero || !title || !section) throw new Error('首页缺少 .g-hero / .g-hero-title / .g-section')

      const heroBox = hero.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      // 文本实际墨迹宽度：h1 是块级元素，getBoundingClientRect 拿到的是整行宽（≈容器宽），
      // 用它算占比会「自动达标」。真要看标题有没有撑起来，必须量文本节点本身。
      const range = document.createRange()
      range.selectNodeContents(title)
      const inkBox = range.getBoundingClientRect()

      const vh = window.innerHeight
      const vw = window.innerWidth
      const items = Array.from(
        document.querySelectorAll(
          '.g-photo-card, .g-rank-mini-item, .g-learn-teaser-item, .g-category-chip, .g-tag-chip',
        ),
      )
        // display:none 的元素 rect 全为 0、y 也是 0，会被"y < vh"误判成首屏可见条目，
        // 所以必须先排掉零面积元素，再比 y。
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.y < vh
        })

      const cards = Array.from(document.querySelectorAll('.g-home-grid .g-photo-card')).slice(0, 6)
      const rows = new Map<number, number>()
      for (const c of cards) {
        const y = Math.round(c.getBoundingClientRect().y)
        rows.set(y, (rows.get(y) ?? 0) + 1)
      }

      return {
        vw,
        vh,
        titleFont: Number.parseFloat(getComputedStyle(title).fontSize),
        titleBoxWidth: titleBox.width,
        titleInkWidth: inkBox.width,
        heroHeight: heroBox.height,
        heroBottom: heroBox.bottom,
        sectionTop: section.getBoundingClientRect().top,
        visibleItems: items.length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        firstRowCards: cards.length === 0 ? 0 : Math.max(...rows.values()),
      }
    })
  }

  test('1440×900：Hero 加大且首屏不空旷', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('.g-home-grid .g-photo-card').first()).toBeVisible({ timeout: 30_000 })
    const m = await heroMetrics(page)

    expect(m.vw).toBe(1440)
    expect(m.vh).toBe(900)

    // 标题字号：≥72px 且是 24 的整数倍
    expect(m.titleFont).toBeGreaterThanOrEqual(72)
    expect(m.titleFont % 24).toBe(0)

    // 标题渲染宽度占比 ≥ 0.20（元素宽与文本墨迹宽都要过）
    expect(m.titleBoxWidth / m.vw).toBeGreaterThanOrEqual(0.2)
    expect(m.titleInkWidth / m.vw).toBeGreaterThanOrEqual(0.2)

    // Hero 高度 ≤ 38% 视口；底边 ≤ 44vh
    expect(m.heroHeight / m.vh).toBeLessThanOrEqual(0.38)
    expect(m.heroBottom).toBeLessThanOrEqual(0.44 * m.vh)

    // 首个区块顶边 ≤ 56vh（这条最容易超）
    expect(m.sectionTop).toBeLessThanOrEqual(0.56 * m.vh)

    // 首屏可见条目 ≥ 8
    expect(m.visibleItems).toBeGreaterThanOrEqual(8)

    // 第一排精选卡 6 列
    expect(m.firstRowCards).toBe(6)

    // 无横向溢出
    expect(m.overflow).toBeLessThanOrEqual(1)
  })

  test('390×844：Hero 与小屏密度', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('.g-home-grid .g-photo-card').first()).toBeVisible({ timeout: 30_000 })
    const m = await heroMetrics(page)

    expect(m.vw).toBe(390)
    expect(m.vh).toBe(844)

    // 窄屏上限 60px：≥48 且是 12 的整数倍
    expect(m.titleFont).toBeGreaterThanOrEqual(48)
    expect(m.titleFont % 12).toBe(0)
    expect(m.titleFont).toBe(Math.min(72, 60))

    expect(m.heroHeight / m.vh).toBeLessThanOrEqual(0.46)
    expect(m.heroBottom).toBeLessThanOrEqual(0.56 * m.vh)
    expect(m.sectionTop).toBeLessThanOrEqual(0.64 * m.vh)
    expect(m.visibleItems).toBeGreaterThanOrEqual(4)
    expect(m.overflow).toBeLessThanOrEqual(1)
  })

  /**
   * 强调色只能落在走廊外：像素光圈的 accent 校色环必须对走廊零贡献。
   *
   * 用差分成像而不是读 CSS 值：环是否侵入走廊取决于「半径 × 走廊遮罩 × 页面
   * 遮挡」三者的几何关系，读声明值看不出结论（138–140px 那一版读起来完全正常，
   * 实际却整段被页头盖住）。两张截图唯一差别是 ::after 在不在，
   * 内容不变所以互相抵消，剩下的差异只能是校色环画的。
   * PNG 交给浏览器自己用 canvas 解码，避免为测试引入图像库。
   */
  test('1440×900：像素光圈的 accent 校色环不进走廊，且仍在自由区显影', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await writeAppearance(page, { subject: 'px-aperture', palette: 'p1' })
    await expect(page.locator('[class*="subject-px-aperture"]')).toHaveCount(1)

    // 静止化：图与字必须在两次截图之间完全一致，否则假差异会被算成环的贡献
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() =>
      Array.from(document.images).every((img) => img.complete),
    )
    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
    })
    await page.waitForTimeout(200)

    const withRing = (await page.screenshot()).toString('base64')
    await page.addStyleTag({
      content: '.g-bg-subject-px-aperture::after { display: none !important; }',
    })
    const withoutRing = (await page.screenshot()).toString('base64')

    const diff = await page.evaluate(
      async ({ a, b }) => {
        const load = async (b64: string) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('2d context unavailable')
          ctx.drawImage(img, 0, 0)
          return ctx.getImageData(0, 0, canvas.width, canvas.height)
        }
        const A = await load(a)
        const B = await load(b)
        const w = A.width
        // 走廊 = 中央 1200px 内容列，与 --g-subj-corridor-half 对齐
        const [c0, c1] = [w / 2 - 600, w / 2 + 600] as const
        // noUncheckedIndexedAccess 下类型化数组下标是 number | undefined
        const at = (d: Uint8ClampedArray, i: number): number => d[i] ?? 0
        let inside = 0
        let outside = 0
        for (let y = 0; y < A.height; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4
            const d = Math.max(
              Math.abs(at(A.data, i) - at(B.data, i)),
              Math.abs(at(A.data, i + 1) - at(B.data, i + 1)),
              Math.abs(at(A.data, i + 2) - at(B.data, i + 2)),
            )
            if (d > 2) {
              if (x >= c0 && x <= c1) inside += 1
              else outside += 1
            }
          }
        }
        return { inside, outside }
      },
      { a: withRing, b: withoutRing },
    )

    expect(diff.inside).toBe(0)
    expect(diff.outside).toBeGreaterThan(50)
  })
})
