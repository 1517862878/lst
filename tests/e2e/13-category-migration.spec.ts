/**
 * 老用户分类迁移回归（mock 侧 seed 切片 5）。
 *
 * 为什么必须单独立一条：
 *   ensureSeeded() 的逻辑是「seededAt 存在 + seedSlice 已达上限 → 直接 return」。
 *   分类换代时如果忘了提高切片号，**只有新访客能看到新分类**，
 *   所有老用户的 IndexedDB 里仍是那 8 个旧题材分类（且 mockCategoryRepository
 *   优先读库，永远不会回落到常量）。
 *   这正是真实发生过的缺陷：线上用户截图里仍是「风景/人文/建筑」。
 *
 * 这条用例把库改造成「升级前」状态，再重载页面，验证迁移真的发生。
 */
import { expect, test } from '@playwright/test'
import { resetApp } from './utils'

const OLD_CATEGORIES = [
  { slug: 'landscape', name: '风景', description: '自然风光、地貌、天象', sortOrder: 1, coverPhotoId: null, isActive: true },
  { slug: 'people', name: '人文', description: '纪实、街拍、人物与生活', sortOrder: 2, coverPhotoId: null, isActive: true },
  { slug: 'architecture', name: '建筑', description: '建筑外观、室内、结构', sortOrder: 3, coverPhotoId: null, isActive: true },
  { slug: 'industrial', name: '工业', description: '工厂、机械、工程现场', sortOrder: 4, coverPhotoId: null, isActive: true },
  { slug: 'technology', name: '科技', description: '科技产品、实验、数码', sortOrder: 5, coverPhotoId: null, isActive: true },
  { slug: 'macro', name: '微距', description: '微距摄影、细节特写', sortOrder: 6, coverPhotoId: null, isActive: true },
  { slug: 'night', name: '夜景', description: '夜间、长曝、星空', sortOrder: 7, coverPhotoId: null, isActive: true },
  { slug: 'monochrome', name: '黑白', description: '黑白摄影、影调', sortOrder: 8, coverPhotoId: null, isActive: true },
]
const OLD_SLUGS = OLD_CATEGORIES.map((c) => c.slug)
const NEW_SLUGS = [
  'campus-fresh', 'travel-doc', 'japanese-soft', 'hk-retro',
  'new-chinese', 'korean-clear', 'cinematic-dark', 'american-retro',
]

/** 把当前库改造成「分类换代之前」的状态，并返回改造前的作品数 */
async function downgradeToLegacy(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    async ({ oldCats, oldSlugs }) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('gy-db')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const reqToPromise = <T,>(req: IDBRequest<T>) =>
        new Promise<T>((res, rej) => {
          req.onsuccess = () => res(req.result)
          req.onerror = () => rej(req.error)
        })

      const tx = db.transaction(['categories', 'photos', '_meta'], 'readwrite')
      const catsStore = tx.objectStore('categories')
      const photoStore = tx.objectStore('photos')
      const metaStore = tx.objectStore('_meta')

      // 1) 分类表换回旧题材分类
      const existing = await reqToPromise(catsStore.getAll())
      for (const c of existing) await catsStore.delete(c.slug)
      for (const c of oldCats) await catsStore.put(c)

      // 2) 作品的分类按旧体系重新指派
      const photos = await reqToPromise(photoStore.getAll())
      for (let i = 0; i < photos.length; i += 1) {
        await photoStore.put({ ...photos[i]!, categorySlug: oldSlugs[i % oldSlugs.length] })
      }

      // 3) 切片号退回，模拟老用户
      await metaStore.put({ key: 'seedSlice', value: 4 })

      await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
      db.close()
      return photos.length
    },
    { oldCats: OLD_CATEGORIES, oldSlugs: OLD_SLUGS },
  )
}

/** 读库里的分类 slug 与作品分类 */
async function readState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('gy-db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const readAll = <T,>(store: string) =>
      new Promise<T[]>((res, rej) => {
        const t = db.transaction(store, 'readonly').objectStore(store).getAll()
        t.onsuccess = () => res(t.result as T[])
        t.onerror = () => rej(t.error)
      })
    const cats = await readAll<{ slug: string }>('categories')
    const photos = await readAll<{ categorySlug: string }>('photos')
    const meta = await readAll<{ key: string; value: unknown }>('_meta')
    db.close()
    return {
      catSlugs: cats.map((c) => c.slug).sort(),
      photoCount: photos.length,
      photoSlugs: [...new Set(photos.map((p) => p.categorySlug))].sort(),
      slice: Number(meta.find((m) => m.key === 'seedSlice')?.value),
    }
  })
}

test.describe('老用户分类迁移', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page)
  })

  test('旧分类数据在下次打开时被迁移成 8 个新分类，作品一件不丢', async ({ page }) => {
    // 前置：先把库弄成「换代前」，并确认它真的是旧状态（否则后面的断言是空跑）
    const photoCount = await downgradeToLegacy(page)
    const before = await readState(page)
    expect(before.slice).toBe(4)
    expect(before.catSlugs).toHaveLength(8)
    expect(before.catSlugs.every((s) => OLD_SLUGS.includes(s))).toBe(true)
    expect(before.photoSlugs.every((s) => OLD_SLUGS.includes(s))).toBe(true)

    // 重新打开应用 → 触发 ensureSeeded() 的切片 5
    await page.reload()
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(800)

    const after = await readState(page)
    expect(after.slice).toBe(5)
    expect(after.catSlugs).toHaveLength(8)
    expect(after.catSlugs.every((s) => NEW_SLUGS.includes(s))).toBe(true)
    expect(after.catSlugs.some((s) => OLD_SLUGS.includes(s))).toBe(false)
    // 迁移只改分类，不能丢作品
    expect(after.photoCount).toBe(photoCount)
    expect(after.photoSlugs.every((s) => NEW_SLUGS.includes(s))).toBe(true)

    // 界面上也要看不到旧分类（用户报的就是界面）
    await page.goto('/categories')
    // 分类列表是异步查询，必须等它渲染完再读，否则会读到 0 个
    await expect(page.getByRole('heading', { name: '分类总览' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('a[href^="/categories/"]').first()).toBeVisible({ timeout: 20_000 })
    const uiSlugs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/categories/"]')].map((a) =>
        (a.getAttribute('href') ?? '').replace('/categories/', ''),
      ),
    )
    expect(uiSlugs).toHaveLength(8)
    expect(uiSlugs.every((s) => NEW_SLUGS.includes(s))).toBe(true)
  })

  test('迁移是幂等的：连续打开两次不会重复改动', async ({ page }) => {
    await downgradeToLegacy(page)
    await page.reload()
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(600)
    const first = await readState(page)

    await page.reload()
    await expect(page.locator('a[href^="/works/"]').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(600)
    const second = await readState(page)

    expect(second.catSlugs).toEqual(first.catSlugs)
    expect(second.photoCount).toBe(first.photoCount)
    expect(second.photoSlugs).toEqual(first.photoSlugs)
  })
})
