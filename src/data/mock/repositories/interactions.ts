/**
 * Mock 互动仓储（点赞/收藏）。
 * 契约：InteractionRepository。计数永远由数据派生（ROADMAP §5.3）。
 */
import { AppError, ErrorCodes, type CursorListPage, type InteractionRepository } from '@/data/contracts'
import type { Interaction, Photo } from '@/domain/types'
import { findProfileByUsername, isBlockedBetween, paginateByCursor } from '@/domain/social'
import { getDb, bumpDataVersion } from '../db'

/** 未显式传 limit 时的页长（与关注列表同量级；个人主页 hook 会显式传值） */
const DEFAULT_PAGE_SIZE = 24

async function recount(db: Awaited<ReturnType<typeof getDb>>, photoId: string): Promise<void> {
  const photo = await db.get('photos', photoId)
  if (!photo) return
  const [likes, favorites] = await Promise.all([db.getAll('likes'), db.getAll('favorites')])
  await db.put('photos', {
    ...photo,
    likeCount: likes.filter((r) => r.photoId === photoId).length,
    favoriteCount: favorites.filter((r) => r.photoId === photoId).length,
  })
}

/**
 * 某人互动过的**已发布**作品，按发布时间倒序（likes / favorites 共用）。
 * 互动记录指向的作品可能已被软撤回，撤回件不进公开列表。
 */
async function assertCanInteract(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  photo: Photo,
): Promise<void> {
  if (userId !== photo.authorId && isBlockedBetween(await db.getAll('blocks'), userId, photo.authorId)) {
    throw new AppError(ErrorCodes.FORBIDDEN, '你无法与该用户的作品互动')
  }
}

async function photosInteractedBy(
  db: Awaited<ReturnType<typeof getDb>>,
  table: 'likes' | 'favorites',
  userId: string,
  viewerId?: string,
): Promise<Photo[]> {
  const rows = await db.getAll(table)
  const ids = rows.filter((r) => r.userId === userId).map((r) => r.photoId)
  const photos: Photo[] = []
  for (const id of ids) {
    const p = await db.get('photos', id)
    if (
      p &&
      p.status === 'published' &&
      (!viewerId || !isBlockedBetween(await db.getAll('blocks'), viewerId, p.authorId))
    ) photos.push(p)
  }
  return photos.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}

export const mockInteractionRepository: InteractionRepository = {
  async listLikesByUser(userId: string): Promise<Photo[]> {
    return photosInteractedBy(await getDb(), 'likes', userId)
  },

  async listFavoritesByUser(userId: string): Promise<Photo[]> {
    return photosInteractedBy(await getDb(), 'favorites', userId)
  },

  async listByUsername(
    username: string,
    kind: 'likes' | 'favorites',
    cursor?: string,
    limit?: number,
  ): Promise<CursorListPage<Photo>> {
    const db = await getDb()
    const owner = findProfileByUsername(await db.getAll('profiles'), username)
    // 用户不存在 → 空页（而不是 404）：主页已经用资料查询的表现决定了错误态。
    if (!owner) return { items: [], nextCursor: null }
    const photos = await photosInteractedBy(db, kind, owner.id)
    // 排序键用 photo.id：与上面的排序（publishedAt 倒序）在全序上一致，
    // 同 publishedAt 的批量种子数据因此不会在翻页边界重复或漏项。
    return paginateByCursor(photos, cursor, limit ?? DEFAULT_PAGE_SIZE, (p) => p.id)
  },

  async getLikeState(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const row = await db.get('likes', [userId, photoId])
    return row !== undefined
  },

  async getFavoriteState(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const row = await db.get('favorites', [userId, photoId])
    return row !== undefined
  },

  async toggleLike(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${photoId}`)
    await assertCanInteract(db, userId, photo)
    const existing = await db.get('likes', [userId, photoId])
    if (existing) {
      await db.delete('likes', [userId, photoId])
    } else {
      const row: Interaction = { userId, photoId, createdAt: new Date().toISOString() }
      await db.put('likes', row)
    }
    await recount(db, photoId)
    await bumpDataVersion()
    return existing === undefined
  },

  async toggleFavorite(userId: string, photoId: string): Promise<boolean> {
    const db = await getDb()
    const photo = await db.get('photos', photoId)
    if (!photo) throw new AppError(ErrorCodes.NOT_FOUND, `作品不存在：${photoId}`)
    await assertCanInteract(db, userId, photo)
    const existing = await db.get('favorites', [userId, photoId])
    if (existing) {
      await db.delete('favorites', [userId, photoId])
    } else {
      const row: Interaction = { userId, photoId, createdAt: new Date().toISOString() }
      await db.put('favorites', row)
    }
    await recount(db, photoId)
    await bumpDataVersion()
    return existing === undefined
  },

  async listLikesByPhoto(photoId: string): Promise<Interaction[]> {
    const db = await getDb()
    return db.getAll('likes').then((rows) => rows.filter((r) => r.photoId === photoId))
  },

  async listFavoritesByPhoto(photoId: string): Promise<Interaction[]> {
    const db = await getDb()
    return db.getAll('favorites').then((rows) => rows.filter((r) => r.photoId === photoId))
  },
}
