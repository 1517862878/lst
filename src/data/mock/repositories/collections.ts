/**
 * Mock 收藏夹与服务端草稿仓储（8.3b）。
 *
 * 行为与 api 实现对齐（同一份契约）：
 *   - private 只有本人可读；unlisted 凭 id 可读；public 额外出现在列表里；
 *   - 别人的私密夹一律 NOT_FOUND（不是 FORBIDDEN），页面据此渲染空态；
 *   - 加入/移出幂等；
 *   - 每个用户最多 30 个未删除夹。
 *
 * 落在 localStorage 而不是 IndexedDB：收藏夹是「新表」，加进 IndexedDB 要升 schema 版本、
 * 写迁移、还要处理老库升级失败的回滚；而它每次读写都只涉及当前用户的一小撮数据，
 * localStorage 的同步语义反而更简单（也不会出现两个标签页写冲突后的静默丢数据）。
 */
import {
  AppError,
  ErrorCodes,
  type Collection,
  type CollectionRepository,
  type CollectionSummary,
  type CollectionVisibility,
  type CursorListPage,
  type PublishDraft,
  type PublishDraftPayload,
} from '@/data/contracts'
import type { IsoDate, Photo } from '@/domain/types'
import { getDb } from '../db'

const COLLECTIONS_KEY = 'gy:collections'
const DRAFT_KEY = 'gy:publish-draft'
const SESSION_KEY = 'gy:session'

/** 单个用户最多 30 个收藏夹（与 0028 的配额一致） */
const MAX_COLLECTIONS = 30
/** 标题/简介上限与数据库 check 约束一致 */
const TITLE_MAX = 40
const DESCRIPTION_MAX = 200

interface StoredCollection {
  id: string
  ownerId: string
  title: string
  description: string
  visibility: CollectionVisibility
  photoIds: string[]
  createdAt: IsoDate
  updatedAt: IsoDate
  deletedAt: IsoDate | null
}

interface Store {
  collections: StoredCollection[]
}

interface MockSession {
  userId: string
  username: string
  displayName: string
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY)
    if (!raw) return { collections: [] }
    const parsed = JSON.parse(raw) as Store
    return { collections: Array.isArray(parsed.collections) ? parsed.collections : [] }
  } catch {
    return { collections: [] }
  }
}

function writeStore(store: Store): void {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(store))
}

function currentSession(): MockSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MockSession>
    if (!parsed.userId || !parsed.username) return null
    return {
      userId: parsed.userId,
      username: parsed.username,
      displayName: parsed.displayName ?? parsed.username,
    }
  } catch {
    return null
  }
}

async function loadPhotos(): Promise<Photo[]> {
  const db = await getDb()
  return db.getAll('photos')
}

function visibleTo(collection: StoredCollection, viewerId: string | null): boolean {
  if (collection.deletedAt) return false
  if (collection.visibility === 'public' || collection.visibility === 'unlisted') return true
  return collection.ownerId === viewerId
}

function summarize(
  collection: StoredCollection,
  owner: { username: string; displayName: string },
  viewerId: string | null,
  options?: { photoId?: string },
): CollectionSummary {
  const summary: CollectionSummary = {
    id: collection.id,
    title: collection.title,
    description: collection.description,
    visibility: collection.visibility,
    itemCount: collection.photoIds.length,
    coverPhotoId: collection.photoIds[0] ?? null,
    ownerUsername: owner.username,
    ownerDisplayName: owner.displayName,
    updatedAt: collection.updatedAt,
  }
  if (options?.photoId) summary.hasPhoto = collection.photoIds.includes(options.photoId)
  return { ...summary, isOwner: collection.ownerId === viewerId } as CollectionSummary
}

/** 收藏夹所有者信息：mock 库里只有 profile，这里按 id 兜底成「未知用户」 */
async function ownerOf(ownerId: string, session: MockSession | null): Promise<{
  username: string
  displayName: string
}> {
  if (session && session.userId === ownerId) {
    return { username: session.username, displayName: session.displayName }
  }
  const db = await getDb()
  try {
    const profile = await db.get('profiles', ownerId)
    if (profile) return { username: profile.username, displayName: profile.displayName }
  } catch {
    /* 读不到就降级 */
  }
  return { username: 'unknown', displayName: '未知用户' }
}

function parseTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new AppError(ErrorCodes.VALIDATION, '收藏夹标题不能为空')
  if (title.length > TITLE_MAX) {
    throw new AppError(ErrorCodes.VALIDATION, `收藏夹标题不能超过 ${TITLE_MAX} 个字符`)
  }
  return title
}

function parseDescription(value: unknown): string {
  const description = typeof value === 'string' ? value.trim() : ''
  if (description.length > DESCRIPTION_MAX) {
    throw new AppError(ErrorCodes.VALIDATION, `收藏夹简介不能超过 ${DESCRIPTION_MAX} 个字符`)
  }
  return description
}

function parseVisibility(value: unknown): CollectionVisibility {
  if (value === 'private' || value === 'unlisted' || value === 'public') return value
  throw new AppError(ErrorCodes.VALIDATION, '可见性只能是 private / unlisted / public')
}

function requireSession(): MockSession {
  const session = currentSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录')
  return session
}

function liveCollections(store: Store): StoredCollection[] {
  return store.collections.filter((item) => !item.deletedAt)
}

function findOwned(store: Store, id: string, ownerId: string): StoredCollection {
  const found = store.collections.find((item) => item.id === id && !item.deletedAt)
  // 不存在与不是自己的都用 NOT_FOUND：不泄漏「这个 id 存在但属于别人」
  if (!found || found.ownerId !== ownerId) {
    throw new AppError(ErrorCodes.NOT_FOUND, '这个收藏夹不存在或不可见')
  }
  return found
}

/** 首次使用时给一个可演示的初始状态：一个公开夹、一个私密夹 */
async function ensureSeed(session: MockSession): Promise<void> {
  const store = readStore()
  const mine = liveCollections(store).filter((item) => item.ownerId === session.userId)
  if (mine.length > 0) return
  const photos = (await loadPhotos()).filter((photo) => photo.status === 'published')
  if (photos.length === 0) return
  const now = new Date().toISOString()
  const publicPhotos = photos.slice(0, 3).map((photo) => photo.id)
  store.collections.push(
    {
      id: `mock-col-public-${session.userId.slice(0, 8)}`,
      ownerId: session.userId,
      title: '值得反复看的风景',
      description: '自己挑出来的三张，公开可见。',
      visibility: 'public',
      photoIds: publicPhotos,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: `mock-col-private-${session.userId.slice(0, 8)}`,
      ownerId: session.userId,
      title: '还在整理的私藏',
      description: '只有自己能看到。',
      visibility: 'private',
      photoIds: photos.slice(3, 5).map((photo) => photo.id),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  )
  writeStore(store)
}

export const mockCollectionRepository: CollectionRepository = {
  async getMyDraft(): Promise<PublishDraft> {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return { payload: null, updatedAt: null }
      const parsed = JSON.parse(raw) as { payload: PublishDraftPayload; updatedAt: IsoDate }
      return { payload: parsed.payload ?? null, updatedAt: parsed.updatedAt ?? null }
    } catch {
      return { payload: null, updatedAt: null }
    }
  },

  async saveMyDraft(payload: PublishDraftPayload): Promise<{ updatedAt: IsoDate }> {
    const updatedAt = new Date().toISOString()
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ payload, updatedAt }))
    return { updatedAt }
  },

  async deleteMyDraft(): Promise<void> {
    localStorage.removeItem(DRAFT_KEY)
  },

  async listMyCollections(options?: { photoId?: string }): Promise<CollectionSummary[]> {
    const session = requireSession()
    await ensureSeed(session)
    const store = readStore()
    const mine = liveCollections(store).filter((item) => item.ownerId === session.userId)
    const owner = { username: session.username, displayName: session.displayName }
    return mine
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => summarize(item, owner, session.userId, options))
  },

  async listUserCollections(username: string): Promise<CollectionSummary[]> {
    const viewer = currentSession()
    const db = await getDb()
    let ownerId = ''
    try {
      const profile = await db.getAll('profiles')
      const hit = profile.find((item) => item.username === username)
      ownerId = hit?.id ?? ''
    } catch {
      ownerId = ''
    }
    if (!ownerId) return []
    const store = readStore()
    const isSelf = viewer?.userId === ownerId
    // 别人的私密夹不出现；unlisted 也不出现在列表里（只能凭 id 打开）
    return liveCollections(store)
      .filter((item) => item.ownerId === ownerId)
      // 别人只能看到 public；本人还能看到 unlisted 与 private（unlisted 不进他人列表）
      .filter((item) => isSelf || item.visibility === 'public')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => summarize(item, { username, displayName: username }, viewer?.userId ?? null))
  },

  async getCollection(id: string): Promise<Collection> {
    const viewer = currentSession()
    const store = readStore()
    const found = store.collections.find((item) => item.id === id)
    if (!found || !visibleTo(found, viewer?.userId ?? null)) {
      throw new AppError(ErrorCodes.NOT_FOUND, '这个收藏夹不存在或不可见')
    }
    const owner = await ownerOf(found.ownerId, viewer)
    return {
      ...summarize(found, owner, viewer?.userId ?? null),
      createdAt: found.createdAt,
      isOwner: found.ownerId === (viewer?.userId ?? ''),
    }
  },

  async listCollectionItems(
    id: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<CursorListPage<Photo>> {
    const collection = readStore().collections.find((item) => item.id === id)
    if (!collection) throw new AppError(ErrorCodes.NOT_FOUND, '这个收藏夹不存在或不可见')
    const viewer = currentSession()
    if (!visibleTo(collection, viewer?.userId ?? null)) {
      // 不可见时同样当空页处理：调用方已经通过 getCollection 拿到 404
      return { items: [], nextCursor: null }
    }
    const photos = await loadPhotos()
    const byId = new Map(photos.map((photo) => [photo.id, photo]))
    const ordered = collection.photoIds
      .map((photoId) => byId.get(photoId))
      .filter((photo): photo is Photo => Boolean(photo))
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50)
    const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0
    const items = ordered.slice(offset, offset + limit)
    const next = offset + items.length
    return { items, nextCursor: next < ordered.length ? String(next) : null }
  },

  async createCollection(input: {
    title: string
    description?: string
    visibility?: CollectionVisibility
  }): Promise<CollectionSummary> {
    const session = requireSession()
    const store = readStore()
    const mine = liveCollections(store).filter((item) => item.ownerId === session.userId)
    if (mine.length >= MAX_COLLECTIONS) {
      throw new AppError(ErrorCodes.VALIDATION, '收藏夹数量已达上限（30 个）')
    }
    const now = new Date().toISOString()
    const created: StoredCollection = {
      id: crypto.randomUUID(),
      ownerId: session.userId,
      title: parseTitle(input.title),
      description: parseDescription(input.description ?? ''),
      visibility: input.visibility ? parseVisibility(input.visibility) : 'private',
      photoIds: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    store.collections.push(created)
    writeStore(store)
    return summarize(created, { username: session.username, displayName: session.displayName }, session.userId)
  },

  async updateCollection(
    id: string,
    patch: { title?: string; description?: string; visibility?: CollectionVisibility },
  ): Promise<CollectionSummary> {
    const session = requireSession()
    const store = readStore()
    const target = findOwned(store, id, session.userId)
    if (patch.title !== undefined) target.title = parseTitle(patch.title)
    if (patch.description !== undefined) target.description = parseDescription(patch.description)
    if (patch.visibility !== undefined) target.visibility = parseVisibility(patch.visibility)
    target.updatedAt = new Date().toISOString()
    writeStore(store)
    return summarize(target, { username: session.username, displayName: session.displayName }, session.userId)
  },

  async deleteCollection(id: string): Promise<void> {
    const session = requireSession()
    const store = readStore()
    const target = findOwned(store, id, session.userId)
    target.deletedAt = new Date().toISOString()
    writeStore(store)
  },

  async addItem(collectionId: string, photoId: string): Promise<{ itemCount: number }> {
    const session = requireSession()
    const store = readStore()
    const target = findOwned(store, collectionId, session.userId)
    const photos = await loadPhotos()
    const photo = photos.find((item) => item.id === photoId)
    if (!photo || photo.status !== 'published') {
      throw new AppError(ErrorCodes.VALIDATION, '只能收藏已发布的作品')
    }
    if (!target.photoIds.includes(photoId)) {
      target.photoIds = [photoId, ...target.photoIds]
      target.updatedAt = new Date().toISOString()
      writeStore(store)
    }
    return { itemCount: target.photoIds.length }
  },

  async removeItem(collectionId: string, photoId: string): Promise<{ itemCount: number }> {
    const session = requireSession()
    const store = readStore()
    const target = findOwned(store, collectionId, session.userId)
    if (target.photoIds.includes(photoId)) {
      target.photoIds = target.photoIds.filter((item) => item !== photoId)
      target.updatedAt = new Date().toISOString()
      writeStore(store)
    }
    return { itemCount: target.photoIds.length }
  },
}

/** 测试用：清空 mock 收藏夹与草稿 */
export function resetMockCollections(): void {
  localStorage.removeItem(COLLECTIONS_KEY)
  localStorage.removeItem(DRAFT_KEY)
}
