/**
 * IndexedDB 封装（DATA-MODEL §6 / ROADMAP §3）。
 * 库名 gy-db；表结构与 DATA-MODEL §6 一致，字段 camelCase。
 * 版本迁移：MIGRATIONS 数组顺序执行；_meta.schemaVersion 记录当前版本。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  Article,
  ArticleTopic,
  Category,
  Comment,
  Interaction,
  Photo,
  Profile,
  RankingEntry,
  RankingSnapshot,
} from '@/domain/types'

export const DB_NAME = 'gy-db'
export const DB_VERSION = 1

export interface GyDBSchema extends DBSchema {
  profiles: { key: string; value: Profile; indexes: { username: string } }
  photos: {
    key: string
    value: Photo
    indexes: { authorId: string; categorySlug: string; status: string; publishedAt: string }
  }
  categories: { key: string; value: Category; indexes: { sortOrder: number } }
  likes: { key: [string, string]; value: Interaction; indexes: { photoIdCreatedAt: [string, string] } }
  favorites: { key: [string, string]; value: Interaction; indexes: { photoIdCreatedAt: [string, string] } }
  comments: { key: string; value: Comment; indexes: { photoId: string } }
  rankSnapshots: {
    key: string
    value: RankingSnapshot
    indexes: { isoWeekKindVersion: [string, string, string] }
  }
  rankEntries: { key: [string, number]; value: RankingEntry; indexes: { photoId: string } }
  topics: { key: string; value: ArticleTopic; indexes: { sortOrder: number } }
  articles: {
    key: string
    value: Article
    indexes: { slug: string; topicSlug: string; publishedAt: string }
  }
  _meta: { key: string; value: { key: string; value: unknown } }
}

type Db = IDBPDatabase<GyDBSchema>

/** 迁移：每次改结构 +1 版本，在此追加（永远只增不改历史项） */
export const MIGRATIONS: Array<(db: Db) => void> = [
  // v1 → 初始建表
  (db) => {
    db.createObjectStore('profiles', { keyPath: 'id' })
    db.createObjectStore('photos', { keyPath: 'id' })
    db.createObjectStore('categories', { keyPath: 'slug' })
    db.createObjectStore('likes', { keyPath: ['userId', 'photoId'] })
    db.createObjectStore('favorites', { keyPath: ['userId', 'photoId'] })
    db.createObjectStore('comments', { keyPath: 'id' })
    db.createObjectStore('rankSnapshots', { keyPath: 'id' })
    db.createObjectStore('rankEntries', { keyPath: ['snapshotId', 'rank'] })
    db.createObjectStore('topics', { keyPath: 'slug' })
    db.createObjectStore('articles', { keyPath: 'id' })
    db.createObjectStore('_meta', { keyPath: 'key' })
  },
]

let dbPromise: Promise<Db> | null = null

/** 打开数据库（惰性单例）；onupgradeneeded 按 _meta.schemaVersion 依次跑迁移 */
export function getDb(): Promise<Db> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<GyDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      for (let v = oldVersion; v < DB_VERSION; v++) {
        MIGRATIONS[v]?.(db)
      }
    },
  })
  return dbPromise
}

/** 读 _meta 值 */
export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDb()
  const row = await db.get('_meta', key)
  return row ? (row.value as T) : null
}

/** 写 _meta 值（dataVersion 每次写入自增，供缓存失效判断） */
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('_meta', { key, value })
}

/** 自增 dataVersion 并返回新值（搜索索引与榜单缓存据此失效） */
export async function bumpDataVersion(): Promise<number> {
  const db = await getDb()
  const row = await db.get('_meta', 'dataVersion')
  const next = ((row?.value as number | undefined) ?? 0) + 1
  await db.put('_meta', { key: 'dataVersion', value: next })
  return next
}
