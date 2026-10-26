/**
 * 公共测试工具（ROADMAP G-4）。
 *
 * 设计原则：
 *   1) 选择器优先用「用户能看见的文字」，不用 CSS class —— 类名会随重构变化，文案相对稳定
 *   2) 每个测试用例都从干净的 IndexedDB 出发，避免种子数据与上一次操作互相污染
 *   3) 登录走「演示账号一键填入」按钮，测的是用户真实路径
 */
import { expect, type Page } from '@playwright/test'

/** 演示账号（与 src/domain/constants.ts 一致） */
export const DEMO = {
  alice: { username: 'alice', password: 'demo1234', displayName: '爱丽丝' },
  bob: { username: 'bob', password: 'demo1234', displayName: '鲍勃' },
  editor: { username: 'editor', password: 'demo1234', displayName: '编辑小工' },
} as const

/** 已知种子作品 id（seed 生成，见 src/data/mock/seed.ts） */
export const SEED_PHOTO_ID = 'seed-photo-001'

/**
 * 清空浏览器侧全部持久化数据并刷新。
 * 为什么要清 IndexedDB + localStorage：
 *   - 应用启动时 seedInit 会幂等灌种子，若残留上次数据会导致断言计数对不上
 *   - 会话存在 localStorage，不清会带着登录态进入下一个用例
 */
export async function resetApp(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
      const dbs = (await indexedDB.databases?.()) ?? []
      await Promise.all(
        dbs.map(
          (d) =>
            new Promise<void>((resolve) => {
              if (!d.name) return resolve()
              const req = indexedDB.deleteDatabase(d.name)
              req.onsuccess = () => resolve()
              req.onerror = () => resolve()
              req.onblocked = () => resolve()
            }),
        ),
      )
    } catch {
      // 某些环境下 databases() 不可用，退化为只清 localStorage
    }
  })
  await page.reload()
  // 等待种子灌入完成：首页出现作品卡片才算就绪
  await expect(page.locator('a[href^="/works/"]').first()).toBeVisible({ timeout: 30_000 })
}

/** 通过演示账号一键填入完成登录，并等待跳转 */
export async function signIn(page: Page, who: keyof typeof DEMO = 'alice', next = '/'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  const account = DEMO[who]
  await page.getByRole('button', { name: new RegExp(`^${account.displayName}（${account.username}）`) }).click()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  // 登录成功后离开 /login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
}

/** 统计页面上当前可见的作品卡片数量 */
export async function countPhotoCards(page: Page): Promise<number> {
  return page.locator('a[href^="/works/"]').count()
}
