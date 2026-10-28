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
 */
const SEED_SLICE = 2

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
      await tx.done

      await setMeta('seededAt', new Date().toISOString())
      await setMeta('dataVersion', 1)
      await setMeta('seedSlice', SEED_SLICE)
      return
    }

    if ((slice ?? 1) >= SEED_SLICE) return

    // 老库补播社交切片：只写 follows / notifications（id 确定，重复跑也安全）
    const seed = buildSeedData()
    const tx = db.transaction(['follows', 'notifications'], 'readwrite')
    for (const f of seed.follows) await tx.objectStore('follows').put(f)
    for (const n of seed.notifications) await tx.objectStore('notifications').put(n)
    await tx.done
    await setMeta('seedSlice', SEED_SLICE)
  })()
  return seeding
}
