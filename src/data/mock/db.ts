/**
 * IndexedDB 封装（DATA-MODEL §6 / ROADMAP §3）。
 * 库名 gy-db；表结构与 DATA-MODEL §6 一致，字段 camelCase。
 * 版本迁移：MIGRATIONS 数组顺序执行；_meta.schemaVersion 记录当前版本。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  AppNotification,
  Appeal,
  Article,
  ArticleTopic,
  Category,
  Comment,
  Follow,
  Interaction,
  ModerationAction,
  Photo,
  PhotoItem,
  Profile,
  RankingEntry,
  RankingSnapshot,
  Report,
  MySanction,
} from '@/domain/types'

export const DB_NAME = 'gy-db'
export const DB_VERSION = 5

/**
 * 组照条目的存储行（8.4c）。
 *
 * 主键是 `[photoId, position]`：mock 侧和 SQL 一样按「作品 + 序号」唯一，
 * 整组替换 = 先删该 photoId 的全部行再写新行，不会出现重复序号。
 * `id` 借自 PhotoItem（读取时返回给界面），与后端 photo_items.id 同义。
 */
export type PhotoItemRow = PhotoItem & { photoId: string }

/**
 * 通知的存储行。
 *
 * 为什么多了 userId：契约里的 AppNotification **没有**归属字段——后端只返回
 * 「当前登录用户」的通知，归属由会话决定。但本地库是所有用户共用的，
 * 必须记下「这条是给谁的」，否则登录 bob 会看到 alice 的通知。
 * userId 只存在于存储层，出库前一律剥掉（见 mock/repositories/social.ts）。
 */
export type NotificationRow = AppNotification & { userId: string }

/** 拉黑关系（有向存储；读取权限时任一方向都生效） */
export interface BlockRow {
  blockerId: string
  blockedId: string
  createdAt: string
}

/**
 * 处罚存储行。
 *
 * 与 MySanction 的差异只有 userId：契约里的 MySanction 是「我受到的处罚」，
 * 归属由会话决定；本地库是所有用户共用的，必须显式记下被处罚人。
 * 后台处罚列表靠它按人聚合。
 */
export type SanctionRow = MySanction & {
  userId: string
  /** 作出处罚的审核员（profiles.id）；种子数据里是 editor */
  createdBy: string | null
}

/** 申诉存储行（同样多一个归属字段，出库前剥掉） */
export type AppealRow = Appeal & { appellantId: string }

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
  /** 关注关系；主键 (followerId, followingId)，按 followingId 建索引取粉丝、按 followerId 取关注 */
  follows: { key: [string, string]; value: Follow; indexes: { followingId: string; followerId: string } }
  /** 通知（见 NotificationRow：存储层多一个 userId） */
  notifications: { key: string; value: NotificationRow; indexes: { userId: string } }
  blocks: {
    key: [string, string]
    value: BlockRow
    indexes: { blockerId: string; blockedId: string }
  }
  /** 举报（8.2）；后台队列按 status 索引，我的举报按 reporterId 取 */
  reports: {
    key: string
    value: Report & { reporterId: string | null }
    indexes: { reporterId: string; status: string }
  }
  /** 处罚（8.2）；我的处罚按 userId，后台列表可按 status 过滤 */
  sanctions: { key: string; value: SanctionRow; indexes: { userId: string; status: string } }
  /** 申诉（8.2）；我的申诉按 appellantId，后台队列按 status */
  appeals: {
    key: string
    value: AppealRow
    indexes: { appellantId: string; status: string; reportId: string }
  }
  /** 审计条目（8.2，只增不改） */
  moderationActions: {
    key: string
    value: ModerationAction
    indexes: { targetId: string; createdAt: string }
  }
  /** 组照条目（8.4c）；按 photoId 取一组，按 position 排序即作者排好的顺序 */
  photoItems: {
    key: [string, number]
    value: PhotoItemRow
    indexes: { photoId: string }
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
  // v1 → v2：二期社交（关注关系 + 站内通知）
  //
  // 老库升级时这两张表是空的：用户已有的 IndexedDB 不会重新播种
  // （seedInit 只在库里没资料时跑）。所以升级后老用户看到的是
  // 「关注 0 / 通知 0」而不是报错——这是可接受的降级，
  // 想要示例数据需要清站点数据（README 已说明重置方式）。
  (db) => {
    const follows = db.createObjectStore('follows', { keyPath: ['followerId', 'followingId'] })
    follows.createIndex('followingId', 'followingId')
    follows.createIndex('followerId', 'followerId')
    const notifications = db.createObjectStore('notifications', { keyPath: 'id' })
    notifications.createIndex('userId', 'userId')
  },
  // v2 → v3：用户拉黑
  (db) => {
    const blocks = db.createObjectStore('blocks', { keyPath: ['blockerId', 'blockedId'] })
    blocks.createIndex('blockerId', 'blockerId')
    blocks.createIndex('blockedId', 'blockedId')
  },
  // v3 → v4：8.2 治理（举报 / 处罚 / 申诉 / 审计）
  //
  // 老库升级后这四张表是空的，由 seedSlice=3 补播演示数据（见 seedInit.ts）。
  (db) => {
    const reports = db.createObjectStore('reports', { keyPath: 'id' })
    reports.createIndex('reporterId', 'reporterId')
    reports.createIndex('status', 'status')
    const sanctions = db.createObjectStore('sanctions', { keyPath: 'id' })
    sanctions.createIndex('userId', 'userId')
    sanctions.createIndex('status', 'status')
    const appeals = db.createObjectStore('appeals', { keyPath: 'id' })
    appeals.createIndex('appellantId', 'appellantId')
    appeals.createIndex('status', 'status')
    appeals.createIndex('reportId', 'reportId')
    const actions = db.createObjectStore('moderationActions', { keyPath: 'id' })
    actions.createIndex('targetId', 'targetId')
    actions.createIndex('createdAt', 'createdAt')
  },
  // v4 → v5：8.4c 组照（photo_items）
  //
  // 老库升级后这张表是空的：既有作品都是单图（items 为空、item_count 缺省 = 0），
  // 页面按「没有组照」渲染，行为和升级前完全一致。
  (db) => {
    const photoItems = db.createObjectStore('photoItems', { keyPath: ['photoId', 'position'] })
    photoItems.createIndex('photoId', 'photoId')
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
