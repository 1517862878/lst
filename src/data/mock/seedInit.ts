/**
 * seed 初始化：首次访问把演示数据写入 IndexedDB（幂等，只跑一次）。
 * 调用方：main.tsx 启动时 ensureSeeded()（ROADMAP §5.2）。
 */
import { ARTICLE_TOPICS, CATEGORIES } from '@/domain/constants'
import { getDb, getMeta, setMeta } from './db'
import { buildSeedData } from './seed'

let seeding: Promise<void> | null = null

export async function ensureSeeded(): Promise<void> {
  if (seeding) return seeding
  seeding = (async () => {
    const seededAt = await getMeta<string>('seededAt')
    if (seededAt) return
    const db = await getDb()
    const seed = buildSeedData()

    const tx = db.transaction(
      ['profiles', 'photos', 'categories', 'likes', 'favorites', 'comments', 'topics', 'articles'],
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
    await tx.done

    await setMeta('seededAt', new Date().toISOString())
    await setMeta('dataVersion', 1)
  })()
  return seeding
}
