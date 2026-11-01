/**
 * seed 初始化：首次访问把演示数据写入 IndexedDB（幂等，只跑一次）。
 * 调用方：main.tsx 启动时 ensureSeeded()（ROADMAP §5.2）。
 */
import { ARTICLE_TOPICS, CATEGORIES } from '@/domain/constants'
import { getDb, getMeta, setMeta } from './db'
import { buildSeedData } from './seed'

/**
 * 数据切片版本。
 *
 * 为什么不能只看 seededAt：老用户库里已经有 seededAt，直接 return 的话，
 * 二期新增的 follows / notifications 两张表永远是空的 ——
 * 表现为「升级后所有人都没有粉丝、也没有通知」，看起来像功能没做。
 * 所以再加一个切片号：老库带着旧切片号进来时，只补播新切片（社交关系），
 * 不动用户已有的作品/互动数据。
 *
 * 切片 3：8.2 治理（reports / sanctions / appeals / moderationActions）。
 * 同样只补播这四张表，不碰作品与互动。
 *
 * 切片 4：8.3d 通知语义（每条通知补 meta：回复 / 周榜）。老库里的通知是
 * 没有 meta 的旧剧本，重播一遍通知表即可（id 确定，put 覆盖；会把这 7 条
 * 的已读状态重置回种子值 —— 演示数据本来就是给人随手点的，可以接受）。
 *
 * 切片 5：2026-11 分类体系换代（题材 → 风格）。
 * 这一片与前面几片有本质区别 —— 它**必须改已有数据**，不能只是补播：
 *   · categories 表里躺着 8 个旧题材分类（风景/人文/…/黑白），
 *     而 mockCategoryRepository.list() 优先读库，读到旧行就永远显示旧分类；
 *   · photos.categorySlug 也还指向旧 slug，不迁移就会挂在已下架的分类上
 *     （后端那套外键约束在 mock 侧没有，所以不会报错，只会静默错乱）。
 * 所以这片做三件事：删旧分类行、写入新分类行、按语义映射改写作品的分类。
 * 旧→新映射与迁移 0038 逐条一致，保证 mock 与真实 API 行为同构。
 */
const SEED_SLICE = 5

/**
 * 旧分类 slug → 新分类 slug（与 supabase/migrations/0038 的映射表逐条一致）。
 *
 * 一致性为什么重要：mock 与 api 两种数据源要能互相替换，
 * 同一件作品在两种模式下不能落进不同风格的分类里。
 */
const CATEGORY_SLUG_MIGRATION: Record<string, string> = {
  landscape: 'travel-doc',
  people: 'travel-doc',
  architecture: 'cinematic-dark',
  industrial: 'cinematic-dark',
  technology: 'new-chinese',
  macro: 'japanese-soft',
  night: 'hk-retro',
  monochrome: 'cinematic-dark',
}

let seeding: Promise<void> | null = null

export async function ensureSeeded(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    const seededAt = await getMeta<string>('seededAt')
    const slice = await getMeta<number>('seedSlice')
    const db = await getDb()

    if (!seededAt) {
      const seed = buildSeedData()

      const tx = db.transaction(
        [
          'profiles',
          'photos',
          'categories',
          'likes',
          'favorites',
          'comments',
          'topics',
          'articles',
          'follows',
          'notifications',
          'reports',
          'sanctions',
          'appeals',
          'moderationActions',
        ],
        'readwrite',
      )
      for (const p of seed.profiles) await tx.objectStore('profiles').put(p)
      for (const p of seed.photos) await tx.objectStore('photos').put(p)
      for (const c of CATEGORIES) await tx.objectStore('categories').put(c)
      for (const l of seed.likes) await tx.objectStore('likes').put(l)
      for (const f of seed.favorites) await tx.objectStore('favorites').put(f)
      for (const c of seed.comments) await tx.objectStore('comments').put(c)
      for (const t of ARTICLE_TOPICS) await tx.objectStore('topics').put(t)
      for (const a of seed.articles) await tx.objectStore('articles').put(a)
      for (const f of seed.follows) await tx.objectStore('follows').put(f)
      for (const n of seed.notifications) await tx.objectStore('notifications').put(n)
      for (const r of seed.reports) await tx.objectStore('reports').put(r)
      for (const s of seed.sanctions) await tx.objectStore('sanctions').put(s)
      for (const a of seed.appeals) await tx.objectStore('appeals').put(a)
      for (const a of seed.moderationActions) await tx.objectStore('moderationActions').put(a)
      await tx.done

      await setMeta('seededAt', new Date().toISOString())
      await setMeta('dataVersion', 1)
      await setMeta('seedSlice', SEED_SLICE)
      return
    }

    if ((slice ?? 1) >= SEED_SLICE) return

    const seed = buildSeedData()

    // 老库补播社交切片：只写 follows / notifications（id 确定，重复跑也安全）
    if ((slice ?? 1) < 2) {
      const tx = db.transaction(['follows', 'notifications'], 'readwrite')
      for (const f of seed.follows) await tx.objectStore('follows').put(f)
      for (const n of seed.notifications) await tx.objectStore('notifications').put(n)
      await tx.done
    }

    // 8.3d 通知切片：通知表带上 meta（回复 / 周榜），只重播通知，不动其它表
    if ((slice ?? 1) < 4) {
      const notifyTx = db.transaction(['notifications'], 'readwrite')
      for (const n of seed.notifications) await notifyTx.objectStore('notifications').put(n)
      await notifyTx.done
    }

    // 8.2 治理切片：四张表全部按确定 id 写入，重复跑只会覆盖同一条演示记录
    const moderationTx = db.transaction(
      ['reports', 'sanctions', 'appeals', 'moderationActions'],
      'readwrite',
    )
    for (const r of seed.reports) await moderationTx.objectStore('reports').put(r)
    for (const s of seed.sanctions) await moderationTx.objectStore('sanctions').put(s)
    for (const a of seed.appeals) await moderationTx.objectStore('appeals').put(a)
    for (const a of seed.moderationActions) {
      await moderationTx.objectStore('moderationActions').put(a)
    }
    await moderationTx.done

    // 切片 5：分类体系换代 —— 删旧分类、写新分类、改写作品分类
    if ((slice ?? 1) < 5) {
      const catTx = db.transaction(['categories', 'photos'], 'readwrite')
      const categories = catTx.objectStore('categories')

      // 1) 删掉旧题材分类（它们在 CATEGORIES 里已不存在）
      const oldSlugs = Object.keys(CATEGORY_SLUG_MIGRATION)
      for (const slug of oldSlugs) await categories.delete(slug)

      // 2) 写入 8 个新风格分类
      for (const c of CATEGORIES) await categories.put(c)

      // 3) 逐件改写作品的分类（只动 categorySlug，其它字段原样保留）
      const photos = catTx.objectStore('photos')
      const all = await photos.getAll()
      let migrated = 0
      for (const photo of all) {
        const next = CATEGORY_SLUG_MIGRATION[photo.categorySlug]
        if (!next) continue
        await photos.put({ ...photo, categorySlug: next, updatedAt: new Date().toISOString() })
        migrated += 1
      }
      await catTx.done
      if (migrated > 0) {
        console.info(`[seed] 分类体系换代：${migrated} 件作品已迁移到风格分类`)
      }
    }

    await setMeta('seedSlice', SEED_SLICE)
  })()
  return seeding
}
