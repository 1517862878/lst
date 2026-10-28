/**
 * 撤回可见性回归：同一 SPA 会话内撤回后，所有公开入口都不再暴露目标作品。
 *
 * 选择当前榜首作为目标，确保撤回前它同时存在于作品墙、搜索、当前周榜；
 * 再用同分类作品详情的「相关作品」覆盖推荐入口。
 */
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './utils'

async function expectTargetAbsent(page: Page, targetHref: string): Promise<void> {
  await expect(page.locator(`a[href="${targetHref}"]`)).toHaveCount(0)
}

test('作者撤回后，作品从公开入口和直达页消失', async ({ page }) => {
  test.setTimeout(90_000)
  // resetApp 会在当前模块单例数据库已打开后删除 IDB，可能触发 blocked 并留下空库；
  // 本回归用独立 BrowserContext，直接等待首次启动完成，仍从干净存储开始。
  await page.goto('/')
  // 首页首批卡片出现时种子事务可能仍在提交；等 80 条确定性作品齐备再做全表选择，避免竞态。
  await expect.poll(
    () => page.evaluate(async () => {
      const request = indexedDB.open('gy-db')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const countRequest = db.transaction('photos', 'readonly').objectStore('photos').count()
      return new Promise<number>((resolve, reject) => {
        countRequest.onsuccess = () => resolve(countRequest.result)
        countRequest.onerror = () => reject(countRequest.error)
      })
    }),
  ).toBe(80)

  // 从 IndexedDB 只读取确定性种子元数据，选一个演示账号作者、能进入当前榜单且有同分类邻居的目标。
  const candidate = await page.evaluate(async () => {
    const request = indexedDB.open('gy-db')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['photos', 'profiles'], 'readonly')
    const all = <T,>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const getAll = tx.objectStore(store).getAll()
        getAll.onsuccess = () => resolve(getAll.result as T[])
        getAll.onerror = () => reject(getAll.error)
      })
    const [photos, profiles] = await Promise.all([
      all<{ id: string; authorId: string; title: string; categorySlug: string; status: string; likeCount: number; publishedAt: string | null }>('photos'),
      all<{ id: string; username: string }>('profiles'),
    ])
    const demoUsers = new Set(['alice', 'bob', 'editor'])
    const profileById = new Map(profiles.map((profile) => [profile.id, profile.username]))
    const target = photos
      .filter((photo) => photo.status === 'published')
      .sort((a, b) => b.likeCount - a.likeCount)
      .find((photo) => {
        if (!demoUsers.has(profileById.get(photo.authorId) ?? '')) return false
        const sameCategory = photos
          .filter((other) => other.status === 'published' && other.categorySlug === photo.categorySlug)
          .sort((a, b) => b.likeCount - a.likeCount)
        // 目标需位于画廊首屏（最新 24 张）、分类相关前 6；全局高赞也提高进入当前榜单的确定性。
        const galleryFirstPage = [...photos]
          .filter((item) => item.status === 'published')
          .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
          .slice(0, 24)
        return (
          galleryFirstPage.some((item) => item.id === photo.id) &&
          sameCategory.length > 1 &&
          sameCategory.slice(0, 6).some((other) => other.id === photo.id)
        )
      })
    if (!target) return null
    return { ...target, username: profileById.get(target.authorId)! }
  })
  expect(candidate).not.toBeNull()
  const targetHref = `/works/${candidate!.id}`
  const targetTitle = candidate!.title
  const username = candidate!.username as 'alice' | 'bob' | 'editor'

  // 用同分类作品作为相关推荐的宿主页；撤回前目标应出现在该页的「相关作品」。
  const relatedHref = await page.evaluate(async ({ targetId, categorySlug }) => {
    const request = indexedDB.open('gy-db')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const getAll = db.transaction('photos', 'readonly').objectStore('photos').getAll()
    const photos = await new Promise<Array<{ id: string; categorySlug: string; status: string }>>((resolve, reject) => {
      getAll.onsuccess = () => resolve(getAll.result)
      getAll.onerror = () => reject(getAll.error)
    })
    const host = photos.find(
      (photo) => photo.status === 'published' && photo.categorySlug === categorySlug && photo.id !== targetId,
    )
    return host ? `/works/${host.id}` : ''
  }, { targetId: candidate!.id, categorySlug: candidate!.categorySlug })
  expect(relatedHref).toMatch(/^\/works\/seed-photo-\d{3}$/)

  await signIn(page, username, targetHref)
  await expect(page.getByRole('button', { name: '撤回作品' })).toBeVisible()

  // 撤回前先证明目标确实可从画廊、搜索、榜单与相关作品访问。
  await page.goto('/gallery')
  await expect(page.locator(`a[href="${targetHref}"]`).first()).toBeVisible()
  await page.goto(`/search?q=${encodeURIComponent(targetTitle!)}`)
  await expect(page.locator(`a[href="${targetHref}"]`).first()).toBeVisible()
  await page.goto('/rankings/weekly')
  await expect(page.locator(`a[href="${targetHref}"]`).first()).toBeVisible()
  await page.goto(relatedHref!)
  await expect(page.locator(`[aria-labelledby="related-title"] a[href="${targetHref}"]`).first()).toBeVisible()

  await page.goto(targetHref!)
  await page.getByRole('button', { name: '撤回作品' }).click()
  await expect(page.getByRole('dialog', { name: '确认撤回作品？' })).toBeVisible()
  await page.getByRole('button', { name: '确认撤回' }).click()
  await expect(page).toHaveURL(/\/me$/)

  // 不刷新浏览器、不重置存储：保持同一 SPA 会话逐一验证所有公开入口。
  await page.goto('/gallery')
  await expectTargetAbsent(page, targetHref!)
  await page.goto(`/search?q=${encodeURIComponent(targetTitle!)}`)
  await expectTargetAbsent(page, targetHref!)
  await page.goto('/rankings/weekly')
  await expectTargetAbsent(page, targetHref!)
  await page.goto(relatedHref!)
  await expectTargetAbsent(page, targetHref!)
  await page.goto(targetHref!)
  await expect(page.getByText('作品不存在或已删除')).toBeVisible()
  await expect(page.getByRole('heading', { name: targetTitle! })).toHaveCount(0)
})
